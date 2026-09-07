# BrowserPDF World-Class Platform Plan

## Objective

Turn BrowserPDF into a calm, premium, privacy-first document workspace while preserving its lightweight local-processing architecture. Ship the shared redesign, honest consent/copy, WebMCP progressive enhancement, smart workflows, batch processing, Privacy Scan, Document Doctor, offline/PWA foundation, and an embeddable browser ESM SDK.

The plan implements defensible MVPs for every requested service. It does not claim full PDF/A/PDF/UA certification, comprehensive PDF repair, complete hidden-content discovery, full cold-offline support for CDN-dependent tools, or WebMCP binary transport until those capabilities can be proven.

## Phase 0 — Allowed APIs and source contracts

### Repository contracts to copy

- Copy visual tokens/dark-mode/reduced-motion patterns from `public/css/styles.css:42-120`.
- Copy semantic task-state DOM contracts from `public/merge.html:86-137` and button/dropzone/file-list styles from `public/css/styles.css:310-371,553-696,1194-1300`.
- Copy shared UI helpers from `public/js/tool-ui.js`, but keep new compute cores DOM-free.
- Copy Merge’s verified page-copy algorithm from `public/js/merge.js:227-255` into a pure core function used by UI and adapters.
- Copy i18n patterns from `public/js/i18n.js:46-63,123-150`; update all 21 translated dictionaries, not only English fallbacks.
- Copy real artifact assertions and server setup from `tests/smoke.spec.mjs:18-43,126-185` and `playwright.config.mjs`.
- Keep CSP solely in `worker.js:70-112`; keep nonce-bearing HTML `no-store`.

### WebMCP allowed APIs

- Current draft: https://webmachinelearning.github.io/webmcp/ (4 September 2026).
- Use feature-detected `document.modelContext.registerTool(tool, { signal })` only.
- Tool shape: `name`, optional localized `title`, `description`, JSON Schema `inputSchema`, async `execute(input, { signal })`, and `annotations` containing only `readOnlyHint`, `untrustedContentHint`, `consequentialHint`.
- Use `AbortController` to own registration lifetime; there is no `unregisterTool()` or `updateTool()`.
- Keep input/output JSON-serializable and bounded. Operate only on user-selected page-local files.
- Test in Chromium with `--enable-features=WebMCPTesting` and CDP `WebMCP.enable`/`WebMCP.invokeTool`; use CDP only in tests.
- Make Worker policy explicit as `tools=(self)` after verifying header syntax in the bundled Chromium.

### PDF inspection/diagnostic APIs

- PDF.js 6.1.200 display APIs: `getMetadata`, `getAttachments`, `getJSActions`, `hasJSActions`, `getOpenAction`, `getFieldObjects`, `getPermissions`, `getMarkInfo`, page `getAnnotations`, `getJSActions`, `getTextContent`, `getOperatorList`, `getStructTree`.
- pdf-lib 1.17.1: load with `updateMetadata:false` for inspection; use `throwOnInvalidObject:true` for strict diagnosis; use `save()` only as “normalize/reserialize”, never generic repair.
- Use `AbortSignal.throwIfAborted()` between phases/pages; PDF.js loading tasks must be destroyed on abort. pdf-lib parse/save is not cooperatively cancellable.
- Post-transform outputs must reopen in both pdf-lib and PDF.js and render representative pages.

### PWA allowed APIs

- W3C Web App Manifest, `navigator.serviceWorker.register`, Service Worker lifecycle, Cache API, `navigator.storage.estimate/persist`.
- Cache only allowlisted same-origin static assets in the first stage. Do not cache nonce-bearing HTML, analytics, user files, PDF bytes, downloads, or Blob URLs.
- Use versioned `bpdf-*` caches and remove only BrowserPDF-owned obsolete versions.
- Test with Playwright `serviceWorkers:'allow'` and `browserContext.setOffline(true)`.

### SDK allowed boundary

- Browser ESM package accepting `Blob | ArrayBuffer | Uint8Array`.
- Pure functions return typed arrays or bounded structured reports; no DOM, download click, global mutation, WebMCP registration, analytics, or Worker shell code.
- Package exports must explicitly expose ESM and type declarations. Pin one matching PDF.js API/worker version and bundle or require it consistently.

### Global anti-patterns

- No framework, remote font, animation library, idle animation, or blanket caching.
- No “open source”, “no backend/server”, “fully safe”, “all hidden content found”, “repaired”, “PDF/A certified”, “PDF/UA/WCAG compliant”, “fully offline”, or “WebMCP compliant” claim beyond verified behavior.
- No WebMCP file/base64/blob/path transport, click simulation, global registration of all 29 tools, or undocumented APIs.
- No weakening CSP with `'unsafe-inline'`; no cached nonce-bearing HTML.
- No duplicated PDF algorithms across UI, WebMCP, batch, workflows, and SDK.

## Phase 1 — Trust, consent and accessibility baseline

### What to implement

1. Copy the accurate claims from the audit into visible copy, metadata and JSON-LD: “source-available”, “no file-processing backend or file-upload endpoint”, and “document processing happens in this tab”. Correct Merge “reorder pages” to “reorder files”.
2. Copy the existing consent wiring from `worker.js:130-132` and `public/js/consent.js:1-49` into an analytics-only contract: keep all advertising categories denied and toggle only `analytics_storage`.
3. Make consent a compact non-modal region with equal-weight Accept/Reject actions; remove dialog semantics, avoid focus capture, and ensure it never overlaps the primary action at 320–480 px.
4. Add a shared skip link, header `:focus-visible`, passing placeholder color, semantic progressbar values/live status, persistent success region, and homepage no-results recovery.
5. Add/update translation keys across all 21 dictionaries using an idempotent migration script for changed existing values.

### Documentation references

- Audit: `DESIGN-IS-2026-09-06/01-evidence.md`, especially honesty/accessibility.
- Existing injection: `worker.js:130-132,219-281`; existing consent: `public/js/consent.js:1-49`.
- Existing i18n API: `public/js/i18n.js:46-63,123-150`.

### Verification checklist

- Existing Playwright suite passes.
- New tests verify consent grants only analytics storage, choices have equal classes, mobile region does not overlap dropzone, no modal role/focus trap is implied, and preferences reopen correctly.
- Grep all public HTML/JSON/JS/translations for disproven absolute claims and “reorder pages” on Merge metadata.
- Keyboard test covers skip link, header controls, filter no-results recovery, Merge progress/success.
- Automated light/dark contrast check meets WCAG AA.

### Anti-pattern guards

- Do not edit consent markup in individual HTML files.
- Do not claim analytics code is absent before consent; describe denied storage accurately.
- Do not use translated HTML injection for untrusted text.

## Phase 2 — Shared visual system, home IA and Merge workspace

### What to implement

1. Copy existing semantic tokens into a smaller documented type/spacing scale and shared shell. Preserve one purple accent, native fonts, dark mode and reduced motion.
2. Build a new homepage structure: intent search, concise privacy proof, at most six “popular” tools, search result count/no-results, then progressively disclosed complete categories. Reuse the existing 29 slugs, i18n keys and SVG icons from `public/index.html:86-497`.
3. Build the representative Merge workspace around heading → proof → dropzone/selected files → primary action → persistent result. Keep supporting FAQ/technical proof below the task.
4. Copy shared states into `tool-ui.js` and move Merge’s DOM adapter onto those helpers without changing output behavior.
5. Add responsive screenshots at 1440, 768, 390 and 320 px in light/dark modes.

### Documentation references

- Preserve tokens: `public/css/styles.css:42-120`.
- Catalog sources: `public/index.html:86-497`.
- Merge state DOM: `public/merge.html:86-137`; logic: `public/js/merge.js:21-273`.
- Verdict: `DESIGN-IS-2026-09-06/03-verdict.md`.

### Verification checklist

- All 29 tools remain discoverable by keyboard and search; localized links remain extensionless.
- Initial home tab order is materially shorter before catalog expansion.
- No 320 px horizontal overflow or consent/task overlap.
- Merge smoke output is byte-nonempty and readable; reorder remains file-level.
- Initial JS remains under 100 KB per audited surface; idle animation count stays zero.

### Anti-pattern guards

- Do not reproduce the 29-card wall as the first screen.
- Do not add decorative gradients/motion or remote assets.
- Do not change processing algorithms in this phase.

## Phase 3 — Pure Merge core and WebMCP progressive enhancement

### What to implement

1. Copy Merge’s compute sequence into `public/js/core/merge-pdf.js` as a DOM-free `mergePdfFiles(items,{signal,onProgress})` function.
2. Add `public/js/webmcp.js` with feature detection and safe AbortController-owned registration.
3. Register two homepage tools: `find-document-tools` and `open-document-tool`.
4. Register only state-relevant Merge tools: `get-selected-files`, `set-file-order`, `remove-selected-file`, and `merge-selected-files`. Prepare results in page memory and expose a visible download control; return bounded metadata only.
5. Add `tools=(self)` to Permissions-Policy after a browser test proves the directive does not block same-origin registration.

### Documentation references

- WebMCP draft and official repo examples from Phase 0.
- Existing merge body: `public/js/merge.js:227-255`.
- Existing catalog/filter: `public/js/hub.js:1-19`, `public/index.html:86-497`.

### Verification checklist

- Default browser launch without WebMCP has no console errors and identical UI behavior.
- WebMCPTesting browser/CDP discovers exactly two home tools and the expected Merge tools for each state.
- Schemas reject unknown properties and cap query/name/order inputs.
- Abort cancels registration and long-running core work at cooperative boundaries.
- Tool results contain no bytes, base64, blob URLs, extracted document text, or local paths.
- UI and WebMCP use the same pure Merge core; normal download smoke still passes.

### Anti-pattern guards

- Do not use `navigator.modelContext`, `unregisterTool`, `updateTool`, `outputSchema`, MCP content blocks or declarative WebMCP.
- Do not auto-select local files or depend on transient activation for an automatic download.
- Do not register one tool per file or all 29 operations.

## Phase 4 — Smart workflows and local batch processing

### What to implement

1. Create a versioned workflow manifest with stable step IDs, accepted/produced MIME types, parameter schemas and explicit loss/privacy notes.
2. Replace the one-file/five-minute chaining record with a BrowserPDF-owned IndexedDB workflow store containing workflow ID, ordered steps, current step, page-local file references/bytes, timestamps and cleanup rules.
3. Add a workflow builder UI with starter recipes: compress → watermark → protect; organize → page numbers; privacy scan → metadata cleanup.
4. Add a local batch queue with bounded concurrency (default 1 for PDF-heavy work), per-file status, cancel/retry, deterministic names and ZIP output through the existing ZIP writer.
5. Expose only one bounded WebMCP workflow recommendation tool and current-page queue/status actions.

### Documentation references

- Existing chain store: `public/js/tool-ui.js:154-249`.
- Existing multi-file patterns: `public/js/merge.js`, `public/js/jpg-to-pdf.js`.
- Existing ZIP implementation: `public/js/zip-writer.js`.

### Verification checklist

- Workflow resumes after navigation and cleans expired records without deleting unrelated IndexedDB data.
- Partial failure preserves successful outputs and offers retry for failed files.
- Cancellation stops between files/steps and leaves a recoverable state.
- Recipe artifact tests verify real outputs for each starter workflow.
- Batch memory/concurrency controls and honest device-limit copy are visible.

### Anti-pattern guards

- Do not run unbounded parallel PDF operations.
- Do not silently apply lossy/destructive steps or overwrite originals.
- Do not register combinatorial WebMCP tools for files × operations.

## Phase 5 — Privacy Scan and cleanup

### What to implement

1. Copy the PDF.js inspection lifecycle into DOM-free core modules using owned byte copies and guaranteed task destruction.
2. Inspect Info/XMP presence, catalog/page attachments, annotations/URLs/actions, document/page JavaScript actions, forms/calculation order, permissions, encryption, and detectable invisible-text operator modes.
3. Add bounded sensitive-pattern scanning with category/count/locations and confidence; keep raw matches collapsed and never log them.
4. Add explicit cleanup operations only for verified supported categories. Always generate a new file, display a loss manifest, and reopen/render the output before enabling download.
5. Add `privacy-scan.html` and translations. WebMCP can scan only user-selected files, returns summary counts, and sets `untrustedContentHint:true`.

### Documentation references

- PDF.js 6.1.200 APIs listed in Phase 0.
- Existing metadata read/write: `public/js/edit-metadata.js:38-108`.
- Existing text extraction: `public/js/pdf-convert.js:222+`.
- Existing secure flattening pattern: `public/js/redact.js:340-420`.

### Verification checklist

- Fixture corpus covers XMP, attachments, page attachments, actions/JS, forms, annotations, visible and explicitly invisible text, clean file and signed file warning.
- Tests assert counts/categories, no raw sensitive console output, cleanup removes only claimed features, originals are unchanged, and outputs reopen/render.
- UI consistently says “potential/detectable” and never guarantees completeness or safety.

### Anti-pattern guards

- Do not execute PDF JavaScript or follow embedded URLs.
- Do not use `hasJSActions()` as a complete scan.
- Do not call metadata removal complete without post-save verification.

## Phase 6 — Document Doctor and accessibility readiness

### What to implement

1. Add quick/deep diagnostic modes comparing strict pdf-lib parse, tolerant parse, PDF.js strict load, per-page operator/text/render checks and post-output verification.
2. Report encryption, page-tree/page-box issues, metadata/attachments/actions/forms, structure-tree/MarkInfo/language/title/alt-text readiness signals and signature-preservation warnings.
3. Offer only two clearly named output actions: “Normalize PDF structure” (reserialize) and “Rebuild page content” (lossy fresh-document copy), with explicit preservation/loss preview.
4. Add `document-doctor.html`, translations and fixture-backed reports. Separate read-only `diagnose-document` from transforming actions in WebMCP.

### Documentation references

- pdf-lib load/save signatures and PDF.js display APIs from Phase 0.
- Matterhorn Protocol: https://pdfa.org/resource/the-matterhorn-protocol/.
- Existing artifact smoke-test pattern: `tests/smoke.spec.mjs`.

### Verification checklist

- Corpus covers malformed object, encryption, forms, attachments, tagged/untagged, broken page box, signature field and render failure.
- Every output identifies expected losses and preserves the original.
- Outputs reopen with pdf-lib/PDF.js and render representative pages.
- Grep/UI assertions prohibit PDF/A, PDF/UA, WCAG certification and signature-validation claims.

### Anti-pattern guards

- Do not call tolerant load/save comprehensive repair.
- Do not treat structure-tree presence as accessibility compliance.
- Do not imply signature validity or preservation after save.

## Phase 7 — Embeddable browser ESM SDK

### What to implement

1. Create an isolated `sdk/` package with explicit ESM exports and TypeScript declarations.
2. Export versioned pure APIs for merge, inspect, diagnose and normalize using `Blob | ArrayBuffer | Uint8Array`, `AbortSignal`, and structured progress events.
3. Bundle the exact matching PDF.js worker/assets or document a single peer-dependency configuration; do not depend on jsDelivr at runtime.
4. Add a minimal consumer example and contract tests that import the built package in a clean browser page.
5. Document current source-available license implications and supported browsers without publishing externally in this task.

### Documentation references

- Node package `exports`: https://nodejs.org/api/packages.html#package-entry-points.
- Phase 0 SDK boundary and AbortSignal patterns.

### Verification checklist

- Build output contains only declared files and no site shell/analytics/WebMCP side effects.
- Consumer example runs merge/inspect/diagnose in Chromium.
- Types match runtime exports; package import has no DOM query/global mutation.
- Core artifact tests match site behavior.

### Anti-pattern guards

- Do not publish, push or change license without explicit user authorization.
- Do not mix PDF.js API and worker versions.
- Do not expose DOM-bound `tool-ui.js` as SDK core.

## Phase 8 — PWA/offline foundation

### What to implement

1. Add a standards-based manifest, valid 192/512 icons, theme/background colors and same-origin start/scope.
2. Register a same-origin service worker as progressive enhancement.
3. First release: cache-first allowlisted same-origin static assets only; network-only metrics; version/prune `bpdf-*` caches. Show exact offline capability (“shell/static assets cached”).
4. Add a dedicated nonce-free offline document if offline navigation is promised. Do not cache Worker-rewritten nonce-bearing HTML.
5. Add storage estimate, optional user-triggered persistence, update-ready and remove-offline-data controls.
6. Create a dependency-vendoring spike for full offline tools; only enable/claim each tool offline after its PDF.js/Tesseract/fonts/CMaps/WASM assets pass a real offline artifact test.

### Documentation references

- W3C Manifest: https://www.w3.org/TR/appmanifest/.
- W3C Service Workers: https://www.w3.org/TR/service-workers/.
- Playwright service workers: https://playwright.dev/docs/service-workers.
- Current nonce/no-store contract: `worker.js:60,70-112`.

### Verification checklist

- Manifest fields and icon dimensions validate.
- SW registers/activates; old BrowserPDF caches only are pruned.
- Offline tests prove exactly the advertised pages/tools; uncached routes show intentional offline UI.
- `/metrics/**`, user files, downloads and Blob URLs never enter caches.
- Existing suite passes with service workers blocked; PWA suite passes with them allowed.

### Anti-pattern guards

- Do not cache nonce-bearing HTML or weaken CSP.
- Do not unconditionally `skipWaiting()`.
- Do not claim every tool works offline while dependencies remain remote.

## Phase 9 — Catalog rollout and final verification

### What to implement

1. Apply the verified shared shell/state/copy pattern to remaining tool pages without changing each processor’s semantics.
2. Add the new services to sitemap, llms.txt, structured data, related tools and all translations.
3. Document architecture, privacy coverage, WebMCP exact behavior, offline tiers, workflow storage/cleanup, SDK APIs and honest limitations.

### Verification checklist

- Run full Playwright suite, WebMCP suite, PWA suite, SDK contract tests and new fixture corpus.
- Run `git diff --check`, scan for disallowed claims/APIs, and verify CSP/Permissions-Policy headers.
- Verify all 22 languages, Arabic RTL, clean/localized routes, sitemap, metadata and JSON-LD.
- Measure home/Merge JS bytes, request counts, idle animations, contrast, 320–1440 layouts and keyboard flows.
- Confirm no user document bytes/text leave the browser during all new services.

### Anti-pattern guards

- Do not publish packages, deploy, push, or change licensing without explicit user authorization.
- Do not mark the plan complete while any advertised capability lacks an artifact-level test.
