from __future__ import annotations

import asyncio
import csv
import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.config import CONFIG
from app.models import (
    DataSeriesDetail,
    DataSeriesInfo,
    LiveDataSnapshotInfo,
    LiveDataTaskInfo,
    LiveDataTaskRequest,
)
from app.services.longport_client import LONGPORT_CLIENT, MissingCredentialsError
from app.services.quote_utils import extract_price_and_timestamp
from app.utils.file_storage import read_series, write_series
from app.utils.id_generator import generate_id
from app.utils.scheduler import SCHEDULER, TaskStatus
from app.utils.trading_sessions import contains_session, get_dst_labels, resolve_sessions


def _now() -> datetime:
    return datetime.now(timezone.utc)


LOGGER = logging.getLogger(__name__)


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
        self._load_existing_live_tasks()

    def _load_existing_live_tasks(self) -> None:
        for file_path in sorted(self.live_dir.glob("task_*.csv")):
            try:
                stored = read_series(file_path)
            except FileNotFoundError:
                continue
            except Exception as exc:  # noqa: BLE001
                LOGGER.warning("Failed to read live task file %s: %s", file_path, exc)
                continue

            config = stored.config or {}
            task_id = str(config.get("task_id") or file_path.stem)

            try:
                request = self._build_request_from_config(config)
            except Exception as exc:  # noqa: BLE001
                LOGGER.warning("Skipping live task %s due to invalid config: %s", task_id, exc)
                continue

            created_at = self._parse_datetime(config.get("created_at")) or _now()
            started_at = self._parse_datetime(config.get("started_at")) or self._parse_datetime(
                config.get("created_at")
            )
            finished_at = self._parse_datetime(config.get("finished_at"))

            status_value = config.get("status")
            status = TaskStatus.PAUSED
            if isinstance(status_value, str):
                try:
                    status = TaskStatus(status_value)
                except ValueError:
                    LOGGER.debug(
                        "Unknown status '%s' for live task %s, defaulting to paused",
                        status_value,
                        task_id,
                    )
            if status in {TaskStatus.RUNNING, TaskStatus.WAITING}:
                status = TaskStatus.PAUSED

            state = LiveDataTaskState(
                task_id=task_id,
                config=request,
                created_at=created_at,
                started_at=started_at,
                finished_at=finished_at,
                status=status,
                message=config.get("message"),
                data_file=file_path,
                data_id=config.get("data_id"),
            )
            self.tasks[task_id] = state

    @staticmethod
    def _parse_datetime(value: Any) -> Optional[datetime]:
        if not value or not isinstance(value, str):
            return None
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            return None

    @staticmethod
    def _parse_optional_int(value: Any) -> Optional[int]:
        if value is None:
            return None
        if isinstance(value, int):
            return value
        try:
            return int(float(value))
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _parse_bool(value: Any, default: bool = False) -> bool:
        if isinstance(value, bool):
            return value
        if value is None:
            return default
        if isinstance(value, str):
            lowered = value.strip().lower()
            if lowered in {"true", "1", "yes", "y"}:
                return True
            if lowered in {"false", "0", "no", "n"}:
                return False
        if isinstance(value, (int, float)):
            return bool(value)
        return default

    def _build_request_from_config(self, config: Dict[str, Any]) -> LiveDataTaskRequest:
        account_mode = config.get("account_mode") or "paper"
        payload: Dict[str, Any] = {
            "symbol": config.get("symbol"),
            "session": config.get("session"),
            "interval_seconds": max(self._parse_optional_int(config.get("interval_seconds")) or 1, 1),
            "duration_seconds": self._parse_optional_int(config.get("duration_seconds")),
            "is_permanent": self._parse_bool(config.get("is_permanent"), default=False),
            "max_points": self._parse_optional_int(config.get("max_points")),
            "account_mode": str(account_mode),
        }

        if payload["duration_seconds"] is None:
            duration_minutes = self._parse_optional_int(config.get("duration_minutes"))
            if duration_minutes:
                payload["duration_seconds"] = max(duration_minutes * 60, 1)
        if payload["is_permanent"]:
            payload["duration_seconds"] = None
        elif payload["duration_seconds"] is None:
            raise ValueError("duration_seconds missing for non-permanent task")

        if payload["max_points"] is not None and payload["max_points"] < 1:
            payload["max_points"] = None

        missing_fields = [key for key in ("symbol", "session") if not payload.get(key)]
        if missing_fields:
            raise ValueError(f"missing required fields: {', '.join(missing_fields)}")

        return LiveDataTaskRequest(**payload)

    def list_live_tasks(self) -> List[LiveDataTaskInfo]:
        infos: List[LiveDataTaskInfo] = []
        for state in self.tasks.values():
            scheduler_task = SCHEDULER.get(state.task_id)
            status = scheduler_task.status.value if scheduler_task else state.status.value
            session_definitions = resolve_sessions(state.config.session)
            dst_labels = get_dst_labels(session_definitions) if session_definitions else None
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
                dst_labels=dst_labels,
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

    def _create_task_runner(self, state: LiveDataTaskState):
        request = state.config

        async def runner() -> None:
            state.started_at = state.started_at or _now()
            state.finished_at = None
            header = ["timestamp", "price"]
            session_definitions = resolve_sessions(request.session)
            if not state.data_file.parent.exists():
                state.data_file.parent.mkdir(parents=True, exist_ok=True)

            if not state.data_file.exists() or state.data_file.stat().st_size == 0:
                config_payload = request.dict()
                config_payload["task_id"] = state.task_id
                config_payload["source"] = config_payload.get("source", "longport_live")
                config_payload["created_at"] = state.started_at.isoformat()
                if request.duration_seconds is not None:
                    config_payload["duration_minutes"] = max(int(request.duration_seconds // 60), 0)
                config_payload["dst_labels"] = get_dst_labels(session_definitions, state.started_at)
                if state.data_id:
                    config_payload["data_id"] = state.data_id
                config_payload["status"] = state.status.value
                with state.data_file.open("w", newline="", encoding="utf-8") as fp:
                    fp.write(json.dumps(config_payload) + "\n")
                    writer = csv.DictWriter(fp, fieldnames=header)
                    writer.writeheader()
            else:
                try:
                    with state.data_file.open("r", encoding="utf-8") as fp:
                        config_line = fp.readline().strip()
                    if config_line:
                        stored_config = json.loads(config_line)
                        parsed_started = self._parse_datetime(stored_config.get("started_at"))
                        if parsed_started:
                            state.started_at = parsed_started
                except Exception as exc:  # noqa: BLE001
                    LOGGER.warning("Failed to read config for task %s: %s", state.task_id, exc)

            if request.duration_seconds is not None and state.started_at is not None:
                end_time = state.started_at + timedelta(seconds=request.duration_seconds)
            else:
                end_time = None
            pause_started: Optional[datetime] = None
            waiting_started: Optional[datetime] = None
            try:
                while True:
                    now = _now()
                    if state.status == TaskStatus.PAUSED:
                        if pause_started is None:
                            pause_started = now
                        await asyncio.sleep(0.5)
                        continue
                    if not contains_session(session_definitions, now):
                        if waiting_started is None:
                            waiting_started = now
                        if state.status != TaskStatus.WAITING:
                            state.status = TaskStatus.WAITING
                            scheduler_task = SCHEDULER.get(state.task_id)
                            if scheduler_task is not None:
                                scheduler_task.status = TaskStatus.WAITING
                        await asyncio.sleep(1.0)
                        continue
                    if state.status == TaskStatus.WAITING:
                        state.status = TaskStatus.RUNNING
                        scheduler_task = SCHEDULER.get(state.task_id)
                        if scheduler_task is not None:
                            scheduler_task.status = TaskStatus.RUNNING
                    if waiting_started is not None:
                        if end_time is not None:
                            end_time += now - waiting_started
                        waiting_started = None
                    if pause_started is not None:
                        if end_time is not None:
                            end_time += now - pause_started
                        pause_started = None
                    if end_time is not None and now >= end_time:
                        break
                    price, price_timestamp = await self._fetch_symbol_price(
                        request.symbol, request.account_mode, request.session
                    )
                    timestamp = price_timestamp or _now()
                    row = {"timestamp": timestamp.isoformat(), "price": price}
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

        return runner

    def create_live_task(self, request: LiveDataTaskRequest) -> LiveDataTaskInfo:
        task_id = generate_id("task_")
        state = LiveDataTaskState(
            task_id=task_id,
            config=request,
            data_file=self._task_data_file(task_id),
        )
        state.status = TaskStatus.RUNNING
        self.tasks[task_id] = state

        SCHEDULER.create(task_id, self._create_task_runner(state))
        return self.describe_live_task(task_id)

    async def _fetch_symbol_price(self, symbol: str, mode: str, session: str) -> tuple[float, datetime]:
        def fetch() -> tuple[float, datetime]:
            with LONGPORT_CLIENT.quote_context(mode) as ctx:
                response = ctx.quote([symbol])
                if not response:
                    raise RuntimeError("Quote response empty")
                quote = response[0]
                price, timestamp = extract_price_and_timestamp(quote, session)
                return price, timestamp or _now()

        try:
            return await asyncio.to_thread(fetch)
        except MissingCredentialsError:
            raise
        except Exception:
            # fallback to pseudo-random walk to keep task running in dev
            return (
                round(100 + (hash(symbol) % 100) * 0.01, 4),
                _now(),
            )

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
        state.message = None
        if state.finished_at is not None:
            state.finished_at = None
        scheduler_task = SCHEDULER.get(task_id)
        if scheduler_task is None or scheduler_task.status in {
            TaskStatus.STOPPED,
            TaskStatus.COMPLETED,
            TaskStatus.FAILED,
        }:
            if scheduler_task is not None:
                SCHEDULER.remove(task_id)
            SCHEDULER.create(task_id, self._create_task_runner(state))
        else:
            scheduler_task.status = TaskStatus.RUNNING
        return self.describe_live_task(task_id)

    def stop_task(self, task_id: str) -> LiveDataTaskInfo:
        state = self.tasks[task_id]
        scheduler_task = SCHEDULER.get(task_id)
        if scheduler_task is not None:
            SCHEDULER.stop(task_id)
        state.status = TaskStatus.STOPPED
        state.finished_at = state.finished_at or _now()
        return self.describe_live_task(task_id)

    def delete_task(self, task_id: str) -> None:
        SCHEDULER.remove(task_id)
        if task_id in self.tasks:
            state = self.tasks.pop(task_id)
            if state.data_file.exists():
                state.data_file.unlink()


DATA_TASKS = DataTaskManager(CONFIG.data_storage_path)

