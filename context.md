# Context

Everything an agent or collaborator needs to work on ParchiMatch Lite without re-reading the whole history. **Last updated: 13 Oct 2026 (night IST), after the A7/A8/A3/A5/A4 review.** Tasks live in [task.md](task.md). If this file and the code disagree, the code wins, so fix this file.

---

## 0. Snapshot (read first)

| Item | State |
|---|---|
| Deadline | **Mon 19 Oct 2026, 12:29 PM IST** (= Sun 18 Oct 11:59 PM PDT). Target publish **Sat 17 Oct**. |
| Challenge | DEV Hacktoberfest 2026 Open-Source AI Challenge, **Week 2 "Side Hustle"** (challenge id 80). Tag `#hf26challenge` + `#devchallenge`. Writing quality is weighted most. The owner is registered for Week 2. |
| Repo | `https://github.com/bipul724/parchimatch`, branch `main`. HEAD = `5b11d4e docs: detailed handoff in context.md` (pushed). |
| Uncommitted work | Coding agent's **A7, A8, A3, A5, A4**: all **reviewed and accepted by Claude on 13 Oct** and waiting for the owner to commit. New files: `src/start.ts` (`npm run app`), `src/label.ts` (`npm run label`), `test/cli-flags.test.ts`, `test/start.test.ts`, `test/label.test.ts`. |
| Tests | `npm test` → **205 pass, 0 fail** (Node 24.3.0) after A12. |
| Locked test set | `data/synthetic/test.jsonl` unchanged (sha256 `a0c35e04…`, lock file `test.jsonl.lock.json`). |
| Default model | `gemma4:e2b-it-qat` (since the 13 Oct bake-off). Pulled locally: gemma4:e2b-it-qat, gemma4:e4b-it-qat, gemma3:4b, qwen3.5:2b-q4_K_M, qwen3.5:4b-q4_K_M. |
| Site | `site/` (static, 7 pages) + `.github/workflows/pages.yml`. GitHub Pages is **not enabled yet** (owner task U4). Canonical URLs point to `https://bipul724.github.io/parchimatch/`. |
| DEV post | **Not drafted yet** (C7). Nothing published. |
| Human-written test set | Not collected yet (U2 → A4 → C8). |

**Immediate next steps:**
1. The owner commits the reviewed A7/A8/A3/A5/A4 batch.
2. A9 is done and reviewed (eval numeric-flag checks; the labeller's status question has no default; 8 candidates sorted by name, numbers by value, no scores). It's waiting for the owner to commit.
3. C5 is done: the final locked-test run matched C2, and the latency and test count (191) are updated in EVALUATION, DESIGN, the site and CLAIMS.
4. C6 is done: A6 won't be fixed (no practice evidence); it stays a known limitation. A10 (fresh-clone check) is done. A11 is done too (195 tests). **Code is frozen for the entry:** from now on, only bug fixes go in, reviewed the same way.
5. Draft the DEV post as an unpublished draft (C7), only on the owner's yes.
6. Remind the owner of U1 (browser checklist, which also covers `--open` and the base quantities), U2 (friends' orders), U3 (demo video), U4 (GitHub Pages).

---

## 1. What it is

Small FMCG wholesalers in India receive orders as messy WhatsApp/phone lines (`parle g 5/- 2 petti`, `tata namak 1 kg 5 ctn`, `पारले जी 5 वाला 2 पेटी`), and someone retypes each line into billing software (Tally/Busy/Marg). **ParchiMatch Lite** reads each line, matches it to the shop's own catalogue, and either fills in a checked row (green) or asks one short question with a pre-filled suggestion (amber). Greetings and notes are greyed out. It exports a CSV for manual import (no direct Tally/Busy integration).

**The one principle:** *a wrong row must never be auto-accepted; when unsure, ask one short question.* The key metric is **dangerous rows**: wrong rows auto-accepted plus lines that needed a human but didn't get one. Target: 0.

## 2. How it works

```
order text → splitOrder → parse (code reads every number) → fuzzy match
   → confident? ── yes ──────────────────────────────┐
   → no → local model picks a product from top 8 ───→ finalize(): 16 safety rules → green / amber
```

- **Splitter** (`src/orderlines.ts`): lines, commas and semicolons; never splits at a comma with a digit on both sides (A1).
- **Parser** (`src/text.ts`):
  - price hints (`5/-`, `10 wala`, `rs 20`), pack sizes (`10 kilo`, `250 gm`), quantity+unit pairs (`2 petti`, `ek petti`, `ctn 2`);
  - Hindi number words (only directly before a unit), Devanagari, and Gujarati/Bengali digits;
  - unknown unit words (`10 jodi`), and numbers inside catalogue names (`5 star`, via `numberNamePhrases()` in `src/catalog.ts`);
  - number groupings: Western `1,500` and Indian `1,00,000` become one number; an unclear `1,5` goes into `Parsed.unclearNumber`.
- **Fuzzy matching** (`src/retrieve.ts`): trigram + word cover, ±0.15 price/size boosts. Accept if score ≥ 0.5 and lead ≥ 0.08.
- **Hybrid** (`src/methods.ts`): the model is called only when fuzzy can't name the product (31 of 80 locked-test lines; 113 of 320 practice lines).
- **Model** (`src/prompt.ts`, `src/llm.ts`): Ollama `/api/chat`, JSON schema `{evidence, sku, status}`, temperature 0, seed 7, thinking off, 2048 context, one repair retry, AbortController cancellation.
- **Safety rules** (`src/validate.ts` → `finalize()`, listed in `docs/RULES.md`): **S1–S16**. For example:
  - a written price must equal the MRP, and a written size must match the variant;
  - code resolves quantities (S7);
  - unknown unit words (S12) and unclear commas (S16) are never guessed; quantity must be 1–10000 (S11);
  - cartons need a known carton size (S15);
  - a model pick auto-accepts only if the order's own words favour it by ≥ 0.08 over every other candidate (S10).
- **Learning** (`src/learned.ts`, `src/review.ts`): the operator can save a new name ("lais peela" = Lay's Classic Salted). Rules L1–L5:
  - only unknown names can be learned (`nameIsKnown`), and only from explicitly confirmed rows;
  - a name maps to the product family, and price/size still choose the variant.
- **App** (`src/server.ts`, `app/`): `node:http` on 127.0.0.1:5178, NDJSON streaming rows, a single-order guard with cancellation, 400/413 handling. Vanilla HTML/JS review page. CSV export with base quantities and formula-safe cells; unique export filenames.
- **Catalogue at start (A2):**
  1. an explicit `--catalog` wins;
  2. otherwise `<data>/catalog.csv`, if a catalogue was uploaded in the app and is valid;
  3. otherwise `data/synthetic/catalog.csv`, with a warning.

## 3. Stack and environment

- **Code:** TypeScript run directly by **Node 24** (type stripping), **zero npm dependencies**, `node:test`, plain HTML/CSS/JS, plain CSV/JSONL files.
- **Model runtime:** **Ollama 0.40.3** (Homebrew service; after an upgrade, `brew services restart ollama`).
- **Machine:** **MacBook Air M2, 8 GB RAM.** About 61 GB of disk free at snapshot. **RAM is the binding constraint:** the 3–4 GB models push macOS into several GB of swap during evaluations. Unload models after runs, and close other apps before evaluations and demos.
- **Node:** `/opt/homebrew/bin/node` v24.3.0. The owner had nvm earlier; Homebrew Node is what's used now.
- **Files outside the repo** (in `/Users/bipulchamoli/Desktop/untitled folder 2/`, deliberately not committed):
  - `CODING_AGENT_PROMPT.md`: the prompt the owner gives their coding agent.
  - `LANDING_PAGE_PROMPT.md`: the prompt used for ChatGPT to build `site/`.
  - `.claude/launch.json`: preview configs `parchimatch` (app on 5178) and `site` (python static server on 5180, `--directory parchimatch/site`).
- **Memory:** the owner doesn't want AI attribution in git (see §8).

## 4. Roles and workflow

| Who | Does |
|---|---|
| **Owner (Bipul)** | Real-world tasks (recording, people, publishing), commits and pushes **manually**, final yes/no on anything public. |
| **Coding agent** (owner's separate AI; prompt in `CODING_AGENT_PROMPT.md`) | Implements `Agent` tasks from `task.md` one at a time, test-first. Sets status `doing` → `review`. Hands back a fixed-format report. It may not touch the locked test set, add dependencies, pull models, commit, change result numbers, or edit `context.md`/`site/`. |
| **Claude (reviewer/decider)** | Reviews every agent change (§5), runs evaluations, makes product/technical decisions and writes them into `task.md`. Keeps docs, `context.md`, `site/` and the numbers true. Gives the owner commit commands (no AI lines). Only Claude marks tasks `done`. |

**Loop:** agent works a task → owner pastes the handoff report → Claude reviews and decides → Claude updates `task.md` and docs → owner commits the reviewed batch → the agent continues.

**Agent work order:** A7 → A8 → A3 → A5 → A4 → A9 were all done on 13 Oct. No code tasks are open. A6 is blocked (Claude decides on dev evidence).

## 5. How Claude reviews an agent task (procedure that worked)

1. `git status --short` and `git diff` the touched files. Read the code, not just the report.
2. Run `npm test` (all of it) and confirm the locked test hash:
   `python3 -c "import hashlib,json;t=open('data/synthetic/test.jsonl','rb').read();l=json.load(open('data/synthetic/test.jsonl.lock.json'));print(hashlib.sha256(t).hexdigest()==l['sha256'])"`
3. Run the task's acceptance lines through the real pipeline with a scratch script (`run('fuzzy', line, makeCtx(loadCatalog(...)))`, plus `splitOrder`). Add your own edge cases.
4. **Old-vs-new comparison** for anything touching parsing or matching:
   - get the committed code with `git archive HEAD src package.json | tar -x -C <scratch>/old`;
   - run `src/eval.ts --methods exact,fuzzy` for both old and new on `data/synthetic/dev.jsonl`, `data/fixture/test.jsonl` (with `data/fixture/catalog.csv`) and `data/synthetic/test.jsonl`;
   - compare per-line outcome/sku/qty/unit/status. Expect 0 changes except the intended ones.
   - Looking at locked-test **differences** to report them is OK; **changing code because of a locked-test line is not** (that's tuning on the test set).
5. Check the agent's doc edits for accuracy. Then update `task.md` (status + a "Review" note), `context.md`, the `site/` numbers, `site/CLAIMS.md`, and test-report notes as needed.
6. Give the owner grouped commit commands (no AI attribution) and a short message to paste back to the agent.

## 6. Decision log

| Date | Decision | Why / evidence |
|---|---|---|
| 13 Oct | Project idea: ParchiMatch (wholesale order matching) over TruckStock / Supplier Delta / PrintProof | Real Indian shorthand problem; clear AI job; local/private story. Compared against a ChatGPT plan; merged the best of both. |
| 13 Oct | Code owns every number; the model only picks the product | Qwen 4B turned "petti" into "packet" in 3 of 4 lines. |
| 13 Oct | Hybrid (fuzzy first) + near-tie margin 0.08 for model picks | Model-on-every-line had 2–3 dangerous rows on dev; hybrid had 0. |
| 13 Oct | Learning guardrails L1 (only unknown names) and L2 (product family) | A test run learned "tata tea premium" → 250 g, which would have auto-accepted the wrong size forever. |
| 13 Oct | No real shop available → **synthetic benchmark** with a seeded generator, test locked before any model ran | The owner had no shop access. Honesty rules: never present the data as real; no invented users. |
| 13 Oct | Accepted ChatGPT's external test pass (25 fixes, 149 tests) + Claude's follow-up fix for numbers in names (`5 Star`) | The pass's P12 change had wiped product names containing numbers. |
| 13 Oct | Didn't fix `5 sttar…` | It comes only from the locked test set (A6 blocked until dev evidence exists). |
| 13 Oct | **Default model → Gemma 4 E2B** | Bake-off on 320 practice lines (table in §7), then confirmed once on the locked test. The pre-declared rule favoured Qwen 2B (fastest); the owner chose Gemma 4 E2B for operator-facing numbers + Gemma prize eligibility. Bigger models don't fit 8 GB RAM (E4B 37 s worst-case). |
| 13 Oct | **A1 widened**: never split digit-comma-digit, join Western/Indian groupings, new **S16** for unclear commas | The agent proved the original A1 would let `maggi 2,500 pkt` go green as 500. Claude found today's split already turned `aashirvaad atta 10 kg 1,500 bag` into **green 1 bag** (critical). Old-vs-new on 440 lines × 2 methods: 0 other changes. |
| 13 Oct | A2: explicit `--catalog` > saved upload > default | Uploaded catalogue was lost on restart (HTTP-08). |
| 13 Oct | Invalid explicit `--catalog` keeps stopping the server; empty catalogue rejected everywhere (A7); valueless flags give a clear error (A8) | Explicit = fail loudly; a 0-item catalogue is invalid. |
| 13 Oct | **Not doing:** bigger models, public hosting of the app, Tinker fine-tuning (for this deadline), voice/OCR/WhatsApp, direct Tally writes | RAM limit, privacy/no auth, time vs. evidence. |
| 14 Oct | **Extra prize categories** | Scanned all 211 Week 2 posts (14 Oct). Rough counts of posts claiming each category: Gemma ~51, Render ~14, TabPFN ~10, .tech ~7, Copilot ~5 (all via the Actions route), ElevenLabs ~5, Tinker ~4, Sentry ~1, Entire 0. Owner chose, free credits only: **.tech Domain** (owner claims; Claude switches the site), **Entire** (owner installs the CLI with Claude Code; it captures only sessions from install onward, and the post must say so), **Sentry Agent Tracing** (A12: eval harness only, opt-in, synthetic data only). Skipped: Copilot (Claude writes the code), ElevenLabs (narration-only is thin), Tinker (stretch), and everything that breaks local-only. No category is a guaranteed win. |
| 13 Oct | Prize strategy | The overall prize is the main target. Now eligible for **Best Use of Gemma** (Gemma 4 E2B is the shipped decider). Other partner categories aren't used. |

## 7. Results (all synthetic)

**Model bake-off** (hybrid, 320 practice lines, 13 Oct):

| Model | Memory | Auto | Wrong | No typing | Suggestion acc | p50 / p95 |
|---|---:|---:|---:|---:|---:|---:|
| **gemma4:e2b-it-qat** (default) | 3.6 GB | 88.7% | 0 | **96.1%** | **65.2%** | 3.1 / 9.2 s |
| qwen3.5:2b-q4_K_M (fast alternative) | 1.6 GB | 88.7% | 0 | 94.6% | 52.2% | 2.5 / 3.3 s |
| gemma3:4b | 2.8 GB | 88.7% | 0 | 95.6% | 60.9% | 5.3 / 8.4 s |
| qwen3.5:4b-q4_K_M (previous default) | 3.1 GB | 88.2% | 0 | 95.6% | 62.5% | 5.2 / 8.4 s |
| gemma4:e4b-it-qat (40-line speed check) | 6.0 GB (2.5 on GPU) | – | 0 | – | – | 5.6 / **37 s** |

**Locked synthetic test** (80 lines, 29 need review), current code with Gemma 4 E2B:

| Method | Auto-accept | Dangerous | No typing | Review load | Model calls | Model p50 / p95 |
|---|---:|---:|---:|---:|---:|---:|
| exact | 54.9% | 0 | 54.9% | 65.0% | 0 | – |
| fuzzy | 84.3% | 0 | 84.3% | 46.3% | 0 | – |
| llm-cand (model on every line) | 84.3% | 0 | 92.2% | 46.3% | 80 | 1.5 / 3.2 s |
| **hybrid (the app)** | **88.2%** | **0** | **92.2%** | **43.8%** | **31** | **1.5 / 2.6 s** |

History: Qwen 4B hybrid was 88.2% (first run, before the test pass) and then 86.3% (after the test pass, which made one locked line, `5 sttar…`, ask). **C5 final run (13 Oct, commit `8f9a824`, label `c5-final-8f9a824`):** every outcome is identical to the C2 Gemma run. Its timings were inflated because the agent's A10 checks ran at the same time. I re-ran llm-cand and hybrid once with nothing else running (label `c5-latency-idle-8f9a824`) to measure speed only. All 80 rows were identical again; the published latencies come from that run, and the busy-machine range is stated beside them. These are the final published numbers; don't run the locked set again unless code that affects matching changes.

Also:
- **191 tests** after A9 (13 Oct).
- **Adversarial run:** a fake model making random picks over the 320 practice lines (1,265 calls) let 0 wrong rows through.
- **Learning demo:** sample order 03 went from 6 to 8 automatic lines and from 28.8 s to 5.3 s after learning two names (measured with the previous model).

**Data:** `tools/gen-synthetic.ts` (seed 2026) generated a 111-item catalogue (61 families), 320 practice lines (`dev.jsonl`, seed 2028), 80 locked test lines (seed 2027), 8 demo orders (`data/synthetic/orders/`) and `DATA_CARD.md`. A 40-line hand-written fixture is in `data/fixture/`. Full details are in `docs/EVALUATION.md`.

## 8. Constraints and owner preferences

- **No AI co-author / "Generated with Claude Code" lines** in commits, PRs, or suggested git commands (the owner asked explicitly; also saved in Claude's memory). AI-help disclosure belongs in the DEV post, not git.
- **The owner commits and pushes manually.** Give exact commands, one per code block, grouped by topic. `git add -A` only after a `git status --short` check.
- **Locked test set:** never edit, never tune on it. Choose on practice data, then confirm once on the locked set. Only Claude runs it.
- **Privacy:** runtime talks only to 127.0.0.1. Gitignored: `data/real/`, `data/human/`, `data/app/`, `data/train/`, `results/`, `.DS_Store`, `.env*`, `*.gguf`, `.claude/`, logs.
- **Honesty:** call the data synthetic; never invent shops, users, testimonials, quotes or savings; keep limitations visible (README, site, post).
- **Code:** no dependencies; Node type-stripping rules; test-first bug fixes; never weaken a safety rule; keep docs true. See `CONTRIBUTING.md` and `docs/RULES.md`.
- **Don't publish or claim anything on the owner's behalf** (DEV post, promo codes, MLH actions) without an explicit yes.
- The owner prefers being given **prompts for other AIs** (ChatGPT, coding agent) and having Claude review their output.

## 9. Known limitations / open items

- A comma inside an item's description splits it into two rows (`maggi, 4 pack 1 ctn`, C02). Commas inside numbers are handled (A1).
- A misspelled name containing a number (`5 sttar`) is asked about (A6, blocked).
- No real-browser click-through since the test pass (U1); no human-written test set yet (U2/A4/C8); no real shop or first user.
- The local server has no authentication (single-user desktop tool by design).
- `test/evidence/` holds ChatGPT's audit trail (patches, before/after logs). The full baseline source copy was removed before publishing.
- `SPEC.md` is a historical build plan; its numbers are from early development.

## 10. Where things are

| Path | What |
|---|---|
| `src/` | Pipeline (`text`, `retrieve`, `validate`, `methods`, `prompt`, `llm`, `catalog`, `learned`, `orderlines`, `review`), server (`server.ts`), harness (`eval`, `split`, `checkleak`, `exporttrain`), `types`, `util` |
| `app/` | Review UI (`index.html`, `app.js`, `style.css`) |
| `test/` | 171 tests; `test/helpers/ollama-stub.ts`; `test/evidence/` (audit trail) |
| `data/synthetic/`, `data/fixture/` | Benchmark data (synthetic) |
| `tools/gen-synthetic.ts` | Data generator |
| `docs/` | ARCHITECTURE, API, DESIGN, RULES, DEPLOY, DATA_FORMATS, EVALUATION, TROUBLESHOOTING, TEST_REPORT, MANUAL_TEST_CHECKLIST, PARSER/SERVER/HARNESS_FINDINGS |
| `site/` | Static public site (index, how-it-works, results, get-started, privacy, faq, 404) + `CLAIMS.md` (every claim with its source), `QA.md`, `DEPLOYMENT.md`; deployed by `.github/workflows/pages.yml` |
| Root | README, `context.md` (this), `task.md`, SPEC (historical), SECURITY, CONTRIBUTING, TESTING_PROMPT (the brief used for ChatGPT's test pass), LICENSE (MIT) |

## 11. Commands

```bash
npm test
npm start                                                    # http://127.0.0.1:5178 (catalogue per §2)
npm start -- --catalog data/synthetic/catalog.csv
npm run eval -- --catalog data/synthetic/catalog.csv --cases data/synthetic/dev.jsonl --methods exact,fuzzy,hybrid
npm run eval -- --catalog data/synthetic/catalog.csv --cases data/synthetic/test.jsonl --methods exact,fuzzy,hybrid --label <label>   # Claude only
ollama pull gemma4:e2b-it-qat
curl -s http://127.0.0.1:11434/api/generate -d '{"model":"gemma4:e2b-it-qat","keep_alive":0}'   # unload after runs
```

## 12. Session history (13 Oct 2026, condensed)

1. **Research and plan:** challenge rules; ~700 `#hf26challenge` entries analysed (crowded niches: receipts, listing writers, quote tools); Weekend winners' patterns (one real person, code owns numbers, baselines, honest failures). The owner's own Weekend entry, Prep Buddy, won Best Use of Mastra.
2. **Build spec + harness:** zero-dependency TypeScript; methods exact/fuzzy/llm-full/llm-cand; locked test-set tooling; fixture data. Iterations: code owns numbers → hybrid + checks → near-tie margin.
3. **Synthetic benchmark:** generator, data card, test locked before any model ran; first locked-test results.
4. **Review app:** streaming rows, one-tap suggestions, learned names (+ the L1/L2 bug found and fixed), CSV export.
5. **Docs set:** README, ARCHITECTURE, API, DESIGN, RULES, DEPLOY, DATA_FORMATS, EVALUATION, TROUBLESHOOTING, SECURITY, CONTRIBUTING, LICENSE.
6. **External test pass** (ChatGPT via `TESTING_PROMPT.md`): 25 fixes, 149 tests. Claude found and fixed a regression (numbers in product names) → 152 tests. Evidence baseline copy removed.
7. **Git:** 20 commits pushed manually by the owner, then more batches (26 total).
8. **Landing site** built by ChatGPT (`LANDING_PAGE_PROMPT.md`); Claude corrected the numbers and URLs.
9. **Model bake-off** after the owner freed disk space → Gemma 4 E2B default; docs/site updated; `context.md`/`task.md`/coding-agent prompt created.
10. **Coding-agent tasks:** A1 (critical comma bug + S16) and A2 (catalogue on restart) reviewed and accepted; A7/A8 in progress.
