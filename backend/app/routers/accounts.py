from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from app.models import AccountSummary
from app.services.account import fetch_account_summary
from app.services.longport_client import MissingCredentialsError

router = APIRouter(prefix="/accounts", tags=["accounts"])


@router.get("/{account_mode}", response_model=AccountSummary)
async def get_account(
    account_mode: str,
    currency: str | None = Query(default=None, description="Currency filter (e.g., HKD, USD)")
) -> AccountSummary:
    if account_mode not in {"paper", "live"}:
        raise HTTPException(status_code=400, detail="account_mode must be 'paper' or 'live'")
    try:
        return await fetch_account_summary(account_mode, currency=currency)
    except MissingCredentialsError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

