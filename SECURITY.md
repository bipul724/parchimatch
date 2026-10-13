# Security and privacy

## Privacy model

ParchiMatch Lite is built so that **a shop's data never leaves the shop's computer**:

- The app server binds to **127.0.0.1** only. It isn't reachable from the network.
- The model runs in **Ollama on the same machine**. Order text goes to `127.0.0.1:11434` and nowhere else.
- There's **no telemetry, analytics, crash reporting, or external script/font/style**. The page loads only `/`, `/app.js` and `/style.css` from the local server.
- Everything persistent is a CSV in the project folder: catalogue, learned names, exports.
- Shop data folders are gitignored: `data/real/`, `data/app/`, `data/train/`, `results/`.

If fine-tuning is used, it's a one-time step on a cloud service and should use **synthetic or consented** data only. If agent tracing (e.g. Sentry) is ever added, it should only see synthetic orders.

## Threat model

| Asset | Threat | Mitigation |
|---|---|---|
| Customer list, prices, order volume | Leaking to a third party | Local-only design (above) |
| Invoice correctness | A wrong row exported to billing | 15 safety rules, server-side re-check of confirmed rows, evaluation with "dangerous rows" as the key metric ([RULES.md](docs/RULES.md)) |
| Learned names | Poisoned by a mistaken correction | Only explicitly confirmed rows with "Remember" ticked; known catalogue names can't be learned; later entries override earlier ones; plain CSV can be edited |
| Local server | Another program on the same computer calling the API | Accepted risk for a single-user desktop tool. There's no authentication; don't run untrusted software on the shop PC |
| Review page | Script injection through order text | Every order-derived string is HTML-escaped before display |

## Known issues

These are open and tracked for the external test pass ([TESTING_PROMPT.md](TESTING_PROMPT.md)):

1. **No authentication** on the local server (by design for a single-user desktop tool; see the threat model).

## Fixed in the external test pass

- **CSV formula injection:** `exportCsv()` prefixes cells beginning with `=`, `+`, `-` or `@` (including after whitespace) with an apostrophe. Regression tests cover every exported text column and skipped rows. Carriage returns are now quoted too.
- **Oversized request bodies:** return HTTP 413; malformed JSON and invalid request shapes return 400. Oversized bodies are drained without retaining their excess bytes.
- **Client disconnects:** abort in-flight matching calls and stop subsequent lines, releasing the matching slot promptly. Concurrent request bodies cannot bypass the single-order guard.
- **Unconfirmed learned names:** a remember entry must match an explicitly confirmed row's product words and SKU; skipped, automatic, missing, and unrelated rows cannot teach names.
- **Export overwrite:** each export filename includes a timestamp and UUID, preserving separate orders exported within the same second.

## Reporting a problem

This is a challenge project without a formal security process. Open an issue in the repository with steps to reproduce. Don't include real shop data in reports; use the synthetic catalogue in `data/synthetic/`.
