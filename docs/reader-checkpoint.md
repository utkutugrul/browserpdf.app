# Reader and shared input checkpoint

This is a bounded Phase 2 checkpoint for View PDF and two shared document
handoff contracts. Its focused and independent Reader gates pass. Highlight,
Redact, complete locales, the full regression gate and the remaining 32-service
program remain open.

## Sources and copied contracts

- Installed PDF.js **6.2.108** `types/src/display/text_layer.d.ts` and
  `build/pdf.mjs:14844`: `new TextLayer({textContentSource,container,viewport})`,
  `render()`, `cancel()`, `textDivs` and `textContentItemsStr`. Only the required
  text span geometry, CSS variables, rounding and right-angle container
  rotations were copied from its `web/pdf_viewer.css` text-layer/page rules into
  `public/css/reader-workspace.css`. No complete viewer or scripting surface is
  imported.
- Installed `types/src/display/api.d.ts` and runtime page proxy:
  `streamTextContent({includeMarkedContent,disableNormalization})` returns a
  cancellable `ReadableStream`. The app reads and bounds it before creating
  text-layer DOM. It does not invent an AbortSignal option for
  `getTextContent()`.
- The installed `RenderParameters.transform` contract and
  `web/pdf_viewer.mjs:7078` support a logical page viewport with a bounded
  backing canvas and output-scale matrix. `core/bounded-renderer.js` exposes
  this as an optional `displayViewport`; existing callers retain their prior
  behavior. Reader passes its logical viewport to the renderer, TextLayer,
  links and `onPage`/`onSelection`; the native viewport stays private.
- The same installed document proxy exposes `getOutline()`,
  `getDestination(name)` and `getPageIndex(ref)`. `core/reader-text.js` resolves
  only valid integer visible-page indices; Reader exposes plain internal
  destinations and a deliberate Fill & Sign continuation for page-linked
  forms. External PDF actions and scripts are not executed.
- Existing `core/bounded-renderer.js`, `core/document-session.js`,
  `document-workspace-support.js` and owned workflow handoffs remain the source
  of canvas, source, selection, current-document and transactional ownership
  behavior. The actual entry-derived `./tool-ui.js` delegate is used on each
  localized route.

## Behavior and bounds

`view-pdf.js` is a thin intake entry. `reader-workspace.js` and its scoped style
load on valid intake. One visible page and one TextLayer are retained. The
application text cache holds at most four pages and 1.5 million UTF-16 source
characters. Each page is limited to 12,000 runs, 500,000 source characters and
512 styles **before DOM construction**. An over-budget page retains its image
and states the text/search limit. The cache bounds do not promise a bound on
the PDF engine's internal heap.

Search runs sequentially, cancels the actual outstanding text stream and
reports searched/skipped pages. It stops at and visibly discloses the first
200 results. Queries are limited to 256 UTF-16 characters. Case/diacritic
normalization maps matches back to original span offsets, including Turkish
`İstanbul`, decomposed accents and cross-span text. Full Unicode case folding,
arbitrary reading order and OCR are not claimed.

At most eight thumbnails are rendered per open thumbnail window, sequentially,
with a 220-pixel longest dimension and 100,000-pixel area bound. The main render
has a 1,200-pixel longest-dimension and 2,000,000-pixel area bound (the dimension
bound makes the effective maximum area 1,440,000 pixels). Zoom requests a new
PDF render into that bounded backing canvas. The independent logical viewport
sets the canvas CSS size, TextLayer, links and native range-selection geometry,
including CropBox, UserUnit and four page rotations. The requested zoom
multiplier is 25–400% of the component fit scale; the absolute logical PDF
scale is capped at eight, so unusually tiny inputs can reach that ceiling.
Display magnification continues after the backing-resolution limit is reached,
and the resolution limit is visible. Initial intake reveals the
compact task before readiness unlocks. Search input identity/caret remain
stable through zoom. Native text selection, Shift and other selection modifiers
are preserved by page-navigation shortcuts.

Stable IDs include the existing `pdfCanvas`, `viewerContainer`, `viewerSection`,
page/zoom/print buttons and `pageIndicator`; new controls are `readerPage`,
`readerSearchQuery`, `readerSearchBtn`, `readerCancelSearchBtn`,
`readerSearchStatus`, `readerSearchResults`, `readerOutlineItems`,
`readerThumbnailItems`, `readerTextLayer`, `readerSearchPaint`, `readerLinkLayer`
and `readerStatus`. Search, outline, pages, document modes and replacement are
compact native details panels. Mode buttons have `data-mode` in
`workspaceModes`.

## Shared handoff seams

`getWorkspaceInput()` now returns `capabilities`. A baked scene preserves
known searchability for image-only edits, reports `searchable:true` for added
text, reports actual surviving fields after flattening and reports the verified
rewrite as `encrypted:false`. Object-mode implicit publication and handoff use
these values. Pages consumes the same returned contract in its owned callers.

A fresh editable scene source is still limited to 80 MiB. An owned inherited
scene can carry a baked current PDF above 80 MiB when its immutable source is
at most 80 MiB, its current artifact at most 250 MiB, resources at most 96 MiB
and retained session at most 512 MiB. Scene sources, duplicate IDs, required
references and image MIME/16-MiB bounds validate before task identity commits.
Fresh oversized intake and invalid inherited resources leave the previous
chosen task intact. A new scene after a page boundary still needs a source
within the 80-MiB editable-source limit.

## Verification so far

`rtk proxy node --test tests/reader-text.unit.mjs` passes **6/6**. These cover
original offset recovery, pre-DOM text limits, actual stream cancellation,
strict destinations, cache/result bounds and transactional inherited-source/
asset rejection. Syntax and whitespace checks pass.

The first allocated browser gate discovered exactly eleven cases and finished
**6 passed / 5 failed**, zero skipped/flaky, in **63,667.507 ms**. Its original
JSON and artifacts remain at
`/tmp/browserpdf-reader-checkpoint-first-20261019.json` and
`/tmp/browserpdf-reader-checkpoint-first-20261019/`.

Passing evidence covered Unicode/search/outline/named/internal destinations,
bounded thumbnails, actual canvas ink versus native text selection at all four
rotations plus CropBox/UserUnit 2/zoom, 768/1440 light and Arabic RTL dark
layouts, real large-scene handoff and valid/malformed replacement lifecycle.
The actual source was **82,838,883 bytes**; the saved current PDF was
**85,985,737 bytes**. Fill & Sign retained its task, object and asset with
**86,447,621 resource bytes** and **338,111,124 retained session bytes**. The
fresh oversized retry left its snapshot exactly unchanged. Both large PDFs
are retained in the artifact directory.

The failed mobile cases found an actual initial scroll-anchor defect: the
320-pixel canvas was at Y=-657.5, above the viewport. The correction reveals
the owned task before initial readiness. The unchanged View smoke found
duplicate page-indicator text in the status; the status copy was corrected.
The search-limit fixture had only 168 visible matches because its long line
crossed CropBox; it now places twelve hits per page across four visible lines,
retaining the 200-result assertion. The capability helper ran against the old
Add Text entry before navigation; it now waits for the actual Fill & Sign URL.
No smoke assertion or geometry/pixel tolerance was weakened.

The corrected eleven-case rerun passed **11/11**, zero skipped/flaky/unexpected,
in **48,983.104 ms**:
`/tmp/browserpdf-reader-checkpoint-second-20261019.json` and its matching artifact
directory. Loaded 320/390/768/1440 light and Arabic RTL dark contexts have no
body/default-surface overflow. Initial canvas Y values are 335.5, 299.5 and
263.109375 pixels; mobile PDF visibility is the full 218/267-pixel landscape
page. Native search-input focus and caret remain stable through zoom. The
unchanged View smoke passes.

Attachment review found that the extreme replacement substep still measured
the preceding page, despite that first green run: its `[1013,796]` bounds did
not prove the intended extreme input. The test now waits for the new task,
expected current filename and visible workspace, and requires aspect ratio
above 200 as well as the unchanged dimension/area bounds. Its first focused
two-case run passed that stronger case at **[4,1200]**, 4,800 pixels, but failed
the expanded image-only continuation at the missing Reader Add Image menu
option: **1 passed / 1 failed**, zero skipped/flaky, **95,840.906 ms**. The
original added-text/form-flatten assertions and explicit baked-artifact boundary
had passed; the image-only tail had not executed. That report/trace remain at
`/tmp/browserpdf-reader-checkpoint-focused2-20261019.json` and its artifact
directory.

Adding the compatible Add Image option inside the existing collapsed Reader
menu was the only further product change. The focused rerun passed **2/2**,
zero skipped/flaky/unexpected, in **14,287.820 ms**:
`/tmp/browserpdf-reader-checkpoint-focused2-second-20261019.json` and matching
artifacts. The extreme page is again **[4,1200]**. The expanded capability
journey first verifies embedded text in an actual baked artifact, reviews and
explicitly adopts that boundary, then uses the real Add Image route. Both
before and after its implicit bake the scene kinds are exactly `['image']` and
capabilities are `{encrypted:false,searchable:true,forms:false}`. Thus the
searchable fact is preserved, rather than re-derived from a remaining editable
text object. `image-only-known-searchable.pdf` reopens with one Image XObject,
the original text, flattened field value and exactly one stamp.

The root's first independent Reader journey then found a real zoom defect:
Letter page 3 already had a **927×1200** backing canvas, and its CSS size was
also capped at those dimensions. Labels above 100% did not magnify the page.
The first root report remains at `/tmp/browserpdf-root-reader-first/results.json`;
its search/native Shift selection/outlines/named-destination steps passed,
but it stopped before the export and mobile tail. The earlier geometry tests
proved alignment only at the capped size and did not establish magnification
after that cap.

The narrow correction changed only `core/bounded-renderer.js`,
`reader-workspace.js` and `tests/reader-workspace.spec.mjs`. It separates the
logical/display viewport from the native bitmap and adds actual CSS-growth,
selection/ink/link, zoom-out and Fit assertions. The existing four-rotation
ink-containment requirement remains above 97% with its original two-native-
pixel padding; DOM rectangles are converted into native pixel coordinates.
The node unit gate again passed **6/6** in **60.069875 ms**, and syntax and
whitespace checks passed.

A separate offline renderer preflight passed **20/20** for Letter and all four
CropBox/UserUnit-2 rotations at 25/100/125/400%, using actual PDF.js rendering
and independently transformed sentinel pixels. Its generator, PDF and JSON
remain under `/tmp/browserpdf-reader-zoom-candidate/`. This is API/geometry
preflight evidence, separate from browser acceptance.

The allocated six-case browser gate passed **6/6**, zero skipped, flaky or
unexpected cases, no errors, in **27,594.819 ms**:
`/tmp/browserpdf-reader-zoom-six-20261019.json` and matching artifact directory.
It covers the strict four-rotation geometry case, all four loaded width cases
(English light and Arabic RTL dark), and the new zoom case. Actual Letter CSS
sizes were **253×328** at 25%, **1014×1312** at 100%, **1267×1640** at 125%,
and **4056×5248** at 400%. The backing canvas remained **927×1200** at
100/125/400%; 375% shrank the display and Fit restored **1014×1312** exactly.
Native range selection retained the exact text at each stage; all zoom and
rotation ink-containment fractions were **1.0**. TextLayer/surface dimensions
and internal-link geometry followed the display viewport, only the page's own
surface scrolled at enlarged zoom, and the body did not overflow. The unchanged
mobile cases still expose their complete 218/267-pixel landscape pages.

The root's independent complete Reader journey then passed **4/4**, with one
explicit download, no page errors and no non-GET requests:
`/tmp/browserpdf-root-reader-postfix-first/results.json` and
`reader-current-edited.pdf` in that directory. It verifies Unicode search and
native Shift-selection offsets, real Unicode/named outline destinations,
100/125/400% CSS growth with bounded backing and exact Fit restoration, and
selected page 3 continuing into Add Text under the same task. The actual
three-page export retains rotations `[0,180,0]`, the Turkish field value, all
three outline titles and original page text, with the new Turkish stamp only
on page 3. Its natural 320×720 Arabic dark task has no body overflow, an
accessible full filename and the entire **278×359** PDF page visible at
Y=335.5. This closes the bounded independent Reader gate, not the wider service
program.

After that browser closed, a comment-only citation cleanup replaced the
renderer comment's viewer-path literal with the pinned
`types/src/display/api.d.ts` `RenderParameters.transform` provenance. The
repository's source guard scans comments for forbidden full-viewer path names;
the implementation and test thresholds did not change. Syntax and whitespace
checks pass after this cleanup.

Root's subsequent frozen full gate discovered **250 tests in 20 files** and
completed **249 passed / 1 failed**, zero skipped/flaky, in **696,877.429 ms**:
`/tmp/browserpdf-root-reader-effects-full-20261019-results.json` and matching
artifacts. All 158 recorded runtime/test source hashes stayed unchanged during
that invocation. The single failure was the lazy extra-source retry test's
setup: aborting the first workspace-helper import while opening Reader now
interrupts Reader's legitimate intake use of that helper before the intended
`readExternalPdfFile` failure/retry exercise begins.

After the browser closed, root approved exactly one test-only argument change
in `tests/lazy-workspace-support.spec.mjs`: the first case now calls
`open(page, 'add-text')`. All real failure/retry, import-count-two, exact task
transfer, returned-byte isolation and independently reopened PDF assertions
remain unchanged. Syntax, whitespace and exact-one discovery checks passed.
Its once-only allocated browser gate passed **1/1**, zero skipped/flaky/
unexpected, no errors, in **4,723.904 ms**:
`/tmp/browserpdf-reader-effects-lazy-final1-20261019.json` and matching artifacts.
`retried-external-source.pdf` is **2,039 bytes**, reopens with **two pages**,
title **Lazy support source** and field value **Original value**. The browser
closed and its exclusive window was released. Thus all 250 unique cases have
passing evidence across the frozen 249 and corrected one-case gate; a clean
single full-250 invocation is not claimed. No product correction or test
assertion relaxation was made for this failure.

The allocated browser commands used the root-owned existing server, one worker
and no source/test changes during each invocation:

```sh
rtk proxy env BASE_URL=http://localhost:8788 PLAYWRIGHT_JSON_OUTPUT_NAME=/tmp/browserpdf-reader-checkpoint-second-20261019.json npx playwright test tests/reader-workspace.spec.mjs tests/smoke.spec.mjs --grep 'reader|Reader|implicit mode baking|owned inherited scene|view-pdf:' --workers=1 --output=/tmp/browserpdf-reader-checkpoint-second-20261019 --reporter=line,json
rtk proxy env BASE_URL=http://localhost:8788 PLAYWRIGHT_JSON_OUTPUT_NAME=/tmp/browserpdf-reader-checkpoint-focused2-second-20261019.json npx playwright test tests/reader-workspace.spec.mjs --grep 'reader search discloses|implicit mode baking' --workers=1 --output=/tmp/browserpdf-reader-checkpoint-focused2-second-20261019 --reporter=line,json
rtk proxy env BASE_URL=http://localhost:8788 PLAYWRIGHT_JSON_OUTPUT_NAME=/tmp/browserpdf-reader-zoom-six-20261019.json npx playwright test tests/reader-workspace.spec.mjs --grep 'text geometry agrees|CSS zoom grows|loaded reader fits' --workers=1 --output=/tmp/browserpdf-reader-zoom-six-20261019 --reporter=line,json
rtk proxy env BASE_URL=http://localhost:8788 PLAYWRIGHT_JSON_OUTPUT_NAME=/tmp/browserpdf-reader-effects-lazy-final1-20261019.json npx playwright test tests/lazy-workspace-support.spec.mjs --grep 'lazy workspace import failure retries extra-source validation without replacing the owned task' --workers=1 --output=/tmp/browserpdf-reader-effects-lazy-final1-20261019 --reporter=line,json
```

The wider checkpoint regression has the passing evidence described above;
complete service locales and the remaining 32-service scope remain open.
After the root Reader browser closed, the coordinated test-only
`object-preparation.spec.mjs` migration changed its former four-mode count to
seven and asserts the exact `data-mode` slugs: `add-text`, `add-image`,
`fill-sign`, `organize`, `view-pdf`, `highlight`, `redact`. Its loop still checks
every button is disabled; forced stale download/mode/Apply, latest-draft and
exact saved-artifact assertions are unchanged. Syntax and whitespace checks
pass, and all eight object-preparation cases passed in root's full invocation.

The next Highlight/Redact extension must unify direct and named-destination
navigation ownership: a held named destination currently has its own epoch,
but a newer direct page/search/thumbnail render does not invalidate it. This is
a source-review seam awaiting a held-resolver actual-page regression. Full
View PDF service acceptance and the complete 32-service scope remain open.

## Annotation and redaction preflight (not route acceptance)

The next checkpoint verified the installed pdf-lib 1.17.1 low-level writer
APIs: `PDFContext.obj/register/flateStream`, `PDFPageLeaf.addAnnot`,
`PDFAnnotation.fromDict/setNormalAppearance` and `PDFHexString.fromText`.
Plain `context.obj` strings become PDF names; note/identifier values need PDF
string objects. [Adobe PDF 1.7 Tables 8.30 and 8.21](https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/pdfreference1.7old.pdf)
define default-user-space quadrilaterals and appearance-stream precedence;
an explicit appearance stream must own its transparency. Pinned PDF.js
`build/pdf.worker.mjs:53097` validates numeric 8n quads against Rect and then
normalizes each axis box to Z order.

The separate `/tmp/browserpdf-highlight-writer-preflight.mjs` produced a real
four-page PDF plus JSON/PNGs using those exact APIs, explicit AP Form and
ExtGState opacity. PDF.js reopened four rotations/CropBox/UserUnit 2 with true
Highlight subtype, AP, Unicode notes, retained source text and visible highlight
pixels. This is an API feasibility proof, not BrowserPDF route evidence.
Arbitrarily angled, skewed and vertical writing need a visible support limit
unless separately proven.

Redaction remains open. The planned bounded plain-page path reconstructs safe
primitive content/font resources in fresh pages without page-object copying;
unknown/interactive/reference graphs require explicit whole-document raster
review. Both repeated-widget and internal-Link/Dest orphan hazards still need
portable actual route/export tests, including decoded streams, all PageLeaf
objects and source Info/XMP secrets.
