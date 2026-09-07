import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const FIXTURES = path.resolve(import.meta.dirname, '../test-fixtures/generated');
const PUBLIC = path.resolve(import.meta.dirname, '../public');
const ROOT = path.resolve(import.meta.dirname, '..');
const DROPZONE_ARIA_KEYS = [
  'common.dropzone_aria',
  'excel-to-pdf.dropzone_aria',
  'images.dropzone_img_aria',
  'jpg-to-pdf.dropzone_aria',
  'markdown-to-pdf.dropzone_aria',
  'markdown-viewer.dropzone_aria',
  'merge.dropzone_aria',
  'word-to-pdf.dropzone_aria',
];
const CANONICAL_PRIVACY_KEYS = [
  'common.privacy_badge_title', 'common.privacy_note',
  'hub.about_1_body', 'hub.faq_2_a', 'hub.privacy_note',
  'merge.privacy_note',
  'add-image.about_3_body', 'add-text.about_3_body',
  'compress.about_3_body', 'crop.about_1_body', 'crop.about_2_body', 'crop.no_see',
  'delete-pages.about_1_body', 'delete-pages.about_2_body', 'delete-pages.no_see',
  'edit-metadata.about_3_body',
  'excel-to-pdf.about_1_body', 'excel-to-pdf.about_2_body', 'excel-to-pdf.no_see',
  'fill-sign.about_3_body', 'fill-sign.faq_3_a',
  'highlight.about_3_body',
  'images.about_3_body', 'images.privacy_note',
  'jpg-to-pdf.about_1_body', 'jpg-to-pdf.about_2_body', 'jpg-to-pdf.no_see',
  'markdown-to-pdf.about_3_body', 'markdown-to-pdf.privacy_note',
  'markdown-viewer.about_4_body', 'markdown-viewer.privacy_note',
  'organize.about_3_body', 'page-numbers.about_3_body',
  'pdf-to-excel.about_1_body', 'pdf-to-excel.about_2_body', 'pdf-to-excel.no_see',
  'pdf-to-word.about_2_body', 'protect.about_1_body', 'protect.faq_2_a',
  'redact.about_3_body', 'rotate.about_3_body', 'split.about_3_body',
  'unlock.about_1_body', 'unlock.faq_2_a',
  'view-pdf.about_3_body', 'view-pdf.faq_3_a',
  'word-to-pdf.about_1_body', 'word-to-pdf.about_2_body', 'word-to-pdf.no_see',
];
const PRIVACY_INTRO_KEYS = [
  'add-image.intro', 'add-text.intro', 'compress.intro', 'crop.intro',
  'delete-pages.intro', 'edit-metadata.intro', 'excel-to-pdf.intro',
  'extract-text.intro', 'fill-sign.intro', 'highlight.intro', 'images.intro',
  'jpg-to-pdf.intro', 'markdown-to-pdf.intro', 'markdown-viewer.intro',
  'merge.intro', 'ocr-pdf.intro', 'organize.intro', 'page-numbers.intro',
  'pdf-to-excel.intro', 'pdf-to-markdown.intro', 'pdf-to-word.intro',
  'protect.intro', 'redact.intro', 'rotate.intro', 'split.intro',
  'unlock.intro', 'view-pdf.intro', 'watermark.intro',
];
const CONTEXTUAL_PRIVACY_KEYS = [
  'add-text.faq_3_a', 'highlight.faq_3_a', 'ocr-pdf.callout',
  'pdf-to-excel.faq_2_a', 'view-pdf.faq_2_a',
];
const WORD_TO_PDF_INTRO = {
  es: 'Convierta un archivo .docx a PDF localmente en esta pestaña del navegador. BrowserPDF no tiene un punto de carga de archivos.',
  fr: 'Convertissez un fichier .docx en PDF localement dans cet onglet du navigateur. BrowserPDF n’a aucun point de téléversement de fichiers.',
  de: 'Konvertieren Sie eine .docx-Datei lokal in diesem Browser-Tab in PDF. BrowserPDF hat keinen Datei-Upload-Endpunkt.',
  pt: 'Converta um ficheiro .docx em PDF localmente neste separador do navegador. O BrowserPDF não tem um ponto de carregamento de ficheiros.',
  it: 'Converti un file .docx in PDF localmente in questa scheda del browser. BrowserPDF non ha un endpoint di caricamento file.',
  ru: 'Преобразуйте файл .docx в PDF локально в этой вкладке браузера. У BrowserPDF нет конечной точки загрузки файлов.',
  ja: '.docx ファイルをこのブラウザータブ内でローカルに PDF へ変換します。BrowserPDF にはファイルアップロード用エンドポイントがありません。',
  ko: '.docx 파일을 이 브라우저 탭에서 로컬로 PDF로 변환합니다. BrowserPDF에는 파일 업로드 엔드포인트가 없습니다.',
  zh: '在此浏览器标签页中本地将 .docx 文件转换为 PDF。BrowserPDF 没有文件上传端点。',
  'zh-TW': '在此瀏覽器分頁中於本機將 .docx 檔案轉換為 PDF。BrowserPDF 沒有檔案上傳端點。',
  ar: 'حوّل ملف .docx إلى PDF محليًا في علامة تبويب المتصفح هذه. لا يملك BrowserPDF نقطة نهاية لرفع الملفات.',
  hi: '.docx फ़ाइल को इस ब्राउज़र टैब में स्थानीय रूप से PDF में बदलें। BrowserPDF में फ़ाइल अपलोड एंडपॉइंट नहीं है।',
  tr: "Bir .docx dosyasını bu tarayıcı sekmesinde yerel olarak PDF'ye dönüştürün. BrowserPDF'de dosya yükleme uç noktası yoktur.",
  nl: 'Converteer een .docx-bestand lokaal in dit browsertabblad naar PDF. BrowserPDF heeft geen eindpunt voor bestandsuploads.',
  pl: 'Przekonwertuj plik .docx lokalnie w tej karcie przeglądarki do PDF. BrowserPDF nie ma punktu przesyłania plików.',
  id: 'Konversikan file .docx ke PDF secara lokal di tab browser ini. BrowserPDF tidak memiliki endpoint unggah file.',
  vi: 'Chuyển đổi tệp .docx sang PDF cục bộ trong thẻ trình duyệt này. BrowserPDF không có điểm cuối tải tệp lên.',
  th: 'แปลงไฟล์ .docx เป็น PDF ภายในแท็บเบราว์เซอร์นี้แบบในเครื่อง BrowserPDF ไม่มีปลายทางสำหรับอัปโหลดไฟล์',
  uk: 'Перетворіть файл .docx у PDF локально в цій вкладці браузера. BrowserPDF не має кінцевої точки завантаження файлів.',
  cs: 'Převeďte soubor .docx do PDF lokálně v této kartě prohlížeče. BrowserPDF nemá koncový bod pro nahrávání souborů.',
  sv: 'Konvertera en .docx-fil till PDF lokalt i den här webbläsarfliken. BrowserPDF har ingen slutpunkt för filuppladdning.',
};
const WORD_TO_PDF_DESCRIPTION = {
  es: 'Convierta un archivo .docx a PDF.',
  fr: 'Convertissez un fichier .docx en PDF.',
  de: 'Konvertieren Sie eine .docx-Datei in PDF.',
  pt: 'Converta um ficheiro .docx em PDF.',
  it: 'Converti un file .docx in PDF.',
  ru: 'Преобразуйте файл .docx в PDF.',
  ja: '.docx ファイルを PDF に変換します。',
  ko: '.docx 파일을 PDF로 변환합니다.',
  zh: '将 .docx 文件转换为 PDF。',
  'zh-TW': '將 .docx 檔案轉換為 PDF。',
  ar: 'حوّل ملف .docx إلى PDF.',
  hi: '.docx फ़ाइल को PDF में बदलें।',
  tr: "Bir .docx dosyasını PDF'ye dönüştürün.",
  nl: 'Converteer een .docx-bestand naar PDF.',
  pl: 'Przekonwertuj plik .docx do PDF.',
  id: 'Konversikan file .docx ke PDF.',
  vi: 'Chuyển đổi tệp .docx sang PDF.',
  th: 'แปลงไฟล์ .docx เป็น PDF',
  uk: 'Перетворіть файл .docx у PDF.',
  cs: 'Převeďte soubor .docx do PDF.',
  sv: 'Konvertera en .docx-fil till PDF.',
};
const JPG_TO_PDF_FAQ = {
  es: 'Las imágenes se incrustan en el PDF localmente en esta pestaña del navegador. BrowserPDF no tiene un punto de carga de archivos.',
  fr: 'Les images sont intégrées au PDF localement dans cet onglet du navigateur. BrowserPDF n’a aucun point de téléversement de fichiers.',
  de: 'Die Bilder werden lokal in diesem Browser-Tab in das PDF eingebettet. BrowserPDF hat keinen Datei-Upload-Endpunkt.',
  pt: 'As imagens são incorporadas no PDF localmente neste separador do navegador. O BrowserPDF não tem um ponto de carregamento de ficheiros.',
  it: 'Le immagini vengono incorporate nel PDF localmente in questa scheda del browser. BrowserPDF non ha un endpoint di caricamento file.',
  ru: 'Изображения встраиваются в PDF локально в этой вкладке браузера. У BrowserPDF нет конечной точки загрузки файлов.',
  ja: '画像はこのブラウザータブ内でローカルに PDF へ埋め込まれます。BrowserPDF にはファイルアップロード用エンドポイントがありません。',
  ko: '이미지는 이 브라우저 탭에서 로컬로 PDF에 삽입됩니다. BrowserPDF에는 파일 업로드 엔드포인트가 없습니다.',
  zh: '图片在此浏览器标签页中本地嵌入 PDF。BrowserPDF 没有文件上传端点。',
  'zh-TW': '圖片在此瀏覽器分頁中於本機嵌入 PDF。BrowserPDF 沒有檔案上傳端點。',
  ar: 'تُضمَّن الصور في ملف PDF محليًا داخل علامة تبويب المتصفح هذه. لا يملك BrowserPDF نقطة نهاية لرفع الملفات.',
  hi: 'छवियों को इस ब्राउज़र टैब में स्थानीय रूप से PDF में एम्बेड किया जाता है। BrowserPDF में फ़ाइल अपलोड एंडपॉइंट नहीं है।',
  tr: "Görseller bu tarayıcı sekmesinde yerel olarak PDF'ye gömülür. BrowserPDF'de dosya yükleme uç noktası yoktur.",
  nl: 'Afbeeldingen worden lokaal in dit browsertabblad in de PDF ingesloten. BrowserPDF heeft geen eindpunt voor bestandsuploads.',
  pl: 'Obrazy są osadzane w PDF lokalnie w tej karcie przeglądarki. BrowserPDF nie ma punktu przesyłania plików.',
  id: 'Gambar disematkan ke PDF secara lokal di tab browser ini. BrowserPDF tidak memiliki endpoint unggah file.',
  vi: 'Ảnh được nhúng vào PDF cục bộ trong thẻ trình duyệt này. BrowserPDF không có điểm cuối tải tệp lên.',
  th: 'รูปภาพถูกฝังลงใน PDF ภายในแท็บเบราว์เซอร์นี้แบบในเครื่อง BrowserPDF ไม่มีปลายทางสำหรับอัปโหลดไฟล์',
  uk: 'Зображення вбудовуються в PDF локально в цій вкладці браузера. BrowserPDF не має кінцевої точки завантаження файлів.',
  cs: 'Obrázky se vkládají do PDF lokálně v této kartě prohlížeče. BrowserPDF nemá koncový bod pro nahrávání souborů.',
  sv: 'Bilder bäddas in i PDF-filen lokalt i den här webbläsarfliken. BrowserPDF har ingen slutpunkt för filuppladdning.',
};

function walkFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(target) : [target];
  });
}

async function freshVisit(page, route = '/') {
  await page.addInitScript(() => localStorage.removeItem('bpdf-consent'));
  await page.goto(route);
}

test('every public page with main has one shared skip target and valid JSON-LD', async ({ request }) => {
  const pages = readdirSync(PUBLIC).filter((name) => name.endsWith('.html')).sort();
  // The Phase 8 offline document is an intentionally script-free, nonce-free
  // connection fallback rather than a normal site-shell page.
  const pagesWithMain = pages.filter((name) => name !== 'offline.html'
    && readFileSync(path.join(PUBLIC, name), 'utf8').includes('<main'));
  // Phases 4–6 add workflow, privacy-scan, and Document Doctor service pages.
  expect(pagesWithMain).toHaveLength(36);

  const translations = JSON.parse(readFileSync(path.join(PUBLIC, 'translations.json'), 'utf8'));
  expect(Object.keys(translations)).toHaveLength(21);
  for (const [language, dictionary] of Object.entries(translations)) {
    expect(dictionary['common.skip_to_main'], `${language} skip-link translation`).toBeTruthy();
    const privacyClause = dictionary['common.privacy_note'];
    expect(privacyClause, `${language} shared privacy copy`).toBeTruthy();
    for (const key of CANONICAL_PRIVACY_KEYS) {
      expect(dictionary[key], `${language} canonical ${key}`).toBe(privacyClause);
    }
    for (const key of [...PRIVACY_INTRO_KEYS, ...CONTEXTUAL_PRIVACY_KEYS]) {
      expect(
        dictionary[key]?.endsWith(privacyClause),
        `${language} approved privacy suffix for ${key}`,
      ).toBe(true);
    }
    const selectionCopy = dictionary['common.dropzone_aria'];
    expect(selectionCopy, `${language} device selection copy`).toBeTruthy();
    for (const key of DROPZONE_ARIA_KEYS) {
      expect(dictionary[key], `${language} ${key}`).toBe(selectionCopy);
    }
    expect(dictionary['word-to-pdf.intro'], `${language} word-to-pdf.intro`)
      .toBe(WORD_TO_PDF_INTRO[language]);
    expect(dictionary['word-to-pdf.faq_2_a'], `${language} word-to-pdf.faq_2_a`)
      .toBe(WORD_TO_PDF_INTRO[language]);
    expect(dictionary['hub.tool_word_to_pdf_desc'], `${language} word tool description`)
      .toBe(WORD_TO_PDF_DESCRIPTION[language]);
    expect(dictionary['jpg-to-pdf.faq_2_a'], `${language} jpg-to-pdf privacy answer`)
      .toBe(JPG_TO_PDF_FAQ[language]);
  }

  for (const name of pagesWithMain) {
    const html = readFileSync(path.join(PUBLIC, name), 'utf8');
    expect(html.match(/class="skip-link"/g) || [], `${name} skip links`).toHaveLength(1);
    expect(html.match(/<main[^>]*id="main-content"[^>]*>/g) || [], `${name} main target`).toHaveLength(1);
    expect(html.match(/id="main-content"/g) || [], `${name} duplicate main IDs`).toHaveLength(1);
    for (const match of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      expect(() => JSON.parse(match[1]), `${name} JSON-LD`).not.toThrow();
    }

    const route = name === 'index.html' ? '/' : `/${name.slice(0, -5)}`;
    expect((await request.get(route)).ok(), `${route} should load`).toBe(true);
  }
});

test('Phase 1 migrations report a clean idempotent state', () => {
  for (const script of [
    'scripts/update-phase1-public-html.py',
    'scripts/update-phase1-translations.py',
  ]) {
    expect(() => execFileSync('python3', [script, '--check'], { cwd: ROOT }))
      .not.toThrow();
  }
});

test('public user-facing sources contain no legacy absolute privacy claims', () => {
  const extensions = new Set(['.html', '.json', '.js', '.txt']);
  const patterns = [
    /\bno backend\b/i,
    /\bno server\b/i,
    /\bno upload endpoint\b/i,
    /nothing is uploaded/i,
    /nothing ever uploaded/i,
    /nothing leaves (?:this|your|the) (?:tab|browser)/i,
    /no file is ever uploaded/i,
    /files? (?:are|is) not uploaded/i,
    /we never receive/i,
    /analytics never receives/i,
    /\bnever (?:leave|leaves|sent|transmitted)\b/i,
    /everything (?:runs|happens)/i,
    /runs entirely in/i,
    /runs entirely on/i,
    /entirely client-side/i,
    /(?:happens|happen|rendered) entirely (?:in|on)/i,
    /processed entirely/i,
    /\bno upload(?:[,. ]|$)/i,
    /\bno file upload\b/i,
    /100% client-side/i,
    /100% in your browser/i,
    /browser tab tab/i,
    /only with your consent/i,
  ];
  const offenders = [];

  for (const file of walkFiles(PUBLIC).sort()) {
    if (!extensions.has(path.extname(file))) continue;
    const name = path.relative(PUBLIC, file);
    const text = readFileSync(file, 'utf8');
    for (const pattern of patterns) {
      if (pattern.test(text)) offenders.push(`${name}: ${pattern}`);
    }
  }
  expect(offenders).toEqual([]);
});

test('consent grants analytics only and preferences can be reopened', async ({ page }) => {
  await freshVisit(page);
  const banner = page.locator('#consent-banner');
  const accept = page.locator('#consent-accept');
  const reject = page.locator('#consent-reject');

  await expect(banner).toBeVisible();
  await expect(banner).toHaveAttribute('role', 'region');
  await expect(accept).toHaveClass(/btn-secondary/);
  await expect(reject).toHaveClass(/btn-secondary/);
  await accept.click();

  const acceptedUpdate = await page.evaluate(() => {
    const update = window.dataLayer.findLast((entry) => entry[0] === 'consent' && entry[1] === 'update');
    return update && update[2];
  });
  expect(acceptedUpdate).toEqual({
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'granted',
  });

  const manage = page.locator('#consent-manage');
  await manage.click();
  await expect(banner).toBeVisible();
  await expect(reject).toBeFocused();
  await reject.click();
  await expect(manage).toBeFocused();

  const rejectedUpdate = await page.evaluate(() => {
    const updates = window.dataLayer.filter((entry) => entry[0] === 'consent' && entry[1] === 'update');
    return updates.at(-1)[2];
  });
  expect(rejectedUpdate).toEqual({
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
  });
});

for (const width of [320, 480]) {
  test(`mobile consent is non-modal and does not cover the primary action at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 720 });
    await freshVisit(page, '/merge');
    const banner = page.locator('#consent-banner');
    const dropzone = page.locator('#dropzone');
    await expect(banner).toBeVisible();

    const layout = await page.evaluate(() => {
      const banner = document.getElementById('consent-banner');
      const action = document.getElementById('dropzone');
      const b = banner.getBoundingClientRect();
      const a = action.getBoundingClientRect();
      return {
        position: getComputedStyle(banner).position,
        overlap: !(b.right <= a.left || b.left >= a.right || b.bottom <= a.top || b.top >= a.bottom),
      };
    });
    expect(layout.position).toBe('static');
    expect(layout.overlap).toBe(false);
    await expect(dropzone).toBeVisible();
  });
}

test('skip link, visible header focus, and no-results recovery work from the keyboard', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('bpdf-consent', 'rejected'));
  await page.goto('/');

  await page.keyboard.press('Tab');
  await expect(page.locator('.skip-link')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();

  const theme = page.locator('#themeToggle');
  await theme.focus();
  expect(await theme.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');

  const filter = page.locator('#toolFilter');
  await filter.fill('definitely-no-such-tool');
  await expect(page.locator('#noResults')).toBeVisible();
  await expect(page.locator('#noResultsText')).toContainText('No tools match');
  await page.locator('#clearFilterBtn').click();
  await expect(filter).toBeFocused();
  await expect(filter).toHaveValue('');
  await expect(page.locator('#noResults')).toBeHidden();
  await expect(page.locator('.tool-card').first()).toBeVisible();
});

test('merge exposes numeric progress and keeps completion status visible', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('bpdf-consent', 'rejected'));
  await page.goto('/merge');
  await page.setInputFiles('#fileInput', [
    path.join(FIXTURES, 'report.pdf'),
    path.join(FIXTURES, 'appendix.pdf'),
  ]);
  await expect(page.locator('#mergeBtn')).toBeEnabled();

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#mergeBtn').focus();
  await page.keyboard.press('Enter');
  await downloadPromise;
  await expect(page.locator('#successSection')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#progressTrack')).toHaveAttribute('aria-valuenow', '100');
  await page.waitForTimeout(1600);
  await expect(page.locator('#successSection')).toBeVisible();
});

for (const change of ['select another file', 'clear the list']) {
  test(`merge cancels delayed success when users ${change}`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('bpdf-consent', 'rejected'));
    await page.goto('/merge');
    await page.setInputFiles('#fileInput', [
      path.join(FIXTURES, 'report.pdf'),
      path.join(FIXTURES, 'appendix.pdf'),
    ]);

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#mergeBtn').click();
    await downloadPromise;
    if (change === 'select another file') {
      await page.setInputFiles('#fileInput', path.join(FIXTURES, 'appendix.pdf'));
    } else {
      await page.locator('#clearBtn').click();
    }

    await page.waitForTimeout(1500);
    await expect(page.locator('#successSection')).toBeHidden();
  });
}

test('text input placeholder meets AA contrast in both themes', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('bpdf-consent', 'rejected'));
  await page.goto('/');

  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => document.documentElement.setAttribute('data-theme', value), theme);
    const ratio = await page.locator('#toolFilter').evaluate((el) => {
      const parse = (color) => color.match(/[\d.]+/g).slice(0, 3).map(Number);
      const luminance = (rgb) => {
        const linear = rgb.map((value) => {
          const channel = value / 255;
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
      };
      const style = getComputedStyle(el);
      const foreground = luminance(parse(getComputedStyle(el, '::placeholder').color));
      const background = luminance(parse(style.backgroundColor));
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    });
    expect(ratio, `${theme} placeholder contrast`).toBeGreaterThanOrEqual(4.5);
  }
});
