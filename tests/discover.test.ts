import { describe, it, expect, afterEach, vi } from 'vitest';
import { extractPdfLinks, discoverPdfUrls } from '../src/lib/pdf/discover';

const BASE = 'https://www.cherkasyoblenergo.com/static/perelik-gpv';

describe('extractPdfLinks', () => {
  it('extracts root-relative attachment PDF links and resolves them against the base URL', () => {
    // Current (2026) markup: relative hrefs on www.cherkasyoblenergo.com.
    const html = `
      <a class="post-attachment-link" href="/cherkasyoblenergo/uploads/pages/files/obl_main_static_172_aaa.pdf">1 черга</a>
      <a class="post-attachment-link" href="/cherkasyoblenergo/uploads/pages/files/obl_main_static_172_bbb.pdf">2 черга</a>
    `;
    expect(extractPdfLinks(html, BASE)).toEqual([
      'https://www.cherkasyoblenergo.com/cherkasyoblenergo/uploads/pages/files/obl_main_static_172_aaa.pdf',
      'https://www.cherkasyoblenergo.com/cherkasyoblenergo/uploads/pages/files/obl_main_static_172_bbb.pdf',
    ]);
  });

  it('still extracts legacy absolute gita.cherkasyoblenergo.com controller links', () => {
    // Backward-compat: if upstream reverts to the old absolute CDN scheme we
    // must not regress to zero links.
    const html = `
      <a href="https://gita.cherkasyoblenergo.com/obl-main-controller/file/obl_main_static_172_aaa.pdf">x</a>
    `;
    expect(extractPdfLinks(html, BASE)).toEqual([
      'https://gita.cherkasyoblenergo.com/obl-main-controller/file/obl_main_static_172_aaa.pdf',
    ]);
  });

  it('dedupes the anchor href and the JSON-hydration path that point at the same file', () => {
    // The Nuxt payload repeats each file: once as an anchor href with a
    // /cherkasyoblenergo prefix, once as a bare /uploads path in JSON. Both
    // resolve to the same downloadable file, so collapse them to one entry.
    const html = `
      <a class="post-attachment-link" href="/cherkasyoblenergo/uploads/pages/files/obl_main_static_172_aaa.pdf">x</a>
      ,{"url":"/uploads/pages/files/obl_main_static_172_aaa.pdf"}
    `;
    const out = extractPdfLinks(html, BASE);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/obl_main_static_172_aaa\.pdf$/);
  });

  it('returns deterministic order (sorted by resolved URL)', () => {
    const html = `
      <a href="/cherkasyoblenergo/uploads/pages/files/obl_main_static_172_zzz.pdf">x</a>
      <a href="/cherkasyoblenergo/uploads/pages/files/obl_main_static_172_aaa.pdf">x</a>
    `;
    const out = extractPdfLinks(html, BASE);
    expect(out[0]).toMatch(/aaa\.pdf$/);
    expect(out[1]).toMatch(/zzz\.pdf$/);
  });

  it('ignores unrelated PDFs (only matches obl_main_static schedule files)', () => {
    const html = `
      <a href="/uploads/pages/files/some-other.pdf">x</a>
      <a href="https://example.com/legal.pdf">x</a>
      <a class="post-attachment-link" href="/cherkasyoblenergo/uploads/pages/files/obl_main_static_172_aaa.pdf">x</a>
    `;
    expect(extractPdfLinks(html, BASE)).toEqual([
      'https://www.cherkasyoblenergo.com/cherkasyoblenergo/uploads/pages/files/obl_main_static_172_aaa.pdf',
    ]);
  });
});

describe('discoverPdfUrls', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches the index URL and returns resolved absolute links', async () => {
    const html = `<a class="post-attachment-link" href="/cherkasyoblenergo/uploads/pages/files/obl_main_static_172_aaa.pdf">x</a>`;
    const fetcher = vi.fn(async () => ({ status: 200, body: html }));

    const out = await discoverPdfUrls(BASE, { fetcher });
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(
      'https://www.cherkasyoblenergo.com/cherkasyoblenergo/uploads/pages/files/obl_main_static_172_aaa.pdf',
    );
    expect(fetcher).toHaveBeenCalledWith(BASE, expect.any(Number));
  });

  it('throws on non-2xx HTTP status', async () => {
    const fetcher = vi.fn(async () => ({ status: 503, body: '' }));
    await expect(discoverPdfUrls(BASE, { fetcher })).rejects.toThrow(/HTTP 503/);
  });

  it('throws when zero PDF links are found (markup-change canary)', async () => {
    const fetcher = vi.fn(async () => ({ status: 200, body: '<html>nothing here</html>' }));
    await expect(discoverPdfUrls(BASE, { fetcher })).rejects.toThrow(/No PDF links discovered/);
  });

  it('propagates errors from the fetcher (e.g. timeout)', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('Request timed out');
    });
    await expect(discoverPdfUrls(BASE, { fetcher })).rejects.toThrow(/timed out/);
  });
});
