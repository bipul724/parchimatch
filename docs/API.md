# HTTP API

The server (`src/server.ts`) listens on **127.0.0.1 only** (default port 5178). There is no authentication: anything running on the same computer can call it. All JSON responses send `cache-control: no-store` and `x-content-type-options: nosniff`.

Start it with:

```bash
npm start -- --catalog data/synthetic/catalog.csv
```

| Flag | Default | Meaning |
|---|---|---|
| `--catalog` | see below | Catalogue CSV to load at start ([format](DATA_FORMATS.md#catalogue-csv)). An explicit flag always wins |
| `--port` | `5178` | Port on 127.0.0.1; `0` asks the OS for a free port, printed at startup |
| `--data` | `data/app` | Writable folder for learned names, uploaded catalogue and exports |
| `--samples` | `data/synthetic/orders` | Folder of `*.txt` sample orders shown in the UI |
| `--model` | `gemma4:e2b-it-qat` | Ollama model name (`qwen3.5:2b-q4_K_M` is a faster, smaller alternative) |
| `--url` | `http://127.0.0.1:11434` | Ollama base URL |

Paths are resolved relative to the project folder. A flag above written without a value (`--catalog` at the end, or followed by another flag) stops the server with a one-line message such as `--catalog needs a value, e.g. --catalog data/real/catalog.csv` and exit code 1. `--port` must be a whole number from 0 to 65535. `npm run eval` checks `--catalog`, `--cases`, `--model`, `--url`, `--out` and `--label` the same way; switches such as `--think` and `--allow-changed-test` need no value.

**Which catalogue loads at start:** `--catalog` if given. Otherwise `<data>/catalog.csv`, the last catalogue uploaded in the app, if it exists, is valid and has at least one item. Otherwise `data/synthetic/catalog.csv`. If a saved upload can't be used, the server prints a warning with the validation errors and loads the default; it doesn't crash. The startup line names the file and the reason, e.g. `catalogue 111 items (data/app/catalog.csv · uploaded in the app)`. An invalid file passed with `--catalog` still stops the server with its errors.

---

## `GET /api/status`

Health and configuration. Checks with Ollama whether the model is pulled.

```json
{ "catalog": "data/synthetic/catalog.csv", "items": 111, "learned": 2, "model": "gemma4:e2b-it-qat", "modelReady": true }
```

## `GET /api/catalog`

The active catalogue, shaped for the UI.

```json
[{ "sku": "PRLG-5", "label": "Parle-G Biscuit · ₹5 pack · ₹5", "units": ["packet", "carton"], "unitsPerCarton": 144 }]
```

## `POST /api/catalog`

Replaces the catalogue with an uploaded CSV. Body limit is 5,000,000 bytes. The CSV is validated first; on any error, nothing changes. `csv` must be a string.

Request:
```json
{ "csv": "sku,name,brand,variant,mrp,sell_units,units_per_carton,aliases\nPRLG-5,Parle-G Biscuit,Parle,₹5 pack,5,packet|carton,144,parle g\n" }
```

| Status | Body |
|---|---|
| 200 | `{ "ok": true, "items": 111 }` (saved to `<data>/catalog.csv`; learned names are re-validated against it) |
| 400 | `{ "ok": false, "error": "Catalogue … has problems:\n  row 3: unknown unit \"box\"" }`. A CSV with no item rows (header only, or empty) is rejected with `catalogue has no items` |

## `GET /api/samples`

Sample orders from `--samples` (file names matching `^[\w-]+\.txt$`).

```json
[{ "name": "order-01", "text": "Ram Ram bhaiya\n6 pkts monaco 30/-\n…" }]
```

## `POST /api/match`

Matches an order. The response is **newline-delimited JSON** (`application/x-ndjson`), streamed one row at a time. Body limit is 1,000,000 bytes. Supply exactly one of `text` (a string) or `lines` (an array of strings); `force`, if supplied, must be a boolean.

Only one match runs at a time, including requests whose bodies arrive concurrently. Disconnecting the client aborts the pending Ollama request, stops remaining lines, and releases the matching slot.

Request (one of `text` or `lines`):
```json
{ "text": "Namaste bhaiya\nparle g 5/- 2 petti, lays hara 10 rs 3 box" }
```
```json
{ "lines": ["Ram Ram bhaiya"], "force": true }
```

| Field | Meaning |
|---|---|
| `text` | Whole pasted order; split into lines and comma-separated items |
| `lines` | Already-split lines (used by the UI's "Treat as item") |
| `force` | Match every line as an item, even if it looks like a note |

Stream:
```
{"type":"start","total":3,"useModel":true}
{"type":"row","row":{ …Row… }}
{"type":"row","row":{ …Row… }}
{"type":"row","row":{ …Row… }}
{"type":"done"}
```

**Row:**

| Field | Type | Meaning |
|---|---|---|
| `line` | number | 1-based position in the order |
| `text` | string | The line as written |
| `kind` | `"item"` \| `"note"` | Notes (greetings, "Total bata dena") are never exported |
| `source` | `"fuzzy"` \| `"model"` \| `"learned"` \| `"none"` | What produced the answer |
| `status` | `"ok"` \| `"needs_review"` | `ok` = every safety rule passed (green) |
| `sku` | string \| null | Accepted product, or the suggestion when `needs_review` |
| `qty` | number \| null | As ordered (2 for "2 petti") |
| `unit` | `piece` \| `packet` \| `carton` \| `dozen` \| `bag` \| null | As ordered |
| `reasons` | string[] | Why it needs review (empty when `ok`) |
| `question` | string | One question for the operator, written by code |
| `productText` | string | Product words left after removing numbers, units and fillers; what "remember" would save |
| `nameKnown` | boolean | The catalogue already knows these words; nothing new to learn |
| `candidates` | `{sku,label}[]` | Suggestion first, then the closest matches |
| `ms` | number \| null | Model time for this line, if the model was called |
| `baseQty` | number \| null | What the export's `base_qty` will be for this row's product, quantity and unit ("2 carton" of a 144-per-carton item → 288). For an amber row it describes the suggestion. `null` without a product or quantity, or when a carton's size is unknown |
| `baseUnit` | string \| null | The unit `baseQty` counts: `piece` for dozens, the item's loose unit for cartons (`packet`, `piece`…), otherwise the ordered unit. `null` without a product and unit |

| Status | When |
|---|---|
| 200 | Stream as above |
| 409 | `{ "error": "Already matching an order. Wait for it to finish." }` |

## `POST /api/confirm`

Re-checks the operator's decisions, saves learned names, and writes the export CSV.

Request:
```json
{
  "rows": [
    { "line": 2, "text": "kit kat 10/- darjan 4", "status": "confirmed", "sku": "KITKAT-10", "qty": 4, "unit": "dozen", "note": "automatic" },
    { "line": 3, "text": "lais peela 10 rs 2 ctn", "status": "confirmed", "sku": "LAYSCLS-10", "qty": 2, "unit": "carton", "note": "checked by operator" },
    { "line": 10, "text": "Parle 20 20 5 Piece", "status": "skipped", "sku": null, "qty": null, "unit": null, "note": "not stocked / skipped" }
  ],
  "remember": [{ "alias": "lais peela", "sku": "LAYSCLS-10" }]
}
```

`rows` must be an array of review rows with a positive integer `line`, string `text`, `confirmed` or `skipped` status, nullable SKU/quantity/unit fields, and an optional string `note`. `remember`, when supplied, must be an array of `{alias, sku}` strings.

Server-side checks on every `confirmed` row: the SKU exists, the unit is one the item is sold in, and the quantity is a whole number from 1 to 10000. A `remember` entry is saved only if it matches the SKU and parsed product words of an explicitly confirmed row **and the catalogue doesn't already know that name** (a known name with a missing size is not a new name). Unmatched entries, entries linked only to skipped rows, and rows marked `note: "automatic"` are ignored. Alias matching uses normalised text.

Each export has a full timestamp and UUID in its filename so successive exports cannot overwrite an earlier order.

| Status | Body |
|---|---|
| 200 | `{ "ok": true, "csv": "line_no,…", "file": "data/app/exports/order-2026-10-13T08-02-46-519Z-<uuid>.csv", "learned": 1, "learnedTotal": 3 }` |
| 400 | `{ "ok": false, "errors": ["line 3: FORT-5L is not sold by carton"] }` |

Export columns are in [DATA_FORMATS.md](DATA_FORMATS.md#export-csv).

## Static files

| Path | File |
|---|---|
| `/` | `app/index.html` |
| `/app.js` | `app/app.js` |
| `/style.css` | `app/style.css` |

Only these three paths are served (a fixed map, so no file system browsing).

## Errors

| Status | Body |
|---|---|
| 400 | `{ "error": "invalid JSON" }`, or a message describing an invalid request shape. Catalogue validation uses `{ "ok": false, "error": "…" }`; confirmed-row validation uses `{ "ok": false, "errors": ["…"] }` |
| 413 | `{ "error": "request too large" }` when the applicable byte limit is exceeded |
| 404 | `{ "error": "not found" }` |
| 500 | `{ "error": "<message>" }` for unexpected internal failures |

Unsupported HTTP methods use the same 404 response as unknown routes. Every response has a `content-type` header.

## Calling Ollama

The server talks to Ollama at `--url`:

| Call | Purpose |
|---|---|
| `GET /api/tags` | Is the model pulled? (`modelReady`) |
| `POST /api/chat` | `{model, messages, stream:false, format:<JSON schema>, think:false, options:{temperature:0, seed:7, num_ctx:2048}, keep_alive:"15m"}` |

If Ollama rejects `think`, the client retries without it. One repair retry on invalid JSON.
