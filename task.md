# Tasks

The working task list for ParchiMatch Lite. Read [context.md](context.md) first.

**Roles**
- **Coding agent:** implements `Agent` tasks, one at a time, test-first, and marks them `review`.
- **Claude (reviewer):** reviews and tests every change, runs evaluations, makes product and technical decisions, and keeps the docs true. Only Claude moves a task to `done`.
- **You (owner):** real-world tasks (recording, publishing, people) and final yes/no on anything public.

**Status values:** `todo` → `doing` → `review` → `done` (or `blocked`, with the reason).

**Deadline:** Hacktoberfest Week 2 entry, publish target **Sat 17 Oct 2026**; hard deadline **Mon 19 Oct 2026, 12:29 PM IST** (Sun 18 Oct, 11:59 PM PDT).

---

## Code tasks (coding agent)

**Order of work for the coding agent (decided 13 Oct):** A7 → A8 → A3 → A5 → A4 → A9 (all done 13 Oct). A6 not doing (C6). A10 and A11 done. **A12 (Sentry tracing in the evaluation harness only) is the one exception to the code freeze**, approved by the owner on 14 Oct for the prize category. A7 and A8 are small correctness fixes; A3 and A5 matter most for the demo; A4 feeds the human-written test set.

### A1. Numbers with commas: never split, read correctly, never guess: `done` (critical, revised 13 Oct)
**Review (Claude, 13 Oct):** accepted. 170/170 tests; acceptance lines verified through the pipeline (`1,500 bag` → green 1500 bag; `1,5` → amber S16; `1,00,000` → amber S11; comma-separated items still split). Old-vs-new on all 440 practice/fixture/test lines × exact+fuzzy: **0 outcomes changed**. Locked test hash unchanged.
**Why (verified by the reviewer):** today `aashirvaad atta 10 kg 1,500 bag` is split at the comma and the first piece goes **green as 1 bag**, and `fortune oil 5 litre 1,200 pcs` goes green as 1 piece. Those are wrong quantities auto-accepted. The original A1 (only stop splitting) would have made it worse: `normalize()` also breaks `2,500` into `2` and `500`, so `maggi 2,500 pkt` would go green as 500 packets. `maggi 1,5 pkt` kept whole already goes green as 5 packets.
**Decision (reviewer):** Option A, widened to splitting, number reading and a new safety rule S16.
**Do:**
1. **`src/orderlines.ts`:** never split at a comma that has a digit immediately on both sides (`\d,\d`). All other commas split as today (`maggi 2 ctn,parle g 5/- 1 petti` is still two items). `maggi, 4 pack 1 ctn` (C02) stays a known limitation.
2. **`src/text.ts` `normalize()`, before punctuation is stripped:** replace **well-formed** digit groupings with the plain number. A grouping must not touch another digit or comma-digit on either side.
   - Western: one to three digits, then one or more `,ddd` groups (`1,000`, `12,500`, `1,250,000`).
   - Indian: one or two digits, then one or more `,dd` groups, then a final `,ddd` (`1,00,000`, `12,34,567`).
3. **Any other comma between digits** (`1,5`, `2,50`, `1,0000`): the parser must **not** use those digits as a quantity, price or size. Record the original text in a new `Parsed.unclearNumber` (string or null), and remove it from the product text.
4. **New safety rule S16 in `finalize()`:** if `parsed.unclearNumber` is set, flag `number "<text>" is unclear` with the operator question `What does "<text>" mean?`. The row must never be green.
5. Large results still go through S11: `maggi 1,00,000 pcs` → 100000 → amber, implausible quantity.

**Done when (all with tests written first):**
- `aashirvaad atta 10 kg 1,500 bag` → one line → green, 1500 bag, AASHATTA-10KG. Regression test for today's bug.
- `fortune oil 5 litre 1,200 pcs` → one line → green, 1200 piece, FORTOIL-5L.
- `maggi 2,500 pkt` → green, 2500 packet.
- `maggi 1,5 pkt` → amber, S16 question `What does "1,5" mean?`, and qty is not 5.
- `maggi 1,00,000 pcs` → amber (S11).
- `rs 1,000` / `1,000/-` read as price 1000.
- `maggi 2 ctn,parle g 5/- 1 petti` and `maggi 2 ctn, parle g 5/- 1 petti` still split into two items.
- C01's characterization test is updated to the new behaviour; C02's test is untouched.
- **Property check:** for every line in `data/synthetic/dev.jsonl` and `data/fixture/test.jsonl`, `parse()` output is unchanged unless the line contains a digit-comma-digit. The fix must not move any other line.
- `npm test` passes.
- **Docs:** `docs/RULES.md` gets S16 in the §2 table, the normalise step in §4 (grouping and unclear numbers), and the S-rule count updated wherever it's stated (README, `docs/RULES.md`). `docs/DESIGN.md` and README limitations drop "1,000 pcs" and keep C02.

### A2. Reuse the uploaded catalogue after a restart: `done`
**Review (Claude, 13 Oct):** accepted. Precedence: explicit `--catalog` → saved upload (if it loads and has items) → synthetic default with a warning. 5 e2e tests. Decisions on the open questions: an invalid explicit `--catalog` keeps stopping the server (explicit = fail loudly); empty catalogues → A7; a valueless `--catalog` → A8; stale docs → Claude (C9).
**Why:** a catalogue uploaded in the app is saved to `<data>/catalog.csv`, but a restart loads the default synthetic catalogue unless `--catalog` points at the upload (HTTP-08).
**Do:** in `src/server.ts`, when `--catalog` is **not** given, load `<data>/catalog.csv` if it exists and is valid; otherwise fall back to `data/synthetic/catalog.csv`. An explicit `--catalog` always wins. Log which file was loaded and why.
**Done when:**
- An e2e test covers the three cases: explicit flag, uploaded file present, nothing uploaded.
- An invalid saved upload falls back with a logged warning instead of crashing.
- `docs/API.md` (flag table) and `docs/DEPLOY.md` describe the rule.

### A3. Show base quantities in green rows: `done`
**Review (Claude, 13 Oct):** accepted. Server rows checked live: `parle g 5/- 2 petti` → 288 packet, `3 dozen` → 36 piece, `fortune oil 5 litre 2 carton` → null (carton size unknown). In the browser, green rows show "2 carton (288 packets)", and changing the quantity to 3 recalculates to 432. Matching is unchanged (the change only adds fields), so no old-vs-new run was needed.
**Why:** the operator should see "2 carton (288 packets)" before exporting, not only in the CSV.
**Do:** add `baseQty` and `baseUnit` to the review row (server side, reusing `baseQuantity`/`baseUnit` from `src/validate.ts` and `src/review.ts`). Show them in `app/app.js` for green and confirmed rows. Recompute in the UI when the operator changes qty, unit or product (needs `unitsPerCarton` from `/api/catalog`, already sent).
**Done when:**
- A row test covers carton→packet, dozen→piece, and an unknown carton size (shows "carton size unknown").
- Every value goes through `esc()`.
- `docs/API.md` lists the new row fields.

### A4. Labelling helper for a human-written test set: `done` (two changes moved to A9)
**Review (Claude, 13 Oct):** accepted. A piped run checked live: ids follow input line numbers (blank lines skipped), a typed SKU works, a stop and rerun resumes, and `--out data/synthetic/…` is refused. **Decisions:** (1) keep the extra "could a careful person enter this?" question, but with **no default**. A stray Enter must not label a line `ok`, because a wrong `ok` makes the system's misses look safe. (2) Reduce anchoring: show **8** candidates (the same k the model sees), **sorted by name, without scores**, and say this in EVALUATION.md. Both are in A9.
**Why:** the most valuable missing evidence is order lines written by people other than the author ([EVALUATION.md](docs/EVALUATION.md#recommended-next-measurement-a-human-written-test-set)).
**Do:** `src/label.ts` + `npm run label -- --catalog <csv> --in <raw.txt> --out <labelled.jsonl>`. It reads one order line per line of the input and, for each line, shows fuzzy's top 5 candidates and the parsed qty/unit. It then asks in the terminal (`node:readline`) for: product number (or `n` = needs review / not stocked), quantity, unit, and tags. It writes the [labelled JSONL format](docs/DATA_FORMATS.md#labelled-order-lines-jsonl). It must be resumable: it skips ids already in `--out`.
**Done when:**
- A test drives it with piped stdin, and its output passes `readJsonl` with a well-formed `gold` on every line.
- It never writes into `data/synthetic/`.
- The README and `docs/EVALUATION.md` mention the command.

### A5. One-command start script: `done`
**Review (Claude, 13 Oct):** accepted. Checked live with Ollama running ("Model … is ready") and with Ollama unreachable (fuzzy-only message; `/api/status` reports `modelReady:false`). It downloads nothing. `--open` has not been tried with a real browser; U1 covers it.
**Why:** a shopkeeper (or the demo) should start everything with one command.
**Do:** `npm run app` → `src/start.ts`. It:
1. checks Node ≥ 24;
2. checks Ollama is reachable;
3. checks the default model is pulled. If not, it **prints** the exact `ollama pull` command and starts in fuzzy-only mode. It must not download anything itself.
4. starts the server;
5. prints the URL, and opens the browser only with `--open`.

**Done when:**
- It works with Ollama stopped (fuzzy-only, clear message).
- It works with Ollama running.
- `docs/DEPLOY.md` and the README Quick start use it.
- It has no dependencies.

### A7. Reject catalogues with no items: `done`
**Review (Claude, 13 Oct):** accepted. A header-only upload returns 400 `catalogue has no items` and the 111-item catalogue stays loaded (checked live). The startup special case in `server.ts` was folded into `loadCatalog`.
**Why:** `POST /api/catalog` accepts a header-only CSV with 0 items, which replaces a working catalogue with an empty one. Startup already treats such a file as unusable (A2).
**Do:** in `loadCatalog()` (`src/catalog.ts`), add an error when there are no data rows (`catalogue has no items`), reported like the other row-level errors. That covers upload, startup and the eval harness in one place.
**Done when:**
- Uploading a header-only CSV returns 400 with that message, and the previous catalogue keeps working (e2e).
- A unit test covers `loadCatalog` with a header-only file.
- `docs/API.md` (POST /api/catalog errors) and `docs/DATA_FORMATS.md` (catalogue rules) mention it.

### A8. Clear error for flags given without a value: `done` (eval follow-up in A9)
**Review (Claude, 13 Oct):** accepted for the server and the listed eval flags. Gap found: eval's numeric flags still turn into `1` silently. `npm run eval -- --limit` scored **1 case** with no warning, and a valueless `--min-score` would mean fuzzy accepts nothing. That can quietly change reported numbers, so it's fixed in A9.
**Why:** `npm start -- --catalog` with no value turns into the path `"true"` and crashes with a confusing file error.
**Do:** in `src/server.ts` (and `src/eval.ts`, which has the same pattern), path/text flags (`--catalog`, `--data`, `--samples`, `--model`, `--url`, `--port`; in eval also `--cases`, `--out`, `--label`) given without a value must exit with `--catalog needs a value, e.g. --catalog data/real/catalog.csv` (per flag) and a non-zero code. Leave boolean flags (`--think`, `--allow-changed-test`) alone. `--port` must be a whole number 0–65535.
**Done when:**
- Spawned-process tests cover a valueless `--catalog` and a non-numeric `--port` (clear message, non-zero exit, no stack trace).
- `docs/API.md` notes it.

### A9. Follow-ups from the A4/A8 review: `done`
**Review (Claude, 13 Oct):** accepted. Checked by hand: `--limit` with no value, `--k 0`, `--min-score 2`, `--show -1` and `--ctx 1.5` each stop with one line and exit 1. `--limit 0` used to mean "all cases" and is now rejected; no doc used it. **Claude's change:** candidates now sort numbers by value (`localeCompare(…, { numeric: true })`), so Parle-G reads ₹5, ₹10, ₹20 instead of ₹10, ₹20, ₹5. I changed the test answers to match (Parle-G ₹5 is 6th on the fixture list) and added a test for the order. 191/191 pass.
**Do:**
1. **`src/eval.ts`:** `--methods`, `--limit`, `--k`, `--min-score`, `--min-margin`, `--ctx` and `--show` without a value fail like the other flags (`missingValue`). Values must also be valid, or eval exits 1 with a one-line message:
   - `--limit`, `--k`, `--ctx`: whole number ≥ 1;
   - `--show`: whole number ≥ 0;
   - `--min-score`, `--min-margin`: a number from 0 to 1.
2. **`src/label.ts`, status question:** no default. The prompt becomes `[y/n]`, and Enter asks again.
3. **`src/label.ts`, candidates:** show 8 candidates (from `retrieve(…, 8)`), sorted by `itemLabel`, without scores. The number typed still picks from that displayed list.
4. **Docs:**
   - `docs/API.md`: the eval flag sentence.
   - README and `docs/EVALUATION.md`: replace "five closest" / "top 5" with eight, alphabetical, no scores. Add one sentence: the list is drawn from fuzzy's candidates, so a labeller can still be anchored, and any SKU can be typed.

**Done when:**
- Spawned-process tests cover `--limit` with no value, `--k 0` and `--min-score 2`.
- The label tests cover Enter on the status question asking again, and the 8 sorted candidates without scores.
- `npm test` passes.
- The locked hash is unchanged.

### A11. Clean-clone follow-ups (from A10): `done`
**Review (Claude, 14 Oct):** accepted. Checked by hand: a missing `--in` and a missing `--catalog` each print one plain line and exit 1. Two evals started together into one folder kept both files (`…-2.json`). 195/195 tests; locked hash unchanged. Decisions on the open questions: (1) an untested warning string is fine; (2) a deleted default catalogue is a broken checkout, not a user error, so no change; (3) the DATA_FORMATS update was right.
**Why:** the fresh-clone check passed, but four rough edges would hit a judge or a new user.
**Do (test-first for code):**
1. **`src/label.ts`:** a missing or unreadable `--in` file stops with one line, e.g. `Can't read data/human/raw.txt: no such file. Save the order lines there first, one per line.` Exit 1, no stack trace. The README label paragraph says to save the lines in that file first.
2. **`src/server.ts`:** an explicit `--catalog` that's missing or invalid stops with one plain message and no stack trace. A missing file reads like `Can't read catalogue data/real/catalog.csv: no such file.` An invalid one keeps today's list of row errors. Exit 1. The fallback rules don't change: an explicit `--catalog` still never falls back. In `docs/DEPLOY.md`, the `--catalog data/real/catalog.csv` example says it needs that file first (see "Set up a real shop").
3. **`src/eval.ts` results:**
   - Never overwrite a results file. If the name already exists, add `-2`, `-3`, … before `.json`.
   - The low-disk warning names the default model correctly: `the default model (4.3 GB download)`, not "a 4B model (3.3 GB)".

**Done when:**
- Spawned-process tests cover: label with a missing `--in`; server with a missing `--catalog` file; two evals writing the same stamp into one folder, with both files kept.
- `npm test` passes, and the locked hash is unchanged.
- `docs/API.md` and `docs/EVALUATION.md` match the new behaviour.

**Owner decisions already made:**
- Disk is 6 GB. Claude fixed README and DEPLOY.
- README Quick start has a `git clone` step. Claude added it.

### A12. Sentry Agent Tracing for the evaluation harness (opt-in): `done`
**Review (Claude, 14 Oct):** accepted. The app is untouched and `package.json` still has no dependencies. Old vs new code with the real model on all 320 practice lines, hybrid: **0 rows changed** (outcome, product, qty, unit, status, question, reasons), and token counts were recorded on all 113 model calls. **Claude's additions:** tracing is refused for a locked test set (test-first); `npm run eval:trace` loads `.env` for that one command; a D8 exception note in DESIGN.md. 205/205 tests; locked hash unchanged. **Real traced runs (14–15 Oct, owner's Sentry):** the results matched the untraced runs. The Agents view showed 113 LLM calls, 640 tool calls, 58K tokens and $0. Each chat span has an `http.client POST http://127.0.0.1:11434/api/chat` child, so the model call stays local. **Fix (Claude, 15 Oct, test-first):** the pre-run model check had become the root of the whole eval trace ("http.client GET 127.0.0.1, 127.90 ms"). Eval root spans now start a fresh trace (`newTrace` → `Sentry.startNewTrace`). 206 tests.
**Why:** this is for the "Best Use of Sentry Agent Tracing" prize category. That category had about 1 competing post on 14 Oct, against about 51 for Gemma. The category asks to show the agent's work: setup, latency, tokens, what we found, how we debugged. **The shop app must keep sending nothing anywhere.** Tracing exists only in `npm run eval`, only when switched on, and only on synthetic or fixture data.

**Do (test-first):**
1. **`src/llm.ts`:** return token counts in the trace, `promptTokens` and `outputTokens`, from Ollama's `prompt_eval_count` and `eval_count` (null if absent). Use the sum over retries. Nothing else in `decide()` changes.
2. **New `src/trace.ts`:** a tiny tracer interface, `startSpan(options, fn)` plus `flush()`, with two implementations:
   - a **no-op** tracer, the default;
   - a **Sentry** tracer that loads `@sentry/node` with a dynamic `import()` **only** when `SENTRY_DSN` is set.

   **`@sentry/node` is NOT added to package.json.** If it isn't installed, eval stops with one line: `Tracing needs @sentry/node: npm install --no-save @sentry/node`, exit 1. Initialise with `tracesSampleRate: 1.0`, `environment: "eval"`, and `release: <git short sha if available>`.
3. **`src/eval.ts`:** when tracing is on, build this span tree, following Sentry's manual agent-tracing conventions:
   - One root span per method run, `eval <method> <label>`, with attributes for the method, model, cases file and its sha, k and min-score.
   - Per order line, `invoke_agent parchimatch-<method>`:
     - op `gen_ai.invoke_agent`;
     - `gen_ai.operation.name` = `invoke_agent`;
     - `gen_ai.agent.name` = `parchimatch-<method>`;
     - input message = the order line text;
     - output message = the final row as JSON (sku, qty, unit, status, question);
     - custom attributes `parchimatch.case_id`, `parchimatch.outcome` (auto_correct / auto_wrong / flagged_* / missed_flag), `parchimatch.status`, `parchimatch.reasons` (JSON string).
   - Children of that span:
     - **`execute_tool fuzzy_match`:** op `gen_ai.execute_tool`, `gen_ai.tool.name` = `fuzzy_match`, with the top score and the lead.
     - **`chat <model>`, only when the model is called:** op `gen_ai.chat`, `gen_ai.operation.name` = `chat`, `gen_ai.provider.name` = `ollama`, `gen_ai.request.model` and `gen_ai.response.model` = the model, `gen_ai.request.temperature` = 0, `gen_ai.usage.input_tokens` and `gen_ai.usage.output_tokens` from step 1, `gen_ai.system_instructions` = the system prompt, the input and output messages, and span status ERROR plus `error.type` on a model error.
     - **`execute_tool safety_rules`:** the `finalize()` step, with which rules fired (reasons).
   - Spans must not change any result: same rows, same summary numbers, tracing on or off.
4. **Privacy guard:** tracing is refused, with one line and exit 1, when `--cases` or `--catalog` resolve outside `data/synthetic/` or `data/fixture/`. Real or human-written orders never go to Sentry.
5. **Never in `src/server.ts` or `src/start.ts`.** Add a test that greps them for `sentry` or `trace.ts` and fails if found.
6. **Docs:**
   - `docs/EVALUATION.md` gets a new "Tracing an evaluation with Sentry (optional)" section: what's sent (synthetic order lines, model prompts and replies, token counts, timings), what's never sent (anything from the app; real or human data), the `.env`/`SENTRY_DSN` setup (`.env*` is gitignored), and the install-on-demand command.
   - The README "zero dependencies" claim says the app has none and that optional tracing installs one package on demand.
   - `docs/ARCHITECTURE.md` gets a line on it.

**Done when:**
- Tests use a **fake tracer**. They don't need `@sentry/node` and send nothing. They cover:
  - the span tree and its attributes for one hybrid line that calls the model (Ollama stub) and one that doesn't;
  - no spans and no import when `SENTRY_DSN` is unset;
  - refusal for a `--cases` outside synthetic/fixture;
  - the "not installed" message;
  - identical eval results with tracing on and off;
  - the server/start grep.
- `npm test` passes, and the locked hash is unchanged.
- **The agent must not run any model evaluation and must not touch `data/synthetic/test.jsonl`.** Claude does the real traced run on the practice set with the owner's Sentry key.

### A13. CI with GitHub Actions (for "Best Use of GitHub Copilot", Actions route): `done`
**First real runs (15 Oct):** CI went green on GitHub for 74729d8, 09a4df5 and d96dd36 (tests, locked-test guard, baselines); the Pages deploy also succeeded each time.
**Review (Claude, 15 Oct):** accepted. `ci.yml` checked: least-privilege `contents: read`, no secrets, a 15-min timeout, and all three action tags exist (checkout v6, setup-node v7, upload-artifact v7). The agent reproduced each step locally: 206/206 without `node_modules`; the hash guard passes on the real file and fails on a one-byte change; baselines run with 0 Ollama requests. Decisions: `ci-results/` added to `.gitignore` (Claude); keep the major-version tags like `pages.yml`; the first real run confirms Ubuntu and latest Node 24.
**Why:** that category accepts "automate your project with GitHub Actions". Today Actions only deploys the site, and the 205 tests run only on the owner's Mac. Approved by the owner on 15 Oct; it adds no app code.
**Do:**
1. **New `.github/workflows/ci.yml`:** runs on `push` and `pull_request` to `main`, plus `workflow_dispatch`. One job on `ubuntu-latest` with `permissions: contents: read`:
   - checkout;
   - `actions/setup-node` with Node **24**. Use the same major version family style as `pages.yml`, and only versions you've confirmed exist;
   - `npm test`. No `npm install` is needed, since there are zero dependencies. **Ollama isn't available in CI**, so every test must pass without it, and none may call a real model;
   - **Locked test guard:** a step that recomputes the sha256 of `data/synthetic/test.jsonl` and fails unless it equals the `sha256` in `data/synthetic/test.jsonl.lock.json`, printing both hashes;
   - **Baselines:** `npm run eval:baselines -- --out ci-results` (exact and fuzzy on the fixture, no model), then upload `ci-results/` as a build artifact (`actions/upload-artifact`) and append the summary table to `$GITHUB_STEP_SUMMARY`.
   - The job must **never** read secrets and never set `SENTRY_DSN`.
2. **README:** add a CI status badge at the top, linking to the workflow runs. Add a short "Continuous integration" note: what runs on every push, and that a change to the locked test set fails the build.
3. **`docs/DEPLOY.md` or `CONTRIBUTING.md`:** one line saying pull requests must pass CI.

**Done when:**
- `ci.yml` is valid YAML.
- Every command it runs passes locally, the same way CI runs it: run `npm test` with Ollama unreachable, and make the hash check fail on a temporary copy with one changed byte (never touch the real file).
- `npm test` passes, and the locked hash is unchanged.
- Claude confirms the first real run is green on GitHub after the owner pushes.

### A14. Labeller splits order lines exactly like the app, and can skip non-items: `done`
**Review (Claude, 15 Oct):** accepted. A live piped run worked: the greeting was skipped, the comma line became `h002-1`/`-2`, the `1)` was stripped, and the full line was shown. 210 tests (209 + 1 skipped locally, only because `@sentry/node` is installed); locked hash unchanged. Open questions 1–3: fine as they are (fixing a wrong label or skip by hand is acceptable for one owner). (bug fix, allowed under the freeze)
**Why (found by the agent, 15 Oct):** the app splits pasted text with `splitOrder()` (`src/orderlines.ts`): new lines, commas not between digits, `;`, and it strips `1)` and `-` bullets. `npm run label` splits only on new lines, so `parle g 2 petti, maggi 1 ctn` would get one gold label for two items. Friends' WhatsApp messages also contain greetings ("Hi bhaiya", "thanks"), which must not enter the test set as order items.
**Decision (Claude):** the labeller uses the app's splitter; the owner pastes messages unedited. Splitting by hand was rejected, because it would quietly correct the splitter's mistakes and flatter the score.
**Do (test-first):**
1. **`src/label.ts`:** for each non-blank input line, `items = splitOrder(line)`.
   - **Ids:** `h007` when the line has one item; `h007-1`, `h007-2`, … when it has several. Ids stay stable, because they come from line numbers plus position.
   - **Context:** show the full original line plus `item 2 of 3`, so the labeller sees the context.
   - **Resume:** the changed-input check works per item. If an item's text differs from what was saved for that id, stop as today.
2. **New answer `s` at the product prompt:** skip, "not an order item (greeting, thanks, note)". Skipped ids are appended to `<out>.skipped` (one `id<TAB>text` per line), so a rerun doesn't ask again. They never go into the labelled JSONL. The final summary prints how many items were labelled and how many skipped.
3. **Fragments the splitter cut wrongly** (e.g. C02, `maggi, 4 pack 1 ctn`): the labeller answers `n`, so the gold is needs_review, and tags it `bad_split`. Document this, plus the skip option, in `docs/EVALUATION.md` and the README label paragraph.
4. No changes to `splitOrder()` itself, the app, or the evaluation code.

**Done when:**
- Piped-stdin tests cover:
  - a comma line giving two items with ids `-1`/`-2`;
  - a numbered `1) …` line stripped the same way as the app;
  - `s` writing to `.skipped` and not re-asked on resume;
  - the summary counts;
  - an input change detected per item.
- A test asserts that the labeller's items for a sample text equal `splitOrder()` on the same text.
- `npm test` passes, and the locked hash is unchanged.

### A6. Misspelled product names that contain a number: `not doing` (decided 13 Oct, C6)
**Decision (Claude):** no fix for this entry. The only catalogue name with a number is 5 Star (plus the "maggi 4 pack" alias). All six practice lines with it (d003, d123, d142, d172, d179, d214) spell it correctly ("5 star", "five star"), so the practice set has no evidence to build or check a fix against. The only example (`5 sttar 20 wala 5box`) is in the locked test set, which we never tune on. The line is safe: it's asked about, not wrongly accepted. It stays a known limitation.

### A10. Fresh-clone check (no feature work): `done`
**Review (Claude, 14 Oct):** accepted. All README and DEPLOY steps pass on a clean clone; 74 links checked, none broken. Fixed: model size 4.3 GB and the `lsof -nP` check. Its useful catch: its checks overlapped the C5 run and inflated the timings, so the latency was re-measured. Its open questions became A11 or were fixed by Claude (6 GB disk, clone step).
**Why:** judges and readers will clone the repo and follow the README. Every command there must work on a clean copy, exactly as written.
**Do:** clone `https://github.com/bipul724/parchimatch` into a new temporary folder outside this project. Follow README.md, then docs/DEPLOY.md, step by step, and run each command exactly as written:
- `npm test`;
- `npm run app` with Ollama running, then with `--url http://127.0.0.1:9` (Ollama unreachable);
- `npm run eval:baselines`;
- the README's eval command, with exact and fuzzy only;
- `npm run label` on a 3-line file in the temporary folder.

Also check every relative link in README.md and docs/*.md points to a file or heading that exists.
**Rules:** don't change behaviour. Fix only:
- a doc that's wrong;
- a broken link;
- a command that fails on a clean clone because of something missing from the repo.

Anything else goes in the report as a question. Delete the temporary folder at the end.
**Done when:** the report lists each step with pass or fail and the exact output of every failure, plus any fixes made test-first where code was involved.

---

### After the deadline (noted 15 Oct, not now)
- **UI unit fallback:** when the order's unit isn't one the product is sold in (`Parle 20 20 5 Piece`, but Parle-G is sold by packet or carton), the amber row's unit box silently shows the first sold unit (packet). The operator sees it before confirming, so it's not a wrong auto-accept, but the row should say "piece isn't sold; choose packet or carton" with nothing preselected.
- **Splitting:** items joined by "aur"/"or" or with no separator (human-written check). Build on practice data, then confirm on a new human round.
- **Unit word "pouch".**
- **"Remember" can learn an operator's mistake** (16 Oct, happened in a first demo take, since re-recorded: "lais peela" confirmed as Magic Masala, but yellow Lay's is Classic Salted). Ideas: for product-ambiguity rows, make the operator pick between the close candidates instead of confirming a preselected one; show a distinguishing hint (pack colour/flavour); add a way to see and remove learned names in the app.

## Review and decision tasks (Claude)

| ID | Task | Status |
|---|---|---|
| C1 | Model bake-off on practice lines; choose default model | done: Gemma 4 E2B (see context.md) |
| C2 | Confirm the chosen model once on the locked test set; update all docs, site and README numbers | done: hybrid 88.2% / 0 dangerous / 2.2 s |
| C3 | Update the landing site (`site/`) for the model change and new numbers; check every claim in `site/CLAIMS.md` | done: results, index, get-started, FAQ, CLAIMS updated; bake-off section added; canonical/OG/sitemap URLs set to GitHub Pages |
| C4 | Review each agent task: read the diff, run `npm test`, run dev-set exact/fuzzy/hybrid, check docs, then `done` or send back | ongoing: A1–A5, A7–A9 done |
| C5 | Final locked-test run and numbers everywhere | done (13 Oct, commit 8f9a824): every outcome identical to C2 (hybrid 88.2% / 0 dangerous / 92.2% zero typing); latency 1.5/2.6 s from a speed-only re-run with nothing else running (rows identical; the C5 timings were inflated by the A10 checks running at the same time); test count 191 on the site |
| C6 | Decide A6 using dev-set evidence only | done: not doing (no practice evidence; limitation stays) |
| C7 | Draft the DEV post as an unpublished draft (only on your yes) | done 15 Oct: `post/DRAFT.md` (gitignored), v3 in the winners' structure, with fill-in markers for the owner |
| C8 | Score and lock the human-written test set when it arrives (after A4) | done 15 Oct: 11 pieces from 3 friends (round 2) locked (`ef0e3e57…`) and scored once. Hybrid: 0 wrong rows, 3/5 auto, 80% zero typing, 1 strict missed flag. Gaps: aur/run-on split, "pouch", Tata Salt vs Tea. Write-up in EVALUATION.md. |
| C9 | After A1: update the safety-rule count (15 → 16) and the comma limitation in `context.md` and `site/` (index, how-it-works, FAQ, CLAIMS); add a note on C01 in `docs/TEST_REPORT.md` | done: context, 5 site pages, CLAIMS, TEST_REPORT and SERVER_FINDINGS updated; S16 row added to the how-it-works rules table |

## Owner tasks (you)

| ID | Task | Status |
|---|---|---|
| U1 | Click through `docs/MANUAL_TEST_CHECKLIST.md` in a browser with other apps closed | todo |
| U2 | Ask 3–5 friends/relatives to type orders for 15 catalogue items, the way they'd really WhatsApp them (feeds A4/C8) | **Done 15 Oct.** Round 1 excluded (AI-written); round 2: 3 hand-typed replies (6 items), 11 pieces, labelled by the owner and scored once (C8). Earlier note: **doing (15 Oct)**: no shopkeeper available, so the owner chose the friends option. The 15 items are fixed in EVALUATION.md. Raw replies go to `data/human/raw.txt` (gitignored), then the owner labels with `npm run label`, then Claude locks and scores once (C8). |
| U3 | Record the demo (3 min, one take, Wi-Fi off) | done 16 Oct: on YouTube https://www.youtube.com/watch?v=lsl2cNpkY6U. The owner chose NOT to put the video file in the repo; the homepage poster links to YouTube (no embedded player). |
| U4 | Commit and push in reviewed batches (no AI co-author lines); enable GitHub Pages (Settings → Pages → Source: GitHub Actions) | Pages **done 15 Oct**: https://bipul724.github.io/parchimatch/ is live. Claude checked all 7 pages (200), the live numbers (205 tests, 1.5/2.6 s), internal links (only `assets/demo.mp4` is missing, waiting on U3; the poster is labelled "coming soon") and phone width (no horizontal scroll). Next: the .tech domain. |
| U5 | Rewrite the DEV post in your own voice, add screenshots/video, publish with `#devchallenge #hf26challenge`, and disclose AI help in the post | todo |
| U6 | Entire | **not doing (15 Oct, owner's decision):** sharing sessions on Entire would publish the instructions typed into them, and the owner wants none of their instructions online. Nothing was installed. |

## Not doing (decided)

- **Bigger models (≥ 6 GB):** Gemma 4 E4B fit only 2.5 of 6 GB on the GPU; slowest lines took 37 s. RAM, not disk, is the limit.
- **Hosting the app publicly:** it binds to 127.0.0.1 with no authentication by design. The public site is static and holds no shop data.
- **Fine-tuning (Tinker):** skipped for this deadline. The base model leaves too few, too scattered misses to justify a day of work.
- **Voice notes, photo OCR, WhatsApp integration, direct Tally/Busy writes:** out of scope for this entry.
