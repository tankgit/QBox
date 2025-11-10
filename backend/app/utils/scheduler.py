from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, Optional


class TaskStatus(str, Enum):
    WAITING = "waiting"
    RUNNING = "running"
    PAUSED = "paused"
    STOPPED = "stopped"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass(slots=True)
class ScheduledTask:
    task_id: str
    coro_factory: Callable[[], Awaitable[Any]]
    status: TaskStatus = field(default=TaskStatus.RUNNING)
    message: Optional[str] = field(default=None)
    _task: Optional[asyncio.Task[Any]] = field(default=None, init=False, repr=False)

    def start(self) -> None:
        if self._task is not None and not self._task.done():
            return
        self.status = TaskStatus.RUNNING
        self._task = asyncio.create_task(self._runner())

    async def _runner(self) -> None:
        try:
            await self.coro_factory()
            if self.status not in {TaskStatus.STOPPED, TaskStatus.PAUSED}:
                self.status = TaskStatus.COMPLETED
        except asyncio.CancelledError:
            self.status = TaskStatus.STOPPED
            raise
        except Exception as exc:  # noqa: BLE001
            self.status = TaskStatus.FAILED
            self.message = str(exc)

    def cancel(self) -> None:
        if self._task and not self._task.done():
            self._task.cancel()
        self.status = TaskStatus.STOPPED

    def pause(self) -> None:
        self.status = TaskStatus.PAUSED
        if self._task and not self._task.done():
            self._task.cancel()

    def resume(self) -> None:
        if self.status == TaskStatus.PAUSED:
            self.start()


class Scheduler:
    def __init__(self) -> None:
        self._tasks: Dict[str, ScheduledTask] = {}

    def create(self, task_id: str, coro_factory: Callable[[], Awaitable[Any]]) -> ScheduledTask:
        scheduled = ScheduledTask(task_id=task_id, coro_factory=coro_factory)
        self._tasks[task_id] = scheduled
        scheduled.start()
        return scheduled

    def get(self, task_id: str) -> Optional[ScheduledTask]:
        return self._tasks.get(task_id)

    def list(self) -> Dict[str, ScheduledTask]:
        return dict(self._tasks)

    def pause(self, task_id: str) -> None:
        task = self._tasks[task_id]
        task.pause()

    def resume(self, task_id: str) -> None:
        task = self._tasks[task_id]
        task.resume()

    def stop(self, task_id: str) -> None:
        task = self._tasks[task_id]
        task.cancel()

    def remove(self, task_id: str) -> None:
        task = self._tasks.pop(task_id, None)
        if task:
            task.cancel()


SCHEDULER = Scheduler()

