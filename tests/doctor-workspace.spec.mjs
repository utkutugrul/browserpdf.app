import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// Authored only. Root allocates actual engine/browser execution and supplies
// existing real PDF inputs; this spec does not generate or rewrite fixtures.
const first = process.env.DOCTOR_D2_PDF_A;
const second = process.env.DOCTOR_D2_PDF_B;
test.describe('Doctor D2 minimal actual adapter', () => {
  test.skip(!first || !second, 'Root must allocate DOCTOR_D2_PDF_A/B and the native window.');
  test('rejected B retains local A and real canonical original/current/history', async ({ page }) => {
    const a = await readFile(first), b = await readFile(second);
    await page.goto('/document-doctor');
    const canonical = await page.evaluate(async ({ a, b }) => {
      const ui = await import('/js/tool-ui.js'); await ui.ensureDocumentSession();
      ui.documentSession.begin(new Uint8Array(a), 'canonical-a.pdf'); ui.documentSession.adopt(new Uint8Array(b), 'canonical-b.pdf');
      const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
      return { snapshot: ui.documentSession.snapshot(), original: await digest(ui.documentSession.original().bytes), current: await digest(ui.documentSession.current().bytes) };
    }, { a: [...a], b: [...b] });
    await page.locator('#fileInput').setInputFiles({ name: 'local-a.pdf', mimeType: 'application/pdf', buffer: a });
    await expect(page.locator('#selectedFileName')).toHaveText('local-a.pdf');
    await page.locator('#diagnoseBtn').click(); await expect(page.locator('#doctorResults')).toBeVisible();
    const previous = await page.locator('#doctorFindingList').textContent();
    await page.locator('#fileInput').setInputFiles({ name: 'invalid-b.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-invalid') });
    await expect(page.getByText(/Your previous document remains available/)).toBeVisible();
    await expect(page.locator('#selectedFileName')).toHaveText('local-a.pdf');
    await expect(page.locator('#doctorFindingList')).toHaveText(previous);
    await expect(page.locator('#rebuildBtn')).toBeDisabled(); await expect(page.locator('#rebuildBtn')).toContainText(/review/i);
    const after = await page.evaluate(async () => {
      const ui = await import('/js/tool-ui.js');
      const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
      return { snapshot: ui.documentSession.snapshot(), original: await digest(ui.documentSession.original().bytes), current: await digest(ui.documentSession.current().bytes) };
    });
    expect(after).toEqual(canonical);
  });
  test('actual 32 MiB admission bound is visible without losing the accepted source', async ({ page }) => {
    const a = await readFile(first); await page.goto('/document-doctor');
    await page.locator('#fileInput').setInputFiles({ name: 'a.pdf', mimeType: 'application/pdf', buffer: a });
    await expect(page.locator('#selectedFileName')).toHaveText('a.pdf');
    await page.locator('#fileInput').setInputFiles({ name: 'large.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(32 * 1024 * 1024 + 1) });
    await expect(page.locator('#selectedFileName')).toHaveText('a.pdf');
    await expect(page.getByText(/32 MiB/)).toBeVisible();
  });
});
