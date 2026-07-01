import { createHash } from 'node:crypto';
import { writeFileSync, mkdirSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const DEFAULT_TIMEOUT_MS = 30_000;
// Cap downloaded PDF size to avoid an OOM from a malicious/misbehaving server
// streaming an unbounded body into memory. Cherkasy schedule PDFs are well
// under this; override per-call via opts.maxBytes.
const DEFAULT_MAX_PDF_BYTES = 50 * 1024 * 1024; // 50 MiB
const PDF_MAGIC = Buffer.from('%PDF-');

export interface FetchedPdf {
  buffer: Buffer;
  sha256: string;
  etag: string | null;
  lastModified: string | null;
  cached: boolean;
  cachePath: string;
}

export interface FetchPdfOptions {
  timeoutMs?: number;
  // Caller (ingest.ts) supplies the prior etag/last-modified from pdf_sources
  // so we can revalidate via conditional GET. Without these, fetchPdf can't
  // tell that an unchanged file is on the CDN — it would just keep serving
  // whatever bytes are on disk.
  priorEtag?: string | null;
  priorLastModified?: string | null;
  // Maximum bytes to read from the response body before rejecting (OOM guard).
  maxBytes?: number;
}

// Read a response body into a Buffer, rejecting once more than `maxBytes` have
// arrived. Checks the declared Content-Length first (cheap reject), then counts
// bytes while streaming in case the header is absent or lies.
async function readBodyCapped(res: Response, maxBytes: number, url: string): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`PDF too large: ${declared} bytes exceeds ${maxBytes}-byte cap (${url})`);
  }

  const reader = res.body?.getReader();
  if (!reader) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) {
      throw new Error(`PDF too large: exceeds ${maxBytes}-byte cap (${url})`);
    }
    return buf;
  }

  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`PDF too large: exceeds ${maxBytes}-byte cap (${url})`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

function cacheDir(): string {
  const dir = resolve(process.env.DATA_DIR ?? './data', 'pdf-cache');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cachePathFor(url: string): string {
  const safe = createHash('sha1').update(url).digest('hex');
  return join(cacheDir(), `${safe}.pdf`);
}

function validatePdfMagic(buf: Buffer, url: string): void {
  if (buf.length < PDF_MAGIC.length || !buf.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) {
    throw new Error(
      `Downloaded bytes are not a PDF (missing %PDF- magic header) for ${url}; refusing to cache`,
    );
  }
}

function readCached(cp: string): FetchedPdf {
  const buf = readFileSync(cp);
  const sha = createHash('sha256').update(buf).digest('hex');
  return {
    buffer: buf,
    sha256: sha,
    etag: null,
    lastModified: statSync(cp).mtime.toUTCString(),
    cached: true,
    cachePath: cp,
  };
}

export async function fetchPdf(url: string, opts: FetchPdfOptions = {}): Promise<FetchedPdf> {
  const cp = cachePathFor(url);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const hasCache = existsSync(cp);
  const canRevalidate = Boolean(opts.priorEtag || opts.priorLastModified) && hasCache;

  // If we have a local cache and no way to revalidate it (no prior etag/
  // last-modified from the caller), serve it. This preserves the existing
  // "first request after restart" fast-path behavior.
  if (!canRevalidate && hasCache) {
    return readCached(cp);
  }

  const headers: Record<string, string> = {
    'user-agent': BROWSER_UA,
    accept: 'application/pdf,*/*',
  };
  if (opts.priorEtag) headers['if-none-match'] = opts.priorEtag;
  if (opts.priorLastModified) headers['if-modified-since'] = opts.priorLastModified;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, { headers, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }

  // 304: server says our cached copy is current.
  if (res.status === 304 && hasCache) {
    const r = readCached(cp);
    r.etag = res.headers.get('etag') ?? opts.priorEtag ?? null;
    r.lastModified = res.headers.get('last-modified') ?? opts.priorLastModified ?? null;
    return r;
  }

  if (!res.ok) {
    throw new Error(`PDF fetch failed: ${res.status} ${res.statusText} (${url})`);
  }
  const buf = await readBodyCapped(res, opts.maxBytes ?? DEFAULT_MAX_PDF_BYTES, url);
  // CRITICAL: validate BEFORE writing to disk. A non-PDF 200 response (HTML
  // error page from the CDN) would otherwise poison the cache forever.
  validatePdfMagic(buf, url);
  const sha = createHash('sha256').update(buf).digest('hex');
  writeFileSync(cp, buf);
  return {
    buffer: buf,
    sha256: sha,
    etag: res.headers.get('etag'),
    lastModified: res.headers.get('last-modified'),
    cached: false,
    cachePath: cp,
  };
}
