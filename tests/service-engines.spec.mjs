import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';

test.describe.configure({ mode: 'serial' });

async function open(page, route) {
  await page.goto(`/${route}`);
  if (await page.locator('#consent-reject').isVisible()) await page.locator('#consent-reject').click();
}

async function finalDownload(page, action) {
  let downloads = 0;
  page.on('download', () => downloads++);
  await action();
  await expect(page.locator('#downloadResultBtn')).toBeVisible({ timeout: 60000 });
  expect(downloads).toBe(0);
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#downloadResultBtn').click()]);
  return new Uint8Array(await readFile(await download.path()));
}

async function inspectPdf(page, bytes) {
  return page.evaluate(async (values) => {
    const { ensurePdfJs, PDFJS_ASSET_URLS } = await import('/js/lib-loader.js');
    const pdfjs = await ensurePdfJs();
    const task = pdfjs.getDocument({ data: new Uint8Array(values), ...PDFJS_ASSET_URLS });
    try {
      const pdf = await task.promise;
      const text = [], positions = [];
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n), content = await page.getTextContent();
        text.push(content.items.map((item) => item.str).join(' '));
        positions.push(...content.items.map((item) => ({ text: item.str, x: item.transform[4], y: item.transform[5] })));
      }
      return { pageCount: pdf.numPages, text: text.join('\n'), pages: text, positions };
    } finally { await task.destroy(); }
  }, [...bytes]);
}

test('Extract Text route retains literal punctuation in a one-item PDF without OCR', async ({ page }) => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const original = '2 * 3 * 4';
  doc.addPage().drawText(original, { x: 40, y: 700, size: 12, font });
  await open(page, 'extract-text');
  await page.setInputFiles('#fileInput', { name: 'literal.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  await expect(page.locator('#textOutput')).toHaveValue(original, { timeout: 60000 });
  await expect(page.locator('#textSourceSummary')).toContainText('0 read with OCR');
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#downloadBtn').click()]);
  const bytes = new Uint8Array(await readFile(await download.path()));
  expect(new TextDecoder().decode(bytes)).toBe(original);
});

test('Excel to PDF route retains Unicode and full long cells across pages', async ({ page }) => {
  const token = 'KesintisizTürkçe'.repeat(100);
  const csv = '\ufeffAd,Açıklama\r\nİstanbul,"Çığ şükrü ğüşiöç Ελληνικά Русский"\r\nUzun,' + token + '\r\nSon,Son hücre tamamı\r\n';
  await open(page, 'excel-to-pdf');
  await page.setInputFiles('#fileInput', { name: 'unicode.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  const bytes = await finalDownload(page, () => page.locator('#convertBtn').click());
  const output = await inspectPdf(page, bytes);
  expect(output.text).toContain('İstanbul');
  expect(output.text).toContain('Çığ şükrü ğüşiöç Ελληνικά Русский');
  expect(output.text).toContain('Son hücre tamamı');
  expect(output.text.replace(/\s/g, '')).toContain(token);
  expect(output.text).not.toContain('?');
});

test('spreadsheet rejects a page that cannot fit one line before allocating a document', async ({ page }) => {
  await open(page, 'excel-to-pdf');
  const result = await page.evaluate(async () => {
    const { buildSpreadsheetPdf } = await import('/js/core/spreadsheet-pdf.js');
    let allocations = 0;
    const guardedRuntime = { PDFDocument: { create() { allocations++; throw new Error('Unexpected document allocation'); } } };
    try {
      await buildSpreadsheetPdf([{ name: 'Sheet', rows: [['A']] }], guardedRuntime, { pageSize: [100, 100], landscape: false, margin: 0, fontSize: 72 });
      return { name: 'success', allocations };
    } catch (error) { return { name: error.name, message: error.message, allocations }; }
  });
  expect(result.name).toBe('RangeError');
  expect(result.message).toContain('cannot fit one line');
  expect(result.allocations).toBe(0);
  const bytes = await page.evaluate(async () => {
    const { buildSpreadsheetPdf } = await import('/js/core/spreadsheet-pdf.js');
    const { ensurePdfLib } = await import('/js/lib-loader.js');
    const doc = await buildSpreadsheetPdf([{ name: 'Sheet', rows: [['A']] }], await ensurePdfLib(), { pageSize: [100, 107], landscape: false, margin: 0, fontSize: 72 });
    return [...await doc.save()];
  });
  const output = await inspectPdf(page, new Uint8Array(bytes));
  expect(output.pageCount).toBe(1);
  expect(output.text).toBe('A');
});

test('Excel to PDF route exports every selected sheet as a real PDF artifact', async ({ page }) => {
  await open(page, 'excel-to-pdf');
  const input = await page.evaluate(async () => {
    const { ensureXlsx } = await import('/js/lib-loader.js'); const XLSX = await ensureXlsx();
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Birinci sayfa'], ['İstanbul 42']]), 'First');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Second sheet'], ['Ωμέγα 73']]), 'Second');
    return [...new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }))];
  });
  await page.setInputFiles('#fileInput', { name: 'two-sheets.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(input) });
  await page.selectOption('#sheetSelect', '*');
  const output = await inspectPdf(page, await finalDownload(page, () => page.locator('#convertBtn').click()));
  expect(output.pageCount).toBe(2);
  expect(output.pages[0]).toContain('Birinci sayfa');
  expect(output.pages[0]).toContain('İstanbul 42');
  expect(output.pages[1]).toContain('Second sheet');
  expect(output.pages[1]).toContain('Ωμέγα 73');
});

test('OCR page ownership releases canvases on render and recognition failure or cancellation', async ({ page }) => {
  await open(page, 'extract-text');
  const results = await page.evaluate(async () => {
    const { recognizeOcrPage } = await import('/js/pdf-convert.js');
    const results = [];
    for (const scenario of ['render-throw', 'render-reject', 'recognize-reject', 'abort-render', 'abort-recognize', 'abort-in-canvas']) {
      const controller = new AbortController(), canvas = document.createElement('canvas');
      let canceled = 0, terminated = 0, recognizeCalls = 0;
      const page = {
        getViewport: ({ scale }) => ({ width: 200 * scale, height: 100 * scale }),
        render() {
          if (scenario === 'render-throw') throw new Error('Render failed synchronously');
          if (scenario === 'render-reject') return { promise: Promise.reject(new Error('Render failed')), cancel() {} };
          if (scenario === 'abort-render') {
            let rejectRender;
            const promise = new Promise((_, reject) => { rejectRender = reject; });
            queueMicrotask(() => controller.abort());
            return { promise, cancel() { canceled++; rejectRender(new Error('Render canceled')); } };
          }
          return { promise: Promise.resolve(), cancel() {} };
        },
      };
      const worker = {
        recognize() {
          recognizeCalls++;
          if (scenario === 'recognize-reject') return Promise.reject(new Error('Recognition failed'));
          queueMicrotask(() => controller.abort());
          // Tesseract termination need not settle an in-flight job. The owner
          // must release its canvas and settle independently on AbortSignal.
          return new Promise(() => {});
        },
        terminate() { terminated++; return Promise.resolve(); },
      };
      const job = recognizeOcrPage(page, worker, {
        signal: controller.signal,
        createCanvas: () => { if (scenario === 'abort-in-canvas') controller.abort(); return canvas; },
      }).then(() => 'success', (error) => error.name);
      const name = await Promise.race([job, new Promise((resolve) => setTimeout(() => resolve('pending'), 500))]);
      results.push({ scenario, name, width: canvas.width, height: canvas.height, canceled, terminated, recognizeCalls });
    }
    return results;
  });
  for (const result of results) {
    expect(result.name).toBe(result.scenario.startsWith('abort-') ? 'AbortError' : 'Error');
    expect([result.width, result.height]).toEqual([0, 0]);
    expect(result.terminated).toBe(result.scenario.startsWith('abort-') ? 1 : 0);
    if (result.scenario === 'abort-render') expect(result.canceled).toBe(1);
    if (result.scenario.startsWith('render-') || result.scenario === 'abort-in-canvas') expect(result.recognizeCalls).toBe(0);
  }
});

test('PDF to Excel route rejects a scanned blank extraction and exposes OCR continuation', async ({ page }) => {
  await open(page, 'pdf-to-excel');
  let downloads = 0; page.on('download', () => downloads++);
  await page.setInputFiles('#fileInput', path.resolve('test-fixtures/generated/scanned-english.pdf'));
  await page.locator('#convertBtn').click();
  await expect(page.locator('#errorSection')).toContainText('No selectable table text');
  await expect(page.locator('#chainRow').getByRole('button', { name: 'OCR PDF', exact: true })).toBeVisible();
  await expect(page.locator('#downloadResultBtn')).toHaveCount(0);
  expect(downloads).toBe(0);
});

test('shared Unicode layout reopens covered scripts, RTL fallbacks and long tokens with visible glyph failures', async ({ page }, testInfo) => {
  await open(page, 'markdown-to-pdf');
  const result = await page.evaluate(async () => {
    const { ensurePdfLib, ensurePdfJs, PDFJS_ASSET_URLS, ensureFontkit } = await import('/js/lib-loader.js');
    const { layoutMarkdownToPdf } = await import('/js/md-layout.js');
    const { embedUnicodeFont } = await import('/js/core/pdf-fonts.js');
    const [pdfLib, pdfjs] = await Promise.all([ensurePdfLib(), ensurePdfJs()]);
    const corpus = ['İstanbul Çığ şükrü ğüşiöç Ελληνικά Русский', 'שלום עולם', 'مرحبا بالعالم', '**שלום עולם**', '**مرحبا بالعالم**', '*İstanbul Çığ*', '***İstanbul Çığ***'];
    const results = [];
    for (const text of corpus) {
      const doc = await layoutMarkdownToPdf(text, pdfLib, { paper: 'a4', margin: 40 });
      const bytes = await doc.save();
      const task = pdfjs.getDocument({ data: bytes.slice(), ...PDFJS_ASSET_URLS });
      try {
        const pdf = await task.promise, page = await pdf.getPage(1);
        const content = await page.getTextContent(), viewport = page.getViewport({ scale: 1 });
        const canvas = document.createElement('canvas'); canvas.width = viewport.width; canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let ink = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 100 && pixels[i + 1] < 100 && pixels[i + 2] < 100) ink++;
        results.push({ input: text.replace(/\*/g, ''), text: content.items.map((item) => item.str).join(' '), ink, bytes: [...bytes], png: canvas.toDataURL('image/png') });
      } finally { await task.destroy(); }
    }
    let unsupported = '';
    try { await embedUnicodeFont(await pdfLib.PDFDocument.create(), { text: '漢字' }); } catch (error) { unsupported = error.name; }
    let unsupportedStyle = '';
    try { await embedUnicodeFont(await pdfLib.PDFDocument.create(), { text: 'مرحبا', weight: 'italic' }); } catch (error) { unsupportedStyle = error.message; }
    const mono = await embedUnicodeFont(await pdfLib.PDFDocument.create(), { text: 'Wi', weight: 'code' });
    const token = 'uzun'.repeat(300);
    const long = await layoutMarkdownToPdf(token, pdfLib, { pageSize: [200, 200], margin: 25 });
    const task = pdfjs.getDocument({ data: await long.save(), ...PDFJS_ASSET_URLS });
    let longText = '', longPages = 0, outside = false;
    try {
      const pdf = await task.promise; longPages = pdf.numPages;
      for (let p = 1; p <= pdf.numPages; p++) {
        const content = await (await pdf.getPage(p)).getTextContent();
        longText += content.items.map((item) => item.str).join('');
        outside ||= content.items.some((item) => item.str && (item.transform[4] < 24 || item.transform[4] + item.width > 176));
      }
    } finally { await task.destroy(); }
    const fontkit = await ensureFontkit();
    const raw = new Uint8Array(await (await fetch('/fonts/NotoNaskhArabic-Regular.ttf')).arrayBuffer());
    const arabic = fontkit.create(raw);
    const contextual = arabic.layout('مرحبا').glyphs.map((glyph) => glyph.id);
    const isolated = [...'مرحبا'].map((char) => arabic.glyphForCodePoint(char.codePointAt(0)).id);
    return { results, unsupported, unsupportedStyle, monoEqual: mono.widthOfTextAtSize('W', 12) === mono.widthOfTextAtSize('i', 12), longText, token, longPages, outside, contextual, isolated };
  });
  for (let i = 0; i < result.results.length; i++) {
    const item = result.results[i];
    await writeFile(testInfo.outputPath(`unicode-${i}.pdf`), new Uint8Array(item.bytes));
    await writeFile(testInfo.outputPath(`unicode-${i}.png`), Buffer.from(item.png.split(',')[1], 'base64'));
    expect(item.text).toBe(item.input);
    expect(item.ink).toBeGreaterThan(50);
  }
  expect(result.unsupported).toBe('UnsupportedGlyphError');
  expect(result.unsupportedStyle).toContain('italic arabic font is not available');
  expect(result.monoEqual).toBe(true);
  expect(result.longText).toBe(result.token);
  expect(result.longPages).toBeGreaterThan(1);
  expect(result.outside).toBe(false);
  expect(result.contextual).not.toEqual(result.isolated);
});

test('PDF to Excel route creates a real reviewed workbook and preserves cell text', async ({ page }) => {
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage();
  p.drawText('Product', { x: 40, y: 700, font, size: 12 }); p.drawText('Count', { x: 300, y: 700, font, size: 12 });
  p.drawText('Literal * stars', { x: 40, y: 675, font, size: 12 }); p.drawText('42', { x: 300, y: 675, font, size: 12 });
  await open(page, 'pdf-to-excel');
  await page.setInputFiles('#fileInput', { name: 'table.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  const bytes = await finalDownload(page, () => page.locator('#convertBtn').click());
  const rows = await page.evaluate(async (values) => {
    const { ensureXlsx } = await import('/js/lib-loader.js'); const XLSX = await ensureXlsx();
    const wb = XLSX.read(new Uint8Array(values), { type: 'array' });
    return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
  }, [...bytes]);
  expect(rows).toEqual([['Product', 'Count'], ['Literal * stars', '42']]);
});

test('extraction cancellation stops before publishing the last page', async ({ page }) => {
  const doc = await PDFDocument.create(); doc.addPage().drawText('Cancelable embedded text');
  const bytes = await doc.save();
  await open(page, 'extract-text');
  const error = await page.evaluate(async (values) => {
    const { extractPdfTextModel } = await import('/js/pdf-convert.js');
    const controller = new AbortController();
    try {
      await extractPdfTextModel(new File([new Uint8Array(values)], 'cancel.pdf'), {}, { signal: controller.signal, onProgress: () => controller.abort() });
      return 'published';
    } catch (error) { return error.name; }
  }, [...bytes]);
  expect(error).toBe('AbortError');
});

test('saved rectangles match resized CropBox previews for every right-angle rotation', async ({ page }) => {
  await open(page, 'view-pdf');
  const outputs = await page.evaluate(async () => {
    const { ensurePdfLib, ensurePdfJs, PDFJS_ASSET_URLS } = await import('/js/lib-loader.js');
    const { viewportPointToPdf, pdfPointToViewport, viewportRectToPdf, visualTransform } = await import('/js/core/page-geometry.js');
    const [pdfLib, pdfjs] = await Promise.all([ensurePdfLib(), ensurePdfJs()]);
    const results = [];
    for (const angle of [0, 90, 180, 270]) {
      const doc = await pdfLib.PDFDocument.create(), p = doc.addPage([400, 300]);
      p.setCropBox(35, 40, 260, 180); p.setRotation(pdfLib.degrees(angle));
      const task = pdfjs.getDocument({ data: await doc.save(), ...PDFJS_ASSET_URLS });
      let viewport;
      try { viewport = (await (await task.promise).getPage(1)).getViewport({ scale: 2 }); } finally { await task.destroy(); }
      const cssSize = { width: viewport.width / 4, height: viewport.height / 4 };
      const point = viewportPointToPdf(viewport, 12, 15, cssSize), roundtrip = pdfPointToViewport(viewport, ...point, cssSize);
      const rect = viewportRectToPdf(viewport, { x: 12, y: 15, width: 30, height: 10 }, cssSize);
      p.pushOperators(pdfLib.pushGraphicsState(), pdfLib.concatTransformationMatrix(...visualTransform(viewport, cssSize)));
      p.drawRectangle({ x: 12, y: cssSize.height - 25, width: 30, height: 10, color: pdfLib.rgb(1, 0, 0) });
      p.pushOperators(pdfLib.popGraphicsState());
      const output = pdfjs.getDocument({ data: await doc.save(), ...PDFJS_ASSET_URLS });
      try {
        const page = await (await output.promise).getPage(1), v = page.getViewport({ scale: 2 });
        const canvas = document.createElement('canvas'); canvas.width = v.width; canvas.height = v.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: v }).promise;
        const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        const xs = [], ys = [];
        for (let i = 0; i < data.length; i += 4) if (data[i] > 240 && data[i + 1] < 20 && data[i + 2] < 20) { xs.push(i / 4 % canvas.width); ys.push(Math.floor(i / 4 / canvas.width)); }
        results.push({ angle, roundtrip, rect, pixels: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
      } finally { await output.destroy(); }
    }
    return results;
  });
  for (const output of outputs) {
    expect(output.roundtrip[0]).toBeCloseTo(12); expect(output.roundtrip[1]).toBeCloseTo(15);
    expect(output.rect.width * output.rect.height).toBeCloseTo(1200);
    expect(output.pixels).toEqual([48, 60, 167, 99]);
  }
});
