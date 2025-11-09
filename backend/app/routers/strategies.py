from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.models import StrategyMetadata
from app.services.strategies import STRATEGY_REGISTRY

router = APIRouter(prefix="/strategies", tags=["strategies"])


@router.get("/", response_model=list[StrategyMetadata])
def list_strategies() -> list[StrategyMetadata]:
    return STRATEGY_REGISTRY.list()


@router.get("/{strategy_id}", response_model=StrategyMetadata)
def get_strategy(strategy_id: str) -> StrategyMetadata:
    try:
        strategy_cls = STRATEGY_REGISTRY.get(strategy_id)
        return strategy_cls.metadata()
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

