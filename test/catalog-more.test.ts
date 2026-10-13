// Purpose: enforce required catalogue fields before malformed catalogue rows can replace shop data.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadCatalog } from '../src/catalog.ts';

test('catalogue rejects a missing required product name with a row-level error', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'pm-catalog-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'catalog.csv');
  writeFileSync(path, 'sku,name,brand,variant,mrp,sell_units,units_per_carton,aliases\nBAD,,Parle,5 pack,5,packet,144,parle g\n');
  assert.throws(() => loadCatalog(path), /row 2: missing name/);
});
