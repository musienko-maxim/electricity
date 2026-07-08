// Scrape the Cherkasyoblenergo index page to discover the 12 outage-schedule
// PDF URLs. Re-scraping on each ingest lets the app self-heal when upstream
// rotates the per-publication UUIDs that appear in the URLs.
//
// IMPORTANT: www.cherkasyoblenergo.com emits HTTP response headers that violate
// strict HTTP/1.1 (e.g. an invalid header value char). Curl and browsers tolerate
// this; Node's undici (which backs the global `fetch`) does NOT and throws
// "Response does not match the HTTP/1.1 protocol". We bypass it for the index
// page by using node:https with `insecureHTTPParser: true`. The PDF CDN at
// gita.cherkasyoblenergo.com is well-behaved, so fetchPdf stays on global fetch.

import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { URL as NodeURL } from 'node:url';

const BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const DEFAULT_TIMEOUT_MS = 30_000;

function tolerantGet(url: string, timeoutMs: number): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new NodeURL(url);
    const lib = parsed.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = lib(
      {
        method: 'GET',
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        // The lenient HTTP parser tolerates the malformed headers the index
        // page returns. Browsers and curl accept it; strict undici doesn't.
        insecureHTTPParser: true,
        headers: { 'user-agent': BROWSER_UA, accept: 'text/html,*/*' },
      },
      (res: IncomingMessage) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }),
        );
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
    });
    req.end();
  });
}

// The schedule PDFs are published as files named "obl_main_static_<fmt>_<uuid>.pdf".
// Upstream has changed how it links them over time:
//   - legacy: absolute CDN URLs, ".../obl-main-controller/file/obl_main_static_172_<uuid>.pdf"
//     on gita.cherkasyoblenergo.com
//   - current (2026): ROOT-RELATIVE hrefs on www.cherkasyoblenergo.com, e.g.
//     "/cherkasyoblenergo/uploads/pages/files/obl_main_static_172_<uuid>.pdf"
// We anchor only on the stable "obl_main_static...<something>.pdf" filename token and
// accept either an absolute URL or a root-relative path, so neither a rotated
// format-id nor another path/host reshuffle silently drops us to zero results.
// Relative matches are resolved against the index URL in extractPdfLinks.
const PDF_LINK_RE =
  /(?:https?:\/\/[^"'\s<>]+)?\/[^"'\s<>]*obl_main_static[^"'\s<>]*\.pdf/giu;

export type HttpGetter = (
  url: string,
  timeoutMs: number,
) => Promise<{ status: number; body: string }>;

export interface DiscoverOptions {
  timeoutMs?: number;
  // For tests: inject a custom HTTP getter. Defaults to the lenient-parser
  // node:https implementation needed by the misbehaving index page.
  fetcher?: HttpGetter;
}

// Parses page HTML for PDF links, resolving root-relative hrefs against the
// index page's URL so callers always get absolute, downloadable URLs. Exported
// separately so tests can feed captured HTML without going over the network.
export function extractPdfLinks(html: string, baseUrl: string): string[] {
  const found = html.match(PDF_LINK_RE) ?? [];
  // Each file is referenced more than once in the SSR'd Nuxt payload: as an
  // anchor href (prefixed "/cherkasyoblenergo/uploads/...") and again as a bare
  // "/uploads/..." path in the JSON hydration block. These resolve to different
  // absolute URLs but the same file, so dedupe by the "obl_main_static..._....pdf"
  // filename, keeping the first URL in sorted order for deterministic ingestion.
  const byFilename = new Map<string, string>();
  for (const ref of found) {
    const abs = new URL(ref, baseUrl).toString();
    const filename = abs.slice(abs.lastIndexOf('/') + 1);
    const existing = byFilename.get(filename);
    if (existing === undefined || abs < existing) byFilename.set(filename, abs);
  }
  return Array.from(byFilename.values()).sort();
}

export async function discoverPdfUrls(
  indexUrl: string,
  opts: DiscoverOptions = {},
): Promise<string[]> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const getter = opts.fetcher ?? tolerantGet;
  const res = await getter(indexUrl, timeoutMs);
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Index fetch failed: HTTP ${res.status} (${indexUrl})`);
  }
  const urls = extractPdfLinks(res.body, indexUrl);
  if (urls.length === 0) {
    throw new Error(
      `No PDF links discovered at ${indexUrl} — page markup may have changed`,
    );
  }
  return urls;
}
