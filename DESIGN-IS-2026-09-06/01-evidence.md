# BrowserPDF Design Audit Evidence

The audited surfaces are the home/catalog page and Merge PDF as a representative task. Runtime measurements used the local Worker at `http://127.0.0.1:8788` in Chromium.

## 1. Innovative

- The current interaction patterns are a conventional categorized card catalog plus text filter (`public/index.html:79-497`) and a conventional click/drag file dropzone (`public/merge.html:81-119`).
- The material product distinction is architectural: files are processed locally and the primary tool can start without an account (`public/merge.html:82-96`, `public/js/merge.js:227-255`).
- Cross-tool continuation already exists after a result and can move a generated file through IndexedDB to another tool (`public/js/tool-ui.js:154-249`). This is a useful foundation for human/agent collaborative workflows.

### WebMCP opportunity

- The 4 September 2026 WebMCP Community Group draft exposes page-owned JavaScript tools through `document.modelContext.registerTool()`, using a name, localized title, natural-language description, JSON Schema input, async execution callback, optional annotations, and `AbortSignal` lifecycle.
- The draft recommends dynamic, state-relevant registration instead of exposing dozens of tools at once because tool metadata consumes model context and overlapping tools cause selection errors.
- Transferable/streamable binary inputs and outputs remain an open design question. BrowserPDF should therefore avoid claiming that an agent can inject or receive PDF binaries through WebMCP. The safe first version operates only on files the user already selected in the page and returns bounded structured metadata.
- Sources: https://webmachinelearning.github.io/webmcp/ and https://github.com/webmachinelearning/webmcp (consulted 2026-09-06).

## 2. Useful

- Home exposes all 29 destinations and filters their visible text immediately (`public/index.html:84-497`, `public/js/hub.js:4-17`). Runtime interaction readiness for filtering was 74 ms median.
- Merge presents file selection immediately after its one-sentence description, then exposes clear/order/remove/merge actions only when relevant (`public/merge.html:79-137`, `public/js/merge.js:54-152`). Runtime dropzone readiness was 72 ms median.
- Merge completes with one primary action after selection and automatically downloads `merged.pdf` (`public/merge.html:105-113`, `public/js/merge.js:227-255`).
- A fresh mobile session has an additional blocking choice: the consent panel covers the entire dropzone and much of the first instruction section. Its mobile flex layout preserves a 260 px text flex basis while switching to a column (`public/css/styles.css:1777-1828`); observed screenshot: `/tmp/browserpdf-merge-mobile.png`.
- A zero-result homepage search hides every group and offers no explanation or recovery action (`public/js/hub.js:7-17`).

## 3. Aesthetic

- The site has centralized light/dark semantic color, radius, shadow, and system-font tokens (`public/css/styles.css:42-104`).
- Both surfaces use 11 rendered light-mode solid colors. The lowest measured primary-text contrast is 4.63:1 for the privacy badge; muted main content is 4.92:1. Both pass WCAG AA for normal text.
- Computed visible type sizes across the two surfaces are `[12, 12.5, 13, 13.5, 14.5, 15, 15.5, 17, 28, 30]` px. Computed non-zero box spacing values are `[1, 4, 5, 6, 7, 8, 10, 12, 13, 14, 15, 16, 20, 24, 26, 28, 48, 64]` px.
- Cards share a coherent icon, border, radius and type hierarchy (`public/css/styles.css:1106-1168`).
- At 390 px width, the consent panel contains a large blank middle region and dominates the composition rather than behaving like a compact choice (`public/css/styles.css:1777-1828`; `/tmp/browserpdf-merge-mobile.png`).

## 4. Understandable

- Core labels are literal: “Filter tools…”, “Merge PDF files”, “Drag PDF files here”, “choose from your computer”, and “Merge & download” (`public/index.html:80-84`, `public/merge.html:82-112`).
- Merge explains ordering, local processing and page counts below the task surface (`public/merge.html:139-145`).
- The trust content contains avoidable implementation jargon such as “client-side”, “backend”, “OCR”, “WebAssembly”, “cryptographic hash”, and “Content-Security-Policy” (`public/index.html:499-534`).
- GitHub and theme are icon-only visually (`public/index.html:66-75`); accessible labels exist, but no visible tooltip is authored.
- Merge metadata says users can reorder pages, while the implemented controls reorder complete files (`public/merge.html:9,33`; `public/js/merge.js:62-90,115-140,238-243`).

## 5. Unobtrusive

- In the regular desktop layout, functional content comes before About, FAQ, related links and footer (`public/index.html:78-497`, `public/merge.html:78-137`).
- On every fresh visit, Worker injection adds a fixed consent dialog at z-index 9999 (`worker.js:130,217`; `public/css/styles.css:1777-1795`).
- Runtime count per audited surface: one privacy badge and one consent dialog; no initial notification and no idle animation.
- On mobile the dialog obscures the primary action, so site chrome becomes the dominant element before the user can start.

## 6. Honest

Supported claims:

- “Merge & download” creates and downloads `merged.pdf` (`public/merge.html:112`; `public/js/merge.js:227-255`).
- The merge path copies source pages rather than rasterizing them (`public/merge.html:160-161`; `public/js/merge.js:238-243`).
- Required libraries are fetched, SHA-384 checked, and only then imported (`public/js/lib-loader.js:64-118,154-158`).

Mismatches and inflations:

- The homepage calls the suite “open-source”, while `LICENSE.md` explicitly says the license is not OSI-approved and restricts commercial use (`public/index.html:81`; `LICENSE.md:5-15`). “Source-available” is accurate unless the license changes.
- “There is no backend” / “no server” is literally false because a Cloudflare Worker processes every HTML response. The supportable promise is “no file-processing backend and no file-upload endpoint” (`public/index.html:502,514`; `public/merge.html:9,15,25,33`; `worker.js:134-294`; `wrangler.json:4-9`).
- “Everything happens in this tab” overreaches because libraries and optional analytics are fetched over the network. Document processing, specifically, happens in the tab (`public/index.html:58`; `public/js/lib-loader.js:10-43`; `worker.js:125-130`).
- The consent copy asks only for analytics, but Accept grants `ad_storage`, `ad_user_data`, and `ad_personalization` alongside analytics storage (`worker.js:130`; `public/js/consent.js:8-16,33-37`). The primary visual treatment on Accept also nudges the user relative to Reject (`worker.js:130`).
- “Analytics only with consent” says Google Analytics loads only after acceptance, while configured `gtag.js` is injected on every response in consent-denied mode (`public/index.html:504`; `worker.js:112,125-130,217`; `public/js/consent.js:24-31`).
- “Add as many as you like” conflicts with the disclosed device-memory ceiling (`public/merge.html:94,152-153`).

## 7. Long-lasting

- Native system fonts, restrained surfaces, semantic HTML and a single accent are durable foundations (`public/css/styles.css:42-110`; `public/index.html:42-561`; `public/merge.html:42-192`).
- Pill controls, uniform cards and a small logo gradient are the only notable trend markers (`public/css/styles.css:172-203,1112-1129`).
- The hard-coded catalog count “twenty-nine” in visible copy and structured data will become stale whenever tools are added (`public/index.html:33,81`).

## 8. Thorough down to details

- Merge implements empty/input, loading, error, disabled, drag-over, transient success and post-result continuation states (`public/merge.html:86-137`; `public/js/merge.js:54-60,160-188,227-273`; `public/js/tool-ui.js:221-249`).
- The homepage lacks a no-search-results state (`public/js/hub.js:7-17`).
- Merge success is only “Done.” inside progress and disappears after 1.2 seconds; there is no persistent standalone success confirmation (`public/js/tool-ui.js:35-40`).
- Progress lacks `role="progressbar"`, value attributes, and an announced live status (`public/merge.html:121-128`).
- Explicit focus styles cover the language picker, dropzone, standard buttons, text inputs and cards, but not the GitHub/theme header controls (`public/css/styles.css:190-243,333-336,620-623,1132-1135,1619-1623`).
- Reduced motion and system dark mode are supported (`public/css/styles.css:66-120`).

## 9. Environmentally friendly

- Fresh `/`: 9,094 decoded initial JavaScript bytes, 6 requests, 74 ms median interaction-ready proxy, zero idle animations.
- Fresh `/merge`: 34,849 decoded initial JavaScript bytes, 8 requests, 72 ms median interaction-ready proxy, zero idle animations.
- Both are well below 100 KB initial JavaScript and honor dark mode and reduced motion (`public/css/styles.css:66-120`).
- Production analytics adds requests when configured; the local measurement had no `GTAG_MEASUREMENT_ID` (`worker.js:125-130`).

## 10. As little design as possible

- The homepage initially presents 29 equally weighted tool cards plus four trust claims and six FAQ entries, producing a 2,681 px document in the measured 1280 px-wide render (`public/index.html:86-535`).
- The same privacy proposition appears in at least five visible homepage regions and four Merge regions (`public/index.html:58-63,80-81,499-505,517-534,541-554`; `public/merge.html:58-63,81-83,139-145,176-185`).
- Source-declared interactive count is 40 on home and 16 across Merge states, excluding the hidden file input (`public/index.html:43-559`; `public/merge.html:43-190`). The Worker adds three consent controls and a footer preferences control at runtime (`worker.js:130-132`).
- Repeated same-purpose navigation is limited: GitHub appears in header/footer; Merge has both brand-to-home and “All tools” (`public/index.html:66,559`; `public/merge.html:43,66,79,190`).
- Primary component nesting reaches nine levels from `.app` on both surfaces (`public/index.html:36,78,86-95`; `public/merge.html:36,78,86,100-110`).
- No component props exist in the vanilla implementation and no unused imports were found in `public/js/hub.js` or `public/js/tool-ui.js`.

## Accessibility evidence

- Every primary home and Merge action is keyboard reachable in its relevant state. Merge’s custom dropzone supports Enter and Space (`public/js/merge.js:191-196`); generated reorder/remove controls are native named buttons (`public/js/merge.js:115-136`).
- The initial tab sequence is long: 45 stops on home, including 29 cards; 19 stops on Merge with consent visible. There is no skip link on either surface (`public/index.html:42-90`; `public/merge.html:42-112`).
- Home has three landmarks (header/banner, main, footer/contentinfo); Merge has four (the same plus related-tools navigation).
- The filter placeholder fails normal-text AA at 4.31:1; all other measured light-theme text groups pass, ranging from 4.63:1 upward (`public/css/styles.css:43-55`).
- The consent surface has `role="dialog"` and `aria-live="polite"` but no `aria-modal`; focus stays on the body when it opens, background controls come first in tab order, focus is not contained, and Escape does not dismiss it (`worker.js:130`; `public/js/consent.js:19-49`).
- At a 390×844 viewport the consent panel is 370×342 px, occupies 40.5% of the viewport, and overlaps about 32% of the Merge dropzone.

## Known limits

- Merge was the representative tool; all 29 tool implementations and all 22 translated dictionaries were not individually audited.
- Performance measurements are local, unthrottled Chromium measurements, not field data.
- Post-selection state evidence is based mainly on source inspection rather than a complete assistive-technology session.
- Production analytics routing and the raw-IP claim were not verified against a deployed network trace.
