# Harness and UI audit findings

Scope: `src/split.ts`, `src/eval.ts` lock validation, `src/checkleak.ts`, `src/exporttrain.ts`, `tools/gen-synthetic.ts`, and the HTML insertion paths in `app/app.js`.

No runtime defect was confirmed in the tested harness behaviours. No source change was made in this scope. All writes and generated sets used cleaned-up temporary directories; the repository's locked synthetic test file and lock were neither inputs nor outputs.

Command run with Node 24.3.0:

```text
/opt/homebrew/bin/node --disable-warning=ExperimentalWarning --test test/harness.test.ts test/ui-source.test.ts test/orderlines-more.test.ts
tests 16
pass 16
fail 0
cancelled 0
skipped 0
todo 0
duration_ms 1058.967
```

## Harness evidence

| Behaviour | Check and result |
|---|---|
| Locked split refusal | A second split with a different seed exits 1 and leaves test, dev and lock bytes unchanged. |
| Tampered test refusal | Editing a temporary locked case makes `eval` exit 1 before creating an output directory. Only `exact,fuzzy` are requested, so no model or network is involved. |
| Near-duplicate detection | `tata tea premium 250 gm 2 ctns` versus `tata tea premium 250 gm 2 ctn` has similarity 0.90 and is refused at the documented 0.85 threshold; unrelated `lux 10 rs 5 dozen` is not flagged. Uppercase copies are caught after normalization. |
| Training leak refusal | The training exporter exits 1 on the same near-duplicate, creates no new output, and preserves an existing export byte for byte. |
| Seeded generator | Seed 4271 produces identical catalogue, dev/test payloads, stats and eight demo order files across two temporary directories. Lock seed/count/source/hash also agree, and each hash matches its temporary test file. Generated dev/test files have no leaks at 0.85. |
| Generator lock refusal | Ordinary regeneration exits 1. `--dev-only` succeeds while preserving held-out bytes and lock bytes. |

Creation metadata is a reproducibility exception: each generated lock records wall-clock `created`, so entire output directories are not byte-identical across different run times. Seeded payloads and content hashes are deterministic. The test compares every lock field except `created` and validates that it is a timestamp; it does not silently claim full-directory byte identity.

During test authoring, the initial example changed quantity 2 to 3 and scored **0.84**, below the documented threshold. Those assertions failed because the fixture was outside the advertised guarantee. The fixture was changed to the 0.90 plural-unit example. No product code or threshold was changed, and those initial failures are not reported as bugs.

## Written XSS review

A regex cannot soundly track JavaScript data flow through nested templates, ternaries and rendering helpers. The automated test therefore freezes the reviewed sink inventory and executes the actual pure renderer section with `node:vm`, using hostile text containing tags, quotes, ampersands and an event-handler attribute. This is a bounded regression check supplemented by the following review, not a general JavaScript security proof.

| HTML sink | Input path and escaping |
|---|---|
| `loadStatus()` → chips `innerHTML` | Item count, learned count and model name use `esc()`. Catalogue path uses `textContent`. |
| `renderSummary()` → summary `innerHTML` | Counts are computed from internal row state and array length, then inserted as numbers. No order/name/question/reason strings reach this template. |
| `render()` → rows `innerHTML` | Receives only `renderRow()` output; see below. |
| `renderOne()` → `outerHTML` / `insertAdjacentHTML` | Receives the same `renderRow()` output. The selector and data-line attribute use the server's numeric line number. |
| `matchOrder()` → progress `innerHTML` (two writes) | Static spinner markup plus the server's numeric total and the client's array length; `useModel` selects fixed text. |

`renderRow()` escapes order text, question, joined reasons and remembered product text. Pending suggestion labels are escaped. `productOptions()` escapes both candidate and catalogue SKU attributes and labels; `resultText()` escapes quantity, unit label and catalogue item label. `sourceBadge()` escapes model latency. Rendered fragments (`body`, `right`, `result`, options) come from these helpers or fixed markup. Row class comes from a fixed internal decision-state mapping. `unitOptions()` inserts unit identifiers without `esc()`, but these come from the catalogue loader's closed allowed-unit list or fixed `UNIT_LABEL` keys, not raw order text. Quantity attribute values and line numbers are typed numeric server/UI values. Error messages, catalogue upload errors, export paths and toast messages use `textContent`. Sample choices use the native `Option` constructor.

No exploitable order/catalogue string-to-HTML path was found under the current validated API types. Tests exercise every row state, candidate and all-products options, status chips, Remember visibility and Export gating. Changing API types or adding a new HTML sink requires revisiting this inventory. A real-browser test for script execution, layout, focus and downloads was **not run**; use [the manual checklist](MANUAL_TEST_CHECKLIST.md).

## Confirmed order-splitting limitation (unfixed)

`test/orderlines-more.test.ts` adds four characterization tests (4 passed, 0 failed, 81.750375 ms). Two exercise healthy comma/semicolon separators, bullets, numbering, CRLF, quantity-first inputs and empty fragments. Two explicitly record the suspected comma defect without calling the broken output correct:

| Severity | Location | Input → actual → intended | Characterization test |
|---|---|---|---|
| medium | `src/orderlines.ts:6` | `maggi 1,000 pcs` → `['maggi 1', '000 pcs']`, whose parsed quantities are 1 and 0 → preserve one intended 1000-piece item or ask before splitting. | `known limitation: a thousands comma breaks one quantity into separate item fragments` |
| medium | `src/orderlines.ts:6` | `maggi, 4 pack 1 ctn` → `['maggi', '4 pack 1 ctn']`, separating product from quantity → preserve the intended item or ask about the comma. | `known limitation: a comma within a product description separates its name from pack and quantity` |

These are passing characterization tests showing the current defect, not failing regressions or a fix. The comma may instead genuinely separate two products, so this pass leaves the existing splitter unchanged and reports the ambiguity. The README already lists this limitation.
