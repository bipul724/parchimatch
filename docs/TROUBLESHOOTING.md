# Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Status chip says **"Model offline · fuzzy matching only"** | Ollama isn't running, or the model isn't pulled | `brew services start ollama`, then `ollama pull qwen3.5:4b-q4_K_M`. Check with `curl http://127.0.0.1:11434/api/tags` |
| Ollama was upgraded but `curl …/api/version` shows the old version | The background service still runs the old binary | `brew services restart ollama` |
| First amber line takes ~15 s | The model is loading into memory | Normal once per 15 idle minutes. Match a short order before a demo to warm it up |
| Every model line takes 10–40 s | macOS is swapping (8 GB is tight) | Close browsers, Docker and other apps. Check Activity Monitor → Memory → Memory Pressure. Try `--model qwen3.5:2b-q4_K_M` |
| Free disk suddenly drops by several GB | macOS swap files grow under memory pressure and stay until restart | Restart the Mac. Keep ≥ 5 GB free |
| "Already matching an order" | One order is matched at a time | Wait for it to finish |
| `SyntaxError` on `import type`, or `.ts` files not running | Node older than 24 | `node -v` should show 24+. With nvm installed, the nvm Node may shadow Homebrew's; check `which node` |
| `ExperimentalWarning: Type Stripping…` | Older Node 24 builds print this | Harmless; the npm scripts already hide it |
| `EADDRINUSE: 127.0.0.1:5178` | The app (or something else) is already running | Use the running app, or start with `--port 5179` |
| Catalogue upload rejected | The CSV has a problem | The message lists each row; see [DATA_FORMATS.md](DATA_FORMATS.md#catalogue-csv) |
| Carton line always amber: "How many in one carton of …?" | `units_per_carton` is empty for that item | Add it to the catalogue, or confirm in another unit |
| A shop nickname is never recognised | It isn't in the catalogue, and the model doesn't know it | Correct it once and tick **Remember** |
| "Remember" checkbox doesn't appear | The words are already a catalogue name; the problem is the size or quantity, so there's nothing to learn | Expected ([RULES.md](RULES.md#3-learned-name-rules-srcreviewts-srcserverts) L1) |
| A learned name gives the wrong product | It was taught wrongly | Correct the row and tick Remember again (the later entry wins), or edit `data/app/aliases_learned.csv` |
| `npm run eval` says the test file changed after locking | The locked test file was edited | Restore it. Results on an edited test set aren't comparable |
| `npm run split` refuses | The test set is already locked | Intentional. Use `--force` only if no results or training data used it |
| Eval skips model methods | Ollama unreachable or model not pulled | See the first row |

## Useful checks

```bash
curl -s http://127.0.0.1:11434/api/version
```
```bash
curl -s http://127.0.0.1:11434/api/ps
```
```bash
curl -s http://127.0.0.1:5178/api/status
```
```bash
sysctl vm.swapusage && df -h /
```

To unload the model and free its ~3 GB immediately:

```bash
curl -s http://127.0.0.1:11434/api/generate -d '{"model":"qwen3.5:4b-q4_K_M","keep_alive":0}'
```
