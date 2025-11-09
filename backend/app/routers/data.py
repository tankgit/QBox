from __future__ import annotations

from fastapi import APIRouter, Body, HTTPException

from app.models import (
    DataSeriesDetail,
    DataSeriesInfo,
    LiveDataSnapshotInfo,
    LiveDataTaskInfo,
    LiveDataTaskRequest,
    LiveSnapshotRequest,
    SimulatedDataRequest,
)
from app.services.data_generation import DATA_REPOSITORY
from app.services.data_tasks import DATA_TASKS

router = APIRouter(prefix="/data", tags=["data"])


@router.post("/simulated", response_model=DataSeriesInfo)
def create_simulated_data(request: SimulatedDataRequest) -> DataSeriesInfo:
    return DATA_REPOSITORY.create_simulated(request)


@router.get("/simulated", response_model=list[DataSeriesInfo])
def list_simulated_data() -> list[DataSeriesInfo]:
    return DATA_REPOSITORY.list_series()


@router.get("/simulated/{data_id}", response_model=DataSeriesDetail)
def get_simulated_data(data_id: str) -> DataSeriesDetail:
    try:
        return DATA_REPOSITORY.get_series(data_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/simulated/{data_id}", status_code=204)
def delete_simulated_data(data_id: str) -> None:
    try:
        DATA_REPOSITORY.delete_series(data_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/live/tasks", response_model=list[LiveDataTaskInfo])
def list_live_tasks() -> list[LiveDataTaskInfo]:
    return DATA_TASKS.list_live_tasks()


@router.post("/live/tasks", response_model=LiveDataTaskInfo)
async def create_live_task(request: LiveDataTaskRequest) -> LiveDataTaskInfo:
    try:
        return DATA_TASKS.create_live_task(request)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/live/tasks/{task_id}/pause", response_model=LiveDataTaskInfo)
async def pause_live_task(task_id: str) -> LiveDataTaskInfo:
    try:
        return DATA_TASKS.pause_task(task_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Task not found") from exc


@router.post("/live/tasks/{task_id}/resume", response_model=LiveDataTaskInfo)
async def resume_live_task(task_id: str) -> LiveDataTaskInfo:
    try:
        return DATA_TASKS.resume_task(task_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Task not found") from exc


@router.post("/live/tasks/{task_id}/stop", response_model=LiveDataTaskInfo)
async def stop_live_task(task_id: str) -> LiveDataTaskInfo:
    try:
        return DATA_TASKS.stop_task(task_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Task not found") from exc


@router.delete("/live/tasks/{task_id}")
async def delete_live_task(task_id: str) -> None:
    DATA_TASKS.delete_task(task_id)


@router.post("/live/tasks/{task_id}/snapshot", response_model=LiveDataSnapshotInfo)
def create_snapshot(
    task_id: str,
    request: LiveSnapshotRequest | None = Body(default=None),
) -> LiveDataSnapshotInfo:
    try:
        start_index = request.start_index if request else None
        end_index = request.end_index if request else None
        return DATA_TASKS.create_snapshot(task_id, start_index=start_index, end_index=end_index)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Task not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/live/snapshots", response_model=list[LiveDataSnapshotInfo])
def list_snapshots() -> list[LiveDataSnapshotInfo]:
    return DATA_TASKS.list_snapshots()


@router.get("/live/data/{data_id}", response_model=DataSeriesDetail)
def get_live_data(data_id: str) -> DataSeriesDetail:
    try:
        return DATA_TASKS.get_data_series(data_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/live/tasks/{task_id}/data", response_model=DataSeriesDetail)
def get_live_task_data(task_id: str) -> DataSeriesDetail:
    try:
        return DATA_TASKS.get_task_series(task_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Task not found") from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/live/data/{data_id}", status_code=204)
def delete_live_data(data_id: str) -> None:
    try:
        DATA_TASKS.delete_snapshot_data(data_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

