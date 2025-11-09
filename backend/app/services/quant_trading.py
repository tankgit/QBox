from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

from app.config import CONFIG
from app.models import QuantTaskInfo, QuantTaskRequest, SignalType, StrategySignal
from app.services.longport_client import LONGPORT_CLIENT, MissingCredentialsError
from app.services.strategies.base import STRATEGY_REGISTRY, Strategy
from app.utils.id_generator import generate_id
from app.utils.scheduler import SCHEDULER, TaskStatus


def _now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class QuantTaskState:
    task_id: str
    request: QuantTaskRequest
    status: TaskStatus = TaskStatus.PAUSED
    created_at: datetime = field(default_factory=_now)
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    config: Dict[str, object] = field(default_factory=dict)
    message: Optional[str] = None
    log_path: Path = field(default_factory=Path)
    latest_metrics: Dict[str, float] = field(default_factory=dict)
    logs: List[Dict[str, object]] = field(default_factory=list)
    price_history: List[Dict[str, object]] = field(default_factory=list)


class QuantTradingManager:
    def __init__(self, log_dir: Path) -> None:
        self.log_dir = log_dir
        self.log_dir.mkdir(parents=True, exist_ok=True)
        self.tasks: Dict[str, QuantTaskState] = {}

    def create_task(self, request: QuantTaskRequest) -> QuantTaskInfo:
        self._ensure_credentials(request.account_mode)
        task_id = generate_id("quant_")
        state = QuantTaskState(
            task_id=task_id,
            request=request,
            status=TaskStatus.RUNNING,
            log_path=self.log_dir / f"{task_id}.log",
        )
        self.tasks[task_id] = state

        async def runner() -> None:
            state.started_at = _now()
            await self._run_quant(state)
            state.finished_at = _now()

        SCHEDULER.create(task_id, runner)
        return self.describe_task(task_id)

    def _ensure_credentials(self, mode: str) -> None:
        creds = CONFIG.paper_credentials if mode == "paper" else CONFIG.live_credentials
        if creds is None:
            raise MissingCredentialsError(f"{mode.title()} account credentials are not configured.")

    async def _run_quant(self, state: QuantTaskState) -> None:
        request = state.request
        strategy_cls = STRATEGY_REGISTRY.get(request.strategy_id)
        strategy: Strategy = strategy_cls(**request.strategy_params)
        cash = await self._fetch_available_cash(request.account_mode)
        position = await self._fetch_position(request.account_mode, request.symbol)
        last_price: Optional[float] = None
        realized_pnl = 0.0

        with state.log_path.open("w", encoding="utf-8") as fp:
            fp.write(json.dumps(request.dict()) + "\n")
            fp.write("timestamp,price,action,quantity,cash,position,realized_pnl\n")

        try:
            while True:
                price = await self._fetch_symbol_price(request.symbol, request.account_mode)
                timestamp = _now().isoformat()
                last_price = price
                signal: StrategySignal = strategy.generate_signal(price, _now())

                action = "hold"
                quantity = 0.0

                if signal.signal == SignalType.BUY:
                    trade_qty = self._calculate_quantity(signal.strength, price, cash, request.lot_size)
                    if trade_qty > 0:
                        executed = await self._execute_trade(
                            request.account_mode, request.symbol, "buy", trade_qty, price
                        )
                        if executed:
                            cash -= trade_qty * price
                            position += trade_qty
                            action = "buy"
                            quantity = trade_qty
                elif signal.signal == SignalType.SELL:
                    trade_qty = min(position, self._calculate_quantity(abs(signal.strength), price, position, request.lot_size))
                    if trade_qty > 0:
                        executed = await self._execute_trade(
                            request.account_mode, request.symbol, "sell", trade_qty, price
                        )
                        if executed:
                            cash += trade_qty * price
                            position -= trade_qty
                            action = "sell"
                            quantity = trade_qty
                            realized_pnl += trade_qty * price

                state.latest_metrics = {
                    "cash": cash,
                    "position": position,
                    "last_price": price,
                    "market_value": position * price,
                    "equity": cash + position * price,
                    "realized_pnl": realized_pnl,
                }
                if action != "hold" and quantity > 0:
                    entry = {
                        "timestamp": timestamp,
                        "action": action,
                        "price": price,
                        "quantity": quantity,
                        "cash": cash,
                        "position": position,
                        "realized_pnl": realized_pnl,
                    }
                    state.logs.append(entry)
                    if len(state.logs) > 200:
                        state.logs.pop(0)
                with state.log_path.open("a", encoding="utf-8") as fp:
                    fp.write(
                        f"{timestamp},{price:.4f},{action},{quantity:.4f},{cash:.2f},{position:.4f},{realized_pnl:.2f}\n"
                    )
                state.price_history.append({"timestamp": timestamp, "price": price})
                if len(state.price_history) > 300:
                    state.price_history.pop(0)
                await asyncio.sleep(request.interval_seconds)
        except asyncio.CancelledError:
            raise
        except MissingCredentialsError as exc:
            state.message = str(exc)
            state.status = TaskStatus.FAILED
        except Exception as exc:  # noqa: BLE001
            state.message = str(exc)
            state.status = TaskStatus.FAILED
        finally:
            state.status = TaskStatus.STOPPED if state.status == TaskStatus.RUNNING else state.status

    async def _fetch_available_cash(self, mode: str) -> float:
        def fetch() -> float:
            with LONGPORT_CLIENT.trade_context(mode) as ctx:
                account = ctx.account_balance()
                if hasattr(account, "cash"):
                    return float(account.cash)
                if hasattr(account, "available_cash"):
                    return float(account.available_cash)
                return 1_000_000.0

        try:
            return await asyncio.to_thread(fetch)
        except MissingCredentialsError:
            raise
        except Exception:
            return 1_000_000.0

    async def _fetch_position(self, mode: str, symbol: str) -> float:
        def fetch() -> float:
            with LONGPORT_CLIENT.trade_context(mode) as ctx:
                positions = ctx.stock_position()
                for pos in positions:
                    if getattr(pos, "symbol", "") == symbol:
                        return float(getattr(pos, "quantity", 0.0))
                return 0.0

        try:
            return await asyncio.to_thread(fetch)
        except MissingCredentialsError:
            raise
        except Exception:
            return 0.0

    async def _fetch_symbol_price(self, symbol: str, mode: str) -> float:
        def fetch() -> float:
            with LONGPORT_CLIENT.quote_context(mode) as ctx:
                quotes = ctx.quote([symbol])
                if quotes:
                    quote = quotes[0]
                    if getattr(quote, "last_done", None) and getattr(quote.last_done, "price", None):
                        return float(quote.last_done.price)
                    if getattr(quote, "last", None) is not None:
                        return float(quote.last)
                raise RuntimeError("Unable to fetch price for symbol.")

        try:
            return await asyncio.to_thread(fetch)
        except MissingCredentialsError:
            raise
        except Exception as exc:
            raise RuntimeError("Unable to fetch price for symbol.") from exc

    def _calculate_quantity(self, strength: float, price: float, basis: float, lot_size: float) -> float:
        scaled = max(0.0, min(1.0, abs(strength)))
        target_value = basis * scaled
        lots = max(1, int(target_value // (price * lot_size)))
        return lots * lot_size

    async def _execute_trade(self, mode: str, symbol: str, side: str, quantity: float, price: float) -> bool:
        def submit() -> bool:
            with LONGPORT_CLIENT.trade_context(mode) as ctx:
                ctx.submit_order(symbol=symbol, side=side.upper(), quantity=quantity, price=price)
            return True

        try:
            return await asyncio.to_thread(submit)
        except MissingCredentialsError:
            raise
        except Exception:
            # Fallback for development without live trading permissions
            return True

    def list_tasks(self) -> List[QuantTaskInfo]:
        return [self.describe_task(task_id) for task_id in self.tasks]

    def describe_task(self, task_id: str) -> QuantTaskInfo:
        state = self.tasks[task_id]
        scheduled = SCHEDULER.get(task_id)
        status = scheduled.status.value if scheduled else state.status.value
        config = state.request.dict()
        config.update(state.latest_metrics)
        return QuantTaskInfo(
            task_id=task_id,
            status=status,
            created_at=state.created_at,
            started_at=state.started_at,
            finished_at=state.finished_at,
            config=config,
            log_path=str(state.log_path),
            message=state.message,
            logs=state.logs if state.logs else None,
            price_series=state.price_history if state.price_history else None,
        )

    def pause(self, task_id: str) -> QuantTaskInfo:
        SCHEDULER.pause(task_id)
        state = self.tasks[task_id]
        state.status = TaskStatus.PAUSED
        return self.describe_task(task_id)

    def resume(self, task_id: str) -> QuantTaskInfo:
        SCHEDULER.resume(task_id)
        state = self.tasks[task_id]
        state.status = TaskStatus.RUNNING
        return self.describe_task(task_id)

    def stop(self, task_id: str) -> QuantTaskInfo:
        SCHEDULER.stop(task_id)
        state = self.tasks[task_id]
        state.status = TaskStatus.STOPPED
        return self.describe_task(task_id)

    def delete(self, task_id: str) -> None:
        SCHEDULER.remove(task_id)
        state = self.tasks.pop(task_id, None)
        if state and state.log_path.exists():
            state.log_path.unlink()


QUANT_MANAGER = QuantTradingManager(CONFIG.log_storage_path / "quant")

