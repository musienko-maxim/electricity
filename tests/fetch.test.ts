import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Each test resets the module cache so fetchPdf re-reads DATA_DIR fresh.
let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'fetch-test-'));
  process.env.DATA_DIR = tmpRoot;
  // Allow the test host so the behaviour tests below (which use example.com)
  // pass the SSRF allowlist. The SSRF tests use hosts outside this list.
  process.env.CHERKASY_ALLOWED_HOSTS = 'example.com';
  vi.resetModules();
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
  delete process.env.CHERKASY_ALLOWED_HOSTS;
  vi.restoreAllMocks();
});

const PDF_MAGIC = Buffer.from('%PDF-1.4\nfake pdf body bytes\n%%EOF');

describe('fetchPdf — cache poisoning prevention', () => {
  // BUG #1: writeFileSync persists downloaded bytes BEFORE validation.
  // A non-PDF response (HTML error page) shouldn't poison the disk cache.
  it('rejects and does NOT cache a response without %PDF- magic header', async () => {
    const bogus = Buffer.from('<html>error</html>');
    global.fetch = vi.fn(async () =>
      new Response(bogus, { status: 200, headers: { 'content-type': 'text/html' } }),
    ) as unknown as typeof fetch;

    const { fetchPdf } = await import('../src/lib/pdf/fetch');
    await expect(fetchPdf('https://example.com/foo.pdf')).rejects.toThrow(/PDF/i);

    // Cache directory should have no .pdf in it.
    const cacheDir = join(tmpRoot, 'pdf-cache');
    if (existsSync(cacheDir)) {
      const fs = await import('node:fs');
      const entries = fs.readdirSync(cacheDir).filter((f) => f.endsWith('.pdf'));
      expect(entries).toHaveLength(0);
    }
  });

  it('caches a valid PDF response on disk', async () => {
    global.fetch = vi.fn(async () =>
      new Response(PDF_MAGIC, { status: 200, headers: { etag: '"abc"' } }),
    ) as unknown as typeof fetch;

    const { fetchPdf } = await import('../src/lib/pdf/fetch');
    const r = await fetchPdf('https://example.com/foo.pdf');
    expect(r.cached).toBe(false);
    expect(existsSync(r.cachePath)).toBe(true);
    expect(readFileSync(r.cachePath).slice(0, 5).toString()).toBe('%PDF-');
  });
});

describe('fetchPdf — timeout', () => {
  // BUG #3: fetch has no timeout; a half-open connection hangs forever.
  it('aborts with an error if the response takes longer than the timeout', async () => {
    global.fetch = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal) {
            signal.addEventListener('abort', () => reject(new Error('aborted')));
          }
          // Never resolves naturally.
        }),
    ) as unknown as typeof fetch;

    const { fetchPdf } = await import('../src/lib/pdf/fetch');
    // Override timeout to something short for the test.
    await expect(
      fetchPdf('https://example.com/slow.pdf', { timeoutMs: 50 }),
    ).rejects.toThrow();
  }, 5000);
});

describe('fetchPdf — SSRF allowlist', () => {
  it('rejects a URL whose host is not in the allowlist, without making a request', async () => {
    const spy = vi.fn();
    global.fetch = spy as unknown as typeof fetch;

    const { fetchPdf } = await import('../src/lib/pdf/fetch');
    await expect(
      fetchPdf('http://169.254.169.254/latest/meta-data/'),
    ).rejects.toThrow(/disallow|allow|host/i);
    expect(spy).not.toHaveBeenCalled();
  });

  it('rejects a non-HTTP(S) scheme', async () => {
    const spy = vi.fn();
    global.fetch = spy as unknown as typeof fetch;

    const { fetchPdf } = await import('../src/lib/pdf/fetch');
    await expect(fetchPdf('file:///etc/passwd')).rejects.toThrow(/http|scheme|disallow|host/i);
    expect(spy).not.toHaveBeenCalled();
  });

  it('does NOT follow a redirect that points at a disallowed host (SSRF via redirect)', async () => {
    const spy = vi.fn(async () =>
      new Response(null, {
        status: 302,
        headers: { location: 'http://169.254.169.254/latest/meta-data/' },
      }),
    );
    global.fetch = spy as unknown as typeof fetch;

    const { fetchPdf } = await import('../src/lib/pdf/fetch');
    await expect(fetchPdf('https://example.com/foo.pdf')).rejects.toThrow(/disallow|allow|host/i);
    // Only the first (allowlisted) request was attempted; the internal target
    // was validated and rejected before any request was made to it.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).toContain('example.com');
  });
});

describe('fetchPdf — size cap (OOM protection)', () => {
  it('rejects and does NOT cache a PDF whose declared content-length exceeds the cap', async () => {
    const big = Buffer.concat([PDF_MAGIC, Buffer.alloc(2000)]);
    global.fetch = vi.fn(async () =>
      new Response(big, { status: 200, headers: { 'content-length': String(big.length) } }),
    ) as unknown as typeof fetch;

    const { fetchPdf } = await import('../src/lib/pdf/fetch');
    await expect(
      fetchPdf('https://example.com/big.pdf', { maxBytes: 100 }),
    ).rejects.toThrow(/large|cap|exceed/i);

    const cacheDir = join(tmpRoot, 'pdf-cache');
    if (existsSync(cacheDir)) {
      const fs = await import('node:fs');
      expect(fs.readdirSync(cacheDir).filter((f) => f.endsWith('.pdf'))).toHaveLength(0);
    }
  });

  it('rejects an over-cap body even without a content-length header (streamed count)', async () => {
    const big = Buffer.concat([PDF_MAGIC, Buffer.alloc(2000)]);
    global.fetch = vi.fn(async () => {
      const res = new Response(big, { status: 200 });
      // Force the no-declared-length path so the streamed byte counter is exercised.
      res.headers.delete('content-length');
      return res;
    }) as unknown as typeof fetch;

    const { fetchPdf } = await import('../src/lib/pdf/fetch');
    await expect(
      fetchPdf('https://example.com/big2.pdf', { maxBytes: 100 }),
    ).rejects.toThrow(/large|cap|exceed/i);
  });

  it('accepts a normal PDF under the cap', async () => {
    global.fetch = vi.fn(async () =>
      new Response(PDF_MAGIC, { status: 200 }),
    ) as unknown as typeof fetch;

    const { fetchPdf } = await import('../src/lib/pdf/fetch');
    const r = await fetchPdf('https://example.com/ok.pdf', { maxBytes: 50_000_000 });
    expect(r.cached).toBe(false);
    expect(r.buffer.slice(0, 5).toString()).toBe('%PDF-');
  });
});

describe('fetchPdf — conditional GET / revalidation', () => {
  // BUG #2: disk cache served unconditionally without revalidation.
  // After the fix: when an etag was stored, the next call should send
  // If-None-Match and accept either 304 (use cached) or 200 (new bytes).
  it('sends If-None-Match when prior etag is provided', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(PDF_MAGIC, { status: 200, headers: { etag: '"v1"' } }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 304 }));
    global.fetch = fetchSpy as unknown as typeof fetch;

    const { fetchPdf } = await import('../src/lib/pdf/fetch');
    const r1 = await fetchPdf('https://example.com/foo.pdf');
    expect(r1.etag).toBe('"v1"');

    // Second call passes the prior etag — server returns 304, we expect cached bytes.
    const r2 = await fetchPdf('https://example.com/foo.pdf', { priorEtag: '"v1"' });
    expect(r2.cached).toBe(true);

    // Verify the second request actually included If-None-Match.
    const secondCallInit = fetchSpy.mock.calls[1][1] as RequestInit;
    const headers = new Headers(secondCallInit.headers);
    expect(headers.get('if-none-match')).toBe('"v1"');
  });
});
