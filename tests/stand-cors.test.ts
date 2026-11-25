import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';

test('the canonical map has cross-origin access only to read stand cards', async () => {
  process.env.PORT = '0';
  process.env.CORS_ORIGINS = '';
  const { server } = await import('../src/server.js');
  try {
    if (!server.listening) await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const base = `http://127.0.0.1:${address.port}`;
    const canonical = 'https://science-congress-myfocus.marma.pro';
    const stands = '/expoforum-stands';
    const probe = async (path: string, method: string, origin = canonical, requested?: string) => {
      const response = await fetch(base + path, {
        method,
        headers: { Origin: origin, ...(requested ? { 'Access-Control-Request-Method': requested } : {}) },
      });
      await response.arrayBuffer();
      return response;
    };
    const header = 'Access-Control-Allow-Origin';
    const data = await probe(stands, 'GET');
    assert.ok([200, 503].includes(data.status));
    assert.equal(data.headers.get(header), canonical);
    const readOptions = await probe(stands, 'OPTIONS', canonical, 'GET');
    assert.equal(readOptions.status, 204);
    assert.equal(readOptions.headers.get(header), canonical);
    assert.equal(readOptions.headers.get('Access-Control-Allow-Methods'), 'GET, OPTIONS');
    assert.equal((await probe(stands, 'OPTIONS', canonical, 'POST')).status, 403);
    const post = await probe(stands, 'POST');
    assert.equal(post.status, 401);
    assert.equal(post.headers.get(header), null);
    assert.equal((await probe('/health', 'GET')).headers.get(header), null);
    assert.equal((await probe('/table', 'OPTIONS')).status, 403);
    assert.equal((await probe(stands, 'GET', `${canonical}.example`)).headers.get(header), null);
    for (const site of ['app', 'test']) {
      const origin = `https://science-congress-myfocus-${site}.marma.pro`;
      assert.equal((await probe('/health', 'GET', origin)).headers.get(header), origin);
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
