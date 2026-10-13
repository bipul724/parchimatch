import type { Parsed, QtyUnit, Size, Unit } from './types.ts';

// Deterministic reading of one order line. Code owns every number; the model only resolves the product.

const DIGIT_SETS = ['०१२३४५६७८९', '૦૧૨૩૪૫૬૭૮૯', '০১২৩৪৫৬৭৮৯'];
const DEVANAGARI_WORDS: Record<string, string> = {
  'पेटी': 'petti',
  'पेटि': 'petti',
  'पैकेट': 'packet',
  'दर्जन': 'darjan',
  'वाला': 'wala',
  'वाली': 'wali',
  'रुपये': 'rs',
  'रुपए': 'rs',
  'नग': 'nag',
  'बोरा': 'bora',
  'किलो': 'kilo',
  'लीटर': 'litre',
};

export const UNIT_WORDS: Record<string, Unit> = {
  pc: 'piece', pcs: 'piece', piece: 'piece', pieces: 'piece', nag: 'piece',
  pkt: 'packet', pkts: 'packet', packet: 'packet', packets: 'packet', pack: 'packet', paket: 'packet',
  ctn: 'carton', ctns: 'carton', carton: 'carton', cartons: 'carton', petti: 'carton', peti: 'carton', box: 'carton',
  dz: 'dozen', dzn: 'dozen', dozen: 'dozen', darjan: 'dozen', darjen: 'dozen', darzan: 'dozen',
  bag: 'bag', bags: 'bag', bora: 'bag', bori: 'bag', katta: 'bag',
};

// Only counted as a quantity when written directly before a unit word ("ek petti"),
// because words like "do" also mean "give" ("bhej do").
export const NUMBER_WORDS: Record<string, number> = {
  ek: 1, do: 2, teen: 3, tin: 3, char: 4, chaar: 4, panch: 5, paanch: 5, chhe: 6, chhah: 6,
  saat: 7, aath: 8, nau: 9, das: 10, gyarah: 11, barah: 12, pandrah: 15, bees: 20,
  pachees: 25, tees: 30, chalis: 40, pachas: 50, sau: 100,
};

const PRICE_AFTER_NUMBER = new Set(['rs', 'rupees', 'rupee', 'rupay', 'rupaye', 'rupaiya', 'wala', 'wali', 'wale', 'vala', 'vali', 'waala']);
const PRICE_BEFORE_NUMBER = new Set(['rs', 'rupees', 'rupee']);

const SIZE_WORDS: Record<string, { dim: 'g' | 'ml'; factor: number }> = {
  kg: { dim: 'g', factor: 1000 }, kgs: { dim: 'g', factor: 1000 }, kilo: { dim: 'g', factor: 1000 }, kilos: { dim: 'g', factor: 1000 },
  g: { dim: 'g', factor: 1 }, gm: { dim: 'g', factor: 1 }, gms: { dim: 'g', factor: 1 }, gram: { dim: 'g', factor: 1 }, grams: { dim: 'g', factor: 1 },
  l: { dim: 'ml', factor: 1000 }, lt: { dim: 'ml', factor: 1000 }, ltr: { dim: 'ml', factor: 1000 }, litre: { dim: 'ml', factor: 1000 }, liter: { dim: 'ml', factor: 1000 },
  ml: { dim: 'ml', factor: 1 },
};

const FILLER = new Set([
  'bhej', 'bhejo', 'bhejna', 'bhejdo', 'dena', 'dedo', 'chahiye', 'chaiye', 'chahie',
  'please', 'pls', 'plz', 'aur', 'and', 'bhai', 'x',
  ...PRICE_AFTER_NUMBER,
]);

const isDigits = (t: string) => /^-?\d+(\.\d+)?$/.test(t);

export function normalize(raw: string): string {
  let s = raw.normalize('NFKC').toLowerCase();
  for (const digits of DIGIT_SETS) {
    s = s.replace(new RegExp(`[${digits}]`, 'g'), (d) => String(digits.indexOf(d)));
  }
  // Invisible formatting inside a number must not turn 22 into two separate 2s.
  s = s.replace(/(?<=[\d.\-−])[\u200b\u200c\u200d\ufeff]+(?=[\d.])/g, '');
  // Well-formed groupings are one number: Western 1,500 / 1,250,000 and Indian 1,00,000 / 12,34,567.
  // Stripping the comma as punctuation read "maggi 2,500 pkt" as 500 packets. Any other digit,digit stays one
  // token ("1,5") that is never a number; parse() records it as unclearNumber and S16 asks.
  s = s.replace(/(?<!\d|\d[.,])(?:\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})+,\d{3})(?!\d|[.,]\d)/g, (m) => m.replace(/,/g, ''));
  for (const [dev, lat] of Object.entries(DEVANAGARI_WORDS)) s = s.split(dev).join(` ${lat} `);
  s = s.replace(/₹/g, ' rs ');
  s = s.replace(/(\d)\s*\/-/g, '$1 rs ');
  s = s.replace(/(\d)([a-zऀ-ॿ])/g, '$1 $2').replace(/([a-zऀ-ॿ])(\d)/g, '$1 $2');
  // Keep decimal points and signed numbers, but split punctuation such as "rs.10".
  s = s.replace(/(?<!\d)\.|\.(?!\d)/g, ' ');
  s = s.replace(/−/g, '-');
  s = s.replace(/(?<=[a-zऀ-ॿ])-(?=\d)|-(?!\d)/g, ' ');
  s = s.replace(/[^a-z0-9.,\-ऀ-ॿ]+/g, ' ');
  s = s.replace(/(?<!\d),|,(?!\d)/g, ' ');
  s = s.replace(/(^|\s)\.+|\.+(?=\s|$)/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

export function sizeOf(value: number, word: string): Size | null {
  const w = SIZE_WORDS[word];
  return w ? { value: value * w.factor, dim: w.dim } : null;
}

// Finds the first "<number> <size word>" in already-normalised text, e.g. a catalogue variant "1 kg".
export function findSize(text: string): Size | null {
  const t = normalize(text).split(' ');
  for (let i = 0; i + 1 < t.length; i++) {
    if (isDigits(t[i])) {
      const s = sizeOf(Number(t[i]), t[i + 1]);
      if (s) return s;
    }
  }
  return null;
}

export function sameSize(a: Size, b: Size): boolean {
  return a.dim === b.dim && Math.abs(a.value - b.value) < 1e-6;
}

export function numberValue(token: string): number | null {
  if (isDigits(token)) return Number(token);
  return NUMBER_WORDS[token] ?? null;
}

export interface ParseOptions {
  // "<number> <word>" pairs that occur in catalogue names ("5 star"). They stay product words,
  // never a quantity or an unknown unit. Build with numberNamePhrases() in catalog.ts.
  namePhrases?: Set<string>;
}

export function parse(raw: string, opts: ParseOptions = {}): Parsed {
  const tokens = normalize(raw).split(' ').filter(Boolean);
  const used = tokens.map(() => false);
  const inName = tokens.map(() => false);
  if (opts.namePhrases?.size) {
    for (let i = 0; i + 1 < tokens.length; i++) {
      if (!inName[i] && isDigits(tokens[i]) && opts.namePhrases.has(`${tokens[i]} ${tokens[i + 1]}`)) {
        inName[i] = inName[i + 1] = used[i] = used[i + 1] = true;
      }
    }
  }
  // "1,5" could mean 1.5, 15 or 1 and 5. Neither it nor the unit/price/size word after it may be read as anything.
  let unclearNumber: string | null = null;
  tokens.forEach((t, i) => {
    if (!/\d,\d/.test(t)) return;
    unclearNumber ??= t;
    used[i] = true;
    const next = tokens[i + 1];
    if (next && (UNIT_WORDS[next] || SIZE_WORDS[next] || PRICE_AFTER_NUMBER.has(next))) used[i + 1] = true;
  });
  let priceHint: number | null = null;
  let sizeHint: Size | null = null;
  const priceHints: number[] = [];
  const sizeHints: Size[] = [];

  // 1. Prices written after the number ("5 rs", "10 wala") take precedence over "rs 5".
  for (let i = 0; i + 1 < tokens.length; i++) {
    if (!used[i] && isDigits(tokens[i]) && PRICE_AFTER_NUMBER.has(tokens[i + 1])) {
      priceHint ??= Number(tokens[i]);
      priceHints.push(Number(tokens[i]));
      used[i] = used[i + 1] = true;
    }
  }
  for (let i = 0; i + 1 < tokens.length; i++) {
    // In "rs 5 rs 10", the middle rs marks both the first suffix and the second prefix.
    // Do not consume the ordinary quantity in "5 rs 2 pkt" or "5 rs 2".
    const sharedMarker = used[i] && i >= 2 && isDigits(tokens[i - 1]) && PRICE_BEFORE_NUMBER.has(tokens[i - 2])
      && !UNIT_WORDS[tokens[i + 2]] && !SIZE_WORDS[tokens[i + 2]];
    if ((!used[i] && !used[i + 1] || sharedMarker) && PRICE_BEFORE_NUMBER.has(tokens[i]) && isDigits(tokens[i + 1])) {
      priceHint ??= Number(tokens[i + 1]);
      if (!priceHints.includes(Number(tokens[i + 1]))) priceHints.push(Number(tokens[i + 1]));
      used[i] = used[i + 1] = true;
    }
  }

  // 2. Pack sizes ("10 kilo", "250 gm") describe the variant, never the quantity.
  for (let i = 0; i + 1 < tokens.length; i++) {
    if (!used[i] && isDigits(tokens[i])) {
      const s = sizeOf(Number(tokens[i]), tokens[i + 1]);
      if (s) {
        sizeHint ??= s;
        sizeHints.push(s);
        used[i] = used[i + 1] = true;
      }
    }
  }

  // 3. Quantity + unit pairs: "2 petti", "ek petti", "ctn 2".
  const pairs: QtyUnit[] = [];
  let loneUnit: Unit | null = null;
  for (let i = 0; i < tokens.length; i++) {
    const unit = UNIT_WORDS[tokens[i]];
    if (!unit || used[i]) continue;
    used[i] = true;
    const left = i > 0 && !used[i - 1] ? numberValue(tokens[i - 1]) : null;
    if (left !== null) {
      pairs.push({ qty: left, unit });
      used[i - 1] = true;
      continue;
    }
    const right = i + 1 < tokens.length && !used[i + 1] && isDigits(tokens[i + 1]) ? Number(tokens[i + 1]) : null;
    if (right !== null) {
      pairs.push({ qty: right, unit });
      used[i + 1] = true;
      continue;
    }
    loneUnit ??= unit;
  }

  const bareNumbers: number[] = [];
  const bareAt: number[] = [];
  tokens.forEach((t, i) => {
    if (!used[i] && isDigits(t)) {
      bareNumbers.push(Number(t));
      bareAt.push(i);
      used[i] = true;
    }
  });

  let qty: number | null = null;
  let unit: Unit | null = null;
  let unknownUnit: string | null = null;
  // Retain every unexplained number+word phrase, even beside a recognised pair.
  // Otherwise "2 ctn 5 jodi" silently loses the second ordered quantity.
  for (const i of bareAt) {
    const next = tokens[i + 1];
    if (next && !used[i + 1] && !FILLER.has(next) && /^[a-zऀ-ॿ]+$/.test(next)) {
      unknownUnit ??= next;
      used[i + 1] = true;
    }
  }
  const distinct = pairs.filter((p, i) => pairs.findIndex((q) => q.qty === p.qty && q.unit === p.unit) === i);
  if (distinct.length === 1) ({ qty, unit } = distinct[0]);
  else if (distinct.length === 0) {
    if (bareNumbers.length === 1) {
      qty = bareNumbers[0];
    }
    unit = loneUnit;
  }

  const productText = tokens.filter((t, i) => (inName[i] || !used[i]) && !FILLER.has(t)).join(' ');
  return { tokens, productText, qty, unit, pairs: distinct, priceHint, sizeHint, priceHints, sizeHints, unknownUnit, unclearNumber };
}

// True when the order text itself contains this quantity (as digits or a Hindi number word).
export function mentionsNumber(tokens: string[], n: number): boolean {
  return tokens.some((t) => numberValue(t) === n);
}
