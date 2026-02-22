from __future__ import annotations

import shutil
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

from .config import WORKSPACE_AUCTIONATOR_COPY, WOW_AUCTIONATOR_SOURCE
from .history import JsonlHistoryStore
from .item_meta import ItemMetaStore, icon_url
from .state import AppState


def create_app(state: AppState, history_store: JsonlHistoryStore) -> FastAPI:
    app = FastAPI()

    templates_dir = Path(__file__).parent / "templates"
    templates = Jinja2Templates(directory=str(templates_dir))

    meta_store = ItemMetaStore(cache_path=Path("data") / "cache" / "item_meta.json")

    # Template helpers (avoid needing JS for simple data display)
    templates.env.globals["state_latest"] = lambda item_id: state.latest_unit_price(int(item_id))
    templates.env.globals["state_last_time"] = lambda item_id: state.latest_post_time(int(item_id))
    templates.env.globals["item_meta"] = lambda item_id: meta_store.get(int(item_id))
    templates.env.globals["item_icon_url"] = lambda icon: icon_url(icon)

    @app.get("/", response_class=HTMLResponse)
    def index(request: Request, q: str = ""):
        results = state.search_item_ids(q) if q else []
        recent = state.recent_items(limit=100)
        return templates.TemplateResponse(
            "index.html",
            {
                "request": request,
                "query": q,
                "results": results,
                "recent": recent,
                "last_scan": state.last_browse_scan_time,
                "source_path": str(WOW_AUCTIONATOR_SOURCE),
                "copy_path": str(WORKSPACE_AUCTIONATOR_COPY),
            },
        )

    @app.post("/api/import")
    def import_from_h_drive():
        # Copy-first, then validate + ingest. Never parse the source path directly.
        src = WOW_AUCTIONATOR_SOURCE
        dst = WORKSPACE_AUCTIONATOR_COPY
        dst.parent.mkdir(parents=True, exist_ok=True)
        tmp = dst.with_suffix(dst.suffix + ".tmp")
        if not src.exists():
            return {"ok": False, "error": f"Source file not found: {src}"}
        try:
            shutil.copy2(src, tmp)
        except OSError as e:
            return {"ok": False, "error": str(e)}

        # Basic validation: require scan time + at least one posting.
        try:
            # Lazy import to avoid circular
            from .ingest import AuctionatorIngestor

            # We only need validation here; the running ingestor will ingest the final dst.
            # Validation logic lives on AuctionatorIngestor.
            dummy = AuctionatorIngestor(history_store=history_store)
            dummy.parse_and_validate(tmp)
        except Exception as e:
            try:
                tmp.unlink(missing_ok=True)
            except OSError:
                pass
            return {"ok": False, "error": str(e)}

        try:
            tmp.replace(dst)
        except OSError as e:
            return {"ok": False, "error": str(e)}

        # Ingest into the running state/history
        try:
            # We can reuse the same parse logic by reloading from dst and appending history.
            # Note: create_app currently receives `state` by reference; `AuctionatorIngestor` swaps its own
            # state object, so this UI will show updated history but may not see state updates. We'll keep
            # the UI responsive by relying on history + recent list derived from current state.
            # In the next iteration, we will refactor to share a single ingestor instance.
            from .history import JsonlHistoryStore
            from .ingest import AuctionatorIngestor

            ing = AuctionatorIngestor(history_store=history_store)
            ing.ingest_file(dst)
            state.last_browse_scan_time = ing.state.last_browse_scan_time
            state.postings_by_item_id = ing.state.postings_by_item_id
        except Exception as e:
            return {"ok": False, "error": str(e)}

        return {"ok": True, "copied_to": str(dst)}

    @app.get("/api/suggest")
    def suggest(q: str = ""):
        # Cache-only: do not hit the network on every keystroke.
        items = []

        cached = meta_store.search_cached(q, limit=20)
        if cached:
            for m in cached:
                items.append(
                    {
                        "item_id": m.item_id,
                        "latest": state.latest_unit_price(m.item_id),
                        "last_time": state.latest_post_time(m.item_id),
                        "name": m.name,
                        "icon": m.icon,
                        "icon_url": icon_url(m.icon),
                    }
                )
            return {"items": items}

        for item_id in state.suggest_item_ids(q, limit=20):
            m = meta_store.get(item_id)
            items.append(
                {
                    "item_id": item_id,
                    "latest": state.latest_unit_price(item_id),
                    "last_time": state.latest_post_time(item_id),
                    "name": None if m is None else m.name,
                    "icon": None if m is None else m.icon,
                    "icon_url": None if m is None else icon_url(m.icon),
                }
            )
        return {"items": items}

    @app.get("/api/recent")
    def recent(limit: int = 100):
        out = []
        for item_id in state.recent_items(limit=limit):
            meta = meta_store.get(item_id)
            out.append(
                {
                    "item_id": item_id,
                    "latest": state.latest_unit_price(item_id),
                    "last_time": state.latest_post_time(item_id),
                    "name": None if meta is None else meta.name,
                    "icon": None if meta is None else meta.icon,
                    "icon_url": None if meta is None else icon_url(meta.icon),
                }
            )
        return {"items": out}

    @app.get("/api/item-meta/{item_id}")
    def item_meta_fetch(item_id: int):
        meta = meta_store.get_or_fetch(item_id)
        if meta is None:
            return {"ok": False}
        return {
            "ok": True,
            "item_id": meta.item_id,
            "name": meta.name,
            "icon": meta.icon,
            "quality": meta.quality,
            "tooltip": meta.tooltip,
            "icon_url": icon_url(meta.icon),
        }

    @app.get("/item/{item_id}", response_class=HTMLResponse)
    def item_detail(request: Request, item_id: int):
        history = history_store.read_history_for_item(item_id)
        latest = state.latest_unit_price(item_id)
        recent = state.recent_items(limit=30)
        # Item page is an acceptable place to fetch (cached afterwards).
        meta = meta_store.get_or_fetch(item_id)
        return templates.TemplateResponse(
            "item.html",
            {
                "request": request,
                "item_id": item_id,
                "latest": latest,
                "history": history,
                "recent": recent,
                "last_scan": state.last_browse_scan_time,
                "meta": meta,
                "source_path": str(WOW_AUCTIONATOR_SOURCE),
                "copy_path": str(WORKSPACE_AUCTIONATOR_COPY),
            },
        )

    return app
