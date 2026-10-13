# Static-site verification

Checked on 13 October 2026. This report describes checks actually run against the delivered source. It does not claim a full WCAG audit, a real-model evaluation or a deployed GitHub Pages run.

## Content and provenance

- Read `README.md`, `docs/DESIGN.md`, `docs/RULES.md`, `docs/EVALUATION.md`, `docs/DEPLOY.md`, `SECURITY.md` and `data/synthetic/DATA_CARD.md` before reviewing content. Also checked the deployment-linked `docs/DATA_FORMATS.md` for the CSV summary.
- Compared the current, previous-run and development-evolution tables with `docs/EVALUATION.md`: all reported values match. Current automatic/no-typing percentages explicitly use answerable lines; development observations are labelled as tuning history.
- Compared all S1–S15 and L1–L5 entries with `docs/RULES.md`; the table retains the price/size, quantity/unit, evidence, near-tie and explicit-confirmation boundaries.
- Verified that benchmark results are labelled synthetic and link to the GitHub data card. The landing demonstration uses supplied sample-order outputs and a documented Devanagari example, with its synthetic nature stated.
- The exact **152 tests**, **320 practice lines**, **1,265 fake-model calls** and **0 wrong automatic rows** are authorized facts from the supplied website brief. No new app/model tests were run to regenerate those counts.
- Mandatory limitations are visible: synthetic-only evaluation, no real shop use yet, one shop/operator/order, pasted text only, no photos/voice/WhatsApp integration, comma splitting inside `1,000 pcs`, and no local authentication.
- No testimonials, customer identities, product logos, pack images, invented prices, stars/download counts or direct billing-software integration claims were found. Product examples are text. Footer affiliation and challenge notes appear on all seven pages.
- Full grouped factual mapping is in `CLAIMS.md`.

## Links, structure and metadata

Ran an offline Python standard-library `HTMLParser` inspection across all seven HTML pages. It checked 141 existing relative references and 34 fragment targets; no unresolved internal link or fragment remains. The only intentionally absent resource is `assets/demo.mp4`: the real recording must be added by the owner, as explained in `assets/README.md`. Its poster and honest “coming soon” text are present.

Every page has one `h1`, one `main`, header/navigation/footer landmarks, a skip link, an HTML language, a unique title and meta description, canonical metadata, Open Graph and Twitter tags. No duplicate element IDs were found. All navigation and automatically loaded resources use relative paths, including the video poster, stylesheet, script and favicon. Sitemap XML uses the clearly marked base-URL placeholder; no `CNAME` file exists.

The links initially pointing to missing safety/learning fragments were corrected and the entire inspection was rerun successfully.

## Network audit

**The site source makes zero automatic third-party network requests.** All `src` values are relative. There are no remote fonts, stylesheet imports, CSS `url()` references, analytics, embeds, service workers or request APIs in the shared script. Inspected SVG assets contain only local shapes/text; their XML namespace declarations are not resource requests. The script uses `localStorage` for the theme and does not set cookies.

The following are the complete unique non-relative `href` values. GitHub anchors are user-initiated navigation; canonical tags are inert page metadata. Neither is an automatically fetched page resource.

Canonical URL placeholders:

```text
https://YOUR-DOMAIN.example/index.html
https://YOUR-DOMAIN.example/how-it-works.html
https://YOUR-DOMAIN.example/results.html
https://YOUR-DOMAIN.example/get-started.html
https://YOUR-DOMAIN.example/privacy.html
https://YOUR-DOMAIN.example/faq.html
https://YOUR-DOMAIN.example/404.html
```

External anchors:

```text
https://github.com/bipul724/parchimatch
https://github.com/bipul724/parchimatch/issues
https://github.com/bipul724/parchimatch/blob/main/LICENSE
https://github.com/bipul724/parchimatch/blob/main/README.md
https://github.com/bipul724/parchimatch/blob/main/SECURITY.md
https://github.com/bipul724/parchimatch/blob/main/data/synthetic/DATA_CARD.md
https://github.com/bipul724/parchimatch/blob/main/docs/DATA_FORMATS.md#catalogue-csv
https://github.com/bipul724/parchimatch/blob/main/docs/DEPLOY.md
https://github.com/bipul724/parchimatch/blob/main/docs/DESIGN.md
https://github.com/bipul724/parchimatch/blob/main/docs/DESIGN.md#d6-learning-from-corrections-without-training
https://github.com/bipul724/parchimatch/blob/main/docs/EVALUATION.md
https://github.com/bipul724/parchimatch/blob/main/docs/RULES.md
https://github.com/bipul724/parchimatch/blob/main/docs/TEST_REPORT.md
https://github.com/bipul724/parchimatch/blob/main/docs/TROUBLESHOOTING.md
```

Social `content` attributes also contain `https://YOUR-DOMAIN.example/<page>.html` and `https://YOUR-DOMAIN.example/assets/og-image.png`; they are metadata for social crawlers, not `src`/`href` or browser resource requests. `robots.txt` and `sitemap.xml` contain the same explicit placeholder. Replace these base URLs before publishing; instructions are in `DEPLOYMENT.md`.

## Size and script checks

Uncompressed HTML + CSS + JS total: **99,867 bytes**, below the strict decimal 100,000-byte budget. Images, Markdown and the future video are excluded from that requested budget.

| File | Bytes |
|---|---:|
| `index.html` | 15,635 |
| `how-it-works.html` | 12,125 |
| `results.html` | 15,722 |
| `get-started.html` | 12,940 |
| `privacy.html` | 9,835 |
| `faq.html` | 6,609 |
| `404.html` | 3,776 |
| `assets/site.css` | 20,288 |
| `assets/site.js` | 2,937 |

`node --check site/assets/site.js` passed. No framework, build step or npm dependency was introduced. No `src/`, `app/`, `test/`, `data/` or existing documentation files were modified for the site.

## Accessibility source checks

- Calculated WCAG relative-luminance contrast for declared text tokens on their intended backgrounds. Light-theme minimum: **4.569:1** (Ready green on Ready background); amber **4.668:1**; muted text at least **4.999:1**. Dark-theme minimum across tested pairings: **5.956:1**. New soft surfaces and the safety panel also pass 4.5:1 in both themes (safety panel: **6.023:1** light, **7.990:1** dark). These are source-token calculations, not screenshots or a full accessibility certification.
- The shared CSS includes visible keyboard focus, semantic status labels alongside color, `prefers-reduced-motion` handling, a 16 px mobile gutter, responsive table cards, and Devanagari-capable system-font fallbacks.
- Controls are labelled; copy feedback is a polite live region; tables have captions, scoped headers and `role="table"`; the illustrative figure and video have accessible descriptions. Decorative slip images use empty alt text beside the labelled brand link. The inspection script flags these empty values for manual review; they are intentional decorative images.
- Theme storage reads and writes are wrapped in `try/catch`; manual theme choice overrides the system preference. With reduced motion enabled, CSS animation/transition is disabled and replay is hidden.
- Screen-reader announcements, denied-storage/clipboard fallback, actual reduced-motion OS emulation and a full network-waterfall capture were not exercised. The source checks alone do not establish these behaviors. Runtime checks actually performed are listed below.

## Deployment bounds

Inspected `.github/workflows/pages.yml`: only `site/` is uploaded, push to `main` and manual dispatch are configured, official configure/upload/deploy Pages actions are used, and permissions are `contents: read`, `pages: write`, `id-token: write`. It has not been pushed or run against GitHub. Manual Pages/custom-domain steps are in `DEPLOYMENT.md`; the owner still needs to select GitHub Actions in Settings → Pages and publish.

## Browser checks actually run

Used the Codex in-app browser against a temporary loopback static server, without installing a browser package or adding dependencies.

- Loaded all seven pages at **360×800** and **1184×900**. Each page had document width equal to viewport width, with no horizontal overflow. Visually inspected the landing page, workflow/safety sections, the desktop installation guide, mobile privacy page in dark theme and mobile benchmark cards. All seven pages retain their original visible text and byte-identical code examples after the UI refinement.
- Tested the responsive Menu and On this page disclosures: both start closed on mobile, menu opens with native input, Escape closes it and focuses its summary, the benchmark contents link reaches its target, and resizing to desktop restores the full navigation. Guide contents remain open in the desktop rail.
- Changed the theme with its button and navigated to Results; the chosen light theme persisted. System dark was also rendered. Theme storage exception paths were reviewed but not forced in a browser.
- Tab focused the visible “Skip to content” link. Native Enter toggled the focused FAQ disclosure between expanded and collapsed states.
- Activated the install-command copy button with native input. The success live region appeared, and reading the resulting clipboard returned exactly the three displayed install commands with their newlines.
- Inspected browser error/warning logs after page navigation: no entries returned.
- The static server recorded **no requests for the missing demo.mp4** during the page-load checks, consistent with `preload="none"`. Third-party automatic-resource absence is established by the complete source/URL inventory above; the browser automation backend did not expose a full network waterfall.
- The OG PNG export is **1200×630**, visually inspected against its SVG. No fake or empty MP4 is shipped.

The local preview server was temporary. The website has not been deployed to GitHub Pages. Saved landing, guide and mobile preview images accompany the delivery outside `site/`, so they are not published or counted as site code.
