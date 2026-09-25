import { createServer, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { TableCache } from './table-cache.js';

const cache = new TableCache(
  resolve(process.cwd(), 'data/myFocus.xlsx'),
  resolve(process.cwd(), '.cache/table.json'),
);
const port = Number(process.env.PORT ?? process.env.TABLE_PORT ?? 3001);
const productionOrigins = (process.env.CORS_ORIGINS ?? 'https://science-congress-myfocus-test.marma.pro')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const localhostPorts = new Set(
  (process.env.LOCALHOST_CORS_PORTS ?? '5173,5177').split(',').map((value) => value.trim()),
);
function allowedOrigin(value: string | undefined): string | null {
  if (!value) return null;
  if (productionOrigins.includes(value)) return value;
  try {
    const url = new URL(value);
    if (
      ['http:', 'https:'].includes(url.protocol) &&
      ['127.0.0.1', 'localhost'].includes(url.hostname) &&
      localhostPorts.has(url.port)
    )
      return value;
  } catch {
    // Invalid origins are simply not granted cross-origin access.
  }
  return null;
}
function cors(res: ServerResponse, origin: string | null): void {
  if (!origin) return;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'If-None-Match, Content-Type');
  res.setHeader('Access-Control-Expose-Headers', 'ETag, X-Table-Cache');
  res.setHeader('Vary', 'Origin');
}

const server = createServer(async (req, res) => {
  const origin = allowedOrigin(req.headers.origin);
  cors(res, origin);
  if (req.method === 'OPTIONS') {
    res.writeHead(origin ? 204 : 403).end();
    return;
  }
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (req.method !== 'GET') {
    res.writeHead(405, { Allow: 'GET, OPTIONS' }).end();
    return;
  }
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"status":"ok"}');
    return;
  }
  if (url.pathname !== '/table') {
    res.writeHead(404).end();
    return;
  }
  try {
    const result = await cache.get(['1', 'true'].includes(url.searchParams.get('refresh') ?? ''));
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Vary', origin ? 'Origin, Accept-Encoding' : 'Accept-Encoding');
    res.setHeader('ETag', result.etag);
    res.setHeader('X-Table-Cache', result.status);
    if (result.status === 'stale') res.setHeader('Warning', '110 - "Serving last valid workbook"');
    if (req.headers['if-none-match'] === result.etag) {
      res.writeHead(304).end();
      return;
    }
    const gzip = (req.headers['accept-encoding'] ?? '').split(',').some((part) => {
      const [name, quality] = part.trim().split(';');
      return name === 'gzip' && (!quality || Number(quality.trim().replace(/^q=/, '')) > 0);
    });
    if (gzip) res.setHeader('Content-Encoding', 'gzip');
    res.end(gzip ? result.gzip : result.json);
  } catch (error) {
    console.error('Table load failed:', error);
    res
      .writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      .end(JSON.stringify({ error: 'Local workbook could not be parsed. Check backend log.' }));
  }
});

server.listen(port, '127.0.0.1', () => console.log(`Table backend http://127.0.0.1:${port}`));
