# Shared image composer checkpoint

This is a bounded Phase 2 implementation checkpoint on verified base
`917f92ee6aa209c7dae2511dcf12d1aa8810b452`. Both retained `/images`
image-import and `/jpg-to-pdf` URLs instantiate `image-tool-entry.js` and the
same `image-composer.js`. There is one canonical document session. Full service,
locale and later-phase acceptance remains open.

## Implemented files and contracts

Composer-owned files: `public/js/{images,jpg-to-pdf,image-tool-entry,
image-composer,pdf-images-workspace}.js`, `public/js/core/{image-limits,
image-intake,image-composition,pdf-images}.js`,
`public/css/image-composer.css`, `tests/image-composer.spec.mjs`,
`tests/{image-composition-core,pdf-images-core}.unit.mjs`, the Images/JPG smoke
migration in `tests/smoke.spec.mjs`, and this document. `page-output-group.js`
has optional shared image-lane/continuation-owner forwarding. The approved
narrow ownership correction also touches `tool-ui.js` and
`document-handoff.js`; all other changes in those shared files belong to the
shared-contract owner and are documented in
`docs/shared-composition-checkpoint.md`.

The actual shared session APIs are documented in
`docs/composition-session-contract.md`. Fresh local images use
`beginComposition`; an inherited chosen image uses
`startCompositionFromCurrent`, preserving its original PDF/task/history. Typed
Images/JPG continuation retains composition before review and after Use without
renormalizing. A deliberate PDF-tool continuation adopts the reviewed PDF,
archives its editable composition, and retains every immutable input original.
Shared compatible history restoration returns Undo to a usable composer.

DOM-free writer APIs:

```js
compositionPageLayout(composition, item)
composeImagesPdf(composition, { resource, pdfLib, signal, onProgress })
estimatePdfImages(bytes, options, { pdfjs, pdfjsAssets, signal })
exportPdfImages(bytes, options, {
  pdfjs, pdfjsAssets, signal, canvasFactory, encodeCanvas, onProgress
})
```

`resource(ref)` returns owned normalized PNG bytes and metadata. Layout keeps
the default Image/Auto 842-point longest edge, or A4/Letter with orientation,
0–72-point margins, per-item clockwise rotation and fit/fill clipping. The
writer validates PNG IHDR dimensions before creating a PDF, deduplicates embeds
by normalized asset reference, saves deterministic bytes, and reopens the PDF to
verify count/dimensions. Selected preview renders those exact saved bytes using
the installed PDF.js renderer, then atomically copies a bounded temporary
canvas to the visible canvas. The temporary carries its selected item ID in
`data-composer-preview`; it is released in `finally`.

PDF image options are `{pages,scale:1|2|3,format:'png'|'jpg',name}`. Estimates
read page metadata without allocating output canvases. Export serially renders
and encodes every selected page, returning a complete named group or rejecting
without publishing a partial group. The shared output group shows 12 rows at a
time, includes all outputs in ZIP, and continues the chosen image bytes.

## Narrow continuation ownership correction

These options are optional; ordinary callers keep their previous behavior:

```js
createOutputGroup(results, { continuationIsCurrent, ...existingOptions })
offerChain(bytes, name, targets, { continuationOperation, ...existingOptions })
stashForChain(bytes, name, slug, { onAdoptionOwner, ...existingOptions })
```

The PDF-images adapter keeps strict source task/revision/PDF-type ownership for
rendering/export. Its separate continuation owner keeps adapter disposal,
export epoch, original task ID and cancellation scope. The group adds its
disposal, AbortSignal and selected-sibling token. `offerChain` requires the
strict source owner to publish controls, then retains the exact canonical
task/revision/generation captured at publication for each native click/retry,
plus the existing result-generation and task checks.

During generic deliberate adoption/begin only, the existing handoff module
synchronously calls `onAdoptionOwner({taskId,revision,generation})` after its
verified canonical rebase and before awaited storage. The observer records
that exact token; it never infers ownership from bytes or predicted revision
increments. It returns no state and is never serialized into workflow or file
records. Canonical assertions, rebase behavior and guarded transactions are
unchanged. This allows retry after a storage error that occurs after chosen PNG
adoption, while rejecting later same-task edits, replacement tasks,
cancellation, Clear or sibling selection.

## Resource and lifecycle policy

The finite session contract retains at most 48 task-lifetime unique originals,
48 normalized asset refs, 48 MiB raw and 48 MiB normalized. All retained resources
including PDF scene/history share 96 MiB/128 refs. Stored file refs remain 160,
session retention 512 MiB and history five entries/64 MiB. Removed inputs still
consume original-source capacity until Clear/new task; admission does not evict
history.

Both the entry transition queue and normalizer reserve pending counts/raw bytes
under the same limits: active plus pending at most 48, pending at most 16,
raw accepted plus pending at most 48 MiB. Reservations transfer to normalization
once, release on rejection/cancellation, and do not multiply accepted capacity.
Abandoned native jobs keep their reservation until they drain. The owned
transition status remains visible while old image work drains, and only its
owning transition removes it.

Each source is a non-empty PNG/JPEG at most 16 MiB, 4096 pixels per edge and
16 million pixels. Normalization owns a decoded bitmap and two full-size
canvases temporarily: at most 48 million live pixels before native codec
internals. It runs serially, closes the bitmap and releases canvases in
`finally`. Writer preflight separately permits at most 48 million **unique
active normalized** pixels before embedding, because installed pdf-lib retains
decoded RGB/alpha channels while building a PDF. Encoded limits and this pixel
estimate are not a hard native heap guarantee.

There are at most 12 visible thumbnails, each 220-pixel longest edge; selected
preview has one visible and one temporary canvas, each at most 1000 pixels per
edge/1 million pixels (combined 2 million). Source comparison uses the same
serial lane. PDF image export uses one canvas at most 4096 edge/16 million
pixels plus one pending codec completion; outputs at most 10,000 descriptors
and 96 MiB; ZIP at most 100 MiB. Decode/encode work can finish after cancellation
but loses publication ownership and drains before successor image work.

Clear invalidates the preview epoch, aborts its owned controller and writer,
zeros the visible canvas, and prevents an old actual render from repainting a
cleared/replaced task. Entry-local PDF intake checks its supplied operation at
every asynchronous precommit boundary.

## Verification and retained failures

First frozen browser gate: 13 cases, **8 passed / 5 failed**, 0 skipped/flaky,
151294.133 ms. Exact JSON:
`/tmp/browserpdf-composer-first13-20261018.json`; traces/artifacts:
`/tmp/browserpdf-composer-first13-20261018/`. It completed and browser closed
before any correction.

The five failures were:

1. Images-to-JPG restoration read session before hydration because a static
   legacy button was already enabled. Wait now requires the visible owned
   composer, `aria-busy=false`, actual selected PDF page and owned enabled action.
2. Chosen page 25 continuation adopted PNG then invalidated its source-PDF
   caller guard. This was the real runtime defect corrected by the narrow
   optional ownership split above. All 25 PNG/ZIP RGB/dimension assertions had
   passed before continuation failed.
3. Held-preview hook filtered landscape width and missed actual 421×842 portrait
   rendering. It now identifies the pinned native context canvas with the
   selected-item temporary marker, after native Rotate, and asserts geometry.
4. Oversized chosen PNG recovery reached Add Text, then checked removed legacy
   `optionsSection`. It now waits for actual `objectWorkspace`/`placementCanvas`.
   Actual >16-MiB PNG reopen/rejection/original-hash recovery had passed.
5. Images smoke ZIP was verified with Split's PDF-name/decoder branch. It now
   verifies every PNG name, count, reopened dimensions and exact rendered pixels;
   Split's existing one-page PDF/text assertions remain intact.

The first gate verified full EXIF 1/3/6/8 quadrants, alpha/SMask,
order/rotation/paper/margins, exact actual-PDF preview, held normalization and
encoder ownership, mixed-intake cancellation, full distinct deduplicated input
names, and native selected-decoder drain. Loaded 320/390/768/1440 English-light
and Arabic-dark/natural 320×720 viewport checks passed; screenshots are retained.
This is targeted usability evidence, not a full translation audit.

First-gate idle graphs passed the unchanged <100000-JS-byte/≤16-request limits:
Images **50587 bytes/11 requests**, JPG **50569 bytes/11 requests**. The graphs
include `pwa`, `i18n`, route entry, `theme`, `consent`, `image-tool-entry`,
`tool-ui`, `core/image-limits` and `core/operation-scope`. No composer,
PDF-images workspace or intake feature module was fetched before intent. The
corrected runtime adds owner handling in existing `tool-ui`; both entry graphs
will be measured again in the corrected gate.

Current Node check: **16/16 passed**, 507.259833 ms, covering composer/export
cores (11) and existing handoff units (5). It includes actual RGB/alpha/geometry,
dedup, forged IHDR/pre-embed preflight, count/byte reservations, held native
normalization/encoding, exact verified owner notification, post-adoption storage
retry, later same-task rejection, callback-copy mutation isolation and callback
non-serialization. Syntax checks
for corrected UI and browser specs pass.

Native PDF-images Use intentionally disposes its old output rail and opens the
chosen image in the composer. Ordinary composer Use→PDF-tool controls keep their
existing default ownership path; there is no synthetic retained-rail Use API.

Revised browser discovery is **19 cases**: original 11 composer cases, five new
typed ownership cases, Images/JPG legacy smokes, and the existing shared
composition Use→public-API PDF-tool handoff→native Undo journey. That shared
case uses native Use/Undo but calls `stashForChain`/`page.goto` for its middle
transition. Actual native default-rail continuation remains an independent
root journey. New cases cover forced
post-adoption bundle failure→native retry→exact chosen image; failed bundle then
later same-task edit→native retry rejected; held cleanup→native sibling→exact
fresh continuation; held adopted bundle→Clear/fresh blue artifact; and held
adopted bundle→new PDF B/exact fresh output. Held tests observe actual native
handler completion and positive successor readiness, without fixed quiet waits.

The corrected frozen 19-case run completed with **18 passed / 1 failed**,
0 skipped/flaky/errors, 41573.133 ms, then browser closed. JSON:
`/tmp/browserpdf-composer-corrected19-20261019.json`; artifacts:
`/tmp/browserpdf-composer-corrected19-20261019/`. Every original 13 case now
passes, including all actual PDF/image/ZIP fidelity assertions and the
previously broken chosen-image continuation. New post-adoption storage retry,
later same-task rejection, native sibling and native Clear/fresh-artifact cases
pass. The new PDF-B case fails before releasing the old held bundle: its helper
accepts an old enabled export control before asynchronous replacement intake
commits. The retained trace ends with the new three-page workspace loading;
the exact B byte assertion was read too early. A test-only semantic readiness
correction waits for fresh-B identity, the three-file estimate, an idle owned PDF
workspace and its enabled owned export action. Exact current/original bytes,
task replacement, fresh actual PNG and old-handler/no-navigation assertions
remain intact. Its allocated final focused run passed **1/1**, 5192.305 ms,
0 skipped/flaky/errors, then browser closed. JSON:
`/tmp/browserpdf-composer-newB-final1-20261019.json`; artifacts:
`/tmp/browserpdf-composer-newB-final1-20261019/`. Corrected 18 plus final 1 gives
**all 19 unique cases passing in aggregate**, not one clean 19-case run.

Corrected idle graphs again pass the unchanged limits: Images **51134 bytes/11
requests**, JPG **51116 bytes/11 requests**, with the same nine-file boot graph
and no feature composer/workspace/intake module before intent.

Independent root/fresh-review artifact journeys, wider affected regression,
full locale/storage platform acceptance, Highlight/Redact, remaining Phase 3/4
services and final all-32 ledger gates remain open. No commit, push, deployment
or overall completion is implied by this checkpoint.
