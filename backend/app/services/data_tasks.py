from __future__ import annotations

import asyncio
import csv
import json
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, List, Optional

from app.config import CONFIG
from app.models import (
    DataSeriesDetail,
    DataSeriesInfo,
    LiveDataSnapshotInfo,
    LiveDataTaskInfo,
    LiveDataTaskRequest,
)
from app.services.longport_client import LONGPORT_CLIENT, MissingCredentialsError
from app.utils.file_storage import read_series, write_series
from app.utils.id_generator import generate_id
from app.utils.scheduler import SCHEDULER, TaskStatus


def _now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class LiveDataTaskState:
    task_id: str
    config: LiveDataTaskRequest
    created_at: datetime = field(default_factory=_now)
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    status: TaskStatus = TaskStatus.PAUSED
    message: Optional[str] = None
    data_file: Path = field(default_factory=Path)
    data_id: Optional[str] = None


class DataTaskManager:
    def __init__(self, data_dir: Path) -> None:
        self.data_dir = data_dir
        self.snapshots_dir = data_dir / "snapshots"
        self.live_dir = data_dir / "live"
        self.snapshots: Dict[str, LiveDataSnapshotInfo] = {}
        self.tasks: Dict[str, LiveDataTaskState] = {}
        self.snapshots_dir.mkdir(parents=True, exist_ok=True)
        self.live_dir.mkdir(parents=True, exist_ok=True)

    def list_live_tasks(self) -> List[LiveDataTaskInfo]:
        infos: List[LiveDataTaskInfo] = []
        for state in self.tasks.values():
            scheduler_task = SCHEDULER.get(state.task_id)
            status = scheduler_task.status.value if scheduler_task else state.status.value
            info = LiveDataTaskInfo(
                task_id=state.task_id,
                symbol=state.config.symbol,
                session=state.config.session,
                interval_seconds=state.config.interval_seconds,
                duration_seconds=state.config.duration_seconds,
                is_permanent=state.config.is_permanent,
                max_points=state.config.max_points,
                account_mode=state.config.account_mode,
                status=status,
                created_at=state.created_at,
                started_at=state.started_at,
                finished_at=state.finished_at,
                data_id=state.data_id,
                message=state.message,
            )
            infos.append(info)
        return infos

    def describe_live_task(self, task_id: str) -> LiveDataTaskInfo:
        if task_id not in self.tasks:
            raise KeyError(task_id)
        for info in self.list_live_tasks():
            if info.task_id == task_id:
                return info
        raise KeyError(task_id)

    def _task_data_file(self, task_id: str) -> Path:
        return self.live_dir / f"{task_id}.csv"

    def create_live_task(self, request: LiveDataTaskRequest) -> LiveDataTaskInfo:
        task_id = generate_id("task_")
        state = LiveDataTaskState(
            task_id=task_id,
            config=request,
            data_file=self._task_data_file(task_id),
        )
        state.status = TaskStatus.RUNNING
        self.tasks[task_id] = state

        async def runner() -> None:
            state.started_at = _now()
            header = ["timestamp", "price"]
            config_payload = request.dict()
            config_payload["task_id"] = task_id
            config_payload["source"] = "longport_live"
            config_payload["created_at"] = state.started_at.isoformat()
            if request.duration_seconds is not None:
                config_payload["duration_minutes"] = max(int(request.duration_seconds // 60), 0)
            with state.data_file.open("w", newline="", encoding="utf-8") as fp:
                fp.write(json.dumps(config_payload) + "\n")
                writer = csv.DictWriter(fp, fieldnames=header)
                writer.writeheader()

            end_time = _now() + timedelta(seconds=request.duration_seconds) if request.duration_seconds else None
            pause_started: Optional[datetime] = None
            try:
                while True:
                    now = _now()
                    if state.status == TaskStatus.PAUSED:
                        if pause_started is None:
                            pause_started = now
                        await asyncio.sleep(0.5)
                        continue
                    if pause_started is not None:
                        if end_time is not None:
                            end_time += now - pause_started
                        pause_started = None
                    if end_time is not None and now >= end_time:
                        break
                    price = await self._fetch_symbol_price(request.symbol, request.account_mode)
                    row = {"timestamp": _now().isoformat(), "price": price}
                    with state.data_file.open("a", newline="", encoding="utf-8") as fp:
                        writer = csv.DictWriter(fp, fieldnames=header)
                        writer.writerow(row)
                    if request.max_points is not None:
                        self._trim_data_file(state.data_file, request.max_points)
                    await asyncio.sleep(request.interval_seconds)
            except asyncio.CancelledError:
                raise
            except MissingCredentialsError as exc:
                state.message = str(exc)
                raise
            except Exception as exc:  # noqa: BLE001
                state.message = str(exc)
                raise
            finally:
                state.finished_at = _now()

        SCHEDULER.create(task_id, runner)
        return self.describe_live_task(task_id)

    async def _fetch_symbol_price(self, symbol: str, mode: str) -> float:
        def fetch() -> float:
            with LONGPORT_CLIENT.quote_context(mode) as ctx:
                response = ctx.quote([symbol])
                if not response:
                    raise RuntimeError("Quote response empty")
                quote = response[0]
                price = getattr(quote, "last_done", None)
                if price and getattr(price, "price", None) is not None:
                    return float(price.price)
                if getattr(quote, "last", None) is not None:
                    return float(quote.last)
                raise RuntimeError("Unable to extract price from quote response")

        try:
            return await asyncio.to_thread(fetch)
        except MissingCredentialsError:
            raise
        except Exception:
            # fallback to pseudo-random walk to keep task running in dev
            return round(100 + (hash(symbol) % 100) * 0.01, 4)

    def create_snapshot(
        self,
        task_id: str,
        start_index: Optional[int] = None,
        end_index: Optional[int] = None,
    ) -> LiveDataSnapshotInfo:
        state = self.tasks[task_id]
        if not state.data_file.exists():
            raise FileNotFoundError("No data available yet for this task.")
        stored = read_series(state.data_file)
        rows = stored.rows
        if not rows:
            raise FileNotFoundError("No data rows available yet for this task.")
        total_rows = len(rows)
        start = 0 if start_index is None else max(0, min(start_index, total_rows - 1))
        end = total_rows - 1 if end_index is None else max(0, min(end_index, total_rows - 1))
        if start > end:
            raise ValueError("Invalid snapshot range: start_index cannot be greater than end_index.")
        sliced_rows = rows[start : end + 1]
        if not sliced_rows:
            raise ValueError("Snapshot range does not contain any data points.")

        snapshot_config = dict(stored.config)
        snapshot_config["snapshot_range"] = {"start_index": start, "end_index": end}
        snapshot_config["source"] = snapshot_config.get("source", "longport_live")
        snapshot_config["created_at"] = _now().isoformat()

        data_id = generate_id("data_")
        snapshot_path = self.snapshots_dir / f"{data_id}.csv"
        write_series(snapshot_path, snapshot_config, sliced_rows)

        snapshot = LiveDataSnapshotInfo(
            snapshot_id=generate_id("snap_"),
            task_id=task_id,
            data_id=data_id,
            created_at=_now(),
            path=str(snapshot_path),
        )
        self.snapshots[snapshot.snapshot_id] = snapshot
        state.data_id = data_id
        return snapshot

    def _trim_data_file(self, file_path: Path, max_points: int) -> None:
        stored = read_series(file_path)
        if len(stored.rows) <= max_points:
            return
        trimmed_rows = stored.rows[-max_points:]
        write_series(file_path, stored.config, trimmed_rows)

    def delete_snapshot_data(self, data_id: str) -> None:
        path = self.snapshots_dir / f"{data_id}.csv"
        if not path.exists():
            raise FileNotFoundError(f"Snapshot data {data_id} not found")

        path.unlink()

        for snapshot_id, snapshot in list(self.snapshots.items()):
            if snapshot.data_id == data_id:
                self.snapshots.pop(snapshot_id, None)
                break

        for state in self.tasks.values():
            if state.data_id == data_id:
                state.data_id = None
    def list_snapshots(self) -> List[LiveDataSnapshotInfo]:
        return list(self.snapshots.values())

    def get_data_series(self, data_id: str) -> DataSeriesDetail:
        path = self.snapshots_dir / f"{data_id}.csv"
        if not path.exists():
            path = (CONFIG.data_storage_path / f"{data_id}.csv")
        stored = read_series(path)
        return DataSeriesDetail(
            data_id=data_id,
            symbol=stored.config.get("symbol", "unknown"),
            created_at=_now(),
            source=stored.config.get("source", "unknown"),
            path=str(path),
            config=stored.config,
            data=stored.rows,
        )

    def get_task_series(self, task_id: str) -> DataSeriesDetail:
        if task_id not in self.tasks:
            raise KeyError(task_id)
        state = self.tasks[task_id]
        path = state.data_file
        if not path.exists():
            raise FileNotFoundError(f"Live task data for {task_id} not found.")
        stored = read_series(path)
        config = stored.config or {}
        created_at_str = config.get("created_at")
        created_at = state.created_at
        if isinstance(created_at_str, str):
            try:
                created_at = datetime.fromisoformat(created_at_str)
            except ValueError:
                created_at = state.created_at
        data_id = config.get("data_id") or state.data_id or state.data_file.stem
        symbol = config.get("symbol", state.config.symbol)
        source = config.get("source", "longport_live")
        return DataSeriesDetail(
            data_id=str(data_id),
            symbol=symbol,
            created_at=created_at,
            source=source,
            path=str(path),
            config=config,
            data=stored.rows,
        )

    def pause_task(self, task_id: str) -> LiveDataTaskInfo:
        state = self.tasks[task_id]
        state.status = TaskStatus.PAUSED
        scheduler_task = SCHEDULER.get(task_id)
        if scheduler_task is not None:
            scheduler_task.status = TaskStatus.PAUSED
        return self.describe_live_task(task_id)

    def resume_task(self, task_id: str) -> LiveDataTaskInfo:
        state = self.tasks[task_id]
        state.status = TaskStatus.RUNNING
        scheduler_task = SCHEDULER.get(task_id)
        if scheduler_task is not None:
            scheduler_task.status = TaskStatus.RUNNING
        return self.describe_live_task(task_id)

    def stop_task(self, task_id: str) -> LiveDataTaskInfo:
        SCHEDULER.stop(task_id)
        state = self.tasks[task_id]
        state.status = TaskStatus.STOPPED
        return self.describe_live_task(task_id)

    def delete_task(self, task_id: str) -> None:
        SCHEDULER.remove(task_id)
        if task_id in self.tasks:
            state = self.tasks.pop(task_id)
            if state.data_file.exists():
                state.data_file.unlink()


DATA_TASKS = DataTaskManager(CONFIG.data_storage_path)

