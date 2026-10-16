# Static-site verification

Latest check: **15 October 2026** (fact-check and UI polish). It describes checks actually run against the source in this folder. It does not claim a full WCAG certification or a deployed GitHub Pages run.

## Facts

- Every number, claim, command and link on the seven pages was compared with its repository source. The full mapping is in [CLAIMS.md](CLAIMS.md).
- Automated tests: **210** (`npm test` on 15 Oct). CI (`.github/workflows/ci.yml`) runs all of them on every push. Locally, one test skips while the optional `@sentry/node` package is installed.
- Locked synthetic test, model bake-off, development history and the earlier qwen run match `docs/EVALUATION.md`. The earlier run's every-line latency (8.4 s / 15.3 s) and the 30 hybrid calls come from `SPEC.md`.
- The adversarial run (320 practice lines, 1,265 fake-model calls, 0 wrong rows accepted) matches `docs/TEST_REPORT.md`.
- The 11-piece human-written check matches `docs/EVALUATION.md` → Result: human-written set, including the excluded AI-written first round and the strict missed flag.
- S1–S16 and L1–L5 on how-it-works match `docs/RULES.md`.
- **The landing demo was re-run, not copied.** Its rows were checked with the app's own `matchLine()` (fuzzy only, synthetic catalogue, learned name `lais peela`). The former Devanagari row claimed "Ready", but that line is amber both without the model and, on the same pattern, with Gemma (practice-set results). It was replaced with `parle g 5/- 2 petti`, which is verified Ready in both paths.
- Commands match the README Quick start and `docs/DEPLOY.md`: `npm run app -- --open`, `npm run app -- --catalog data/real/catalog.csv` and `lsof -nP -iTCP:5178 -sTCP:LISTEN`.
- Honest labels kept: "synthetic", "no real shop has used it yet", and the demo poster, which now links to the YouTube video (no third-party player is embedded).

## Browser checks (headless Chrome, DevTools protocol, temporary profile)

Every page was loaded at **1280, 1024, 920 and 375 px**, in **light and dark** (emulated `prefers-color-scheme`): 7 pages × 4 widths × 2 themes = **56 renders**. Each render recorded:

| Check | Result |
|---|---|
| Horizontal overflow (`scrollWidth` beyond the layout width) | **0 px everywhere** |
| WCAG AA text contrast, computed from rendered colours (4.5:1, or 3:1 for large text) | **0 failures** |
| Smallest rendered text | **12 px** (was 9 px before this pass) |
| One `h1` per page, no skipped heading levels | yes |
| Images without `alt` | 0 |
| Skip link present | every page |
| Console errors or warnings, failed requests | 0 |

The audit itself was tested on a copy with a planted low-contrast line and an over-wide element. It reported both, so these zeros are real. Before and after screenshots of every render were saved outside the repository.

The shared CSS keeps visible keyboard focus outlines, `prefers-reduced-motion` handling (animations and transitions off, replay hidden), and stacked table cards on phones. Desktop tables now scroll inside their container instead of being clipped.

## Links

An offline link check covered all seven pages:
- **147 internal references:** every one resolves to a file, and every fragment to an element id.
- **37 links to repository files on GitHub:** each file exists in the repository, and each `#heading` anchor exists in its Markdown file.

The checker was tested on a copy with a missing page, a missing id and a missing heading; it reported all three. There are no intentionally absent resources: the demo video lives on YouTube and the homepage links to it from the poster (no video file, no embedded player).

## Network

The pages make **no automatic third-party requests**. All `src` values are relative; there are no remote fonts, stylesheets, scripts, analytics, embeds or CSS `url()` references. Theme choice uses `localStorage`, wrapped in `try/catch`; there are no cookies.

Canonical, Open Graph, `robots.txt` and `sitemap.xml` URLs use `https://bipul724.github.io/parchimatch/`. They are metadata, not requests. External anchors are user-initiated links to `github.com/bipul724/parchimatch` only:

```text
https://github.com/bipul724/parchimatch
https://github.com/bipul724/parchimatch/issues
https://github.com/bipul724/parchimatch/blob/main/LICENSE
https://github.com/bipul724/parchimatch/blob/main/README.md
https://github.com/bipul724/parchimatch/blob/main/README.md#continuous-integration
https://github.com/bipul724/parchimatch/blob/main/SECURITY.md
https://github.com/bipul724/parchimatch/blob/main/data/synthetic/DATA_CARD.md
https://github.com/bipul724/parchimatch/blob/main/docs/DATA_FORMATS.md#catalogue-csv
https://github.com/bipul724/parchimatch/blob/main/docs/DEPLOY.md
https://github.com/bipul724/parchimatch/blob/main/docs/DESIGN.md
https://github.com/bipul724/parchimatch/blob/main/docs/DESIGN.md#d6-learning-from-corrections-without-training
https://github.com/bipul724/parchimatch/blob/main/docs/EVALUATION.md
https://github.com/bipul724/parchimatch/blob/main/docs/EVALUATION.md#model-bake-off
https://github.com/bipul724/parchimatch/blob/main/docs/EVALUATION.md#result-human-written-set-c8-15-oct-2026-scored-once
https://github.com/bipul724/parchimatch/blob/main/docs/EVALUATION.md#tracing-an-evaluation-with-sentry-optional
https://github.com/bipul724/parchimatch/blob/main/docs/RULES.md
https://github.com/bipul724/parchimatch/blob/main/docs/TEST_REPORT.md
https://github.com/bipul724/parchimatch/blob/main/docs/TROUBLESHOOTING.md
```

## Images

| File | Bytes | Notes |
|---|---:|---|
| `assets/ci-steps.png` | 167,089 | A green GitHub Actions run of `ci.yml`, 1400×655 |
| `assets/sentry-trace-safety-rules.png` | 277,227 | A Sentry trace of an evaluation of the 320 synthetic practice lines, 1400×757 |
| `assets/og-image.png` | 74,603 | Social preview, 1200×630 |

Both screenshots were opened and checked before adding them. Neither shows an email, DSN, key, organisation name or other private data. Both have descriptive alt text, explicit width and height, and lazy loading.

## Size

| File | Bytes |
|---|---:|
| `index.html` | 16,183 |
| `results.html` | 23,384 |
| `get-started.html` | 13,510 |
| `how-it-works.html` | 12,430 |
| `privacy.html` | 10,235 |
| `faq.html` | 7,004 |
| `404.html` | 3,820 |
| `assets/site.css` | 21,372 |
| `assets/site.js` | 2,937 |
| **Total** | **110,875** |

The earlier 100,000-byte target from the website brief was already exceeded (103,184 bytes) before this pass. The human-check section, figures and readability CSS add about 7.7 KB. No framework, build step or npm dependency was introduced.

## Earlier checks (13 October), still valid

- The responsive Menu and "On this page" disclosures start closed on phones. Escape closes the menu and returns focus, and desktop widths restore the full navigation.
- The theme button persists the chosen theme across pages; the system theme is used otherwise.
- Copy buttons copy exactly the displayed commands. The polite live region announces the result, with a select-and-copy fallback.
- The OG PNG is 1200×630 and matches its SVG; no fake or empty MP4 is shipped.
- `.github/workflows/pages.yml` uploads only `site/`, with `contents: read`, `pages: write` and `id-token: write`. GitHub Pages still has to be enabled by the owner (Settings → Pages → Source: GitHub Actions).
