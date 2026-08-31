<p align="center"><img src="public/logo.png" width="88" height="88" alt="BrowserPDF logo"></p>

# BrowserPDF

A free, client-side suite of twenty-nine PDF and Markdown tools. Everything runs in the browser tab: nothing is uploaded anywhere, and there are no watermarks or usage limits. Available in 22 languages.

Free for personal, educational, and non-commercial use. Commercial use requires contacting us first, see [LICENSE.md](LICENSE.md).

Vibe coded.

- **PDF to Markdown** (`pdf-to-markdown.html`): text-based PDFs are parsed directly; scanned pages fall back to in-browser OCR.
- **Merge** (`merge.html`): combine multiple PDFs into one, in a chosen order.
- **Split** (`split.html`): extract selected pages into a new PDF, or split every page into its own file.
- **Markdown Viewer** (`markdown-viewer.html`): live-rendered preview of pasted or dropped Markdown.
- **Compress** (`compress.html`): shrink file size by re-rendering pages as compressed images.
- **PDF ⇄ Images** (`images.html`): export pages as PNGs, or build a PDF from images.
- **Markdown to PDF** (`markdown-to-pdf.html`): lay out Markdown onto paginated PDF pages.
- **Fill & Sign** (`fill-sign.html`): fill detected form fields and add a drawn or typed signature.
- **PDF to Word** (`pdf-to-word.html`): convert to an editable .docx (headings, lists, emphasis preserved).
- **Extract Text** (`extract-text.html`): pull all text out as plain .txt, with OCR fallback.
- **Rotate** (`rotate.html`): rotate individual pages or the whole document.
- **Organize** (`organize.html`): reorder, rotate, and delete pages in one view.
- **Add Page Numbers** (`page-numbers.html`): stamp page numbers (position, format, start value).
- **Add Watermark** (`watermark.html`): stamp a text watermark across every page.
- **Make Searchable (OCR)** (`ocr-pdf.html`): add an invisible OCR text layer to scanned PDFs.
- **Unlock PDF** (`unlock.html`): remove password protection from a PDF (requires the correct password).
- **Protect PDF** (`protect.html`): add password encryption and configurable permissions to a PDF.
- **Crop** (`crop.html`): trim margins from every page with a live, rotation-aware preview.
- **Delete Pages** (`delete-pages.html`): mark pages to remove from a thumbnail grid and download the rest.
- **Word to PDF** (`word-to-pdf.html`): convert a .docx to a paginated PDF via the same Markdown layout engine as Markdown to PDF.
- **Excel to PDF** (`excel-to-pdf.html`): lay out a spreadsheet's cells onto PDF pages, sheet by sheet.
- **PDF to Excel** (`pdf-to-excel.html`): cluster extracted text into rows/columns and write an .xlsx.
- **JPG to PDF** (`jpg-to-pdf.html`): combine reorderable JPG/PNG images into one PDF.
- **Add Text** (`add-text.html`): place typed text anywhere on a page, with font, size, and colour controls.
- **Add Image** (`add-image.html`): drop an image onto a page and position it.
- **Highlight** (`highlight.html`): draw translucent highlight rectangles over a page.
- **Redact** (`redact.html`): black out regions of a page; pages with a box are rebuilt as flat images so the covered content is removed from the file, not just hidden.
- **Edit Metadata** (`edit-metadata.html`): read and rewrite title, author, subject, keywords, creator, and producer.
- **PDF Viewer** (`view-pdf.html`): read a PDF with page navigation, zoom, fit-to-width, and printing.

## Running it

Browsers restrict Web Workers, WebAssembly, and `crypto.subtle` on pages opened directly via `file://`. Serve the folder over HTTP instead:

```bash
cd path/to/browserpdf
npx serve public -p 8000
# then open http://localhost:8000
```

Internal links use extension-less clean URLs (`/merge`, not `/merge.html`) to match how Cloudflare Workers serves the site, so pick a static server that resolves those: `npx serve` does (clean URLs on by default), `npx wrangler dev` matches production exactly, but `python3 -m http.server` will 404 on navigation. `localhost` is treated as a secure context, so clipboard copy and the integrity checks below work normally.

## Deploying

Deployed via Cloudflare Workers static assets:

```bash
npx wrangler deploy
```

`wrangler.json` points the assets directory at `public/`, which is the whole deployed site and nothing else: config, tests, scripts and `worker.js` live outside it, so a new dev file cannot accidentally become a public URL. It also configures the `browserpdf.app` / `www.browserpdf.app` custom domain routes, and a small `worker.js` (run before assets) that 301-redirects the www host to the apex so search engines see one canonical host.

That boundary is load-bearing, not tidiness: Wrangler uploads everything under the assets directory and serves it publicly, so when the site lived at the repo root, every non-site file had to be listed in `.assetsignore` by hand or it became a URL (`.git/config` included). With the site in `public/`, the only `.assetsignore` entry left is `.DS_Store`. If you ever move a dev-only file into `public/`, it is published.

## Tests

Smoke tests drive the real tool pages in a headless browser: each one loads a generated fixture, runs the tool's primary action, and asserts a real output file comes back. They exist because a broken minified-class-name check silently disabled all form filling in Fill & Sign for weeks without any static review catching it, and the same first run also caught Edit Metadata throwing on apply, Protect never actually encrypting, and Unlock returning a still-encrypted file.

```bash
npm install
npx playwright install chromium
npm test              # boots `wrangler dev` on :8788 automatically
npm run test:headed   # watch it drive the UI
```

Fixtures are generated by `tests/make-fixtures.mjs` (via pdf-lib) into `test-fixtures/generated/`, so nothing binary is committed. The tests need network access: every tool fetches its PDF library from jsDelivr at runtime.

The same suite can verify a deployed environment:

```bash
BASE_URL=https://browserpdf.app npm test
```

Remote runs go serial with retries on purpose. Each test opens a fresh browser context that re-fetches the pinned libraries, and running them in parallel from one IP gets those fetches throttled, which shows up as a random tool timing out; the same test passes on its own every time.

Not covered yet: `ocr-pdf` is minutes-slow to run end to end. Everything else is covered, including the pointer-placement tools (raw mouse events on the placement canvas) and `excel-to-pdf` / `word-to-pdf`, which get minimal generated `.xlsx` / `.docx` fixtures.

## How each tool works

- **PDF to Markdown**: [pdf.js](https://mozilla.github.io/pdf.js/) extracts each page's text items with position and font metadata, clusters them into lines, infers headings from font-size ratios, and detects bullet/numbered lists and bold/italic. Pages with very little extractable text are treated as scanned and OCR'd via [Tesseract.js](https://github.com/naptha/tesseract.js) (14 languages selectable).
- **Merge**: reads each file's page count via [pdf-lib](https://pdf-lib.js.org/), lets you reorder with up/down controls, then copies pages from each source into one output document.
- **Split**: renders a thumbnail grid with pdf.js. "Extract pages" copies selected pages into one new PDF; "Split into files" creates a one-page PDF per page, bundled into a single ZIP.
- **Markdown Viewer**: renders Markdown live as you type, using the same safe DOM-based renderer as the PDF to Markdown preview pane (`md-render.js`).
- **Compress**: re-renders each page via pdf.js at a resolution tied to the chosen level, re-encodes it as a JPEG, and rebuilds a PDF with pdf-lib at the original page size. A real tradeoff (searchable text becomes an image), not lossless compression; the UI says so.
- **PDF ⇄ Images**: pdf.js renders selected pages to PNG for export; for the reverse direction, images are embedded via pdf-lib (`embedJpg`/`embedPng`, with a canvas-based PNG fallback for other formats) onto pages sized to match each image's aspect ratio.
- **Markdown to PDF**: a small parser (independent of `md-render.js`, by design, see comments in `markdown-to-pdf.js`) turns Markdown into blocks, then a hand-rolled layout engine word-wraps and paginates them onto US Letter pages using pdf-lib's standard fonts.
- **Fill & Sign**: pdf-lib's `getForm()`/`getFields()` detect AcroForm fields, shown as a plain list rather than a live page overlay (see "Known limitations" below for why). Signatures are drawn on a canvas or typed (rendered in the browser's generic `cursive` font), then placed by picking a page and clicking a point; a canvas-pixel-to-PDF-point coordinate conversion (with a Y-axis flip) burns the signature image in at that spot.

## Security notes

- **No upload, ever.** Files never leave the tab; there is no backend.
- **Pinned, hash-verified libraries.** pdf.js, Tesseract.js, and pdf-lib are loaded from jsDelivr at exact pinned versions, defined once in `lib-loader.js`. Before a library (or its first-hop worker script) is allowed to execute, the app fetches it, computes a SHA-384 digest client-side, and compares it against a hash baked into `lib-loader.js`. A mismatch throws instead of silently loading.
- **Known boundary:** Tesseract's own WASM core and language traineddata, and pdf.js's standard-font/cmap/wasm assets, are not individually hash-verified; reproducing that would mean re-implementing part of each library's internal loader. Those fetches are still pinned to the same immutable, versioned jsDelivr paths as everything else.
- **Google Analytics is opt-in and its ID is a secret, not a literal in the code.** `worker.js` reads `env.GTAG_MEASUREMENT_ID`; if it's unset, `gtagBootstrapScript()` returns an empty string and no analytics script is injected at all. Set it with `npx wrangler secret put GTAG_MEASUREMENT_ID` (a `G-XXXXXXXXXX` measurement ID from your own GA property). Deploying this repo as-is, without setting your own, sends no analytics anywhere, it will not report to the original project's GA property.
- **Strict CSP.** `worker.js` is the only CSP source (no per-page `<meta>` duplicate) and sends it as an HTTP header, with `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`, X-Frame-Options, Referrer-Policy, Permissions-Policy, and COOP alongside it. `script-src` is a hybrid: a fresh per-request nonce (applied to every `<script>` tag via HTMLRewriter) covers our own inline scripts, plus two fixed hashes for the inline init snippets `gtag.js` injects into `<head>` on its own. No `'unsafe-inline'`. `'strict-dynamic'` was tried and reverted: it blocks the same-origin `/metrics/` script the Google Tag Gateway loads dynamically, which cannot be nonced. Analytics hosts (`googletagmanager.com`, `google-analytics.com`, `cloudflareinsights.com`) are allowlisted in `script-src`/`connect-src`/`img-src`. No page uses inline `style=""` attributes (would need `'unsafe-inline'` in `style-src`, which isn't granted).
- **XSS-safe rendering.** Markdown previews are built by creating DOM nodes and assigning `textContent`; `innerHTML` is never used on extracted or user-supplied text.
- To regenerate a pinned hash after bumping a library version:
  ```bash
  curl -s "<file-url>" | openssl dgst -sha384 -binary | openssl base64 -A
  ```
  then update both the version and the hash in `lib-loader.js`.

## SEO / AI-crawler notes

- IndexNow is set up, but the key is **not** stored in this repo. It lives in a Worker secret and
  `worker.js` serves the `/<key>.txt` ownership file from it, so nothing has to be committed:
  ```bash
  # rotate or set the key (32 hex chars); the Worker starts serving /<key>.txt immediately
  python3 -c "import secrets; print(secrets.token_hex(16))" | npx wrangler secret put INDEXNOW_KEY
  ```
  To re-notify after significant content changes, substitute the current key:
  ```bash
  KEY=<the key you set>
  curl -X POST https://api.indexnow.org/indexnow -H "Content-Type: application/json" \
    -d "{\"host\":\"browserpdf.app\",\"key\":\"$KEY\",\"keyLocation\":\"https://browserpdf.app/$KEY.txt\",\"urlList\":[\"https://browserpdf.app/\"]}"
  ```

- `robots.txt` explicitly allows common AI crawlers (GPTBot, ClaudeBot, PerplexityBot, Google-Extended, CCBot, etc.).
- `llms.txt` gives AI agents a short, structured summary of the suite.
- JSON-LD structured data (`SoftwareApplication`) describing the whole suite lives on the hub page only, to keep per-page CSP simple.

## Known limitations

- **PDF to Markdown**: heading/list detection is heuristic and can misfire on unusual or multi-column layouts. Bold/italic detection depends on pdf.js reporting a recognizable font family name. OCR'd pages become plain paragraphs only.
- **Compress**: converts pages to images, so text is no longer selectable/searchable afterward. Not useful for already-small text-only PDFs (the UI reports this honestly instead of claiming a fake win).
- **Markdown to PDF**: supports headings, bold/italic/bold-italic, inline code, lists, horizontal rules, and paragraphs. No tables or images yet; unsupported syntax renders as plain text rather than breaking the layout.
- **Fill & Sign**: form fields are a plain list, not overlaid on the page in place. Signature placement is click-to-center, not drag-to-reposition or resize. The typed-signature font is the browser's generic `cursive` family, so its exact appearance varies by OS.

## Legal

- `privacy.html`, `terms.html`, `accessibility.html`, and `LICENSE.md` are good-faith drafts grounded in the site's actual architecture. They are not a substitute for review by an actual lawyer, especially before relying on them commercially or to enforce the license's commercial-use notice requirement.
- Contact: `info@browserpdf.app`. Governing law (`terms.html`) is set to Switzerland.
- Security issues: see [SECURITY.md](SECURITY.md).

## Files

The deployed site is `public/`; everything else is tooling.

```
public/           the site, exactly as served (assets directory)
  *.html          33 pages, flat at the root because clean URLs map here: /merge -> merge.html
  js/             every client module, including the shared ones below
  css/styles.css  visual design (light/dark, responsive, language switcher)
  og/             per-tool 1200x630 OG images
  translations.json, robots.txt, sitemap.xml, llms.txt, favicon/apple-touch-icon/logo
worker.js         runs before assets: www->apex redirect, security headers + CSP,
                  i18n routing, hreflang/canonical rewriting, consent banner injection,
                  and the IndexNow key file from a secret
wrangler.json     Cloudflare Workers config
scripts/          one-off maintenance scripts (OG images, translation merges,
                  sitemap and JSON-LD updates, CSP hash rebuild)
tests/            the smoke suite and its fixture generator
.github/workflows/deploy.yml   deploys on every push to main
```

Inside `public/js/`, each tool page has a matching module (`merge.html` -> `js/merge.js`), plus the shared ones:

- `lib-loader.js`: verified-library loading (pdf.js, Tesseract.js, pdf-lib, @cantoo/pdf-lib for encryption)
- `i18n.js`: internationalization engine (data-i18n attributes, language detection, link rewriting)
- `pdf-convert.js`: PDF-to-Markdown engine (used by PDF to Markdown, Extract Text, PDF to Word)
- `md-blocks.js`: Markdown block/inline parser (used by Markdown to PDF and PDF to Word)
- `md-render.js`: XSS-safe Markdown-to-DOM renderer (preview panes and the Markdown Viewer)
- `docx-writer.js`, `zip-writer.js`: dependency-free .docx and ZIP writers
- `tool-ui.js`: shared dropzone/progress/error scaffolding
- `consent.js`: cookie-consent banner logic (injected site-wide by the worker)
- `theme.js`: dark/light theme toggle

Pages stay flat in `public/` on purpose: Cloudflare Workers maps a URL to a file path inside the assets directory, so `/merge` requires `merge.html` to sit at that root. Localized URLs (`/tr/merge`) work because the worker strips the language prefix before touching assets, which also keeps the relative `js/` and `css/` paths in every page resolving correctly.

## Internationalization (i18n)

The site supports 22 languages: English (default) plus 21 translated languages. Language is detected from the URL path prefix (`/es/rotate`), then localStorage, then browser locale. The worker strips the language prefix and serves the underlying HTML file, then injects hreflang link tags and sets the `lang` (and `dir` for Arabic) attributes via HTMLRewriter. `i18n.js` fetches `translations.json`, applies translations to elements with `data-i18n` attributes, rewrites internal links to include the language prefix, and inserts a language switcher dropdown in the header.
