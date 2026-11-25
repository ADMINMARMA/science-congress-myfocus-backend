import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname } from 'node:path';
import { gzipSync } from 'node:zlib';

const locales = ['ru', 'en', 'es', 'pt', 'cn', 'vi', 'ar', 'fa'] as const;
type Locale = (typeof locales)[number];
const fieldLimits = { name: 500, shortName: 500, description: 20_000, menu: 12_000 };
type Stand = { id: string } & Partial<
  Record<keyof typeof fieldLimits, Partial<Record<Locale, string>>>
>;
type Snapshot = { stands: Stand[] };
const standIds = Array.from({ length: 49 }, (_, index) => `s${index + 1}`);
const maxBytes = 4 * 1024 * 1024;
type CachedResponse = { fileVersion: string; json: string; etag: string; gzip: Buffer };

class InvalidSnapshot extends Error {}
class BodyTooLarge extends Error {}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function project(value: unknown): Snapshot {
  if (
    !record(value) ||
    Object.keys(value).some((key) => key !== 'stands') ||
    !Array.isArray(value.stands) ||
    value.stands.length !== standIds.length
  )
    throw new InvalidSnapshot('Expected a complete stand projection.');
  const stands = new Map<string, Stand>();
  for (const row of value.stands) {
    if (
      !record(row) ||
      typeof row.id !== 'string' ||
      !standIds.includes(row.id) ||
      stands.has(row.id) ||
      Object.keys(row).some((key) => key !== 'id' && !Object.hasOwn(fieldLimits, key))
    )
      throw new InvalidSnapshot('Invalid or duplicate stand ID or unexpected stand fields.');
    const stand: Stand = { id: row.id };
    for (const field of Object.keys(fieldLimits) as (keyof typeof fieldLimits)[]) {
      const fieldValue = row[field];
      if (fieldValue == null) continue;
      if (
        !record(fieldValue) ||
        Object.keys(fieldValue).some((key) => !locales.includes(key as Locale))
      )
        throw new InvalidSnapshot('Unexpected locale in stand projection.');
      const translations: Partial<Record<Locale, string>> = {};
      for (const locale of locales) {
        const text = fieldValue[locale];
        if (text == null) continue;
        if (typeof text !== 'string' || text.length > fieldLimits[field])
          throw new InvalidSnapshot('Invalid or oversized stand text.');
        const trimmed = text.trim();
        if (trimmed || field === 'description' || field === 'menu') translations[locale] = trimmed;
      }
      if (Object.keys(translations).length) stand[field] = translations;
    }
    stands.set(stand.id, stand);
  }
  return { stands: standIds.map((id) => stands.get(id)!) };
}

function bearerDigest(authorization: string | undefined): Buffer | undefined {
  const token = authorization?.match(/^Bearer ([A-Za-z0-9_-]{40,128})$/i)?.[1];
  return token ? createHash('sha256').update(token).digest() : undefined;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  if (Number(req.headers['content-length']) > maxBytes) throw new BodyTooLarge();
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw new BodyTooLarge();
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks, bytes).toString('utf8'));
}

async function replaceFile(path: string, contents: string): Promise<void> {
  const previous = await readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
    return undefined;
  });
  if (previous === contents) return;
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, contents, { flag: 'wx', mode: 0o600 });
    await rename(temp, path);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function acceptsGzip(header: string | undefined): boolean {
  return (header ?? '').split(',').some((encoding) => {
    const [name, ...parameters] = encoding
      .toLowerCase()
      .split(';')
      .map((part) => part.trim());
    const quality = parameters.find((part) => /^q\s*=/.test(part));
    return name === 'gzip' && (quality === undefined || Number(quality.split('=')[1]) > 0);
  });
}

function matchesEtag(header: string | undefined, etag: string): boolean {
  return (header ?? '').split(',').some((value) => {
    const tag = value.trim();
    return tag === '*' || tag.replace(/^W\//, '') === etag.slice(2);
  });
}

export function createExpoforumStandsHandler(cacheFile: string, tokenSha256: string) {
  const expected = /^[a-f0-9]{64}$/i.test(tokenSha256)
    ? Buffer.from(tokenSha256, 'hex')
    : undefined;
  let cached: CachedResponse | undefined;

  async function loadResponse(): Promise<CachedResponse> {
    const file = await open(cacheFile, 'r');
    try {
      const { dev, ino, size, mtimeNs, ctimeNs } = await file.stat({ bigint: true });
      if (size > maxBytes) throw new BodyTooLarge();
      const fileVersion = `${dev}:${ino}:${size}:${mtimeNs}:${ctimeNs}`;
      if (cached?.fileVersion === fileVersion) return cached;
      const contents = await file.readFile('utf8');
      if (cached?.fileVersion === fileVersion) return cached;
      const json = JSON.stringify(project(JSON.parse(contents)));
      cached = {
        fileVersion,
        json,
        etag: `W/"${createHash('sha256').update(json).digest('hex')}"`,
        gzip: gzipSync(json),
      };
      return cached;
    } finally {
      await file.close();
    }
  }

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'GET') {
      try {
        const body = await loadResponse();
        res.setHeader('Cache-Control', 'private, no-cache');
        res.setHeader('Vary', 'Origin, Accept-Encoding');
        res.setHeader('ETag', body.etag);
        if (matchesEtag(req.headers['if-none-match'], body.etag)) {
          res.writeHead(304).end();
          return;
        }
        const gzip = acceptsGzip(req.headers['accept-encoding']);
        if (gzip) res.setHeader('Content-Encoding', 'gzip');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(gzip ? body.gzip : body.json);
      } catch {
        json(res, 503, { error: 'No valid ExpoForum stand data is available.' });
      }
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'GET, POST, OPTIONS' }).end();
      return;
    }
    if (!expected) {
      res.setHeader('Connection', 'close');
      json(res, 503, { error: 'ExpoForum stand updates are unavailable.' });
      return;
    }
    const actual = bearerDigest(req.headers.authorization);
    if (!actual || !timingSafeEqual(expected, actual)) {
      res.setHeader('Connection', 'close');
      res.setHeader('WWW-Authenticate', 'Bearer realm="expoforum-stands"');
      json(res, 401, { error: 'Invalid credentials.' });
      return;
    }
    if (req.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
      res.setHeader('Connection', 'close');
      json(res, 415, { error: 'Expected application/json.' });
      return;
    }
    try {
      const data = project(await readBody(req));
      await replaceFile(cacheFile, JSON.stringify(data));
      res.writeHead(204).end();
    } catch (error) {
      if (error instanceof BodyTooLarge) {
        res.setHeader('Connection', 'close');
        json(res, 413, { error: 'Stand projection exceeds the size limit.' });
      } else if (error instanceof InvalidSnapshot || error instanceof SyntaxError) {
        json(res, 400, { error: 'Invalid stand projection.' });
      } else {
        console.error('ExpoForum stand update failed.', (error as NodeJS.ErrnoException)?.code);
        json(res, 503, { error: 'ExpoForum stand data could not be saved.' });
      }
    }
  };
}
