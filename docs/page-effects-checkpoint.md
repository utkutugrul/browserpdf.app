# Split, Numbers and Watermark checkpoint — 2026-10-19

This implementing-worker checkpoint follows verified base `8cf40d7c3e2571cb62a997c76a66c47ded061d2c`. Independent review, coordinated legacy smoke verification, full release gates and complete locales remain open. It does not complete any service ledger row by itself. Images/JPG-to-PDF composer and PDF-to-Images production changes have not started.

## Routes and shared contracts

`split.js`, `page-numbers.js` and `watermark.js` retain their entry URLs and lazily call `startPageEffectRoute(mode)`. Validated canonical intake occurs before replacing a task. `page-effects-workspace.js` owns selected-page navigation, candidate preparation, operation generations, explicit review/adoption, current-document history and failure recovery. It delegates selection, parity, strict ranges, Shift and keyboard behavior to `createPageWorkspace`; there is no route-owned selection Set.

`core/page-effects.js` exposes injected, DOM-free `applyPageEffect(bytes, options, {pdfLib,pdfjs,pdfjsAssets,embedFont,signal,onProgress})`. Numbers support selected scope, start page/number, formats, five font styles, size, position and separate horizontal/vertical margins. Watermark supports Unicode text with visible unsupported-glyph failure, normalized PNG/JPEG logos, opacity/color, rotation, percentage position and tiling. Both render the actual saved candidate for selected-page preview, and review/export uses those candidate bytes. Geometry copies the existing PDF.js viewport plus `visualTransform` contract for rotation, CropBox and UserUnit. Rewriting preserves the loaded document and reports signature-rewrite boundaries; saved field count and encryption override inherited capability facts. Unknown facts remain unknown.

`core/page-split.js` exposes `splitPdfPages(bytes,{pages,each,name,capabilities},{pdfLib,signal,onProgress})`. It loads the source once, copies selected pages, strictly reopens each saved PDF, and returns exact named artifacts with page identities, capabilities and finite page-copy losses. Source/current remain unchanged until explicit Use or chosen continuation. `pageOperationBoundary` is a newly exported existing finite-boundary helper in `core/page-operations.js`; no SDK export or copied SDK core changed.

`page-task-workspace.js` now passes `getWorkspaceInput().capabilities` through implicit scene publication/handoff and as inherited source facts at result review, consuming the Reader-owned shared fix.

## Complete output list and limits

`page-output-group.js` retains the complete result set, renders twelve rows per window, and uses shared single-artifact review/continuation for the chosen file. It does not call generic `reviewResults`, which has a twenty-file limit. All names are editable; normalization removes paths/control characters, fixes extensions and bounds stems to 110 characters. Case-insensitive collisions receive numbered suffixes. Renaming hides the old reviewed result and cancels an in-progress ZIP before showing the newly named chosen artifact.

Application ownership bounds are explicit:

- PDF source: 250 MiB, 10,000 pages; common selection/thumbnail panel retains twelve bounded canvases and two source proxies.
- Output group: 10,000 complete descriptors, 96 MiB aggregate encoded bytes, no partial publish or silent truncation.
- Stored ZIP: 100 MiB including headers; `core/output-zip.js` yields and checks cancellation during CRC calculation and final array assembly.
- Selected preview: longest dimension 1,200 pixels and 2,000,000 pixels total.
- Logo normalization: existing `imageAsset(file,{trim:false})` dynamically imported from Reader-owned `core/object-scene.js`; PNG/JPEG ≤16 MiB, longest dimension 4096 and 16M pixels. EXIF is normalized once and PNG alpha is retained. Normalized encoded logo is also capped at 16 MiB.
- Watermark placement: complete preflight before page operators; ≤1,000 placements per page and ≤100,000 per operation. Sparse tiles always place at least one centered stamp per selected page.

These are owned application bounds, not guarantees about PDF engines/native image codecs' peak heap. Normalization cannot cancel a browser codec already running; Cancel/Discard/history/hydration/replacement invalidate its intake epoch, and a stale completion cannot assign an asset, change readiness or schedule a new preview.

The loaded surface collapses redundant intake/intro content. Identity remains complete in accessible text/title while visually bounded. Mobile mode/history actions use bounded keyboard-scroll strips; selected PDF preview precedes controls. New styles are scoped in `page-effects.css`.

Stable controls: `pageEffectsTask`, `pageEffectsIdentity`, `pageEffectsStatus`, `workspaceModes`, `pageSelection`, `previewCanvas`, `pagePreviewNumber`, `previousPageBtn`, `nextPageBtn`; retained `modeExtract`, `modeEach`, `splitActionBtn`, `applyBtn`, `startInput`, `positionSelect`, `formatSelect`, `watermarkText`, `styleSelect`, `colorSelect`, `sizeSlider`, `opacitySlider`; scope/font/logo/tile controls use `numberStartPage`, `numberFont`, `numberSize`, `numberMarginX`, `numberMarginY`, `watermarkKind`, `watermarkLogoInput`, `watermarkTile`, `watermarkX`, `watermarkY`, `watermarkRotation`. Recovery uses `cancelPageEffectBtn`, `retryPageEffectBtn`, `discardPageEffectBtn`, `replacePageInputBtn`, `undoDocumentBtn`, `redoDocumentBtn`. Output controls are `pageOutputGroup`, `outputList`, `outputListStatus`, `outputPreviousBtn`, `outputNextBtn`, `downloadZipBtn`, `cancelZipBtn`, `data-output-name` and `data-output-index`.

## Artifact evidence

All browser commands use root's existing `http://localhost:8788` server, the installed Chromium and one worker under coordinated public/test/fixture freezes. No server was started/stopped.

First invocation:

```sh
rtk proxy env BASE_URL=http://localhost:8788 PLAYWRIGHT_JSON_OUTPUT_NAME=/tmp/browserpdf-page-effects-first11-20261019.json npx playwright test tests/page-effects.spec.mjs --workers=1 --output=/tmp/browserpdf-page-effects-first11-20261019 --reporter=line,json
# 10 passed / 1 failed, 42.4 s; exit 1. Original report/trace/artifact preserved.
```

The logo test incorrectly expected one XObject resource name. Actual saved `tiled-logo.pdf` had thirty aliases, all pointing to one embedded image `9 0 R`. The corrected test asserts thirty aliases, exactly one distinct image, dimensions and decoded RGB/SMask alpha. This was a test-only expectation correction; embedding already occurred once.

Root's subsequent independent held-logo probe found a real cancellation defect: releasing an abandoned native read revived Apply and exported the canceled logo. Original proof remains `/tmp/browserpdf-root-logo-cancel-first/results.json` and `canceled-logo-actual.pdf`. Epoch invalidation now covers that seam. Root also found accepted sparse tile settings returning a PDF with zero stamps; complete placement preflight plus centered sparse fallback corrected this. Portable tests reproduce both through actual routes/artifacts.

Second invocation, after exact fourteen-case discovery:

```sh
rtk proxy env BASE_URL=http://localhost:8788 PLAYWRIGHT_JSON_OUTPUT_NAME=/tmp/browserpdf-page-effects-second14-20261019.json npx playwright test tests/page-effects.spec.mjs --workers=1 --output=/tmp/browserpdf-page-effects-second14-20261019 --reporter=line,json
# 14 passed, 57.785026 s; exit 0. expected 14, unexpected/flaky/skipped 0.
```

Evidence includes:

- Twenty-five complete Split outputs, editable collision-safe names, complete ZIP, exact chosen page-25 downloaded bytes and chosen-PDF Organize continuation; source/current unchanged before deliberate use.
- Range/parity/Shift/keyboard selected extraction and exact page order.
- `scoped-numbers.pdf`: scope/start numbering/font/margins, independent visual baseline checks through four rotations/CropBox/UserUnit; actual saved form/title/outline/URI retention and attached full-resolution preview equality; explicit Use and current-document Undo.
- `unicode-watermark.pdf`: Turkish extraction on selected pages only, saved form retention, unsupported-glyph blocking/recovery.
- `tiled-logo.pdf`: thirty tiles alias one normalized 40×20 image; decoded red/blue RGB and all 800 alpha samples match a portable transparent fixture. An injected-runtime preflight rejection proves placement bounds.
- `fresh-after-logo-cancel.pdf`: a held canceled asset cannot restore readiness; fresh blue 60×30 logo is the sole image source on all three saved pages; canonical source remains unchanged.
- `sparse-tiles.pdf`: all four rotated/CropBox/UserUnit selected pages contain actual DRAFT text at accepted gap 1000.
- Canceled Split replacement, owned input immutability, cancel during ZIP CRC/assembly; 320/390/768/1440 loaded RTL/light/dark checks and a natural 320×720 long-filename visibility assertion before scripted scrolling.

The preview oracle uses an attached body canvas at unchanged full resolution, matching native text smoothing. It does not blur, reduce resolution or weaken pixel/geometry expectations.

A test-only Split smoke migration is now prepared in `tests/smoke.spec.mjs`: no automatic download, complete reviewed three-file group, explicit `downloadZipBtn`, actual ZIP entry names/count, each reopened one-page PDF and exact PDF.js extracted content versus original pages. It awaits the next allocated invocation. Existing Numbers/Watermark smoke inputs and primary action IDs remain supported; no expectations were weakened.

## Open acceptance and locale work

Independent review/re-proof, migrated smoke gate, unchanged initial delivery gate, relevant page-core regression and complete release checks remain required. No full-suite pass is claimed. Shared composer/PDF-image routes remain untouched and open.

New runtime copy uses `t(key,fallback)` pending central 22-locale migration. Corrected static bindings removed: `split.faq_2_a`, `split.faq_3_a`, `watermark.about_1_body`, `watermark.about_2_body`, `watermark.faq_2_a`, `watermark.faq_3_q`, `watermark.faq_3_a`. The equivalent FAQ JSON-LD text is corrected in English. Central migration must also reconcile old Split automatic-ZIP and quality guarantees, Numbers every-page/first-numbered-preview descriptions and Watermark first-page/Helvetica/skipped-character descriptions wherever dictionaries or metadata retain them. These changes are not completed translation coverage.

The baseline Watermark SoftwareApplication JSON-LD also retains “no service-imposed usage limits.” Later central copy must distinguish usage quotas from explicit local file/page/memory bounds. This is a nonblocking Phase 4 copy task; no quota or resource-bound behavior is changed by that wording.


## Subsequent independent ownership findings and bounded correction

The fourteen-case result above remains historical evidence. Fresh independent review then reproduced two further real defects on frozen source in `/tmp/browserpdf-quality-page-effects-prefix-first/report.json` (harness `/tmp/browserpdf-quality-page-effects-prefix-probe.mjs`):

1. A held page-two render followed by another Next accepted input page three, but readiness became enabled with status/canvas page two. The visible image exactly matched saved page-two pixels. Exported PDF bytes were valid; the chosen-page presentation was wrong.
2. A validated red logo A followed by a held blue logo B plus width/opacity edits enabled Apply while B remained unread. The actual saved PDF embedded the old red A on all three pages. Canonical original/current were unchanged and no outbound document request was observed.

Source review also identified inherited `searchable:false` surviving real new Number/text-Watermark glyphs; generic unlock resetting panel-native previous/next bounds; and a first-output-review construction gap where the caller did not receive its group disposal handle until a held review finished. Those source findings are not retroactively presented as independently reproduced browser artifacts.

The bounded correction separates candidate-build, selected-page render and logo-source pending ownership. Each accepted navigation captures the exact requested page and candidate epoch; an attached bounded temporary canvas is atomically copied into the visible surface only by its latest owner. Review requires matching requested-page/candidate presentation. Stale/aborted renders release their temporary canvases and cannot alter newer readiness. Settings retain native editing/caret behavior while background work runs.

Logo B remains a separate pending/invalid source intent even when size, opacity or text controls change. Old reviews/continuations disappear immediately. A predecessor A cannot supply the candidate while B is pending; failure visibly holds an invalid draft until retry, replacement, Cancel or Discard. Validated logo identity is shown explicitly.

The common panel now optionally accepts `disabled` and returns `setDisabled(boolean)`, retaining ownership of its own window-bound native disabled state. Existing callers retain the default enabled behavior. `createOutputGroup` now returns its handle synchronously with a `.ready` promise, optional AbortSignal disposal and immediate descriptor/byte-reference release on disposal. The caller registers the handle before awaiting and drops its temporary result array. Number and text-Watermark cores derive `searchable:true` from actual successful text placements; logo-only operations preserve prior known or unknown searchability. Empty effective numbering scope remains an error.

The regression suite expanded to twenty-two cases: the original fourteen plus held latest-page navigation with exact saved-page pixels; held replacement-logo/settings/caret and actual blue-B output; three actual glyph/capability cases (Numbers, text Watermark and logo); native panel busy/unlock bounds; and held first-review Cancel/early Use cleanup followed by fresh actual artifacts before releasing old work. Numbers also checks empty start-page intersection rejection. The invocations below record the expanded suite and focused corrections; the Split manual-ZIP smoke migration still awaits its allocated invocation.


The first expanded invocation ran once on frozen source:

```sh
rtk proxy env BASE_URL=http://localhost:8788 PLAYWRIGHT_JSON_OUTPUT_NAME=/tmp/browserpdf-page-effects-third22-20261019.json npx playwright test tests/page-effects.spec.mjs --workers=1 --output=/tmp/browserpdf-page-effects-third22-20261019 --reporter=line,json
# 20 passed / 2 failed; 117.774786 s; exit 1; skipped/flaky 0.
```

All fourteen previous cases plus exact latest-page-three pixel ownership, three saved glyph/capability cases, native panel bounds and held first-review Cancel → fresh artifact passed. Two failures remain preserved with original traces:

- Pending B read never began. Trace `after@call@799` at 65544.344 ms records `pageEffectsTask aria-busy=true` and the native logo input `disabled` while Playwright assigned pending-B.png. The test bypassed native readiness after A Review displayed its actual file but before its final unlock. The test-only alignment now waits for the native logo input to be enabled before selecting B; all hold, settings/caret and exact blue-B artifact assertions remain.
- Early Use correctly adopted the selected PDF and removed/emptied the preceding group, but the new chosen workspace retained `processing=true` from the held old Review. This is a real recovery defect. Chosen hydration now invalidates the predecessor, resets its processing/progress and owns its new readiness; old epoch guards remain. The regression still requires a fresh actual Split artifact before the old render is released and additionally checks old progress is hidden.

No automatic rerun or source mutation occurred during that invocation. The original failed JSON/artifacts remain intact.

The allocated corrected failed-two invocation preserved all assertions:

```sh
rtk proxy env BASE_URL=http://localhost:8788 PLAYWRIGHT_JSON_OUTPUT_NAME=/tmp/browserpdf-page-effects-failed2-corrected-20261019.json npx playwright test tests/page-effects.spec.mjs --grep 'Pending replacement logo|Held first Split review early Use' --workers=1 --output=/tmp/browserpdf-page-effects-failed2-corrected-20261019 --reporter=line,json
# 1 passed / 1 failed; 27.525771 s; exit 1; skipped/flaky 0.
```

Early Use passed the actual fresh-Split-before-predecessor-release artifact and empty detached group/progress checks. Its correction also scopes the adopted/idempotence guard to stamp modes: a chosen Split output can be split again after owned hydration is ready.

The pending replacement test passed its critical main path: native B selection, held normalization, editable settings/caret, blocked old-result publication and actual `accepted-blue-B.pdf` with blue 60×30 image bytes on all three pages. The case then failed before its invalid-logo rejection/recovery tail: trace `after@call@85` at 7525.067 ms again records a disabled native logo input while Playwright assigned invalid-draft.png. The A/B accepted source calls had no disabled attribute. This was another test interaction bypassing native readiness, not evidence that invalid input was validated.

All four legitimate uploads in this case—A, B, invalid-logo rejection and rejected-PDF replacement—now use one semantic helper that awaits an enabled native input before selection. No fixed delay, production change or artifact assertion reduction was introduced.

The separately allocated final full-tail invocation ran once:

```sh
rtk proxy env BASE_URL=http://localhost:8788 PLAYWRIGHT_JSON_OUTPUT_NAME=/tmp/browserpdf-page-effects-logo-recovery-final1-20261019.json npx playwright test tests/page-effects.spec.mjs --grep 'Pending replacement logo' --workers=1 --output=/tmp/browserpdf-page-effects-logo-recovery-final1-20261019 --reporter=line,json
# 1 passed; 8.404516 s; exit 0; unexpected/flaky/skipped 0.
```

The complete case passed accepted-blue-B publication, native editing/caret, invalid-logo rejection, rejected-PDF replacement rollback, abandoned native-input clearing, validated-B recovery and the actual recovered blue-B PDF artifact. The browser closed and the exclusive window was released after each invocation; no automatic rerun or mutation occurred during a run.

At that stage, all twenty-two unique cases had aggregate passing evidence across the first expanded twenty passes, corrected Early Use and final pending-logo full-tail pass; there had not been one clean twenty-two-case invocation. Independent root postfix evidence separately records exact latest-page-three pixels and actual blue-B output in `/tmp/browserpdf-root-page-effects-postfix-first/report.json`. Broader affected regression, independent acceptance, complete locales and full release gates remained open at that point.

## Initial-hydration replacement lifecycle

Fresh independent review subsequently held the first Split thumbnail while selecting a rejected replacement. `/tmp/browserpdf-quality-page-effects-hydrate-invalid-20261018/report.json` proves the accepted task/current/original remained exact, but releasing the first hydration removed its only workspace and recovery controls. The route advanced its surface epoch before candidate validation and had no handle to suspend while the first surface was still opening.

The independent valid-replacement variant in `/tmp/browserpdf-quality-page-effects-hydrate-invalid-20261018/valid-report.json` also reproduced a successor cleanup defect: a new B task and actual two-page export were correct before A's held opening settled; A's late disposal then cleared B's group/review and removed the loaded body class. Canonical bytes remained unchanged. These are workspace lifecycle defects, not proof of source corruption.

The narrow route correction separates intake sequencing from accepted surface epochs. It advances the surface epoch only after validated intake, retains the current/pending accepted surface on rejection, and waits for an abandoned opening and its disposal before installing the successor. Workspace `isCurrent` now includes accepted surface epoch and task identity. This follows the existing Object/Reader route pattern without changing shared APIs.

Two portable regressions extend discovery to twenty-four cases. One uses a valid `%PDF-` header with malformed structure to exercise parser rejection during initial hydration, exact retained task/current/original, usable retained workspace and actual saved PDF. The other selects a valid distinct B while A is held, verifies B's new canonical ownership, releases A, then requires B's loaded surface, exact selected preview, actual two-page content and chosen-PDF Organize continuation without reselecting B or taking a recovery action. A successor can wait busy for the abandoned opening to settle.

The allocated portable lifecycle gate ran once after exact two-case discovery:

```sh
rtk proxy env BASE_URL=http://localhost:8788 PLAYWRIGHT_JSON_OUTPUT_NAME=/tmp/browserpdf-page-effects-hydration-postfix2-20261019.json npx playwright test tests/page-effects.spec.mjs --grep 'Initial Split hydration' --workers=1 --output=/tmp/browserpdf-page-effects-hydration-postfix2-20261019 --reporter=line,json
# 2 passed; 10.955749 s; exit 0; unexpected/flaky/skipped 0.
```

Both complete artifact/ownership paths passed with no page errors. Original prefix reports/artifacts remain intact. The browser closed and its exclusive window was released with no automatic rerun or source mutation. At that stage, all twenty-four unique cases had aggregate passing evidence; there had not yet been a single clean twenty-four-case invocation.

Fresh independent lifecycle postfix review also passed both cases in `/tmp/browserpdf-quality-page-effects-hydrate-postfix-20261018/report.json` (`allPassed:true`). It used malformed-header parser rejection and valid replacement during the held initial opening, actual three-/two-page PDFs with distinct expected content, functional post-release surfaces and exact chosen-output continuation. Both cases reported zero page errors and zero non-GET requests. Prefix proofs remain separate and unchanged. Broader affected gates and root's full release verification remain open.

The stale literal English Watermark description now states that supported text uses embedded fonts and unsupported characters block the operation with a clear message; users can choose compatible text or a logo. Central locale migration remains open.

## Root frozen full-run verification

Root's subsequent frozen full run completed **249 passed / 1 failed** out of 250 tests in **696.877429 seconds**, with zero skipped or flaky tests. Report: `/tmp/browserpdf-root-reader-effects-full-20261019-results.json`. All **24/24 cases in `tests/page-effects.spec.mjs` passed together in that one invocation**, superseding the earlier aggregate-only limitation while preserving every historical result above.

The run also passed all 21 page-route, 9 shared-panel, 11 Reader, 8 preparation, 11 object, 23 foundation, 10 engine and 32 smoke cases, including the explicit reviewed Split ZIP migration. SDK/PWA, initial-delivery/idle and migration checks passed. Root verified the 158 frozen runtime/test file hashes remained unchanged throughout the invocation.

The sole failure was the existing lazy workspace test `lazy workspace import failure retries extra-source validation without replacing the owned task` (`tests/lazy-workspace-support.spec.mjs`, line 35), whose setup still waited for the obsolete hidden `#viewerSection`. Root confirmed the test-setup mismatch; Reader owns its one-line test-only correction and separately allocated focused verification. This checkpoint does **not** claim a green full250 run. Complete locales, remaining service work and final release acceptance remain open.

## Remaining composer handoff (read-only)

No composer or PDF-image production change was made in this checkpoint. `images.js` image import (around 355–457) and `jpg-to-pdf.js` (around 72–130) still have separate mutable item arrays/raw embedding and fixed longest-edge 842 sizing. `images.js` PDF export (around 75–255) has separate selection, all-page thumbnails, uncapped render/encoding and automatic downloads. These remain unfinished service behavior.

Both import URLs should delegate to one composer and injected DOM-free PDF layout core. Reuse `imageAsset(file,{trim:false})` dynamically for exactly-once EXIF normalization and PNG alpha; `createPageWorkspace` for PDF selection; and `createOutputGroup`'s synchronous handle/`.ready`, complete named output group and explicit ZIP for image exports. Preserve current task identity and canonical bytes until deliberate Use. Implement cancellation/ownership across queued normalization, rendering and noncancelable encoding completion, with no stale result publication.

The fresh owner must agree explicit source-count/pending reservations, raw aggregate bytes, normalized aggregate bytes, decoded live bitmap/canvas pixels, thumbnail window and output bounds before implementation. A possible starting policy, not an accepted implementation, is 64 source entries including at most 16 pending, one normalization at a time, 48 MiB raw plus 48 MiB normalized (combined ≤96 MiB), per-source 16 MiB/4096-edge/16M pixels, twelve 220-pixel thumbnails and one 1200-edge/2M preview, and existing 96 MiB output/100 MiB ZIP caps. Existing `imageAsset` temporarily owns a decoded bitmap and two full-size canvases, so a live-decoded estimate must include all three (up to 48M pixels), not just one source's pixel count; native codec allocation remains outside a hard heap guarantee.

Shared typed-state work needs the next Reader/shared owner: current `document-session.js` has one original artifact plus PDF scene references; `collectResources()` drops resources absent from scene/history, `adopt()` clears scene, and transfer/handoff explicitly serialize that schema. It cannot preserve multiple immutable input originals, normalized assets, editable order/rotation/paper/fit/margins or their Undo state by attaching an unvalidated bag. Request a bounded validated composition schema and transactional resource/ref retention through existing session/store/handoff boundaries, including before and after result review/Use and retained URLs. Do not create an independent stale composer task. No shared extension or new SDK export was introduced here.

Portable future tests must generate their own EXIF orientations 1/3/6/8, alpha and quadrant fixtures, inspect actual saved PDF image RGB/alpha/order/geometry through both URLs, and cover held normalization/render/encoding, Clear/replacement/current-task staleness, bounds rejection and chosen-image continuation. Root's independent `/tmp/browserpdf-root-image-corpus` is comparison evidence, not a test fixture dependency. Central 22-locale copy migration, migrated smoke verification, relevant shared regressions and all remaining Phase 2–4 service rows remain open.
