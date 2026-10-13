# ParchiMatch Lite test audit

> **Update (13 Oct 2026, after the coding-agent tasks A1/A2):** **C01 is fixed.** Commas between digits no longer split a line; well-formed groupings (`1,500`, `1,00,000`) are read as one number, and unclear ones (`1,5`) are asked about by the new rule S16. The fix also closed a related critical bug: `aashirvaad atta 10 kg 1,500 bag` used to go green as **1 bag**. **HTTP-08 is fixed:** without `--catalog`, the app reuses the catalogue uploaded in the app. C02 (`maggi, 4 pack 1 ctn`) remains a known limitation. Suite: 170 tests.

> **Update:** a follow-up review found and fixed one regression from this pass; the suite is now **152 tests**. See [Review of this pass](#review-of-this-pass-and-one-follow-up-fix-13-oct-2026).

Final result: **149 tests passed, 0 failed, 0 skipped, 0 todo**, under **Node v24.3.0**, in **3.074 seconds** (Node runner duration; shell command wall time 3.119 seconds). The original 28-test suite passed before additions. This pass added 11 test files and one Ollama helper, plus temporary-directory cleanup in an existing test. There are **25 fixed findings and 3 documented open/ambiguous behaviours** below; three finalizer findings and the stale-map guard are explicitly marked as caller-boundary issues rather than reachable model-number exploits.

The suite includes passing characterization tests of known broken comma splitting and startup catalogue precedence. A green final result does **not** mean those behaviours were fixed. All source fixes have failing-first test evidence; the open behaviours were characterized and left unchanged because intended comma/flag precedence is ambiguous.

## Final command and raw output

Run from the project directory with the installed Node 24 earlier in PATH:

```sh
PATH=/opt/homebrew/bin:$PATH npm test
```

The environment's default `/usr/local/bin/node` is v22.11.0; the tests were actually run with `/opt/homebrew/bin/node` v24.3.0. No runtime or package was downloaded. Local HTTP test execution needed approval because the sandbox initially rejected loopback binding (`EPERM`). The approved tests only used local stub servers and temporary storage.

```text
Confirmed known limitation: 1,000 becomes quantities 1 and 0 in two fragments; no automatic repair is claimed.
Confirmed known limitation: the product name and quantity arrive in different rows; split intent is ambiguous.
tests 149
suites 0
pass 149
fail 0
cancelled 0
skipped 0
todo 0
duration_ms 3074.101084
```

Full captured output: [final-npm-test.txt](../test/evidence/final-npm-test.txt).

Adversarial result: **320 dev lines × 11 passes; 1265 adversarial model calls; 1949 accepted rows; 0 slips**. Each of the 320 development lines ran against three seeded random-pick strategies and each of the eight candidate positions. The stub always claimed `status:"ok"` and quoted real order words. Every accepted row was compared to gold status, SKU, quantity and unit. The test also requires both real model-path calls and accepted control rows, so rejecting everything cannot pass it. This is evidence for those synthetic development lines, not a real-model or production guarantee.

## Added tests and helper

Every added test/helper begins with its purpose. All generated data, uploads, exports and learned-name files use cleaned temporary directories. Application and stub servers use port 0. Child processes, timers and connections have teardown.

| File | Purpose |
|---|---|
| [test/helpers/ollama-stub.ts](../test/helpers/ollama-stub.ts) | Scriptable tags/ps/chat, invalid/valid JSON, status errors, think fallback, slow replies, request-dependent candidate picks, request recording. |
| [test/e2e-server.test.ts](../test/e2e-server.test.ts) | Real child-process HTTP routes, streaming, offline fallback, hostile model replies, concurrent bodies, disconnects, confirm/export/learning/restart, upload rollback and malformed/oversized/static-path handling. |
| [test/rules.test.ts](../test/rules.test.ts) | Named S1–S15 tests, regression edge cases, size-family safety and base conversion. |
| [test/parse-more.test.ts](../test/parse-more.test.ts) | Table-driven syntax, decimal sizes, half-kilo characterization, x2/2x, hyphens, bounds, multiple units, price punctuation, Hindi, Unicode digits and zero-width characters. |
| [test/property.test.ts](../test/property.test.ts) | Seeded no-throw/idempotence and finalizer safety over 320 dev lines plus 1,200 mutations. |
| [test/adversarial-dev.test.ts](../test/adversarial-dev.test.ts) | Hybrid identity/quantity/unit correctness against gold with random and exhaustive candidate-position stub choices. |
| [test/review-more.test.ts](../test/review-more.test.ts) | Named L1–L4 tests, note classification, stale aliases, CSV quoting, Devanagari and formula safety. |
| [test/llm-client.test.ts](../test/llm-client.test.ts) | Real tags/ps discovery and successful one-retry repair with request assertions. |
| [test/catalog-more.test.ts](../test/catalog-more.test.ts) | Required-name catalogue validation with row-level errors. |
| [test/harness.test.ts](../test/harness.test.ts) | CLI lock/tamper refusal, near-duplicate leak/export refusal, seeded generated payload/hash equality and lock preservation. |
| [test/ui-source.test.ts](../test/ui-source.test.ts) | Reviewed HTML sink inventory, real renderer escaping via node:vm, Remember visibility and Export gating. |
| [test/orderlines-more.test.ts](../test/orderlines-more.test.ts) | Real separators and explicit characterization of the two unresolved comma cases. |

L5 is named and tested in the server suite: absent, skipped, unrelated, mismatched-SKU and automatic rows cannot teach; explicit confirmations still teach and persist across restart. L1 has both UI visibility and server refusal coverage. Every safety rule S1–S15 has a named realistic order-line test.

## Bug table — parser and validation (fixed)

Locations are in the corrected source. “Before” describes the failing reproduction, not current expected behaviour.

| ID | Severity | File:line | Description and minimal reproduction: input → actual before → expected | Failing regression test |
|---|---|---|---|---|
| P01 | critical | `src/validate.ts:16` | `MAGGI-4P`, `maggi 4 ctn 1 pkt` → green **1 packet**, because the number 4 appeared in the product name → amber unresolved 4 cartons vs. 1 packet | `S7 a product number does not erase a different order unit` |
| P02 | critical, validator boundary | `src/validate.ts:47` | `MAGGI-14`, `maggi 2 ctn 5 pkt`, proposal `qty:2,unit:carton` → green 2 cartons → amber; code must resolve written pairs | `S7 a proposal cannot supply a quantity for unresolved pairs` |
| P03 | critical | `src/validate.ts:55` | `PRLG-5`, `parle g 5 rs 10 rs 2 pkt` → green ₹5 variant, ignoring ₹10 → amber conflicting prices | `S5 conflicting written prices require review instead of retaining the first` |
| P04 | critical | `src/validate.ts:56` | `FORT-1L`, `fortune 1 l 5 l 2 pcs` → green 1 L variant, ignoring 5 L → amber conflicting sizes | `S6 conflicting written sizes require review instead of retaining the first` |
| P05 | critical | `src/validate.ts:59` | `PRLG-5`, `parle g 500 g 2 pkt` → green despite no catalogue gram size for the chosen variant → amber unverifiable size | `S6 a written size requires a verifiable catalogue variant size` |
| P06 | critical | `src/text.ts:66` | `parle g 5 rs -2 pkt` → green **positive 2** packets → retain -2 and reject implausible quantity | `S11 a written negative quantity is never converted to a positive order` |
| P07 | critical | `src/text.ts:67` | `parle g rs.10 2 pkt` + `PRLG-5` → parser loses ₹10, validator green → read ₹10 and reject ₹5 pick | `parser recognizes rs.10 as an explicit price marker`; `S5 a written MRP must match the chosen variant` |
| P08 | critical | `src/text.ts:57` | `parle g 5 rs ૨2 pkt` (also Bengali `২2`) → green **2** packets after dropping the non-Latin digit → parse 22 packets | `parser retains Gujarati and Bengali digits even when mixed with Latin digits` |
| P09 | critical, validator boundary | `src/validate.ts:83` | `aashirvaad 5 kg 2 jodi`, proposal `unit:bag` → green despite unknown `jodi` → amber unknown unit regardless of proposal | `S12 a model cannot invent a unit to bypass an unknown unit word` |
| P10 | critical, validator boundary | `src/validate.ts:67` | `parle g 5 rs pkt`, proposal `qty:5,unit:packet` → green with the price reused as quantity → amber; parser read no order quantity | `S8 a written price cannot be reused as a model supplied quantity` |
| P11 | critical | `src/text.ts:60` | `maggi 2\u200b2 ctn` (also zero-width joiner/non-joiner/BOM) → **2** cartons instead of visually 22; zero-width formatting after a minus/decimal also loses numeric meaning → preserve complete numeric text | `zero-width formatting inside numeric text never truncates quantity, sign, or decimal` |
| P12 | critical | `src/text.ts:181` | `maggi 2 ctn 5 jodi` or `maggi 5 jodi 2 ctn` → exact/fuzzy green **2 cartons**, discarding the additional 5 jodi → amber unknown unit | `unknown numeric unit phrase survives beside a recognised quantity pair`; `S12 a known quantity pair cannot hide another quantity with an unknown unit` |
| P13 | critical | `src/text.ts:120` | `parle g rs 5 rs 10 2 pkt` or `parle g ₹5 rs 10 2 pkt` → green ₹5 variant, losing overlapping ₹10 hint → amber conflicting prices | `overlapping prefix and suffix price markers retain both explicit prices`; `S5 conflicting written prices require review instead of retaining the first` |

P02/P09/P10 directly exercise `finalize()` with values today's production model path cannot supply because `methods.ts` copies numbers from the parser. They are defensive violations of documented finalizer rules, not evidence that Ollama currently controls order numbers. Full details: [PARSER_FINDINGS.md](PARSER_FINDINGS.md).

## Bug table — review, CSV and catalogue (fixed)

| ID | Severity | File:line | Description and minimal reproduction: input → actual before → expected | Failing regression test |
|---|---|---|---|---|
| R01 | high | `src/review.ts:144` | Formula-looking exported cells are executable spreadsheet syntax. `=HYPERLINK("http://x","click")` → unchanged CSV cell → prefix apostrophe; also protect `+`, `-`, `@` and leading whitespace, catalogue fields and skipped rows. | `CSV formula injection is neutralised in every exported text column including skipped rows` |
| R02 | high | `src/review.ts:145` | A carriage return corrupts CSV row boundaries. Skipped text `maggi\r2 ctn` → two parsed records → quote the field and preserve one record. | `CSV quotes a field containing only a carriage return separator` |
| R03 | high, caller boundary | `src/review.ts:64` | A stale in-memory learned SKU crashes direct matching. `learned={"lais peela":"REMOVED"}`, line `lais peela 10 rs 2 ctn` → TypeError reading product name → ignore absent SKU and ask. Disk loading/server catalogue replacement already ignored it safely. | `removed learned SKU is ignored by both disk loading and direct matching` |
| R04 | medium | `src/catalog.ts:17` | A required product name was not validated. CSV `BAD,,Parle,5 pack,5,packet,144,parle g` → accepted catalogue row → row-2 validation error and upload rollback. | `catalogue rejects a missing required product name with a row-level error` |
| R05 | high | `src/review.ts:68` | Explicit item quantities could become ignored notes. `zzfruit ２ ctn` / Gujarati `૨` / Bengali `২`, or `ek petti zzfruit` → grey note with quantity discarded → item needing review, preserving quantity/unit. | `numeric item lines stay reviewable after Unicode digit normalisation`; `Hindi word quantities and explicit units do not disappear into grey notes` |

Before-fix evidence: [review-before.txt](../test/evidence/review-before.txt) (5 passed / 3 failed), [note-before.txt](../test/evidence/note-before.txt) (8 passed / 2 failed), [catalog-before.txt](../test/evidence/catalog-before.txt) (0 passed / 1 failed). The first trial of the L3 test used a nonexistent fixture SKU; that test fixture error was corrected before the recorded review-before run and is not a product finding.

## Bug table — HTTP, persistence and open behaviours

| ID | Severity | File:line | Description and minimal reproduction: input → actual before → expected | Failing regression / characterization test | Result |
|---|---|---|---|---|---|
| HTTP-01 | medium | `src/server.ts:189` | Start with `--port 0` → prints `127.0.0.1:0`, although the OS assigned another port → print the actual listening address. | `server --port 0 reports the actual listening port` | Fixed: log `server.address().port`. |
| HTTP-02 | medium | `src/server.ts:52` | POST `{bad` or `null` to the JSON endpoints → 500; `{}` to match → empty successful stream → malformed JSON/request shapes must return 400. | `malformed JSON and invalid request shapes return 400 without crashing` (18 subtests) | Fixed: parse errors and request-shape checks. |
| HTTP-03 | medium | `src/server.ts:60` | POST a body exceeding 1,000,000 bytes to match → 500 rather than 413; the next pooled request could encounter ECONNRESET → reject with 413 and drain excess bytes without retaining them. | `oversized match and catalogue bodies return 413 with content type` | Fixed for match and the 5,000,000-byte catalogue limit. |
| HTTP-04 | medium | `src/server.ts:128` | Open a match request with a partial JSON body; start a slow second match; finish the first body → both return 200 → only one request may acquire the matching slot. | `concurrent request bodies cannot both acquire the matching slot` | Fixed: re-check the slot after reading the body. |
| HTTP-05 | medium | `src/server.ts:133`; `src/llm.ts:52` | Disconnect after the start event while the first model call is slow → a new match returns 409 and remaining lines still run → cancel in-flight work, stop subsequent lines, and release the slot promptly. | `client disconnect cancels remaining matching lines and promptly releases busy` | Fixed: per-match AbortController propagated to Ollama, with ownership checks when releasing the slot. |
| HTTP-06 | high | `src/server.ts:174` | Confirm two different orders within the same second → both use the same export filename, silently replacing the first CSV → preserve both orders. | `confirm exports base quantities, keeps skipped rows, and persists each export separately` | Fixed: full timestamp plus UUID. |
| HTTP-07 | critical | `src/server.ts:169` | POST `rows: []`, `remember: [{alias: 'ghost alias', sku: 'LAYS10'}]` → learns the alias; skipped/unrelated rows do too. A matching row marked `note: 'automatic'` also taught an alias → only an explicit matching confirmation may teach. Incorrect learned products can later auto-accept. | `L5 remember requires an explicitly confirmed matching row and name` | Fixed: require matching parsed product words/SKU, confirmed status, and a row not marked automatic. |
| HTTP-08 | medium | `src/server.ts:30` | Upload a reduced catalogue, restart with the same explicit `--catalog` → upload remains on disk but the original catalogue is active again → persistence behaviour needs clarification. | `uploaded catalogue survives on disk but startup still uses the explicit catalogue flag (characterization)` | Reported, not changed: explicit flag precedence may be intentional. Test records the actual behaviour and documentation now states it. |
| C01 | medium | `src/orderlines.ts:6` | `maggi 1,000 pcs` → `maggi 1` and `000 pcs`, parsed quantities 1/0 → preserve intended 1000-piece item or ask about split. | `known limitation: a thousands comma breaks one quantity into separate item fragments` | Unfixed; characterization only. |
| C02 | medium | `src/orderlines.ts:6` | `maggi, 4 pack 1 ctn` → name and quantity in separate rows → preserve intended item or ask about comma. | `known limitation: a comma within a product description separates its name from pack and quantity` | Unfixed; characterization only. |

HTTP-08, C01 and C02 are **passing characterization tests**, not failing regressions or claimed fixes. Uploads remain saved on disk; startup uses `--catalog` or the default path. Restore an uploaded catalogue by passing `<data>/catalog.csv` explicitly. Comma intent can mean either item separation or part of one item, so automatic repair was left out. [SERVER_FINDINGS.md](SERVER_FINDINGS.md) and [HARNESS_FINDINGS.md](HARNESS_FINDINGS.md) contain detailed evidence.

## Minimal fixes and separate diffs

The checkout has no Git metadata. Diffs were generated against source/document snapshots captured before fixes:

- [Source and matching documentation fixes](../test/evidence/source-and-doc-fixes.patch).
- [Test-only additions and existing-test cleanup](../test/evidence/test-only-changes.patch).
- [Changed-file manifest](../test/evidence/change-manifest.json).

`text.ts`, `types.ts` and `validate.ts` preserve numeric intent, retain conflicting hints and enforce existing rules; retrieval thresholds, catalogue aliases and gold labels were not tuned. `review.ts` adds a stale-SKU existence check, uses parsed numeric/unit evidence for note classification, and sanitizes/quotes CSV cells. `catalog.ts` adds one required-name check. `server.ts` adds typed input errors, slot ownership/re-checks, explicit-confirmation alias binding and unique export names. `llm.ts` only adds optional cancellation propagation for discovery/chat calls. No `app/` source changed, and no dependencies were added.

Matching docs were updated in RULES, API, DATA_FORMATS, ARCHITECTURE and SECURITY. The data card now explicitly excludes wall-clock lock creation metadata from byte-for-byte reproducibility. The generator payloads and hashes are deterministic; the lock's `created` value is intentionally time-dependent. README and EVALUATION result numbers and bytes remain unchanged; the locked evaluation was not re-run.

Initial failing outputs are retained under [test/evidence](../test/evidence). Parser initial run: 47 tests / 11 failures; server initial run: 16 tests / 7 failures. These failure counts include test/subtest grouping and are not distinct-bug counts. Additional independently found bugs have separate before-fix captures. The final complete suite above ran after all source and test changes and passes.

## Suspected issues: verified outcomes

| Suspect | Outcome |
|---|---|
| CSV formula injection | Confirmed and fixed (R01); no spreadsheet application was launched. |
| Oversized bodies return 500 | Confirmed and fixed to 413 (HTTP-03). |
| Disconnect keeps matching/busy | Confirmed and fixed with cancellation (HTTP-05). |
| Every-comma splitting | Confirmed, characterized and left unchanged (C01/C02). |
| Removed learned SKU | Server reload/disk loading were already safe; direct caller crash fixed (R03). |
| `maggi 2 ctn 5 pkt` | Ordinary parser proposal already required review; proposal bypass and mismatched product-number units fixed (P01/P02). |
| Soap grams versus millilitres | Already rejected; named size-family regression. Unverifiable catalogue sizes additionally guarded (P05). |
| Real digit-free items treated as notes | The two named examples remain items; weak-name Hindi-word-quantity/Unicode cases were confirmed and fixed (R05). |
| Full-width/Gujarati/Bengali/zero-width input | Full-width digits already normalized; mixed Gujarati/Bengali digits and zero-width numeric truncation confirmed and fixed (P08/P11). |

## Not run and limits

- **Real Ollama/Qwen:** no model pulled or contacted. Stub tests prove client/server logic, not model quality, GPU memory/latency, or whether real Ollama cancels GPU work immediately after HTTP abort.
- **Real browser:** no interactive matching, keyboard/focus, narrow-window/theme, download, or physical Wi-Fi-off check was run. [MANUAL_TEST_CHECKLIST.md](MANUAL_TEST_CHECKLIST.md) contains all requested flows. Renderer tests plus the written XSS sink review do not replace browser execution.
- **Spreadsheet execution:** formula-safe CSV bytes/round trips were asserted; Excel/LibreOffice/Numbers execution was not exercised.
- **Faults outside scope:** no disk-full, power-loss atomicity, filesystem permission failure, stalled-but-connected Ollama deadline, production shop orders, or every numeral/language syntax was tested.
- **Debatable input:** `half kilo` is outside the documented number vocabulary; unmarked `14` is not inferred as a price. Tests record this without inventing intent.
- **Locked synthetic evaluation:** neither the locked cases nor their gold labels were used to tune/test methods. File hashes alone were checked for preservation. Both protected hashes match their original values in [protected-hashes-verified.json](../test/evidence/protected-hashes-verified.json).

An optional MLH participation lookup was rejected by automatic approval review as unrelated private account access. No participation data was retrieved; it was unnecessary for this task and was not retried.

## Review of this pass and one follow-up fix (13 Oct 2026)

An independent check after this audit:

- **Re-ran the suite:** 149/149 passed on Node 24.3.0. `data/synthetic/test.jsonl` and its lock hash were unchanged.
- **Compared every outcome before and after these fixes**, without the model, on all 320 dev and 80 locked-test lines, using the source snapshot this pass had saved.

**Regression found (high):** the P12 change (an unknown unit beside a recognised pair) also consumed numbers that belong to product names. `5 Star 20 Rs 2 Ctn` lost both "5" and "star" from the product text, so fuzzy couldn't name the product (dev: 2 lines went from auto-correct to flagged). It was safe (no wrong rows), but a silent loss of matching. The 149 tests didn't cover a catalogue name containing a number.

**Fix (test-first):** `test/names-with-numbers.test.ts` (3 tests; 2 failed before the fix). `numberNamePhrases()` in `src/catalog.ts` collects `<number> <word>` pairs from catalogue names and aliases. `parse(raw, { namePhrases })` keeps them as product words, never a quantity or an unknown unit. Every catalogue-aware caller passes them (`methods.ts`, `review.ts`, `server.ts`, `exporttrain.ts`). Documented as parser rule 9 in `docs/RULES.md`. Suite after the fix: **152/152**.

**Effect without the model** (auto-accept accuracy; wrong rows auto-accepted were 0 in every column):

| Set · method | Before this pass | After this pass | After the follow-up fix |
|---|---:|---:|---:|
| dev · exact | 58.8% (1 wrong + 1 missed) | 58.8% (0 + 1) | 59.8% (0 + 1) |
| dev · fuzzy | 88.2% | 86.8% | 87.7% |
| locked test · exact | 52.9% | 52.9% | 54.9% |
| locked test · fuzzy | 86.3% | 82.4% | 84.3% |

The remaining differences are lines that are now **flagged on purpose**: `maggi 4 paack 6 box` (dev; exact used to accept it *wrongly*) and `5 sttar 20 wala 5box` (locked test; a misspelled name with a number now asks). The second wasn't fixed, because the line comes from the locked test set and fixing it would mean tuning on the test set.

**Cleanup:** the full pre-fix source/docs snapshot (`test/evidence/baseline/`) was removed before publishing. The two patch files and the before/after logs remain as the record. References above to the "untouched source snapshot" describe that removed folder.

### 🌐 Community Wisdom: [A test said the server started. I deleted the server. It still passed.](https://dev.to/zkasuran/a-test-said-the-server-started-i-deleted-the-server-it-still-passed-5gch)
> **Source**: [zkasuran](https://dev.to/zkasuran)
> **Tags**: `testing`, `javascript`, `node`, `devops`
>
> The author's own testing audit distinguishes green execution from assertions that detect regressions. This pass follows that principle with real HTTP/CLI assertions, failing-first evidence and accepted-row controls. No comments were returned for this article; it is one practitioner's account, not a measured community consensus.
>
> 🔗 [Read Full Discussion](https://dev.to/zkasuran/a-test-said-the-server-started-i-deleted-the-server-it-still-passed-5gch)
