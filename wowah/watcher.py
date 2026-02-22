from __future__ import annotations

import shutil
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer

from .ingest import AuctionatorIngestor


class _FileChangedHandler(FileSystemEventHandler):
    def __init__(self, watcher: "CopyThenIngestWatcher"):
        super().__init__()
        self.watcher = watcher

    def on_modified(self, event):
        if event.is_directory:
            return
        if Path(event.src_path) == self.watcher.source_path:
            self.watcher.copy_then_ingest()

    def on_created(self, event):
        if event.is_directory:
            return
        if Path(event.src_path) == self.watcher.source_path:
            self.watcher.copy_then_ingest()


@dataclass
class CopyThenIngestWatcher:
    source_path: Path
    copy_dest_path: Path
    ingestor: AuctionatorIngestor

    def __post_init__(self) -> None:
        self._observer: Optional[Observer] = None
        self._last_copy_mtime_ns: Optional[int] = None

    def start(self) -> None:
        self.copy_dest_path.parent.mkdir(parents=True, exist_ok=True)
        handler = _FileChangedHandler(self)
        self._observer = Observer()
        self._observer.schedule(handler, str(self.source_path.parent), recursive=False)
        self._observer.start()

    def stop(self) -> None:
        if self._observer is None:
            return
        self._observer.stop()
        self._observer.join(timeout=2)
        self._observer = None

    def copy_then_ingest(self) -> None:
        # Avoid reading partial writes: do a stability check before copy.
        if not self.source_path.exists():
            return

        stable = self._wait_for_stable_file(max_wait_s=3.0, interval_s=0.2)
        if not stable:
            return

        tmp_path = self.copy_dest_path.with_suffix(self.copy_dest_path.suffix + ".tmp")
        try:
            shutil.copy2(self.source_path, tmp_path)
        except OSError:
            return

        # Validate parse against the temp copy before swapping the live copy.
        try:
            self.ingestor.parse_and_validate(tmp_path)
        except (OSError, ValueError):
            try:
                tmp_path.unlink(missing_ok=True)
            except OSError:
                pass
            return

        # Atomically replace the live copy, then ingest from the live copy.
        try:
            tmp_path.replace(self.copy_dest_path)
        except OSError:
            return

        try:
            self.ingestor.ingest_file(self.copy_dest_path)
        except (OSError, ValueError):
            return

    def _wait_for_stable_file(self, max_wait_s: float, interval_s: float) -> bool:
        deadline = time.time() + max_wait_s
        last: Optional[tuple[int, int]] = None
        while time.time() < deadline:
            try:
                st = self.source_path.stat()
                cur = (st.st_mtime_ns, st.st_size)
            except OSError:
                return False
            if last is not None and cur == last:
                return True
            last = cur
            time.sleep(interval_s)
        return False
