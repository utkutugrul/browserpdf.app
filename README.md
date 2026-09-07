<p align="center"><img src="public/logo.png" width="88" height="88" alt="BrowserPDF logo"></p>

# BrowserPDF

BrowserPDF is a source-available, browser-based document platform with 29 PDF and Markdown tools, three guided services, 22 languages, progressive WebMCP integration, a private browser ESM SDK, and a deliberately limited offline shell.

Selected document bytes are processed locally in the browser. The production Worker serves the application shell, security headers, localized routes, optional consent-gated analytics, and the IndexNow ownership file; it does not expose a file-processing upload endpoint. Some tools fetch pinned third-party runtime dependencies and language/model assets, so “local processing” does not mean that every supporting request is offline.

Free for personal, educational, and non-commercial use. Commercial use requires prior permission; see [LICENSE.md](LICENSE.md).

## Platform services

- **PDF Workflows** (`/workflows`): reviewed multi-step recipes, a concurrency-one local queue, cancel/retry, deterministic names, ZIP output, and resumable BrowserPDF-owned IndexedDB records. Passwords are never persisted.
- **Privacy Scan** (`/privacy-scan`): bounded detection of metadata, attachments, actions, forms, permissions, JavaScript signals, invisible text modes, and potential sensitive-text patterns. Cleanup is intentionally limited to verified standard metadata removal.
- **Document Doctor** (`/document-doctor`): quick/deep diagnostics, accessibility-readiness signals, structure normalization, and an explicitly lossy page-content rebuild.

These services report detectable signals, not certifications or guarantees. Privacy Scan is not malware, steganography, OCR-pixel, or cryptographic-signature validation. Document Doctor does not certify PDF/A, PDF/UA, WCAG compliance, repair completeness, or signature validity.

## Tool catalog

The 29-tool catalog includes merge, split, organize, rotate, delete pages, crop, compress, watermark, page numbers, protect/unlock, fill and sign, redact, highlight, add text/image, edit metadata, view PDF, OCR, extract text, PDF-to-Markdown/Word/Excel/images, Word/Excel/JPG/Markdown-to-PDF, Markdown Viewer, and image export/import.

Tool-specific limitations are displayed before processing. Notable examples:

- Compression rasterizes pages and removes searchable/selectable text.
- OCR creates a searchable text layer but recognition remains probabilistic.
- PDF-to-Markdown layout detection is heuristic.
- Rebuilding content in Document Doctor produces image-only pages and can discard interactive/document structures.
- Any rewrite of a signed PDF can invalidate its signature.

## Privacy and security model

- User-selected files stay in page memory or BrowserPDF-owned IndexedDB records used for an explicit workflow.
- Workflow records have scoped ownership and expiry cleanup; unrelated databases and records are preserved.
- New outputs are created instead of overwriting originals.
- Merge, Workflow, Privacy Scan, and Document Doctor tests intercept outbound requests and reject filenames, raw sensitive text, and input-byte fingerprints.
- Consent changes analytics storage only; advertising storage categories remain denied.
- The Worker applies per-response CSP nonces, `no-store` HTML, COOP/CORP, frame protection, referrer policy, and `Permissions-Policy: tools=(self)`.
- Pinned pdf.js, Tesseract.js, pdf-lib, and Cantoo entry assets are integrity checked before execution. Transitive PDF.js/Tesseract fonts, CMaps, WASM, and traineddata remain documented dependency boundaries.

See [docs/platform-architecture.md](docs/platform-architecture.md) and [docs/final-verification-matrix.md](docs/final-verification-matrix.md) for the exact architecture and evidence.

## WebMCP

WebMCP is a progressive enhancement based on the current W3C Community Group draft. BrowserPDF uses `document.modelContext` only when available.

- The homepage exposes two bounded discovery/navigation tools.
- Merge exposes only actions relevant to its current selected-file state.
- Workflow, Privacy Scan, and Document Doctor expose small, state-dependent tool sets.
- Results contain bounded metadata only—never document bytes, Blob URLs, raw extracted text, or local paths.
- File selection and downloads remain visible user actions.

Browsers without WebMCP retain the normal UI without console errors.

## PWA and offline behavior

The service worker caches an allowlisted same-origin static shell only. It does not cache nonce-bearing HTML, metrics, user files, downloads, Blob/Data URLs, cross-origin responses, query variants, or non-GET requests.

Offline navigation shows a dedicated fixed-CSP fallback document. The 29 processing tools are explicitly marked unavailable offline until each complete dependency set—PDF.js/Tesseract workers, fonts, CMaps, WASM, and language data—has been vendored and passed a real offline artifact test. See [docs/offline-vendoring-matrix.md](docs/offline-vendoring-matrix.md).

Updates wait for a visible user action. Removing offline data disables the active BrowserPDF cache lifecycle before unregistering and deletes only `bpdf-*` caches.

## Browser ESM SDK

The private package under `sdk/` exports versioned, DOM-free APIs:

- `mergeV1`
- `inspectV1`
- `diagnoseV1`
- `normalizeV1`

Inputs are `Blob | ArrayBuffer | Uint8Array`; APIs support `AbortSignal`, structured progress, owned byte copies, and locally served exact-version PDF.js worker/assets. The package has no site-shell, analytics, WebMCP, DOM-query, or runtime-CDN side effects.

```bash
npm --prefix sdk install
npm --prefix sdk test
```

The SDK is private and has not been published. Only Chromium is currently claimed and tested; consumers must follow [sdk/README.md](sdk/README.md) for peer dependencies and asset paths.

## Run locally

Use Wrangler for production-equivalent clean routes, localized Worker rewriting, CSP, and service-worker behavior:

```bash
npm install
npx playwright install chromium
npx wrangler dev
```

Opening files through `file://` is unsupported because workers, WebAssembly, service workers, and `crypto.subtle` require an HTTP secure context. A generic static server can display many pages, but it will not reproduce Worker-owned routing and headers.

## Tests

The Playwright suite exercises real browser operations and validates the produced artifacts rather than checking only for visible buttons.

```bash
npm test
npm run test:headed
npm run test:report
```

Current release gate:

- 121 Chromium tests
- SDK build/type/unit and package allowlist tests
- Real WebMCPTesting/CDP discovery and invocation
- PWA service-worker allowed/blocked lifecycle tests
- Real OCR, encrypted PDF, workflow, privacy-cleanup, normalize, and rebuild artifacts
- 320/390/768/1440 layouts in light/dark themes
- 22 localized routes, Arabic RTL, sitemap, metadata, Open Graph, Twitter, and JSON-LD checks
- Race tests for imports, cancellation, stale results, IndexedDB cleanup, and service-worker updates

Fixtures are generated into `test-fixtures/generated/`. The OCR fixture uses `@napi-rs/canvas` as a development-only dependency; production processing remains browser-native.

## Deployment and IndexNow

Pushes to `main` run `.github/workflows/deploy.yml`, which deploys `worker.js` and `public/` to Cloudflare Workers. `www.browserpdf.app` redirects to the apex domain.

The workflow also:

1. syncs the GitHub `INDEXNOW_KEY` secret into the Worker;
2. keeps ownership proof available at `/<key>.txt`;
3. validates every canonical URL in `public/sitemap.xml`; and
4. submits the complete canonical URL list to IndexNow after a successful deploy.

Manual validation without sending:

```bash
INDEXNOW_KEY=<current-key> node scripts/submit-indexnow.mjs --dry-run
```

`robots.txt` advertises `https://browserpdf.app/sitemap.xml` and explicitly permits common search and AI crawlers. `llms.txt` provides a bounded machine-readable overview.

## Repository layout

```text
public/                         deployed static assets and pages
  js/core/                     DOM-free processing cores
  workflows.html              local workflows and batch queue
  privacy-scan.html            bounded privacy inspection
  document-doctor.html         diagnostics and verified transforms
  sw.js, offline.html          static-shell PWA foundation
worker.js                      routing, localization, CSP and headers
sdk/                           private browser ESM package
scripts/                       idempotent migrations and maintenance tools
tests/                         Playwright artifact, race and policy tests
docs/                          architecture, offline and release evidence
.github/workflows/deploy.yml   Cloudflare deploy and IndexNow notification
```

## Internationalization

English is the default route; 21 additional dictionaries produce 22 language routes. The Worker localizes server-rendered title, description, Open Graph, Twitter, JSON-LD, canonical, and breadcrumb fields. Client-side i18n handles page content and internal links. Arabic uses RTL layout.

Translation migrations under `scripts/update-phase*-translations.py` are idempotent and are checked by the test suite.

## Legal

BrowserPDF is source-available, not OSI open source. The included privacy, terms, accessibility, and license documents are good-faith project documents and are not a substitute for professional legal advice.

- Contact: `info@browserpdf.app`
- Security reports: [SECURITY.md](SECURITY.md)
