# WoW AH Tool (local)

## Run

1. Install deps:

```powershell
python -m pip install -r requirements.txt
```

2. Run the app:

```powershell
python -m wowah --source "H:\\WoW\\World of Warcraft\\_retail_\\WTF\\Account\\PANTALONES56\\SavedVariables\\Auctionator.lua"
```

Then open:

- http://127.0.0.1:8787

## Notes

- The app **copies** the `Auctionator.lua` file into `data/live/Auctionator.lua` and only parses the copied file.
- History is append-only JSONL at `history/prices.jsonl`.
- Item search is currently by `item_id` (name mapping can be added later).
