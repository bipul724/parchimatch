# ParchiMatch Lite — build spec

**One line:** a wholesaler pastes a messy order ("parle g 5/- 2 petti", "tata namak 5 petti"); a local model maps each line to the shop's own catalogue; code checks every number; the operator confirms; a clean CSV comes out for Tally/Busy/Marg entry.

Target: Hacktoberfest Open-Source AI Challenge Week 2 (Side Hustle). Deadline Sun 18 Oct 11:59 PM PDT = **Mon 19 Oct 12:29 PM IST**. Publish **Sat 17 Oct**; Sunday is buffer.

---

## 1. User and job

| | |
|---|---|
| Buyer | Owner of a small FMCG/kirana wholesaler or distributor |
| User | The person who retypes WhatsApp/phone/paper orders into billing software |
| Job | Turn 20–80 order lines a day into correct (item, quantity, unit) rows |
| Pain | Shorthand, misspellings, Hinglish names, price-as-variant ("5 wala"), pack sizes vs quantities, carton maths |
| Why local | Customer list, price list and order volume are the business; no per-order API bill; works when the internet doesn't |
| Proof of value | Lines handled with no edits, wrong rows reaching the bill (target: zero), minutes per order vs manual |

## 2. Scope

**In (MVP):** one shop · one catalogue CSV (≤ 300 items) · pasted text, one item per line · Hinglish + some Devanagari · review screen · CSV export · operator corrections saved as aliases.

**Out (say so in the post):** handwriting/photo OCR, voice, WhatsApp integration, direct Tally/Busy writes, prices/discounts/GST, multi-shop, cloud anything at runtime.

## 3. Hard rules (what makes it trustworthy)

1. **The model never owns a number.** Quantity, unit, price and pack size are read by deterministic code (`src/text.ts`) and given to the model as facts. The model only picks the SKU, plus which written quantity is meant when a line has two ("maggi 4 pack 1 petti"). The first trial showed why: Qwen3.5-4B turned "petti" into "packet" in 3 of 4 lines despite the prompt.
2. **The model may only choose from candidates it was shown.** Invented or out-of-list SKUs → review.
3. **Evidence or nothing.** Every accepted row quotes the order words that name the product.
4. **Carton maths needs a carton size.** "2 petti" of an item without `units_per_carton` → review, never a guess.
5. **When unsure, ask.** `needs_review` with one short question is always an acceptable answer. The question is written by code from the rule that failed ("How many in one carton of …?"), not by the model. Wrong rows reaching the bill are the metric that matters most.
6. **Offline at runtime.** Ollama bound to 127.0.0.1, assets bundled, demo recorded with Wi-Fi off. Fine-tuning (if any) is a one-time cloud step on synthetic + consented data, stated in the post.

## 4. Data contracts

**Catalogue CSV** (`data/real/catalog.csv`, from the shop's billing export):

```
sku,name,brand,variant,mrp,sell_units,units_per_carton,aliases
PRLG-5,Parle-G Biscuit,Parle,₹5 pack,5,packet|carton,144,parle g
```
- `sell_units` ⊆ `piece|packet|carton|dozen|bag`; pack sizes (kg/g/L/ml) go in `variant`, never in units.
- Empty `mrp` / `units_per_carton` = unknown (validation then sends affected rows to review).
- `aliases`: only names the shop actually writes. Don't pre-load misspellings; they are what we measure.

**Labelled line** (`*.jsonl`, one per line, `//` comments allowed):

```json
{"id":"r017","text":"parle g 5/- 2 petti","gold":{"sku":"PRLG-5","qty":2,"unit":"carton","status":"ok"},"tags":["price_variant"]}
```
- `gold.status = "needs_review"` when a careful human would have to ask (two variants fit, unknown unit word, item not stocked, quantity missing).
- `qty`/`unit` are **as ordered** (2 carton), not converted. Conversion happens at export.
- Tags drive the per-tag breakdown in the write-up. Suggested: `misspelling, hindi_name, hinglish_unit, hindi_number, price_variant, size_variant, number_in_name, colour_name, brand_only, word_order, devanagari, ambiguous_variant, missing_qty, unknown_unit, not_in_catalogue, carton_size_unknown`.

**Export CSV** (per order): `line_no, order_text, sku, name, variant, qty, unit, base_qty, base_unit, status, reviewer_note`.

## 5. Pipeline

```
order text ─► split lines ─► parse (code) ─► retrieve top-k (code) ─► decide (model) ─► finalize (code) ─► review UI ─► export
                               qty, unit,        trigram + word          pick SKU or      rules §3; disagree
                               price, size        cover + price/size      abstain, quote   with parser → review
                                                  boosts                  evidence
```

| Stage | File | Notes |
|---|---|---|
| Parse | `src/text.ts` | Price (`5/-`, `10 wala`, `rs 20`) before size (`10 kilo`) before qty+unit (`2 petti`, `ek petti`, `ctn 2`). Hindi number words only count next to a unit (“bhej do”). Two different qty+unit pairs → unresolved. |
| Retrieve | `src/retrieve.ts` | Exact longest-alias match (baseline) and fuzzy top-k with ±0.15 price/size boosts. |
| Decide | `src/prompt.ts`, `src/llm.ts` | Ollama `/api/chat`, JSON schema `{evidence, sku, option, status}`, `temperature 0`, `think: false`, `num_ctx 2048`, one repair retry. Same prompt is used for training export. |
| Finalize | `src/validate.ts` | All rules in §3. Single-unit items get their unit filled in. Writes the operator's question. |
| Review UI | to build (Thu) | See §8. |

## 6. Model plan for an 8 GB M2 (sizes from the Ollama library, checked 13 Oct)

| Model | Download | Role |
|---|---|---|
| `qwen3.5:4b-q4_K_M` | 3.3 GB | **Primary.** Same base Tinker fine-tunes, so before/after is a fair comparison |
| `qwen3.5:2b-q4_K_M` | 1.9 GB | Fallback if memory pressure goes red or latency > 10 s/line |
| `gemma3:4b` | ~3.3 GB | Optional comparison (you've run it on this Mac before) |
| `gemma4:e2b` / `e4b` | 4.3–4.6 / 6.1–6.6 GB | Avoid: too big next to the app on 8 GB |

One model loaded at a time, short prompts (≤ 8 candidates + rules ≈ 500–600 tokens), one line per call. Measured on this Mac (13 Oct, under heavy swap): model load ~15 s once, then ~200 prompt tokens/s and ~20 output tokens/s, i.e. 6–10 s/line with the old long reply. Close other apps before demos and measurements; watch Memory Pressure. Disk free after pulling the 4B model: ~7.6 GB.

## 7. Evaluation protocol (the harness)

1. **Collect** 60–100 real lines + the catalogue. Label them (`gold`) with the shopkeeper's answers, not yours.
2. **Lock the test set first:** `npm run split -- --in data/real/labelled.jsonl --test 30`. Writes `test.jsonl` + a hash lock. The harness refuses to score a test file that changed after locking.
3. **Tune only on `dev.jsonl`:** fuzzy thresholds, prompt wording, aliases.
4. **Run all four methods on the locked test set:** `npm run eval -- --catalog data/real/catalog.csv --cases data/real/test.jsonl --label base`.
   - `exact`: alias lookup + parser (what a careful spreadsheet does)
   - `fuzzy`: best trigram match if confident
   - `llm-full`: model sees the whole catalogue (≤ 80 items)
   - `llm-cand`: model sees fuzzy top-8 on every line
   - `hybrid`: fuzzy first; model (top-8) only when fuzzy can't name the product. **This is the product design**, and what the app calls.
5. **Metrics** (written to `results/summary.md` and per-run JSON with every row):

| Metric | Meaning | Target |
|---|---|---|
| auto-accept accuracy | answerable lines the tool got fully right with no human touch | as high as possible; beat fuzzy |
| **dangerous** | wrong rows auto-accepted + lines that needed a human but didn't get one | **0–1 of 30** |
| flag recall | of lines needing a human, share that were flagged | ≥ 90% |
| review load | share of lines sent to the operator | lower than fuzzy |
| recall@k | right product inside the candidates shown | ≥ 95% (else fix retrieval, not the model) |
| valid JSON first try, p50/p95 ms | reliability and speed on this Mac | report as measured |

6. **Per-tag table** for the post: which kinds of shorthand each method handles.

**Synthetic fixture runs (40 hand-written lines, Qwen3.5-4B Q4 on the M2 8 GB, 13 Oct).** The design below was changed after seeing failures on these lines, so they are now development data. Only the shop's locked real test set counts as evidence.

| version | method | auto-accept acc | **dangerous** | zero typing* | review load | model calls | p50 / line |
|---|---|---:|---:|---:|---:|---:|---:|
| baseline | exact | 43.8% | 0 | 43.8% | 65% | 0 | – |
| baseline | fuzzy | 78.1% | 0 | 78.1% | 37.5% | 0 | – |
| v2: model picks product from full catalogue | llm-full | 50.0% | **3** | – | 52.5% | 40 | 15.8 s (swapping) |
| v2: model picks from top-8 | llm-cand | 43.8% | **2** | – | 60% | 40 | 8.9 s (swapping) |
| v3: + code checks, best-guess suggestions | llm-cand | 78.1% | 1 | 87.5% | – | 40 | 4.7 s |
| **v3b: fuzzy first, model only on leftovers** | **hybrid** | **87.5%** | **0** | **93.8%** | **30%** | **11** | 4.0 s |

\*zero typing = answerable lines done automatically or by confirming a correct pre-filled suggestion with one tap.

What changed v2 → v3b, and why:
1. **Hybrid:** the model is called only when fuzzy matching can't name the product (11 of 40 lines). This keeps fuzzy's safe wins and cuts model time ~75%.
2. **Code checks on every pick:** a written price must equal the item's MRP ("parleg 10 wala" can't become the ₹5 pack); a written pack size must match the variant; when a line has two number+unit pairs, the one that is part of the product name is dropped ("maggi **4 pack** 1 petti" → 1 carton).
3. **The model may confirm a weak text match, not overrule a near-tie.** A model pick auto-accepts only if the order's words score it ahead of every other candidate by the same margin fuzzy needs (0.08). Otherwise it becomes a one-tap suggestion. This caught "lays 10 wala → Classic Salted", where the lead came from a shorter alias, not from the order.
4. **Best-guess suggestions:** the model always names its best candidate, so a flagged row is often "tap ✓" rather than "type".

**Locked synthetic test set (`data/synthetic/test.jsonl`, 80 lines, 29 need review, generated from a separate seed and locked before any model ran; see the data card).** One run, 13 Oct:

| method | auto-accept acc | dangerous | zero typing | flag recall | review load | model calls | model p50 / p95 |
|---|---:|---:|---:|---:|---:|---:|---:|
| exact | 52.9% | 0 | 52.9% | 100% | 66.3% | 0 | – |
| fuzzy | 86.3% | 0 | 86.3% | 100% | 45.0% | 0 | – |
| llm-cand | 86.3% | 0 | 92.2% | 100% | 45.0% | 80 | 8.4 s / 15.3 s |
| **hybrid** | **88.2%** | **0** | **94.1%** | **100%** | **43.8%** | **30** | **4.2 s / 4.8 s** |

The model's gain over fuzzy on this set is modest: +1 auto-accepted line and +3 one-tap suggestions (`amul butter aadha kilo`, `everest halddi`, `frooti 10 ka`). It missed `Sarf 500gm` and misread Devanagari `पारले जी 20 वाली` as Frooti (flagged, so safe). Fine-tuning would have to beat this on the same test.

Still unsolved (the alias-learning / fine-tuning target): "lays hara" (green pack = Cream & Onion) and the "tata namak" / "lays nila" near-ties, which are right but need one tap.

## 8. App (Thu–Fri)

Zero-dependency Node server (`node:http`) serving one HTML page that calls the same `run('hybrid', …)` pipeline. No Next.js, no Docker: it keeps disk and RAM free for the model.

1. **Catalogue:** load CSV, show validation errors (`loadCatalog` already reports them by row).
2. **Order:** paste text → table: original line | proposed item | qty | unit | status chip | reason/question. Green rows are pre-ticked; amber rows need a choice from the top-3 candidates or "not stocked".
3. **Export:** CSV per §4. Every amber row the operator resolves becomes an alias (`data/real/aliases_learned.csv`) so the same shorthand is exact-matched next time. That's learning from corrections with no training, which is worth showing in the post.

Storage: plain files in `data/real/` (catalogue, aliases, exported orders). Add SQLite only if needed.

## 9. Fine-tuning gate (Tinker, optional)

Fine-tune **only if all hold** after Wednesday's base run:
- `llm-cand` with base Qwen3.5-4B leaves ≥ 5 answerable test lines wrong or flagged, clustered in a few tags (e.g. hindi_name, colour_name);
- a toy LoRA from Tinker has been downloaded, converted and loaded with Ollama's `ADAPTER` on this Mac (prove the path on day 2 with a 10-example run);
- you have ≥ 200 training lines from `dev.jsonl` seeds + synthetic variants, and `npm run check-leak` passes.

Procedure: `npm run export-train -- --catalog … --in data/real/dev.jsonl,data/real/synthetic.jsonl --test data/real/test.jsonl` → `data/train/chat.jsonl` (same prompt + candidates as inference, assistant reply = target JSON) → LoRA on `Qwen/Qwen3.5-4B` in Tinker → adapter → Ollama `FROM qwen3.5:4b-q4_K_M` + `ADAPTER` → rerun eval with `--model parchi-ft`.

**Keep it** only if it beats the same base on the locked test set (≥ 10 points auto-accept, or half the review load) **without** more dangerous rows. Report base vs fine-tuned vs fuzzy in one table. Note: the adapter is trained on full-precision weights but runs on a 4-bit base, so measure; don't assume.

Verify against the Tinker docs before Wednesday: the expected chat-data format for its SFT loader, and the adapter download/conversion steps.

## 10. Prize categories (enter only what's real)

| Category | Condition |
|---|---|
| Overall | Always. Writing is weighted most: person, problem, before/after, results, failures, first user |
| Tinker ($200) | Only if §9 gate passes and the fine-tuned model runs locally |
| Gemma ($200) | Only if a Gemma model is the shipped decider (crowded) |
| Entire ($100) | If development sessions are captured with Entire and one checkpoint explains a real decision |
| Sentry Agent Tracing ($100) | Only with synthetic orders traced; never send real shop data |

## 11. Schedule

| Day | Do | Gate |
|---|---|---|
| Tue 13 | Install Ollama, pull `qwen3.5:4b-q4_K_M`, run fixture eval. Visit wholesaler: catalogue export + 60–100 real lines + their answers. | No real data by Wed morning → Supplier Delta fallback |
| Wed 14 | Label, `split`, run all methods on the locked test set. Toy Tinker round-trip. | Fine-tune decision (§9) |
| Thu 15 | Review UI + export + alias learning. Fine-tune if gated in. | One real order end-to-end |
| Fri 16 | Shopkeeper uses it on a live order; time it vs manual; ask what they'd pay. | Their biggest complaint fixed |
| Sat 17 | Offline demo video (Wi-Fi off), README, write and **publish** the DEV post. | Published |
| Sun 18 | Buffer only. | |

## 12. Risks

| Risk | Mitigation |
|---|---|
| Real orders are messier than the fixture (multi-item lines, totals, greetings) | Splitter on newlines/commas; non-item lines → ignored with a note; measure on real data before polishing UI |
| 4B too slow or memory pressure red | 2B fallback; one model; fewer candidates (k=5) |
| Shop data privacy | Real data stays in `data/real/` (gitignored); post uses synthetic or consented, anonymised lines |
| Overlap with "WhatsApp Order Ledger" entry | Differentiate on catalogue matching, numbers owned by code, measured zero-dangerous result |
| Tinker export path fails on this Mac | Gate in §9; ship base model and say so |
