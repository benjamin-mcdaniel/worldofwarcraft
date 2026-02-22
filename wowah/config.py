from __future__ import annotations

from pathlib import Path

WOW_AUCTIONATOR_SOURCE = Path(
    r"H:\WoW\World of Warcraft\_retail_\WTF\Account\YOUR_ACCOUNT\SavedVariables\Auctionator.lua"
)

WORKSPACE_AUCTIONATOR_COPY = Path("data") / "live" / "Auctionator.lua"

ITEM_META_CACHE = Path("data") / "cache" / "item_meta.json"

try:
    from .config_local import WOW_AUCTIONATOR_SOURCE as _WOW_AUCTIONATOR_SOURCE_OVERRIDE

    WOW_AUCTIONATOR_SOURCE = Path(_WOW_AUCTIONATOR_SOURCE_OVERRIDE)
except Exception:
    pass
