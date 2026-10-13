import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalize, parse } from '../src/text.ts';

test('price is not a quantity: "5/-" and "10 wala"', () => {
  const a = parse('parle g 5/- 2 petti');
  assert.equal(a.priceHint, 5);
  assert.deepEqual([a.qty, a.unit], [2, 'carton']);
  assert.equal(a.productText, 'parle g');

  const b = parse('dairy milk 10 wala 5 dz');
  assert.equal(b.priceHint, 10);
  assert.deepEqual([b.qty, b.unit], [5, 'dozen']);
});

test('"10 rs 4 petti" reads 10 as price and 4 as quantity', () => {
  const p = parse('gud day 10 rs 4 petti');
  assert.equal(p.priceHint, 10);
  assert.deepEqual([p.qty, p.unit], [4, 'carton']);
});

test('"rs 20" before the number is a price', () => {
  const p = parse('rs 20 dairy milk 3 dz');
  assert.equal(p.priceHint, 20);
  assert.deepEqual([p.qty, p.unit], [3, 'dozen']);
});

test('pack size is a variant, not a quantity', () => {
  const p = parse('ashirvad atta 10 kilo 3 bag');
  assert.deepEqual(p.sizeHint, { value: 10000, dim: 'g' });
  assert.deepEqual([p.qty, p.unit], [3, 'bag']);
  const q = parse('aashirvaad 5kg 2 bora');
  assert.deepEqual(q.sizeHint, { value: 5000, dim: 'g' });
  assert.deepEqual([q.qty, q.unit], [2, 'bag']);
  const r = parse('fortune 1 ltr 1 petti');
  assert.deepEqual(r.sizeHint, { value: 1000, dim: 'ml' });
});

test('Hindi number words count only next to a unit', () => {
  assert.deepEqual(pick(parse('magi do petti')), [2, 'carton']);
  assert.deepEqual(pick(parse('ek petti frooti')), [1, 'carton']);
  assert.deepEqual(pick(parse('maggi 2 petti bhej do')), [2, 'carton']);
  assert.deepEqual(pick(parse('maggi bhej do')), [null, null]);
});

test('two different number+unit pairs leave the quantity unresolved', () => {
  const p = parse('maggi 4 pack 1 petti');
  assert.equal(p.qty, null);
  assert.equal(p.pairs.length, 2);
});

test('bare number keeps the quantity but not a unit; unknown unit words are not guessed', () => {
  assert.deepEqual(pick(parse('fortune oil 2')), [2, null]);
  const p = parse('clinic plus 1 rs 10 ladi');
  assert.equal(p.priceHint, 1);
  assert.deepEqual(pick(p), [10, null]);
});

test('an unknown word after a bare quantity is kept as an unknown unit, not dropped', () => {
  const p = parse('fortune aata 10 kg 10 jodi');
  assert.deepEqual([p.qty, p.unit, p.unknownUnit], [10, null, 'jodi']);
  assert.equal(p.productText, 'fortune aata');
  assert.equal(parse('maggi 2 bhej do').unknownUnit, null);
  assert.equal(parse('fortune oil 2').unknownUnit, null);
});

test('Devanagari units and price words', () => {
  const p = parse('पारले जी 5 वाला 2 पेटी');
  assert.equal(p.priceHint, 5);
  assert.deepEqual(pick(p), [2, 'carton']);
  assert.equal(p.productText, 'पारले जी');
});

test('normalize splits glued numbers and strips punctuation', () => {
  assert.equal(normalize('Parle-G 5/- x2'), 'parle g 5 rs x 2');
  assert.equal(normalize('Colgate 200g, 12pc.'), 'colgate 200 g 12 pc');
});

function pick(p: { qty: number | null; unit: string | null }) {
  return [p.qty, p.unit];
}
