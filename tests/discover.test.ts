import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { extractPdfLinks, discoverPdfUrls } from '../src/lib/pdf/discover';

describe('extractPdfLinks', () => {
  it('extracts the obl_main_static PDF URLs from index HTML', () => {
    const html = `
      <a class="upload-btn" href="https://gita.cherkasyoblenergo.com/obl-main-controller/file/obl_main_static_172_aaa.pdf">Завантажити</a>
      <a class="upload-btn" href="https://gita.cherkasyoblenergo.com/obl-main-controller/file/obl_main_static_172_bbb.pdf">Завантажити</a>
    `;
    expect(extractPdfLinks(html)).toEqual([
      'https://gita.cherkasyoblenergo.com/obl-main-controller/file/obl_main_static_172_aaa.pdf',
      'https://gita.cherkasyoblenergo.com/obl-main-controller/file/obl_main_static_172_bbb.pdf',
    ]);
  });

  it('dedupes duplicated SSR/hydration entries', () => {
    const html = `
      <a href="https://gita.cherkasyoblenergo.com/obl-main-controller/file/obl_main_static_172_aaa.pdf">x</a>
      ,{"fileLink":"https://gita.cherkasyoblenergo.com/obl-main-controller/file/obl_main_static_172_aaa.pdf"}
    `;
    expect(extractPdfLinks(html)).toEqual([
      'https://gita.cherkasyoblenergo.com/obl-main-controller/file/obl_main_static_172_aaa.pdf',
    ]);
  });

  it('returns deterministic order (sorted)', () => {
    const html = `
      <a href="https://gita.cherkasyoblenergo.com/obl-main-controller/file/obl_main_static_172_zzz.pdf">x</a>
      <a href="https://gita.cherkasyoblenergo.com/obl-main-controller/file/obl_main_static_172_aaa.pdf">x</a>
    `;
    const out = extractPdfLinks(html);
    expect(out[0]).toMatch(/aaa\.pdf$/);
    expect(out[1]).toMatch(/zzz\.pdf$/);
  });

  it('ignores other PDFs (e.g. legal docs, only matches the schedule controller)', () => {
    const html = `
      <a href="https://example.com/some-other.pdf">x</a>
      <a href="https://gita.cherkasyoblenergo.com/obl-main-controller/file/obl_main_static_172_aaa.pdf">x</a>
    `;
    expect(extractPdfLinks(html)).toEqual([
      'https://gita.cherkasyoblenergo.com/obl-main-controller/file/obl_main_static_172_aaa.pdf',
    ]);
  });
});

describe('discoverPdfUrls', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches the index URL and returns extracted links', async () => {
    const html = `<a href="https://gita.cherkasyoblenergo.com/obl-main-controller/file/obl_main_static_172_aaa.pdf">x</a>`;
    const fetcher = vi.fn(async () => ({ status: 200, body: html }));

    const out = await discoverPdfUrls('https://example.com/idx', { fetcher });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/aaa\.pdf$/);
    expect(fetcher).toHaveBeenCalledWith('https://example.com/idx', expect.any(Number));
  });

  it('throws on non-2xx HTTP status', async () => {
    const fetcher = vi.fn(async () => ({ status: 503, body: '' }));
    await expect(discoverPdfUrls('https://example.com/idx', { fetcher })).rejects.toThrow(/HTTP 503/);
  });

  it('throws when zero PDF links are found (markup-change canary)', async () => {
    const fetcher = vi.fn(async () => ({ status: 200, body: '<html>nothing here</html>' }));
    await expect(discoverPdfUrls('https://example.com/idx', { fetcher })).rejects.toThrow(/No PDF links discovered/);
  });

  it('propagates errors from the fetcher (e.g. timeout)', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('Request timed out');
    });
    await expect(discoverPdfUrls('https://example.com/idx', { fetcher })).rejects.toThrow(/timed out/);
  });
});
