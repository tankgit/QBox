from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Iterable, Optional, Sequence, Tuple


PRICE_FIELD_BY_SESSION: Dict[str, str] = {
    "美股盘前": "pre_market_quote",
    "美股盘后": "post_market_quote",
    "美股夜盘": "overnight_quote",
    "港股夜盘": "overnight_quote",
}


def parse_session_names(session_field: str) -> Sequence[str]:
    return tuple(
        part.strip()
        for part in session_field.split(",")
        if part and part.strip()
    )


def extract_price_and_timestamp(
    quote: Any, session_field: str
) -> Tuple[float, Optional[datetime]]:
    session_names = parse_session_names(session_field)

    # Prioritize session-specific price fields if requested.
    for name in session_names:
        price_attr = PRICE_FIELD_BY_SESSION.get(name)
        if not price_attr:
            continue
        market_quote = getattr(quote, price_attr, None)
        price = _to_float(getattr(market_quote, "last_done", None)) if market_quote else None
        if price is None:
            continue
        timestamp = _get_datetime(getattr(market_quote, "timestamp", None))
        return price, timestamp

    # Fall back to main session price.
    direct_price = _to_float(getattr(quote, "last_done", None))
    if direct_price is not None:
        timestamp = _get_datetime(getattr(quote, "timestamp", None))
        return direct_price, timestamp

    # Attempt broader fallbacks often provided by the SDK.
    fallback_candidates: Iterable[str] = ("last", "prev_close", "open")
    for attr in fallback_candidates:
        candidate = _to_float(getattr(quote, attr, None))
        if candidate is not None:
            timestamp = _get_datetime(getattr(quote, "timestamp", None))
            return candidate, timestamp

    raise RuntimeError("Quote does not contain price information.")


def _to_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if hasattr(value, "price"):
        nested = getattr(value, "price")
        if nested is not None:
            return _to_float(nested)
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _get_datetime(value: Any) -> Optional[datetime]:
    if isinstance(value, datetime):
        return value
    if hasattr(value, "to_pydatetime"):
        try:
            converted = value.to_pydatetime()  # type: ignore[attr-defined]
            if isinstance(converted, datetime):
                return converted
        except Exception:
            return None
    return None

