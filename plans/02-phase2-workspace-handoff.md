# Phase 2 implementation handoff: shared object and page task

Read the primary goal and acceptance ledger in `02-browserpdf-service-improvements.md` first. User authorization covers all 32 services. Latest steering specifically prioritizes unreliable signing; do not replace the complete program with a signing-only task.

## Ownership

**Objects worker** owns `tool-ui.js`, `core/document-session.js`, `core/workflow-store.js`, `document-result.js`, `document-workspace.css`, shared reader/object scene/assets and renderer helpers, and Add Text/Image/Fill & Sign/Highlight/Redact/View adapters and HTML. Own font/geometry helper extensions when shared APIs require them; coordinate any library/font additions, preserve exact-version integrity and font licenses. Pages requests narrow shared API changes through this owner.

**Pages worker** owns separate page-operation/range/selection modules and scoped styles, Merge/Split/Organize/Rotate/Delete/Crop/Page Numbers/Watermark, and the shared Images/JPG-PNG composer. Do not edit shared-owned files directly. Source-copy algorithms must become reusable DOM-free cores for later Workflows reuse. Preserve existing URLs and useful native controls.

No nested workers: only two implementation slots. Keep documentation, tests and new scoped CSS separate to avoid conflicts. Root owns independent review/evidence and the durable development server; never start/stop it. Use `BASE_URL=http://localhost:8788`, unique test outputs and one Playwright invocation at a time because global setup rewrites fixtures. Coordinate source freeze before artifact gates. Shell commands start with `rtk`.

## Scene and document contract

- Text/image/signature/highlight objects remain selectable/editable after route switches. A newly baked PDF plus a navigation ribbon does not satisfy this phase.
- Keep an immutable scene source and stable object IDs; rebuilding the same state exports the same edits once. Explicit apply/export must not duplicate objects. Page-operation/lossy boundaries can bake the current scene only with truthful loss/history semantics; preserve undo to the preceding artifact.
- Keep asset bytes in a deduplicated bounded asset store, referenced by object ID. Do not serialize repeated image/base64 payloads into every JSON undo snapshot. Bound both per-scene and retained history/resources; enforce combined resource limits visibly.
- Persist scene history as state plus references to the single owned scene source, rather than a full source PDF file per history entry. A supported 80 MiB editable input must still hand off after ordinary edits without exceeding the 512 MiB owned-task restore limit. Validate all replacement resources, scene references and size limits before changing task identity/current revision. Stale asset hashing must not repopulate a cleared or replaced task.
- Workflow cleanup currently reads all tasks' complete file records with `getAll()`. Extend storage with metadata/key cursor cleanup and load only owned references while preserving atomicity, scoped expiry and old-record compatibility. Per-session caps do not establish a global browser-storage quota bound; document that limit. Asset hash references stay local and never enter navigation URLs, network requests or WebMCP metadata.
- Actual adapters update shared page selection and revision. A deliberate mode switch carries current scene, selection/history and assets atomically in the existing owned workflow store, excluding passwords. Fresh unrelated tabs stay empty. Reuse only owned handoff tasks; batch outputs fork identity.
- Objects support focus/selection, move, proportional resize for images/signatures, per-object properties, delete and undo/redo. Native numeric position/size controls and arrow-key actions make placement possible without a pointer. Keep native text editing keys intact when an input has focus.
- Source/result/current states and pending/applied changes must be distinguishable. Starting an operation invalidates old result/download/continuation; undo/redo reviews the chosen current artifact. Failed/cancelled/stale operations cannot replace it.

## Signing first

- Drawn, typed and uploaded PNG/JPEG signatures share the scene object model. Trim transparent ink margins before placement, retaining small padding; preserve a clear preview of the actual bitmap used by export.
- Drawing uses pointer capture and local `touch-action:none`, handles pointer cancellation, and does not make the whole page unscrollable. Clear resets the placed draft consistently.
- Wait for typed font readiness, fit the entire Turkish name without clipping, then snapshot. Updating the source updates the placed draft preview. Preserve proportional dimensions through page 2, all rotations and nonzero CropBox.
- Map AcroForm widgets to actual pages and field names; support repeated widgets for one field, synchronize form controls and expose per-field errors. Apply on a clone and commit only verified complete output; flatten errors block success. Non-form PDFs can add text in the same task.
- Preserve focused page-linked input identity and caret while a preview refreshes. Rotated 90/270-degree widgets remain legible and operable, using an exact transformed control or an on-page hotspot with a full-width editor. Verify the actual page-linked control as well as the side panel.
- These are electronic image signatures. Do not imply cryptographic certificates or signature validity. Keep verified preservation/loss statements accurate.

## Loaded task shell

The first functional scene checkpoint can use interim placement controls. Final object/page service acceptance requires the loaded task layout: collapse the large input dropzone after intake; keep current identity and mode actions near the top; make the page canvas central; place fields, signature capture and selected-object properties beside it or in compact collapsible panels. Mobile panels retain a clear canvas and reachable actions. Controls spread through a multi-screen vertical form do not meet the user's general-usability requirement.

## Reader, highlight and redaction

- Reader: real selectable text, search with affected-page navigation, outline, bounded thumbnails, zoom and page-linked form navigation. Use plain text/DOM overlays; do not import `web/pdf_viewer`, `AnnotationLayer`, `XfaLayer`, `PDFScriptingManager` or `renderRichText`.
- Text selection highlight must produce true highlight annotation geometry with per-object color/note/edit/delete, not describe a painted rectangle as a PDF highlight annotation. Keep optional rectangle highlighting explicitly labeled if retained.
- Redaction: use exact inverse viewport geometry and actual removal, never a white/black overlay over recoverable text. Retain current safe raster strategy with explicit affected-page structure loss unless a tested structural engine exists. Verify removed text and metadata and connect the actual redacted result to inspection. Document structural-engine evidence/limits honestly.
- Inspect saved object streams and cross-page references as well as visible extraction. Root's synthetic proof `/tmp/browserpdf-independent-redaction-copy-review.mjs` shows the current copied-page strategy pulling a replaced original page back as an orphan through repeated AcroForm widget Parent/Kids/P references: three visible pages, six PageLeaf objects, original text retained in stream 30. Evidence: `/tmp/browserpdf-root-redaction-copy-hazard.json` and its PDF. Internal link destinations can create the same risk. Sanitize verified references or offer an explicit fuller raster path before claiming removal.
- Preview and export use the same resolved font bytes, metrics, transforms and source assets. Handle rotation, CropBox and UserUnit. Resize/zoom must not move objects.
- Bound canvas longest dimension **and** total pixels everywhere. Extreme aspect-ratio pages are acceptance fixtures. Limit thumbnail DOM/canvas retention (paged or virtualized); thousands of pages must not allocate every thumbnail at once.

## Pages and duplicate composers

- Shared ranges accept ordinary `1-5,8` syntax with visible validation; odd/even, Shift/group selection and current-page navigation use one selection contract.
- Merge: per-file thumbnail/range, ordered keyboard list, reviewed combined result. Split: named per-result list/group and selected-result continuation, with ZIP as explicit final download.
- Organize: selected-group move, external page insertion, duplicate, delete/rotate and history. Rotate: selected scope/reset/changed-page summary and OCR-ready result. Delete: range/keep-selected, undo, remaining preview, never delete all pages.
- Crop: selected-page scope and draggable visible box; changes page boxes, does not securely erase hidden content. Exact rotated/CropBox geometry and actual chosen-page preview.
- Numbers: scope, start page/number, font/margin and true selected-page preview. Watermark: Unicode, scope/navigation, logo/tile/custom placement and true preview; supported image types are explicit.
- Image composer genuinely powers both `/images` import mode and `/jpg-to-pdf`: thumbnails, keyboard ordering, rotation, fit/fill, A4/Letter/custom/native paper as supported, margins and actual PDF review. Keep output estimates/cancel/typed output list for PDF-image export; bounded output/memory ownership.
- Normalize JPEG EXIF orientation once into the bounded asset used by preview and export; exercise a portrait EXIF fixture. Signature uploads reuse this contract and retain PNG alpha/colors.
- Page copying can lose forms/bookmarks/tags and rewriting signed content can invalidate signatures. Use structure-preserving operations where verified, otherwise review explicit detected losses and preserve original/history. Do not invent preservation claims.

## Required evidence

Per-service ledger rows 1–6, 8–15, 24 and 28 need specific behavior plus compatible session/result integration. Tests validate actual downloaded/exported PDF content, geometry and annotations, not only internal state or controls.

Keep changes reviewable: Objects first presents a verified signing plus persistent-scene checkpoint before completing Reader/Highlight/Redact; Pages first presents shared selection/page-operation cores before migrating every route. These checkpoints do not close the full Phase 2 acceptance gate. Coordinate brief source/fixture freezes for each real artifact invocation.

1. One open → text → image → signature → edit earlier object after mode switch → organize → review → one final PDF, without intermediate download/reselection. Repeated export idempotent; object move/delete/undo/redo correct.
2. Independent signing journey: typed Turkish name, drawn strokes, upload; ink bounds, clear, move/resize/undo, page 2/rotated/CropBox; actual saved bitmap/fields agree with preview; per-field/flatten failure and retry.
3. Reader selection/search/outline, true highlight annotations and actual redaction extraction checks.
4. All page-operation output page count/order/rotation/boxes/text; source ranges, selected groups, insert/duplicate/keep, per-result split continuation; forms/annotations/bookmark/tag preservation or explicit loss evidence.
5. Both image entry URLs exercise the same composer/core with identical settings/output; every page, fit/fill/rotation/margin and current PDF review verified.
6. Keyboard/mobile/RTL/dark/reduced motion, cancellation/stale operations, failed replacement input, bounded canvases/assets/history and initial request/byte budget.

After focused tests, deploy fresh verification and quality/anti-pattern reviewers. Commit only verified work, no AI attribution; working branch only, no production deployment. Keep all unfulfilled ledger rows explicitly open.
