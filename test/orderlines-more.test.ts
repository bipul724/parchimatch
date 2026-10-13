// Characterize item splitting, including the documented destructive handling of commas inside one item.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { splitOrder } from '../src/orderlines.ts';
import { parse } from '../src/text.ts';

test('order splitting handles real comma/semicolon separators, CRLF, bullets and numbering', () => {
  assert.deepEqual(splitOrder('Namaste bhaiya\r\n• maggi 2 ctn, parle g 5/- 1 petti\r\n1) tata namak 1 kg 3 ctn; lux 10 rs 2 dozen\n02. frooti 10 rs 1 petti\n* kitkat 20 rs 4 pcs\n'), [
    'Namaste bhaiya', 'maggi 2 ctn', 'parle g 5/- 1 petti', 'tata namak 1 kg 3 ctn',
    'lux 10 rs 2 dozen', 'frooti 10 rs 1 petti', 'kitkat 20 rs 4 pcs',
  ]);
});

test('order splitting keeps quantity-first lines and discards empty separator fragments', () => {
  assert.deepEqual(splitOrder('\n 2 ctn maggi ,,; \n3 packet parle g 5 rs\n'), ['2 ctn maggi', '3 packet parle g 5 rs']);
  assert.deepEqual(splitOrder(' \n,;\r\n'), []);
});

test('known limitation: a thousands comma breaks one quantity into separate item fragments', (t) => {
  const input = 'maggi 1,000 pcs';
  const parts = splitOrder(input);
  // This records the suspected defect, not a desirable contract. A human intended one item.
  assert.deepEqual(parts, ['maggi 1', '000 pcs']);
  assert.notDeepEqual(parts, [input]);
  assert.equal(parse(parts[0]).qty, 1);
  assert.equal(parse(parts[1]).qty, 0);
  t.diagnostic('Confirmed known limitation: 1,000 becomes quantities 1 and 0 in two fragments; no automatic repair is claimed.');
});

test('known limitation: a comma within a product description separates its name from pack and quantity', (t) => {
  const input = 'maggi, 4 pack 1 ctn';
  const parts = splitOrder(input);
  assert.deepEqual(parts, ['maggi', '4 pack 1 ctn']);
  assert.notDeepEqual(parts, [input]);
  assert.equal(parse(parts[0]).productText, 'maggi');
  assert.equal(parse(parts[1]).productText, '');
  assert.equal(parse(parts[1]).pairs.length, 2);
  t.diagnostic('Confirmed known limitation: the product name and quantity arrive in different rows; split intent is ambiguous.');
});
