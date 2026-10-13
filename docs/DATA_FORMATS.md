# Data formats

All files are UTF-8. CSV files use a header row, commas, and `"…"` quoting with `""` for a quote inside a field.

## Catalogue CSV

One row per **sellable variant** (₹5 and ₹10 Parle-G are two rows).

```csv
sku,name,brand,variant,mrp,sell_units,units_per_carton,aliases
PRLG-5,Parle-G Biscuit,Parle,₹5 pack,5,packet|carton,144,parle g
FORT-5L,Fortune Soyabean Oil,Fortune,5 L jar,760,piece,,fortune oil|fortune
```

| Column | Required | Rules |
|---|---|---|
| `sku` | yes | Unique |
| `name` | yes | Shared by all variants of a product. Learned names use it to find sibling variants |
| `brand` | | Shown to the model |
| `variant` | | Pack description. Write sizes as `<number> <kg/g/L/ml>` (e.g. `1 kg`, `500 g`, `1 L pouch`) so size checks work |
| `mrp` | | Number. Empty = unknown (the price check is skipped for this item) |
| `sell_units` | yes | `|`-separated subset of `piece`, `packet`, `carton`, `dozen`, `bag` |
| `units_per_carton` | | Positive whole number. Empty = unknown, so carton orders for this item always ask |
| `aliases` | | `|`-separated names **the shop's own system already uses**. Don't add misspellings or Hindi names here; they're what the tool should handle, and the operator teaches them through "Remember" |

Loading reports every problem with its row number (missing SKU or name, duplicate SKU, unknown unit, non-numeric MRP, bad carton size), and nothing loads until all are fixed.

## Labelled order lines (JSONL)

Used for evaluation, test sets and training. One JSON object per line; lines starting with `//` are comments.

```json
{"id":"t017","text":"parle g 5/- 2 petti","gold":{"sku":"PRLG-5","qty":2,"unit":"carton","status":"ok"},"tags":["price_variant","hinglish_unit"]}
{"id":"t018","text":"lays 10 wala 2 ctn","gold":{"sku":null,"qty":2,"unit":"carton","status":"needs_review"},"tags":["ambiguous_variant"]}
```

| Field | Meaning |
|---|---|
| `id` | Unique within the file |
| `text` | The line exactly as written |
| `gold.sku` | Correct SKU, or `null` if a careful human couldn't tell (ambiguous, not stocked) |
| `gold.qty`, `gold.unit` | **As ordered** (2 carton), not converted. `null` if not written or unclear |
| `gold.status` | `ok` if a careful human could enter it without asking; otherwise `needs_review` |
| `tags` | Free-form labels for the per-tag breakdown (e.g. `misspelling`, `hindi_name`, `price_variant`, `devanagari`, `not_in_catalogue`) |

## Test-set lock

`<test file>.lock.json`, written by `npm run split` or the generator:

```json
{ "created": "2026-10-13T07:37:53.891Z", "seed": 2027, "n": 80, "sha256": "a0c35e04…", "source": "tools/gen-synthetic.ts" }
```

`npm run eval` refuses to score a test file whose hash no longer matches.

## Learned names CSV

`data/app/aliases_learned.csv`, append-only. When a name appears twice, the later entry wins.

```csv
alias,sku,created
lais peela,LAYSCLS-10,2026-10-13T08:02:46.519Z
```

`alias` is stored normalised (lowercase, punctuation stripped). The SKU points at one variant, but matching uses the whole product family ([RULES.md](RULES.md#3-learned-name-rules-srcreviewts-srcserverts)). Rows whose SKU is no longer in the catalogue are ignored.

## Export CSV

`data/app/exports/order-<timestamp>-<unique-id>.csv`, also downloaded from the app. Each export gets a full timestamp and random UUID so successive exports cannot overwrite an earlier order. One row per item line; notes are left out.

Every exported cell whose first non-whitespace character is `=`, `+`, `-` or `@` is prefixed with an apostrophe (`'`) so spreadsheet readers treat it as text. This applies to order text, catalogue fields and reviewer notes, including skipped rows. The apostrophe is part of the CSV data. Commas, quotes, carriage returns and newlines are quoted according to CSV rules; Devanagari is preserved as UTF-8.

```csv
line_no,order_text,sku,name,variant,qty,unit,base_qty,base_unit,status,reviewer_note
2,kit kat 10/- darjan 4,KITKAT-10,KitKat,₹10 bar,4,dozen,48,piece,confirmed,automatic
7,lays blue 20 rs peti 6 chahiye,LAYSMAG-20,Lay's India's Magic Masala,₹20 pack,6,carton,144,packet,confirmed,checked by operator
10,Parle 20 20 5 Piece,,,,,,,,skipped,not stocked / skipped
```

| Column | Meaning |
|---|---|
| `qty`, `unit` | As ordered |
| `base_qty`, `base_unit` | Converted: carton × `units_per_carton` into the item's smaller unit; dozen × 12 into pieces. Blank when the carton size is unknown |
| `status` | `confirmed` or `skipped` |
| `reviewer_note` | `automatic`, `checked by operator`, `not stocked / skipped`, and/or `carton size unknown: base quantity left blank` |

## Evaluation results

`results/<timestamp>_<method>[_<model>].json` holds settings, machine info, summary metrics, per-tag breakdown and every row with its reasons. `results/summary.md` holds one table row per run. Metrics are defined in [EVALUATION.md](EVALUATION.md#metrics).

## Training conversations (optional fine-tuning)

`npm run export-train` writes `data/train/chat.jsonl`, one conversation per labelled line, using **exactly** the inference prompt and candidate list:

```json
{"id":"d001","messages":[{"role":"system","content":"…"},{"role":"user","content":"Order line: …\n\nCandidates:\n- sku=…"},{"role":"assistant","content":"{\"evidence\":\"lays hara\",\"sku\":\"LAYSCRM-10\",\"status\":\"ok\"}"}]}
```

If retrieval didn't surface the correct product, the target is `needs_review` (mirrors inference). Check the exact format your fine-tuning service expects before uploading.
