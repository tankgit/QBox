from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv


@dataclass(slots=True)
class LongPortCredentials:
    app_key: str
    app_secret: str
    access_token: str


@dataclass(slots=True)
class AppConfig:
    debug: bool = field(default=False)
    host: str = field(default="0.0.0.0")
    port: int = field(default=8000)
    data_storage_path: Path = field(default=Path("./storage/data"))
    log_storage_path: Path = field(default=Path("./storage/logs"))
    longport_http_url: Optional[str] = None
    longport_quote_ws_url: Optional[str] = None
    longport_trade_ws_url: Optional[str] = None
    paper_credentials: Optional[LongPortCredentials] = None
    live_credentials: Optional[LongPortCredentials] = None


def _load_credentials(prefix: str) -> Optional[LongPortCredentials]:
    app_key = os.getenv(f"{prefix}_APP_KEY") or ""
    app_secret = os.getenv(f"{prefix}_APP_SECRET") or ""
    access_token = os.getenv(f"{prefix}_ACCESS_TOKEN") or ""

    if not (app_key and app_secret and access_token):
        return None

    return LongPortCredentials(
        app_key=app_key,
        app_secret=app_secret,
        access_token=access_token,
    )


def load_config(env_path: Path | None = None) -> AppConfig:
    if env_path is None:
        env_path = Path(".env")

    if env_path.exists():
        load_dotenv(env_path)

    data_path = Path(os.getenv("DATA_STORAGE_PATH", "storage/data"))
    log_path = Path(os.getenv("LOG_STORAGE_PATH", "storage/logs"))
    data_path.mkdir(parents=True, exist_ok=True)
    log_path.mkdir(parents=True, exist_ok=True)

    return AppConfig(
        debug=os.getenv("DEBUG", "false").lower() == "true",
        host=os.getenv("APP_HOST", "0.0.0.0"),
        port=int(os.getenv("APP_PORT", "8000")),
        data_storage_path=data_path,
        log_storage_path=log_path,
        longport_http_url=os.getenv("LONGPORT_HTTP_URL"),
        longport_quote_ws_url=os.getenv("LONGPORT_QUOTE_WS_URL"),
        longport_trade_ws_url=os.getenv("LONGPORT_TRADE_WS_URL"),
        paper_credentials=_load_credentials("LONGPORT_PAPER"),
        live_credentials=_load_credentials("LONGPORT_LIVE"),
    )


CONFIG = load_config()

