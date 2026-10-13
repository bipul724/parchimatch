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

**Order of work for the coding agent (decided 13 Oct):** A7 → A8 → A3 → A5 → A4 (all done 13 Oct) → **A9 next**. A7 and A8 are small correctness fixes; A3 and A5 matter most for the demo; A4 feeds the human-written test set.

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

### A9. Follow-ups from the A4/A8 review: `todo`
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

### A6. Misspelled product names that contain a number: `blocked`
**Why:** `5 sttar 20 wala 5box` is now asked about instead of matched.
**Blocked because:** the only evidence comes from the locked test set. Claude will look for the same pattern in `data/synthetic/dev.jsonl` and decide. Don't start this.

---

## Review and decision tasks (Claude)

| ID | Task | Status |
|---|---|---|
| C1 | Model bake-off on practice lines; choose default model | done: Gemma 4 E2B (see context.md) |
| C2 | Confirm the chosen model once on the locked test set; update all docs, site and README numbers | done: hybrid 88.2% / 0 dangerous / 2.2 s |
| C3 | Update the landing site (`site/`) for the model change and new numbers; check every claim in `site/CLAIMS.md` | done: results, index, get-started, FAQ, CLAIMS updated; bake-off section added; canonical/OG/sitemap URLs set to GitHub Pages |
| C4 | Review each agent task: read the diff, run `npm test`, run dev-set exact/fuzzy/hybrid, check docs, then `done` or send back | ongoing: A1–A5, A7, A8 done; A9 next |
| C5 | After A9 lands: one final locked-test run (exact, fuzzy, hybrid) and the final numbers everywhere, including the test count (site says 170; now 186) | todo |
| C6 | Decide A6 using dev-set evidence only | todo |
| C7 | Draft the DEV post as an unpublished draft (only on your yes) | todo |
| C8 | Score and lock the human-written test set when it arrives (after A4) | todo |
| C9 | After A1: update the safety-rule count (15 → 16) and the comma limitation in `context.md` and `site/` (index, how-it-works, FAQ, CLAIMS); add a note on C01 in `docs/TEST_REPORT.md` | done: context, 5 site pages, CLAIMS, TEST_REPORT and SERVER_FINDINGS updated; S16 row added to the how-it-works rules table |

## Owner tasks (you)

| ID | Task | Status |
|---|---|---|
| U1 | Click through `docs/MANUAL_TEST_CHECKLIST.md` in a browser with other apps closed | todo |
| U2 | Ask 3–5 friends/relatives to type orders for 15 catalogue items, the way they'd really WhatsApp them (feeds A4/C8) | todo |
| U3 | Record a 60–90 s demo with Wi-Fi off (sample order 03), save as `site/assets/demo.mp4` | todo |
| U4 | Commit and push in reviewed batches (no AI co-author lines); enable GitHub Pages (Settings → Pages → Source: GitHub Actions) | todo |
| U5 | Rewrite the DEV post in your own voice, add screenshots/video, publish with `#devchallenge #hf26challenge`, and disclose AI help in the post | todo |

## Not doing (decided)

- **Bigger models (≥ 6 GB):** Gemma 4 E4B fit only 2.5 of 6 GB on the GPU; slowest lines took 37 s. RAM, not disk, is the limit.
- **Hosting the app publicly:** it binds to 127.0.0.1 with no authentication by design. The public site is static and holds no shop data.
- **Fine-tuning (Tinker):** skipped for this deadline. The base model leaves too few, too scattered misses to justify a day of work.
- **Voice notes, photo OCR, WhatsApp integration, direct Tally/Busy writes:** out of scope for this entry.
