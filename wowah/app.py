from __future__ import annotations

import argparse
import os
import socket
from pathlib import Path

import uvicorn

from .config import WORKSPACE_AUCTIONATOR_COPY, WOW_AUCTIONATOR_SOURCE
from .history import JsonlHistoryStore
from .ingest import AuctionatorIngestor
from .watcher import CopyThenIngestWatcher
from .web import create_app


def _port_available(host: str, port: int) -> bool:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.bind((host, port))
        return True
    except OSError:
        return False
    finally:
        try:
            s.close()
        except OSError:
            pass


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
        default=str(WORKSPACE_AUCTIONATOR_COPY),
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

    source_path = Path(args.source) if args.source else WOW_AUCTIONATOR_SOURCE
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

    if not _port_available(args.host, int(args.port)):
        alt = int(args.port) + 1
        raise SystemExit(
            f"Port {args.port} is already in use on {args.host}. "
            f"Stop the other server or re-run with --port {alt}."
        )

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")

    if watcher is not None:
        watcher.stop()
