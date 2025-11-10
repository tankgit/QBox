from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, time, timedelta, timezone
from typing import Dict, Iterable, List, Optional, Sequence
from zoneinfo import ZoneInfo

LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True)
class TradingWindow:
    start: time
    end: time

    def contains(self, dt: datetime) -> bool:
        """Check whether the timezone-aware datetime falls within this window."""
        if dt.tzinfo is None:
            raise ValueError("TradingWindow.contains requires timezone-aware datetimes")

        start_dt = dt.replace(
            hour=self.start.hour,
            minute=self.start.minute,
            second=self.start.second,
            microsecond=0,
        )
        end_dt = dt.replace(
            hour=self.end.hour,
            minute=self.end.minute,
            second=self.end.second,
            microsecond=0,
        )

        if self.start <= self.end:
            return start_dt <= dt < end_dt

        # Window crosses midnight. Example: 20:00 -> 04:00 (next day)
        if dt.time() >= self.start:
            return dt >= start_dt

        # dt earlier than start time; shift start back one day and end forward one day
        start_dt = (start_dt - timedelta(days=1)).replace(
            hour=self.start.hour,
            minute=self.start.minute,
            second=self.start.second,
            microsecond=0,
        )
        end_dt = (end_dt + timedelta(days=1)).replace(
            hour=self.end.hour,
            minute=self.end.minute,
            second=self.end.second,
            microsecond=0,
        )
        return start_dt <= dt < end_dt


@dataclass(frozen=True)
class TradingSessionDefinition:
    name: str
    timezone: ZoneInfo
    windows: Sequence[TradingWindow]
    supports_dst: bool = True

    def contains(self, dt: datetime) -> bool:
        local_dt = dt.astimezone(self.timezone)
        return any(window.contains(local_dt) for window in self.windows)

    def dst_label(self, reference: Optional[datetime] = None) -> str:
        if not self.supports_dst:
            return "标准时间（无夏令时）"
        reference = reference or datetime.now(timezone.utc)
        local_dt = reference.astimezone(self.timezone)
        dst_delta = local_dt.dst()
        if dst_delta and dst_delta != timedelta(0):
            return "夏令时"
        return "冬令时"


SESSION_DEFINITIONS: Dict[str, TradingSessionDefinition] = {
    "美股盘前": TradingSessionDefinition(
        name="美股盘前",
        timezone=ZoneInfo("America/New_York"),
        windows=(TradingWindow(time(4, 0), time(9, 30)),),
    ),
    "美股盘中": TradingSessionDefinition(
        name="美股盘中",
        timezone=ZoneInfo("America/New_York"),
        windows=(TradingWindow(time(9, 30), time(16, 0)),),
    ),
    "美股盘后": TradingSessionDefinition(
        name="美股盘后",
        timezone=ZoneInfo("America/New_York"),
        windows=(TradingWindow(time(16, 0), time(20, 0)),),
    ),
    "美股夜盘": TradingSessionDefinition(
        name="美股夜盘",
        timezone=ZoneInfo("America/New_York"),
        windows=(TradingWindow(time(20, 0), time(4, 0)),),
    ),
    "港股盘中": TradingSessionDefinition(
        name="港股盘中",
        timezone=ZoneInfo("Asia/Hong_Kong"),
        windows=(
            TradingWindow(time(9, 30), time(12, 0)),
            TradingWindow(time(13, 0), time(16, 0)),
        ),
        supports_dst=False,
    ),
    "港股夜盘": TradingSessionDefinition(
        name="港股夜盘",
        timezone=ZoneInfo("Asia/Hong_Kong"),
        windows=(TradingWindow(time(17, 15), time(3, 0)),),
        supports_dst=False,
    ),
}


def _normalize_session_name(name: str) -> str:
    return name.strip()


def resolve_sessions(session_field: str) -> List[TradingSessionDefinition]:
    names = [
        _normalize_session_name(part)
        for part in session_field.split(",")
        if _normalize_session_name(part)
    ]
    resolved: List[TradingSessionDefinition] = []

    for name in names:
        definition = SESSION_DEFINITIONS.get(name)
        if definition:
            resolved.append(definition)
        else:
            LOGGER.warning("Unknown trading session '%s'. Task will ignore this entry.", name)

    return resolved


def contains_session(sessions: Iterable[TradingSessionDefinition], dt: datetime) -> bool:
    sessions_list: Sequence[TradingSessionDefinition]
    if isinstance(sessions, Sequence):
        sessions_list = sessions
    else:
        sessions_list = list(sessions)
    if not sessions_list:
        # If we have nothing to enforce, treat as always within session.
        return True
    return any(session.contains(dt) for session in sessions_list)


def summarize_sessions(sessions: Iterable[TradingSessionDefinition]) -> Optional[str]:
    names = [session.name for session in sessions]
    if not names:
        return None
    return ", ".join(names)


def get_dst_labels(sessions: Iterable[TradingSessionDefinition], reference: Optional[datetime] = None) -> Dict[str, str]:
    reference = reference or datetime.now(timezone.utc)
    return {session.name: session.dst_label(reference) for session in sessions}



