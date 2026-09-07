import { test, expect } from '@playwright/test';
import { readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';

const ROOT = path.resolve(import.meta.dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const FIXTURES = path.join(ROOT, 'test-fixtures/generated');

async function rejectConsent(page) {
  const reject = page.locator('#consent-reject');
  if (await reject.isVisible()) await reject.click();
}

test('home progressively discloses all tools and supports intent search', async ({ page }) => {
  await page.goto('/');
  await rejectConsent(page);
  await expect(page.locator('#popularGrid .tool-card')).toHaveCount(6);
  await expect(page.locator('#toolCatalog')).not.toHaveAttribute('open', '');
  const slugs = await page.locator('#toolGroups .tool-card').evaluateAll((cards) =>
    cards.map((card) => card.getAttribute('href')),
  );
  expect(slugs).toHaveLength(29);
  expect(new Set(slugs).size).toBe(29);
  expect(slugs.every((slug) => slug && !slug.endsWith('.html'))).toBe(true);
  const initialMainTabs = await page.evaluate(() => [...document.querySelectorAll('main a[href], main button, main input, main summary')]
    .filter((element) => !element.disabled && element.getClientRects().length > 0).length);
  expect(initialMainTabs).toBeLessThanOrEqual(10);
  const summary = page.locator('#toolCatalog > summary');
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#toolGroups .tool-card:visible')).toHaveCount(29);
  await page.keyboard.press('Enter');
  await expect(page.locator('#toolCatalog')).not.toHaveAttribute('open', '');
  for (const slug of slugs) {
    await page.fill('#toolFilter', slug);
    await expect(page.locator(`#toolGroups .tool-card[href="${slug}"]`)).toBeVisible();
  }
  await page.fill('#toolFilter', 'merge');
  await expect(page.locator('#toolGroups .tool-card:visible')).toHaveCount(1);
  await expect(page.locator('#toolGroups .tool-card:visible')).toHaveAttribute('href', 'merge');
  await expect(page.locator('#toolResultCount')).toContainText('1');
  await page.fill('#toolFilter', 'not-a-real-tool');
  await expect(page.locator('#noResults')).toBeVisible();
  await page.locator('#clearFilterBtn').click();
  await expect(page.locator('#toolFilter')).toBeFocused();
  await expect(page.locator('#popularTools')).toBeVisible();
});

test('localized home search keeps clean localized links', async ({ page }) => {
  await page.goto('/tr/');
  await rejectConsent(page);
  await page.fill('#toolFilter', 'birleştir');
  await expect(page.locator('#toolGroups .tool-card[href="/tr/merge"]')).toBeVisible();
  await expect(page.locator('#toolResultCount')).not.toHaveText(/tools found/i);
});

for (const width of [1440, 768, 390, 320]) {
  for (const theme of ['light', 'dark']) {
    test(`home and Merge fit ${width}px in ${theme} mode`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript((value) => {
        localStorage.setItem('pdf2md-theme', value);
        localStorage.setItem('bpdf-consent', 'rejected');
      }, theme);
      for (const route of ['', 'merge']) {
        await page.goto(`/${route}`);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        expect(await page.evaluate(() => document.getAnimations().filter((item) => item.playState === 'running').length)).toBe(0);
        await page.screenshot({ path: testInfo.outputPath(`${route || 'home'}-${width}-${theme}.png`), fullPage: true });
      }
    });
  }
}

test('Merge keyboard reorder retains focus and announces each new position', async ({ page }) => {
  await page.goto('/merge');
  await rejectConsent(page);
  await page.setInputFiles('#fileInput', [path.join(FIXTURES, 'report.pdf'), path.join(FIXTURES, 'appendix.pdf')]);
  const reportRow = () => page.locator('.file-item', { hasText: 'report.pdf' });
  await reportRow().getByRole('button', { name: /Move report\.pdf down/i }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.file-item-name').nth(1)).toHaveText('report.pdf');
  await expect(page.locator('#fileOrderStatus')).toHaveText('Moved report.pdf to position 2 of 2.');
  await expect(reportRow().getByRole('button', { name: /Move report\.pdf up/i })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.file-item-name').first()).toHaveText('report.pdf');
  await expect(page.locator('#fileOrderStatus')).toHaveText('Moved report.pdf to position 1 of 2.');
  await expect(reportRow().getByRole('button', { name: /Move report\.pdf down/i })).toBeFocused();
});

test('Merge keeps reordered page content and a persistent result', async ({ page }, testInfo) => {
  await page.goto('/merge');
  await rejectConsent(page);
  const traffic = [];
  const listener = (request) => traffic.push({ url: request.url(), body: request.postDataBuffer() });
  page.on('request', listener);
  await page.setInputFiles('#fileInput', [path.join(FIXTURES, 'report.pdf'), path.join(FIXTURES, 'appendix.pdf')]);
  await expect(page.locator('#mergeBtn')).toBeEnabled();
  await page.locator('.file-item').nth(1).getByRole('button', { name: /up/i }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#mergeBtn').click()]);
  const file = await download.path();
  expect(statSync(file).size).toBeGreaterThan(400);
  const output = await PDFDocument.load(readFileSync(file));
  expect(output.getPageCount()).toBe(5);
  const savedOutput = testInfo.outputPath('merged-reordered.pdf');
  await download.saveAs(savedOutput);
  await expect(page.locator('#successSection')).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(page.locator('#successSection')).toBeVisible();
  const secondDownload = page.waitForEvent('download');
  await page.locator('#downloadAgainBtn').click();
  await secondDownload;
  page.off('request', listener);

  const sourceFiles = ['report.pdf', 'appendix.pdf'].map((name) => readFileSync(path.join(FIXTURES, name)));
  for (const request of traffic) {
    expect(decodeURIComponent(request.url)).not.toMatch(/report\.pdf|appendix\.pdf|Quarterly Report 2026|Appendix A/i);
    expect(request.body?.toString().match(/Quarterly Report 2026|Appendix A/i) || null).toBeNull();
    for (const bytes of sourceFiles) expect(request.body?.includes(bytes.subarray(0, 64)) || false).toBe(false);
  }

  await page.goto('/extract-text');
  await page.setInputFiles('#fileInput', savedOutput);
  await expect(page.locator('#textOutput')).toHaveValue(/Quarterly Report 2026/, { timeout: 30_000 });
  const extracted = await page.locator('#textOutput').inputValue();
  const headings = ['Appendix A', 'Appendix B', 'Quarterly Report 2026', 'Regional Breakdown', 'Notes'];
  const positions = headings.map((heading) => extracted.indexOf(heading));
  expect(positions.every((position) => position >= 0), `missing heading in extracted output: ${extracted}`).toBe(true);
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
});

test('audited initial JavaScript stays under 100 KB per surface', () => {
  const size = (...files) => files.reduce((total, file) => total + statSync(path.join(PUBLIC, file)).size, 0);
  expect(size('js/i18n.js', 'js/hub.js', 'js/webmcp.js', 'js/theme.js', 'js/consent.js')).toBeLessThan(100_000);
  expect(size('js/i18n.js', 'js/merge.js', 'js/core/merge-pdf.js', 'js/webmcp.js', 'js/tool-ui.js', 'js/lib-loader.js', 'js/theme.js', 'js/consent.js')).toBeLessThan(100_000);
});

test('Phase 2 surfaces add no framework, remote font, or decorative gradient', () => {
  const html = ['index.html', 'merge.html'].map((file) => readFileSync(path.join(PUBLIC, file), 'utf8')).join('\n');
  expect(html).not.toMatch(/linearGradient|fonts\.(?:googleapis|gstatic)|react|vue|angular/i);
  expect(readFileSync(path.join(PUBLIC, 'css/styles.css'), 'utf8')).not.toMatch(/@font-face/i);
});

test('Phase 2 translations are complete', () => {
  const dictionaries = JSON.parse(readFileSync(path.join(PUBLIC, 'translations.json'), 'utf8'));
  expect(Object.keys(dictionaries)).toHaveLength(21);
  const keys = ['hub.intro_short', 'hub.privacy_proof_title', 'hub.find_tool', 'hub.search_hint',
    'hub.popular_tools', 'hub.popular_count', 'hub.browse_all', 'hub.result_count',
    'merge.intro_short', 'merge.workspace_label', 'merge.action_hint', 'merge.result_title', 'merge.download_again',
    'merge.js_order_changed'];
  for (const [locale, dictionary] of Object.entries(dictionaries)) {
    for (const key of keys) expect(dictionary[key], `${locale}: ${key}`).toBeTruthy();
    expect(dictionary['hub.intro_short'], `${locale}: action-led intro`).not.toBe(dictionary['hub.about_4_body']);
    expect(dictionary['hub.search_hint'], `${locale}: task search hint`).not.toBe(dictionary['hub.filter']);
    expect(dictionary['hub.find_tool_hint'], `${locale}: obsolete fallback key`).toBeUndefined();
    expect(dictionary['merge.js_order_changed'], `${locale}: reorder position placeholders`).toMatch(/\{name\}/);
    expect(dictionary['merge.js_order_changed'], `${locale}: reorder position placeholders`).toMatch(/\{position\}/);
    expect(dictionary['merge.js_order_changed'], `${locale}: reorder total placeholders`).toMatch(/\{total\}/);
  }
});

test('Phase 2 translation migration is idempotent', () => {
  expect(() => execFileSync('python3', ['scripts/update-phase2-translations.py', '--check'], { cwd: ROOT })).not.toThrow();
});
