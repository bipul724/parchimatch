import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { textSimilarity } from '../src/retrieve.ts';
import { normalize } from '../src/text.ts';
import type { Case, Unit } from '../src/types.ts';
import { ensureDir, mulberry32, parseArgs, sha256, writeJsonl } from '../src/util.ts';

// SYNTHETIC data generator for ParchiMatch Lite. Everything it writes is invented:
// catalogue values (MRPs, carton sizes) are illustrative, order lines come from the noise model below.
// Gold labels are computed from what the generator intended, the way a careful human would read the line.
//
// Usage: node tools/gen-synthetic.ts --out data/synthetic --test 80 --dev 320 --seed 2026

type Size = { n: number; u: 'kg' | 'g' | 'L' | 'ml' };
interface Variant { code: string; label: string; mrp: number; units: Unit[]; upc: number | null; size?: Size }
interface Family {
  key: string;
  brand: string;
  name: string;
  aliases: string[]; // what the shop's billing software lists (goes in the catalogue)
  hindi?: string[]; // Hindi/Hinglish names customers use (never in the catalogue)
  colour?: string[]; // pack-colour names
  loose?: string[]; // brand-only or shared names that fit several products
  deva?: string[]; // Devanagari spellings
  disc: 'price' | 'size' | 'none'; // how variants are told apart in an order
  v: Variant[];
}

const U = (s: string) => s.split('|') as Unit[];
const P = (code: string, mrp: number, units = 'packet|carton', upc: number | null = null, kind = 'pack'): Variant => ({ code, mrp, units: U(units), upc, label: `₹${mrp} ${kind}` });
const S = (code: string, n: number, u: Size['u'], mrp: number, units = 'packet|carton', upc: number | null = null, extra = ''): Variant => ({
  code, mrp, units: U(units), upc, size: { n, u }, label: `${n} ${u}${extra ? ` ${extra}` : ''}`,
});

// ~50 product families, ~110 SKUs. MRPs and carton sizes are illustrative, not quotes.
const FAMILIES: Family[] = [
  // Biscuits
  { key: 'PRLG', brand: 'Parle', name: 'Parle-G Biscuit', aliases: ['parle g'], hindi: ['parle ji'], loose: ['parle'], deva: ['पारले जी'], disc: 'price', v: [P('5', 5, 'packet|carton', 144), P('10', 10, 'packet|carton', 72), P('20', 20, 'packet|carton', 36), P('50', 50, 'packet|carton', 12)] },
  { key: 'MONACO', brand: 'Parle', name: 'Monaco Biscuit', aliases: ['monaco'], loose: ['parle'], disc: 'price', v: [P('10', 10, 'packet|carton', 60), P('30', 30, 'packet|carton', 24)] },
  { key: 'HIDESEEK', brand: 'Parle', name: 'Hide & Seek', aliases: ['hide and seek', 'hide & seek'], loose: ['parle'], disc: 'price', v: [P('10', 10, 'packet|carton', 60), P('30', 30, 'packet|carton', 24)] },
  { key: 'KRACKJACK', brand: 'Parle', name: 'Krackjack', aliases: ['krackjack'], hindi: ['crackjack'], disc: 'none', v: [P('10', 10, 'packet|carton', 60)] },
  { key: 'GDCASHEW', brand: 'Britannia', name: 'Good Day Cashew', aliases: ['good day cashew'], hindi: ['good day kaju'], loose: ['good day'], disc: 'price', v: [P('10', 10, 'packet|carton', 60), P('30', 30, 'packet|carton', 24)] },
  { key: 'GDBUTTER', brand: 'Britannia', name: 'Good Day Butter', aliases: ['good day butter'], hindi: ['good day makhan'], loose: ['good day'], disc: 'none', v: [P('10', 10, 'packet|carton', 60)] },
  { key: 'MARIE', brand: 'Britannia', name: 'Marie Gold', aliases: ['marie gold', 'marie'], disc: 'price', v: [P('10', 10, 'packet|carton', 60), P('30', 30, 'packet|carton', 24)] },
  { key: 'BOURBON', brand: 'Britannia', name: 'Bourbon', aliases: ['bourbon'], hindi: ['borbon'], disc: 'price', v: [P('10', 10, 'packet|carton', 60), P('30', 30, 'packet|carton', null)] },
  { key: 'DARKFAN', brand: 'Sunfeast', name: 'Dark Fantasy Choco Fills', aliases: ['dark fantasy'], disc: 'price', v: [P('10', 10, 'packet|carton', 48), P('40', 40, 'packet|carton', 24)] },
  // Noodles. Shop convention: plain "maggi" means the single pack.
  { key: 'MAGGI', brand: 'Nestle', name: 'Maggi Masala Noodles', aliases: ['maggi'], deva: ['मैगी'], disc: 'none', v: [S('70G', 70, 'g', 14, 'packet|carton', 96, 'single')] },
  { key: 'MAGGI4P', brand: 'Nestle', name: 'Maggi Masala Noodles 4-Pack', aliases: ['maggi 4 pack'], hindi: ['maggi family pack'], disc: 'none', v: [S('280G', 280, 'g', 56, 'packet|carton', 24)] },
  { key: 'YIPPEE', brand: 'Sunfeast', name: 'Yippee Magic Masala Noodles', aliases: ['yippee'], hindi: ['yipee'], disc: 'none', v: [S('60G', 60, 'g', 15, 'packet|carton', 96)] },
  { key: 'CHINGS', brand: "Ching's", name: "Ching's Hakka Noodles", aliases: ['chings hakka', 'chings noodles'], disc: 'none', v: [S('150G', 150, 'g', 40, 'packet|carton', 48)] },
  // Staples
  { key: 'TATASALT', brand: 'Tata', name: 'Tata Salt', aliases: ['tata salt'], hindi: ['tata namak'], deva: ['टाटा नमक'], disc: 'size', v: [S('1KG', 1, 'kg', 28, 'packet|carton', 25), S('500G', 500, 'g', 15, 'packet|carton', 50)] },
  { key: 'AASHATTA', brand: 'ITC', name: 'Aashirvaad Atta', aliases: ['aashirvaad atta', 'aashirvaad'], hindi: ['ashirwad aata', 'aashirvaad aata'], disc: 'size', v: [S('5KG', 5, 'kg', 260, 'bag'), S('10KG', 10, 'kg', 495, 'bag')] },
  { key: 'FORTATTA', brand: 'Fortune', name: 'Fortune Chakki Atta', aliases: ['fortune atta'], hindi: ['fortune aata'], loose: ['fortune'], disc: 'size', v: [S('5KG', 5, 'kg', 240, 'bag'), S('10KG', 10, 'kg', 460, 'bag')] },
  { key: 'FORTOIL', brand: 'Fortune', name: 'Fortune Soyabean Oil', aliases: ['fortune oil', 'fortune soyabean'], hindi: ['fortune tel'], loose: ['fortune'], disc: 'size', v: [S('1L', 1, 'L', 155, 'piece|carton', 12, 'pouch'), S('5L', 5, 'L', 760, 'piece')] },
  { key: 'SAFFOLA', brand: 'Saffola', name: 'Saffola Gold Oil', aliases: ['saffola gold', 'saffola'], hindi: ['saffola tel'], disc: 'size', v: [S('1L', 1, 'L', 210, 'piece|carton', 12, 'pouch'), S('5L', 5, 'L', 1050, 'piece')] },
  { key: 'TOORDAL', brand: 'Tata Sampann', name: 'Tata Sampann Toor Dal', aliases: ['tata toor dal', 'tata sampann toor'], hindi: ['tata arhar dal'], disc: 'none', v: [S('1KG', 1, 'kg', 180, 'packet|carton', 20)] },
  { key: 'INDIAGATE', brand: 'India Gate', name: 'India Gate Basmati Rice', aliases: ['india gate basmati', 'india gate'], hindi: ['india gate chawal'], disc: 'size', v: [S('1KG', 1, 'kg', 150, 'packet|carton', 20), S('5KG', 5, 'kg', 690, 'bag')] },
  { key: 'MADHUR', brand: 'Madhur', name: 'Madhur Sugar', aliases: ['madhur sugar', 'madhur'], hindi: ['madhur cheeni', 'madhur shakkar'], disc: 'size', v: [S('1KG', 1, 'kg', 52, 'packet|carton', 30), S('5KG', 5, 'kg', 250, 'bag')] },
  // Spices
  { key: 'KITCHENKING', brand: 'MDH', name: 'MDH Kitchen King Masala', aliases: ['mdh kitchen king', 'kitchen king'], loose: ['mdh'], disc: 'none', v: [S('100G', 100, 'g', 90, 'packet|dozen|carton', 60)] },
  { key: 'CHANAMASALA', brand: 'MDH', name: 'MDH Chana Masala', aliases: ['mdh chana masala'], hindi: ['mdh chole masala'], loose: ['mdh'], disc: 'none', v: [S('100G', 100, 'g', 85, 'packet|dozen|carton', 60)] },
  { key: 'EVHALDI', brand: 'Everest', name: 'Everest Turmeric Powder', aliases: ['everest turmeric'], hindi: ['everest haldi'], loose: ['everest'], disc: 'size', v: [S('100G', 100, 'g', 38, 'packet|dozen|carton', 100), S('200G', 200, 'g', 72, 'packet|dozen|carton', 50)] },
  { key: 'EVGARAM', brand: 'Everest', name: 'Everest Garam Masala', aliases: ['everest garam masala'], loose: ['everest'], disc: 'none', v: [S('100G', 100, 'g', 82, 'packet|dozen|carton', 60)] },
  // Tea and coffee
  { key: 'TATATEA', brand: 'Tata', name: 'Tata Tea Premium', aliases: ['tata tea premium', 'tata tea'], hindi: ['tata chai', 'tata patti'], disc: 'size', v: [S('250G', 250, 'g', 145, 'packet|carton', 40), S('500G', 500, 'g', 285, 'packet|carton', 20), S('1KG', 1, 'kg', 560, 'packet|carton', 10)] },
  { key: 'REDLABEL', brand: 'Brooke Bond', name: 'Brooke Bond Red Label', aliases: ['red label'], hindi: ['red label chai'], disc: 'size', v: [S('250G', 250, 'g', 150, 'packet|carton', 40), S('500G', 500, 'g', 295, 'packet|carton', 20)] },
  { key: 'WAGHBAKRI', brand: 'Wagh Bakri', name: 'Wagh Bakri Tea', aliases: ['wagh bakri'], hindi: ['wagh bakri chai'], disc: 'size', v: [S('250G', 250, 'g', 140, 'packet|carton', 40), S('500G', 500, 'g', 275, 'packet|carton', 20)] },
  { key: 'NESCAFE', brand: 'Nestle', name: 'Nescafe Classic', aliases: ['nescafe classic', 'nescafe'], hindi: ['nescafe coffee'], disc: 'size', v: [S('50G', 50, 'g', 190, 'piece|dozen|carton', 48), S('100G', 100, 'g', 360, 'piece|dozen|carton', 24)] },
  // Dairy
  { key: 'AMULBUTTER', brand: 'Amul', name: 'Amul Butter', aliases: ['amul butter'], hindi: ['amul makhan'], loose: ['amul'], deva: ['अमूल मक्खन'], disc: 'size', v: [S('100G', 100, 'g', 60, 'piece|carton', 50), S('500G', 500, 'g', 285, 'piece|carton', 20)] },
  { key: 'AMULGHEE', brand: 'Amul', name: 'Amul Ghee', aliases: ['amul ghee'], loose: ['amul'], disc: 'size', v: [S('500ML', 500, 'ml', 330, 'piece|carton', 24), S('1L', 1, 'L', 650, 'piece|carton', 12)] },
  // Snacks
  { key: 'LAYSMAG', brand: 'PepsiCo', name: "Lay's India's Magic Masala", aliases: ['lays magic masala'], colour: ['lays nila', 'lays blue'], loose: ['lays'], disc: 'price', v: [P('10', 10, 'packet|carton', 48), P('20', 20, 'packet|carton', 24)] },
  { key: 'LAYSCRM', brand: 'PepsiCo', name: "Lay's American Cream & Onion", aliases: ['lays cream onion', 'lays cream and onion'], colour: ['lays hara', 'lays green'], loose: ['lays'], disc: 'price', v: [P('10', 10, 'packet|carton', 48), P('20', 20, 'packet|carton', 24)] },
  { key: 'LAYSCLS', brand: 'PepsiCo', name: "Lay's Classic Salted", aliases: ['lays classic salted', 'lays salted'], colour: ['lays peela', 'lays yellow'], loose: ['lays'], disc: 'price', v: [P('10', 10, 'packet|carton', 48), P('20', 20, 'packet|carton', 24)] },
  { key: 'KURKURE', brand: 'PepsiCo', name: 'Kurkure Masala Munch', aliases: ['kurkure masala munch', 'kurkure'], disc: 'price', v: [P('10', 10, 'packet|carton', 48), P('20', 20, 'packet|carton', 24)] },
  { key: 'MADANGLES', brand: 'ITC', name: 'Bingo Mad Angles', aliases: ['bingo mad angles', 'mad angles'], loose: ['bingo'], disc: 'price', v: [P('10', 10, 'packet|carton', 48), P('20', 20, 'packet|carton', 24)] },
  { key: 'BHUJIA', brand: "Haldiram's", name: "Haldiram's Aloo Bhujia", aliases: ['haldiram aloo bhujia', 'aloo bhujia'], hindi: ['haldiram bhujia'], loose: ['haldiram'], disc: 'size', v: [S('200G', 200, 'g', 55, 'packet|carton', 30), S('400G', 400, 'g', 105, 'packet|carton', 15)] },
  { key: 'MOONGDAL', brand: "Haldiram's", name: "Haldiram's Moong Dal", aliases: ['haldiram moong dal'], loose: ['haldiram'], disc: 'none', v: [S('200G', 200, 'g', 55, 'packet|carton', 30)] },
  // Beverages
  { key: 'FROOTI', brand: 'Parle Agro', name: 'Frooti Mango Drink', aliases: ['frooti'], hindi: ['fruti'], deva: ['फ्रूटी'], disc: 'price', v: [P('10', 10, 'piece|carton', 40, 'tetra pack'), P('20', 20, 'piece|carton', 30, 'bottle')] },
  { key: 'COKE', brand: 'Coca-Cola', name: 'Coca-Cola', aliases: ['coca cola', 'coke'], disc: 'size', v: [S('750ML', 750, 'ml', 40, 'piece|carton', 24), S('2L', 2, 'L', 95, 'piece|carton', 9)] },
  { key: 'THUMSUP', brand: 'Coca-Cola', name: 'Thums Up', aliases: ['thums up'], hindi: ['thumbs up', 'thumsup'], disc: 'size', v: [S('750ML', 750, 'ml', 40, 'piece|carton', 24), S('2L', 2, 'L', 95, 'piece|carton', 9)] },
  { key: 'BISLERI', brand: 'Bisleri', name: 'Bisleri Water', aliases: ['bisleri'], hindi: ['bisleri paani'], disc: 'size', v: [S('500ML', 500, 'ml', 10, 'piece|carton', 24), S('1L', 1, 'L', 20, 'piece|carton', 12)] },
  // Chocolates
  { key: 'DAIRYMILK', brand: 'Cadbury', name: 'Dairy Milk', aliases: ['dairy milk', 'cadbury dairy milk'], loose: ['cadbury'], disc: 'price', v: [P('10', 10, 'piece|dozen|carton', null, 'bar'), P('20', 20, 'piece|dozen|carton', null, 'bar'), P('40', 40, 'piece|dozen|carton', 120, 'bar')] },
  { key: 'FIVESTAR', brand: 'Cadbury', name: '5 Star', aliases: ['5 star'], hindi: ['five star'], loose: ['cadbury'], disc: 'price', v: [P('10', 10, 'piece|dozen|carton', 240, 'bar'), P('20', 20, 'piece|dozen|carton', 120, 'bar')] },
  { key: 'KITKAT', brand: 'Nestle', name: 'KitKat', aliases: ['kitkat', 'kit kat'], disc: 'price', v: [P('10', 10, 'piece|dozen|carton', 240, 'bar'), P('20', 20, 'piece|dozen|carton', 120, 'bar')] },
  // Personal care
  { key: 'COLGATE', brand: 'Colgate', name: 'Colgate Strong Teeth', aliases: ['colgate strong teeth', 'colgate'], disc: 'size', v: [S('100G', 100, 'g', 60, 'piece|dozen|carton', 72), S('200G', 200, 'g', 110, 'piece|dozen|carton', 36)] },
  { key: 'CLOSEUP', brand: 'HUL', name: 'Close-Up Toothpaste', aliases: ['closeup', 'close up'], disc: 'size', v: [S('80G', 80, 'g', 55, 'piece|dozen|carton', 72), S('150G', 150, 'g', 100, 'piece|dozen|carton', 36)] },
  { key: 'LUX', brand: 'HUL', name: 'Lux Soap', aliases: ['lux'], hindi: ['lux sabun'], deva: ['लक्स'], disc: 'price', v: [P('10', 10, 'piece|dozen|carton', 144, 'bar'), P('35', 35, 'piece|dozen|carton', 72, 'bar')] },
  { key: 'LIFEBUOY', brand: 'HUL', name: 'Lifebuoy Soap', aliases: ['lifebuoy'], hindi: ['lifebuoy sabun', 'lifeboy'], disc: 'price', v: [P('10', 10, 'piece|dozen|carton', 144, 'bar'), P('30', 30, 'piece|dozen|carton', 72, 'bar')] },
  { key: 'DETTOLSOAP', brand: 'Reckitt', name: 'Dettol Soap', aliases: ['dettol soap'], hindi: ['dettol sabun'], loose: ['dettol'], disc: 'size', v: [S('75G', 75, 'g', 45, 'piece|dozen|carton', 72), S('125G', 125, 'g', 70, 'piece|dozen|carton', 48)] },
  { key: 'DETTOLLIQ', brand: 'Reckitt', name: 'Dettol Antiseptic Liquid', aliases: ['dettol liquid'], loose: ['dettol'], disc: 'size', v: [S('125ML', 125, 'ml', 80, 'piece|carton', 48), S('250ML', 250, 'ml', 155, 'piece|carton', 24)] },
  { key: 'CLINICPLUS', brand: 'HUL', name: 'Clinic Plus Shampoo', aliases: ['clinic plus'], loose: ['clinic'], disc: 'price', v: [P('1', 1, 'packet|carton', null, 'sachet strip'), P('130', 130, 'piece|carton', 24, 'bottle 175 ml')] },
  { key: 'PARACHUTE', brand: 'Marico', name: 'Parachute Coconut Oil', aliases: ['parachute'], hindi: ['parachute nariyal tel', 'parachute tel'], disc: 'size', v: [S('100ML', 100, 'ml', 50, 'piece|dozen|carton', 96), S('250ML', 250, 'ml', 115, 'piece|dozen|carton', 48)] },
  // Cleaning
  { key: 'SURF', brand: 'HUL', name: 'Surf Excel Easy Wash', aliases: ['surf excel', 'surf'], hindi: ['sarf'], deva: ['सर्फ'], disc: 'size', v: [S('500G', 500, 'g', 75, 'packet|carton', 24), S('1KG', 1, 'kg', 140, 'packet|carton', 12)] },
  { key: 'GHADI', brand: 'RSPL', name: 'Ghadi Detergent Powder', aliases: ['ghadi'], hindi: ['ghadi powder', 'gadi'], disc: 'size', v: [S('500G', 500, 'g', 35, 'packet|carton', 40), S('1KG', 1, 'kg', 70, 'packet|carton', 20)] },
  { key: 'TIDE', brand: 'P&G', name: 'Tide Detergent', aliases: ['tide'], disc: 'none', v: [S('1KG', 1, 'kg', 110, 'packet|carton', 20)] },
  { key: 'RIN', brand: 'HUL', name: 'Rin Bar', aliases: ['rin bar', 'rin'], hindi: ['rin sabun'], disc: 'none', v: [P('10', 10, 'piece|carton', 100, 'bar')] },
  { key: 'VIMBAR', brand: 'HUL', name: 'Vim Bar', aliases: ['vim bar'], loose: ['vim'], disc: 'price', v: [P('10', 10, 'piece|carton', 90, 'bar'), P('20', 20, 'piece|carton', 60, 'bar')] },
  { key: 'VIMLIQ', brand: 'HUL', name: 'Vim Liquid', aliases: ['vim liquid', 'vim gel'], loose: ['vim'], disc: 'none', v: [S('250ML', 250, 'ml', 55, 'piece|carton', 36)] },
  { key: 'HARPIC', brand: 'Reckitt', name: 'Harpic Toilet Cleaner', aliases: ['harpic'], disc: 'size', v: [S('500ML', 500, 'ml', 99, 'piece|carton', 24), S('1L', 1, 'L', 190, 'piece|carton', 12)] },
  { key: 'LIZOL', brand: 'Reckitt', name: 'Lizol Floor Cleaner', aliases: ['lizol'], hindi: ['lizol phenyl'], disc: 'none', v: [S('500ML', 500, 'ml', 115, 'piece|carton', 24)] },
];

// Things customers ask for that this shop does not stock. Some deliberately contain a stocked name.
const NOT_STOCKED = ['tata salt lite', 'maggi atta noodles', 'colgate maxfresh', 'britannia 50 50', 'sunsilk shampoo', 'pepsi', 'hajmola', 'horlicks', 'nivea cream', 'ponds powder', 'patanjali dant kanti', 'surf excel matic', 'amul cheese', 'parle 20 20', 'bournvita', 'maaza'];

const UNIT_WORDS: Record<Unit, [string, number][]> = {
  piece: [['pc', 4], ['pcs', 3], ['piece', 2], ['nag', 3], ['pis', 1]],
  packet: [['pkt', 5], ['packet', 3], ['pkts', 1], ['pack', 1], ['paket', 1]],
  carton: [['ctn', 4], ['petti', 4], ['peti', 2], ['box', 2], ['carton', 1], ['ctns', 1]],
  dozen: [['dz', 4], ['dzn', 2], ['dozen', 2], ['darjan', 3]],
  bag: [['bag', 3], ['bora', 3], ['katta', 2], ['bori', 1]],
};
const HINGLISH_UNIT = new Set(['nag', 'petti', 'peti', 'darjan', 'bora', 'katta', 'bori', 'paket']);
const PARSER_UNKNOWN_UNIT = new Set(['pis']); // humans read it, the parser does not
const DEVA_UNIT: Record<Unit, string> = { piece: 'नग', packet: 'पैकेट', carton: 'पेटी', dozen: 'दर्जन', bag: 'बोरा' };
const HINDI_NUM: Record<number, string> = { 1: 'ek', 2: 'do', 3: 'teen', 4: 'char', 5: 'paanch', 10: 'das', 12: 'barah', 20: 'bees' };
const DEVA_DIGITS = '०१२३४५६७८९';

interface Sku { sku: string; fam: Family; v: Variant }
const SKUS: Sku[] = FAMILIES.flatMap((fam) => fam.v.map((v) => ({ sku: `${fam.key}-${v.code}`, fam, v })));

// phrase -> families that a careful human would consider for it
const PHRASE_FAMILIES = new Map<string, Family[]>();
for (const fam of FAMILIES) {
  for (const p of [...fam.aliases, ...(fam.hindi ?? []), ...(fam.colour ?? []), ...(fam.loose ?? []), ...(fam.deva ?? [])]) {
    const list = PHRASE_FAMILIES.get(p) ?? [];
    if (!list.includes(fam)) list.push(fam);
    PHRASE_FAMILIES.set(p, list);
  }
}

function makeRng(seed: number) {
  const r = mulberry32(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
  const weighted = <T>(xs: readonly [T, number][]): T => {
    const total = xs.reduce((s, [, w]) => s + w, 0);
    let x = r() * total;
    for (const [v, w] of xs) if ((x -= w) < 0) return v;
    return xs[xs.length - 1][0];
  };
  return { r, pick, weighted, chance: (p: number) => r() < p };
}
type Rng = ReturnType<typeof makeRng>;

const SUBS: [string, string][] = [['oo', 'u'], ['ee', 'i'], ['ph', 'f'], ['w', 'v'], ['v', 'w'], ['c', 'k'], ['ck', 'k'], ['ou', 'u'], ['ai', 'e'], ['y', 'i'], ['aa', 'a'], ['sh', 's']];
function misspell(phrase: string, g: Rng): string {
  const words = phrase.split(' ');
  const idx = words.map((w, i) => (/^[a-z]{4,}$/.test(w) ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return phrase;
  for (let attempt = 0; attempt < 6; attempt++) {
    const i = g.pick(idx);
    const w = words[i];
    let out = w;
    const op = g.pick(['drop', 'double', 'swap', 'sub', 'sub']);
    if (op === 'drop') {
      const vowels = [...w].map((c, j) => (j > 0 && 'aeiou'.includes(c) ? j : -1)).filter((j) => j > 0);
      if (vowels.length) {
        const j = g.pick(vowels);
        out = w.slice(0, j) + w.slice(j + 1);
      }
    } else if (op === 'double') {
      const j = 1 + Math.floor(g.r() * (w.length - 1));
      out = w.slice(0, j) + w[j] + w.slice(j);
    } else if (op === 'swap') {
      const j = 1 + Math.floor(g.r() * (w.length - 2));
      out = w.slice(0, j) + w[j + 1] + w[j] + w.slice(j + 2);
    } else {
      const [a, b] = g.pick(SUBS.filter(([a]) => w.includes(a)).length ? SUBS.filter(([a]) => w.includes(a)) : SUBS);
      out = w.replace(a, b);
    }
    if (out !== w) {
      words[i] = out;
      return words.join(' ');
    }
  }
  return phrase;
}

function priceText(p: number, g: Rng): { text: string; tags: string[] } {
  const forms: [string, number][] = [[`${p}/-`, 4], [`${p} wala`, 4], [`${p} wali`, 1], [`${p} rs`, 3], [`rs ${p}`, 2], [`₹${p}`, 2], [`${p} vala`, 1], [`${p}rs`, 1], [`${p} ka`, 1]];
  const text = g.weighted(forms);
  return { text, tags: text.endsWith(' ka') ? ['price_variant', 'informal_price'] : ['price_variant'] };
}

function sizeText(s: Size, g: Rng): { text: string; tags: string[] } {
  if (s.u === 'g' && s.n === 500 && g.chance(0.12)) return { text: g.pick(['aadha kilo', 'adha kg']), tags: ['size_variant', 'informal_size'] };
  const forms: Record<Size['u'], [string, number][]> = {
    kg: [[`${s.n}kg`, 3], [`${s.n} kg`, 3], [`${s.n} kilo`, 2]],
    g: [[`${s.n}gm`, 3], [`${s.n} gm`, 3], [`${s.n}g`, 2], [`${s.n} gram`, 1], [`${s.n} grm`, 1]],
    L: [[`${s.n}ltr`, 3], [`${s.n} ltr`, 3], [`${s.n} litre`, 2], [`${s.n}l`, 1]],
    ml: [[`${s.n}ml`, 3], [`${s.n} ml`, 3]],
  };
  const text = g.weighted(forms[s.u]);
  return { text, tags: text.endsWith('grm') ? ['size_variant', 'informal_size'] : ['size_variant'] };
}

function sameSize(a: Size, b: Size): boolean {
  const n = (s: Size) => (s.u === 'kg' || s.u === 'L' ? s.n * 1000 : s.n);
  const d = (s: Size) => (s.u === 'kg' || s.u === 'g' ? 'g' : 'ml');
  return d(a) === d(b) && n(a) === n(b);
}

function chooseUnit(units: Unit[], g: Rng): Unit {
  const w: Record<Unit, number> = { carton: 45, packet: 30, piece: 30, dozen: 20, bag: 50 };
  return g.weighted(units.map((u) => [u, w[u]] as [Unit, number]));
}

function chooseQty(unit: Unit, g: Rng): number {
  if (unit === 'carton' || unit === 'dozen' || unit === 'bag') return g.weighted([[1, 4], [2, 6], [3, 4], [4, 2], [5, 3], [6, 1], [10, 1]]);
  return g.weighted([[2, 2], [5, 3], [6, 2], [10, 4], [12, 3], [20, 3], [24, 2], [50, 1]]);
}

function qtyText(q: number, g: Rng, allowWord: boolean): { text: string; tags: string[] } {
  if (allowWord && HINDI_NUM[q] && g.chance(0.12)) return { text: HINDI_NUM[q], tags: ['hindi_number'] };
  return { text: String(q), tags: [] };
}

function caseVariant(s: string, g: Rng): string {
  if (g.chance(0.08)) return s.toUpperCase();
  if (g.chance(0.15)) return s.replace(/(^|\s)([a-z])/g, (_, a, b) => a + b.toUpperCase());
  return s;
}

// One labelled order line.
function makeLine(id: string, g: Rng): Case {
  const tags: string[] = [];

  // Products the shop does not stock
  if (g.chance(0.05)) {
    const name = g.pick(NOT_STOCKED);
    const unit = g.pick<Unit>(['carton', 'packet', 'piece', 'dozen']);
    const q = chooseQty(unit, g);
    return { id, text: caseVariant(`${name} ${q} ${g.weighted(UNIT_WORDS[unit])}`, g), gold: { sku: null, qty: q, unit, status: 'needs_review' }, tags: ['not_in_catalogue'] };
  }

  const target = g.pick(SKUS);
  const fam = target.fam;

  // Which name the customer uses
  const options: [string, string, number][] = [
    ...fam.aliases.map((a) => [a, 'alias', 6] as [string, string, number]),
    ...(fam.hindi ?? []).map((a) => [a, 'hindi_name', 3] as [string, string, number]),
    ...(fam.colour ?? []).map((a) => [a, 'colour_name', 2] as [string, string, number]),
    ...(fam.loose ?? []).map((a) => [a, 'brand_only', 1.5] as [string, string, number]),
  ];
  const useDeva = !!fam.deva?.length && g.chance(0.15);
  const [phrase, kind] = useDeva ? [g.pick(fam.deva!), 'devanagari'] : g.weighted(options.map(([p, k, w]) => [[p, k], w] as [[string, string], number]));
  if (kind !== 'alias') tags.push(kind);

  // Which SKUs that name could mean, before any price/size hint
  let possible = SKUS.filter((s) => (PHRASE_FAMILIES.get(phrase) ?? [fam]).includes(s.fam));
  if (/\d/.test(phrase)) tags.push('number_in_name');

  // Price or pack size, more often when it is needed to tell variants apart
  let disc = '';
  const needed = possible.length > 1;
  const wantsVariant = needed ? g.chance(0.8) : g.chance(0.3);
  const missingVariant = g.chance(0.02); // a price/size this shop does not carry
  if (wantsVariant && fam.disc === 'price') {
    const p = missingVariant ? target.v.mrp * 5 : target.v.mrp;
    const t = useDeva ? { text: `${p} ${g.pick(['वाला', 'वाली'])}`, tags: ['price_variant'] } : priceText(p, g);
    disc = t.text;
    tags.push(...t.tags);
    possible = possible.filter((s) => s.v.mrp === p);
  } else if (wantsVariant && fam.disc === 'size' && target.v.size) {
    const size = missingVariant ? { ...target.v.size, n: target.v.size.n * 3 } : target.v.size;
    const t = sizeText(size, g);
    disc = t.text;
    tags.push(...t.tags);
    possible = possible.filter((s) => s.v.size && sameSize(s.v.size, size));
  }

  let productText = phrase;
  if (!useDeva && g.chance(0.3)) {
    const m = misspell(phrase, g);
    if (m !== phrase) {
      productText = m;
      tags.push('misspelling');
    }
  }

  // Quantity and unit
  const unit = chooseUnit(target.v.units, g);
  const q = chooseQty(unit, g);
  let qtyGold: number | null = q;
  let unitGold: Unit | null = unit;
  let qtyPart: string;
  const special = g.r();
  if (special < 0.04) {
    qtyPart = '';
    qtyGold = null;
    unitGold = null;
    tags.push('missing_qty');
  } else if (special < 0.08) {
    qtyPart = String(q);
    unitGold = target.v.units.length === 1 ? unit : null;
    tags.push('missing_unit');
  } else if (special < 0.11) {
    qtyPart = `${q} ${g.pick(['ladi', 'jodi', 'set', 'tray'])}`;
    unitGold = null;
    tags.push('unknown_unit');
  } else if (useDeva) {
    const digits = g.chance(0.5) ? String(q).replace(/\d/g, (d) => DEVA_DIGITS[Number(d)]) : String(q);
    qtyPart = `${digits} ${DEVA_UNIT[unit]}`;
  } else {
    const word = g.weighted(UNIT_WORDS[unit]);
    if (HINGLISH_UNIT.has(word)) tags.push('hinglish_unit');
    if (PARSER_UNKNOWN_UNIT.has(word)) tags.push('informal_unit');
    const qt = qtyText(q, g, true);
    tags.push(...qt.tags);
    const layout = g.weighted<string>([['q u', 8], ['qu', qt.tags.length ? 0 : 1], ['u q', qt.tags.length ? 0 : 1]]);
    qtyPart = layout === 'qu' ? `${qt.text}${word}` : layout === 'u q' ? `${word} ${qt.text}` : `${qt.text} ${word}`;
    if (layout !== 'q u') tags.push(layout === 'qu' ? 'glued' : 'unit_first');
  }

  // Assemble the line
  const prod = [productText, disc].filter(Boolean).join(' ');
  let text: string;
  if (qtyPart && !useDeva && g.chance(0.15)) {
    text = `${qtyPart} ${prod}`;
    tags.push('word_order');
  } else text = [prod, qtyPart].filter(Boolean).join(g.chance(0.08) ? ' - ' : ' ');
  if (!useDeva && g.chance(0.07)) {
    text += ` ${g.pick(['bhej do', 'chahiye', 'pls', 'bhejna', 'bhej dena'])}`;
    tags.push('filler');
  }
  if (!useDeva) text = caseVariant(text, g);

  // Gold: what a careful shopkeeper would conclude
  let sku: string | null = possible.length === 1 ? possible[0].sku : null;
  if (possible.length === 0) tags.push('variant_not_stocked');
  else if (possible.length > 1) tags.push('ambiguous_variant');
  const reasons: string[] = [];
  if (sku === null) reasons.push('product');
  if (qtyGold === null) reasons.push('qty');
  if (unitGold === null) reasons.push('unit');
  const chosen = sku ? SKUS.find((s) => s.sku === sku)! : undefined;
  if (chosen && unitGold === 'carton' && chosen.v.upc === null) {
    reasons.push('carton_size');
    tags.push('carton_size_unknown');
  }
  return { id, text, gold: { sku, qty: qtyGold, unit: unitGold, status: reasons.length ? 'needs_review' : 'ok' }, tags: [...new Set(tags)].sort() };
}

function generate(n: number, seed: number, prefix: string, avoid: string[] = [], seen = new Set<string>()): Case[] {
  const g = makeRng(seed);
  const out: Case[] = [];
  const avoidNorm = avoid.map(normalize);
  let i = 0;
  while (out.length < n && i < n * 50) {
    const c = makeLine(`${prefix}${String(out.length + 1).padStart(3, '0')}`, g);
    i++;
    const key = normalize(c.text);
    if (seen.has(key)) continue;
    if (avoidNorm.some((t) => t === key || textSimilarity(t, key) >= 0.85)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

function catalogueCsv(): string {
  const q = (s: string) => (/[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const rows = SKUS.map(({ sku, fam, v }) => [sku, fam.name, fam.brand, v.label, String(v.mrp), v.units.join('|'), v.upc === null ? '' : String(v.upc), fam.aliases.join('|')].map(q).join(','));
  return ['sku,name,brand,variant,mrp,sell_units,units_per_carton,aliases', ...rows].join('\n') + '\n';
}

// WhatsApp-style full orders for the demo (unlabelled).
function orders(count: number, seed: number): string[] {
  const g = makeRng(seed);
  const hello = ['Namaste bhaiya', 'Bhai ji order note karo', 'Sir please send', 'Ram Ram bhaiya', 'Good morning sir, order:'];
  const bye = ['Kal subah tak bhej dena', 'Total bata dena', 'Payment UPI se kar dunga', 'Jaldi bhejna', 'Thanks'];
  return Array.from({ length: count }, (_, k) => {
    const lines = Array.from({ length: 5 + Math.floor(g.r() * 8) }, (_, j) => makeLine(`o${k}-${j}`, g).text);
    const merged: string[] = [];
    for (let j = 0; j < lines.length; j++) {
      if (j + 1 < lines.length && g.chance(0.2)) merged.push(`${lines[j]}, ${lines[++j]}`);
      else merged.push(lines[j]);
    }
    return [g.pick(hello), ...merged, g.pick(bye)].join('\n') + '\n';
  });
}

function stats(cases: Case[]) {
  const tags = new Map<string, number>();
  for (const c of cases) for (const t of c.tags) tags.set(t, (tags.get(t) ?? 0) + 1);
  return {
    n: cases.length,
    needsReview: cases.filter((c) => c.gold.status === 'needs_review').length,
    tags: Object.fromEntries([...tags].sort((a, b) => b[1] - a[1])),
  };
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  const out = String(args.out ?? 'data/synthetic');
  const seed = Number(args.seed ?? 2026);
  const nTest = Number(args.test ?? 80);
  const nDev = Number(args.dev ?? 320);
  const devOnly = Boolean(args['dev-only']);
  const lockPath = `${out}/test.jsonl.lock.json`;
  if (!devOnly && existsSync(lockPath) && !args.force) {
    console.error(`✗ ${lockPath} exists; the synthetic test set is locked. Use --dev-only to regenerate practice data, or --force if no results used it.`);
    process.exit(1);
  }

  ensureDir(`${out}/catalog.csv`);
  writeFileSync(`${out}/catalog.csv`, catalogueCsv());
  const seen = new Set<string>();
  // Test lines come from their own seed; practice lines must not copy or nearly copy them.
  const test = devOnly && existsSync(`${out}/test.jsonl`) ? (readFileSync(`${out}/test.jsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) as Case[]) : generate(nTest, seed + 1, 't', [], seen);
  for (const c of test) seen.add(normalize(c.text));
  const dev = generate(nDev, seed + 2, 'd', test.map((c) => c.text), seen);
  writeJsonl(`${out}/dev.jsonl`, dev);
  if (!devOnly) {
    writeJsonl(`${out}/test.jsonl`, test);
    writeFileSync(lockPath, JSON.stringify({ created: new Date().toISOString(), seed: seed + 1, n: test.length, sha256: sha256(readFileSync(`${out}/test.jsonl`, 'utf8')), source: 'tools/gen-synthetic.ts' }, null, 2));
  }
  orders(8, seed + 3).forEach((o, k) => {
    ensureDir(`${out}/orders/x`);
    writeFileSync(`${out}/orders/order-${String(k + 1).padStart(2, '0')}.txt`, o);
  });
  writeFileSync(`${out}/stats.json`, JSON.stringify({ seed, catalogue: SKUS.length, families: FAMILIES.length, dev: stats(dev), test: stats(test) }, null, 2));
  console.log(`catalogue ${SKUS.length} SKUs in ${FAMILIES.length} families · dev ${dev.length} · test ${test.length}${devOnly ? ' (kept)' : ' [locked]'} · 8 demo orders → ${out}/`);
}
