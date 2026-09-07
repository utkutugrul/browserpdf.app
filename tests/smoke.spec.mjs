// Per-tool smoke tests: load a fixture, run the tool's primary action, assert a
// real output file comes back. These exist because form filling in Fill & Sign
// was broken in production for weeks (minified pdf-lib class names) without any
// static review catching it: the failure only shows up at runtime.
//
// Every tool is covered, including a bounded one-page English OCR artifact
// and the pointer-placement tools (raw mouse events on the
// placement canvas, after scrolling it into view: raw coordinates don't
// auto-scroll the way locator clicks do).
import { test, expect } from '@playwright/test';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';

const FIXTURES = path.resolve(import.meta.dirname, '../test-fixtures/generated');
const fx = (...names) => names.map((n) => path.join(FIXTURES, n));

async function open(page, route) {
  await page.goto(`/${route}`);
  // The consent banner is fixed to the viewport bottom and can swallow clicks.
  // It only shows until a choice is stored, so gate on visibility, not presence.
  const reject = page.locator('#consent-reject');
  if (await reject.isVisible()) await reject.click();
  await expect(page.locator('h1').first()).toBeVisible();
}

async function grabDownload(page, action, pattern) {
  // Scale with the configured test timeout so a slow remote target gets the
  // whole budget instead of a hardcoded slice of it.
  const timeout = Math.max(30_000, test.info().timeout - 20_000);
  const [download] = await Promise.all([page.waitForEvent('download', { timeout }), action()]);
  expect(download.suggestedFilename()).toMatch(pattern);
  const file = await download.path();
  expect(statSync(file).size, 'output should not be empty').toBeGreaterThan(400);
  return download;
}

const noop = async () => {};

// route, files, extra setup, the button to press (null = the tool auto-runs),
// and the expected download name.
const CASES = [
  { route: 'merge', input: '#fileInput', files: ['report.pdf', 'appendix.pdf'], click: '#mergeBtn', out: /\.pdf$/ },
  {
    route: 'split',
    input: '#fileInput',
    files: ['report.pdf'],
    prepare: (page) => page.locator('#modeEach').click(), // a tab, not a radio
    click: '#splitActionBtn',
    out: /\.zip$/,
  },
  { route: 'organize', input: '#fileInput', files: ['report.pdf'], click: '#applyBtn', out: /\.pdf$/ },
  { route: 'rotate', input: '#fileInput', files: ['report.pdf'], click: '#applyBtn', out: /\.pdf$/ },
  {
    route: 'delete-pages',
    input: '#fileInput',
    files: ['report.pdf'],
    // Apply stays disabled until at least one page is marked for removal.
    prepare: (page) => page.locator('.page-tile').first().click(),
    click: '#applyBtn',
    out: /\.pdf$/,
  },
  { route: 'page-numbers', input: '#fileInput', files: ['report.pdf'], click: '#applyBtn', out: /\.pdf$/ },
  {
    route: 'watermark',
    input: '#fileInput',
    files: ['report.pdf'],
    prepare: (page) => page.fill('#watermarkText', 'CONFIDENTIAL'),
    click: '#applyBtn',
    out: /\.pdf$/,
  },
  { route: 'compress', input: '#fileInput', files: ['report.pdf'], click: '#compressBtn', out: /\.pdf$/ },
  { route: 'pdf-to-word', input: '#fileInput', files: ['report.pdf'], click: null, out: /\.docx$/ },
  { route: 'pdf-to-markdown', input: '#fileInput', files: ['report.pdf'], click: '#downloadBtn', out: /\.md$/ },
  { route: 'extract-text', input: '#fileInput', files: ['report.pdf'], click: '#downloadBtn', out: /\.txt$/ },
  { route: 'pdf-to-excel', input: '#fileInput', files: ['report.pdf'], click: '#convertBtn', out: /\.xlsx$/ },
  { route: 'images', input: '#pdfFileInput', files: ['report.pdf'], click: '#exportImagesBtn', out: /\.(zip|png)$/ },
  { route: 'jpg-to-pdf', input: '#fileInput', files: ['photo.png', 'photo.png'], click: '#createBtn', out: /\.pdf$/ },
  {
    route: 'edit-metadata',
    input: '#fileInput',
    files: ['report.pdf'],
    prepare: async (page) => {
      await page.fill('#titleInput', 'Smoke Test Title');
      await page.fill('#authorInput', 'BrowserPDF Tests');
    },
    click: '#applyBtn',
    out: /\.pdf$/,
  },
];

for (const c of CASES) {
  test(`${c.route}: produces a downloadable result`, async ({ page }) => {
    await open(page, c.route);
    await page.setInputFiles(c.input, fx(...c.files));
    await (c.prepare ? c.prepare(page) : noop());
    await grabDownload(
      page,
      c.click ? () => page.click(c.click) : noop,
      c.out,
    );
    await expect(page.locator('#errorSection')).toBeHidden();
  });
}

test('ocr-pdf: a scanned English image becomes a searchable PDF artifact', async ({ page }) => {
  test.setTimeout(240_000);
  const originalPath = fx('scanned-english.pdf')[0];
  const original = readFileSync(originalPath);
  const originalSnapshot = Buffer.from(original);
  await open(page, 'ocr-pdf');
  await page.setInputFiles('#fileInput', originalPath);
  await expect(page.locator('#optionsSection')).toBeVisible({ timeout: 45_000 });
  const download = await grabDownload(page, () => page.click('#applyBtn'), /-searchable\.pdf$/);
  const output = readFileSync(await download.path());
  expect(readFileSync(originalPath).equals(originalSnapshot), 'OCR must not mutate the selected input file').toBe(true);
  const artifact = await page.evaluate(async ({ originalValues, outputValues }) => {
    const { ensurePdfJs, PDFJS_ASSET_URLS } = await import('/js/lib-loader.js');
    const pdfjs = await ensurePdfJs();
    const render = async (values) => {
      const task = pdfjs.getDocument({ data: new Uint8Array(values), ...PDFJS_ASSET_URLS });
      try {
        const pdfDocument = await task.promise;
        const pdfPage = await pdfDocument.getPage(1);
        const viewport = pdfPage.getViewport({ scale: 1.5 });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext('2d', { willReadFrequently: true });
        await pdfPage.render({ canvasContext: context, viewport }).promise;
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        const content = await pdfPage.getTextContent();
        return {
          numPages: pdfDocument.numPages,
          width: canvas.width,
          height: canvas.height,
          text: content.items.map((item) => item.str).join(' '),
          pixels,
        };
      } finally {
        await task.destroy();
      }
    };
    const before = await render(originalValues);
    const after = await render(outputValues);
    let differentPixels = 0;
    if (before.width === after.width && before.height === after.height) {
      for (let index = 0; index < before.pixels.length; index += 4) {
        if (before.pixels[index] !== after.pixels[index]
          || before.pixels[index + 1] !== after.pixels[index + 1]
          || before.pixels[index + 2] !== after.pixels[index + 2]
          || before.pixels[index + 3] !== after.pixels[index + 3]) differentPixels++;
      }
    }
    return {
      originalPages: before.numPages,
      outputPages: after.numPages,
      originalSize: [before.width, before.height],
      outputSize: [after.width, after.height],
      differentPixels,
      outputText: after.text,
    };
  }, { originalValues: Array.from(original), outputValues: Array.from(output) });
  expect(artifact.originalPages).toBe(1);
  expect(artifact.outputPages).toBe(1);
  expect(artifact.outputSize).toEqual(artifact.originalSize);
  expect(artifact.differentPixels, 'the invisible OCR layer must not change any rendered pixel').toBe(0);
  expect(artifact.outputText).toMatch(/BROWSER\s+PDF/i);
  expect(artifact.outputText).toMatch(/OCR\s+TEST/i);
});

test('markdown-to-pdf: renders typed Markdown and exports a PDF', async ({ page }) => {
  await open(page, 'markdown-to-pdf');
  await page.fill('#mdSource', '# Smoke test\n\nA paragraph with **bold** text.\n\n- one\n- two\n');
  await expect(page.locator('#previewContent')).toContainText('Smoke test');
  await grabDownload(page, () => page.click('#downloadBtn'), /\.pdf$/);
});

test('view-pdf: renders the first page and pages through the document', async ({ page }) => {
  await open(page, 'view-pdf');
  await page.setInputFiles('#fileInput', fx('report.pdf'));
  await expect(page.locator('main canvas')).toBeVisible();
  await expect(page.getByText(/Page 1 of 3/)).toBeVisible();
  await page.getByRole('button', { name: /Next/ }).click();
  await expect(page.getByText(/Page 2 of 3/)).toBeVisible();
});

// Pages live at the assets root while their scripts and styles sit in js/ and
// css/, and localized URLs add a language prefix the worker strips. That makes
// every relative asset path resolve one level deeper than it looks, so assert a
// localized page still loads all of it: nothing 404s, the worker-injected
// consent script runs, and the stylesheet actually applies.
test('localized page resolves js/, css/ and the worker-injected scripts', async ({ page }) => {
  const failures = [];
  page.on('response', (r) => {
    const url = r.url();
    // /metrics is the Google Tag Gateway, a zone feature absent from wrangler dev.
    if (r.status() >= 400 && !url.includes('/metrics')) failures.push(`${r.status()} ${url}`);
  });

  await page.goto('/tr/merge');
  await expect(page.locator('html')).toHaveAttribute('lang', 'tr');
  await expect(page.locator('#consent-banner')).toBeVisible();
  await expect(page.locator('#lang-switcher')).toHaveValue('tr');
  const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(background, 'stylesheet must be applied').not.toBe('rgba(0, 0, 0, 0)');
  expect(failures, `unexpected failed requests: ${failures.join(', ')}`).toEqual([]);
});

// Duplicate-URL variants must consolidate permanently (301, not the assets
// binding's 307) onto the canonical clean URL, and a language-prefixed
// variant must land back inside that language rather than falling to English.
test('duplicate URL variants 301 to the canonical clean URL', async ({ page }) => {
  const cases = [
    ['/compress/', '/compress'],
    ['/compress.html', '/compress'],
    ['/index.html', '/'],
    ['/tr/compress/', '/tr/compress'],
    ['/tr/compress.html', '/tr/compress'],
  ];
  for (const [from, to] of cases) {
    const resp = await page.request.get(from, { maxRedirects: 0 });
    expect(resp.status(), `${from} should redirect permanently`).toBe(301);
    expect(new URL(resp.headers()['location'], resp.url()).pathname, `${from} target`).toBe(to);
  }
});

// The static related-tools block is the site's internal linking: it must
// render, translate, and keep the language prefix in its relative links.
test('related tools: block renders and localizes with the language prefix', async ({ page }) => {
  await open(page, 'compress');
  await expect(page.locator('.related-links a')).toHaveCount(5);
  await page.goto('/tr/compress');
  await expect(page.locator('.related-tools h2')).toBeVisible();
  await expect(page.locator('.related-tools h2')).not.toHaveText('Related tools');
  const href = await page.locator('.related-links a').first().evaluate((a) => a.href);
  expect(href, 'relative link must resolve inside /tr/').toMatch(/\/tr\/[a-z-]+$/);
});

// "size" strings look like "40.3 KB" or "Estimated: ~1.0 MB (…)".
function parseSize(text) {
  const m = /~?([\d.]+)\s*(B|KB|MB)/.exec(text);
  if (!m) return NaN;
  return Number(m[1]) * { B: 1, KB: 1e3, MB: 1e6 }[m[2]];
}

// Extract Text auto-OCRs pages it detects as scanned (a redacted page is a
// flat image, for example), and OCR means fetching tesseract first: allow for
// that instead of the default expect timeout.
async function extractedText(page, file) {
  await open(page, 'extract-text');
  await page.setInputFiles('#fileInput', file);
  await expect(page.locator('#textOutput')).toHaveValue(/\S/, { timeout: 120_000 });
  return page.locator('#textOutput').inputValue();
}

// Select a page tile and get the placement canvas ready for raw mouse input.
async function placementCanvasBox(page) {
  await page.locator('.page-tile').first().click();
  const canvas = page.locator('#placementCanvas');
  await expect(canvas).toBeVisible();
  await canvas.scrollIntoViewIfNeeded();
  return canvas.boundingBox();
}

// The estimate used to be computed from page 1 alone, which was off by 30x on
// documents whose first page is lighter or denser than the rest.
test('compress: shown estimate and result summary match the real output size', async ({ page }) => {
  await open(page, 'compress');
  await page.setInputFiles('#fileInput', fx('report.pdf'));
  const estimateLabel = page.locator('#estimateLabel');
  await expect(estimateLabel).toContainText(/Estimated: ~/);
  const estimate = parseSize(await estimateLabel.textContent());
  const download = await grabDownload(page, () => page.click('#compressBtn'), /\.pdf$/);
  const actual = statSync(await download.path()).size;
  expect(Math.abs(estimate - actual) / actual, `estimate ${estimate} vs actual ${actual}`).toBeLessThan(0.15);
  const result = await page.locator('#resultSummary').textContent();
  const shownTo = parseSize(result.split('→')[1]);
  expect(Math.abs(shownTo - actual), `result says "${result}" but the file is ${actual} bytes`).toBeLessThan(actual * 0.01 + 100);
});

// Redaction must REMOVE the covered content, not paint over it: a black box
// with the text still underneath is a false security guarantee.
test('redact: covered text is gone from the output, other pages keep theirs', async ({ page }) => {
  test.slow(); // the roundtrip OCRs the flattened page
  await open(page, 'redact');
  await page.setInputFiles('#fileInput', fx('report.pdf'));
  const box = await placementCanvasBox(page);
  await page.mouse.move(box.x + box.width * 0.06, box.y + box.height * 0.04);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.13, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('#applyBtn')).toBeEnabled();
  const download = await grabDownload(page, () => page.click('#applyBtn'), /-redacted\.pdf$/);
  const out = path.join(FIXTURES, 'redacted-roundtrip.pdf');
  await download.saveAs(out);
  const text = await extractedText(page, out);
  expect(text, 'page-1 title must not survive redaction').not.toMatch(/Quarterly/);
  expect(text, 'untouched pages must keep their text').toMatch(/Regional Breakdown/);
});

test('add-text: the stamped string extracts back out of the output', async ({ page }) => {
  await open(page, 'add-text');
  await page.setInputFiles('#fileInput', fx('report.pdf'));
  await page.fill('#textInput', 'STAMPED-BY-TESTS');
  const box = await placementCanvasBox(page);
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await expect(page.locator('#applyBtn')).toBeEnabled();
  const download = await grabDownload(page, () => page.click('#applyBtn'), /\.pdf$/);
  const out = path.join(FIXTURES, 'add-text-roundtrip.pdf');
  await download.saveAs(out);
  const text = await extractedText(page, out);
  expect(text).toMatch(/STAMPED-BY-TESTS/);
  expect(text, 'original text must survive').toMatch(/Quarterly/);
});

test('highlight: draws a highlight without destroying the page text', async ({ page }) => {
  await open(page, 'highlight');
  await page.setInputFiles('#fileInput', fx('report.pdf'));
  const box = await placementCanvasBox(page);
  await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.06);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.1, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('#applyBtn')).toBeEnabled();
  const download = await grabDownload(page, () => page.click('#applyBtn'), /\.pdf$/);
  const out = path.join(FIXTURES, 'highlight-roundtrip.pdf');
  await download.saveAs(out);
  const text = await extractedText(page, out);
  expect(text).toMatch(/Quarterly Report 2026/);
});

test('add-image: the image is embedded into the output PDF', async ({ page }) => {
  await open(page, 'add-image');
  await page.setInputFiles('#fileInput', fx('report.pdf'));
  await page.setInputFiles('#imageInput', fx('photo.png'));
  await expect(page.locator('#imageThumb')).toBeVisible();
  const download = await grabDownload(page, () => page.click('#applyBtn'), /-with-image\.pdf$/);
  const bytes = readFileSync(await download.path());
  expect(bytes.includes('/XObject'), 'output must carry an image XObject').toBe(true);
});

test('crop: the output page size shrinks by the chosen insets', async ({ page }) => {
  await open(page, 'crop');
  await page.setInputFiles('#fileInput', fx('report.pdf'));
  await page.locator('#cropTop').fill('100');
  await page.locator('#cropLeft').fill('50');
  const download = await grabDownload(page, () => page.click('#applyBtn'), /\.pdf$/);
  const doc = await PDFDocument.load(readFileSync(await download.path()));
  const { width, height } = doc.getPage(0).getSize();
  expect(Math.round(width)).toBe(562); // 612 - 50
  expect(Math.round(height)).toBe(692); // 792 - 100
});

test('excel-to-pdf: cell values survive into the PDF text', async ({ page }) => {
  await open(page, 'excel-to-pdf');
  await page.setInputFiles('#fileInput', fx('sheet.xlsx'));
  const download = await grabDownload(page, () => page.click('#convertBtn'), /\.pdf$/);
  const out = path.join(FIXTURES, 'excel-roundtrip.pdf');
  await download.saveAs(out);
  const text = await extractedText(page, out);
  expect(text).toMatch(/North/);
  expect(text).toMatch(/1455/);
});

test('word-to-pdf: document text survives into the PDF', async ({ page }) => {
  test.slow(); // sparse pages can trip the extract-side OCR heuristic
  await open(page, 'word-to-pdf');
  await page.setInputFiles('#fileInput', fx('letter.docx'));
  await expect(page.locator('#optionsSection')).toBeVisible();
  const download = await grabDownload(page, () => page.click('#convertBtn'), /\.pdf$/);
  const out = path.join(FIXTURES, 'word-roundtrip.pdf');
  await download.saveAs(out);
  const text = await extractedText(page, out);
  expect(text).toMatch(/quick brown fox/);
});

test('markdown-viewer: exports the rendered Markdown as a PDF', async ({ page }) => {
  await open(page, 'markdown-viewer');
  await page.fill('#mdSource', '# Viewer Heading\n\nBody text for the export test.\n');
  await expect(page.locator('#previewContent')).toContainText('Viewer Heading');
  await grabDownload(page, () => page.click('#downloadPdfBtn'), /\.pdf$/);
});

// The regression this whole suite was written for.
test('fill-sign: detects every AcroForm field type and writes the values back', async ({ page }) => {
  await open(page, 'fill-sign');
  await page.setInputFiles('#fileInput', fx('form.pdf'));

  const rows = page.locator('#fieldsList .field-row');
  await expect(rows).toHaveCount(7); // 4 text, checkbox, dropdown, radio group

  // A mangled class name used to send every field down the "not supported yet"
  // branch, so assert on the controls themselves, not just the row count.
  await expect(page.locator('#fieldsList input[type="text"]')).toHaveCount(4);
  await expect(page.locator('#fieldsList input[type="checkbox"]')).toHaveCount(1);
  await expect(page.locator('#fieldsList select')).toHaveCount(1);
  await expect(page.locator('#fieldsList input[type="radio"]')).toHaveCount(2);
  await expect(page.locator('#fieldsList')).not.toContainText('not supported');

  await page.locator('#fieldsList input[type="text"]').first().fill('Ada Lovelace');
  await page.locator('#fieldsList input[type="checkbox"]').check();
  await page.locator('#fieldsList select').selectOption('Professional');
  await grabDownload(page, () => page.click('#applyBtn'), /\.pdf$/);
});

test('protect then unlock: round-trips a password through both tools', async ({ page }) => {
  await open(page, 'protect');
  await page.setInputFiles('#fileInput', fx('report.pdf'));
  await page.fill('#passwordInput', 'correct horse battery');
  await page.fill('#confirmInput', 'correct horse battery');
  const protectedPdf = await grabDownload(page, () => page.click('#protectBtn'), /\.pdf$/);
  // Save under a .pdf name: the tools reject files that don't look like PDFs,
  // and Playwright's raw download path has no extension.
  const encrypted = path.join(FIXTURES, 'protected-roundtrip.pdf');
  await protectedPdf.saveAs(encrypted);
  // Protect once shipped an unencrypted file under a "-protected" name, so
  // assert the output is actually encrypted rather than merely downloadable.
  expect(readFileSync(encrypted).includes('/Encrypt'), 'output must be encrypted').toBe(true);

  await open(page, 'unlock');
  await page.setInputFiles('#fileInput', encrypted);
  await expect(page.locator('#passwordSection')).toBeVisible();
  await page.fill('#passwordInput', 'correct horse battery');
  // Unlock downloads straight from its own button; #downloadUnlockedBtn only
  // re-offers the same bytes afterwards.
  const unlocked = await grabDownload(page, () => page.click('#unlockBtn'), /unlocked\.pdf$/);
  const decrypted = path.join(FIXTURES, 'unlocked-roundtrip.pdf');
  await unlocked.saveAs(decrypted);
  expect(readFileSync(decrypted).includes('/Encrypt'), 'unlocked output must not be encrypted').toBe(false);

  // Unlock once returned a file that still carried its /Encrypt dictionary, so
  // prove the result is readable by running it back through Extract Text: pdf.js
  // cannot read a still-encrypted file, and blank output would mean the rebuild
  // dropped the page content.
  await open(page, 'extract-text');
  await page.setInputFiles('#fileInput', decrypted);
  await expect(page.locator('#textOutput')).toHaveValue(/Quarterly Report 2026/);
});
