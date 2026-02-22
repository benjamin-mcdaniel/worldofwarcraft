from __future__ import annotations

import re
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

from .history import JsonlHistoryStore
from .state import AppState, ItemPosting


class AuctionatorIngestor:
    def __init__(self, history_store: JsonlHistoryStore):
        self.history_store = history_store
        self.state = AppState()

    def ingest_file(self, path: Path) -> None:
        scan_time, postings_by_item, all_postings = self.parse_and_validate(path)

        # Commit (swap in-memory state + append history) only after a successful parse.
        new_state = AppState(last_browse_scan_time=scan_time, postings_by_item_id=postings_by_item)
        self.state = new_state
        self.history_store.append_postings(all_postings, source_scan_time=scan_time)

    def parse_and_validate(
        self, path: Path
    ) -> tuple[Optional[int], Dict[int, List[ItemPosting]], List[ItemPosting]]:
        raw = path.read_bytes()
        # Decode permissively: savedvars can contain odd bytes.
        text = raw.decode("utf-8", errors="ignore")

        scan_time = self._parse_last_browse_scan_time(text)
        postings = self._parse_posting_history(text)

        # Integrity checks: we require the expected table + at least one entry.
        # If Auctionator changes format or we copied a partial file, fail fast.
        if scan_time is None:
            raise ValueError("Missing TimeOfLastBrowseScan in AUCTIONATOR_SAVEDVARS")
        if not postings:
            raise ValueError("No postings parsed from AUCTIONATOR_POSTING_HISTORY")

        postings_by_item: Dict[int, List[ItemPosting]] = {}
        for p in postings:
            postings_by_item.setdefault(p.item_id, []).append(p)

        return scan_time, postings_by_item, postings

    def _parse_last_browse_scan_time(self, text: str) -> Optional[int]:
        # AUCTIONATOR_SAVEDVARS = { ["TimeOfLastBrowseScan"] = 1771753492, }
        m = re.search(r"\[\"TimeOfLastBrowseScan\"\]\s*=\s*(\d+)", text)
        if not m:
            return None
        try:
            return int(m.group(1))
        except ValueError:
            return None

    def _parse_posting_history(self, text: str) -> List[ItemPosting]:
        # We only parse AUCTIONATOR_POSTING_HISTORY; it appears as readable Lua tables.
        # We do not attempt to parse AUCTIONATOR_PRICE_DATABASE because it can contain binary-like strings.
        start = text.find("AUCTIONATOR_POSTING_HISTORY")
        if start < 0:
            return []

        brace_start = text.find("{", start)
        if brace_start < 0:
            return []

        # naive brace matching
        i = brace_start
        depth = 0
        end = None
        while i < len(text):
            c = text[i]
            if c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    end = i + 1
                    break
            i += 1

        if end is None:
            return []

        block = text[brace_start:end]

        # Parse blocks like:
        # ["210805"] = { { ["price"] = 22200, ["quantity"] = 3, ["time"] = 1771535900, }, },
        item_header_re = re.compile(r"\[\"(\d+)\"\]\s*=\s*\{")
        entry_re = re.compile(
            r"\[\"price\"\]\s*=\s*(\d+)\s*,\s*\[\"quantity\"\]\s*=\s*(\d+)\s*,\s*\[\"time\"\]\s*=\s*(\d+)",
            re.MULTILINE,
        )

        postings: List[ItemPosting] = []
        # Iterate through item sections by scanning headers and slicing until next header.
        headers = list(item_header_re.finditer(block))
        for idx, h in enumerate(headers):
            item_id = int(h.group(1))
            section_start = h.end()
            section_end = headers[idx + 1].start() if idx + 1 < len(headers) else len(block)
            section = block[section_start:section_end]

            for em in entry_re.finditer(section):
                price = int(em.group(1))
                qty = int(em.group(2))
                t = int(em.group(3))
                postings.append(ItemPosting(item_id=item_id, unit_price=price, quantity=qty, time=t))

        return postings
