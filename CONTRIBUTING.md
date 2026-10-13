# Contributing

## Ground rules

1. **The model never owns a number.** Quantity, unit, price and pack size come from code (`src/text.ts`). The model only picks a product from candidates.
2. **Never weaken a safety rule** to make a test or metric pass. If a change raises "dangerous rows" on any evaluation, it doesn't ship.
3. **Bugs are fixed test-first:** a failing test, then the minimal fix.
4. **Never edit a locked test set** or a gold label to improve a number. Tune on dev data only ([EVALUATION.md](docs/EVALUATION.md#protocol)).
5. **No real shop data in the repository**, issues or pull requests.

All rules are in [docs/RULES.md](docs/RULES.md).

## Setup

Node 24+. Nothing to install.

```bash
npm test
```

The model is optional for development; without it, the model methods are skipped and the app runs fuzzy-only.

## Code conventions

- **TypeScript, run directly by Node** (type stripping). That means:
  - `import type { … }` for type-only imports;
  - `.ts` extensions in relative imports (`./text.ts`);
  - no `enum`, `namespace`, or constructor parameter properties;
  - use `as const` arrays plus a derived union type instead of enums (see `UNITS` in `src/types.ts`).
- **No dependencies.** Use Node built-ins (`node:http`, `node:test`, `node:fs`, `fetch`). A dependency needs a measured reason that fits an 8 GB machine.
- **Frontend:** vanilla JS, no CDN. Escape every order-derived string with `esc()` before inserting HTML.
- **Comments** explain *why* (usually the bug or measurement behind a rule), not *what*.
- Match the surrounding style: 2-space indent, single quotes, small functions.

## Tests

- `test/*.test.ts` with `node:test` and `node:assert/strict`.
- Unit tests must not need Ollama or the network. Use temp dirs (`fs.mkdtempSync`) for anything written to disk.
- When you add a parser word or a safety rule, add a test with a real-looking order line.

## Common changes

| Change | Where | Also do |
|---|---|---|
| New unit word (e.g. `jhola` → bag) | `UNIT_WORDS` in `src/text.ts` | Parser test; update the table in `docs/RULES.md` §4 |
| New filler word | `FILLER` in `src/text.ts` | Parser test |
| New Hindi number word | `NUMBER_WORDS` in `src/text.ts` | Test that it counts only before a unit |
| New safety rule | `finalize()` in `src/validate.ts`, with its own operator question | Test showing the dangerous row it prevents; add it to `docs/RULES.md` §2; re-run the eval on dev and the locked test |
| New matching method | `METHODS` and `run()` in `src/methods.ts` | Run `npm run eval` with it and record results in `docs/EVALUATION.md` |
| New catalogue column | `loadCatalog()` in `src/catalog.ts` | `docs/DATA_FORMATS.md`; the generator if relevant |
| New API endpoint | `src/server.ts` | `docs/API.md` |
| Prompt change | `src/prompt.ts` (shared by inference and training export) | Measure on dev first, then the locked test |

## Evaluating a change

```bash
npm run eval -- --catalog data/synthetic/catalog.csv --cases data/synthetic/dev.jsonl --methods exact,fuzzy,hybrid --label my-change
```

Only report numbers from the locked test set (`data/synthetic/test.jsonl`, or a real shop's locked set) after the change is final.

## Pull requests

Include: what changed and why; test output; evaluation numbers before and after (dangerous rows first); and any doc updates.
