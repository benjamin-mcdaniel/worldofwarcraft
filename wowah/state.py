from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple


@dataclass
class ItemPosting:
    item_id: int
    unit_price: int
    quantity: int
    time: int


@dataclass
class AppState:
    last_browse_scan_time: Optional[int] = None
    postings_by_item_id: Dict[int, List[ItemPosting]] = field(default_factory=dict)

    def item_ids(self) -> List[int]:
        return sorted(self.postings_by_item_id.keys())

    def postings_for(self, item_id: int) -> List[ItemPosting]:
        return self.postings_by_item_id.get(item_id, [])

    def latest_unit_price(self, item_id: int) -> Optional[int]:
        postings = self.postings_for(item_id)
        if not postings:
            return None
        # postings may not be sorted
        latest = max(postings, key=lambda p: p.time)
        return latest.unit_price

    def latest_post_time(self, item_id: int) -> Optional[int]:
        postings = self.postings_for(item_id)
        if not postings:
            return None
        latest = max(postings, key=lambda p: p.time)
        return latest.time

    def recent_items(self, limit: int = 100) -> List[int]:
        scored: List[Tuple[int, int]] = []
        for item_id, postings in self.postings_by_item_id.items():
            if not postings:
                continue
            t = max(p.time for p in postings)
            scored.append((t, item_id))
        scored.sort(reverse=True)
        return [item_id for _, item_id in scored[:limit]]

    def suggest_item_ids(self, query: str, limit: int = 20) -> List[int]:
        # Autocomplete suggestions; currently item_id-only.
        q = query.strip()
        if not q:
            return []
        # Prefer prefix matches.
        prefix: List[int] = []
        contains: List[int] = []
        for item_id in self.item_ids():
            s = str(item_id)
            if s.startswith(q):
                prefix.append(item_id)
            elif q in s:
                contains.append(item_id)
            if len(prefix) + len(contains) >= limit:
                break
        return (prefix + contains)[:limit]

    def search_item_ids(self, query: str, limit: int = 200) -> List[int]:
        q = query.strip()
        if not q:
            return []
        if q.isdigit():
            item_id = int(q)
            if item_id in self.postings_by_item_id:
                return [item_id]
        # fallback: substring match on item_id string
        out: List[int] = []
        for item_id in self.item_ids():
            if q in str(item_id):
                out.append(item_id)
                if len(out) >= limit:
                    break
        return out
