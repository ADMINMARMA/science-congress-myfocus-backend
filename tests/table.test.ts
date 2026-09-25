import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseTable } from '../src/parse-table.js';
import { TableCache } from '../src/table-cache.js';

const source = new URL('../data/myFocus.xlsx', import.meta.url);
test('workbook follows the 2027 table contract', async () => {
  const table = parseTable(await readFile(source));
  assert.ok(table.stands.standsRows.length > 100);
  assert.ok(table.commons.length > 0);
  assert.ok(table.uiText.length > 0);
});
test('cache reuses valid data and refreshes after a workbook change', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'myfocus-table-'));
  try {
    const workbook = join(directory, 'table.xlsx');
    const cacheFile = join(directory, 'cache', 'table.json');
    const bytes = await readFile(source);
    await writeFile(workbook, bytes);
    const cache = new TableCache(workbook, cacheFile);
    assert.equal((await cache.get()).status, 'refreshed');
    assert.equal((await cache.get()).status, 'memory');
    assert.equal((await new TableCache(workbook, cacheFile).get()).status, 'file');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
