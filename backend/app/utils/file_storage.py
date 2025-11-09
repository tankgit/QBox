from __future__ import annotations

import csv
import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Sequence


@dataclass(slots=True)
class StoredSeries:
    config: Dict[str, Any]
    rows: List[Dict[str, Any]]


def write_series(
    file_path: Path,
    config: Dict[str, Any],
    rows: Sequence[Dict[str, Any]],
) -> None:
    file_path.parent.mkdir(parents=True, exist_ok=True)
    with file_path.open("w", newline="", encoding="utf-8") as fp:
        fp.write(json.dumps(config) + "\n")
        if rows:
            writer = csv.DictWriter(fp, fieldnames=list(rows[0].keys()))
            writer.writeheader()
            for row in rows:
                writer.writerow(row)


def append_series_row(
    file_path: Path,
    row: Dict[str, Any],
    header: Iterable[str],
) -> None:
    file_exists = file_path.exists()
    file_path.parent.mkdir(parents=True, exist_ok=True)
    with file_path.open("a", newline="", encoding="utf-8") as fp:
        if not file_exists:
            fp.write(json.dumps({}) + "\n")
            writer = csv.DictWriter(fp, fieldnames=list(header))
            writer.writeheader()
        else:
            writer = csv.DictWriter(fp, fieldnames=list(header))
        writer.writerow(row)


def read_series(file_path: Path) -> StoredSeries:
    with file_path.open("r", encoding="utf-8") as fp:
        config_line = fp.readline().strip()
        config = json.loads(config_line) if config_line else {}
        reader = csv.DictReader(fp)
        rows = list(reader)
    return StoredSeries(config=config, rows=rows)

