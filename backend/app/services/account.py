from __future__ import annotations

import asyncio
from typing import List

from app.config import CONFIG
from app.models import AccountBalance, AccountSummary, CashInfo, FrozenTransactionFee
from app.services.longport_client import LONGPORT_CLIENT, MissingCredentialsError


async def fetch_account_summary(mode: str, currency: str | None = None) -> AccountSummary:
    credentials = CONFIG.paper_credentials if mode == "paper" else CONFIG.live_credentials
    if credentials is None:
        raise MissingCredentialsError(f"{mode.title()} account is not configured.")

    balances: List[AccountBalance] = []
    positions: List[dict] = []
    today_orders: List[dict] = []

    def fetch_data() -> tuple[List[AccountBalance], List[dict], List[dict]]:
        local_balances: List[AccountBalance] = []
        local_positions: List[dict] = []
        local_orders: List[dict] = []

        with LONGPORT_CLIENT.trade_context(mode) as ctx:
            try:
                balance_list = ctx.account_balance(currency=currency)
                for balance in balance_list:
                    # Extract cash_infos
                    cash_infos = []
                    if hasattr(balance, "cash_infos") and balance.cash_infos:
                        for cash_info in balance.cash_infos:
                            cash_infos.append(
                                CashInfo(
                                    withdraw_cash=float(getattr(cash_info, "withdraw_cash", 0.0)),
                                    available_cash=float(getattr(cash_info, "available_cash", 0.0)),
                                    frozen_cash=float(getattr(cash_info, "frozen_cash", 0.0)),
                                    settling_cash=float(getattr(cash_info, "settling_cash", 0.0)),
                                    currency=str(getattr(cash_info, "currency", "")),
                                )
                            )

                    # Extract frozen_transaction_fees
                    frozen_fees = None
                    if hasattr(balance, "frozen_transaction_fees") and balance.frozen_transaction_fees:
                        fee = balance.frozen_transaction_fees
                        frozen_fees = FrozenTransactionFee(
                            currency=str(getattr(fee, "currency", "")),
                            frozen_transaction_fee=float(getattr(fee, "frozen_transaction_fee", 0.0)),
                        )

                    local_balances.append(
                        AccountBalance(
                            total_cash=float(getattr(balance, "total_cash", 0.0)),
                            max_finance_amount=float(getattr(balance, "max_finance_amount", 0.0)),
                            remaining_finance_amount=float(getattr(balance, "remaining_finance_amount", 0.0)),
                            risk_level=int(getattr(balance, "risk_level", 0)),
                            margin_call=float(getattr(balance, "margin_call", 0.0)),
                            currency=str(getattr(balance, "currency", "")),
                            cash_infos=cash_infos,
                            net_assets=float(getattr(balance, "net_assets", 0.0)),
                            init_margin=float(getattr(balance, "init_margin", 0.0)),
                            maintenance_margin=float(getattr(balance, "maintenance_margin", 0.0)),
                            buy_power=float(getattr(balance, "buy_power", 0.0)),
                            frozen_transaction_fees=frozen_fees,
                        )
                    )
            except Exception:
                local_balances = []

            try:
                # Get stock positions
                stock_resp = ctx.stock_positions()
                for channel in stock_resp.channels:
                    for pos in channel.positions:
                        # Calculate estimated market value using cost_price * quantity
                        # Note: This is an estimate, actual market value would need current price
                        cost_price = float(getattr(pos, "cost_price", 0.0))
                        quantity = float(getattr(pos, "quantity", 0.0))
                        estimated_market_value = cost_price * quantity
                        
                        # Extract market name
                        market_obj = getattr(pos, "market", None)
                        market_name = ""
                        if market_obj is not None:
                            # Try to get name attribute or class name
                            if hasattr(market_obj, "name"):
                                market_name = str(market_obj.name)
                            elif hasattr(market_obj, "__name__"):
                                market_name = str(market_obj.__name__)
                            else:
                                market_name = str(market_obj)
                        
                        local_positions.append(
                            {
                                "type": "stock",
                                "symbol": getattr(pos, "symbol", ""),
                                "symbol_name": getattr(pos, "symbol_name", ""),
                                "quantity": quantity,
                                "available_quantity": float(getattr(pos, "available_quantity", 0.0)),
                                "currency": str(getattr(pos, "currency", "")),
                                "cost_price": cost_price,
                                "market": market_name,
                                "init_quantity": float(getattr(pos, "init_quantity", 0.0)) if getattr(pos, "init_quantity", None) is not None else None,
                                "estimated_market_value": estimated_market_value,
                            }
                        )
                
                # Get fund positions
                fund_resp = ctx.fund_positions()
                for channel in fund_resp.channels:
                    for pos in channel.positions:
                        current_nav = float(getattr(pos, "current_net_asset_value", 0.0))
                        holding_units = float(getattr(pos, "holding_units", 0.0))
                        estimated_market_value = current_nav * holding_units
                        
                        local_positions.append(
                            {
                                "type": "fund",
                                "symbol": getattr(pos, "symbol", ""),
                                "symbol_name": getattr(pos, "symbol_name", ""),
                                "holding_units": holding_units,
                                "currency": str(getattr(pos, "currency", "")),
                                "current_net_asset_value": current_nav,
                                "cost_net_asset_value": float(getattr(pos, "cost_net_asset_value", 0.0)),
                                "net_asset_value_day": str(getattr(pos, "net_asset_value_day", "")),
                                "estimated_market_value": estimated_market_value,
                            }
                        )
            except Exception as e:
                import logging
                logging.exception(f"Error fetching positions: {e}")
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

        return local_balances, local_positions, local_orders

    balances, positions, today_orders = await asyncio.to_thread(fetch_data)

    return AccountSummary(
        account_mode=mode,
        balances=balances,
        positions=positions,
        today_orders=today_orders,
    )

