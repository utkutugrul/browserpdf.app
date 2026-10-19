# Phase 2: annotations, safe redaction and image composition

## Primary goal

Continue the same chosen document through text-bound highlights, verified redaction and image conversion without losing editable work, choosing the wrong page or exporting a stale result. This is the remaining Phase 2 checkpoint; the complete 32-service program, conversion/OCR/compression work and platform/localization phases remain required.

Read `02-browserpdf-service-improvements.md`, `02-phase2-remaining-handoff.md`, `../docs/reader-checkpoint.md` and `../docs/page-effects-checkpoint.md`. Start from the actual verified Reader/Pages checkpoint HEAD supplied by the coordinator, never reset to an older commit. Preserve the untracked audit directory and unrelated files. No main push, production deployment or attribution in commits.

## Coordination and ownership

Root owns the durable `http://localhost:8788` server, independent review document, final regression window and user communication. Never start/stop that server. All shell commands use `rtk`; browser/globalSetup invocations require an allocated exclusive window and a public/test source freeze. Portable tests generate their own fixtures. Root's `/tmp` corpora are independent comparison evidence, not repository-test dependencies.

Two fresh implementation owners work without nested agents:

- **Reader/shared/annotations:** View PDF, Highlight, Redact; `tool-ui.js`, session/scene/resource/handoff/result contracts, object routes/workspace, Reader, bounded renderer/fonts/geometry and shared document CSS. First coordinate the bounded image-composition state contract needed by the other owner, then deliver a reviewable Highlight checkpoint, then safe Redact. Preserve the verified text/image/signature behavior.
- **Image composition/export:** `images` and `jpg-to-pdf` retained entries, one common composer, PDF-to-images route, injected image operation cores, scoped CSS and related tests. Request narrow shared state changes through the shared owner. Pure layout/export work may proceed while the shared contract is implemented; callers copy the resulting documented APIs.

Keep checkpoints small enough for actual artifact verification and fresh review. Do not wait for one enormous final rewrite. Do not close a service row for adding navigation alone or leave later phases silently deferred.

## Existing verified contracts

- `getWorkspaceInput({bakeScene=true,operation})` returns owned bytes, `capabilities`, name, revision, selection, scene presence and explicit bake losses. Implicit publication must consume the returned capabilities. Known searchability survives image/signature-only transforms; actual added text derives `searchable:true`; actual surviving fields and encryption are reported deliberately.
- Reader uses direct pinned PDF.js 6.2.108 `TextLayer`, cancellable `streamTextContent`, outline/destination/page-index APIs. There is one visible text layer, a four-page/1.5-million-character cache, pre-DOM limits of 12,000 runs/500,000 UTF-16 characters/512 styles per page, 200 disclosed search hits and eight bounded thumbnails per window.
- Reader `onPage`, `onSelection` and API `viewport` expose **logical display geometry**. The native canvas stays at a 1,200-pixel longest dimension/2M-pixel bound. Its optional `displayViewport` renderer argument uses documented `RenderParameters.transform`; native dimensions cannot be used directly for client selection rectangles. CSS zoom 25/100/125/400%, fit restoration, four rotations/CropBox/UserUnit and strict native ink alignment have actual browser evidence.
- `createPageWorkspace({...,disabled})` supplies canonical selection/ranges/parity/Shift/keyboard behavior, a twelve-thumbnail window and `setDisabled(boolean)` preserving native window bounds.
- `createOutputGroup(results,{container,signal,isCurrent,onAdopt,zipName})` returns a handle **synchronously**, with `artifacts`, `dispose`, `select` and `.ready`. Register disposal before awaiting. Disposal aborts ZIP, clears descriptors and empties detached rows. Complete groups support up to 10,000 entries/96 MiB, twelve visible rows, safe editable names and a 100-MiB ZIP ceiling. No silent twenty-output truncation.
- `reviewResult` previews actual output; explicit Use adopts only the chosen result. Explicit final Download remains a download. A source/result toggle should preserve the selected affected page. Operation generations protect review and continuation publication.
- Editable PDF scene sources remain at most 80 MiB. An owned inherited scene can carry a current PDF above 80 MiB up to 250 MiB when source/assets/retained budgets validate transactionally; resources are at most 96 MiB and retained session at most 512 MiB. Original bytes remain immutable.
- Native file tests must wait for an enabled input/chooser. `setInputFiles` bypasses disabled/inert controls. Preserve immediate reachable-user races and all saved-artifact assertions; avoid fixed delays and repeated unreachable setup failures.
- Localized entry URLs own distinct modules. Derive `./tool-ui.js` from the actual entry; absolute `/js/tool-ui.js` can observe a separate empty session on `/tr/` or `/ar/`.
- A pending PageEffects opening is serialized before installing its successor. Candidate intake sequencing is distinct from validated surface ownership; an invalid replacement must not dispose the retained opening. An old disposal must never clear a successor's review, controller or loaded styling. This now has both portable and independent native replacement artifact tests.

Initial-delivery limits remain below 100,000 requested first-party JavaScript bytes and at most sixteen idle requests. Load new feature code on use; do not raise thresholds or load complete PDF viewer/scripting layers.

## Shared image-composition state comes first

The current session has one original artifact plus validated PDF scene references. `collectResources`, transfer/history and adoption understand that schema. A free-form extra bag does not retain multiple immutable originals or editable composition state safely.

The fresh owners agreed a proposed bounded composition descriptor: `{version:1,items:[{id,originalRef,assetId,width,height,rotation,fit}],paper,orientation,margin,selectedId}`. Rotation is 0/90/180/270, fit is fit/fill, paper is image/a4/letter, orientation is portrait/landscape and margin is finite 0–72 points with positive remaining content. Image paper defaults to zero margin and preserves the old 842-point longest edge; fixed-paper orientation is inactive in that mode. These are new internal APIs to implement and verify, not existing methods: `composition`, `compositionSources`, asynchronous transactional `beginComposition`/`appendCompositionInputs`, synchronous `changeComposition`/`setCompositionSelection`, `publishComposition`, and typed `stashCompositionForChain`. Guards carry expected task/revision and signal; asynchronous intake also captures generation.

Validate every resource and reference before committing identity, and deduplicate bytes across history. A separately validated task-lifetime `compositionSources:{version:1,originals:[{originalRef,name,type}]}` keeps all raw originals reachable through general adoption and finite history eviction. Removing an item does not free original-source capacity; new task/Clear releases that provenance deliberately. A finite `reviewResult` composition revision dispatches explicit Use through guarded publication while retaining editable composition; general adoption archives and clears active composition. Publication has an explicit published-edit revision for idempotence. Source comparison offers all originals through one bounded lazy selected preview. Transfer and typed composition handoff retain the descriptor/resources without renormalizing; generic PDF mode transitions must describe the editable-composition boundary deliberately. Resource collection, expiry, failed storage and stale handoff paths remain scoped. Do not create an unrelated persistent composer task or serialize passwords/private unrelated inputs.

The agreed starting policy is 48 active-plus-pending source entries, including at most sixteen pending; at most 48 retained unique original refs and 48 normalized refs across active/history/future; serial normalization; 48 MiB raw plus 48 MiB normalized. **All** retained session resources, including any PDF scene/history source, jointly remain within 96 MiB/128 resources, and serialized file references remain within the store's 160-reference bound. The 512-MiB session and five-entry/64-MiB history bounds remain. Admission rejects transactionally without secretly evicting history. Per-source limits are 16 MiB/4096-edge/16M pixels; thumbnails retain twelve 220-pixel canvases and preview retains one 1200-edge/2M canvas. Existing normalization can temporarily own a bitmap and two full-size canvases, so up to 48M live pixels need to be included; native codec heap is not a hard application-memory guarantee. Abandoned native jobs keep their reservation until drained. Compatibility-preserving normalization adds signal boundary checks and explicit canvas cleanup through the shared owner. Actual implementation and combined-resource rejection still require proof.

## Highlight checkpoint

Implement true text selection and persistent PDF Highlight annotations, per-object color/note/delete and undo/redo across tool URLs. Keep source text readable/searchable and repeat export idempotent. Selection limits must be explicit; arbitrary angled, skewed or vertical writing is unsupported until proven, rather than approximated silently.

Extend every generic scene renderer/inspector deliberately when adding annotation kinds. Legacy text/image/signature modes must handle or explicitly filter annotation properties while retaining their actual appearance; an annotation cannot fall through the image-asset branch or acquire stale quads through unrelated drag controls. A required actual journey is Text/Image/Signature → Highlight → Add Text → Highlight, then annotation edit/delete/Undo and one final export proving every surviving object and highlight exactly once.

Primary APIs were preflighted against pdf-lib 1.17.1: `PDFContext.obj/register/flateStream`, `PDFPageLeaf.addAnnot`, `PDFAnnotation.fromDict/setNormalAppearance` and `PDFHexString.fromText`. Plain strings passed to `context.obj` become PDF names; Unicode note/identifier strings require PDF string objects. Adobe PDF 1.7 Tables 8.30/8.21 define default-user-space quads and appearance precedence. An explicit AP owns transparency through its ExtGState; do not rely only on annotation `CA`. Pinned PDF.js validates quads and normalizes axis boxes. Verify the installed APIs again at the writer boundary.

The offline writer preflight `/tmp/browserpdf-highlight-writer-preflight.*` demonstrated four rotations/CropBox/UserUnit 2, actual Highlight/AP/Unicode notes/text retention and visible ink; it is not route acceptance. Portable route tests inspect saved dictionaries, quads/AP/opacity, retained source text and rendered pixels, then edit/delete/undo across actual routes.

Unify navigation ownership during this extension: held named-outline destination resolution must lose to a newer direct page/search/thumbnail choice. Add a held resolver regression proving the actual selected/rendered page, not only a token value. Keep native Shift/selection shortcuts and the verified mobile initial PDF visibility.

## Safe Redact checkpoint

Visual overlays or CropBox changes do not remove content. Export must remove the selected secret and source metadata from **all indirect objects**, including orphan pages/decoded streams, while retaining the deliberately chosen original in session history. The cleaned chosen copy continues into inspection without rebaking secret source bytes.

Preserve the existing plain-safe untouched-page selectable-text acceptance. Use a strict bounded content/operator/font allowlist and rebuild safe primitives/resources in a **fresh context/pages without PDFObjectCopier or copyPages**. Selected pages can rasterize. Unknown fonts/encoding, annotations, forms or reference graphs require an explicit fuller-document raster mode with precise losses, preview, cancellation and review; do not silently change the old smoke to accept universal rasterization.

Root proved two copy hazards independently: repeated AcroForm Parent/Kids/P links and internal Link/Dest references both pull replaced secret pages back as orphans. Forms-only sanitization is insufficient. See the proof paths in the remaining handoff and independent review document. Root's `/tmp/browserpdf-root-redaction-corpus` has plain/repeated-form/internal-link variants; `/tmp/browserpdf-root-redaction-inspect.mjs` scans all PageLeaf objects, raw/decoded unique secret strings and Info/XMP. Portable tests create their own equivalents and inspect actual downloaded files.

Capabilities reflect the real path: a fully raster result is `searchable:false,forms:false,rasterized:true,encrypted:false`; a proven safe hybrid derives facts deliberately. Review states selected/document scope and structure loss. Undo restores the prior editable task; a later compatible tool receives the chosen redacted bytes.

## Shared composer and PDF-image export checkpoint

Both `/images` image-import mode and `/jpg-to-pdf` must delegate to one implementation. Normalize JPEG EXIF exactly once using existing `imageAsset(file,{trim:false})` before preview/export, preserve alpha and proportion, and release large decoded images. Add ordered thumbnails, keyboard order/removal, rotation, fit/fill, A4/Letter and margins. Actual selected-page PDF preview and final export use the same injected layout core.

PDF-to-images uses canonical common page selection, meaningful resolution/memory/size estimates, owned render and encoding cancellation, a complete named result list/ZIP and chosen-image continuation. Noncancelable codec completion loses publication ownership after Cancel/Clear/replacement. Source bytes are immutable; no unbounded all-page thumbnail DOM or retained full bitmap list.

Root's independent four-quadrant EXIF 1/3/6/8 corpus and expected normalized PNGs are ready at `/tmp/browserpdf-root-image-corpus`. Portable tests own their fixtures and inspect actual saved PDF RGB/alpha/order/rotation/fit-fill/margins through both entry URLs. Exercise held normalization and encoding, rapid different-page/file intents, clear/replacement/stale completion, actual output limits, undo and same-task continuation.

## Gates and continuation

Each checkpoint needs source/API discovery, actual UI and saved-artifact tests, fresh code/anti-pattern review and a verified focused commit/sync. Preserve native-resource, strict attached same-CSS pixel and real fast-action tests. Confirm loaded 320/390/768/1440 light/dark/RTL surfaces and full accessible filenames. New copy may temporarily use `t(key,fallback)`; full central 22-locale migration remains a later required phase, including old semantic keys/FAQ/JSON-LD.

After full Phase 2, immediately continue Phase 3 and Phase 4. Standalone OCR, shared Markdown/Word/text models, editable spreadsheet converters, meaningful structural compression, actionable Privacy/Doctor, protection return intent and composed Workflows remain required. Root has DOCX/Markdown/multisheet XLSX and raw-stream structural compression corpora/preflights; those are independent feasibility evidence, not implemented route acceptance. Do not finish the overall task at this checkpoint.
