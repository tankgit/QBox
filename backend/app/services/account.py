from __future__ import annotations

import asyncio
from typing import List

from app.config import CONFIG
from app.models import AccountSummary
from app.services.longport_client import LONGPORT_CLIENT, MissingCredentialsError


async def fetch_account_summary(mode: str) -> AccountSummary:
    credentials = CONFIG.paper_credentials if mode == "paper" else CONFIG.live_credentials
    if credentials is None:
        raise MissingCredentialsError(f"{mode.title()} account is not configured.")

    equity = 0.0
    cash_available = 0.0
    positions: List[dict] = []
    today_orders: List[dict] = []

    def fetch_data() -> tuple[float, float, List[dict], List[dict]]:
        local_equity = 0.0
        local_cash = 0.0
        local_positions: List[dict] = []
        local_orders: List[dict] = []

        with LONGPORT_CLIENT.trade_context(mode) as ctx:
            try:
                balance = ctx.account_balance()
                local_equity = float(getattr(balance, "equity", getattr(balance, "total_equity", 0.0)))
                local_cash = float(getattr(balance, "cash", getattr(balance, "available_cash", 0.0)))
            except Exception:
                local_equity = 0.0
                local_cash = 0.0

            try:
                resp_positions = ctx.stock_position()
                for pos in resp_positions:
                    local_positions.append(
                        {
                            "symbol": getattr(pos, "symbol", ""),
                            "quantity": float(getattr(pos, "quantity", 0.0)),
                            "market_value": float(getattr(pos, "market_value", 0.0)),
                            "avg_price": float(getattr(pos, "avg_price", 0.0)),
                        }
                    )
            except Exception:
                local_positions = []

            try:
                resp_orders = ctx.today_orders()
                for order in resp_orders:
                    local_orders.append(
                        {
                            "order_id": getattr(order, "order_id", ""),
                            "symbol": getattr(order, "symbol", ""),
                            "status": getattr(order, "status", ""),
                            "price": float(getattr(order, "price", 0.0)),
                            "quantity": float(getattr(order, "quantity", 0.0)),
                        }
                    )
            except Exception:
                local_orders = []

        return local_equity, local_cash, local_positions, local_orders

    equity, cash_available, positions, today_orders = await asyncio.to_thread(fetch_data)

    return AccountSummary(
        account_mode=mode,
        equity=equity,
        cash_available=cash_available,
        positions=positions,
        today_orders=today_orders,
    )

