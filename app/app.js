// ParchiMatch Lite review screen. Vanilla JS, no network beyond this local server.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let catalog = []; // [{sku,label,units,unitsPerCarton}]
let bySku = new Map();
let rows = []; // server rows + .decision
let matching = false;

const UNIT_LABEL = { piece: 'piece', packet: 'packet', carton: 'carton', dozen: 'dozen', bag: 'bag' };

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 3500);
}

async function loadStatus() {
  const s = await (await fetch('/api/status')).json();
  $('chips').innerHTML = [
    `<span class="chip">${esc(s.items)} items</span>`,
    `<span class="chip">${esc(s.learned)} learned names</span>`,
    s.modelReady ? `<span class="chip good">Model ready · ${esc(s.model)}</span>` : `<span class="chip bad">Model offline · fuzzy matching only</span>`,
    `<span class="chip good">Runs locally</span>`,
  ].join('');
  $('catcount').textContent = `· ${s.items} items · ${s.catalog}`;
}

async function loadCatalog() {
  catalog = await (await fetch('/api/catalog')).json();
  bySku = new Map(catalog.map((c) => [c.sku, c]));
}

async function loadSamples() {
  const samples = await (await fetch('/api/samples')).json();
  const sel = $('sample');
  sel.length = 1;
  for (const s of samples) sel.add(new Option(s.name.replace('order-', 'Sample order '), s.text));
}

// ---- decisions ----

function initialDecision(r) {
  if (r.kind === 'note') return { state: 'ignored' };
  if (r.status === 'ok') return { state: 'auto', sku: r.sku, qty: r.qty, unit: r.unit };
  const productProblem = !r.sku || r.reasons.some((x) => /decider|product|fit .* about as well|not among|not in the catalogue/.test(x));
  return { state: 'pending', sku: r.sku, qty: r.qty, unit: r.unit, remember: productProblem && canRemember(r) };
}

// Only new names can be learned ("lais peela"), not catalogue names with a missing size ("tata tea premium").
function canRemember(r) {
  return !!r.productText && !r.nameKnown;
}

function counts() {
  const c = { auto: 0, confirmed: 0, pending: 0, skipped: 0, ignored: 0 };
  for (const r of rows) c[r.decision.state]++;
  return c;
}

function renderSummary() {
  const c = counts();
  $('summary').innerHTML = rows.length
    ? `<span><b class="dot ok"></b><b>${c.auto + c.confirmed}</b> ready</span><span><b class="dot review"></b><b>${c.pending}</b> need you</span><span><b class="dot note"></b><b>${c.skipped + c.ignored}</b> skipped/notes</span>`
    : '';
  const done = rows.length > 0 && c.pending === 0 && !matching;
  $('export').disabled = !done || c.auto + c.confirmed === 0;
  $('exportmsg').textContent = matching ? '' : c.pending ? `Resolve ${c.pending} amber line${c.pending > 1 ? 's' : ''} to export.` : '';
}

// ---- rendering ----

function productOptions(r, selected) {
  const sugg = r.candidates.map((c) => `<option value="${esc(c.sku)}"${c.sku === selected ? ' selected' : ''}>${esc(c.label)}</option>`).join('');
  const rest = catalog
    .filter((c) => !r.candidates.some((x) => x.sku === c.sku))
    .map((c) => `<option value="${esc(c.sku)}"${c.sku === selected ? ' selected' : ''}>${esc(c.label)}</option>`)
    .join('');
  return `<option value="">Choose product…</option><optgroup label="Closest matches">${sugg}</optgroup><optgroup label="All products">${rest}</optgroup>`;
}

function unitOptions(sku, selected) {
  const units = bySku.get(sku)?.units ?? Object.keys(UNIT_LABEL);
  return units.map((u) => `<option value="${u}"${u === selected ? ' selected' : ''}>${UNIT_LABEL[u]}</option>`).join('');
}

function resultText(d) {
  const item = bySku.get(d.sku);
  if (!item) return '<span class="muted">—</span>';
  const qty = d.qty == null ? '?' : d.qty;
  const unit = d.unit ? UNIT_LABEL[d.unit] : '?';
  return `<span class="qty">${esc(qty)} ${esc(unit)}</span> · ${esc(item.label)}`;
}

function sourceBadge(r) {
  if (r.kind === 'note') return '<span class="badge">note</span>';
  if (r.source === 'learned') return '<span class="badge learned">learned name</span>';
  if (r.source === 'model') return `<span class="badge model" title="Local model, ${esc(r.ms)} ms">local model</span>`;
  if (r.source === 'fuzzy') return '<span class="badge">text match</span>';
  return '';
}

function renderRow(r) {
  const d = r.decision;
  const cls = { auto: 'ok', confirmed: 'confirmed', pending: 'review', skipped: 'skipped', ignored: 'note' }[d.state];
  let right = sourceBadge(r);
  let body = '';

  if (d.state === 'auto' || d.state === 'confirmed') {
    right += `<span class="badge">${d.state === 'auto' ? '✓ auto' : '✓ you'}</span><button class="small" data-act="edit">Change</button>`;
  } else if (d.state === 'skipped') {
    right += `<button class="small" data-act="edit">Undo</button>`;
  } else if (d.state === 'ignored') {
    right += `<button class="small" data-act="asitem">Treat as item</button>`;
  } else {
    const upc = bySku.get(d.sku)?.unitsPerCarton;
    const cartonWarn = d.unit === 'carton' && d.sku && upc == null ? '<span class="hint">Carton size unknown: base quantity will be left blank.</span>' : '';
    body = `
      <div class="ask">
        <div class="question">${esc(r.question || 'Please check this line.')}</div>
        <div class="controls">
          <select class="product" data-f="sku" aria-label="Product for line ${r.line}">${productOptions(r, d.sku)}</select>
          <input type="number" min="1" step="1" data-f="qty" value="${d.qty ?? ''}" aria-label="Quantity for line ${r.line}" placeholder="qty">
          <select data-f="unit" aria-label="Unit for line ${r.line}">${unitOptions(d.sku, d.unit)}</select>
          <button class="primary small" data-act="confirm">Confirm</button>
          <button class="small" data-act="skip">Not stocked / skip</button>
        </div>
        ${canRemember(r) ? `<label class="remember"><input type="checkbox" data-f="remember"${d.remember ? ' checked' : ''}> Remember “${esc(r.productText)}” as this product next time</label>` : ''}
        ${cartonWarn}
        <div class="why">Why: ${esc(r.reasons.join('; '))}</div>
      </div>`;
  }

  const result = d.state === 'pending' ? `<span class="muted">${d.sku ? 'Suggestion: ' + esc(bySku.get(d.sku)?.label ?? '') : 'No confident match'}</span>` : d.state === 'ignored' ? '<span class="muted">Ignored</span>' : d.state === 'skipped' ? '<span class="muted">Skipped</span>' : resultText(d);

  return `<div class="row ${cls}" data-line="${r.line}">
    <div class="line"><span class="num">${r.line}</span><span class="text">${esc(r.text)}</span><span class="result">${result}</span><span class="right">${right}</span></div>
    ${body}
  </div>`;
}

function render() {
  $('empty').hidden = rows.length > 0;
  $('rows').innerHTML = rows.map(renderRow).join('');
  renderSummary();
}

function renderOne(r) {
  const el = document.querySelector(`.row[data-line="${r.line}"]`);
  if (el) el.outerHTML = renderRow(r);
  else $('rows').insertAdjacentHTML('beforeend', renderRow(r));
  $('empty').hidden = true;
  renderSummary();
}

// ---- matching (streamed) ----

async function streamMatch(body, onRow) {
  const res = await fetch('/api/match', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error((await res.json()).error || res.statusText);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const msg = JSON.parse(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
      onRow(msg);
    }
  }
}

async function matchOrder() {
  const text = $('order').value.trim();
  if (!text || matching) return;
  matching = true;
  rows = [];
  render();
  $('match').disabled = true;
  let total = 0;
  const started = performance.now();
  try {
    await streamMatch({ text }, (msg) => {
      if (msg.type === 'start') {
        total = msg.total;
        $('progress').innerHTML = `<span class="spinner"></span>Matching 0 / ${total}${msg.useModel ? '' : ' (fuzzy only)'}`;
      } else if (msg.type === 'row') {
        const r = { ...msg.row, decision: initialDecision(msg.row) };
        rows.push(r);
        renderOne(r);
        $('progress').innerHTML = `<span class="spinner"></span>Matching ${rows.length} / ${total}`;
      }
    });
    const c = counts();
    $('progress').textContent = `${rows.length} lines in ${((performance.now() - started) / 1000).toFixed(1)} s · ${c.auto} automatic`;
  } catch (e) {
    $('progress').textContent = `Error: ${e.message}`;
  } finally {
    matching = false;
    $('match').disabled = false;
    renderSummary();
  }
}

async function rematchAsItem(r) {
  await streamMatch({ lines: [r.text], force: true }, (msg) => {
    if (msg.type !== 'row') return;
    const fresh = { ...msg.row, line: r.line };
    fresh.decision = initialDecision(fresh);
    rows[rows.indexOf(r)] = fresh;
    renderOne(fresh);
  });
}

// ---- row actions ----

$('rows').addEventListener('change', (e) => {
  const rowEl = e.target.closest('.row');
  if (!rowEl) return;
  const r = rows.find((x) => x.line === Number(rowEl.dataset.line));
  const f = e.target.dataset.f;
  if (!r || !f) return;
  if (f === 'sku') {
    r.decision.sku = e.target.value || null;
    const units = bySku.get(r.decision.sku)?.units ?? [];
    if (!units.includes(r.decision.unit)) r.decision.unit = units.length === 1 ? units[0] : null;
    renderOne(r);
  } else if (f === 'qty') r.decision.qty = e.target.value ? Number(e.target.value) : null;
  else if (f === 'unit') {
    r.decision.unit = e.target.value;
    renderOne(r);
  } else if (f === 'remember') r.decision.remember = e.target.checked;
});

$('rows').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('input[type=number]')) {
    e.preventDefault();
    e.target.closest('.row').querySelector('[data-act=confirm]')?.click();
  }
});

$('rows').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const r = rows.find((x) => x.line === Number(btn.closest('.row').dataset.line));
  const d = r.decision;
  const act = btn.dataset.act;
  if (act === 'confirm') {
    const rowEl = btn.closest('.row');
    d.qty = Number(rowEl.querySelector('[data-f=qty]').value) || null;
    d.unit = rowEl.querySelector('[data-f=unit]').value || null;
    if (!d.sku) return toast('Choose a product first.');
    if (!d.qty || d.qty < 1 || !Number.isInteger(d.qty)) return toast('Enter a whole-number quantity.');
    if (!bySku.get(d.sku).units.includes(d.unit)) return toast('Choose a unit this product is sold in.');
    d.state = 'confirmed';
    renderOne(r);
    document.querySelector('.row.review select, .row.review input')?.focus();
  } else if (act === 'skip') {
    d.state = 'skipped';
    renderOne(r);
  } else if (act === 'edit') {
    d.state = 'pending';
    if (!r.question) r.question = 'Change this line?';
    renderOne(r);
  } else if (act === 'asitem') {
    btn.disabled = true;
    await rematchAsItem(r);
  }
});

// ---- export ----

$('export').addEventListener('click', async () => {
  const payload = {
    rows: rows
      .filter((r) => r.kind === 'item')
      .map((r) => ({
        line: r.line,
        text: r.text,
        status: r.decision.state === 'skipped' ? 'skipped' : 'confirmed',
        sku: r.decision.sku,
        qty: r.decision.qty,
        unit: r.decision.unit,
        note: r.decision.state === 'confirmed' ? 'checked by operator' : r.decision.state === 'auto' ? 'automatic' : 'not stocked / skipped',
      })),
    remember: rows
      .filter((r) => r.decision.state === 'confirmed' && r.decision.remember && canRemember(r) && r.decision.sku)
      .map((r) => ({ alias: r.productText, sku: r.decision.sku })),
  };
  const res = await fetch('/api/confirm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  const out = await res.json();
  if (!out.ok) return toast(`Not exported: ${(out.errors || [out.error]).join('; ')}`);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([out.csv], { type: 'text/csv' }));
  a.download = out.file.split('/').pop();
  a.click();
  URL.revokeObjectURL(a.href);
  $('exportmsg').textContent = `Saved ${out.file}`;
  toast(out.learned ? `Exported. Learned ${out.learned} new name${out.learned > 1 ? 's' : ''}.` : 'Exported.');
  loadStatus();
});

// ---- catalogue upload ----

$('catfile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const res = await fetch('/api/catalog', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ csv: await file.text() }) });
  const out = await res.json();
  $('catmsg').className = `msg${out.ok ? '' : ' error'}`;
  $('catmsg').textContent = out.ok ? `Loaded ${out.items} items.` : out.error;
  if (out.ok) {
    await loadCatalog();
    await loadStatus();
  }
  e.target.value = '';
});

$('sample').addEventListener('change', (e) => {
  if (e.target.value) $('order').value = e.target.value;
});
$('match').addEventListener('click', matchOrder);
$('order').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) matchOrder();
});

(async () => {
  await Promise.all([loadStatus(), loadCatalog(), loadSamples()]);
  render();
})();
