from __future__ import annotations

import math
import random
from datetime import datetime, timedelta, timezone
from typing import Dict, List

from pathlib import Path
from typing import Dict, List

from app.config import CONFIG
from app.models import DataSeriesDetail, DataSeriesInfo, SimulatedDataRequest
from app.utils.file_storage import read_series, write_series
from app.utils.id_generator import generate_id


def generate_simulated_data(config: SimulatedDataRequest) -> List[Dict[str, float | str]]:
    rng = random.Random(config.seed)
    points = config.data_points
    results: List[Dict[str, float | str]] = []
    start_price = config.start_price
    end_price = config.end_price
    mean_price = config.mean_price
    volatility_prob = config.volatility_probability
    volatility_mag = config.volatility_magnitude
    noise = config.noise
    uncertainty = config.uncertainty
    drift = (end_price - start_price) / max(points - 1, 1)

    current_price = start_price
    current_time = datetime.now(timezone.utc) - timedelta(minutes=points)

    for idx in range(points):
        base_trend = start_price + drift * idx
        reversion_force = (mean_price - current_price) * 0.01
        shock = 0.0
        if rng.random() < volatility_prob:
            direction = 1 if rng.random() > 0.5 else -1
            shock = direction * volatility_mag * rng.random()
        noise_component = noise * (rng.random() - 0.5)
        uncertainty_component = current_price * uncertainty * (rng.random() - 0.5)

        price_change = (
            (base_trend - current_price) * 0.05
            + reversion_force
            + shock
            + noise_component
            + uncertainty_component
        )
        current_price = max(0.01, current_price + price_change)
        current_time += timedelta(seconds=60)
        results.append(
            {
                "timestamp": current_time.isoformat(),
                "price": round(current_price, 4),
            }
        )

    return results


class DataRepository:
    def __init__(self, base_path: Path) -> None:
        self.base_path = base_path
        self.base_path.mkdir(parents=True, exist_ok=True)

    def create_simulated(self, config: SimulatedDataRequest) -> DataSeriesInfo:
        data_id = generate_id("data_")
        rows = generate_simulated_data(config)
        meta = {
            "data_id": data_id,
            "symbol": config.symbol,
            "source": "simulated",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "configuration": config.dict(),
        }
        path = self.base_path / f"{data_id}.csv"
        write_series(path, meta, rows)
        return DataSeriesInfo(
            data_id=data_id,
            symbol=config.symbol,
            created_at=datetime.fromisoformat(meta["created_at"]),
            source="simulated",
            path=str(path),
            config=meta,
        )

    def list_series(self) -> List[DataSeriesInfo]:
        items: List[DataSeriesInfo] = []
        for file in sorted(self.base_path.glob("data_*.csv")):
            stored = read_series(file)
            created_at_str = stored.config.get("created_at")
            created_at = (
                datetime.fromisoformat(created_at_str)
                if isinstance(created_at_str, str)
                else datetime.fromtimestamp(file.stat().st_mtime, tz=timezone.utc)
            )
            items.append(
                DataSeriesInfo(
                    data_id=file.stem,
                    symbol=stored.config.get("symbol", "unknown"),
                    created_at=created_at,
                    source=stored.config.get("source", "unknown"),
                    path=str(file),
                    config=stored.config,
                    data_points=len(stored.rows),
                )
            )
        return items

    def get_series(self, data_id: str) -> DataSeriesDetail:
        path = self.base_path / f"{data_id}.csv"
        stored = read_series(path)
        created_at_str = stored.config.get("created_at")
        created_at = (
            datetime.fromisoformat(created_at_str)
            if isinstance(created_at_str, str)
            else datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
        )
        return DataSeriesDetail(
            data_id=data_id,
            symbol=stored.config.get("symbol", "unknown"),
            created_at=created_at,
            source=stored.config.get("source", "unknown"),
            path=str(path),
            config=stored.config,
            data=stored.rows,
        )

    def delete_series(self, data_id: str) -> None:
        path = self.base_path / f"{data_id}.csv"
        if not path.exists():
            raise FileNotFoundError(f"Data series {data_id} not found")
        path.unlink()


DATA_REPOSITORY = DataRepository(CONFIG.data_storage_path)

