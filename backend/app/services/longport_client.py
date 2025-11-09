from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from contextlib import contextmanager
from threading import RLock
from typing import DefaultDict, Iterator, Optional

from longport.openapi import Config as LongPortConfig, QuoteContext, TradeContext

from app.config import CONFIG, LongPortCredentials


class MissingCredentialsError(RuntimeError):
    pass


class LongPortClient:
    def __init__(self) -> None:
        self._quote_contexts: dict[str, QuoteContext] = {}
        self._trade_contexts: dict[str, TradeContext] = {}
        self._quote_locks: DefaultDict[str, RLock] = defaultdict(RLock)
        self._trade_locks: DefaultDict[str, RLock] = defaultdict(RLock)

    def _build_config(self, credentials: LongPortCredentials) -> LongPortConfig:
        return LongPortConfig(
            app_key=credentials.app_key,
            app_secret=credentials.app_secret,
            access_token=credentials.access_token,
            http_url=CONFIG.longport_http_url,
            quote_ws_url=CONFIG.longport_quote_ws_url,
            trade_ws_url=CONFIG.longport_trade_ws_url,
        )

    def _get_credentials(self, mode: str) -> LongPortCredentials:
        creds: Optional[LongPortCredentials]
        if mode == "paper":
            creds = CONFIG.paper_credentials
        elif mode == "live":
            creds = CONFIG.live_credentials
        else:
            raise ValueError("mode must be 'paper' or 'live'")

        if creds is None:
            raise MissingCredentialsError(f"LongPort credentials for {mode} account are not configured.")
        return creds

    def _get_or_create_quote_context(self, mode: str) -> QuoteContext:
        if mode not in self._quote_contexts:
            credentials = self._get_credentials(mode)
            config = self._build_config(credentials)
            self._quote_contexts[mode] = QuoteContext(config)
        return self._quote_contexts[mode]

    def _get_or_create_trade_context(self, mode: str) -> TradeContext:
        if mode not in self._trade_contexts:
            credentials = self._get_credentials(mode)
            config = self._build_config(credentials)
            self._trade_contexts[mode] = TradeContext(config)
        return self._trade_contexts[mode]

    def initialize_contexts(self) -> None:
        for mode in ("paper", "live"):
            for context_builder in (self._get_or_create_quote_context, self._get_or_create_trade_context):
                try:
                    context_builder(mode)
                except MissingCredentialsError:
                    continue
                except Exception as exc:  # pragma: no cover - defensive logging
                    logging.exception("Failed to initialize LongPort %s context for mode '%s': %s", context_builder.__name__, mode, exc)

    def shutdown(self) -> None:
        for ctx in self._quote_contexts.values():
            close = getattr(ctx, "close", None)
            if callable(close):
                try:
                    close()
                except Exception:  # pragma: no cover - defensive logging
                    logging.exception("Failed to close LongPort quote context")
        for ctx in self._trade_contexts.values():
            close = getattr(ctx, "close", None)
            if callable(close):
                try:
                    close()
                except Exception:  # pragma: no cover - defensive logging
                    logging.exception("Failed to close LongPort trade context")
        self._quote_contexts.clear()
        self._trade_contexts.clear()

    @contextmanager
    def quote_context(self, mode: str) -> Iterator[QuoteContext]:
        lock = self._quote_locks[mode]
        lock.acquire()
        try:
            ctx = self._get_or_create_quote_context(mode)
            yield ctx
        finally:
            lock.release()

    @contextmanager
    def trade_context(self, mode: str) -> Iterator[TradeContext]:
        lock = self._trade_locks[mode]
        lock.acquire()
        try:
            ctx = self._get_or_create_trade_context(mode)
            yield ctx
        finally:
            lock.release()


LONGPORT_CLIENT = LongPortClient()

