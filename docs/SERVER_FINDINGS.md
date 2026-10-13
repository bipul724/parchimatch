# Server and Ollama test findings

> **Update (13 Oct 2026, after the coding-agent tasks A1/A2):** **C01 is fixed.** Commas between digits no longer split a line; well-formed groupings (`1,500`, `1,00,000`) are read as one number, and unclear ones (`1,5`) are asked about by the new rule S16. The fix also closed a related critical bug: `aashirvaad atta 10 kg 1,500 bag` used to go green as **1 bag**. **HTTP-08 is fixed:** without `--catalog`, the app reuses the catalogue uploaded in the app. C02 (`maggi, 4 pack 1 ctn`) remains a known limitation. Suite: 170 tests.

All requests use a temporary catalogue/data directory and a scriptable Ollama stub on loopback. No real model or locked evaluation set was used. Final application children and the stub bind port 0; child processes, timers, connections, and temporary files are cleaned up.

## Reproduced bugs

Locations below refer to the corrected source; the failing-first output records the original behaviour.

| ID | Severity | Location | Description and minimal reproduction | Regression test | Result |
|---|---|---|---|---|---|
| HTTP-01 | medium | `src/server.ts:189` | Start with `--port 0` → prints `127.0.0.1:0`, although the OS assigned another port → print the actual listening address. | `server --port 0 reports the actual listening port` | Fixed: log `server.address().port`. |
| HTTP-02 | medium | `src/server.ts:52` | POST `{bad` or `null` to the JSON endpoints → 500; `{}` to match → empty successful stream → malformed JSON/request shapes must return 400. | `malformed JSON and invalid request shapes return 400 without crashing` (18 subtests) | Fixed: parse errors and request-shape checks. |
| HTTP-03 | medium | `src/server.ts:60` | POST a body exceeding 1,000,000 bytes to match → 500 rather than 413; the next pooled request could encounter ECONNRESET → reject with 413 and drain excess bytes without retaining them. | `oversized match and catalogue bodies return 413 with content type` | Fixed for match and the 5,000,000-byte catalogue limit. |
| HTTP-04 | medium | `src/server.ts:128` | Open a match request with a partial JSON body; start a slow second match; finish the first body → both return 200 → only one request may acquire the matching slot. | `concurrent request bodies cannot both acquire the matching slot` | Fixed: re-check the slot after reading the body. |
| HTTP-05 | medium | `src/server.ts:133`; `src/llm.ts:52` | Disconnect after the start event while the first model call is slow → a new match returns 409 and remaining lines still run → cancel in-flight work, stop subsequent lines, and release the slot promptly. | `client disconnect cancels remaining matching lines and promptly releases busy` | Fixed: per-match AbortController propagated to Ollama, with ownership checks when releasing the slot. |
| HTTP-06 | high | `src/server.ts:174` | Confirm two different orders within the same second → both use the same export filename, silently replacing the first CSV → preserve both orders. | `confirm exports base quantities, keeps skipped rows, and persists each export separately` | Fixed: full timestamp plus UUID. |
| HTTP-07 | critical | `src/server.ts:169` | POST `rows: []`, `remember: [{alias: 'ghost alias', sku: 'LAYS10'}]` → learns the alias; skipped/unrelated rows do too. A matching row marked `note: 'automatic'` also taught an alias → only an explicit matching confirmation may teach. Incorrect learned products can later auto-accept. | `L5 remember requires an explicitly confirmed matching row and name` | Fixed: require matching parsed product words/SKU, confirmed status, and a row not marked automatic. |
| HTTP-08 | medium | `src/server.ts:30` | Upload a reduced catalogue, restart with the same explicit `--catalog` → upload remains on disk but the original catalogue is active again → persistence behaviour needs clarification. | `uploaded catalogue survives on disk but startup still uses the explicit catalogue flag (characterization)` | Reported, not changed: explicit flag precedence may be intentional. Test records the actual behaviour and documentation now states it. |

## Evidence and validation

- `test/evidence/server-failing-first.tap`: initial run, 16 tests, 9 passed and 7 failed, 7.270 s.
- `test/evidence/server-failing-first-expanded.tap`: expanded malformed-shape and request-body race reproductions, 35 tests, 9 passed and 26 failed, 7.597 s. The count includes failed parent/subtests and an ECONNRESET after the oversized request; it is not a count of distinct bugs.
- `test/evidence/server-l5-automatic-failing-first.tap`: automatic-row learning guard, 1 test failed, 0.247 s, before its additional one-condition fix.
- `test/evidence/server-final.tap`: final targeted run summary. The full-suite result is reported separately in the main testing report.

The tests also cover actual incremental NDJSON delivery while a later model response is blocked; notes and comma splitting; offline/model-unavailable fallback; invalid JSON repair; unsupported `think` fallback; wrong-priced, outside-shortlist, and near-tie model picks; HTTP 500 survival; confirmed-row validation; carton/dozen conversion; learned-name price/size variants and restart persistence; catalogue rollback; removed learned SKUs; static traversal attempts; unknown methods/routes; and response content types.

`test/helpers/ollama-stub.ts` implements tags, loaded-model inspection, and scriptable chat replies. Tests can queue raw invalid JSON, JSON content, arbitrary response bodies/statuses, slow replies, or provide a request-dependent handler; all requests are recorded. It makes no model calls or network calls beyond loopback.

## Limits

No real Ollama/version/model integration, interactive browser behaviour, operating-system spreadsheet formula execution, disk-full/permission failure, power-loss atomicity, or production shop data was exercised. Cancellation verifies aborting the HTTP request and stopping subsequent lines; whether a real Ollama server immediately releases GPU work after socket cancellation was not measured. Upload-versus-explicit-startup-catalogue precedence remains an open product decision. A timed-out but still-connected Ollama server is not covered; the current client has no explicit request deadline.
