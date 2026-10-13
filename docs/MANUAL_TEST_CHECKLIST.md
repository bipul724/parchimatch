# Browser test checklist

Status: **not run in a real browser during this automated test pass**. Check each box only after observing the result. Record browser/version, OS, date, and any failing input alongside the box.

Use Node 24+, an existing local Ollama model if available, and a scratch data directory. From the project folder:

```sh
npm start -- --catalog data/synthetic/catalog.csv --data "$(mktemp -d)"
```

Open `http://127.0.0.1:5178`. Use synthetic orders only. Upload fixtures and exports belong in scratch storage; do not replace the repository's locked test set. No download or installation is needed for the checks below. Repeat with Ollama unavailable to check the fuzzy fallback.

## Load and match

- [ ] Load a sample from the Sample menu. Its full text appears in Order, including Hindi and comma-joined lines. The input remains editable.
- [ ] Click Match order. Match and Export are disabled during matching; progress updates while rows arrive. Each original item has one row; greetings such as `Namaste bhaiya` are grey notes.
- [ ] Paste `parle g 5/- 2 petti, maggi 2 ctn` on one line. Two item rows appear, with the correct quantity and carton unit.
- [ ] Match the same text using Cmd+Enter on macOS or Ctrl+Enter elsewhere. It starts once and produces the same decisions.
- [ ] With Ollama unavailable, the status says Model offline and matching finishes using fuzzy matching. Ambiguous items remain amber with a usable question.

## Review actions and export gating

Paste this order so the screen contains a ready item, ambiguity, an unknown name, a known name missing a size, and a note:

```text
parle g 5/- 2 petti
maggi 2 ctn 5 pkt
lais peela 10 rs 2 ctn
tata tea premium 2 ctn
Namaste bhaiya
```

- [ ] Amber lines show the question, suggestion, quantity and allowed units. Export remains disabled while even one amber line is unresolved.
- [ ] On `maggi 2 ctn 5 pkt`, choose the intended product, quantity and unit, then Confirm. The row becomes confirmed; the next unresolved control receives focus.
- [ ] Clear the product or quantity, try zero/fractional quantity, or leave an unsupported unit: Confirm shows an understandable message and the row stays unresolved.
- [ ] Use Not stocked / skip on an amber line. It becomes skipped. Undo reopens its controls and disables Export again.
- [ ] Use Change on an automatic or confirmed line. It becomes amber with editable product/quantity/unit. Confirm the correction and verify the displayed result.
- [ ] Use Treat as item on the grey greeting. The line is re-matched and becomes an item requiring review; it is not silently accepted. Skip it if it is only a greeting.
- [ ] After resolving all amber lines and keeping at least one ready item, Export becomes enabled. If every line is skipped or a note, it stays disabled.

## Remembered names

- [ ] `tata tea premium 2 ctn` has no Remember checkbox: its catalogue name is known even though its pack size is unresolved.
- [ ] An unknown phrase such as `lais peela` shows Remember. Select Lay's Classic Salted ₹10, keep Remember ticked, choose a valid quantity/unit, and explicitly Confirm.
- [ ] Skipping an unknown name, or leaving its checkbox unticked, does not increase learned names after export.
- [ ] Export the explicitly confirmed remembered name. The learned count increases. Restart the server with the same scratch `--data` directory; the learned count and match survive.
- [ ] Match `lais peela 20 rs 2 ctn`: the learned product family selects the ₹20 variant. Match `lais peela 2 ctn`: it asks which variant.

## Download and catalogue upload

- [ ] Export downloads a CSV and reports the saved file path under the scratch data directory. Downloaded and saved contents agree.
- [ ] Open it in a plain text editor first: header and status are correct; 2 cartons Parle-G ₹5 have base quantity 288 packet; a confirmed 3 dozen item has base quantity 36 piece. A skipped item is present; an untouched grey note is absent.
- [ ] Check UTF-8 Devanagari, commas, quotes and embedded newlines in exported order text. They survive a CSV round trip without changing columns or adding unintended rows.
- [ ] Formula-looking order text (`=1+1`, `+cmd`, `-1+1`, `@SUM(1,1)`) is literal text in a spreadsheet, including on a skipped row. Do not enable external links or execute commands when inspecting a failure.
- [ ] Upload a valid scratch catalogue CSV. The item count and selectors reflect it, and new matching uses it.
- [ ] Upload a catalogue with an unknown sell unit or duplicate SKU. The UI displays the row-level error; the old catalogue count, selectors and matching still work.
- [ ] Upload a valid catalogue that removes the SKU behind a learned alias. The stale alias no longer matches as a learned name; there is no crash or invented SKU.

## Presentation, input and offline use

- [ ] Switch the OS/browser preference between light and dark. Text, status colours, questions, selectors and focus outlines remain readable in both; the app has no separate theme switch.
- [ ] At a 375 px narrow window and 200% zoom, order input, long product names, review controls and Export remain usable without clipped controls.
- [ ] Use only Tab, Shift+Tab, arrows, Space and Enter: load a sample, start matching, change a product, edit quantity, confirm, skip, upload a catalogue and export. Focus is visible; Enter in a quantity field confirms that line.
- [ ] Paste HTML-looking text (`<img src=x onerror=alert(1)>`) and upload a scratch catalogue containing that text in a name. It displays as text and opens no alert. Repeat on an amber question/suggestion if an appropriate fixture is available.
- [ ] Turn Wi-Fi off after loading the page, reload, match, review and export. All assets and API calls still work locally; the existing Ollama model needs no network.
- [ ] Restore the original network setting and stop the test server. Retain failing inputs and screenshots in scratch storage for the report.
