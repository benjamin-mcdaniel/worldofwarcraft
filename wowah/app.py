from __future__ import annotations

import argparse
import os
from pathlib import Path

import uvicorn

from .history import JsonlHistoryStore
from .ingest import AuctionatorIngestor
from .watcher import CopyThenIngestWatcher
from .web import create_app


def main() -> None:
    parser = argparse.ArgumentParser(prog="wowah", description="Local WoW Auctionator analysis UI")
    parser.add_argument(
        "--source",
        required=False,
        default=os.environ.get("WOWAH_SOURCE_AUCTIONATOR_LUA", ""),
        help="Path to WoW SavedVariables Auctionator.lua to copy from",
    )
    parser.add_argument(
        "--copy-dest",
        required=False,
        default=str(Path("data") / "live" / "Auctionator.lua"),
        help="Where to copy Auctionator.lua into the workspace",
    )
    parser.add_argument(
        "--history",
        required=False,
        default=str(Path("history") / "prices.jsonl"),
        help="Append-only history file",
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8787, type=int)

    args = parser.parse_args()

    source_path = Path(args.source) if args.source else None
    copy_dest_path = Path(args.copy_dest)
    history_path = Path(args.history)

    history_store = JsonlHistoryStore(history_path)
    ingestor = AuctionatorIngestor(history_store=history_store)

    state = ingestor.state
    app = create_app(state=state, history_store=history_store)

    watcher = None
    if source_path is not None and str(source_path).strip() != "":
        watcher = CopyThenIngestWatcher(
            source_path=source_path,
            copy_dest_path=copy_dest_path,
            ingestor=ingestor,
        )
        watcher.start()
        # initial ingest attempt
        watcher.copy_then_ingest()

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")

    if watcher is not None:
        watcher.stop()
