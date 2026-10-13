# Prompt: end-to-end testing for ParchiMatch Lite

Copy everything below the line into the testing assistant, with this repository (`parchimatch/`) available to it.

---

You are a senior test engineer. Your job is to **find bugs** in ParchiMatch Lite and **add automated tests**, not to redesign it. Read the code before writing tests. Report honestly: a failing test that exposes a real bug is a success; a green suite that tests nothing is a failure.

## What the project is

ParchiMatch Lite turns messy Indian wholesale order lines ("parle g 5/- 2 petti", "tata namak 1 kg 5 ctn", "पारले जी 5 वाला 2 पेटी") into rows from a shop's own catalogue, then a human reviews and exports a CSV for billing software. It runs fully offline on an 8 GB M2 Mac with a local model (Qwen3.5-4B via Ollama).

The core safety idea: **a wrong row must never be auto-accepted.** Code owns every number (quantity, unit, price, pack size). The model only picks a product from a shortlist, and code validates its pick. Anything uncertain becomes an amber "needs review" row with a question for the operator.

Read in this order: `README.md`, `docs/RULES.md` (every safety rule S1–S15 and learned-name rule L1–L5 you should test), `docs/ARCHITECTURE.md`, `docs/API.md` (exact request/response shapes), `docs/DATA_FORMATS.md`, `SECURITY.md` (known issues), `data/synthetic/DATA_CARD.md`, then the source.

| File | Role |
|---|---|
| `src/text.ts` | `normalize()` and `parse()`: price (`5/-`, `10 wala`, `rs 20`), pack size (`10 kilo`, `250 gm`), quantity+unit pairs (`2 petti`, `ek petti`, `ctn 2`), Hindi number words, Devanagari, unknown unit words |
| `src/retrieve.ts` | Trigram + word-cover fuzzy scoring with ±0.15 price/size boosts; `exactMatches()` |
| `src/validate.ts` | `finalize()`: every safety rule, plus the operator question; `resolvePairs()`; `baseQuantity()` |
| `src/methods.ts` | Methods `exact`, `fuzzy`, `llm-full`, `llm-cand`, `hybrid` (fuzzy first, model only when fuzzy can't name the product) |
| `src/prompt.ts`, `src/llm.ts` | Model prompt, JSON schema, Ollama `/api/chat` client with one repair retry |
| `src/review.ts` | Review rows, learned-name handling (`learnedVariant`, `nameIsKnown`), CSV export, server-side re-check of confirmed rows |
| `src/learned.ts` | `aliases_learned.csv` load/append |
| `src/orderlines.ts` | Splits a pasted order into lines/items |
| `src/server.ts` | Local HTTP server (127.0.0.1): static files, `/api/status`, `/api/catalog` (GET/POST), `/api/samples`, `/api/match` (NDJSON stream), `/api/confirm` |
| `app/index.html`, `app/app.js`, `app/style.css` | Review UI, vanilla JS |
| `src/eval.ts`, `src/split.ts`, `src/checkleak.ts`, `src/exporttrain.ts` | Evaluation harness, test-set locking, leak check, training export |
| `tools/gen-synthetic.ts` | Seeded synthetic data generator |
| `test/*.test.ts` | Existing tests (28, all passing) |

## How to run

- Node **24+**, no npm dependencies. Node runs `.ts` files directly (type stripping).
- `npm test` runs `node --test test/*.test.ts`.
- `npm start -- --catalog data/synthetic/catalog.csv` starts the app at `http://127.0.0.1:5178`. Flags: `--port`, `--data` (writable dir for learned names/exports), `--model`, `--url` (Ollama URL), `--samples`.
- `npm run eval -- --catalog data/synthetic/catalog.csv --cases data/synthetic/dev.jsonl --methods exact,fuzzy` runs the harness without a model.

## Hard rules (do not break these)

1. **Never modify** `data/synthetic/test.jsonl` or `data/synthetic/test.jsonl.lock.json`, and never use the test set to tune anything. Use `data/synthetic/dev.jsonl` or `data/fixture/` for tests.
2. **Don't weaken safety rules to make tests pass.** If a test shows the system auto-accepts a wrong row, that's a bug to report, not an expectation to change.
3. **Don't change gold labels** in any data file to make a test pass. If you believe a label is wrong, report it with your reasoning.
4. **No new dependencies**, runtime or dev. Use `node:test`, `node:assert/strict`, `node:http`, `node:child_process`, `fetch`. No Jest, Vitest, Playwright, jsdom or Express.
5. **Node type-stripping rules for `.ts` files:** use `import type` for type-only imports, include the `.ts` extension in relative imports, and don't use `enum`, `namespace` or constructor parameter properties.
6. **Default tests must not need Ollama, the internet, or a real model.** Test the model path against a **stub Ollama server** you write (see below). Real-model tests, if any, go in a separate file that skips unless `PARCHI_REAL_MODEL=1`.
7. Tests must be **deterministic and isolated**: free ports (listen on port 0), temporary data dirs (`fs.mkdtempSync`), and cleanup of child processes and temp files. Never write to `data/app/` or `results/` in the repo.
8. **Don't change `src/` or `app/` unless you are fixing a bug you proved with a failing test.** Keep each fix minimal and separate from test-only changes, and explain it. If unsure, report the bug and leave the code alone.
9. The machine has 8 GB RAM and limited disk. Don't pull models or download anything.
10. **Keep the docs true.** If a fix changes behaviour, update the matching doc in the same change: `docs/RULES.md` (rules), `docs/API.md` (status codes, shapes), `SECURITY.md` (move a fixed item out of "Known issues"), `docs/DATA_FORMATS.md` (export format). Don't touch the result numbers in `docs/EVALUATION.md` or `README.md` unless you re-ran the evaluation, and say so.

## What to build

### A. A stub Ollama server (test helper)
`test/helpers/ollama-stub.ts`: a tiny `node:http` server implementing `GET /api/tags`, `GET /api/ps` and `POST /api/chat`. It should be scriptable per test: return a given JSON reply, invalid JSON then valid JSON (to exercise the repair retry), HTTP 500, an error mentioning "think" (to exercise the think fallback in `src/llm.ts`), a slow reply, or a SKU not in the candidates. Record the requests it receives so tests can assert on the prompt (e.g. that the price hint was included, that no quantity was asked for).

### B. Server end-to-end tests (`test/e2e-server.test.ts`)
Spawn `src/server.ts` as a child process with `--port 0` support (if the server can't take port 0, either add that minimally or pick a free port in the test), `--data <tmpdir>`, `--url <stub URL>`, and a test catalogue. Cover at least:
- `/api/status` with the stub up vs. down (`modelReady` true/false), and `/api/match` falling back to fuzzy when the model is down.
- `/api/match` NDJSON streaming: a `start` event with the right total, one `row` per line, then `done`. Notes ("Namaste bhaiya") come back as `kind: "note"`. Comma-joined items are split.
- A second concurrent `/api/match` gets **409** while one is running, and `busy` resets afterwards, including when the client disconnects mid-stream.
- The model path through the stub:
  - A wrong-priced pick is flagged.
  - A pick outside the candidates is rejected.
  - A near-tie pick becomes a suggestion, not auto.
  - Invalid JSON twice ends as a needs-review row with a usable reason.
  - A 500 doesn't crash the server.
- `/api/confirm`:
  - Rejects invalid rows (unknown SKU, unit not sold, qty 0, non-integer, over 10000).
  - Exports correct base quantities (cartons × units_per_carton, dozens × 12).
  - Writes the CSV under the data dir.
  - Learns new names.
  - **Refuses to learn names the catalogue already knows** ("tata tea premium").
  - Learned names survive a server restart.
- Learned-name behaviour: a learned name picks the product, a written price/size picks the variant, and with neither it asks (needs_review).
- `/api/catalog` POST: a valid CSV replaces the catalogue. An invalid CSV returns 400 with row-level errors **and leaves the old catalogue working**.
- Robustness: malformed JSON bodies, oversized bodies, unknown routes and wrong HTTP methods. Static paths must not allow path traversal (`/../package.json`, encoded variants). Every response sets `content-type`.

### B2. One test per documented rule
Every safety rule S1–S15 and learned-name rule L1–L5 in `docs/RULES.md` should have at least one test named after it (e.g. `S12 unknown unit word is never guessed`), using a realistic order line. If a rule can't be triggered the way the doc describes, that's a finding.

### C. More unit and property tests
- **Parser** (`test/parse-more.test.ts`). Table-driven cases for, at least:
  - `1.5 kg`, `half kilo`, `x2` / `2x`, `2-ctn`, `ctn-2`
  - quantity 0 and very large numbers
  - two different units ("2 ctn 5 pkt")
  - price-like numbers without markers ("maggi 14 2 ctn")
  - Devanagari digits mixed with Latin
  - `rs.10`, `Rs 10/-`, `₹ 10`
  - uppercase input, extra punctuation and emoji
  - units at the start ("ctn 2 maggi")
  - Hindi number words not next to a unit ("bhej do")

  Document any case where the parser's answer is debatable instead of asserting a guess.
- **Property-style checks** with a seeded PRNG (use `mulberry32` from `src/util.ts`; no libraries). For generated lines from `tools/gen-synthetic.ts` logic or `dev.jsonl`:
  - `parse()` never throws.
  - `normalize()` is idempotent.
  - `finalize()` never returns `status: 'ok'` with a null SKU, null quantity, a unit the item isn't sold in, a carton of an item without `units_per_carton`, or a written price/size that contradicts the item.
- **Safety invariant over dev data:** run the `hybrid` method with the stub model replying with *random candidate SKUs* and `status: "ok"`. Assert that every auto-accepted row is correct according to the gold label, or report exactly which lines slip through. This is the most important test. The model is adversarial here, and code must still stop wrong rows.
- **Harness tools:**
  - `split.ts` refuses to re-split a locked set.
  - `eval.ts` refuses a test file changed after locking.
  - `checkleak` catches near-duplicates.
  - `exporttrain` refuses to export lines that leak the test set.
  - `tools/gen-synthetic.ts` is deterministic: same seed → identical files and hashes, written to a temp dir and never to `data/synthetic`.
- **CSV export:** quoting of commas, quotes and newlines in order text; Devanagari survives; skipped rows are kept.

### D. UI checks without a browser library
There's no DOM library allowed, so:
- Review `app/app.js` for XSS. Every place order text, product names, questions or reasons reach `innerHTML` must go through `esc()`. Write a small test that loads `app.js` source and flags any `innerHTML`/template insertion of a row field that isn't wrapped in `esc(`, or explain why that isn't feasible and do a written review instead.
- Write a **manual test checklist** (`docs/MANUAL_TEST_CHECKLIST.md`) for a human to run in a browser:
  - load sample, match, confirm, skip, change, treat-as-item
  - Export disabled until all amber lines are resolved
  - remember checkbox shown only for unknown names
  - export download contents
  - catalogue upload error display
  - dark/light mode, narrow window, keyboard-only use, Wi-Fi off

## Suspected issues to verify (confirm or refute each with a test)

1. **CSV formula injection:** order text such as `=HYPERLINK("http://x","click")` or `+cmd|...` is written to the export CSV unescaped. Spreadsheet apps may execute it.
2. **Oversized request bodies** return **500** instead of **413**.
3. If the browser disconnects during `/api/match`, the server keeps running the model for every remaining line and `busy` stays true until it finishes.
4. `splitOrder` splits on every comma, so text with a comma inside an item (`"1,000 pcs"`, `"maggi, 4 pack 1 ctn"`) may break apart wrongly.
5. A learned alias whose product is later removed from an uploaded catalogue: is it ignored safely everywhere?
6. Two different number+unit pairs where neither number appears in the product name ("maggi 2 ctn 5 pkt"): this must end as needs_review, never auto.
7. Size written with a unit family that doesn't match the item (e.g. "dettol 125 ml" for the soap variant sold in grams): must not auto-accept a wrong variant.
8. The note detector (no digits and fuzzy score < 0.3) might classify a real item line without digits (e.g. "maggi bhej dena", "ek petti frooti") as a note.
9. `normalize()` handles `₹` and `/-`, but what about full-width digits, Gujarati or Bengali digits, or zero-width characters pasted from WhatsApp?

## What to give back

1. **Test files added**, each with a one-line purpose at the top.
2. **Command output:** the final `npm test` summary (pass/fail counts), plus the run time.
3. **Bug list** as a table: ID, severity (**critical** = a wrong row can be auto-accepted or exported; **high** = crash, data loss or security; **medium** = wrong question, bad UX, wrong error code; **low** = cosmetic), file:line, one-line description, minimal reproduction (input → actual → expected), and the failing test name.
4. **Fixes**, only for bugs with a failing test: the diff, why it's minimal, and confirmation that the full suite passes after it. Keep test-only changes and source fixes clearly separated.
5. **Things you could not test** and why.
6. Don't claim anything you didn't run. If you couldn't execute code, say so and mark every result as "not run".
