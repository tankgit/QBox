from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.models import QuantTaskInfo, QuantTaskRequest
from app.services.quant_trading import QUANT_MANAGER

router = APIRouter(prefix="/quant", tags=["quant"])


@router.get("/tasks", response_model=list[QuantTaskInfo])
def list_quant_tasks() -> list[QuantTaskInfo]:
    return QUANT_MANAGER.list_tasks()


@router.post("/tasks", response_model=QuantTaskInfo)
async def create_quant_task(request: QuantTaskRequest) -> QuantTaskInfo:
    try:
        return QUANT_MANAGER.create_task(request)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/tasks/{task_id}", response_model=QuantTaskInfo)
def get_quant_task(task_id: str) -> QuantTaskInfo:
    try:
        return QUANT_MANAGER.describe_task(task_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Task not found") from exc


@router.post("/tasks/{task_id}/pause", response_model=QuantTaskInfo)
async def pause_quant_task(task_id: str) -> QuantTaskInfo:
    try:
        return QUANT_MANAGER.pause(task_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Task not found") from exc


@router.post("/tasks/{task_id}/resume", response_model=QuantTaskInfo)
async def resume_quant_task(task_id: str) -> QuantTaskInfo:
    try:
        return QUANT_MANAGER.resume(task_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Task not found") from exc


@router.post("/tasks/{task_id}/stop", response_model=QuantTaskInfo)
async def stop_quant_task(task_id: str) -> QuantTaskInfo:
    try:
        return QUANT_MANAGER.stop(task_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Task not found") from exc


@router.delete("/tasks/{task_id}")
async def delete_quant_task(task_id: str) -> None:
    QUANT_MANAGER.delete(task_id)

