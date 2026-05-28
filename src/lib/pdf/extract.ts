// Coord-based PDF extraction using pdfjs-dist. Returns one Line array per page,
// where each Line is a y-clustered group of text items sorted left-to-right.

export interface TextChunk {
  x: number;
  str: string;
  width: number;
}

export interface Line {
  y: number;
  pageNumber: number;
  items: TextChunk[];
  // Convenience joined string (single spaces between items).
  text: string;
  // Smallest x in this line.
  minX: number;
}

// pdfjs-dist ships ESM modules; the `legacy` build works in Node without DOM polyfills.
// In Node.js, pdfjs auto-disables the worker and runs in-process. We still need
// `workerSrc` to be truthy or `setupFakeWorkerGlobal` throws, so we point it at
// the bundled worker file (which is never actually loaded in Node).
async function getPdfjs() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (mod.GlobalWorkerOptions && !mod.GlobalWorkerOptions.workerSrc) {
    mod.GlobalWorkerOptions.workerSrc = 'pdfjs-dist/legacy/build/pdf.worker.mjs';
  }
  return mod;
}

const Y_TOLERANCE = 2.0;

// Letters/digits in Cyrillic + Latin scripts; used by joinChunksToLine to
// decide whether two abutting chunks need a space between them.
const ALPHANUM_RE = /[A-Za-zА-Яа-яІЇЄҐіїєґ0-9]/u;

// Join sorted text chunks into a single line string. pdfjs-dist reports adjacent
// items whose x-gap is tight (~≤1pt is common with kerning); the old rule
// `gap > 1.0` would fuse "ТОВ" + "Лани" into "ТОВЛани", which then fails
// the entity-prefix word-boundary regex downstream. Fix: also insert a space
// when both sides of the boundary are alphanumeric, regardless of gap.
export function joinChunksToLine(
  items: Array<{ x: number; str: string; width: number }>,
): string {
  let t = '';
  let prevEnd = -Infinity;
  for (const it of items) {
    if (t.length > 0) {
      const gap = it.x - prevEnd;
      const prevChar = t[t.length - 1] ?? '';
      const nextChar = it.str[0] ?? '';
      const wordBoundaryFusion =
        ALPHANUM_RE.test(prevChar) && ALPHANUM_RE.test(nextChar);
      if (gap > 1.0 || wordBoundaryFusion) t += ' ';
    }
    t += it.str;
    prevEnd = it.x + it.width;
  }
  return t.replace(/\s+/g, ' ').trim();
}

export async function extractPdfLines(pdfData: Buffer): Promise<Line[]> {
  const pdfjs = await getPdfjs();
  // pdfjs needs a Uint8Array (not Buffer's subclass identity).
  const data = new Uint8Array(pdfData.buffer, pdfData.byteOffset, pdfData.byteLength);
  const loadingTask = pdfjs.getDocument({
    data,
    disableFontFace: true,
    isEvalSupported: false,
    useSystemFonts: false,
  });
  const pdf = await loadingTask.promise;

  const allLines: Line[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();

    // Collect raw chunks with their absolute x/y.
    const chunks: { x: number; y: number; str: string; width: number }[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const it of content.items as any[]) {
      const str: string = it.str ?? '';
      if (!str) continue;
      const tr: number[] = it.transform ?? [1, 0, 0, 1, 0, 0];
      chunks.push({ x: tr[4], y: tr[5], str, width: it.width ?? 0 });
    }

    // Cluster by y.
    chunks.sort((a, b) => b.y - a.y || a.x - b.x);
    const lines: Line[] = [];
    for (const c of chunks) {
      const last = lines[lines.length - 1];
      if (last && Math.abs(last.y - c.y) <= Y_TOLERANCE) {
        last.items.push({ x: c.x, str: c.str, width: c.width });
      } else {
        lines.push({
          y: c.y,
          pageNumber: pageNum,
          items: [{ x: c.x, str: c.str, width: c.width }],
          text: '',
          minX: c.x,
        });
      }
    }

    // Sort items within each line, derive joined text + minX.
    for (const ln of lines) {
      ln.items.sort((a, b) => a.x - b.x);
      ln.minX = ln.items[0]?.x ?? 0;
      ln.text = joinChunksToLine(ln.items);
    }

    allLines.push(...lines);
    page.cleanup();
  }

  await pdf.cleanup();
  await pdf.destroy();

  return allLines;
}
