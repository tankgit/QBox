from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import CONFIG
from app.routers import accounts, backtests, data, quant, strategies
from app.services.longport_client import LONGPORT_CLIENT

logging.basicConfig(level=logging.INFO if CONFIG.debug else logging.WARNING)

app = FastAPI(title="QBox Quant Trading Platform", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(data.router)
app.include_router(strategies.router)
app.include_router(backtests.router)
app.include_router(quant.router)
app.include_router(accounts.router)


@app.on_event("startup")
async def init_longport_contexts() -> None:
    LONGPORT_CLIENT.initialize_contexts()


@app.on_event("shutdown")
async def shutdown_longport_contexts() -> None:
    LONGPORT_CLIENT.shutdown()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}

