from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional


@dataclass
class ItemMeta:
    item_id: int
    name: Optional[str] = None
    icon: Optional[str] = None
    quality: Optional[int] = None
    tooltip: Optional[str] = None
    fetched_at: Optional[int] = None


class ItemMetaStore:
    def __init__(self, cache_path: Path):
        self.cache_path = cache_path
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        self._cache: Dict[str, Dict[str, Any]] = {}
        self._loaded = False

    def _load(self) -> None:
        if self._loaded:
            return
        self._loaded = True
        if not self.cache_path.exists():
            self._cache = {}
            return
        try:
            raw = self.cache_path.read_text(encoding="utf-8")
            self._cache = json.loads(raw) if raw.strip() else {}
        except OSError:
            self._cache = {}
        except json.JSONDecodeError:
            self._cache = {}

    def _save(self) -> None:
        try:
            self.cache_path.write_text(json.dumps(self._cache, ensure_ascii=False), encoding="utf-8")
        except OSError:
            return

    def get(self, item_id: int) -> Optional[ItemMeta]:
        self._load()
        rec = self._cache.get(str(item_id))
        if not rec:
            return None
        return ItemMeta(
            item_id=item_id,
            name=rec.get("name"),
            icon=rec.get("icon"),
            quality=rec.get("quality"),
            tooltip=rec.get("tooltip"),
            fetched_at=rec.get("fetched_at"),
        )

    def get_or_fetch(self, item_id: int, max_age_days: int = 30) -> Optional[ItemMeta]:
        existing = self.get(item_id)
        if existing and existing.fetched_at:
            age_s = int(time.time()) - int(existing.fetched_at)
            if age_s < max_age_days * 86400:
                return existing
        fetched = self._fetch_from_wowhead(item_id)
        if fetched is None:
            return existing
        self._load()
        self._cache[str(item_id)] = {
            "name": fetched.name,
            "icon": fetched.icon,
            "quality": fetched.quality,
            "tooltip": fetched.tooltip,
            "fetched_at": fetched.fetched_at,
        }
        self._save()
        return fetched

    def search_cached(self, query: str, limit: int = 20) -> list[ItemMeta]:
        self._load()
        q = (query or "").strip().lower()
        if not q:
            return []

        out: list[ItemMeta] = []
        # First: exact/prefix item id matches
        if q.isdigit():
            for key, rec in self._cache.items():
                if key.startswith(q):
                    try:
                        item_id = int(key)
                    except ValueError:
                        continue
                    out.append(
                        ItemMeta(
                            item_id=item_id,
                            name=rec.get("name"),
                            icon=rec.get("icon"),
                            quality=rec.get("quality"),
                            tooltip=rec.get("tooltip"),
                            fetched_at=rec.get("fetched_at"),
                        )
                    )
                    if len(out) >= limit:
                        return out

        # Second: name contains matches
        for key, rec in self._cache.items():
            name = (rec.get("name") or "").lower()
            if q in name:
                try:
                    item_id = int(key)
                except ValueError:
                    continue
                out.append(
                    ItemMeta(
                        item_id=item_id,
                        name=rec.get("name"),
                        icon=rec.get("icon"),
                        quality=rec.get("quality"),
                        tooltip=rec.get("tooltip"),
                        fetched_at=rec.get("fetched_at"),
                    )
                )
                if len(out) >= limit:
                    break
        return out

    def _fetch_from_wowhead(self, item_id: int) -> Optional[ItemMeta]:
        # Public tooltip endpoint (no API key). If it stops working, the app still functions without metadata.
        url = f"https://www.wowhead.com/tooltip/item/{item_id}?dataEnv=live&locale=0"
        req = urllib.request.Request(url, headers={"User-Agent": "wowah-local/0.1"})
        try:
            with urllib.request.urlopen(req, timeout=8) as resp:
                data = resp.read().decode("utf-8", errors="ignore")
        except (urllib.error.URLError, TimeoutError):
            return None

        try:
            j = json.loads(data)
        except json.JSONDecodeError:
            return None

        return ItemMeta(
            item_id=item_id,
            name=j.get("name"),
            icon=j.get("icon"),
            quality=j.get("quality"),
            tooltip=j.get("tooltip"),
            fetched_at=int(time.time()),
        )


def icon_url(icon: Optional[str], size: str = "large") -> Optional[str]:
    if not icon:
        return None
    # Wowhead/Zamimg CDN
    return f"https://wow.zamimg.com/images/wow/icons/{size}/{icon}.jpg"
