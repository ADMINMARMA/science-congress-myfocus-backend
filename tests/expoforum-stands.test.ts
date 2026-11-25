import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createExpoforumStandsHandler } from '../src/expoforum-stands.js';

const bodyLimit = 4 * 1024 * 1024;

async function startHandler(cacheFile: string, digest: string) {
  const server = createServer(createExpoforumStandsHandler(cacheFile, digest));
  await new Promise<void>((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return {
    url: `http://127.0.0.1:${address.port}/expoforum-stands`,
    dispose: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test('only authorized, complete stand projections replace the last saved response', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'expoforum-stands-'));
  const cacheFile = join(directory, '.cache', 'expoforum-stands.json');
  const token = randomBytes(32).toString('hex');
  const digest = createHash('sha256').update(token).digest('hex');
  const first = await startHandler(cacheFile, digest);
  const post = (payload: unknown, bearer = token, contentType = 'application/json') =>
    fetch(first.url, {
      method: 'POST',
      headers: { 'Content-Type': contentType, Authorization: `Bearer ${bearer}` },
      body: JSON.stringify(payload),
    });
  const stands = Array.from({ length: 49 }, (_, i) => ({
    id: `s${i + 1}`,
    ...(i === 0 ? { name: { ru: '  Название ', en: '', fa: 'نام' }, shortName: null } : {}),
  }));
  const expected = {
    stands: stands.map(({ id }, i) =>
      i === 0 ? { id, name: { ru: 'Название', fa: 'نام' } } : { id },
    ),
  };

  try {
    assert.equal((await fetch(first.url)).status, 503);
    assert.equal((await fetch(first.url, { method: 'PUT' })).status, 405);
    assert.equal((await post({ stands }, randomBytes(32).toString('hex'))).status, 401);
    assert.equal((await post({ stands }, token, 'text/plain')).status, 415);
    assert.equal((await post({ stands: stands.slice(0, -1) })).status, 400);
    assert.equal((await fetch(first.url)).status, 503);
    assert.equal(
      (await post({ stands: [...stands].reverse() }, token, 'application/json; charset=utf-8'))
        .status,
      204,
    );
    const loaded = await fetch(first.url);
    assert.equal(loaded.headers.get('Cache-Control'), 'private, no-cache');
    assert.equal(loaded.headers.get('Vary'), 'Origin, Accept-Encoding');
    assert.equal(loaded.headers.get('Content-Encoding'), 'gzip');
    const etag = loaded.headers.get('ETag');
    assert.ok(etag);
    assert.deepEqual(await loaded.json(), expected);
    const conditional = await fetch(first.url, { headers: { 'If-None-Match': etag } });
    assert.equal(conditional.status, 304);
    assert.equal(conditional.headers.get('ETag'), etag);
    assert.equal(await conditional.text(), '');

    const remaining = stands.slice(1);
    for (const malformed of [
      { stands, comments: 'private' },
      { stands: [{ id: 's50' }, ...remaining] },
      { stands: [{ id: 's2' }, ...remaining] },
      { stands: [{ id: 's1', internalNotes: 'private' }, ...remaining] },
      { stands: [{ id: 's1', name: { jp: 'Unexpected locale' } }, ...remaining] },
      { stands: [{ id: 's1', name: { en: 'x'.repeat(501) } }, ...remaining] },
      { stands: [{ id: 's1', description: { en: 'x'.repeat(20_001) } }, ...remaining] },
      { stands: [{ id: 's1', description: { en: 7 } }, ...remaining] },
    ])
      assert.equal((await post(malformed)).status, 400);
    const oversized = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(
        first.url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': bodyLimit + 1,
            Authorization: `Bearer ${token}`,
          },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on('error', reject);
      req.end();
    });
    assert.equal(oversized, 413);
    const chunked = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(
        first.url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on('error', reject);
      req.write('x'.repeat(bodyLimit));
      req.end('x');
    });
    assert.equal(chunked, 413);
    assert.deepEqual(await (await fetch(first.url)).json(), expected);

    const restarted = await startHandler(cacheFile, digest);
    try {
      const afterRestart = await fetch(restarted.url, {
        headers: { 'Accept-Encoding': 'gzip;q=0' },
      });
      assert.equal(afterRestart.headers.get('Content-Encoding'), null);
      assert.equal(afterRestart.headers.get('ETag'), etag);
      assert.deepEqual(await afterRestart.json(), expected);

      const translated = 'Т'.repeat(7353);
      const update = {
        stands: stands.map(({ id }, i) => ({
          id,
          ...(i === 0
            ? { description: { ru: '' }, menu: { ru: '   ' } }
            : { description: { ru: translated, en: translated } }),
        })),
      };
      assert.ok(Buffer.byteLength(JSON.stringify(update)) > 1024 * 1024);
      assert.equal((await post(update)).status, 204);
      const current = await fetch(restarted.url, { headers: { 'If-None-Match': etag } });
      assert.equal(current.status, 200);
      assert.notEqual(current.headers.get('ETag'), etag);
      assert.deepEqual(((await current.json()) as typeof update).stands[0], {
        id: 's1',
        description: { ru: '' },
        menu: { ru: '' },
      });
    } finally {
      await restarted.dispose();
    }
  } finally {
    await first.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
