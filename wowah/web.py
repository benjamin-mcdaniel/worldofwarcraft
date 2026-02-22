from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

from .history import JsonlHistoryStore
from .state import AppState


def create_app(state: AppState, history_store: JsonlHistoryStore) -> FastAPI:
    app = FastAPI()

    templates_dir = Path(__file__).parent / "templates"
    templates = Jinja2Templates(directory=str(templates_dir))

    # Template helpers (avoid needing JS for simple data display)
    templates.env.globals["state_latest"] = lambda item_id: state.latest_unit_price(int(item_id))
    templates.env.globals["state_last_time"] = lambda item_id: state.latest_post_time(int(item_id))

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
            },
        )

    @app.get("/api/suggest")
    def suggest(q: str = ""):
        items = []
        for item_id in state.suggest_item_ids(q, limit=20):
            items.append(
                {
                    "item_id": item_id,
                    "latest": state.latest_unit_price(item_id),
                    "last_time": state.latest_post_time(item_id),
                }
            )
        return {"items": items}

    @app.get("/api/recent")
    def recent(limit: int = 100):
        out = []
        for item_id in state.recent_items(limit=limit):
            out.append(
                {
                    "item_id": item_id,
                    "latest": state.latest_unit_price(item_id),
                    "last_time": state.latest_post_time(item_id),
                }
            )
        return {"items": out}

    @app.get("/item/{item_id}", response_class=HTMLResponse)
    def item_detail(request: Request, item_id: int):
        history = history_store.read_history_for_item(item_id)
        latest = state.latest_unit_price(item_id)
        recent = state.recent_items(limit=30)
        return templates.TemplateResponse(
            "item.html",
            {
                "request": request,
                "item_id": item_id,
                "latest": latest,
                "history": history,
                "recent": recent,
                "last_scan": state.last_browse_scan_time,
            },
        )

    return app
