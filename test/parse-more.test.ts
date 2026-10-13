// Purpose: exercise messy order syntax and retain every explicit number needed for safety checks.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalize, parse } from '../src/text.ts';

const cases = [
  ['atta 1.5 kg 2 bag', 2, 'bag', null, { value: 1500, dim: 'g' }, 'atta'],
  ['maggi x2', 2, null, null, null, 'maggi'],
  ['maggi 2x', 2, null, null, null, 'maggi'],
  ['maggi 2-ctn', 2, 'carton', null, null, 'maggi'],
  ['ctn-2 maggi', 2, 'carton', null, null, 'maggi'],
  ['maggi 0 ctn', 0, 'carton', null, null, 'maggi'],
  ['maggi 1000000000 ctn', 1000000000, 'carton', null, null, 'maggi'],
  ['maggi 2 ctn 5 pkt', null, null, null, null, 'maggi'],
  ['maggi २ ctn', 2, 'carton', null, null, 'maggi'],
  ['parle g Rs 10/- 2 pkt', 2, 'packet', 10, null, 'parle g'],
  ['parle g ₹ 10 2 pkt', 2, 'packet', 10, null, 'parle g'],
  ['MAGGI!!! 2ctn 🙏', 2, 'carton', null, null, 'maggi'],
  ['ctn 2 maggi', 2, 'carton', null, null, 'maggi'],
  ['maggi bhej do', null, null, null, null, 'maggi do'],
  ['maggi ２ ctn', 2, 'carton', null, null, 'maggi'],
  ['maggi 2\u200bctn', 2, 'carton', null, null, 'maggi'],
] as const;

for (const [text, qty, unit, price, size, product] of cases) {
  test(`parser table: ${text}`, () => {
    const p = parse(text);
    assert.deepEqual([p.qty, p.unit, p.priceHint, p.sizeHint, p.productText], [qty, unit, price, size, product]);
  });
}

test('parser recognizes rs.10 as an explicit price marker', () => {
  const p = parse('parle g rs.10 2 pkt');
  assert.equal(p.priceHint, 10);
  assert.equal(p.productText, 'parle g');
});

test('parser preserves a negative quantity for the plausibility check', () => {
  assert.equal(parse('maggi -2 ctn').qty, -2);
});

test('parser retains Gujarati and Bengali digits even when mixed with Latin digits', () => {
  for (const digit of ['૨', '২']) {
    assert.equal(parse(`maggi ${digit} ctn`).qty, 2);
    assert.equal(parse(`maggi ${digit}2 ctn`).qty, 22);
  }
});

test('parser retains conflicting explicit prices and sizes for validation', () => {
  assert.deepEqual(parse('parle g 5 rs 10 rs 2 pkt').priceHints, [5, 10]);
  assert.deepEqual(parse('fortune 1 l 5 l 2 pcs').sizeHints, [{ value: 1000, dim: 'ml' }, { value: 5000, dim: 'ml' }]);
});

test('debatable syntax: half kilo stays literal and an unmarked 14 is not inferred as a price', () => {
  // "half" is outside the documented numeric vocabulary; interpreting it needs a product decision.
  const half = parse('atta half kilo 2 bag');
  assert.equal(half.sizeHint, null);
  assert.equal(half.productText, 'atta half kilo');
  // 14 can be a product number or price. Record current reading without claiming an inferred MRP is correct.
  const bare = parse('maggi 14 2 ctn');
  assert.equal(bare.priceHint, null);
  assert.deepEqual([bare.qty, bare.unit], [2, 'carton']);
});

test('normalization keeps full-width punctuation and repeated normalization stable', () => {
  const normalized = normalize('ＭＡＧＧＩ ２ｃｔｎ 🙏');
  assert.equal(normalized, 'maggi 2 ctn');
  assert.equal(normalize(normalized), normalized);
});

test('zero-width formatting inside numeric text never truncates quantity, sign, or decimal', () => {
  for (const mark of ['\u200b', '\u200c', '\u200d', '\ufeff']) {
    assert.equal(parse(`maggi 2${mark}2 ctn`).qty, 22);
    assert.equal(parse(`maggi -${mark}2 ctn`).qty, -2);
    assert.deepEqual(parse(`atta 1.${mark}5 kg 2 bag`).sizeHint, { value: 1500, dim: 'g' });
  }
});

test('unknown numeric unit phrase survives beside a recognised quantity pair', () => {
  for (const text of ['maggi 2 ctn 5 jodi', 'maggi 5 jodi 2 ctn']) {
    const p = parse(text);
    assert.equal(p.unknownUnit, 'jodi', text);
    assert.deepEqual([p.qty, p.unit], [2, 'carton']);
  }
});

test('overlapping prefix and suffix price markers retain both explicit prices', () => {
  for (const text of ['parle g rs 5 rs 10 2 pkt', 'parle g ₹5 rs 10 2 pkt']) {
    const p = parse(text);
    assert.deepEqual(p.priceHints, [5, 10]);
    assert.deepEqual([p.qty, p.unit], [2, 'packet']);
  }
  for (const text of ['parle g 5 rs 2 pkt', 'parle g 5 rs 2']) {
    const p = parse(text);
    assert.deepEqual(p.priceHints, [5]);
    assert.equal(p.qty, 2);
  }
});
