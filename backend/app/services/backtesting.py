from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

from app.config import CONFIG
from app.models import BacktestRequest, BacktestTaskInfo, SignalType, StrategySignal
from app.services.data_generation import DATA_REPOSITORY
from app.services.data_tasks import DATA_TASKS
from app.services.strategies import STRATEGY_REGISTRY, Strategy
from app.utils.id_generator import generate_id
from app.utils.scheduler import SCHEDULER, TaskStatus


def _now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class TradeLogEntry:
    timestamp: str
    action: str
    price: float
    quantity: float
    cash: float
    position: float
    value: float


@dataclass
class BacktestTaskState:
    task_id: str
    request: BacktestRequest
    status: TaskStatus = TaskStatus.PAUSED
    created_at: datetime = field(default_factory=_now)
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    metrics: Optional[Dict[str, float]] = None
    message: Optional[str] = None
    log_path: Path = field(default_factory=Path)
    trades: List[TradeLogEntry] = field(default_factory=list)


class BacktestManager:
    def __init__(self, log_dir: Path) -> None:
        self.log_dir = log_dir
        self.log_dir.mkdir(parents=True, exist_ok=True)
        self.tasks: Dict[str, BacktestTaskState] = {}

    def create_task(self, request: BacktestRequest) -> BacktestTaskInfo:
        task_id = generate_id("test_")
        state = BacktestTaskState(
            task_id=task_id,
            request=request,
            status=TaskStatus.RUNNING,
            log_path=self.log_dir / f"{task_id}.log",
        )
        self.tasks[task_id] = state

        async def runner() -> None:
            state.started_at = _now()
            await self._run_backtest(state)
            state.finished_at = _now()

        SCHEDULER.create(task_id, runner)
        return self.describe_task(task_id)

    async def _run_backtest(self, state: BacktestTaskState) -> None:
        request = state.request
        try:
            series = self._load_data_series(request.data_id)
        except FileNotFoundError:
            state.message = "Data series not found."
            state.status = TaskStatus.FAILED
            return

        strategy_cls = STRATEGY_REGISTRY.get(request.strategy_id)
        strategy: Strategy = strategy_cls(**request.strategy_params)
        cash = request.initial_capital
        position = 0.0
        last_price = None
        max_equity = request.initial_capital
        equity_curve: List[float] = []
        wins = 0
        losses = 0
        total_trades = 0
        pnl_sum = 0.0
        win_amount = 0.0
        loss_amount = 0.0

        with state.log_path.open("w", encoding="utf-8") as fp:
            fp.write(json.dumps(request.dict()) + "\n")
            fp.write("timestamp,action,price,quantity,cash,position,value\n")

        for row in series.data:
            timestamp = row.get("timestamp")
            price = float(row.get("price", 0.0))
            last_price = price
            signal: StrategySignal = strategy.generate_signal(price, datetime.fromisoformat(timestamp))

            if signal.signal == SignalType.HOLD:
                equity = cash + position * price
                equity_curve.append(equity)
                max_equity = max(max_equity, equity)
                continue

            target_strength = abs(signal.strength)
            quantity = max(request.lot_size, request.lot_size * round(target_strength / request.lot_size))

            if signal.signal == SignalType.BUY:
                affordable_qty = cash // (price * request.lot_size) * request.lot_size
                trade_qty = min(affordable_qty, quantity)
                if trade_qty <= 0:
                    continue
                cash -= trade_qty * price
                position += trade_qty
                action = "buy"
            else:
                trade_qty = min(position, quantity)
                if trade_qty <= 0:
                    continue
                cash += trade_qty * price
                position -= trade_qty
                action = "sell"

            total_trades += 1
            value = cash + position * price
            pnl = value - max_equity
            if pnl >= 0:
                wins += 1
                win_amount += pnl
            else:
                losses += 1
                loss_amount += abs(pnl)
            pnl_sum += pnl
            max_equity = max(max_equity, value)
            entry = TradeLogEntry(
                timestamp=timestamp,
                action=action,
                price=price,
                quantity=trade_qty,
                cash=cash,
                position=position,
                value=value,
            )
            state.trades.append(entry)
            with state.log_path.open("a", encoding="utf-8") as fp:
                fp.write(
                    f"{timestamp},{action},{price:.4f},{trade_qty:.4f},{cash:.2f},{position:.4f},{value:.2f}\n"
                )
            equity_curve.append(value)
            await asyncio.sleep(0)

        if last_price is None:
            state.message = "No price data available."
            state.status = TaskStatus.FAILED
            return

        final_equity = cash + position * last_price
        returns = (final_equity - request.initial_capital) / request.initial_capital
        max_drawdown = self._calculate_max_drawdown(equity_curve)
        win_rate = wins / total_trades if total_trades else 0.0
        profit_factor = (win_amount / loss_amount) if loss_amount > 0 else float("inf")

        metrics = {
            "final_equity": final_equity,
            "total_return": returns,
            "annualized_return": returns * (365 * 24 * 60 * 60 / request.signal_frequency_seconds),
            "max_drawdown": max_drawdown,
            "win_rate": win_rate,
            "total_trades": total_trades,
            "profit_factor": profit_factor,
        }
        state.metrics = metrics
        state.status = TaskStatus.COMPLETED

    def _load_data_series(self, data_id: str):
        try:
            return DATA_REPOSITORY.get_series(data_id)
        except FileNotFoundError:
            return DATA_TASKS.get_data_series(data_id)

    def _calculate_max_drawdown(self, equity_curve: List[float]) -> float:
        peak = -float("inf")
        max_drawdown = 0.0
        for value in equity_curve:
            peak = max(peak, value)
            if peak > 0:
                drawdown = (peak - value) / peak
                max_drawdown = max(max_drawdown, drawdown)
        return max_drawdown

    def list_tasks(self) -> List[BacktestTaskInfo]:
        return [self.describe_task(task_id) for task_id in self.tasks]

    def describe_task(self, task_id: str) -> BacktestTaskInfo:
        state = self.tasks[task_id]
        scheduled = SCHEDULER.get(task_id)
        status = scheduled.status.value if scheduled else state.status.value
        return BacktestTaskInfo(
            task_id=task_id,
            status=status,
            created_at=state.created_at,
            started_at=state.started_at,
            finished_at=state.finished_at,
            config=state.request.dict(),
            metrics=state.metrics,
            log_path=str(state.log_path),
            message=state.message,
            trades=[entry.__dict__ for entry in state.trades] if state.trades else None,
        )

    def pause(self, task_id: str) -> BacktestTaskInfo:
        SCHEDULER.pause(task_id)
        state = self.tasks[task_id]
        state.status = TaskStatus.PAUSED
        return self.describe_task(task_id)

    def resume(self, task_id: str) -> BacktestTaskInfo:
        SCHEDULER.resume(task_id)
        state = self.tasks[task_id]
        state.status = TaskStatus.RUNNING
        return self.describe_task(task_id)

    def stop(self, task_id: str) -> BacktestTaskInfo:
        SCHEDULER.stop(task_id)
        state = self.tasks[task_id]
        state.status = TaskStatus.STOPPED
        return self.describe_task(task_id)

    def delete(self, task_id: str) -> None:
        SCHEDULER.remove(task_id)
        state = self.tasks.pop(task_id, None)
        if state and state.log_path.exists():
            state.log_path.unlink()


BACKTEST_MANAGER = BacktestManager(CONFIG.log_storage_path / "backtests")

