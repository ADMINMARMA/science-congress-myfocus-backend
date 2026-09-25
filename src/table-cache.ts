import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { gzipSync } from 'node:zlib';
import { parseTable } from './parse-table.js';

export type Payload = { json: string; gzip: Buffer; etag: string; hash: string; status: string };
const hashOf = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const payload = (json: string, hash: string, status: string): Payload => ({
  json,
  hash,
  status,
  gzip: gzipSync(json),
  etag: `W/"${hashOf(json)}"`,
});
const version = 1;

export class TableCache {
  private memory: Payload | null = null;
  private pending: Promise<Payload> | null = null;
  constructor(
    readonly source: string,
    readonly cacheFile: string,
  ) {}
  get(force = false): Promise<Payload> {
    if (this.pending) return this.pending;
    this.pending = this.refresh(force).finally(() => {
      this.pending = null;
    });
    return this.pending;
  }
  private async refresh(force: boolean): Promise<Payload> {
    try {
      const bytes = await readFile(this.source);
      const hash = hashOf(bytes);
      if (!force && this.memory?.hash === hash) return { ...this.memory, status: 'memory' };
      if (!force && !this.memory) {
        try {
          const cached = JSON.parse(await readFile(this.cacheFile, 'utf8'));
          if (
            cached.version === version &&
            cached.hash === hash &&
            typeof cached.json === 'string' &&
            hashOf(cached.json) === cached.payloadHash
          ) {
            this.memory = payload(cached.json, hash, 'file');
            return this.memory;
          }
        } catch {
          // Regenerate a missing or corrupt cache from the workbook.
        }
      }
      const json = JSON.stringify(parseTable(bytes));
      await mkdir(dirname(this.cacheFile), { recursive: true });
      const temporary = `${this.cacheFile}.tmp`;
      await writeFile(
        temporary,
        JSON.stringify({ version, hash, json, payloadHash: hashOf(json) }),
      );
      await rename(temporary, this.cacheFile);
      this.memory = payload(json, hash, 'refreshed');
      return this.memory;
    } catch (error) {
      if (this.memory && !force) return { ...this.memory, status: 'stale' };
      throw error;
    }
  }
}
