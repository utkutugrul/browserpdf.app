# Page route checkpoint — 2026-10-18

Implementing-worker checkpoint for Merge, Organize, Rotate, Delete Pages and
Crop. The earlier [core/panel checkpoint](page-workspace-checkpoint.md) and its
original evidence remain intact. Root's subsequent independent compact, touch,
single-document task and fresh preparation checks passed as recorded below.
This checkpoint does **not** close the service ledger or the full regression
gate: root's frozen 204-case invocation subsequently found three failures.

## Files and route cutover

- `public/js/page-route.js` lazily opens the shared task surface after validated
  canonical intake. Existing `organize.js`, `rotate.js`, `delete-pages.js` and
  `crop.js` are thin retained-URL adapters.
- `public/js/page-task-workspace.js` owns page plans, local plan history, actual
  selected-page preview, operation/review lifecycle and document-mode controls.
  It uses the existing selection/plan/executor cores rather than a second page
  engine.
- `public/js/page-workspace.js` remains the shared selection/thumbnail panel.
  Tiles retain both `page-workspace-tile` and `page-tile` classes for existing
  entry-point automation compatibility.
- `public/js/merge.js` retains ordered keyboard controls, progress, result
  invalidation and metadata-only WebMCP registration. Its lazy
  `merge-page-adapter.js` adds source ranges/thumbnails and delegates output to
  the shared executor.
- `public/js/core/page-operations.js` additionally returns output capabilities
  from its existing strict reopen. No additional output parse is introduced.
- Scoped styles are in `public/css/page-workspace.css`. Crop, Rotate and
  Organize HTML explanations were corrected where semantics changed.
- `tests/page-routes.spec.mjs` initially added thirteen portable browser/artifact
  cases; three further Crop regressions subsequently passed. Five more history/
  presentation recovery cases are added and await their allocated invocation.
  The Crop smoke oracle now checks the visible CropBox and retained MediaBox.

## Public contracts and UI semantics

`startPageRoute(mode)` accepts the four retained page-operation entry modes.
`openPageTask(mode,{isCurrent})` returns a disposer owned by that route/task.
Canonical intake uses `readPdfFile(file,{validate:true,maxPages:10000})`; malformed,
oversize and over-page-limit validation happens before replacing the task.

The adapter consumes these Objects-owned APIs without owning their files:

- `getWorkspaceInput({operation})` returns an owned current PDF, including
  pending scene edits, without adopting it. The original and editable scene
  remain available until a result is explicitly chosen.
- `reviewResult(bytes,name,{operation,adopt:false,boundary,capabilities,onAdopt})`
  shows the actual generated PDF. `onAdopt(snapshot,artifact)` is a synchronous,
  generation-guarded notification after explicit canonical adoption; the page
  adapter owns its subsequent asynchronous hydration and errors.
- `readExternalPdfFile(file,{maxBytes,maxPages,signal})` validates owned extra
  sources without beginning/adopting/resetting current/original/scene, or
  changing canonical intake/result generation. Its default page limit is 5,000;
  these routes explicitly request the permitted 10,000-page limit.
- `stashForChain` carries the chosen current task/history/scene through the owned
  local handoff store. Empty-session adoption initializes a task ID; continuing
  a manually merged chosen PDF retains task ID, name and revision.

Core/session indices are zero-based. Range text and destination controls are
one-based. Shared ranges accept `1-5,8`, validate visibly, and share All/None,
Odd/Even, Shift and keyboard selection. Thumbnail plan changes retain page IDs;
navigation follows the same page identity after moves and chooses a documented
remaining-page fallback after deletion.

Stable route controls:

| Purpose | Controls |
|---|---|
| Task/current identity and mode | `pageTask`, `pageTaskIdentity`, `pageTaskStatus`, `workspaceModes` with `data-mode` |
| Actual page preview | `previewCanvas`, `pagePreviewNumber`, `previousPageBtn`, `nextPageBtn`, `pagePreviewStatus` |
| Plan history | `undoPageEditBtn`, `redoPageEditBtn`, `discardPageEditsBtn` |
| Chosen-document history/recovery | `undoDocumentBtn`, `redoDocumentBtn`, `replacePageInputBtn`, `retryPageWorkspaceBtn` |
| Group order/insertion | `moveBeforePage`, `moveSelectedBtn`, `duplicateSelectedBtn`, `insertPdfInput`, `insertPageRanges` |
| Rotate/delete | `rotateSelectedLeftBtn`, `rotateSelectedRightBtn`, `resetBtn`, `deleteSelectedBtn`, `keepSelectedBtn` |
| Crop | `cropTop`, `cropRight`, `cropBottom`, `cropLeft`, `cropSelectedBtn`, `resetCropBtn`, draggable `pagePreviewSurface` |
| Review/export | `applyBtn` reviews; shared `useResultBtn` chooses current; `downloadResultBtn` explicitly downloads |

Organize moves/duplicates selected groups, inserts optional external ranges and
supports delete/keep/rotate plus bounded local history. Destination last-page
plus one appends. Rotate distinguishes selected pending changes from original
page rotation; Reset removes the selected pending rotation. Delete prevents
removing every page and previews remaining order; Review can apply an initial
selected deletion directly for retained entry-point behavior. Current-document
Undo is separate from local page-plan Undo.

Crop supports selected scope, page navigation, a draggable visible rectangle
and keyboard numeric visible-edge insets. Geometry uses PDF.js inverse viewport
transforms, including existing rotation, nonzero CropBox and UserUnit. It changes
CropBox while retaining MediaBox. The interface and review explicitly state
that hidden content remains recoverable and cropping does not securely erase it.

Merge shows a bounded thumbnail and optional range per source, keeps existing
keyboard order controls, and reviews the actual combined output. A chosen output
can continue through the same task instead of an intermediate download/reselect.

## Ownership, readiness and output limits

Initial controls remain inert/disabled with `aria-busy=true` until owned input
hydration succeeds. A held post-begin parse cannot trigger mode changes or an
operation against null plan/panel state. Failed initialization/adoption
hydration keeps old operation controls disabled and offers Retry current
workspace or explicit PDF replacement. A stale/cancelled reset cannot release
old controls. Early Use during a held result render cannot race review's
`finally` block into unlocking the old plan.

Pending plans, crop drafts and reserved insertion intents block deliberate mode
changes. Users must review/use or explicitly discard them. Genuine same-origin
page links have the same protection. Explicit download anchors and non-HTTP(S)
URLs are exempt, so a final Blob download is not mistaken for navigation. Review
does not adopt or automatically download a lossy page-copy result.

Every plan change invalidates the preceding review. Processing captures its
plan/revision and owns an AbortSignal; canceled or stale work cannot publish.
Result adoption starts owned hydration before page actions unlock. Canonical
Undo can restore the preceding editable scene after a page boundary.

External Merge/Insert intake reserves byte/count budgets before asynchronous
reads and queues intended additions in input order. Insert destinations capture
stable target-page IDs, so successive additions at the same original location
keep order. Clear/discard aborts owned readers, releases their reservations and
detaches the abandoned queue; a held old `File.arrayBuffer()` cannot block fresh
intake or publish when it eventually resolves. Extra-source validation never
replaces the canonical source task.

The existing core limits remain 20 sources, 250 MiB combined inputs and 10,000
plan pages; Merge additionally caps combined source-page counts at 10,000.
Plan history is bounded to 30 past steps and 60,000 retained page records.
The common panel retains at most twelve 220-dimension/220,000-pixel thumbnails
and two owned PDF.js source proxies. The central preview is bounded to a
1,200-pixel longest dimension and 2,000,000 pixels. Merge retains at most twenty
100-dimension/10,000-pixel file thumbnails and renders them sequentially with
owned task disposal. These are application ownership bounds, not engine peak
heap guarantees.

`applyPagePlan` now returns
`{bytes,pageMap,summary,structures,capabilities,boundary}`. Original-order
single-source rotation/crop modifies the loaded document; reorder/insert/
duplicate/delete/merge uses a page-copy result. Saved output is reopened and its
expected page count checked. Interactive-form capability comes from actual
saved fields, not merely presence of an AcroForm dictionary left after
flattening. Unknown malformed-field capability is omitted. Page-copy routes
report `forms:false`; successful outputs report `encrypted:false`.

Finite boundary codes disclose potential page-copy metadata/form/bookmark/tag/
named-resource/label loss, incomplete structural inspection and signature
rewriting. They contain no field values/names, source filenames, paths, URLs or
bytes. Included pending object edits, form-field edits or flatten-only scene
state report `scene-baked`, with wording about including pending edits and Undo;
the label does not falsely claim every form operation was flattened. Tested
catalog/form preservation is scoped evidence, not certification of arbitrary
PDF structures, accessibility, links or digital signatures.

## Verification and preserved failures

Both final commands ran sequentially against root's existing server under one
agreed source/fixture freeze, one worker and the pinned Chromium. No server
process was started/stopped and no source changed between them.

```sh
rtk proxy env BASE_URL=http://localhost:8788 PLAYWRIGHT_JSON_OUTPUT_NAME=/tmp/browserpdf-pages-route-second-20261018.json npx playwright test tests/page-routes.spec.mjs tests/page-workspace.spec.mjs --workers=1 --output=/tmp/browserpdf-pages-route-second-20261018 --reporter=line,json
# 22 passed; JSON duration 62.340 s; 0 skipped/flaky/unexpected.
rtk proxy env BASE_URL=http://localhost:8788 PLAYWRIGHT_JSON_OUTPUT_NAME=/tmp/browserpdf-pages-merge-regression-20261018.json npx playwright test tests/phase1.spec.mjs --grep 'merge exposes|merge cancels' --workers=1 --output=/tmp/browserpdf-pages-merge-regression-20261018 --reporter=line,json
# 3 passed; JSON duration 15.154 s; 0 skipped/flaky/unexpected.
```

The first route attempt requested 21 cases. Organize reached the real result
review but its final download timed out because the pending-plan navigation
capture guard also blocked generated Blob download anchors. At root's request,
the invocation was interrupted to avoid repeating the same long timeout:
**1 failed, 1 interrupted, 19 unstarted, 0 completed passes; exit 130**. The JSON
reporter did not write a report before termination. The original trace and error
context remain under `/tmp/browserpdf-pages-route-first-20261018/`; the explicit
observed-count record is
`/tmp/browserpdf-pages-route-first-20261018-termination.json`, not a fabricated
Playwright reporter JSON. The guard was corrected; the passing Organize case now
checks a genuine pending-plan navigation link and an actual final PDF download.
The subsequent initialization case increased the final suite to 22 cases.

Saved PDFs under `/tmp/browserpdf-pages-route-second-20261018/`:

| Artifact basename | Verified behavior |
|---|---|
| `organized-ranges.pdf` | Group move/duplicate/delete/undo/redo/external range insertion; exact A, external-2, D, B, C visible order; explicit adoption and current-document Undo |
| `selected-rotation.pdf` | Selected/reset rotation; actual saved form value, title and tested outline catalog retained; OCR continuation |
| `kept-pages.pdf` | Cannot delete all; keep selected B/D; remaining order and plan undo/redo |
| `cropped-rotations-userunit.pdf` | Four independent raw-box oracles with UserUnit 2, unchanged MediaBox; restored visibility recovers hidden edge text |
| `selected-drag-crop.pdf` | Drag maps to selected page only; failed external validation leaves canonical snapshot unchanged |
| `merged-source-ranges.pdf` | Keyboard file order plus source ranges; actual B2/A2/A3 order; manual Use then Organize retains identity/revision |
| `fresh-after-cancel.pdf` | Initial held read cleared; fresh files can merge before old read release; late old source absent |
| `flattened-form-rotated.pdf` | Form-only flattened scene text retained; saved fields empty and chosen current forms capability false |
| `merge-field-only.pdf`, `merge-flatten-only.pdf` | Pending-edit boundary disclosure and real three-page outputs for both scene states |
| `ready-selected-rotation.pdf` | Held initialization keeps controls/task inert, then actual selected rotation succeeds |
| `group-insert-duplicate-crop.pdf`, `catalog-preserving-rotate-crop.pdf`, `extreme-aspect-pages.pdf` | Repeated core/panel artifact checks, bounds, disposal and tested structural behavior |

Other passing cases cover canceled core loading, early adoption while result
render and hydration are independently held, failed hydration Retry/replacement,
strict ranges/parity/Shift, stable-ID navigation, task replacement and bounded
dark/RTL panel windows at 320/390/768/1440. This does not establish a complete
independent usability/layout pass for all newly loaded routes.

## Subsequent independent evidence and full-gate findings

Root's independent record is authoritative in
`docs/service-improvements-independent-review.md`; it remains root-owned.

- All eight compact signing journeys passed together on frozen product source:
  `/tmp/browserpdf-root-compact-layout-third/results.json`, natural-view
  screenshots and eight actual PDFs cover 320/390/768/1440, light/dark, Turkish
  and Arabic RTL. Every PDF retains the exact Turkish field value and one page-2
  signature, with image counts `[0,1,0]`. At 320×720, 229.73px of the canvas is
  initially visible; body/default surface fitting, selected-page persistence,
  keyboard placement and zero page errors/non-GET requests are recorded.
- Native touch passed in
  `/tmp/browserpdf-root-mobile-touch-second/results.json` and `touch-signed.pdf`:
  pointer capture, unchanged body scroll, cancellation restoring the validated
  draft and page-2 keyboard placement. Saved image counts are `[0,1]`; the
  normalized 344×82 asset and decoded PDF RGB/alpha have zero differences.
- The single-document journey passed in
  `/tmp/browserpdf-root-object-page-first/results.json` and `complete-task.pdf`.
  One file selection carries pending Turkish text, an image, form values and a
  signature through the object modes into Organize. Dirty-plan navigation is
  blocked; chosen adoption changes revision; document Undo restores three
  selectable/editable objects and Redo restores the page result. One final
  download reopens with three pages, rotations `[0,180,0]`, exact Turkish content
  and image counts `[0,1,1]`. Task identity stays stable, with no page errors or
  non-GET requests.
- Fresh independent preparation review passed three groups in 12.910s:
  `/tmp/browserpdf-quality-postfix-preparation-20261018-retry1/report.json`.
  Intended BETA/latest DELTA RGB/alpha streams match their capture oracles and
  cold-font text saves BETA with NotoSans-Bold. Held Apply/mode/download gates,
  obsolete completion, rejection restoration and task/source cancellation pass.
  The corrected owned locale observer separately passed 4/4 in 24.7s.

Root's subsequent complete frozen browser invocation passed **201/204 in
486.678s**, with zero skipped/flaky cases. Report:
`/tmp/browserpdf-root-phase2-shell-routes-full-results.json`; matching artifacts:
`/tmp/browserpdf-root-phase2-shell-routes-full-artifacts/`. All thirteen initial
page-route cases passed there. Three failures still prevent calling that a
clean full gate:

1. Crop smoke saved page 1 with CropBox width 612 instead of the required 562
   after requested top 100/left 50 insets. Its unchanged oracle still requires
   the 562×692 visible box and original MediaBox. The trace records fills
   resolving onto generated native-enabled numeric controls during inert
   initialization, with values still zero before Apply and three full-box crops.
   This is an actual wrong saved artifact through an initial readiness/
   automation seam; the trace alone does not establish overwriting a valid
   real-user draft. Native disabled state and a busy input guard now prevent
   premature numeric interaction. Crop intent versions also stop a superseded
   asynchronous commit/review, preserve a newer draft through late preview
   hydration, and restore source-box insets on local Undo. These narrow fixes
   and three real-artifact regressions passed the combined gate below.
2. The old Phase 3 delayed-import test assumed three parallel native reads and
   retained busy state after Clear. The approved test-only migration preserves
   the original cancellation intent against the serial/reserved queue: one old
   appendix read is held, queued old report/invalid inputs never read, Clear
   unlocks, and a fresh five-page result is chosen/downloaded before releasing
   the old read. Fresh IDs, canonical bytes, review/progress/error state, WebMCP
   and download counts are then compared after release. This migration passed
   the combined gate below without relaxing output assertions.
3. The actual Privacy Scan initial graph measured 103,795 bytes against the
   unchanged 100,000-byte limit. Reader owns its lazy-extraction correction and
   verification. Root reports the first affected four cases passed 4/4 in
   13.240s; the appropriate aggregate/full gate is still required.

The original full-gate JSON, Crop saved-artifact failure trace and delayed-import
failure trace are preserved. No new full-suite pass is implied by focused fixes.

The allocated combined correction gate then passed **30/30**, exit 0, in about
1.7 minutes against the same root-owned server with one worker and frozen
public/test source. Reporter JSON is
`/tmp/browserpdf-pages-crop-clear-combined30-20261019.json`, with actual PDFs in
the matching artifact directory. Its exact union was Page Routes 16, all Phase
3 eight, unchanged Crop smoke one, external-PDF validation one, Turkish-route/
deduplicated-handoff two, and Page Numbers/Watermark smoke two. Saved
`crop-ready-562x692.pdf`, `crop-newer-draft.pdf`,
`crop-after-local-undo.pdf`, `crop-latest-after-obsolete.pdf` and
`cleared-import-fresh.pdf` retain the strict initial Crop, latest-intent and
fresh-before-abandoned-read-release output assertions.

A subsequent independent held-preview probe confirmed a separate fast Crop
Undo/Reset → Review failure in both cases:
`/tmp/browserpdf-quality-held-crop-review-20261018/report.json` and its two saved
PDFs. The plan status said zero cropped while the old Top 10/Left 20 controls
and Review remained enabled; the saved page was incorrectly 592×782 rather
than the original 612×792. The canonical source remained unchanged. The
previous passing Undo test waited for numeric presentation and did not cover
this immediate interaction.

The bounded correction now owns local Crop Undo, Redo, Reset and plan
presentation with a plan epoch, captured canonical revision and the exact
selected-preview promise/epoch. It waits for both panel thumbnails and the
actual selected-page preview/numeric presentation. Native crop controls,
Review, history and mode actions stay locked throughout. Generic operation
Cancel is suppressed during this internal presentation; source/task replacement
still invalidates its ownership. An owned failure stays locked and offers
Retry of the chosen pending plan, explicit Discard or replacement; a new
presentation clears its old error banner. Review only converts a genuine
numeric/drag draft into a crop plan.

Five portable cases cover held Undo/Reset/Redo with immediate synthetic
activation and exact source/source/592×782 output boxes, an obsolete history
render released while replacement parsing remains held, and failed-plan
Retry/Discard/replacement recovery. Exact discovery is Page Routes 21 plus
existing Page Workspace nine, total 30. Syntax and whitespace checks pass.

The allocated affected final gate ran all Page Routes 21 plus the unchanged
strict Crop smoke, with **21 passed / 1 failed**, zero skipped/flaky, in
98.267s. Report and artifacts:
`/tmp/browserpdf-pages-history-final22-20261019.json` and its matching directory.
All three held history artifacts (`crop-fast-undo-chosen.pdf`,
`crop-fast-reset-chosen.pdf`, `crop-fast-redo-chosen.pdf`), stale replacement
ownership (`crop-replacement-after-stale-history.pdf`) and unchanged strict
562×692 Crop smoke passed. The sole failure was a test-only DOM lifecycle
assumption in the recovery helper: after a prior successful actual download,
`clearResult()` retains its result panel hidden rather than removing the node.
The visibility snapshot and shared source confirmed no visible result. The
remaining Discard/replacement steps had not executed in that first run.

The approved helper migration changed only `toHaveCount(0)` to `toBeHidden()`;
all native locks, artifact boxes and recovery actions remain. Its separately
allocated single-case rerun passed **1/1 in 5.976s**, zero skipped/flaky:
`/tmp/browserpdf-pages-history-recovery1-20261019.json` and matching artifacts.
It executed forced preview failure → Retry preserving the chosen plan and
saved `crop-retried-chosen-plan.pdf` at 592×782; another forced failure →
Discard restoring zero insets; another forced failure → real filechooser
replacement, saving the one-page `crop-failed-plan-replacement.pdf` at 612×792.
The product source did not change between these invocations. All 22 unique
affected cases therefore have passing evidence, with the original failed
report preserved. Fresh independent held-history re-proof is still pending.

## Still open

The bounded independent journeys and first combined correction gate above
passed. The newest Crop history/presentation correction, fresh independent
re-proof and the appropriate clean full regression gate remain open. No broad
service-row completion is claimed by this report.

Split still needs named/bounded output groups above twenty pages and chosen-PDF
continuation. Page Numbers and Watermark still need their full scope/settings/
Unicode/actual-preview acceptance. The shared Images/JPG-PNG composer, EXIF/
alpha artifacts, PDF-image estimates/cancellation/output review and bounded ZIP
delivery remain open. Complete locales, full release/regression gates and the
entire 32-service program remain open.

Changed existing HTML semantics awaiting coordinated locale migration include
Crop intro/button/preview and FAQ 1/2 answers; Rotate intro, selection help and
FAQ 2; and Organize group-control help and FAQ 1/2/3. Their obsolete `data-i18n`
bindings were removed where they would overwrite the corrected meaning. New
runtime UI uses `t(key,fallback)`; this is not a claim of completed translation
coverage.
