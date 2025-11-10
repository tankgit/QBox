from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, root_validator, validator


class SignalType(str, Enum):
    BUY = "buy"
    SELL = "sell"
    HOLD = "hold"


class StrategySignal(BaseModel):
    timestamp: datetime
    signal: SignalType
    strength: float = Field(ge=-1.0, le=1.0)
    price: Optional[float] = None


class SimulatedDataRequest(BaseModel):
    symbol: str = Field(..., description="Ticker symbol")
    data_points: int = Field(default=500, ge=10, le=10000)
    start_price: float = Field(default=100.0, gt=0)
    end_price: float = Field(default=110.0, gt=0)
    mean_price: float = Field(default=105.0, gt=0)
    volatility_probability: float = Field(default=0.3, ge=0.0, le=1.0)
    volatility_magnitude: float = Field(default=2.0, ge=0.0)
    noise: float = Field(default=0.5, ge=0.0)
    uncertainty: float = Field(default=0.1, ge=0.0, le=1.0)
    seed: Optional[int] = None

    @validator("mean_price")
    def validate_mean(cls, value: float, values: Dict[str, Any]) -> float:
        start_price = values.get("start_price", value)
        end_price = values.get("end_price", value)
        if not (min(start_price, end_price) * 0.5 <= value <= max(start_price, end_price) * 1.5):
            raise ValueError("mean_price should be within a realistic range around start/end prices.")
        return value


class DataSeriesInfo(BaseModel):
    data_id: str
    symbol: str
    created_at: datetime
    source: str
    path: str
    config: Dict[str, Any]


class DataSeriesDetail(DataSeriesInfo):
    data: List[Dict[str, Any]]


class LiveDataTaskRequest(BaseModel):
    symbol: str
    session: str
    interval_seconds: int = Field(default=15, ge=1)
    duration_seconds: Optional[int] = Field(default=None, ge=1)
    is_permanent: bool = False
    max_points: Optional[int] = Field(default=None, ge=1)
    account_mode: str = Field(default="paper", pattern="^(paper|live)$")

    @root_validator(skip_on_failure=True)
    def validate_duration(cls, values: Dict[str, Any]) -> Dict[str, Any]:
        is_permanent = values.get("is_permanent", False)
        duration_seconds = values.get("duration_seconds")
        if is_permanent:
            values["duration_seconds"] = None
        elif duration_seconds is None:
            raise ValueError("duration_seconds must be provided when task is not permanent.")
        return values


class LiveDataTaskInfo(BaseModel):
    task_id: str
    symbol: str
    session: str
    interval_seconds: int
    duration_seconds: Optional[int]
    is_permanent: bool
    max_points: Optional[int]
    account_mode: str
    status: str
    created_at: datetime
    started_at: Optional[datetime]
    finished_at: Optional[datetime]
    data_id: Optional[str]
    message: Optional[str]
    dst_labels: Optional[Dict[str, str]] = None


class LiveSnapshotRequest(BaseModel):
    start_index: Optional[int] = Field(default=None, ge=0)
    end_index: Optional[int] = Field(default=None, ge=0)

    @root_validator(skip_on_failure=True)
    def validate_range(cls, values: Dict[str, Optional[int]]) -> Dict[str, Optional[int]]:
        start = values.get("start_index")
        end = values.get("end_index")
        if (start is None) != (end is None):
            raise ValueError("start_index and end_index must be provided together.")
        if start is not None and end is not None and start > end:
            raise ValueError("start_index must be less than or equal to end_index.")
        return values


class LiveDataSnapshotInfo(BaseModel):
    snapshot_id: str
    task_id: str
    data_id: str
    created_at: datetime
    path: str


class StrategyParameter(BaseModel):
    name: str
    parameter_type: str
    description: str
    default: Any
    minimum: Optional[float] = None
    maximum: Optional[float] = None


class StrategyMetadata(BaseModel):
    strategy_id: str
    name: str
    description: str
    parameters: List[StrategyParameter]


class BacktestRequest(BaseModel):
    data_id: str
    strategy_id: str
    strategy_params: Dict[str, Any] = Field(default_factory=dict)
    initial_capital: float = Field(default=100000.0, gt=0)
    min_position: float = Field(default=0.0, ge=0)
    max_position: float = Field(default=1.0, ge=0)
    lot_size: float = Field(default=1.0, gt=0)
    data_frequency_seconds: int = Field(default=60, ge=1)
    signal_frequency_seconds: int = Field(default=60, ge=1)


class BacktestTaskInfo(BaseModel):
    task_id: str
    status: str
    created_at: datetime
    started_at: Optional[datetime]
    finished_at: Optional[datetime]
    config: Dict[str, Any]
    metrics: Optional[Dict[str, Any]]
    log_path: Optional[str]
    message: Optional[str]
    trades: Optional[List[Dict[str, Any]]] = None


class QuantTaskRequest(BaseModel):
    strategy_id: str
    strategy_params: Dict[str, Any] = Field(default_factory=dict)
    symbol: str
    session: str
    account_mode: str = Field(default="paper")
    interval_seconds: int = Field(default=30, ge=1)
    lot_size: float = Field(default=1.0, gt=0)


class QuantTaskInfo(BaseModel):
    task_id: str
    status: str
    created_at: datetime
    started_at: Optional[datetime]
    finished_at: Optional[datetime]
    config: Dict[str, Any]
    log_path: Optional[str]
    message: Optional[str]
    logs: Optional[List[Dict[str, Any]]] = None
    price_series: Optional[List[Dict[str, Any]]] = None


class AccountSummary(BaseModel):
    account_mode: str
    equity: float
    cash_available: float
    positions: List[Dict[str, Any]]
    today_orders: List[Dict[str, Any]]

