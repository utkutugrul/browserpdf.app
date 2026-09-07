import { expect, test } from '@playwright/test';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const FIXTURES = path.join(ROOT, 'test-fixtures/generated');
const LANGUAGES = ['en','es','fr','de','pt','it','ru','ja','ko','zh','zh-TW','ar','hi','tr','nl','pl','id','vi','th','uk','cs','sv'];
const SERVICES = ['workflows', 'privacy-scan', 'document-doctor'];
const RESPONSIVE_SURFACES = ['', 'merge', ...SERVICES];
const SERVICE_PREFIX = { workflows: 'workflows', 'privacy-scan': 'privacy_scan', 'document-doctor': 'doctor' };

function escapeAttribute(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function metaContent(html, attribute, name) {
  return new RegExp(`<meta\\s+${attribute}="${name}"\\s+content="([^"]*)"`, 'i').exec(html)?.[1];
}

function jsonLd(html) {
  const raw = /<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/.exec(html)?.[1];
  return raw ? JSON.parse(raw) : null;
}

test('shared shell inventory and service catalog/metadata integration are exact', async ({ page }) => {
  const htmlFiles = (await import('node:fs')).readdirSync(PUBLIC)
    .filter((name) => name.endsWith('.html') && name !== 'offline.html');
  expect(htmlFiles).toHaveLength(36);
  for (const name of htmlFiles) {
    const html = readFileSync(path.join(PUBLIC, name), 'utf8');
    expect(html.match(/class="skip-link"/g), `${name}: skip`).toHaveLength(1);
    expect(html.match(/id="main-content"/g), `${name}: main`).toHaveLength(1);
    expect(html.match(/class="site-header"/g), `${name}: header`).toHaveLength(1);
    expect(html.match(/class="site-footer"/g), `${name}: footer`).toHaveLength(1);
  }
  await page.goto('/');
  expect(await page.locator('#toolGroups .tool-card').count()).toBe(29);
  for (const service of SERVICES) await expect(page.locator(`a[href="${service}"]`).first()).toBeAttached();

  for (const service of SERVICES) {
    const html = readFileSync(path.join(PUBLIC, `${service}.html`), 'utf8');
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    expect(blocks, `${service} JSON-LD`).toHaveLength(1);
    const json = JSON.parse(blocks[0][1]);
    expect(json['@graph'].map((item) => item['@type'])).toEqual(['SoftwareApplication', 'BreadcrumbList']);
    expect(html).toContain(`https://browserpdf.app/${service}`);
    expect(html).toContain('related-tools');
  }
  const llms = readFileSync(path.join(PUBLIC, 'llms.txt'), 'utf8');
  for (const service of SERVICES) expect(llms).toContain(`(/${service})`);

  const jsonLdGenerator = readFileSync(path.join(ROOT, 'scripts/add-jsonld.py'), 'utf8');
  expect(jsonLdGenerator).not.toMatch(/100% client-side|no file is ever uploaded|no usage limits/i);
});

test('all 22 language routes, Arabic RTL, sitemap alternates, and localized service keys are complete', async ({ request }) => {
  const sitemap = readFileSync(path.join(PUBLIC, 'sitemap.xml'), 'utf8');
  const dictionaries = JSON.parse(readFileSync(path.join(PUBLIC, 'translations.json'), 'utf8'));
  expect(Object.keys(dictionaries)).toHaveLength(21);
  const localeKeys = ['hub.tool_workflows', 'hub.privacy_scan_title', 'hub.document_doctor_title', 'common.home'];
  for (const prefix of Object.values(SERVICE_PREFIX)) {
    localeKeys.push(`${prefix}.h1`, `${prefix}.meta_title`, `${prefix}.meta_description`,
      `${prefix}.jsonld_name`, `${prefix}.jsonld_description`, `${prefix}.breadcrumb_name`);
  }
  for (const [locale, dictionary] of Object.entries(dictionaries)) {
    for (const key of localeKeys) expect(dictionary[key], `${locale}:${key}`).toBeTruthy();
  }
  for (const service of SERVICES) {
    for (const language of LANGUAGES) {
      const route = language === 'en' ? `/${service}` : `/${language}/${service}`;
      const response = await request.get(route);
      expect(response.status(), route).toBe(200);
      const html = await response.text();
      expect(html, route).toContain(language === 'ar' ? '<html lang="ar" dir="rtl">' : `<html lang="${language}">`);
      const canonical = language === 'en'
        ? `https://browserpdf.app/${service}` : `https://browserpdf.app/${language}/${service}`;
      expect(html, route).toContain(`<link rel="canonical" href="${canonical}">`);
      expect(sitemap).toContain(`<loc>${canonical}</loc>`);

      const source = readFileSync(path.join(PUBLIC, `${service}.html`), 'utf8');
      const sourceJson = jsonLd(source);
      const prefix = SERVICE_PREFIX[service];
      const dictionary = language === 'en' ? null : dictionaries[language];
      const expectedTitle = language === 'en'
        ? /<title>([\s\S]*?)<\/title>/.exec(source)[1] : dictionary[`${prefix}.meta_title`];
      const expectedDescription = language === 'en'
        ? null : escapeAttribute(dictionary[`${prefix}.meta_description`]);
      expect(/<title>([\s\S]*?)<\/title>/.exec(html)[1], `${route} title`)
        .toBe(language === 'en' ? expectedTitle : escapeAttribute(expectedTitle));
      for (const [attribute, name] of [
        ['name', 'description'], ['property', 'og:description'], ['name', 'twitter:description'],
      ]) expect(metaContent(html, attribute, name), `${route} ${name}`)
        .toBe(language === 'en' ? metaContent(source, attribute, name) : expectedDescription);
      for (const [attribute, name] of [['property', 'og:title'], ['name', 'twitter:title']]) {
        const expected = language === 'en' ? metaContent(source, attribute, name) : escapeAttribute(dictionary[`${prefix}.meta_title`]);
        expect(metaContent(html, attribute, name), `${route} ${name}`).toBe(expected);
      }
      expect(metaContent(html, 'property', 'og:url'), `${route} og:url`).toBe(canonical);
      expect(metaContent(html, 'name', 'twitter:card'), `${route} twitter card`).toBe('summary_large_image');
      expect(metaContent(html, 'name', 'twitter:image'), `${route} twitter image`).toBe('https://browserpdf.app/og/browserpdf.png');

      const graph = jsonLd(html)['@graph'];
      const application = graph.find((item) => item['@type'] === 'SoftwareApplication');
      const breadcrumbs = graph.find((item) => item['@type'] === 'BreadcrumbList').itemListElement;
      const sourceApplication = sourceJson['@graph'].find((item) => item['@type'] === 'SoftwareApplication');
      const sourceBreadcrumbs = sourceJson['@graph'].find((item) => item['@type'] === 'BreadcrumbList').itemListElement;
      expect(application).toMatchObject({
        name: language === 'en' ? sourceApplication.name : dictionary[`${prefix}.jsonld_name`],
        description: language === 'en' ? sourceApplication.description : dictionary[`${prefix}.jsonld_description`],
        url: canonical,
      });
      expect(breadcrumbs[0]).toMatchObject({
        name: language === 'en' ? sourceBreadcrumbs[0].name : dictionary['common.home'],
        item: language === 'en' ? 'https://browserpdf.app/' : `https://browserpdf.app/${language}/`,
      });
      expect(breadcrumbs[1]).toMatchObject({
        name: language === 'en' ? sourceBreadcrumbs[1].name : dictionary[`${prefix}.breadcrumb_name`],
        item: canonical,
      });
    }
    for (const language of LANGUAGES) expect(sitemap).toContain(`hreflang="${language}" href="https://browserpdf.app/${language === 'en' ? '' : `${language}/`}${service}"`);
  }
});

for (const width of [1440, 768, 390, 320]) {
  for (const theme of ['light', 'dark']) {
    test(`final surfaces fit ${width}px in ${theme} mode without idle animation`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript((value) => {
        localStorage.setItem('pdf2md-theme', value);
        localStorage.setItem('bpdf-consent', 'rejected');
      }, theme);
      for (const service of RESPONSIVE_SURFACES) {
        await page.goto(`/${service}`);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), service).toBe(true);
        expect(await page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === 'running').length), service).toBe(0);
        expect(await page.evaluate(() => {
          const parse = (value) => value.match(/[\d.]+/g).slice(0, 3).map(Number);
          const luminance = (rgb) => rgb.map((value) => {
            const channel = value / 255;
            return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
          }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
          const style = getComputedStyle(document.body);
          const foreground = luminance(parse(style.color));
          const background = luminance(parse(style.backgroundColor));
          return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
        }), `${service} body contrast`).toBeGreaterThanOrEqual(4.5);
        const contrastFailures = await page.evaluate(() => {
          const parse = (value) => {
            const values = value.match(/[\d.]+/g)?.map(Number) || [];
            return { rgb: values.slice(0, 3), alpha: values.length > 3 ? values[3] : 1 };
          };
          const luminance = (rgb) => rgb.map((value) => {
            const channel = value / 255;
            return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
          }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
          const background = (element) => {
            for (let current = element; current; current = current.parentElement) {
              const color = parse(getComputedStyle(current).backgroundColor);
              if (color.rgb.length === 3 && color.alpha > 0.99) return color.rgb;
            }
            return parse(getComputedStyle(document.body).backgroundColor).rgb;
          };
          const selectors = 'h1,h2,h3,p,span,a,button,label,legend,summary,th,td,strong,small,input,select';
          return [...document.querySelectorAll(selectors)].flatMap((element) => {
            const style = getComputedStyle(element);
            if (!element.getClientRects().length || style.visibility === 'hidden'
              || element.matches(':disabled,[aria-disabled="true"]') || Number(style.opacity) < 0.99) return [];
            const text = (element.value || element.textContent || '').trim();
            if (!text) return [];
            const foreground = parse(style.color).rgb;
            const behind = background(element);
            if (foreground.length !== 3 || behind.length !== 3) return [`${element.tagName}:unparsed-color`];
            const ratio = (Math.max(luminance(foreground), luminance(behind)) + 0.05)
              / (Math.min(luminance(foreground), luminance(behind)) + 0.05);
            const large = parseFloat(style.fontSize) >= 24
              || (parseFloat(style.fontSize) >= 18.66 && Number(style.fontWeight) >= 700);
            return ratio + 0.001 < (large ? 3 : 4.5)
              ? [`${element.tagName.toLowerCase()}#${element.id}.${element.className}:${ratio.toFixed(2)}`] : [];
          });
        });
        expect(contrastFailures, `${service} component contrast`).toEqual([]);
        await page.keyboard.press('Home');
        await page.keyboard.press('Tab');
        await expect(page.locator('.skip-link')).toBeFocused();
        await page.screenshot({ path: testInfo.outputPath(`${service || 'home'}-${width}-${theme}.png`), fullPage: true });
      }
    });
  }
}

test('requested initial first-party JavaScript graphs remain bounded and idle request counts stay explicit', async ({ page }) => {
  for (const route of ['/', '/merge', '/workflows', '/privacy-scan', '/document-doctor']) {
    const requests = [];
    const listener = (request) => requests.push(request.url());
    page.on('request', listener);
    await page.goto(route);
    await page.waitForLoadState('domcontentloaded');
    page.off('request', listener);
    expect(requests.length, `${route} idle request count`).toBeLessThanOrEqual(16);
    const graph = await page.evaluate(() => [...new Set(performance.getEntriesByType('resource')
      .map((entry) => new URL(entry.name))
      .filter((url) => url.origin === location.origin && url.pathname.startsWith('/js/') && url.pathname.endsWith('.js'))
      .map((url) => url.pathname))]);
    const bytes = graph.reduce((sum, pathname) => sum + statSync(path.join(PUBLIC, pathname)).size, 0);
    expect(bytes, `${route} requested initial JS graph (${graph.join(', ')})`).toBeLessThan(100_000);
    if (route === '/document-doctor') {
      expect(graph).not.toContain('/js/core/document-doctor.js');
      expect(graph).not.toContain('/js/core/document-doctor-output.js');
    }
  }
});

test('new service primary keyboard flows activate real controls and operations', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('bpdf-consent', 'rejected'));
  for (const service of SERVICES) {
    await page.goto(`/${service}`);
    const dropzone = page.locator(service === 'workflows' ? '#workflowDropzone' : '#dropzone');
    await dropzone.focus();
    const chooser = page.waitForEvent('filechooser');
    await page.keyboard.press(service === 'privacy-scan' ? 'Space' : 'Enter');
    await chooser;
    const input = service === 'workflows' ? '#workflowFileInput' : '#fileInput';
    await page.setInputFiles(input, path.join(FIXTURES, 'appendix.pdf'));
    if (service === 'workflows') {
      await expect(page.locator('#queueBody tr')).toHaveCount(1);
      await page.locator('#clearWorkflowBtn').focus();
      await page.keyboard.press('Enter');
      await expect(page.locator('#queueBody')).toContainText('No PDFs added yet');
    } else {
      const action = page.locator(service === 'privacy-scan' ? '#scanBtn' : '#diagnoseBtn');
      await expect(action).toBeEnabled();
      await action.focus();
      await page.keyboard.press('Enter');
      await expect(page.locator(service === 'privacy-scan' ? '#scanResults' : '#doctorResults')).toBeVisible();
    }
  }
});

test('Phase 9 translation migration is idempotent', async () => {
  const { execFileSync } = await import('node:child_process');
  expect(() => execFileSync('python3', ['scripts/update-phase9-translations.py', '--check'], { cwd: ROOT })).not.toThrow();
});
