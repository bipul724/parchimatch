# Rules

Three kinds of rules live here: the **safety rules** the code enforces on every line, the **reading rules** the parser follows, and the **project rules** anyone changing the code or data must follow. If code and this document disagree, the code is the source of truth. Fix whichever is wrong.

## 1. The principle

> **A wrong row must never be auto-accepted.** When unsure, ask one short question.

The measure that matters most is **dangerous rows**: wrong rows auto-accepted, plus lines that needed a human but didn't get one. Target: zero. Every safety rule below exists because a test or evaluation found a way to produce a dangerous row.

## 2. Safety rules (enforced in `src/validate.ts` → `finalize()`)

A line is **green** only if every rule passes. Otherwise it's **amber**, with the first failed rule's question shown to the operator and the product kept as a one-tap suggestion when there is one.

| # | Rule | Example caught | Operator question |
|---|---|---|---|
| S1 | The decider said it's unsure | "lays 10 wala" (no flavour) | Is it …? / Which product is "…"? |
| S2 | The product must exist in the catalogue | Model invents `PRLG-50` | Which product is "…"? |
| S3 | The product must be one of the candidates the model was shown | Model jumps outside its shortlist | Which product is "…"? |
| S4 | A product must be chosen | No confident match | Which product is "…"? |
| S5 | A price written in the order must equal the item's MRP; conflicting explicit prices always ask | "parleg **10 wala**" → ₹5 pack | Which ₹10 item? / Which price? |
| S6 | A written pack size must equal a known catalogue variant size, including its dimension; conflicting explicit sizes always ask | "fortune **5 litre**" → 1 L pouch | Which 5000 ml item? / Which pack size? |
| S7 | Two different number+unit pairs: drop only a pair whose number **and unit** occur in a product name/alias; if that doesn't leave exactly one, ask, regardless of the proposal's quantity | "maggi **4 pack** 1 petti" → 1 carton; "maggi **4 ctn** 1 pkt" stays unresolved | Which quantity: 4 packet or 1 carton? |
| S8 | (model) Quantity and unit must agree with what code read; a price or size cannot supply a missing quantity | Model turns "petti" into packet | Is it carton? / How many? |
| S9 | (model) The evidence words must all appear in the order | Model quotes words that aren't there | Is it …? |
| S10 | (model) A model pick auto-accepts only if the order's own words score it ahead of every other candidate by ≥ 0.08 (the same lead fuzzy needs) | "lays 10 wala" → Classic Salted, whose lead came from a shorter alias | Is it Lay's Classic Salted (₹10 pack)? |
| S11 | Quantity must be present, a whole number, 1–10000 | "maggi bhej dena" | How many? |
| S12 | An unknown unit word is never guessed, even if a proposal supplies a recognised unit | "10 **jodi**", "2 **ladi**" | What is "jodi"? packet or carton? |
| S13 | If no unit is written: fill it in only when the item is sold in exactly one unit | "aashirvaad 5kg 2" → bag | packet or carton? |
| S14 | The unit must be one the item is sold in | "fortune 5 litre 1 petti" | … is sold by piece. Which one? |
| S15 | Cartons need a known carton size | "clinic plus 2 petti" | How many in one carton of …? |
| S16 | A comma between digits that isn't a well-formed grouping is never read as a number | "maggi **1,5** pkt" (1.5? 15? 1 and 5?) | What does "1,5" mean? |

**Fuzzy acceptance** (`src/methods.ts`): the top match is accepted only if its score is ≥ 0.5 **and** it leads the runner-up by ≥ 0.08. It then still passes through all safety rules.

**Hybrid** (the app's method): fuzzy first; the model is called only when fuzzy can't name a product. A model pick then goes through S1–S16.

**Notes:** a line with no digits after normalization, no parsed quantity+unit pair, and no parsed unit whose best fuzzy score is under 0.3 is shown as a grey note ("Ram Ram bhaiya") and never exported. Numeric orders, including supported non-ASCII digits, and Hindi number+unit orders remain item rows even when the product name is unfamiliar. The operator can override with "Treat as item".

## 3. Learned-name rules (`src/review.ts`, `src/server.ts`)

| # | Rule | Why |
|---|---|---|
| L1 | Only names the catalogue doesn't already know can be learned. The checkbox is hidden for known names, and the server refuses them too | "tata tea premium" was amber because the **size** was missing; learning it would auto-accept the wrong size forever |
| L2 | A learned name means the **product** (all variants with the same catalogue name), not one pack size | "lais peela" learned from a ₹10 line must still match "lais peela 20 rs" to the ₹20 pack |
| L3 | Price/size written in the order pick the variant; if they can't, ask (with the learned variant as suggestion) | "lais peela 3 ctn" stays amber |
| L4 | Learned names still pass every safety rule | A learned name can't bypass S5–S16 |
| L5 | Learned names are only saved from rows the operator explicitly confirmed with the box ticked | Skipped or automatic rows never teach anything |

## 4. Reading rules (`src/text.ts` → `parse()`)

Applied in this order:

1. **Normalise:** lowercase, NFKC (including full-width digits), Devanagari/Gujarati/Bengali digits → ASCII, Devanagari unit words → Latin (`पेटी` → petti), `₹` → rs, `5/-` → `5 rs`, split glued numbers (`5kg` → `5 kg`), strip punctuation. Decimal points and negative number signs survive so S11 can reject negative quantities. Zero-width formatting marks inside numeric text are removed to preserve the whole number, sign, and decimal. `2-ctn` and `ctn-2` remain separators; `rs.10` becomes `rs 10`.

   **Numbers with commas:** a well-formed grouping becomes one number before punctuation is stripped: Western (`1,000`, `12,500`, `1,250,000`) and Indian (`1,00,000`, `12,34,567`). A grouping must not touch another digit, decimal or comma-digit on either side. Any other comma between digits (`1,5`, `2,50`, `1,0000`, `1,000.5`) stays one token. It is never a quantity, price or size, and neither is the unit, price or size word right after it. It's recorded as `unclearNumber`, removed from the product text, and S16 asks. Order splitting never breaks a line at a comma with a digit on both sides.
2. **Price:** a number followed by `rs / rupees / wala / wali / vala …`, then `rs` followed by a number. Prices are MRP hints, never quantities. All explicit hints are retained; different prices require review.
3. **Pack size:** a number followed by `kg / kilo / g / gm / gram / l / ltr / litre / ml`. Sizes are variant hints, never quantities. All explicit sizes are retained; conflicting values or dimensions require review.
4. **Quantity + unit:** a unit word with a number directly before it (digits or a Hindi number word), or digits directly after it (`ctn 2`).

   | Unit | Words accepted |
   |---|---|
   | piece | pc, pcs, piece, pieces, nag |
   | packet | pkt, pkts, packet, packets, pack, paket |
   | carton | ctn, ctns, carton, cartons, petti, peti, box |
   | dozen | dz, dzn, dozen, darjan, darjen, darzan |
   | bag | bag, bags, bora, bori, katta |

5. **Hindi number words** (`ek, do, teen, char, paanch, … das, barah, bees, pachas, sau`) count **only directly before a unit word**, because "do" also means "give" ("bhej do").
6. **Two or more different pairs** → quantity unresolved (S7 decides).
7. **No pair, one bare number** → that's the quantity, unit unknown. If a word follows any unused number and isn't a known unit or filler, it's recorded as an **unknown unit** (S12), even when another recognised quantity+unit pair is present. Thus `maggi 2 ctn 5 jodi` still asks about `jodi`.
8. **Product text** = what's left, minus fillers (`bhej, bhejo, dena, chahiye, pls, aur, bhai, …`).
9. **Numbers inside catalogue names** (checked first): a `<number> <word>` pair that occurs in a catalogue name or alias, such as `5 star`, stays product text. It's never read as a quantity or an unknown unit. Pairs whose word is a unit (`maggi 4 pack`) are handled by S7 instead. A misspelled name with a number (`5 sttar`) isn't recognised and is asked about. That's safe, but it costs a tap.

Pack sizes in kg/g/L/ml are never order units. A shop orders "3 bag" of 10 kg atta, not "30 kg".

## 5. Project rules

### Data and evaluation
- **Lock the test set before tuning anything** (`npm run split`). Never edit a locked test file; the harness refuses to score it.
- **Tune only on dev data:** thresholds, prompts, aliases, parser vocabulary.
- **Never change a gold label to make a number look better.** If a label is wrong, fix it on dev data, explain why, and re-lock a new test set if the test set was affected.
- **Training data must not resemble the test set:** `npm run check-leak` (trigram similarity ≥ 0.85 is a leak). `npm run export-train` refuses to export leaks.
- **Report what was measured**, including failures and the conditions (hardware, swap).

### Privacy
- **Real shop data stays on the shop's machine.** `data/real/`, `data/app/`, `data/train/` and `results/` are gitignored.
- No telemetry, analytics or cloud calls at runtime. Tracing services (e.g. Sentry) may only ever see **synthetic** orders.
- Fine-tuning (if used) is a one-time cloud step on synthetic or consented data, stated openly.

### Honesty in write-ups
- Synthetic data is called synthetic. Don't present generated lines as real orders.
- Don't invent shopkeepers, users, quotes or payments.

### Code
- **The model never owns a number.** New features that need a number get it from code.
- No runtime or dev dependencies without a strong reason ([CONTRIBUTING.md](../CONTRIBUTING.md)).
- Fix bugs test-first: write the failing test, then the minimal fix.
- Never weaken a safety rule to make a test or metric pass.
