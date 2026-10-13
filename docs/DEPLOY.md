# Deploy

ParchiMatch Lite is a **local-first desktop tool**. "Deploying" means installing it on the computer where orders are entered. It's tested on macOS (Apple Silicon, 8 GB). Windows and Linux should work (Node and Ollama both support them) but are **untested**.

## Requirements

| | Minimum | Tested |
|---|---|---|
| OS | macOS 13+, Windows 10+, or Linux | macOS (Apple M2) |
| RAM | 8 GB (close other apps) | 8 GB |
| Free disk | ~5 GB (model 3.3 GB + Ollama + headroom for swap) | |
| Node.js | 24 or newer (runs TypeScript directly; needs `import.meta.main`) | 24.3, 24.21 |
| Ollama | Recent (0.40 tested) | 0.40.3 |
| Internet | Only for installation | |

The app also works **without** Ollama, in fuzzy-matching-only mode.

## Install (macOS)

```bash
brew install node ollama
```
```bash
brew services start ollama
```
```bash
ollama pull gemma4:e2b-it-qat
```

Then get the project folder onto the machine (clone or copy) and check it:

```bash
cd parchimatch && npm test
```

There's nothing to `npm install`: the project has no dependencies.

> If you upgrade Ollama with Homebrew, restart the background service so the new version actually runs: `brew services restart ollama`. Check with `curl http://127.0.0.1:11434/api/version`.

## Run

```bash
npm run app -- --open
```

One command: it checks Node (24+), whether Ollama is running and whether the model is downloaded, then starts the app and, with `--open`, opens it in the browser. Nothing is downloaded. If Ollama is stopped or the model is missing, it says so (printing the exact `ollama pull …` command) and starts with fuzzy matching only; once Ollama and the model are there, the app uses them without a restart. Stop it with Ctrl+C.

Other flags go to the server unchanged, e.g. `npm run app -- --catalog data/real/catalog.csv`. `npm start` still starts the server alone, without the checks.

Open <http://127.0.0.1:5178>. Options are in [API.md](API.md#http-api). To try it first with the synthetic shop, use `--catalog data/synthetic/catalog.csv`. Started without `--catalog`, it loads the catalogue last uploaded in the app, or the synthetic one if nothing was uploaded ([rule](API.md#http-api)).

## Set up a real shop

1. **Export the item list** from the billing software as CSV or Excel.
2. **Convert it** to the [catalogue format](DATA_FORMATS.md#catalogue-csv): one row per sellable variant, `sell_units`, `units_per_carton` where known, and only the aliases the shop actually writes.
3. **Load it**, either with `--catalog data/real/catalog.csv` at start or via *Catalogue → Replace catalogue* in the app. Invalid rows are reported by row number, and nothing is replaced until the file is valid. An uploaded catalogue is saved to `data/app/catalog.csv` and loads again after a restart, as long as you start **without** `--catalog`; an explicit `--catalog` always wins. The startup line says which file loaded and why.
4. **Run a few real orders.** Correct amber rows and tick "Remember" for the shop's own nicknames.

`data/real/` and `data/app/` are gitignored, so shop data is never committed.

## Start automatically at login (macOS, optional)

Save as `~/Library/LaunchAgents/local.parchimatch.plist`, replacing both paths:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>local.parchimatch</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/node</string>
    <string>--disable-warning=ExperimentalWarning</string>
    <string>/PATH/TO/parchimatch/src/server.ts</string>
    <string>--catalog</string><string>data/real/catalog.csv</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/PATH/TO/parchimatch/data/app/server.log</string>
  <key>StandardErrorPath</key><string>/PATH/TO/parchimatch/data/app/server.log</string>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/local.parchimatch.plist
```

## Verify it's really offline

1. Start Ollama and the app, and run one order so the model is loaded.
2. Turn Wi-Fi off.
3. Match a sample order. The status chip should still say "Model ready", and lines needing the model should show the "local model" badge.
4. Optionally confirm that nothing listens on a public interface:
   ```bash
   lsof -iTCP:5178 -sTCP:LISTEN
   ```
   You should see `127.0.0.1:5178`.

## Updating

- **Code:** replace the project folder (keep `data/real/` and `data/app/`), then run `npm test`.
- **Catalogue:** upload the new CSV in the app. Learned names pointing at removed items are ignored.
- **Model:** `ollama pull <model>` and start with `--model <name>`. Re-run the evaluation on a locked test set before switching ([EVALUATION.md](EVALUATION.md)).

## Backups

Back up `data/real/catalog.csv` and `data/app/` (learned names, uploaded catalogue, exports). They're plain CSV files.

## Hosting on a server (not recommended for shop data)

The server binds to 127.0.0.1 by design and has no authentication, so it **can't be exposed to a network as-is**. A hosted demo would need a host flag, authentication and HTTPS, and should only ever use synthetic data. Real shop data belongs on the shop's machine; that's the point of the product.
