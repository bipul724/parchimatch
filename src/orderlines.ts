// Splits a pasted WhatsApp/phone order into one candidate item per line.
// Commas and semicolons separate items ("maggi 2 ctn, parle g 5/- 1 petti"); list bullets and numbering are stripped.
export function splitOrder(text: string): string[] {
  return text
    .split(/\r?\n/)
    .flatMap((l) => l.split(/[,;]/))
    .map((s) =>
      s
        .trim()
        .replace(/^[-*•]\s+/, '')
        .replace(/^\d{1,2}[.)]\s+/, '')
        .trim(),
    )
    .filter(Boolean);
}
