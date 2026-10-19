# Remaining Phase 2 implementation handoff

Read the primary goal, all 32 acceptance rows and later phases in `02-browserpdf-service-improvements.md`, then `02-phase2-workspace-handoff.md`. This handoff follows the compact editor and first page-route checkpoint. It does not replace the authorized complete program.

## Starting state and rules

The verified scene/core checkpoint is commit `91015ada77e300fc78d619f9edfec0dc21dd8220`. The subsequent compact editor/Organize/Rotate/Delete/Crop/Merge work is awaiting its final frozen release gate and verified commit. Use the actual resulting HEAD when assigned; never reset to the older checkpoint.

The root owns the durable server at `http://localhost:8788`, independent review document and user communication. Never start or stop that server. Use `BASE_URL=http://localhost:8788`, pinned installed Chromium and one allocated browser invocation at a time. Playwright globalSetup rewrites shared fixtures; coordinate every invocation and source/test freeze. Synthetic independent probes use their own temporary input/output directories.

All shell commands use `rtk`. Do not commit or push before delegated verification and coordinator approval. Preserve the untracked audit directory. Do not spawn nested workers. At most two implementation workers run alongside root and the coordinator.

The complete program remains open: reader/highlight/redaction, remaining page/composer modes, conversions/OCR/compression, platform services, localization and final delivery. A continuation link alone never completes a row.

## Ownership

- **Reader/annotations worker:** View PDF, Highlight and Redact routes/modules; shared `tool-ui.js`, `document-result.js`, `core/document-session.js`, object scene/route/workspace, bounded renderer/geometry/font contracts and `document-workspace.css`. Existing text/image/signature behavior must remain intact.
- **Remaining pages/composer worker:** Split, Page Numbers, Watermark, PDF/Images and JPG/PNG-to-PDF routes; separate page/composer modules and scoped CSS; shared page operation cores. Request narrow shared changes through the Reader/annotations owner rather than editing its files.

Both owners keep existing entry URLs and locales. New copy may use `t(key,fallback)` during this implementation checkpoint; the complete central locale migration remains required later.

## Current contracts to reuse

- `getWorkspaceInput({bakeScene=true,operation})` returns owned candidate bytes, name, revision, selection, scene presence and finite boundary losses. It renders pending scene edits without adopting a lossy page candidate.
- Workspace-input/extra-source/preview bodies now live in retryable lazy `document-workspace-support.js`; owned handoff bodies live in `document-handoff.js`. `tool-ui.js` keeps its public wrappers, canonical generations and stable session delegate. Both optional modules receive that existing delegate; never create another session or import a second absolute tool UI from a localized route. Empty or unrelated handoff URLs return before requesting the handoff module. These helpers belong to the Reader/shared owner.
- `reviewResult(bytes,name,{operation,capabilities,boundary,onAdopt,allowAdopt})` reviews the real file. `onAdopt(snapshot,artifact)` is a synchronous notification after guarded explicit adoption; a consumer owns its subsequent asynchronous hydration, busy state and errors. `allowAdopt:false` omits redundant adoption for an already-published current scene. Explicit final download is a download.
- `readExternalPdfFile(file,{maxBytes,maxPages,signal})` validates an extra source without changing canonical task/current/original/scene/result. Defaults are 80 MiB/5000 pages; explicit maxima are 250 MiB/10000 pages. Callers reserve combined totals and own cancellation/queues.
- `applyPagePlan` returns verified saved bytes, finite structural boundary, inspected structures, actual saved-field/encryption capabilities, page map and summary. Original-order rewrite and reordered/copied results have distinct loss contracts.
- Scene objects survive tool URLs as editable objects. Assets are separately deduplicated/bounded; history holds scene geometry and source references. Originals remain immutable. PDF/history/resource/session limits and transactional candidate validation must remain explicit.
- Preparation ownership now gates asynchronous selected text and all signature capture sources. New intent hides obsolete results/continuations immediately. Stale completion cannot unlock newer work. Rejection restores validated inputs/assets. Background preparation keeps a valid current-scene preview running; accepted scene change owns cancellation/rescheduling.
- `#placeDraftBtn` means **Place draft on current page**. It centers validated text/signature bounds and explicitly reveals the focused object. Background typing/rendering preserves focus/caret/scroll.

Localized modules are distinct URLs. Instrument the actual entry-derived `./tool-ui.js`; importing absolute `/js/tool-ui.js` from `/ar/` or `/tr/` can observe a separate empty session. This was proved by independent snapshots and was not a product readiness defect.

Keep the initial-delivery gate unchanged at fewer than 100,000 requested first-party JavaScript bytes and at most sixteen idle requests. The lazy extraction was measured at Privacy Scan 94,752 bytes/fourteen requests and Workflows 96,184/fifteen; optional helpers were absent on all five audited idle routes. New feature and locale behavior must preserve that headroom by loading on use.

## Reader/annotations work

Land reviewable checkpoints rather than one large untested rewrite: reader first, then persistent text-bound highlights, then safe redaction and final scene/handoff boundaries.

1. **Reader:** selectable/searchable bounded text layer, outline, thumbnails, page/zoom navigation and shared current document. Use direct PDF.js APIs, not a complete viewer or scripting surfaces. Installed primary type definitions expose `TextLayer`, `render/update/cancel`, `textDivs` and `textContentItemsStr`, plus outline/destination/page-index and text-content APIs. Verify exact pinned runtime signatures and matching CSS before implementation. Search/text caches, results and outstanding page work need explicit limits/cancellation; test a long/extreme page as well as ordinary pages. Form interaction must use existing custom page-linked controls or an explicit Fill & Sign continuation.
2. **Highlight:** actual text selection creates persistent PDF highlight annotations with correct quads under rotations/CropBox/UserUnit. Each annotation has editable color/note, selection/delete and undo/redo. Retain underlying text. Extend the finite scene schema and real renderer deliberately, preserving existing object kinds and bounds. Verify any low-level PDF writer APIs against installed source/primary specification; do not invent a high-level annotation API. Reopen actual downloaded PDFs and inspect annotation dictionaries plus rendered appearance and text retention.
3. **Redact:** exact visual mask coordinates; real removal in the exported PDF; explicit page/document raster or structural loss; actual output review. Preserve untouched text only when source references are proven safe. Never call a white overlay or CropBox change removal. A stronger explicit whole-document raster fallback is acceptable for unsafe/unknown reference graphs, with precise losses and cancellation. Output capabilities must reflect removed text/forms and rasterization. Undo deliberately restores the previous editable task; distinguish the exported redacted copy from the retained original.

The existing plain-page smoke assertion that untouched pages retain their text remains an acceptance intent. Do not silently replace it with whole-document raster expectations. Implement a bounded, verified safe-preservation path for that supported corpus, or expose the fuller-document raster operation as an explicit mode with its own loss review and artifact checks. Unsafe or unclassified reference graphs must use the explicit fallback rather than claiming safe preservation. Both reference hazards below still require exported-artifact proof.

Redaction must cover these independently reproduced hazards:

- Repeated AcroForm widget Parent/Kids/P links: copying untouched pages can pull a replaced secret page back as an orphan. Root proof `/tmp/browserpdf-root-redaction-copy-hazard.json` and PDF, generator `/tmp/browserpdf-independent-redaction-copy-review.mjs`: 3 visible pages but 6 PageLeaf objects; decoded source text remains.
- Internal Link/Dest references: root proof `/tmp/browserpdf-root-redaction-link-hazard/results.json`, source/copied PDFs and `/tmp/browserpdf-independent-redaction-link-review.mjs`: 2 visible pages but 3 PageLeaf objects; decoded stream retains `ROOT LINK TARGET SECRET8147`.

These are library/current-algorithm proofs, not sufficient route verification. Portable repository tests generate their own repeated-form and internal-link fixtures. Inspect orphan/source streams and metadata as well as visible extraction. Forms-only sanitization is insufficient.

Two remaining shared handoff checks belong to this owner before full Phase 2 completion:

- A valid editable source of at most 80 MiB plus assets can produce a current PDF larger than 80 MiB while staying within retained resource/session limits. Verify inherited-scene mode switching or document an exact transactional cap policy; do not silently lose the task after accepting it.
- Implicit mode continuation bakes unapplied scene edits. Verify that known text searchability and actual surviving/flattened forms propagate just as deliberately as explicit Apply; preserve inherited known facts when the transform does not remove them.

## Remaining page/composer work

Land Split/Numbers/Watermark as a reviewable route checkpoint, then the genuinely shared image composer and PDF-image export.

1. **Split:** strict ranges, odd/even and Shift/common selection; named output list with user-editable filenames and safe collision/extension handling; deliberate chosen-PDF continuation; bounded ZIP/final download and cancellation. Ordinary inputs with more than 20 outputs must not silently truncate because generic `reviewResults` currently caps a group at 20. Use a bounded paged/lazy list or explicit supported group policy with honest aggregate limits. Every selected output needs the correct bytes, name, capabilities and structural boundary.
2. **Page Numbers:** range/start page/start number/font/margins; navigation and actual saved-PDF preview. Common geometry and deliberate selected scope. Exported numbering/font/position must match preview and survive reopening.
3. **Watermark:** Unicode and visible unsupported-script handling; selected scope; logo/tile/custom position; real selected-page PDF preview and export. Reuse normalization/EXIF and geometry contracts. Do not substitute missing glyphs or repeat old stale preview/export behavior.
4. **Shared image composer:** both `/images` image-import mode and `/jpg-to-pdf` delegate to the same implementation. Thumbnails, keyboard ordering/removal, rotate, fit/fill, A4/Letter and margins; explicit image limits and actual reviewed PDF. Normalize JPEG EXIF consistently before preview/export, without double rotation. Bound decoded dimensions/pixels, pending inputs, thumbnails and aggregate bytes; avoid retaining every full decoded bitmap.
5. **PDF to Images:** shared selection, resolution and memory/size estimate; cancellation; named output list and bounded ZIP; selected artifact continuation. Estimates are explicitly estimates; actual result sizes and page identities remain inspectable. Output lists must not silently discard pages.

Operation cores stay DOM-free and injected where necessary so later Workflows composition uses the same supported operations. Preserve SDK public/private boundaries and pinned dependencies; coordinate ownership and verification with the build lead before changing copied SDK cores or runtime versions.

## Verification and later phases

Each checkpoint needs actual user-facing operation and downloaded-artifact checks, then fresh independent review. Check loaded task layouts with meaningful filenames and controls at the planned mobile/desktop widths, themes and RTL; an empty landing-page overflow check does not cover the loaded workspace. Preserve the existing strict geometry/pixel/original/history/cancel tests. Do not replace them with internal state or source-shaped assertions. The original pixel oracle's full-resolution comparison remains unchanged: attached same-CSS saved-PDF render, exact stamp pixels and original text thresholds; do not revive the rejected blur/resolution/tolerance workaround.

The compact/signing checkpoint already has independent eight-context saved-PDF evidence, native mobile touch/cancel decoded RGB/alpha proof, selected held-BETA/DELTA bitmap proof and a one-open text→image→signature→Organize→Undo/Redo→one-download journey. Reuse those fixtures/contracts as regression context, while generating portable test inputs rather than depending on root temporary files.

After full Phase 2, continue Phase 3 and Phase 4 from the primary plan. In particular, the standalone OCR route still skips rotations and filters recognized characters through Helvetica; shared extraction fixes do not complete it. Root has independent DOCX/Markdown/XLSX and structural compression corpora ready for later artifact verification. No service ledger row closes until its actual route, output, locale and compatible continuity criteria have evidence.
