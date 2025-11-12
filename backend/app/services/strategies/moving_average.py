from __future__ import annotations

from collections import deque
from datetime import datetime
from statistics import mean
from typing import Deque

from app.models import SignalType, StrategyParameter, StrategySignal
from app.services.strategies.base import STRATEGY_REGISTRY, Strategy


class MovingAverageStrategy(Strategy):
    strategy_id = "ma_crossover"
    name = "移动平均交叉策略"
    description = (
        "基于短期与长期移动平均线的交叉进行交易，当短期均线突破长期均线时买入，反之卖出。"
    )

    def __init__(self, **parameters):
        super().__init__(**parameters)
        self.short_window = int(self.parameters["short_window"])
        self.long_window = int(self.parameters["long_window"])
        self.min_strength = float(self.parameters["min_strength"])
        self.price_history: Deque[float] = deque(maxlen=self.long_window)
        self._previous_spread: float | None = None

    @classmethod
    def parameter_definitions(cls) -> list[StrategyParameter]:
        return [
            StrategyParameter(
                name="short_window",
                parameter_type="int",
                description="短期均线窗口大小",
                default=5,
                minimum=2,
                maximum=50,
            ),
            StrategyParameter(
                name="long_window",
                parameter_type="int",
                description="长期均线窗口大小",
                default=20,
                minimum=5,
                maximum=200,
            ),
            StrategyParameter(
                name="min_strength",
                parameter_type="float",
                description="产生交易信号的最小强度阈值",
                default=0.05,
                minimum=0.0,
                maximum=1.0,
            ),
        ]

    def generate_signal(self, price: float, timestamp: datetime) -> StrategySignal:
        self.price_history.append(price)

        if len(self.price_history) < self.long_window:
            return StrategySignal(timestamp=timestamp, signal=SignalType.HOLD, strength=0.0, price=price)

        short_prices = list(self.price_history)[-self.short_window :]
        long_prices = list(self.price_history)

        short_avg = mean(short_prices)
        long_avg = mean(long_prices)
        spread = short_avg - long_avg
        normalized_strength = max(min(spread / long_avg, 1.0), -1.0)

        if abs(normalized_strength) < self.min_strength:
            signal = SignalType.HOLD
            strength = 0.0
        elif spread > 0:
            signal = SignalType.BUY
            strength = normalized_strength
        else:
            signal = SignalType.SELL
            strength = normalized_strength

        # 检查是否发生交叉，如果发生交叉，强制设置信号并确保强度不为0
        if self._previous_spread is not None:
            if spread > 0 >= self._previous_spread:
                # 从负变正，买入信号
                signal = SignalType.BUY
                # 使用normalized_strength，但如果太小，至少使用min_strength
                if abs(normalized_strength) < self.min_strength:
                    strength = self.min_strength
                else:
                    strength = normalized_strength
            elif spread < 0 <= self._previous_spread:
                # 从正变负，卖出信号
                signal = SignalType.SELL
                # 使用normalized_strength，但如果太小，至少使用min_strength（取负值）
                if abs(normalized_strength) < self.min_strength:
                    strength = -self.min_strength
                else:
                    strength = normalized_strength

        self._previous_spread = spread

        return StrategySignal(timestamp=timestamp, signal=signal, strength=strength, price=price)


STRATEGY_REGISTRY.register(MovingAverageStrategy)

