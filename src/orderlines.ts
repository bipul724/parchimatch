// Splits a pasted WhatsApp/phone order into one candidate item per line.
// Commas and semicolons separate items ("maggi 2 ctn, parle g 5/- 1 petti"); list bullets and numbering are stripped.
// A comma with a digit on both sides belongs to a number ("1,500 bag"): splitting there turned
// "aashirvaad atta 10 kg 1,500 bag" into a green row for 1 bag. The parser reads or questions it (S16).
export function splitOrder(text: string): string[] {
  return text
    .split(/\r?\n/)
    .flatMap((l) => l.split(/;|(?<!\p{Nd}),|,(?!\p{Nd})/u))
    .map((s) =>
      s
        .trim()
        .replace(/^[-*•]\s+/, '')
        .replace(/^\d{1,2}[.)]\s+/, '')
        .trim(),
    )
    .filter(Boolean);
}
