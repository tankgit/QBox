from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.models import BacktestRequest, BacktestTaskInfo
from app.services.backtesting import BACKTEST_MANAGER

router = APIRouter(prefix="/backtests", tags=["backtests"])


@router.get("", response_model=list[BacktestTaskInfo])
def list_backtests() -> list[BacktestTaskInfo]:
    return BACKTEST_MANAGER.list_tasks()


@router.post("", response_model=BacktestTaskInfo)
async def create_backtest(request: BacktestRequest) -> BacktestTaskInfo:
    try:
        return BACKTEST_MANAGER.create_task(request)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/{task_id}", response_model=BacktestTaskInfo)
def get_backtest(task_id: str) -> BacktestTaskInfo:
    try:
        return BACKTEST_MANAGER.describe_task(task_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Task not found") from exc


@router.post("/{task_id}/pause", response_model=BacktestTaskInfo)
async def pause_backtest(task_id: str) -> BacktestTaskInfo:
    try:
        return BACKTEST_MANAGER.pause(task_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Task not found") from exc


@router.post("/{task_id}/resume", response_model=BacktestTaskInfo)
async def resume_backtest(task_id: str) -> BacktestTaskInfo:
    try:
        return BACKTEST_MANAGER.resume(task_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Task not found") from exc


@router.post("/{task_id}/stop", response_model=BacktestTaskInfo)
async def stop_backtest(task_id: str) -> BacktestTaskInfo:
    try:
        return BACKTEST_MANAGER.stop(task_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Task not found") from exc


@router.delete("/{task_id}")
async def delete_backtest(task_id: str) -> None:
    BACKTEST_MANAGER.delete(task_id)

