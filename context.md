# Context

Everything an agent or collaborator needs to work on ParchiMatch Lite without re-reading the whole history. Current as of **13 Oct 2026**. Tasks live in [task.md](task.md).

## What it is

Small FMCG wholesalers in India receive orders as messy WhatsApp/phone lines (`parle g 5/- 2 petti`, `tata namak 1 kg 5 ctn`, `पारले जी 5 वाला 2 पेटी`), and someone retypes each line into billing software (Tally/Busy/Marg). **ParchiMatch Lite** reads each line, matches it to the shop's own catalogue, and either fills in a checked row (green) or asks one short question with a pre-filled suggestion (amber). Greetings and notes are greyed out. It exports a CSV for manual import.

**The one principle:** *a wrong row must never be auto-accepted; when unsure, ask one short question.* The key metric is **dangerous rows**: wrong rows auto-accepted plus lines that needed a human but didn't get one. Target: 0.

It's an entry for the **DEV Hacktoberfest 2026 Open-Source AI Challenge, Week 2 ("Side Hustle")**: build something with open-source AI at its core that someone would pay for. Writing quality is judged most heavily. Deadline: **Mon 19 Oct 2026, 12:29 PM IST**; target publish date Sat 17 Oct.

Repository: `https://github.com/bipul724/parchimatch` (MIT). Public site (static, in `site/`): `https://bipul724.github.io/parchimatch/` once GitHub Pages is enabled.

## How it works

```
order text → splitOrder → parse (code reads every number) → fuzzy match
   → confident? ── yes ──────────────────────────────┐
   → no → local model picks a product from top 8 ───→ finalize(): 16 safety rules → green / amber
```

- **Parser** (`src/text.ts`): price hints (`5/-`, `10 wala`, `rs 20`), pack sizes (`10 kilo`, `250 gm`), quantity+unit pairs (`2 petti`, `ek petti`, `ctn 2`), Hindi number words (only directly before a unit), Devanagari, unknown unit words, and numbers inside catalogue names (`5 star`).
- **Fuzzy matching** (`src/retrieve.ts`): trigram + word cover, ±0.15 price/size boosts. Accept if score ≥ 0.5 and lead ≥ 0.08.
- **Hybrid** (`src/methods.ts`): the model is called only when fuzzy can't name the product (about 1 in 3 lines).
- **Model** (`src/prompt.ts`, `src/llm.ts`): Ollama `/api/chat`, JSON schema `{evidence, sku, status}`, temperature 0, thinking off, 2048 context, one repair retry, cancellation.
- **Safety rules** (`src/validate.ts`, listed in `docs/RULES.md`): S1–S16. Examples: a written price must equal the MRP; a written size must match the variant; code resolves quantities; unknown unit words and unclear commas (`1,5`) are never guessed; cartons need a known carton size; a model pick auto-accepts only if the order's own words favour it by ≥ 0.08 over every other candidate.
- **Learning** (`src/learned.ts`, `src/review.ts`): the operator can save a new name ("lais peela" = Lay's Classic Salted). It maps to the product family, not one pack size. Names the catalogue already knows are never learned.
- **App** (`src/server.ts`, `app/`): Node `node:http` on 127.0.0.1:5178, NDJSON streaming rows, vanilla HTML/JS review page, CSV export with base quantities and formula-safe cells.

## Stack

TypeScript run directly by **Node 24** (type stripping), **zero npm dependencies**, `node:test`, plain HTML/CSS/JS, plain CSV/JSONL files, **Ollama 0.40** with **`gemma4:e2b-it-qat`** (default since 13 Oct; 4.3 GB download). Built and measured on a **MacBook Air M2, 8 GB RAM**. Disk was freed to ~77 GB, but **RAM is the binding constraint**.

## Key decisions (with evidence)

1. **Code owns every number; the model only picks the product.** In the first trial the model turned "petti" into "packet" in 3 of 4 lines.
2. **Hybrid, not model-on-every-line.** On development data, the model on every line was *worse* than plain fuzzy matching (2–3 wrong rows). Hybrid plus code checks reached 0.
3. **Near-tie margin for model picks (0.08).** It caught "lays 10 wala → Classic Salted", whose lead came only from a shorter alias.
4. **Learning without training**, guarded by rules L1–L5. After learning two names, sample order 03 went from 6 to 8 automatic lines and 28.8 s to 5.3 s.
5. **Default model = Gemma 4 E2B** (13 Oct bake-off, chosen on the 320 practice lines, confirmed once on the locked test).

   | Model (practice set, hybrid) | Memory | Auto | Wrong | No typing | Suggestion acc | p50 / p95 |
   |---|---:|---:|---:|---:|---:|---:|
   | **gemma4:e2b-it-qat** | 3.6 GB | 88.7% | 0 | **96.1%** | **65.2%** | 3.1 / 9.2 s |
   | qwen3.5:2b-q4_K_M | 1.6 GB | 88.7% | 0 | 94.6% | 52.2% | 2.5 / 3.3 s |
   | gemma3:4b | 2.8 GB | 88.7% | 0 | 95.6% | 60.9% | 5.3 / 8.4 s |
   | qwen3.5:4b-q4_K_M (previous default) | 3.1 GB | 88.2% | 0 | 95.6% | 62.5% | 5.2 / 8.4 s |
   | gemma4:e4b-it-qat (40-line speed check) | 6.0 GB | – | 0 | – | – | 5.6 / **37 s** |

   The pre-declared rule (zero wrong → most automatic → fastest) favoured Qwen 2B. The owner chose Gemma 4 E2B for its better operator-facing numbers and eligibility for "Best Use of Gemma". The difference is 1–3 lines, which is within noise. Qwen 2B is the documented fast alternative (`--model qwen3.5:2b-q4_K_M`).
6. **Zero dependencies and plain files**, because of the 8 GB RAM / small-disk machine and so a shopkeeper can open every file.
7. **Measure before claiming:** a locked held-out test set, tuning only on practice data, a leak check, and a seeded synthetic data generator.

## Current results (locked synthetic test, 80 lines, 29 need review)

| Method | Auto-accept | Dangerous | No typing | Review load | Model calls | Model p50 / p95 |
|---|---:|---:|---:|---:|---:|---:|
| exact | 54.9% | 0 | 54.9% | 65.0% | 0 | – |
| fuzzy | 84.3% | 0 | 84.3% | 46.3% | 0 | – |
| **hybrid · gemma4:e2b-it-qat** | **88.2%** | **0** | **92.2%** | **43.8%** | **31** | **2.2 / 2.8 s** |
| hybrid · qwen3.5:4b (previous) | 86.3% | 0 | 92.2% | 45.0% | 31 | 5.1 / 6.7 s (under swap) |

Plus: 170 automated tests; an adversarial run (a fake model making random picks over 320 practice lines, 1,265 calls) let 0 wrong rows through.

**The data is synthetic.** `tools/gen-synthetic.ts` (seed 2026) generated a 111-item catalogue (61 families), 320 practice lines (`data/synthetic/dev.jsonl`) and 80 locked test lines (`data/synthetic/test.jsonl`, sha256 `a0c35e04…`). No real shop has used the tool yet. See `data/synthetic/DATA_CARD.md`.

## Constraints and rules

- **8 GB RAM:** one model at a time; anything ≥ ~6 GB swaps and is too slow. Close other apps before evaluations and demos. Unload the model after runs (`keep_alive: 0`).
- **Locked test set:** never edit it, never tune on it. Choose on practice data, then confirm once on the locked set. Only the reviewer runs it.
- **Privacy:** runtime talks only to 127.0.0.1. Shop data folders are gitignored (`data/real/`, `data/human/`, `data/app/`, `data/train/`, `results/`).
- **Honesty:** call the data synthetic; never invent shops, users, testimonials or savings; keep limitations visible.
- **Git:** the owner commits and pushes manually. **No AI co-author or "Generated with" lines** in commits or PRs.
- **Code:** no dependencies; Node type-stripping rules; test-first bug fixes; never weaken a safety rule; keep docs true. Details are in `CONTRIBUTING.md` and `docs/RULES.md`.

## Known limitations / open items

- A comma inside an item's description splits it into two rows (`maggi, 4 pack 1 ctn`). Commas inside numbers are handled (`1,500`, `1,00,000`; unclear ones like `1,5` are asked about; fixed in A1).
- A misspelled name containing a number (`5 sttar`) is asked about (task A6, blocked).
- No real-browser click-through since the test pass (U1), no human-written test set yet (A4/U2/C8), no real shop.
- The local server has no authentication (single-user desktop tool by design).

## Where things are

| Path | What |
|---|---|
| `src/` | Pipeline, server, harness |
| `app/` | Review UI |
| `test/` | 170 tests; `test/helpers/ollama-stub.ts`; `test/evidence/` (audit trail) |
| `data/synthetic/`, `data/fixture/` | Benchmark data (synthetic) |
| `tools/gen-synthetic.ts` | Data generator |
| `docs/` | Architecture, API, design, rules, deploy, data formats, evaluation, troubleshooting, test report, manual checklist |
| `site/` | Static public site + `CLAIMS.md` (every claim with its source); deployed by `.github/workflows/pages.yml` |
| `SPEC.md` | Original build plan (historical; numbers there are from early development) |

## Commands

```bash
npm test
npm start -- --catalog data/synthetic/catalog.csv          # http://127.0.0.1:5178
npm run eval -- --catalog data/synthetic/catalog.csv --cases data/synthetic/dev.jsonl --methods exact,fuzzy,hybrid
ollama pull gemma4:e2b-it-qat
```
