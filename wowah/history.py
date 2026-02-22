from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path
from typing import Dict, Iterable, List, Optional

from .state import ItemPosting


class JsonlHistoryStore:
    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            self.path.write_text("", encoding="utf-8")

    def append_postings(self, postings: Iterable[ItemPosting], source_scan_time: Optional[int]) -> None:
        # append-only JSONL; safe for incremental ingest
        with self.path.open("a", encoding="utf-8") as f:
            for p in postings:
                rec = {
                    "item_id": p.item_id,
                    "unit_price": p.unit_price,
                    "quantity": p.quantity,
                    "time": p.time,
                    "scan_time": source_scan_time,
                }
                f.write(json.dumps(rec, separators=(",", ":"), ensure_ascii=False) + "\n")

    def read_history_for_item(self, item_id: int, limit: int = 2000) -> List[Dict]:
        if not self.path.exists():
            return []
        out: List[Dict] = []
        with self.path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if rec.get("item_id") == item_id:
                    out.append(rec)
        out.sort(key=lambda r: r.get("time", 0))
        if len(out) > limit:
            out = out[-limit:]
        return out
