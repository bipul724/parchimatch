// Audit the HTML sink inventory and exercise escaping through the UI's actual rendering functions.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const source = readFileSync(fileURLToPath(new URL('../app/app.js', import.meta.url)), 'utf8');
const attack = `<img src=x onerror="alert('x')">&`;
const escaped = '&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;';

// A regex cannot prove JavaScript data flow across nested templates and helpers. The written
// review inventories every sink; this test also runs the actual pure renderers without a DOM.
function renderHarness() {
  const end = source.indexOf('// ---- matching (streamed) ----');
  assert.ok(end > 0, 'rendering section must remain available for the audit');
  const nodes = new Map<string, Record<string, unknown>>();
  const document = { getElementById: (id: string) => {
    if (!nodes.has(id)) nodes.set(id, {});
    return nodes.get(id);
  } };
  const api = runInNewContext(`${source.slice(0, end)}\n({
    renderRow, productOptions, resultText, baseText, canRemember, initialDecision, renderSummary, loadStatus,
    setCatalog(xs) { catalog = xs; bySku = new Map(xs.map(x => [x.sku, x])); },
    setRows(xs) { rows = xs; }, setMatching(value) { matching = value; }
  });`, {
    document,
    fetch: async () => ({ json: async () => ({ items: 1, learned: 2, modelReady: true, model: attack, catalog: attack }) }),
  });
  return { api, nodes };
}

function itemRow(overrides = {}) {
  return {
    line: 1, text: attack, kind: 'item', source: 'model', status: 'needs_review', sku: attack,
    qty: 2, unit: 'packet', ms: 12, productText: attack, nameKnown: false,
    question: attack, reasons: [attack], candidates: [{ sku: attack, label: attack }],
    decision: { state: 'pending', sku: attack, qty: 2, unit: 'packet', remember: true }, ...overrides,
  };
}

test('UI HTML sink inventory matches the written XSS audit', () => {
  const sinks = source.split('\n').filter((line) => /\.(?:innerHTML|outerHTML)\s*=|\.insertAdjacentHTML\(/.test(line)).map((line) => line.trim());
  assert.deepEqual(sinks, [
    "$('chips').innerHTML = [",
    "$('summary').innerHTML = rows.length",
    "$('rows').innerHTML = rows.map(renderRow).join('');",
    'if (el) el.outerHTML = renderRow(r);',
    "else $('rows').insertAdjacentHTML('beforeend', renderRow(r));",
    "$('progress').innerHTML = `<span class=\"spinner\"></span>Matching 0 / ${total}${msg.useModel ? '' : ' (fuzzy only)'}`;",
    "$('progress').innerHTML = `<span class=\"spinner\"></span>Matching ${rows.length} / ${total}`;",
  ]);
});

test('UI escapes order text, product names, SKU attributes, questions, reasons and remembered names', () => {
  const { api } = renderHarness();
  api.setCatalog([{ sku: attack, label: attack, units: ['packet', 'carton'], unitsPerCarton: 12 }]);
  for (const state of ['pending', 'auto', 'confirmed', 'skipped', 'ignored']) {
    const html = api.renderRow(itemRow({ decision: { state, sku: attack, qty: 2, unit: 'packet', remember: true } }));
    assert.equal(html.includes(attack), false, state);
    assert.equal(html.includes('<img'), false, state);
    assert.ok(html.includes(escaped), state);
    if (state === 'pending') assert.ok(html.includes(`value="${escaped}"`), 'candidate SKU is escaped in attribute context');
  }
  const html = api.productOptions(itemRow({ candidates: [] }), null);
  assert.ok(html.includes(escaped), 'all-products list also escapes catalogue values');
  assert.equal(html.includes('<img'), false);
});

test('UI status model value is escaped and catalogue path uses textContent', async () => {
  const { api, nodes } = renderHarness();
  await api.loadStatus();
  assert.ok(String(nodes.get('chips')?.innerHTML).includes(escaped));
  assert.equal(String(nodes.get('chips')?.innerHTML).includes('<img'), false);
  assert.equal(nodes.get('catcount')?.textContent, `· 1 items · ${attack}`);
});

test('UI L1 Remember is shown only for unknown nonempty product names', () => {
  const { api } = renderHarness();
  for (const [productText, nameKnown, expected] of [
    ['lais peela', false, true], ['tata tea premium', true, false], ['', false, false],
  ]) {
    const row = itemRow({ productText, nameKnown });
    assert.equal(api.canRemember(row), expected);
    assert.equal(api.renderRow(row).includes('data-f="remember"'), expected);
  }
});

test('UI Export stays disabled while matching or any amber decision remains unresolved', () => {
  const { api, nodes } = renderHarness();
  for (const [states, matching, disabled] of [
    [[], false, true], [['auto', 'pending'], false, true], [['auto', 'confirmed'], true, true],
    [['auto', 'confirmed', 'skipped', 'ignored'], false, false], [['skipped', 'ignored'], false, true],
  ]) {
    api.setRows(states.map((state: string) => itemRow({ decision: { state } })));
    api.setMatching(matching);
    api.renderSummary();
    assert.equal(nodes.get('export')?.disabled, disabled, `${states}/${matching}`);
  }
});

test('UI shows base quantities on green and confirmed rows and recomputes them from the current decision', () => {
  const { api } = renderHarness();
  api.setCatalog([
    { sku: 'PRLG-5', label: 'Parle-G Biscuit (₹5 pack)', units: ['packet', 'carton'], unitsPerCarton: 144 },
    { sku: 'KITKAT-10', label: 'KitKat (₹10 bar)', units: ['piece', 'dozen', 'carton'], unitsPerCarton: 240 },
    { sku: 'CLINICPLUS-1', label: 'Clinic Plus Shampoo (₹1 sachet strip)', units: ['packet', 'carton'], unitsPerCarton: null },
  ]);
  const row = (sku: string, qty: number, unit: string, state = 'auto', server = {}) =>
    itemRow({ text: 'x', status: 'ok', sku, qty, unit, ...server, decision: { state, sku, qty, unit } });
  // Server values are used while the decision still matches the server's answer.
  assert.match(api.renderRow(row('PRLG-5', 2, 'carton', 'auto', { baseQty: 288, baseUnit: 'packet' })), /2 carton<\/span> \(288 packets\)/);
  // The operator changed the quantity, unit or product: recomputed from the catalogue.
  const changed = row('PRLG-5', 2, 'carton', 'confirmed', { baseQty: 288, baseUnit: 'packet' });
  changed.decision.qty = 3;
  assert.match(api.renderRow(changed), /3 carton<\/span> \(432 packets\)/);
  assert.match(api.renderRow(row('KITKAT-10', 4, 'dozen', 'confirmed')), /4 dozen<\/span> \(48 pieces\)/);
  assert.match(api.renderRow(row('KITKAT-10', 1, 'carton', 'confirmed')), /1 carton<\/span> \(240 pieces\)/);
  assert.match(api.renderRow(row('CLINICPLUS-1', 2, 'carton', 'confirmed')), /2 carton<\/span> \(carton size unknown\)/);
  // Same unit as ordered: nothing to convert, so nothing extra is shown.
  assert.doesNotMatch(api.renderRow(row('PRLG-5', 3, 'packet')), /\(\d+ packets?\)/);
  // Pending (amber) rows keep their own carton warning instead.
  assert.doesNotMatch(api.renderRow(row('PRLG-5', 2, 'carton', 'pending')), /288 packets/);
  assert.equal(api.baseText({ sku: 'PRLG-5', qty: 1, unit: 'carton' }), ' (144 packets)');
  assert.equal(api.baseText({ sku: 'KITKAT-10', qty: null, unit: 'dozen' }), '');
});

test('UI base quantity text is escaped', () => {
  const { api } = renderHarness();
  api.setCatalog([{ sku: 'X', label: 'x', units: ['carton', attack], unitsPerCarton: 2 }]);
  const html = api.renderRow(itemRow({ text: 'x', sku: 'X', decision: { state: 'auto', sku: 'X', qty: 1, unit: 'carton' }, baseQty: 2, baseUnit: attack }));
  assert.equal(html.includes('<img'), false);
});
