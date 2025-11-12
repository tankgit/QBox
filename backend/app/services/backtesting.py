from __future__ import annotations

import asyncio
import json
import csv
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

from app.config import CONFIG
from app.models import BacktestRequest, BacktestTaskInfo, SignalType, StrategySignal, CommissionType
from app.services.data_generation import DATA_REPOSITORY
from app.services.data_tasks import DATA_TASKS
from app.services.strategies import STRATEGY_REGISTRY, Strategy
from app.utils.id_generator import generate_id
from app.utils.scheduler import SCHEDULER, TaskStatus
from pydantic import ValidationError


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
        self._load_existing_tasks()

    def _meta_path(self, task_id: str) -> Path:
        return self.log_dir / f"{task_id}.meta.json"

    def _parse_datetime(self, value: Optional[str]) -> Optional[datetime]:
        if not value:
            return None
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            return None

    def _recalculate_metrics(self, request: BacktestRequest, trades: List[TradeLogEntry]) -> Dict[str, float]:
        if not trades:
            return {
                "final_equity": request.initial_capital,
                "total_return": 0.0,
                "annualized_return": 0.0,
                "max_drawdown": 0.0,
                "win_rate": 0.0,
                "total_trades": 0,
                "profit_factor": float("inf"),
            }

        equity_curve: List[float] = [request.initial_capital]
        max_equity = request.initial_capital
        wins = 0
        losses = 0
        win_amount = 0.0
        loss_amount = 0.0

        for entry in trades:
            equity = entry.value
            equity_curve.append(equity)
            pnl = equity - max_equity
            if pnl >= 0:
                wins += 1
                win_amount += pnl
            else:
                losses += 1
                loss_amount += abs(pnl)
            max_equity = max(max_equity, equity)

        final_equity = trades[-1].value
        returns = (final_equity - request.initial_capital) / request.initial_capital
        signal_frequency = max(request.signal_frequency_seconds, 1)
        annualized_return = returns * (365 * 24 * 60 * 60 / signal_frequency)
        win_rate = wins / len(trades) if trades else 0.0
        profit_factor = (win_amount / loss_amount) if loss_amount > 0 else float("inf")

        return {
            "final_equity": final_equity,
            "total_return": returns,
            "annualized_return": annualized_return,
            "max_drawdown": self._calculate_max_drawdown(equity_curve),
            "win_rate": win_rate,
            "total_trades": len(trades),
            "profit_factor": profit_factor,
        }

    def _persist_task_state(self, state: BacktestTaskState) -> None:
        meta = {
            "task_id": state.task_id,
            "status": state.status.value,
            "created_at": state.created_at.isoformat(),
            "started_at": state.started_at.isoformat() if state.started_at else None,
            "finished_at": state.finished_at.isoformat() if state.finished_at else None,
            "config": state.request.dict(),
            "metrics": state.metrics,
            "message": state.message,
        }
        try:
            with self._meta_path(state.task_id).open("w", encoding="utf-8") as fp:
                json.dump(meta, fp)
        except OSError:
            pass

    def _load_existing_tasks(self) -> None:
        meta_map: Dict[str, dict] = {}
        for meta_path in sorted(self.log_dir.glob("*.meta.json")):
            try:
                with meta_path.open("r", encoding="utf-8") as fp:
                    meta = json.load(fp)
            except (OSError, json.JSONDecodeError):
                continue

            task_id = meta.get("task_id")
            if not task_id:
                name = meta_path.name
                if name.endswith(".meta.json"):
                    task_id = name[: -len(".meta.json")]
                else:
                    continue
            meta_map[task_id] = meta

        processed: set[str] = set()

        for task_id, meta in meta_map.items():
            config_data = meta.get("config")
            if not config_data:
                continue
            try:
                request = BacktestRequest(**config_data)
            except ValidationError:
                continue

            log_path = self.log_dir / f"{task_id}.log"
            trades: List[TradeLogEntry] = []
            if log_path.exists():
                try:
                    with log_path.open("r", encoding="utf-8") as fp:
                        first_line = fp.readline()
                        if not first_line:
                            continue
                        fp.readline()
                        reader = csv.reader(fp)
                        for row in reader:
                            if len(row) != 7:
                                continue
                            timestamp, action, price, quantity, cash, position, value = row
                            trades.append(
                                TradeLogEntry(
                                    timestamp=timestamp,
                                    action=action,
                                    price=float(price),
                                    quantity=float(quantity),
                                    cash=float(cash),
                                    position=float(position),
                                    value=float(value),
                                )
                            )
                except (OSError, ValueError):
                    trades = []

            metrics = meta.get("metrics")
            if metrics is None and trades:
                metrics = self._recalculate_metrics(request, trades)

            status_value = meta.get("status", TaskStatus.PAUSED.value)
            try:
                status = TaskStatus(status_value)
            except ValueError:
                status = TaskStatus.PAUSED

            created_at = self._parse_datetime(meta.get("created_at"))
            started_at = self._parse_datetime(meta.get("started_at"))
            finished_at = self._parse_datetime(meta.get("finished_at"))

            if not created_at and log_path.exists():
                stat = log_path.stat()
                created_at = datetime.fromtimestamp(stat.st_ctime, tz=timezone.utc)
                finished_at = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc)
                if trades and not started_at:
                    started_at = created_at

            # 如果任务状态是running但log文件不存在或没有交易记录，说明任务可能已经失败或完成
            # 如果log文件存在且有交易记录，说明任务已完成
            if status == TaskStatus.RUNNING:
                if not log_path.exists():
                    # 日志文件不存在，任务可能从未开始或已失败
                    status = TaskStatus.FAILED
                    if not finished_at:
                        finished_at = datetime.now(timezone.utc)
                elif trades:
                    # 有交易记录，说明任务已完成
                    status = TaskStatus.COMPLETED
                    if not finished_at:
                        finished_at = datetime.now(timezone.utc)

            state = BacktestTaskState(
                task_id=task_id,
                request=request,
                status=status,
                created_at=created_at or datetime.now(timezone.utc),
                started_at=started_at,
                finished_at=finished_at,
                metrics=metrics,
                message=meta.get("message"),
                log_path=log_path,
                trades=trades,
            )
            self.tasks[task_id] = state
            processed.add(task_id)

        for log_path in sorted(self.log_dir.glob("*.log")):
            task_id = log_path.stem
            if task_id in processed:
                continue

            try:
                with log_path.open("r", encoding="utf-8") as fp:
                    first_line = fp.readline().strip()
                    if not first_line:
                        continue
                    config_data = json.loads(first_line)
                    request = BacktestRequest(**config_data)
                    fp.readline()
                    trades: List[TradeLogEntry] = []
                    reader = csv.reader(fp)
                    for row in reader:
                        if len(row) != 7:
                            continue
                        timestamp, action, price, quantity, cash, position, value = row
                        trades.append(
                            TradeLogEntry(
                                timestamp=timestamp,
                                action=action,
                                price=float(price),
                                quantity=float(quantity),
                                cash=float(cash),
                                position=float(position),
                                value=float(value),
                            )
                        )
            except (OSError, json.JSONDecodeError, ValidationError, ValueError):
                continue

            stat = log_path.stat()
            created_at = datetime.fromtimestamp(stat.st_ctime, tz=timezone.utc)
            finished_at = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc)
            status = TaskStatus.COMPLETED if trades else TaskStatus.PAUSED
            metrics = self._recalculate_metrics(request, trades) if trades else None

            state = BacktestTaskState(
                task_id=task_id,
                request=request,
                status=status,
                created_at=created_at,
                started_at=created_at if trades else None,
                finished_at=finished_at if trades else None,
                metrics=metrics,
                log_path=log_path,
                trades=trades,
            )
            self.tasks[task_id] = state

    def create_task(self, request: BacktestRequest) -> BacktestTaskInfo:
        task_id = generate_id("test_")
        state = BacktestTaskState(
            task_id=task_id,
            request=request,
            status=TaskStatus.RUNNING,
            log_path=self.log_dir / f"{task_id}.log",
        )
        self.tasks[task_id] = state
        self._persist_task_state(state)

        async def runner() -> None:
            state.started_at = _now()
            await self._run_backtest(state)
            state.finished_at = _now()
            self._persist_task_state(state)

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

        if not series.data:
            state.message = "Data series is empty."
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

        # 用于跟踪上次信号生成的时间
        last_signal_time: Optional[datetime] = None

        # 创建信号日志文件路径（在交易日志旁边）
        signal_log_path = state.log_path.parent / f"{state.log_path.stem}.signals.csv"

        with state.log_path.open("w", encoding="utf-8") as fp:
            fp.write(json.dumps(request.dict()) + "\n")
            fp.write("timestamp,action,price,quantity,cash,position,value\n")
        
        # 创建信号日志文件
        with signal_log_path.open("w", encoding="utf-8") as fp:
            fp.write("timestamp,price,signal_type,strength,should_generate,strategy_state\n")

        for row in series.data:
            timestamp_str = row.get("timestamp")
            if not timestamp_str:
                continue
            
            # 解析时间戳，支持多种格式
            timestamp = None
            try:
                # 尝试标准ISO格式（带时区）
                timestamp = datetime.fromisoformat(timestamp_str)
            except (ValueError, TypeError):
                try:
                    # 尝试简单格式（不带时区和毫秒），假设为UTC
                    # 格式如：2025-11-10T14:37:10
                    if 'T' in timestamp_str and '+' not in timestamp_str and 'Z' not in timestamp_str:
                        # 移除可能的毫秒部分
                        if '.' in timestamp_str:
                            timestamp_str = timestamp_str.split('.')[0]
                        timestamp = datetime.fromisoformat(timestamp_str).replace(tzinfo=timezone.utc)
                    else:
                        # 如果都不匹配，跳过这个数据点
                        continue
                except (ValueError, TypeError):
                    # 如果都失败，跳过这个数据点
                    continue
            
            if timestamp is None:
                continue
            
            price = float(row.get("price", 0.0))
            if price <= 0:
                continue
            
            last_price = price

            # 根据信号频率判断是否需要生成信号
            # 如果设置了信号频率，需要检查时间间隔
            should_generate_signal = True
            if last_signal_time is not None and request.signal_frequency_seconds > 0:
                time_diff = (timestamp - last_signal_time).total_seconds()
                if time_diff < request.signal_frequency_seconds:
                    should_generate_signal = False
            
            # 重要：策略需要每个价格点来更新其内部状态（如价格历史、previous_spread等）
            # 我们总是调用generate_signal来更新策略状态，但只在满足信号频率时使用信号结果
            # 这样策略的状态会正确维护，即使信号频率设置得很大
            
            # 总是调用generate_signal来更新策略状态
            strategy_signal: StrategySignal = strategy.generate_signal(price, timestamp)
            
            # 收集策略状态信息用于日志
            strategy_state_info = ""
            if hasattr(strategy, 'price_history'):
                price_history_len = len(strategy.price_history) if hasattr(strategy.price_history, '__len__') else 0
                if hasattr(strategy, '_previous_spread'):
                    prev_spread = strategy._previous_spread
                    strategy_state_info = f"history_len={price_history_len},prev_spread={prev_spread:.6f}" if prev_spread is not None else f"history_len={price_history_len},prev_spread=None"
                else:
                    strategy_state_info = f"history_len={price_history_len}"
            
            # 记录信号日志
            with signal_log_path.open("a", encoding="utf-8") as fp:
                fp.write(
                    f"{timestamp_str},{price:.4f},{strategy_signal.signal.value},{strategy_signal.strength:.6f},{should_generate_signal},{strategy_state_info}\n"
                )
            
            if should_generate_signal:
                # 使用策略生成的信号
                signal = strategy_signal
                last_signal_time = timestamp
            else:
                # 不生成新信号，忽略策略信号，返回HOLD
                # 但策略状态已经通过上面的generate_signal调用更新了
                signal = StrategySignal(
                    timestamp=timestamp,
                    signal=SignalType.HOLD,
                    strength=0.0,
                    price=price
                )

            # 更新权益曲线（每个数据点都更新）
            equity = cash + position * price
            equity_curve.append(equity)
            max_equity = max(max_equity, equity)

            if signal.signal == SignalType.HOLD:
                continue

            # 信号强度作为百分比系数（0-1），用于计算实际交易数量
            signal_strength = abs(signal.strength)
            if signal_strength <= 0:
                continue
            
            # 计算当前总资产价值
            total_equity = cash + position * price
            
            # 计算基于资产价值的最大可持仓数量
            # 最大可持仓数量 = 总资产价值 / 当前价格
            max_affordable_position_qty = total_equity / price if price > 0 else 0.0
            
            # 计算实际的最大和最小持仓数量（基于比率）
            actual_max_position = max_affordable_position_qty * request.max_position
            actual_min_position = max_affordable_position_qty * request.min_position
            
            trade_qty = 0.0
            action = "hold"

            if signal.signal == SignalType.BUY:
                # 1. 计算基于可用资金的最大可买入数量
                # 最大可买入数量（基于现金）= 可用现金 / 当前价格
                max_buyable_by_cash = cash / price if price > 0 else 0.0
                
                # 2. 计算基于最大持仓比率的允许买入数量
                # 最大允许持仓数量 = 总资产价值 * max_position / 当前价格
                # 最大允许买入数量 = 最大允许持仓数量 - 当前持仓
                max_allowed_position = actual_max_position
                max_allowed_buy = max_allowed_position - position
                
                # 3. 取两者较小值作为最大可买入数量
                max_buyable_qty = min(max_buyable_by_cash, max_allowed_buy)
                
                # 如果最大可买入数量 <= 0，无法交易
                if max_buyable_qty <= 0:
                    continue
                
                # 4. 根据信号强度计算目标交易数量：目标数量 = 信号强度 * 最大可买入数量
                target_qty = signal_strength * max_buyable_qty
                
                # 5. 将目标数量向下取整到lot_size的整数倍
                target_lots = int(target_qty / request.lot_size)
                proposed_qty = target_lots * request.lot_size
                
                # 6. 如果计算出的数量为0或小于lot_size，不交易
                if proposed_qty < request.lot_size:
                    continue
                
                # 7. 确保不超过最大可买入数量（再次检查）
                if proposed_qty > max_buyable_qty:
                    # 向下取整到不超过最大可买入数量
                    max_lots = int(max_buyable_qty / request.lot_size)
                    proposed_qty = max_lots * request.lot_size
                    if proposed_qty < request.lot_size:
                        continue
                
                # 8. 计算交易后的持仓
                proposed_position = position + proposed_qty
                
                # 9. 检查交易后持仓是否在实际最小和最大持仓范围内
                if proposed_position < actual_min_position or proposed_position > actual_max_position:
                    continue
                
                # 10. 计算交易金额和手续费
                trade_qty = proposed_qty
                trade_amount = trade_qty * price
                commission = self._calculate_commission(request, trade_amount)
                
                # 11. 检查扣除手续费后是否有足够现金
                total_cost = trade_amount + commission
                if total_cost > cash:
                    # 如果手续费导致资金不足，需要重新计算可买入数量
                    # 对于固定手续费，先扣除手续费再计算可买入数量
                    # 对于比率手续费，需要迭代计算（简化处理：先估算）
                    if request.commission_type == CommissionType.FIXED:
                        available_cash = cash - request.commission_value
                    else:
                        # 比率手续费：先估算，如果不够再调整
                        estimated_ratio = request.commission_value
                        # 简化：假设手续费不超过成交额的某个比例，先预留一部分
                        available_cash = cash / (1 + estimated_ratio)
                    
                    if available_cash <= 0:
                        continue
                    max_affordable_qty = available_cash / price
                    max_lots = int(max_affordable_qty / request.lot_size)
                    trade_qty = max_lots * request.lot_size
                    if trade_qty < request.lot_size:
                        continue
                    trade_amount = trade_qty * price
                    commission = self._calculate_commission(request, trade_amount)
                    total_cost = trade_amount + commission
                    # 再次检查是否足够
                    if total_cost > cash:
                        continue
                
                # 12. 执行买入交易
                cash -= total_cost
                position += trade_qty
                action = "buy"
                
            elif signal.signal == SignalType.SELL:
                # 1. 计算可卖出的最大数量（基于当前持仓）
                # 卖出数量不能超过当前持仓
                max_sellable_by_position = position
                
                # 2. 计算基于最小持仓比率的允许卖出数量
                # 最小允许持仓数量 = 总资产价值 * min_position / 当前价格
                # 最大允许卖出数量 = 当前持仓 - 最小允许持仓数量
                min_allowed_position = actual_min_position
                max_allowed_sell = position - min_allowed_position
                
                # 3. 取两者较小值作为最大可卖出数量
                max_sellable_qty = min(max_sellable_by_position, max_allowed_sell)
                
                # 如果最大可卖出数量 <= 0，无法交易
                if max_sellable_qty <= 0:
                    continue
                
                # 4. 根据信号强度计算目标交易数量：目标数量 = 信号强度 * 最大可卖出数量
                target_qty = signal_strength * max_sellable_qty
                
                # 5. 将目标数量向下取整到lot_size的整数倍
                target_lots = int(target_qty / request.lot_size)
                proposed_qty = target_lots * request.lot_size
                
                # 6. 如果计算出的数量为0或小于lot_size，不交易
                if proposed_qty < request.lot_size:
                    continue
                
                # 7. 确保不超过最大可卖出数量（再次检查）
                if proposed_qty > max_sellable_qty:
                    # 向下取整到不超过最大可卖出数量
                    max_lots = int(max_sellable_qty / request.lot_size)
                    proposed_qty = max_lots * request.lot_size
                    if proposed_qty < request.lot_size:
                        continue
                
                # 8. 最终安全检查：确保卖出数量不超过当前持仓
                if proposed_qty > position:
                    max_lots = int(position / request.lot_size)
                    proposed_qty = max_lots * request.lot_size
                    if proposed_qty < request.lot_size:
                        continue
                
                # 9. 计算交易后的持仓
                proposed_position = position - proposed_qty
                
                # 10. 检查交易后持仓是否在实际最小和最大持仓范围内
                if proposed_position < actual_min_position or proposed_position > actual_max_position:
                    continue
                
                # 11. 计算交易金额和手续费
                trade_qty = proposed_qty
                trade_amount = trade_qty * price
                commission = self._calculate_commission(request, trade_amount)
                
                # 12. 执行卖出交易（手续费从卖出金额中扣除）
                cash += trade_amount - commission
                position -= trade_qty
                action = "sell"

            # 如果执行了交易，记录交易日志
            if trade_qty > 0 and action != "hold":
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
                    timestamp=timestamp_str,
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
                        f"{timestamp_str},{action},{price:.4f},{trade_qty:.4f},{cash:.2f},{position:.4f},{value:.2f}\n"
                    )
            
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
        self._persist_task_state(state)

    def _load_data_series(self, data_id: str):
        try:
            return DATA_REPOSITORY.get_series(data_id)
        except FileNotFoundError:
            return DATA_TASKS.get_data_series(data_id)

    def _calculate_commission(self, request: BacktestRequest, trade_amount: float) -> float:
        """计算手续费
        
        Args:
            request: 回测请求配置
            trade_amount: 交易金额（成交额）
        
        Returns:
            手续费金额
        """
        if request.commission_type == CommissionType.FIXED:
            return request.commission_value
        elif request.commission_type == CommissionType.RATIO:
            commission = trade_amount * request.commission_value
            if request.commission_max is not None:
                commission = min(commission, request.commission_max)
            return commission
        return 0.0

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
        """列出所有任务，自动过滤掉已删除或无效的任务"""
        result: List[BacktestTaskInfo] = []
        invalid_task_ids: List[str] = []
        
        for task_id in list(self.tasks.keys()):
            try:
                task_info = self.describe_task(task_id)
                result.append(task_info)
            except (KeyError, FileNotFoundError):
                # 任务已被删除或无效，从内存中移除
                invalid_task_ids.append(task_id)
            except Exception:  # noqa: BLE001
                # 其他异常，记录但继续处理其他任务
                invalid_task_ids.append(task_id)
        
        # 清理无效的任务
        for task_id in invalid_task_ids:
            self.tasks.pop(task_id, None)
        
        return result

    def describe_task(self, task_id: str) -> BacktestTaskInfo:
        state = self.tasks[task_id]
        scheduled = SCHEDULER.get(task_id)
        status = scheduled.status.value if scheduled else state.status.value
        
        # 获取数据的symbol信息
        data_symbol = "unknown"
        try:
            series = self._load_data_series(state.request.data_id)
            data_symbol = series.symbol
        except (FileNotFoundError, Exception):
            pass
        
        config_dict = state.request.dict()
        # 在config中添加数据的symbol信息，方便前端显示
        config_dict["data_symbol"] = data_symbol
        
        return BacktestTaskInfo(
            task_id=task_id,
            status=status,
            created_at=state.created_at,
            started_at=state.started_at,
            finished_at=state.finished_at,
            config=config_dict,
            metrics=state.metrics,
            log_path=str(state.log_path),
            message=state.message,
            trades=[entry.__dict__ for entry in state.trades] if state.trades else None,
        )

    def pause(self, task_id: str) -> BacktestTaskInfo:
        if task_id not in self.tasks:
            raise KeyError(f"Task {task_id} not found")
        
        # 如果任务在SCHEDULER中，尝试暂停它
        scheduled = SCHEDULER.get(task_id)
        if scheduled is not None:
            SCHEDULER.pause(task_id)
        
        state = self.tasks[task_id]
        state.status = TaskStatus.PAUSED
        self._persist_task_state(state)
        return self.describe_task(task_id)

    def resume(self, task_id: str) -> BacktestTaskInfo:
        if task_id not in self.tasks:
            raise KeyError(f"Task {task_id} not found")
        
        # 如果任务在SCHEDULER中，尝试恢复它
        scheduled = SCHEDULER.get(task_id)
        if scheduled is not None:
            SCHEDULER.resume(task_id)
        
        state = self.tasks[task_id]
        state.status = TaskStatus.RUNNING
        self._persist_task_state(state)
        return self.describe_task(task_id)

    def stop(self, task_id: str) -> BacktestTaskInfo:
        if task_id not in self.tasks:
            raise KeyError(f"Task {task_id} not found")
        
        # 如果任务在SCHEDULER中，尝试停止它
        scheduled = SCHEDULER.get(task_id)
        if scheduled is not None:
            SCHEDULER.stop(task_id)
        
        state = self.tasks[task_id]
        state.status = TaskStatus.STOPPED
        self._persist_task_state(state)
        return self.describe_task(task_id)

    def delete(self, task_id: str) -> None:
        SCHEDULER.remove(task_id)
        state = self.tasks.pop(task_id, None)
        if state and state.log_path.exists():
            state.log_path.unlink()
        meta_path = self._meta_path(task_id)
        if meta_path.exists():
            meta_path.unlink()


BACKTEST_MANAGER = BacktestManager(CONFIG.log_storage_path / "backtests")

