# Evaluation

How ParchiMatch Lite is measured, the results so far, and how to measure it on real data.

## Metrics

Each labelled line ends in exactly one outcome:

| Outcome | Gold | System | Cost |
|---|---|---|---|
| `auto_correct` | ok | ok, and product + qty + unit all right | none |
| `auto_wrong` | ok | ok, but something wrong | **a wrong row on the bill** |
| `flagged_answerable` | ok | needs_review | one operator action |
| `flagged_correctly` | needs_review | needs_review | the question was needed |
| `missed_flag` | needs_review | ok | **a wrong or unchecked row on the bill** |

| Metric | Definition | Target |
|---|---|---|
| **Dangerous** | (`auto_wrong` + `missed_flag`) / all lines | **0** |
| Auto-accept accuracy | `auto_correct` / answerable lines | High |
| Zero typing | (`auto_correct` + flagged lines whose pre-filled suggestion was fully right) / answerable lines | High |
| Suggestion accuracy | flagged answerable lines with a fully right suggestion / flagged answerable lines | High |
| Flag recall | `flagged_correctly` / lines that need review | ≥ 90% |
| Review load | lines sent to the operator / all lines | Low |
| Recall@k | correct product inside the k candidates shown to the model | ≥ 95% (otherwise fix retrieval, not the model) |
| Valid JSON first try, p50/p95 latency, model calls | Reliability and speed of the model path | Report as measured |

Every run also writes a **per-tag** breakdown (e.g. how each method does on `hindi_name` or `devanagari` lines).

## Methods compared

| Method | What it does |
|---|---|
| `exact` | Catalogue name/alias appears word-for-word, narrowed by price/size |
| `fuzzy` | Best trigram match if score ≥ 0.5 and lead ≥ 0.08 |
| `llm-full` | Model sees the whole catalogue (≤ 80 items) on every line |
| `llm-cand` | Model sees fuzzy's top 8 on every line |
| `hybrid` | Fuzzy first; model only when fuzzy can't name the product. **This is what the app uses** |

All methods pass through the same safety rules ([RULES.md](RULES.md)).

## Protocol

1. **Label** lines with what a careful shopkeeper would conclude ([format](DATA_FORMATS.md#labelled-order-lines-jsonl)).
2. **Lock a test set before any tuning:**
   ```bash
   npm run split -- --in data/real/labelled.jsonl --test 30
   ```
   This writes `test.jsonl`, `dev.jsonl` and a hash lock, stratified by status. Re-splitting a locked set is refused.
3. **Tune only on `dev.jsonl`:** thresholds, prompts, parser words, aliases.
4. **Score the locked set once per change you want to report:**
   ```bash
   npm run eval -- --catalog data/real/catalog.csv --cases data/real/test.jsonl --label my-change
   ```
5. **Read the failures,** but fix them using dev data.

## Data used so far

| Set | Lines | Origin | Status |
|---|---:|---|---|
| `data/fixture/test.jsonl` | 40 | Hand-written | **Development only.** The design was changed after seeing its failures |
| `data/synthetic/dev.jsonl` | 320 | Generator, seed 2028 | Development |
| `data/synthetic/test.jsonl` | 80 (29 need review) | Generator, separate seed 2027, locked before any model ran | **Held-out** |

How the synthetic data was made, and its limits, are in [`data/synthetic/DATA_CARD.md`](../data/synthetic/DATA_CARD.md). In short: it's held out from the system, but not from the author's assumptions.

## Results

### Locked synthetic test: current code (80 lines, 13 Oct 2026, after the external test pass)

| Method | Auto-accept acc | Dangerous | Zero typing | Flag recall | Review load | Model calls | Model p50 / p95 |
|---|---:|---:|---:|---:|---:|---:|---:|
| exact | 54.9% | 0 | 54.9% | 100% | 65.0% | 0 | – |
| fuzzy | 84.3% | 0 | 84.3% | 100% | 46.3% | 0 | – |
| llm-cand | 82.4% | 0 | 88.2% | 100% | 47.5% | 80 | 7.8 s / 23.3 s |
| **hybrid** | **86.3%** | **0** | **92.2%** | **100%** | **45.0%** | **31** | **5.1 s / 6.7 s** |

Model: `qwen3.5:4b-q4_K_M`, temperature 0, thinking off, top-8 candidates, MacBook Air M2 8 GB. The Mac was swapping heavily during this run (about 8 GB of swap), so latency is pessimistic. `llm-cand` had one model error and 98.8% valid JSON on the first try; `hybrid` had none.

**Reading it honestly:** the safety design held, since no method let a wrong row through. The model's gain over fuzzy is modest: one more automatic line (`thmusup 2ltr pc 6`) and three correct one-tap suggestions (`amul butter aadha kilo`, `everest halddi`, `frooti 10 ka`). It missed `Sarf 500gm` and misread Devanagari `पारले जी 20 वाली` as Frooti. On `5 sttar 20 wala 5box` the parser no longer finds product words, and the model's suggestion was nonsense (Aashirvaad Atta). All three were flagged, so they're safe but cost the operator a choice.

**What changed since the first run.** The external test pass ([TEST_REPORT.md](TEST_REPORT.md)) fixed 25 safety and robustness findings. One of them made the parser stricter about numbers followed by unknown words. That costs one locked-test line (`5 sttar…`, now asked about) and is why every method is slightly lower than before. That line was **not** fixed afterwards, because it comes from the locked test set.

| Method (first run, before the test pass) | Auto-accept acc | Dangerous | Zero typing | Model calls | Model p50 / p95 |
|---|---:|---:|---:|---:|---:|
| exact | 52.9% | 0 | 52.9% | 0 | – |
| fuzzy | 86.3% | 0 | 86.3% | 0 | – |
| llm-cand | 86.3% | 0 | 92.2% | 80 | 8.4 s / 15.3 s |
| hybrid | 88.2% | 0 | 94.1% | 30 | 4.2 s / 4.8 s |

### Development set (40 hand-written lines): how the design evolved

| Version | Method | Auto-accept acc | Dangerous | Review load | Model calls |
|---|---|---:|---:|---:|---:|
| baseline | fuzzy | 78.1% | 0 | 37.5% | 0 |
| model picks product, full catalogue | llm-full | 50.0% | **3** | 52.5% | 40 |
| model picks product, top 8 | llm-cand | 43.8% | **2** | 60% | 40 |
| + code checks, suggestions | llm-cand | 78.1% | 1 | – | 40 |
| **+ fuzzy first, near-tie margin** | **hybrid** | **87.5%** | **0** | **30%** | **11** |

These numbers are from data the design was tuned on, so they show the direction of each change, not final performance.

## Fine-tuning gate

Fine-tune (e.g. a LoRA of `Qwen/Qwen3.5-4B` on Tinker) **only if all hold**:

1. Base `hybrid` leaves at least 5 answerable test lines flagged or wrong, clustered in a few tags (e.g. `hindi_name`, `colour_name`, `devanagari`).
2. A toy adapter has been downloaded, converted, and loaded in Ollama on the target machine.
3. There are ≥ 200 training lines from `dev.jsonl` seeds and synthetic variants, and `npm run check-leak` passes.

Then:
```bash
npm run export-train -- --catalog <catalog.csv> --in data/real/dev.jsonl,data/real/synthetic.jsonl --test data/real/test.jsonl
```

Train, load the adapter in Ollama (`FROM qwen3.5:4b-q4_K_M` + `ADAPTER …`), and re-run the eval with `--model <name>`. **Keep it only if** it beats the same base model on the locked test (≥ 10 points auto-accept, or half the review load) **with no more dangerous rows.**

## Recommended next measurement: a human-written test set

The synthetic generator encodes one author's idea of shorthand. The cheapest independent test:

1. Show 3–5 people a list of 15 catalogue items.
2. Ask each to type the order as they'd really WhatsApp it to a supplier. Show no examples.
3. Label their lines, lock them as `data/human/test.jsonl`, and run every method once.

## Commands

| Command | Purpose |
|---|---|
| `npm test` | Unit and integration tests |
| `npm run eval:baselines` | exact + fuzzy on the fixture |
| `npm run eval -- --catalog … --cases … --methods exact,fuzzy,hybrid,llm-cand --label …` | Full comparison |
| `npm run split -- --in … --test 30` | Lock a held-out test set |
| `npm run check-leak -- --test … --candidate …` | Near-duplicate check |
| `npm run export-train -- …` | Fine-tuning data |
| `node tools/gen-synthetic.ts --out data/synthetic --dev-only` | Regenerate synthetic dev data (the locked test set is kept) |

Useful eval flags: `--model`, `--k` (candidates, default 8), `--min-score` (0.5), `--min-margin` (0.08), `--ctx` (2048), `--think`, `--limit`, `--show`.
