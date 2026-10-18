# Shared page workspace checkpoint

This is the first Phase 2 Pages checkpoint, before route migration. Existing
routes have not been changed. The focused suite is `tests/page-workspace.spec.mjs`.

## Public contracts

- `core/page-selection.js`: `parsePageRanges(text,pageCount)`,
  `normalizePageSelection(pages,pageCount)`, `pagesByParity(pageCount,parity)`,
  `formatPageRanges(pages,pageCount)` and
  `changePageSelection({selected,anchor},pageIndex,{pageCount,shiftKey,additive})`.
  Core/session indices are zero-based; range text is one-based. Invalid ranges
  throw before any shared selection update. Overlapping ranges merge before
  expansion, so repeated large ranges do not allocate repeated page arrays.
- `core/page-plan.js`: `createPagePlan({sourceId,pageCount})` and immutable
  `{sources:[{id,pageCount}],pages:[{id,sourceId,pageIndex,rotation,crop}]}` plans.
  `movePageGroup`, `duplicatePageGroup`, `deletePageGroup`, `rotatePageGroup`,
  `cropPageGroup` and `insertPageSource` return new plans with stable existing
  page IDs. Moves/insertion use a zero-based position before the original plan's
  page at that index; `pages.length` means append. Crop boxes use unrotated PDF
  coordinates and must stay inside the source CropBox. No command can delete
  every page. `createPagePlanHistory` stores only plans, never bytes/DOM/assets.
- `core/page-operations.js`: `applyPagePlan(inputs,plan,{pdfLib,signal,onProgress})`
  accepts owned source references `{id,bytes:Uint8Array}` and returns
  `{bytes,pageMap,summary,structures,boundary:{kind,losses}}`.
  `rotatePdfPages(bytes,{pages,degrees,pageCount},context)` and
  `cropPdfPages(bytes,{pages,box,pageCount},context)` delegate to this executor.
  Original-order single-source rotation/crop modifies the loaded document,
  retaining its catalog. Reorder/insert/duplicate/delete builds a page-copy
  result with explicit potential losses. Every result is reopened with pdf-lib
  and checked against its expected page count; this does not certify structure,
  accessibility, links or digital signatures.
- `page-workspace.js`: `await createPageWorkspace({container,plan,sources,pdfjs?,
  pdfjsAssets?,onSelectionChange?,onNavigate?})` returns `ready()`, `selection()`,
  `setSelection(pages)`, `refreshSelection()`, `setPlan(plan,sources?)`, `dispose()`
  and `element`. It warms the actual document session and calls only its
  `setSelection` setter. Plan replacement remaps selected stable IDs to the new
  output indices. Tile rotation/crop labels indicate pending plan changes; the
  eventual route's actual-result preview remains a separate explicit operation.

## Bounds and resource ownership

Range/plan operations allow 10,000 pages and 20 source PDFs. Combined source
inputs are limited to 250 MiB before copying. Plan history retains at most 30
past steps and 60,000 total page records across current/undo/redo plans.

The panel retains at most 12 thumbnail canvases. Each is bounded to a longest
dimension of 220 pixels and 220,000 total pixels through the shared renderer.
Thumbnail generation is sequential and reuses a source PDF.js proxy. An LRU
retains at most two source loading tasks during a window; completion, navigation,
source replacement, cancellation and disposal destroy owned tasks. Removed
canvases have both dimensions cleared. Source bytes are owned once by the panel
and never attached to DOM data attributes, URLs or metadata tools. The renderer
and processing libraries can retain their own bounded input copies; these caps
are resource ownership limits, not an estimate of engine peak heap usage.

## External API evidence

Installed pdf-lib 1.17.1 source is authoritative for this checkpoint:

- `node_modules/pdf-lib/src/api/PDFDocument.ts`: `load`, `copyPages` (line 722),
  `addPage`/`insertPage`, `save`. The `copy()` documentation at line 741 explicitly
  warns that AcroForms/outlines and other document information are not copied.
- `node_modules/pdf-lib/src/core/PDFObjectCopier.ts`: `copyPDFPage` copies the
  page dictionary/inherited entries and removes its original Parent reference;
  it does not install the source catalog in the result.
- `node_modules/pdf-lib/src/api/PDFPage.ts`: `setRotation` (136), `setCropBox`
  (299), `getMediaBox` (447) and `getCropBox` (468). CropBox imposes visibility
  clipping; it does not remove content streams. This core preserves MediaBox.

Existing local patterns used: `core/operation-scope.js` owns AbortSignal epochs;
`core/privacy-scan.js::withPdfDocument` owns PDF.js lifecycle;
`core/document-doctor-output.js` supplies dimension/area bounds and strict reopen
patterns. The panel imports Objects-owned `core/bounded-renderer.js` and uses
the shared warmed `documentSession` from `tool-ui.js`.

Boundary losses are finite canonical codes agreed with Objects. They contain no
field names/values, extracted text, source filenames, paths, asset URLs or bytes.
Structure detection reports bounded booleans, with an incomplete flag after
50,000 indirect objects; it neither executes actions nor validates signatures.

## Verification state

The implementing worker ran these commands against root's existing port 8788
server, with an agreed public/test source freeze and one Playwright invocation
at a time:

```sh
rtk proxy env BASE_URL=http://localhost:8788 npx playwright test tests/page-workspace.spec.mjs --workers=1 --output=test-results/pages-shared-checkpoint --reporter=line
# 6 passed, 1 failed, 14.1 s. The failure was a static guard matching
# "document." punctuation in an error string, not DOM property access.
rtk proxy env BASE_URL=http://localhost:8788 npx playwright test tests/page-workspace.spec.mjs --grep 'page ranges|page plans|page executor rejects' --workers=1 --output=test-results/pages-shared-checkpoint-core-retry --reporter=line
# 3 passed, 675 ms, after correcting that guard and adding max-size core checks.
```

All seven focused cases have passing evidence across those two runs. The four
unchanged browser/artifact cases passed in the first run. The three final core
cases passed in the retry, including the 10,000-page additive Shift union and
60,000-record history bounds. This is implementing-worker evidence; fresh
independent verification is still required before route migration.

Saved evidence in `test-results/pages-shared-checkpoint/`:

- `page-workspace-shared-page-a8d80-rotation-and-crop-artifacts-chromium/group-insert-duplicate-crop.pdf`:
  reopened five-page output with exact external-source order, duplicate content,
  selected rotation/CropBox, unchanged MediaBox, and explicit catalog-loss codes.
- `page-workspace-selected-ro-2078c--recoverable-hidden-content-chromium/catalog-preserving-rotate-crop.pdf`:
  selected rotation/crop retain tested form value and catalog entries. A separate
  verification clone restores the crop to prove hidden text remains recoverable.
- `page-workspace-common-pane-6249a-lled-windows-across-layouts-chromium/extreme-aspect-pages.pdf`
  and `page-panel-dark-rtl.png`: real 10×50,000 pt page, dimension/area budgets,
  12-canvas windows, cleared removed canvases, cancellation/disposal, and no
  panel overflow at 320/390/768/1440 in dark RTL layout.

The initial static-guard failure trace remains in its original output folder;
no evidence or original fixtures were deleted or weakened to hide it.

Still open: route migration; scene-baking/adoption/undo integration; Merge source
ranges/thumbnails; named Split groups and ordinary outputs above 20 pages;
Organize actions/history wiring; draggable Crop; Numbers/Watermark settings and
Unicode artifacts; both image composer URLs; EXIF-normalized image artifacts;
PDF-image estimates/cancel/output review; complete locale/release gates.
