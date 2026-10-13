# Design

Why ParchiMatch Lite is built the way it is. Each decision lists what was considered and the evidence behind it. Measurements are from a MacBook Air M2 with 8 GB RAM, on synthetic data (see [EVALUATION.md](EVALUATION.md)).

## Problem

A small FMCG wholesaler receives orders as WhatsApp messages, phone notes and paper slips. Someone retypes each line into billing software (Tally, Busy, Marg). The lines are messy:

| Order line | What it means |
|---|---|
| `parle g 5/- 2 petti` | 2 cartons of the ₹5 Parle-G pack |
| `tata namak 1 kg 5 ctn` | 5 cartons of Tata Salt 1 kg |
| `lays hara 10 rs 3 box` | 3 cartons of the green (Cream & Onion) ₹10 Lay's |
| `magi do petti` | 2 cartons of Maggi |
| `पारले जी 5 वाला 2 पेटी` | Same as the first line, in Devanagari |
| `fortune oil 2` | Which size? Which unit? Needs a human |

A wrong row on an invoice costs real money and trust. So the tool must be **safe first, helpful second**.

## Goals and non-goals

**Goals:** correct rows or an honest question; zero wrong rows auto-accepted; works on the shop's existing computer with no internet; data never leaves the shop; fast enough to beat retyping; learns the shop's own shorthand.

**Non-goals (for now):** handwriting/photo OCR, voice input, WhatsApp integration, writing directly into Tally/Busy, prices/discounts/GST, multi-shop or multi-user.

---

## Decisions

### D1. Everything runs locally
**Chosen:** Node server on 127.0.0.1, model in Ollama on the same machine.
**Why:** the customer list, prices and order volume are the business. Local inference also means no per-order API bill and no dependence on mobile internet. An open-weight model is what makes this possible.
**Cost:** limited to what fits in 8 GB, so a 4B model, one request at a time.

### D2. The model only picks the product. Code owns every number.
**Chosen:** a deterministic parser reads quantity, unit, price and pack size. The model gets those as facts and returns only `{evidence, sku, status}`.
**Evidence:** in the first trial, Qwen3.5-4B turned "petti" (carton) into "packet" in 3 of 4 lines, even though the prompt said petti = carton. After the change, quantity/unit errors from the model became impossible by construction, and replies got shorter (≈2 s saved per line).
**Rejected:** asking the model for quantity and unit, then checking it. That's more tokens and more failure modes for no gain.

### D3. Fuzzy matching first, model second (hybrid)
**Chosen:** trigram fuzzy matching handles the line if it's confident (score ≥ 0.5, lead ≥ 0.08). The model is called only when fuzzy can't name a product.
**Evidence (40-line development set):**

| Version | Auto-accepted correctly | Wrong rows auto-accepted | Model calls |
|---|---:|---:|---:|
| Fuzzy only | 78.1% | 0 | 0 |
| Model sees the full catalogue | 50.0% | **3** | 40 |
| Model sees fuzzy's top 8 | 43.8% | **2** | 40 |
| **Hybrid + code checks** | **87.5%** | **0** | **11** |

On the locked 80-line synthetic test (current code, Gemma 4 E2B): hybrid 88.2% with 0 wrong rows and 31 model calls; fuzzy 84.3% with 0 wrong rows.
**Takeaway:** the model alone was *worse* than fuzzy matching. It earns its place only as a second opinion on lines fuzzy can't resolve.

### D4. A model pick can confirm a weak match, but can't break a near-tie
**Chosen:** a model pick auto-accepts only if the order's own words score that product ahead of every other candidate by ≥ 0.08, the same margin fuzzy needs. Otherwise the pick becomes a one-tap suggestion.
**Evidence:** "lays 10 wala 2 ctn" names no flavour. The model picked Classic Salted, which led by 0.074 only because its alias "lays salted" is short. The rule caught it, and that was the last wrong row in the development set.
**Trade-off:** some correct semantic picks ("tata namak" → Tata Salt) become one-tap suggestions instead of automatic. That's acceptable: one tap is cheap, and a wrong invoice line isn't.

### D5. Code writes the operator's questions
**Chosen:** each safety rule has its own question ("Which ₹10 item?", "How many in one carton of …?", "What is 'jodi'?").
**Why:** code knows exactly which rule failed; the model doesn't. It also saves output tokens.

### D6. Learning from corrections, without training
**Chosen:** the operator can tick "Remember 'lais peela' as this product". It's saved to a CSV, and next time the name matches instantly.
**Evidence:** re-running sample order 03 after learning two names went from 6 → 8 automatic lines and 28.8 s → 5.3 s.
**Guard rails** (each from a bug found in testing): only unknown names can be learned (L1); a name means the product, not one size (L2). See [RULES.md](RULES.md#3-learned-name-rules-srcreviewts-srcserverts).
**Rejected for now:** fine-tuning as the main way to adapt. It's slower, needs data, and is invisible to the shopkeeper. Fine-tuning remains an option behind a measured gate ([EVALUATION.md](EVALUATION.md#fine-tuning-gate)).

### D7. Gemma 4 E2B as the model, chosen by a bake-off
**Chosen:** `gemma4:e2b-it-qat` (4.3 GB download, about 3.6 GB in memory).
**How:** five local models were compared as the hybrid decider on the 320 practice lines, then the winner was confirmed once on the locked test ([EVALUATION.md](EVALUATION.md#model-bake-off)).

| Option | In memory | Practice set: auto / no typing / p50 | Verdict |
|---|---:|---|---|
| `gemma4:e2b-it-qat` | 3.6 GB | 88.7% / **96.1%** / 3.1 s | **Default.** Best suggestions and zero-typing; eligible for the Gemma category |
| `qwen3.5:2b-q4_K_M` | 1.6 GB | 88.7% / 94.6% / **2.5 s** | **Fast alternative** for busy or older machines; same safety |
| `gemma3:4b` | 2.8 GB | 88.7% / 95.6% / 5.3 s | Equal, but slower |
| `qwen3.5:4b-q4_K_M` | 3.1 GB | 88.2% / 95.6% / 5.2 s | Previous default; slightly worse and slower |
| `gemma4:e4b-it-qat` | 6.0 GB | 37 s worst-case on 40 lines | Rejected: only 2.5 GB fit on the GPU next to the app on 8 GB RAM |

**Correction:** an earlier version of this document dismissed Gemma 4 E2B as "too large" based on download sizes. Measurement showed it runs comfortably, and it's faster than the 4B models. Bigger models than this still don't work on 8 GB RAM; more disk space doesn't change that.
**On the locked test:** hybrid with Gemma 4 E2B handles 88.2% of answerable lines automatically (previous model: 86.3%), with 0 wrong rows and about 1.5–2.3 s per model call (p50, depending on load; previous: 5.1 s).
**Settings:** temperature 0, fixed seed, thinking off, 2048-token context, JSON schema output, one repair retry.

### D8. Zero dependencies, plain files
**Chosen:** TypeScript run directly by Node 24, built-in `node:http` and `node:test`, vanilla HTML/JS, CSV files for everything persistent.
**Why:** the target machine has 8 GB RAM and was down to under 1 GB of free disk during testing. No `node_modules`, no build step, no database. A shopkeeper (or their nephew) can open every file in a spreadsheet.
**Rejected:** Next.js, Docker, Postgres/pgvector, a vector database. They add memory and disk cost with no measured benefit at 100–300 catalogue items.

### D9. Measure before claiming
**Chosen:** a harness that scores every method on the same labelled lines, a locked held-out test set, a leak check, and a seeded synthetic data generator.
**Why:** the obvious design (the model on every line) turned out to be the worst. Without measurement it would have shipped.

---

## UX design

**One screen, three colours:**

| Colour | Meaning | Operator effort |
|---|---|---|
| Green | Matched, every rule passed | None (can still click Change) |
| Amber | One question, best guess pre-filled | One tap (Confirm) or a quick correction |
| Grey | Greeting or note | None |

**Principles:**
- **Ask one question, not a form.** The amber row leads with the single question that matters.
- **Show the evidence.** The original line stays next to the answer, and a "Why" line lists the failed rules.
- **Pre-fill everything.** Product, quantity and unit are filled from the best guess; most fixes are one change plus Confirm.
- **Nothing disappears silently.** Skipped lines appear in the export as `skipped`.
- **Stream, don't block.** Rows appear as they're matched; the model's ~4 s per hard line doesn't freeze the screen.
- **Offline by construction.** No fonts, scripts or styles from the internet; system fonts with Devanagari support.
- **Accessible defaults.** Labelled controls, keyboard confirm (Enter in the quantity box, Ctrl/Cmd+Enter to match), reduced-motion support, light and dark themes.

## Known limitations

- Evaluated on **synthetic** data written by the same author as the system. Real orders will contain shorthand the generator never produces.
- One shop, one user, one order at a time.
- A comma inside an item's description splits it into two rows ("maggi, 4 pack 1 ctn"). Commas inside numbers ("1,500 bag", "1,00,000") are kept and read; unclear ones ("1,5") are asked about.
- Brand-new shorthand the model doesn't know (pack colours like "hara") needs one correction before it's learned.
- No authentication: anything on the same computer can reach the local server.
