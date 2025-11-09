from __future__ import annotations

from abc import ABC, abstractmethod
from collections import deque
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Deque, Dict, List, Type

from app.models import SignalType, StrategyMetadata, StrategyParameter, StrategySignal


class Strategy(ABC):
    strategy_id: str
    name: str
    description: str

    def __init__(self, **parameters: Any) -> None:
        self.parameters = self.get_default_parameters()
        for key, value in parameters.items():
            if key in self.parameters:
                self.parameters[key] = value
        self._history: Deque[float] = deque()

    @classmethod
    @abstractmethod
    def parameter_definitions(cls) -> List[StrategyParameter]:
        raise NotImplementedError

    def get_default_parameters(self) -> Dict[str, Any]:
        return {param.name: param.default for param in self.parameter_definitions()}

    def reset(self) -> None:
        self._history.clear()

    def record_price(self, price: float, window: int | None = None) -> None:
        self._history.append(price)
        if window is not None:
            while len(self._history) > window:
                self._history.popleft()

    @abstractmethod
    def generate_signal(self, price: float, timestamp: datetime) -> StrategySignal:
        raise NotImplementedError

    @classmethod
    def metadata(cls) -> StrategyMetadata:
        return StrategyMetadata(
            strategy_id=cls.strategy_id,
            name=cls.name,
            description=cls.description,
            parameters=cls.parameter_definitions(),
        )


class StrategyRegistry:
    def __init__(self) -> None:
        self._strategies: Dict[str, Type[Strategy]] = {}

    def register(self, strategy_cls: Type[Strategy]) -> None:
        self._strategies[strategy_cls.strategy_id] = strategy_cls

    def list(self) -> List[StrategyMetadata]:
        return [cls.metadata() for cls in self._strategies.values()]

    def get(self, strategy_id: str) -> Type[Strategy]:
        if strategy_id not in self._strategies:
            raise KeyError(f"Strategy {strategy_id} is not registered.")
        return self._strategies[strategy_id]


STRATEGY_REGISTRY = StrategyRegistry()

