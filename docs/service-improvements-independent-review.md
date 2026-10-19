# Independent acceptance review — 32-service improvements

Primary goal: a user opens a document once, performs compatible operations without losing changes, reviews the current output, and exports a faithful result. Baseline `ab0a4f6`; authorized scope is the 2026-10-18 32-service audit. This is a verification ledger, not a claim of completed implementation.

The current functional checkpoint accepts native Highlight, verified Redact, the required Reader/Privacy intake dependencies, bounded display names and result-continuation ownership. The retained broad run was 324 passed/7 failed; a clean affected run of 79 and the final isolated Redact run of 22 close the identified failures and added prerequisites. Independent native journeys reopen actual artifacts and verify task/original/current continuity. The detailed failed prefixes and corrections remain below. This does not close the final 32-service rows: conversion quality, platform guidance and complete locale semantics remain open.

## Review gates

Each row needs evidence of changed user-visible behavior and saved-output correctness. Route presence, a newly added link, a returned file, or a self-reported `verified` flag alone is insufficient. Tests should fail for the original defect or missing task behavior and should exercise meaningful artifacts rather than mirror source structure.

| # | Service | Required acceptance evidence | Independent status |
|---|---|---|---|
| 1 | Add Text | Multiple editable objects across pages accumulate; Unicode preserved; actual text preview; correct rotation/CropBox/resize; repeat export idempotent; keyboard placement | Pending |
| 2 | Add Image | Selected page preview matches export; multiple objects freely positioned/resized; prior text retained | Pending |
| 3 | Fill & Sign | Page-linked fields and no-fields text path; field/flatten errors visible; correct editable signature preview/size; saved field values asserted; compatible continuation | Pending |
| 4 | Highlight | Text-bound selection, per-object style; edit/remove/undo; saved appearance/annotation semantics match advertised scope | Pending |
| 5 | Redact | Rotated/cropped region removes intended content; honest metadata/page-rasterization limits; result passes to verification and preserves untouched pages | Pending |
| 6 | View PDF | Text selection/find, page navigation/zoom and content layers where supported; current document passes to next tool | Pending |
| 7 | Edit Metadata | Current/new property values, controlled clear-fields path and Privacy Scan continuation; unrelated categories not falsely claimed removed | Pending |
| 8 | Merge | Per-file identification/thumbnail and ranges; correct ordered artifact; current result review/continue and original ordering protections | Pending |
| 9 | Split | Typed/group page selection and named multi-output review; selected output(s) continue to compatible tools | Pending |
| 10 | Organize | Shared group selection, insert/duplicate/reorder/rotate/delete/restore/undo; saved pages verified | Pending |
| 11 | Rotate | Selected group left/right plus changed-page review; existing rotation handled; OCR interoperability explicit | Pending |
| 12 | Delete Pages | Range/group/inverse selection with undo; cannot delete all; output contains exactly kept pages | Pending |
| 13 | Crop | Page navigation and selected-page crop handles; box-origin/rotation correctness; no content-erasure claim for box-only crop | Pending |
| 14 | Page Numbers | Page scope/start-page/font/margin/format controls and navigable preview; saved numbering placement asserted | Pending |
| 15 | Watermark | Unicode and page scope/navigation; advertised custom/logo/tiling features, if introduced, verified with actual saved pages | Pending |
| 16 | Compress | Original/result choice before download; preservation-based path proven to reduce suitable inputs while retaining text/forms/links; explicit image-only path; no incompatible default continuation | Pending |
| 17 | OCR PDF | Multilingual recognized text survives export; rotated/cropped pages; per-page review/confidence/retry/cancel; OCR→next operation retains promised searchability | Pending |
| 18 | Protect | Password visibility/confirmation and encrypted-output verification; credential-aware supported next action; no password persistence | Pending |
| 19 | Unlock | Contextual return to original task; real password roundtrip; forms/bookmarks/attachments/tags preservation tested or precise confirmed losses shown | Pending |
| 20 | PDF to Markdown | Side-by-side page-referenced output, reading-order correction/per-page OCR option; result continues to Markdown workspace | Pending |
| 21 | PDF to Word | Preview before download, bounded structure-quality language, cancellation and next step; advertised table/column/image improvements proven | Pending |
| 22 | Word to PDF | Unicode and numbered lists/tables/images in actual paginated output; relevant page geometry; review/continue; fidelity scope honest | Pending |
| 23 | Extract Text | Literal punctuation survives full PDF→text path; page/OCR provenance and localized states; compatible content handoff | Pending |
| 24 | PDF ↔ Images | Actual dimensions/resource estimate, cancel, multi-output review; one maintained image composer with page-size/margins and PDF continuation | Pending |
| 25 | Markdown to PDF | Actual paginated PDF review with page/font/margin settings, long tokens and Unicode; unsupported syntax visible; shared composer | Pending |
| 26 | PDF to Excel | Blank/scanned extraction stops or offers OCR; editable table/column preview; meaningful page/table sheet separation and source references | Pending |
| 27 | Excel to PDF | No silent ? replacement or cell truncation; wrapped/paginated grid, configurable widths/fit and multi-sheet preview; saved values inspected | Pending |
| 28 | JPG / PNG to PDF | Same maintained image composer as Images route; consistent detection/thumbnails/order/fit/rotation/margins; current PDF review/continue | Pending |
| 29 | Markdown Viewer | Shared text/render/export model, common Markdown syntax and Unicode; actual PDF print preview; content/result continuity | Pending |
| 30 | Workflows | Current document/selected output continuity, per-result review and bounded compatible-step composition; losses/queue/secret-resume invariants | Pending |
| 31 | Privacy Scan | Actionable locations/meaning/options, scan bounds/partial warnings visible; page jump and before/after cleanup; current copy continuation | Pending |
| 32 | Document Doctor | Page-specific understandable diagnosis/action, technical details disclosure, least-lossy guidance and output comparison/continuation | Pending |

## Cross-cutting verification

- Immutable originals; clear source/current revision and selected pages; no accidental reapplication on repeat save.
- Shared history uses bounded state, supports known reversible operations and communicates lossy boundaries.
- Aborted/replaced/cleared imports and operations cannot publish stale previews, results or stored artifacts.
- Artifact handoff is type/capability-aware (PDF/text/DOCX/workbook/images/multiple results); encrypted and searchable states are honored.
- User documents are not uploaded or cached in service-worker/analytics flows; scoped IndexedDB ownership/expiry and Clear behavior preserve unrelated data; passwords stay in memory.
- PDF changes have explicit digital-signature consequences and no unsupported “lossless/certified/fully offline/fully repaired” claims.
- CSP, library integrity, low initial graph, feature-detected metadata-only WebMCP, private SDK and static-shell PWA boundaries remain intact.
- Existing 29 URLs/3 service URLs and localized routes remain usable, including Arabic RTL; new user-facing states use complete locale keys.
- Keyboard and 320/390/768/1440 layouts, light/dark, reduced motion, visible error/partial/cancel/result states.
- New meaningful artifact/journey tests plus applicable existing Playwright release suite and SDK checks. Baseline discovery: 123 tests in 10 files, not the README's 121.

## Execution record

- 2026-10-18: pinned Playwright Chromium/headless shell revision 1234 installed successfully; `npx playwright test --list` discovers 123 baseline tests.
- Immutable baseline `ab0a4f6` verified in a detached temporary worktree on port 8789: 117 tests passed initially; six tests used their explicit `BASE_URL` constant rather than the overridden fixture URL and failed to reach port 8788. Rerunning only those six with `BASE_URL=http://localhost:8789` passed all six. Thus all 123 baseline tests have passing evidence; the temporary harness correction did not change product code or test assertions. Baseline reports: `/tmp/browserpdf-baseline-initial-20261018-results.json` and `/tmp/browserpdf-baseline-20261018-results.json`.
- Baseline `npm --prefix sdk test` passed deterministic build/check-dist, TypeScript and all 8 unit/package tests.
- Phase 1 independent editor probe, 2026-10-18 22:04:55 UTC: `/tmp/browserpdf-root-phase1-final/results.json` and `combined-text.pdf`. Two pointer-placed edits accumulated; the actual manually downloaded file reopened in Node PDF.js with `ROOT-FIRST İstanbul ığüşöç` and `ROOT-SECOND EDIT` exactly once. The current PDF continued into Add Image; uncaught page errors: zero. Earlier runs exposed fast second-placement readiness and stale previous-download bugs; both were reproduced/fixed before this passing run. This proves those foundation fixes, not completion of the full object/page workspace or all 32 services.
- Simple RTL visual spot-check: generated Arabic normal and Hebrew bold PNGs in the engine test corpus showed connected/readable text without obvious missing glyphs. This is not evidence for mixed-script, diacritic, or all-language correctness.
- Phase 1 frozen full-suite run, 2026-10-18: 150 passed and 3 failed out of 153 in 2.4 minutes. The three failures are the existing Phase 1 Merge tests still waiting for an automatic download after the primary Merge action; that contract intentionally changed to actual-result review followed by an explicit download. Their numeric-progress, persistent-success and replacement/Clear cancellation assertions must be retained when migrated. All other completed browser tests passed, including real artifacts, the new foundation/engine cases, WebMCP, privacy, encrypted roundtrips, PWA and route/localization checks. Evidence: `/tmp/browserpdf-root-phase1-full-results.json` and `/tmp/browserpdf-root-phase1-full-artifacts`. This is not yet a clean Phase 1 gate: an independently reproduced multi-result sibling-selection race also requires correction and focused verification.
- Phase 1 root SDK gate passed build, deterministic distribution check, TypeScript and all 8 unit/package tests. All 8 existing public-HTML/translation migration `--check` commands also passed. These do not certify the still-pending new locale copy or Phase 2–4 service behavior.
- Phase 1 final root targeted gate: **27/27 passed in 20.9 seconds**. This includes the three migrated Merge progress/persistence/cancellation tests, every one of the 23 foundation tests, and the actual initial JavaScript graph guard. The new sibling-selection regressions perform the real UI selection and continuation, then assert the owned stored file's exact bytes, MIME and name; Clear/recovery and explicit current-result identity are also covered. Evidence: `/tmp/browserpdf-root-phase1-final-targeted-results.json` and `/tmp/browserpdf-root-phase1-final-targeted-artifacts`. Together with the frozen full-suite results and SDK/migration checks above, this clears the bounded Phase 1 foundation gate. It does not complete any broad Phase 2–4 service row.
- Fresh independent quality review also passed the original four reproduced corrections and the later sibling/clear/adoption cases with zero page errors; final direct evidence is `/tmp/browserpdf-quality-sibling-final-tC69O0/evidence.json`. Product source and tests stayed frozen during the root targeted invocation.
- Audit browser/output probes from the prior review remain the pre-fix evidence. New implementation results will be appended as phases are verified.

## Signing priority and independent journey

The user specifically reiterated signing dissatisfaction during implementation (2026-10-18). This raises Fill & Sign's verification priority while preserving the full 32-service scope. The next independent signing journey will use typed Turkish names, pointer-drawn ink and an uploaded transparent signature; place on page 2 and a rotated/nonzero-CropBox page; move and proportionally resize; edit the draft; undo/redo; export twice; then continue into a page tool. The actual downloaded PDFs must contain the intended field values and exactly one instance of each applied signature, with preview/export geometry agreement and earlier edits preserved. Clear and invalid replacement must not resurrect a stale signature or discard a valid document. Visible field/flatten errors must block a false-success result. This is an acceptance checklist, not completed evidence or a claim of certificate-based signing.

First independent signing checkpoint **passed** (2026-10-18 22:38:00–22:38:09 UTC). `/tmp/browserpdf-root-signing-checkpoint-first/evidence.json` and five actual manually downloaded PDFs demonstrate page-linked input focus surviving a changed PDF preview, exact Turkish name/checkbox/dropdown values, keyboard nudge, proportional resize, repeated export without an extra signature, editable signature retention after an Add Text roundtrip, and all three signature sources. The 800×300 transparent upload became a 241×79 trimmed asset. Reopened PDF image-draw counts by page were `[0,1,2]`, then `[0,1,1]` after Undo and `[0,1,2]` after Redo. Uncaught page errors and non-GET requests were both zero. This is one successful checkpoint journey; full visual parity, final compact task layout, localized controls and the rest of Phase 2 remain open. Synthetic fixture/harness scripts are `/tmp/browserpdf-signing-review-fixtures.mjs` and `/tmp/browserpdf-independent-signing-review.mjs`; repository tests must generate their own portable fixtures.

Separate redaction feasibility probe found a concrete source-reference hazard: copying untouched pages with repeated AcroForm widgets can pull the original redacted page back into the output as an orphan object. `/tmp/browserpdf-independent-redaction-copy-review.mjs` replaces page 1 with a blank stand-in and copies pages 2–3 from the signing fixture, following the current copy strategy. `/tmp/browserpdf-root-redaction-copy-hazard.json` records three visible pages but six page objects and a decoded content stream retaining the original page-1 marker. This is a library/algorithm proof, not a full-route redaction run. The Redact acceptance gate must inspect retained object/stream references and verify a safe fallback before claiming content removal.

A second isolated probe confirms the internal-link variant rather than leaving it as a hypothesis. `/tmp/browserpdf-independent-redaction-link-review.mjs` copies an untouched page whose Link/Dest points to the replaced secret page. `/tmp/browserpdf-root-redaction-link-hazard/results.json` and `copied.pdf` contain two visible pages but three page objects, with the original secret still in decoded stream 11. This is also a pure-library proof of the current copy strategy, not a route run. Removing only form references would not address this case; safe reference handling or an explicit fuller raster fallback must cover internal destinations too.

Fresh scene/checkpoint review verified the corrected rejection and ownership cases using actual saved artifacts: `/tmp/browserpdf-quality-scene-validation-final/results.json`. An unsupported selected text edit and a 10,001-character edit visibly restore `VALID ORIGINAL`; a pointer-selected typed signature restores `ALPHA` with identical embedded image and alpha hashes. Immediate navigation to a rotated/CropBox page followed by placement saves at `[120,149.8125]` CSS pixels for the requested `[120,150]`. A 1×14400-point page renders into bounded 1×4096 editor and 1×900 result canvases. Shared Pages current-page identity remains stable through a move; stale controls after Clear/replacement cannot alter selection. Flatten-only preserves the existing visible `Original` value while the saved document has zero form fields. These specific fixes pass; the full regression gate and final service layouts/route migrations remain open.

Independent future conversion fixtures are prepared in `/tmp/browserpdf-root-conversion-corpus/`; they are synthetic review inputs, never repository-test dependencies. The DOCX/Markdown corpus covers isolated inline whitespace, literal punctuation, Turkish/Greek/Cyrillic text, numbered-list start 7, table cells, an embedded two-color image and long tokens. ZIP/XML checks passed, but application fidelity has not yet been verified. `structural-preservation.pdf` is a 69,950-byte compression input containing a 65,011-byte unfiltered vector stream plus selectable text, populated interactive fields and a URI link; source reopening verifies those structures. A later compression gate must demonstrate actual reduction while retaining them.

The additional `unicode-long-multisheet.xlsx` fixture and `spreadsheet-manifest.json` cover two sheets (Özet and Данные), unequal column widths, ninety data rows, Turkish/Greek/Cyrillic text and a 625-character cell with a final sentinel. All six ZIP/XML parts validate. The application has not processed it yet; later actual PDF export must retain the long-cell tail, final row and second-sheet markers. Generator: `/tmp/browserpdf-root-spreadsheet-corpus.py`.

Scene/signing and shared Pages-core checkpoint gate cleared on 2026-10-18. Root's frozen full invocation passed **173/176 in 112.3 seconds**, with three legacy smoke contracts requiring migration: placement before the requested canvas was ready, uploading into a hidden uninitialized image input, and assuming the radio group must use native radio inputs. Only test code changed afterward. Root's final **5/5 in 9.1 seconds** passed those three corrected real-user flows plus both other consumers of the placement helper (Highlight and Redact). Saved-image dimensions and all seven saved form names/values, including the radio selection, are asserted. Reports: `/tmp/browserpdf-root-phase2-checkpoint-full-results.json` and `/tmp/browserpdf-root-phase2-checkpoint-final5-results.json`; matching artifact directories retain traces/download evidence. SDK distribution allowlist/determinism check also passed; its copied cores are unchanged and the full browser SDK-consumer test passed. Existing translation/migration, WebMCP, initial-graph and PWA tests passed in the full invocation.

The native 560-pixel preview/export comparison is exact when both canvases inherit the same DOM font-smoothing style. `/tmp/browserpdf-objects-pixel-context-proven/results.json` proves identical preview/saved PDF hashes and zero pixel difference for attached, inherited-style canvases; detached/default-style controls reproduce the former text-edge difference. Original tolerances and actual artifact assertions remain; no lower-resolution or relaxed-threshold substitute was accepted. This gate accepts the bounded editable-scene/signing and page-core/panel checkpoint only. Compact loaded layouts, reader/highlight/redaction changes, actual page-route/composer cutover, conversion quality, complete new locale copy and platform-service work remain open. The existing Redact smoke checks visible-page extraction and does not resolve the orphan-object hazard above.

The next object-shell focused invocation passed **41/41 in 2.3 minutes** (`/tmp/browserpdf-object-shell-final-results.json`): seven shell cases, eleven object cases and twenty-three foundation cases. A prior rapid two-image intake probe saved both images on page 2 although the first was requested on page 1. Captured per-intent page/asset data and a bounded queue corrected that defect, with actual saved page/order/aspect assertions. This focused pass precedes the independent layout and pending-edit findings below, so it does not accept the next checkpoint.

Root's first eight-layout invocation stopped at its initial measurement assertion before the signing/download journeys. The harness incorrectly forced document scroll to the top after the application's loaded-task reveal; those eight failures are not eight product failures. Natural loaded geometry independently confirms a 320×720 problem: the PDF canvas begins at y=728.47, leaving none of the document visible. The other natural canvas positions were y=565.5 at 390×844, y=461.48 at 768×900 and y=362.09 at 1440×1000. Body overflow and default canvas fit checks passed. `/tmp/browserpdf-root-compact-layout-first/results.json` retains both measurements. The corrected harness keeps natural scroll, records initial screenshots, and continues actual-output checks even when a layout issue is recorded; it has not yet been rerun.

Fresh independent review confirmed two selected-object preparation defects in **9.267 seconds** (`/tmp/browserpdf-quality-held-prep-20261018/report.json`). A selected placed ALPHA signature changed to BETA while canvas capture was held; a selected placed ALPHA text object changed to BETA while its cold bold-font request was held. In both cases the visible input showed BETA while Apply and the previous download remained enabled. Immediate Apply/download returned the byte-identical ALPHA PDF; signature image/alpha streams were unchanged, and saved text extraction returned ALPHA. The harness's post-release asynchronous polling booleans are not valid independent acceptance checks and are excluded. An owned pending-edit state, result invalidation at edit intent, recovery on rejection, accessible initial placement and the mobile layout correction are now required before the next checkpoint gate. No full service row or Phase 2 completion is implied.

The first actual Page-route invocation was deliberately stopped after a confirmed Organize download failure: its dirty-navigation capture guard also prevented the generated blob download anchor. Of twenty-one requested cases, two started: one failed, one was interrupted and nineteen did not start; no completed pass or Merge-regression pass is claimed. The reporter did not flush JSON on termination; the exact record is `/tmp/browserpdf-pages-route-first-20261018-termination.json`, with trace artifacts in the matching directory. The narrow guard correction now excludes explicit downloads and non-HTTP(S) URLs while retaining real same-origin navigation protection. Full rerun acceptance remains pending.

The object preparation checkpoint then passed **47/49 in 179.0 seconds**, followed by **9/9 affected cases in 43.6 seconds** after narrow corrections. These are passing evidence for all forty-nine unique cases, not a single clean forty-nine-case invocation. Reports: `/tmp/browserpdf-object-preparation-checkpoint-results.json` and `/tmp/browserpdf-object-preparation-final9-results.json`. All eight new cases passed: held text/font and signature preparation gates, obsolete completion ownership, draw/upload source cancellation, initial keyboard creation with actual saved text geometry, and valid/rejected unplaced drafts during a held page render. The first run's two failures were the still-low 320px canvas and unnecessarily recreating the unchanged validated signature's blob URL after rejection; saved-content loss was not established by the latter. Nonshrinking identity labels, direct ownership of relocated object-action nodes and reusing an identical asset URL corrected them. The final affected invocation also verifies that genuinely changed BETA/DELTA assets still change and that keyboard placement reveals the focused object. Root's independent compact/touch/task journeys, fresh delayed-preparation artifact review and the Page-route release gate remain pending.

The actual Page-route gate passed **22/22 in 62.3 seconds**, followed by **3/3 unchanged Merge regressions in 15.2 seconds**. Reports: `/tmp/browserpdf-pages-route-second-20261018.json` and `/tmp/browserpdf-pages-merge-regression-20261018.json`. Thirteen route/lifecycle cases and nine existing core/panel cases cover real Organize/Rotate/Delete/Crop/Merge output, crop rotation/UserUnit and recoverability, pending-plan navigation, cancellation, early adoption ownership, form capability evidence, first-import Clear, hydration recovery and held initialization readiness. This accepts those tested behaviors rather than the remaining Split/Numbers/Watermark/composer routes.

Root independently passed all **eight** compact signing journeys in one invocation on frozen product source: `/tmp/browserpdf-root-compact-layout-third/results.json`, natural-view screenshots and eight actual PDFs. Widths 320/390/768/1440 cover light/dark, Turkish and Arabic RTL. Every file retains the exact Turkish field value and exactly one signature on page 2, with saved image counts `[0,1,0]`. Page 2 persists through original/result toggles; all bodies and default canvas surfaces fit. At 320×720 the canvas starts at y=490.27 with 229.73px visible; at 390×844 it starts at y=356.5 with the full 447.84px canvas visible. All four mobile cases use native keyboard Place; the resulting focused object is visible. Page errors and non-GET requests are zero.

The preceding second compact run's five non-English readiness failures were a test oracle error. Localized relative entry scripts own `/tr/js/tool-ui.js` or `/ar/js/tool-ui.js`; importing the absolute `/js/tool-ui.js` observes a distinct empty session. The final record proves actual task/revision 2 and canvas revision 2/ready while the unrelated root session has null task/revision 0. Deriving the observer from the actual entry URL corrected the test without any product change or relaxed assertion. The repository's locale revision observer also requires that test-only correction; its changed-pixel, same-input and native-caret checks remain meaningful.

Root native mobile touch passed `/tmp/browserpdf-root-mobile-touch-second/results.json` and `touch-signed.pdf`: actual touch pointer capture, body scroll unchanged at 762px, touch cancellation restoring the validated draft, keyboard placement on page 2 and saved image counts `[0,1]`. The intended normalized 344×82 PNG and saved PDF's decoded RGB/alpha have **zero color and alpha differences**, including 1,506 ink and 26,702 transparent pixels. Errors and non-GET requests are zero. The initial harness's fetch of its blob URL was correctly blocked by CSP; reading the owned normalized asset for the oracle avoided that instrumentation error without changing CSP or product code.

Root's single-document task journey also passed: `/tmp/browserpdf-root-object-page-first/results.json` and `complete-task.pdf`. One file selection carried unapplied Turkish text into Add Image, an image on page 3 into Fill & Sign, Turkish form values and a typed signature on rotated/CropBox page 2 into Organize. A dirty page plan blocked mode changes; explicit review/adoption changed the current revision. Document Undo reopened three actual selectable/editable objects; Redo restored the selected page result. Exactly one final download reopens with three pages, rotations `[0,180,0]`, exact Turkish form/stamp content and image counts `[0,1,1]`. Task identity stays stable and errors/non-GET requests are zero. These independent journeys pass; fresh delayed-preparation review, corrected locale observers and the appropriate full regression gate still precede checkpoint delivery. Full Phase 2 and the remaining service rows stay open.

The test-only locale observer correction passed **4/4 in 24.7 seconds** (`/tmp/browserpdf-object-shell-localized-observer4-results.json`) on unchanged product source, now awaiting the owned revision after actual changed pixels. Fresh independent preparation review then passed **3/3 groups in 12.910 seconds** (`/tmp/browserpdf-quality-postfix-preparation-20261018-retry1/report.json`). Intended BETA (167×58) and latest DELTA (209×58) capture-oracle RGB/alpha hashes exactly match saved PDF streams with zero errors; cold-font text exports BETA using NotoSans-Bold descriptors. Held Apply/mode/old-download gates, obsolete completion, rejection restoration and source/task cancellation pass with no page errors. The first review attempt sampled replacement before its new shell was ready; a harness-only owned-readiness wait corrected that sampling issue. No bounded-checkpoint blocker remains in that review. Root's frozen full gate now runs the exact discovered 204 cases in 17 files; checkpoint delivery and all remaining service work still await their respective gates.

That frozen full invocation completed **201 passed, 3 failed, 0 skipped and 0 flaky in 486.7 seconds**, across all 204 cases in 17 files. `/tmp/browserpdf-root-phase2-shell-routes-full-results.json` and the matching artifact directory retain the exact result. It is not a clean gate. One legacy Clear test assumes three simultaneous file reads, while the new bounded sequential queue starts one and cancels unstarted reads; its migration must still prove immediate Clear, fresh five-page output before the old read resolves, metadata-only WebMCP and no stale recovery/download. The privacy page's real initial JavaScript graph grew to 103,795 bytes against the unchanged 100,000-byte ceiling, requiring a retryable lazy extraction. Crop's saved box was 612 points wide rather than the required 562; the trace shows all insets reset to zero around initialization, requiring readiness/draft-ownership classification and an actual-box regression. All other completed cases, including the new object/page artifacts, SDK consumer, migration, PWA and security guards, passed. The browser window is released for those narrow corrections; no checkpoint or full-service completion is claimed.

The retryable lazy extraction passed **4/4 in 13.240 seconds**: `/tmp/browserpdf-lazy-support-first4-20261018-results.json`. Actual trace-derived idle graphs in the separate `/tmp/browserpdf-lazy-support-first4-20261018-graphs.json` are home 39,393 bytes/8 requests, Merge 85,486/11, Workflows 96,184/15, Privacy 94,752/14 and Doctor 82,334/11. Neither optional module loads on those idle routes; the original 100,000-byte and sixteen-request guards remain unchanged. Retry, held-import cancellation and owned form/history restoration also pass with actual PDFs. Root's source review confirms injected existing delegates, a live initialized core getter and the pre-import empty/unrelated-URL guard; localized relative namespaces remain intact.

The affected correction gate passed **30/30 in 103.246 seconds**, without skips or flaky cases: `/tmp/browserpdf-pages-crop-clear-combined30-20261019.json`. It includes all sixteen Page-route cases, all eight Phase 3/WebMCP cases, extra-source validation, two scene/handoff cases and the Crop/Numbers/Watermark smoke consumers. The unchanged strict Crop artifact is 562×692 points while MediaBox stays 612×792. New cases cover native held-initialization readiness, a newer numeric draft surviving delayed rendering, actual Undo output and superseded asynchronous review; the strengthened Clear case proves fresh five-page content/order and an unchanged owned result after the abandoned read completes. A fresh review then identified a separate source-plausible fast Undo/Reset-to-Review interleaving that these cases do not cover. Its held-render actual-artifact probe is pending, so the checkpoint is still open.

Fresh quality reproduced both fast-history cases in six seconds: `/tmp/browserpdf-quality-held-crop-review-20261018/report.json`, two actual PDFs and screenshots. During held Undo or Reset presentation, the UI reports zero cropped pages and canonical source bytes remain unchanged, but the old 10-point top/20-point left values and native Review button remain active. Immediate review saves a 592×782-point crop instead of the full 612×792 box. Page errors and non-GET requests are zero. The correction therefore owns the complete plan-presentation transition, waits for both thumbnails and the matching actual-page preview, suppresses the generic processing Cancel while that internal transition is pending, and provides deliberate retry/discard/replacement after presentation failure. Review commits only a genuine numeric/drag draft. Five additional portable cases and the fresh post-fix actual-artifact probe are required before accepting this correction; test oracles must not merely wait out the race.

The final Crop invocation passed **21/22 in 98.267 seconds** (`/tmp/browserpdf-pages-history-final22-20261019.json`), then the complete recovery case passed **1/1 in 5.976 seconds** (`/tmp/browserpdf-pages-history-recovery1-20261019.json`). Product source stayed unchanged between them. The single first-run failure expected removal of a prior result panel, while the established Clear contract retains it hidden; only that helper changed to assert hidden/no visible result. All strict native locks and saved-file assertions remain. The recovery tail now proves Retry preserves the chosen 592×782 Redo plan, Discard restores zero/source insets, and a real chooser replaces the failed task with the one-page 612×792 input. These are passing evidence for all twenty-two unique cases, not a single clean twenty-two-case invocation.

Fresh independent post-fix review passed **3/3 held Undo/Reset/Redo cases** (`/tmp/browserpdf-quality-held-crop-review-postfix-20261018/report.json`, three PDFs and six screenshots). All seventeen native controls and nine modes lock, selection is inert and generic Cancel stays hidden during the held presentation. Forced actions cannot publish, download or unlock it. After release, saved Undo and Reset boxes are exactly 612×792; Redo is `[20,0,592,782]`. Original/current bytes and canonical snapshots stay unchanged until explicit adoption; page 2 and MediaBoxes remain intact. Errors and non-GET requests are zero. Root's final source review also confirms matched preview/epoch ownership and chosen-plan retry/replacement recovery.

Root independently reran the complete one-open/one-export journey in **Turkish after lazy extraction**, passing all seven steps on the frozen final product (`/tmp/browserpdf-root-object-page-after-lazy-tr/results.json` and `complete-task.pdf`). Every mode remains under `/tr/`, with one stable task ID observed through each actual entry-derived session. Unapplied Turkish text, a page-3 image, Turkish form values and a page-2 signature survive mode changes. Dirty-plan protection, explicit actual-result adoption, Undo reopening all three real editable objects and Redo all pass. Exactly one final download reopens with three pages, rotations `[0,180,0]`, field `İstanbul Şükrü Çığ`, literal stamp `ROOT-TASK İstanbul ığüşöç` and image counts `[0,1,1]`. Errors and non-GET requests are zero. Together with the frozen full run, the focused corrections and earlier independent compact/touch/preparation proofs, this accepts the bounded compact-editor and first page-route checkpoint. Reader/Highlight/Redact, remaining page/composer tools, conversion/OCR/compression, platform services, final handoff seams and full locale acceptance remain required.

Remaining Pages checkpoint 1 introduced Split, Numbers and Watermark on the shared task surface. Its first eleven-case invocation passed ten cases; the sole failure counted thirty image-resource aliases as thirty embedded images, although all thirty reference the same image object. The correction preserves the thirty placements while asserting one distinct embedded image and actual RGB/alpha content. Root also independently reproduced a separate held-logo cancellation defect: native Cancel initially disables Apply and shows Retry, but releasing the abandoned image read silently rebuilds a candidate and enables Apply. The actual manually downloaded three-page PDF contains that canceled logo on every page. `/tmp/browserpdf-root-logo-cancel-first/results.json`, screenshots and `canceled-logo-actual.pdf` retain that proof, with unchanged canonical bytes and zero errors/non-GET requests.

An isolated current-core probe found another real no-op: valid tiled settings (`DRAFT`, 56pt, spacing 1000) on the four-page rotated/CropBox/UserUnit corpus return a success summary for all four pages while the actual PDF contains zero DRAFT text. `/tmp/browserpdf-root-watermark-empty-tile/results.json` and `empty-tiled.pdf` prove that pure-core behavior; this was not a route run. The grid must produce a visible placement or reject it before success. Owned logo cancellation, sparse centered tiling, stronger image-content assertions and natural 320×720 loaded visibility then passed the fourteen-case correction gate (`/tmp/browserpdf-page-effects-second14-20261019.json`, 57.8 seconds). It also covers all twenty-five split ZIP entries/chosen page 25 and Numbers' actual geometry/form/link preservation. The generic previous/next thumbnail bounds, text-output capabilities and fresh delayed navigation/logo-parameter probes still require review before accepting the checkpoint.

Root's independent logo post-fix journey passed: `/tmp/browserpdf-root-logo-cancel-postfix/results.json` and `fresh-logo-actual.pdf`. The canceled read no longer resurrects Apply or hides Retry, and current bytes remain unchanged. A fresh EXIF-orientation-6 JPEG then exports correctly on all three pages as an 80×120 image; decoded PDF RGB hashes exactly match an independently decoded native-browser input oracle. There is exactly one explicit download and zero page errors/non-GET requests.

Root's independent Numbers-to-Watermark journey passed all three stages on frozen product source: `/tmp/browserpdf-root-decoration-first/results.json`, `numbered.pdf` and `watermarked.pdf`. One input has rotations 0/90/180/270, a nonzero CropBox and alternating UserUnit 1/2. Only selected pages 2 and 4 receive Page 7/8, with physical right/bottom margins exactly 20/18 points. Explicit adoption continues the same task into Watermark; only those pages receive `İstanbul Şükrü Çığ`, centered at the requested 25% from left/35% from top. Both actual downloaded files match their attached, same-CSS native 480×640 previews with **zero pixel difference**. All source boxes, rotations, units, populated interactive field and URI survive. Errors/non-GET requests are zero; both downloads are deliberate verification actions. These specific behaviors pass while the remaining delayed-preparation/navigation findings and Reader release gate stay open.

Fresh independent Page Effects review confirmed both delayed-intent defects on frozen source: `/tmp/browserpdf-quality-page-effects-prefix-first/report.json`, PDFs and PNGs. Holding page-2 preparation and pressing Next twice leaves the input at 3 while the status and visible canvas remain page 2; its PNG hash exactly equals independently rendered saved page 2. With a valid red 40×20 logo A, holding a new blue 60×30 logo B and changing settings enables Apply before B finishes; the actual export still contains red A on all three pages, confirmed by decoded image RGB hashes. Canonical bytes stay unchanged and errors/non-GET requests are zero. Pages owns latest-page rendering and a distinct pending-logo readiness gate, including rejection recovery. Portable regressions and a fresh postfix artifact proof precede acceptance; no saved-data corruption beyond the chosen stale export is claimed.

The first Reader browser gate completed 6 passed/5 failed in 63,667.507 ms (`/tmp/browserpdf-reader-checkpoint-first-20261019.json`). Its real mobile defect placed the initial 320px canvas above the viewport; revealing the owned task before readiness corrected that. Duplicate page-status wording broke an unchanged smoke. Two other failures were fixture/observer defects: clipped search lines supplied only 168 visible hits, and the capability helper observed the prior entry before navigation. The corrected gate passed **11/11 in 48,983.104 ms**, zero skips/flaky/unexpected (`/tmp/browserpdf-reader-checkpoint-second-20261019.json`). It covers selectable/searchable Unicode, outline/named/internal destinations, four rotations with CropBox/UserUnit, all four widths in light/Arabic dark and actual large-scene handoff plus replacement rollback.

Further test review found that the extreme-page replacement helper had sampled the old page, and the proposed image-only capability case still retained text objects. A stronger two-case invocation proved the real 4×1200/4,800-pixel extreme page and search cancellation but failed its image-only tail because the compatible Add Image mode was absent from Reader's menu (1 passed/1 failed, 95,840.906 ms). Adding that menu entry and rerunning the stronger cases passed **2/2 in 14,287.820 ms**, zero skips/flaky/unexpected (`/tmp/browserpdf-reader-checkpoint-focused2-second-20261019.json`). The original added-text/flattened-form assertions remain, with a genuinely image-only later scene now proving preservation of known searchability. Root's own selected-page continuation/actual export and natural 320px Arabic-dark journey still precede acceptance.

Root's first Reader journey passed Unicode search, native double-click/Shift selection and all three Unicode/named outline destinations, then stopped at desktop zoom (`/tmp/browserpdf-root-reader-first/results.json` and `failure.png`). The fitted Letter page already renders at the 1,200-pixel bound (927×1200); choosing 125% keeps the same native and styled dimensions while the label increases. The memory bound is correct. The usability defect is setting CSS dimensions directly from the bounded bitmap, preventing visual magnification once the resolution ceiling is reached. Reader needs separate display/selection/link geometry and bounded raster resolution; the independent oracle must assert CSS growth while preserving native pixel bounds. Export/continuation and mobile tail were not reached and remain pending. The root browser closed and the window was released before any product changes.

The subsequent Pages gate completed **20 passed/2 failed in 117,774.786 ms**, zero skips/flaky (`/tmp/browserpdf-page-effects-third22-20261019.json`). The new latest-page saved-pixel case passes. One failure is a chooser oracle: its trace sets file B while the native input remains disabled during A Review, so B never starts. Waiting for the user's reachable enabled chooser preserves the held-B assertions. The other failure is real: early Use adopts the chosen split output and disposes the group, but predecessor Review's `processing=true` survives the new hydrate and leaves Split disabled. The narrow correction must reset owned processing/progress on that new task presentation, with held-first-review recovery evidence.

Root independently passed both original delayed-intent defects on frozen source: `/tmp/browserpdf-root-page-effects-postfix-first/report.json`, two actual PDFs and PNGs. The page-2 render is held on the new attached temporary canvas; two native Next actions select 3 and the released input/status/visible bitmap all show 3. Its PNG hash exactly equals saved page 3, and the three-page thumbnail panel's Previous/Next bounds remain disabled. A valid red A followed by held blue B and editable settings keeps Apply disabled through the six-second negative check. After B is released, every actual saved page contains blue B at 60×30 with the exact expected decoded RGB hash. Canonical snapshots/current/original bytes remain unchanged; page errors and non-GET requests are zero. Root's browser closed and released the window. This accepts those two corrections; early Split adoption and Reader logical zoom remain checkpoint blockers.

Reader's logical-zoom correction passed its six-case browser gate **6/6 in 27,594.819 ms**, zero skips/flaky/unexpected (`/tmp/browserpdf-reader-zoom-six-20261019.json`). CSS 25/100/125/400% sizes are 253×328 → 1014×1312 → 1267×1640 → 4056×5248, while native 100/125/400% stays 927×1200. The actual ink fractions remain 1.0 under four rotations/CropBox/UserUnit 2, with matching internal-link geometry, shrinking at 375% and exact fit restoration. All four loaded layout cases pass. The optional renderer display viewport uses installed PDF.js RenderParameters.transform; callers that omit it keep their existing bounded rendering path.

Root's complete independent Reader postfix journey then passed **4/4 stages** on frozen source (`/tmp/browserpdf-root-reader-postfix-first/results.json`, `reader-current-edited.pdf`, 400% and natural-mobile screenshots). Unicode search maps `istanbul` to the actual İstanbul text; native double-click and Shift selection remain on page 1. All three Unicode/named outlines navigate to their real pages. Logical CSS grows at 125% and 400%, the TextLayer dimensions match, backing dimensions/area remain bounded and Fit restores the initial size. Reader continues selected page 3 into Add Text with the same task, then one actual downloaded PDF retains all three pages, rotations `[0,180,0]`, the exact Turkish form/stamp, Unicode outlines and new page-3 text. A fresh 320×720 Arabic-dark task has no body overflow, a visible fitted PDF and the full long filename accessible by title. Errors/non-GET requests are zero; exactly one explicit download occurs. The root browser closed and the window was released. This accepts the bounded Reader behavior and both prior Page Effects delayed-intent corrections; the final Split recovery tail, shared affected regression gate and fresh delta review still precede the next commit. Highlight/Redact/composer and all later phases remain open.

The complete Pages invalid-logo/recovery tail finally passed **1/1 in 8,404.516 ms**, zero skips/flaky/unexpected (`/tmp/browserpdf-page-effects-logo-recovery-final1-20261019.json`). All four synthetic uploads now await an actually enabled native chooser; held settings/caret/no-early-export and exact blue-image assertions remain. The tail executes rejected logo, rejected PDF, clearing abandoned input and recovery to the actual blue PDF. Together with the prior twenty passes and corrected early-adoption pass, all twenty-two unique cases have passing aggregate evidence; this is not a single clean twenty-two-case invocation.

Fresh lifecycle review then independently confirmed two impacts of one route-opening ownership defect before the broad gate. `/tmp/browserpdf-quality-page-effects-hydrate-invalid-20261018/report.json` holds initial A hydration, uses the enabled native replacement chooser for invalid B, and proves the exact original/current/task remain intact while releasing A removes the task controls/retry/apply. `valid-report.json` instead opens valid B and exports its actual two-page result before releasing A; the late A cleanup preserves exact B canonical bytes/task but removes B's output group, hides its actual review and removes the loaded body class. Recovery can rebuild B, so this is destruction of the usable presentation rather than canonical data corruption. Both reports retain traces/screenshots and real recovery PDFs, with zero errors/non-GET requests. A serialized opening lifecycle, transactional invalid-candidate rollback and held-invalid/valid artifact regressions are required before checkpoint acceptance. Root's Reader, delayed-page/logo and decoration output proofs remain valid for their unchanged paths.

The lifecycle correction's portable cases passed **2/2 in 10,955.749 ms** (`/tmp/browserpdf-page-effects-hydration-postfix2-20261019.json`). Fresh independent postfix review also passed **2/2**, with actual native malformed and valid replacement flows (`/tmp/browserpdf-quality-page-effects-hydrate-postfix-20261018/report.json`, traces and PDFs). Invalid replacement preserves the complete task/current/original state and usable three-page workspace. A valid two-page B is accepted while old A is held; after serialized A settles, B automatically owns the body class, page preview and review without reselection. Both actual chosen PDFs continue to Organize under their stable task with the correct original. Exact source-page text is retained; errors/non-GET requests are zero. Fresh scoped source/API/bounds/capability/anti-pattern review reports no remaining checkpoint blocker.

Root then froze public code/tests and launched the exact **250 tests in 20 files**, one worker and zero retries (`/tmp/browserpdf-root-reader-effects-full-20261019-results.json`, matching artifacts). The first failure is classified from its trace as a test setup dependency change: the old lazy extra-source retry test aborts the first workspace-support request while opening Reader, which now legitimately uses that helper during intake. It fails at initial viewer readiness before its intended extra-source validation runs. Starting that cold-helper test from Add Text preserves all import-failure/retry counts, immutable owned-state, independently reopened source metadata/form and byte-isolation assertions. Only that test setup may migrate after the full run; no eager-loading or runtime correction is justified by this failure. The broad invocation remains in progress and is not yet a passing gate.

The frozen full invocation completed **249 passed/1 failed/0 skipped/0 flaky in 696,877.429 ms**. All twenty-four Page Effects, twenty-one Page Routes, nine shared panel, eleven Reader, eight object-preparation, eleven object-workspace, seven shell, twenty-three foundation, ten engine and thirty-two legacy smoke cases pass. The SDK consumer, scripting restrictions, PWA, WebMCP, privacy/Doctor/workflow, locale/migration and unchanged idle delivery limits also pass. The only failure is the already classified cold-helper setup above. All 158 recorded runtime/test source hashes remain unchanged (`/tmp/browserpdf-root-reader-effects-full-source-sha.json`, tree `ca3360336d5325e77b7b77143d6ce385c88aff27019294b3f33b936ad696bad5`). Root released the sole browser/globalSetup window for the one-line test-only Add Text setup correction and a complete rerun of that one retry/artifact case. A clean full-250 invocation is not claimed; final bounded checkpoint acceptance still waits for the corrected case.

The corrected cold-helper case passed **1/1 in 4,723.904 ms**, zero skipped/flaky/unexpected (`/tmp/browserpdf-reader-effects-lazy-final1-20261019.json` and actual `retried-external-source.pdf`). Root independently inspected the exact one-line setup change to `open(page, "add-text")`; all import-failure/retry, two-import, exact immutable transfer, byte-isolation and independently reopened two-page title/form assertions remain. Comparing all 158 frozen hashes shows this test file is the only changed runtime/test source. Thus all **250 unique current cases have passing aggregate evidence** (249 frozen full-run passes plus this corrected case), without claiming a clean full-250 invocation. Root accepts the bounded Reader/Page Effects checkpoint for an explicit scoped feature-branch commit and sync. Full Phase 2, all 32 services, annotations/composer, conversions/OCR/compression and platform work remain open.

Root independently verified commit `917f92ee6aa209c7dae2511dcf12d1aa8810b452` (Add a shared PDF reader and reviewed page effects): HEAD, upstream and actual origin feature ref match, parent is `8cf40d7`, the exact forty scoped files have 2,173 additions/891 deletions, body is empty and only the preserved audit directory remains untracked. No main push or production deployment occurred. Browser/source freeze is released for the next two agreed owners on this actual HEAD.

A separate Phase 4 prefix probe now confirms the held-IDB handoff seam in two native replacement cases (`/tmp/browserpdf-root-held-handoff-prefix-second/report.json`, screenshots and actual `held1-current-after.pdf`/`held2-current-after.pdf`). Both first export old A, start Add Image continuation, hold a completed native IndexedDB transaction callback, then use the enabled chooser to install a new two-page B. Releasing pre-adoption cleanup preserves B task identity but replaces its current document with the exact old A artifact. Releasing the post-adoption bundle instead navigates back to old A task and loses the new task. Both actual current PDFs independently reopen as one-page A with its old edit; SHA is identical to the prior explicit A download, errors/non-GET requests are zero. The first private probe used the wrong post-navigation canvas ID and stopped before final evidence; correcting only that observer to include Add Image previewCanvas produced the complete second report. This is verified remaining Phase 4 work, not acceptance of the handoff path or a blocker retroactively added to the bounded Reader/Page Effects commit. Both browsers are closed.

During the next shared composition schema review, root reproduced a joint-resource admission defect through public session APIs (`/tmp/browserpdf-root-composition-resource-prefix/report.json`). Three valid PNG originals with 8-MiB ancillary chunks survive generic adoption/history pruning. A valid one-page 78,644,170-byte PDF is then opened as an editable scene, increasing resources from 25,166,070 to 103,810,240 bytes above the 96-MiB ceiling. This is an independent core invariant proof, without route acceptance. The corrected `beginScene` stages all retained resources before mutation; the same valid-source probe now rejects and preserves an exact full-transfer fingerprint (`/tmp/browserpdf-root-composition-resource-postfix-first/report.json`). Root also inspected the incremental unique raw/normalized resource checks, PNG dimension validation, immutable task-lifetime originals, same-byte composition boundary, empty last-item removal/Undo and current-image bootstrap preserving original PDF/task/history. The exact command `node --test tests/composition-state.unit.mjs tests/reader-text.unit.mjs` passed 14/14, zero skipped, in 154.583375 ms. The documented shared API is accepted for composer integration; handoff/review UI ownership, actual composer/annotation artifacts and remaining 32-service scope are not yet accepted.

Root independently passed both native held-IDB replacement postfix cases on the frozen shared delta (`/tmp/browserpdf-root-held-handoff-postfix-first/report.json` and both actual `held*-new-actual.pdf` files). The private observer records completion of the existing native click handler returned promise; it does not wait for an obsolete hidden button to re-enable. After releasing cleanup or bundle completion, the current bytes remain exactly B, task/original names remain B and navigation stays on Add Text. Each task then accepts a new native edit and explicitly downloads a two-page PDF. Independent PDF.js extraction finds B page 1 plus the new edit, B page 2 and no old A content. Both cases have zero errors/non-GET requests and exactly two deliberate downloads (A reference and final B). This accepts the two original replacement corrections, while same-task newer-bundle preservation, complete affected gates and later continuity still require evidence.

Root also converted the previously planned Reader destination race into a runtime prefix proof (`/tmp/browserpdf-root-reader-navigation-prefix-first/report.json` and three native canvas PNGs). Holding PDFDocumentProxy.getDestination for named root-third leaves the native page chooser available. A newer direct page-2 choice renders the actual rotated page-2 text and pixels. Releasing the old named resolver then replaces it with page 3; its PNG hash exactly matches an explicit page-3 control and differs from the newer page-2 image. Errors/non-GET requests are zero. The browser closed and the sole window is released. A unified navigation intent remains required in the Highlight/Reader extension; this prefix is not a Reader completion claim.

A further independent valid-source session probe confirms the shared delta incorrectly counts restored scene-history copies before aliasing them to their owned resource (`/tmp/browserpdf-root-scene-history-alias-prefix/report.json`). The actual one-page 78,644,170-byte PDF has five harmless no-form scene-history states sharing one source reference. Its snapshot retains 235,932,510 bytes and one 78,644,170-byte resource, within the existing 512-MiB and 96-MiB limits. Restoring its legitimate transfer falsely rejects at 512 MiB and leaves the target empty. This is an admission regression in the pending shared delta, not a production claim. Staged history must reference the already-owned staged scene source before joint validation, and the valid-source exact-content/history/resource probe must pass before shared checkpoint acceptance.

The first shared affected browser gate completed 7 passed/3 helper failures in 68,516.351 ms (`/tmp/browserpdf-shared-composition-handoff-first10-20261019.json`). The two replacement cases stopped at an obsolete hidden-button re-enable oracle despite correct B setup; the same-task case had not natively reselected its existing object after Apply cleared selection. With product source unchanged, the test-only completion observer/native object selection migration passed all three in 14,770.302 ms, zero skipped/flaky/errors (`/tmp/browserpdf-shared-handoff-migrated3-20261019.json`). Root reviewed the helper changes and retained complete task/byte/URL/artifact assertions. The newer same-task reopened PDF independently extracts its unchanged A source plus LATEST SAME TASK EDIT, with no OLD EDIT A. Thus all ten unique affected cases have passing aggregate evidence, without claiming one clean ten-case invocation. Later alias/composer state deltas still need their appropriate gates.

Root independently passed the valid-source alias postfix (`/tmp/browserpdf-root-scene-history-alias-postfix-first/report.json`). The same actual one-page 78,644,170-byte PDF with five history states now restores successfully. Its exact current/original/scene/history/resource fingerprint is preserved and retained bytes stay 235,932,510. Source review confirms staged scene history aliases the already-owned staged resource before joint validation, with a shared metadata validator and input-reference copy map; no placeholder bytes or private engine API are used. This accepts that correction while the new composer/source-comparison/mixed-intake behavior still awaits its browser/artifact gates.

The final frozen shared browser invocation passes **15/15 in 31,833.181 ms**, zero skipped/flaky/unexpected/top-level errors (`/tmp/browserpdf-shared-composition-final15-first-20261019.json`). Root inspected the report. This covers bounded immutable-source comparison, held decoder Clear, composition PDF Use followed by a PDF edit and compatible editable Undo, operation-aware intake, native handoff replacement/same-task ownership, lazy recovery, actual object output and the large inherited Reader task. Fresh review separately passes 21 shared Node checks and the SDK distribution boundary check. The later optional result-group image-work lane and composer entry changes require their own browser evidence.

The composer's first frozen invocation completes **8 passed/5 failed in 151,294.133 ms**, zero skipped/flaky/top-level errors (`/tmp/browserpdf-composer-first13-20261018.json`). Root independently inspected every failure and the relevant source. One defect is real: the PDF-image output group's continuation predicate still requires the source PDF type and revision. Choosing its PNG deliberately adopts the image, so the predicate invalidates its own storage/navigation before completion. The correction must retain strict source-PDF ownership for rendering while separately guarding continuation by task, adapter/selection lifetime, cancellation and result generation; it must prove retry after a storage failure and preserve newer-task/sibling-result protection. The other four failures are test observers: a hidden static button before composer hydration, a width-only render hook missing portrait preview, obsolete Add Text IDs, and treating the Images PNG ZIP as Split PDF outputs. Their semantic migrations retain the actual image content, saved geometry, strict pixel, replacement and full ZIP assertions. No composer checkpoint acceptance is claimed; the browser closed before the narrow correction and test changes.

Root reviewed the narrow correction: the PDF-image adapter and output group supply a separate optional continuation owner without weakening their strict source-PDF render owner. The rail captures the exact canonical task/revision/generation and refreshes it only through the handoff module's synchronous runtime-only notification after verified deliberate adoption. Canonical assertions, atomic transaction guards and ordinary default rail behavior remain. No arbitrary byte match or predicted revision grants ownership. The corrected frozen invocation completes **18 passed/1 failed in 41,573.133 ms**, zero skipped/flaky/top-level errors (`/tmp/browserpdf-composer-corrected19-20261019.json`). All thirteen original cases and four new ownership cases pass, including actual chosen page-25 continuation, post-adoption storage retry, sibling replacement, Clear, portrait held-render cancellation and strict saved pixels. The sole new-PDF-B failure samples the previously enabled source controls before B's asynchronous validation commits; it fails before releasing the old held bundle. Its test-only readiness correction must await B identity and the owned three-page estimate before retaining the existing exact B/current/original, fresh artifact and no-navigation assertions. Root verifies all 174 frozen public/static/locale/test hashes unchanged (`/tmp/browserpdf-root-composer-postfix-source-sha.json`, tree `f68bebb38e8ed99b517828f528c308dfd00134848ba1054cc24cff3b5c6657aa`). Independent native continuation and fresh artifact review still precede checkpoint acceptance.

The new-B readiness correction passes **1/1 in 5,192.305 ms**, zero skipped/flaky/unexpected/top-level errors (`/tmp/browserpdf-composer-newB-final1-20261019.json`). Root inspected the precise semantic wait and the report: B's identity, owned three-file estimate and ready workspace precede the unchanged exact B/current/task assertion, with an added exact original-B assertion. Fresh native PNG output and actual held-handler completion/no-navigation checks remain. Comparing the frozen 174 hashes shows only `tests/image-composer.spec.mjs` changed; production source is identical to the eighteen prior passes. All nineteen unique cases therefore have passing aggregate evidence, without claiming one clean nineteen-case invocation. The existing shared Use/editor/Undo case uses native Use/Undo but public handoff API plus navigation; root's separate actual native continuation journey remains required.

Fresh independent private review passes three actual artifact journeys (`/tmp/browserpdf-quality-composition-phase2-first-20261019/report.json`): Organize duplicates/reorders the chosen composition to B/B/A; Page Numbers writes selected-page 71; two native Undos in each return to the same editable B/A originals, task and exact original hashes. Final RGB/SMask PDFs are byte-identical to their initial composition. Page Numbers reuses an owned handoff URL, as stated in the report. The third journey natively chooses PDF page 2's PNG with Use, disposes the old adapter/group/rail, opens a usable same-task composer retaining the original PDF and exact chosen PNG, then downloads and reopens its actual PDF. Errors are zero. Fresh source/API/anti-pattern review, shared Node 21, affected Node 16 and the SDK distribution boundary check pass; no unresolved scoped blocker is reported.

Root's independent localized composer journey passes **4/4 stages on its first invocation** (`/tmp/browserpdf-root-composer-first/results.json`, `a4-ordered-actual.pdf`, `composed-plus-text-actual.pdf`). Native Turkish intake uses independent EXIF-6/8 and transparent PNG sources, keyboard order, 90-degree rotation, A4 and 36-point margins with fit/fill. Every saved image's decoded RGB/alpha hash matches an independent raw-browser decode, and independent PDF.js image matrices match the physical paper/rotation/layout calculations. Selected-page preview and actual PDF agree at all native **595×841 pixels, zero different channels**. Immutable source comparison remains bounded and shows the exact raw pixels. Native Use, the typed other-entry button and the actual translated Add Text continuation button preserve task/source group; one actual edited PDF retains all three images and the Turkish stamp exactly once. Two native Undos restore the exact editable composition and originals. Errors/non-GET requests are zero; exactly two explicit downloads occur. The browser closes normally.

Root's natural Arabic-dark 320-pixel composer check passes (`/tmp/browserpdf-root-composer-compact-second/results.json`, screenshot and actual `rtl-ordered-rotated.pdf`). The harness performs no scrolling before measuring: the product intentionally reveals the first accepted task, yielding scrollY 357 with the full preview at y 283–625 inside the 900-pixel viewport. Body/root widths stay 320 and the complete long RTL/Turkish filename wraps without clipping. Native keyboard reorder and rotation produce a reopened two-page PDF with exact image RGB/alpha and expected portrait/landscape 842-point geometry. Errors/non-GET requests are zero and one explicit download occurs. The first private report stops solely at an inappropriate scrollY-zero assumption; removing that one observer assertion follows the intentional `scrollIntoView` behavior while retaining all natural visibility, overflow, full-name, keyboard and saved-artifact checks. Production/test source remains unchanged. This accepts the bounded shared-composition/composer behavior; full localization, Highlight/Redact, later conversion/platform services and final all-32 acceptance remain open.

The optional independent Phase 4 initial-read prefix is now runtime-confirmed (`/tmp/browserpdf-root-initial-handoff-prefix-first/report.json`, two PNGs and actual `current-after-initial-read.pdf`). It is separate from the corrected handoff storage-write races. Native Add Text continuation reloads the destination; holding a completed native readonly `getWorkflow` transaction lets the enabled chooser install and fully render a fresh two-page B under its new task with exact B bytes. Releasing the old initial read restores A's old task and the exact SHA of the earlier manual A download. Independent PDF.js extraction reopens one page containing OLD A plus OLD EDIT, without B. Errors/non-GET requests are zero and the only download is the deliberate A reference. The browser closes, and all frozen production hashes remain unchanged; only the authorized test-readiness file differs. Initial handoff consumption and its route callers must respect a newer intake intent in the remaining continuity work. This is a recorded future platform requirement, not a retroactive expansion of the bounded composer checkpoint.

Root independently verifies commit `1184fc6addf80f4aa5a2fc49e10aab1f8d178ad4` (Add shared image composition and guarded document handoffs): actual HEAD, upstream and `git ls-remote` feature ref match, parent is `917f92e`, the exact thirty-seven allowed paths contain 2,318 additions/708 deletions, and the body is empty without attribution. Only the forty preserved audit files remain untracked. No main push or deployment occurs. The bounded shared-composition/composer checkpoint is accepted; fresh Highlight/navigation and disjoint Redact implementation may proceed on this verified HEAD. All later service/localization and final thirty-two-service requirements remain open.

The navigation dependency's first frozen browser gate passes **8/8 in 11,387.147 ms**, zero skipped/flaky/unexpected/top-level errors (`/tmp/browserpdf-highlight-navigation-checkpoint1-first8-20261019.json`). Root reviews the narrow source change: valid explicit page, search, thumbnail, zoom and public render choices share the destination intent counter; incidental resize refresh does not advance it. Stale error publication remains guarded, and continuation invalidates an old destination. New native-handler completion tests compare the full actual page PNG/text for direct/search/thumbnail choices, retain a positive held destination across resize, and preserve a replacement source. Existing Unicode/native Shift selection, outlines, four-rotation CropBox/UserUnit geometry and logical zoom also pass.

Root's original independent named-destination postfix succeeds (`/tmp/browserpdf-root-reader-navigation-postfix-first/report.json`). A stronger private observer then replaces its fixed 750-ms settling step with completion of the actual native outline handler's returned promise (`/tmp/browserpdf-root-reader-navigation-postfix-complete/report.json`, two PNGs). After that handler settles, the newer rotated page 2 still has its exact text and full canvas SHA `dd5c7eb5b54ed847f086dd70e282a462ce3a8c8c0afadcdf8ea91ae8acab1bb5`; obsolete page 3 does not win. Errors/non-GET requests are zero. Both browsers close and source remains frozen through verification. The navigation correction is accepted for Highlight integration; this is not completed Highlight/Redact or final Reader/localization acceptance.

The shared Reader refresh/continuation API gate passes **11/11 in 13,729.170 ms**, zero skipped/flaky/unexpected/top-level errors (`/tmp/browserpdf-reader-refresh-first11-20261019.json`), inspected by Root. Three new API-host journeys exercise a failed staged render retaining the old PDF/text cache/DOM/query/search results/pixels followed by actual retry/focus, disposal while native completion is held preserving new B, and rejected/stale continuation restoring controls without a storage write. Eight prior navigation/selection/geometry/zoom cases remain passing. These are actual shared-API/browser tests, preceding completed annotation-route acceptance.

Root independently exercises the frozen public redaction core against four independent source cases (`/tmp/browserpdf-root-redaction-core-first/report.json`, four actual PDFs and four geometry PNGs; private harness `/tmp/browserpdf-independent-redaction-core-review.mjs`). **All four pass.** Plain hybrid output removes page-1 text and retains both untouched-page selectable markers. Repeated-form and internal-link inputs reject hybrid mode, then explicitly chosen full raster removes all selectable text. Every actual saved output has the expected visible/indirect page counts, no orphan pages, no retained unique secret or metadata in any inspected raw/decoded indirect object, no forms and no source Info/XMP. On the four-rotation/nonzero-CropBox/UserUnit corpus, every MediaBox/CropBox/Rotate/UserUnit and physical viewport is preserved. All four actual native 2× images match independent source rendering plus the mask at every RGBA channel; every masked pixel is opaque black. This validates ordinary public-core outputs, without a browser, repository fixture writes or route acceptance. The implementing owner's thirteen core cases additionally cover parser/inflate/admission and held encode/embed/save cancellation; known cleanup/AbortError handling and fresh quality review remain before complete core integration acceptance.

Fresh quality subsequently confirms a fractional-page geometry defect outside the integer corpus (`/tmp/browserpdf-quality-fractional-redaction-prefix`, actual PDFs/PNGs). Flooring a 640.5×480.5 raster and stretching it across the full physical page introduces 480 nonblack pixels inside the intended mask and 1,282 changed outside pixels. Source pixels were overwritten; this is resampling/geometry evidence, without a demonstrated recovered-text or secret leak. The correction retains the original pixel/admission contract and draws floorWidth/scale by floorHeight/scale from the top-left visual anchor, preserving boxes/Rotate/UserUnit. The owner's expanded seventeen-case core gate passes, including sixteen strict fractional rotation/unit/scale comparisons. Three targeted native cleanup tests retain the exact AbortSignal reason after task destruction rejects. Fresh quality's unchanged exact probe passes at 1× and 2× (`/tmp/browserpdf-quality-fractional-redaction-postfix-first/report.json`), zero nonopaque mask or changed outside pixels.

Root independently validates a different fractional four-rotation corpus with crop x/y/width/height 20.125/30.125/320.125/240.125 and UserUnit 1/2 (`/tmp/browserpdf-root-redaction-fractional-corpus/manifest.json`). The actual 60,139-byte output passes (`/tmp/browserpdf-root-redaction-fractional-postfix-first/report.json`, PDF and four PNGs): exact original boxes and physical viewports, all native 2× RGBA channels equal independent source-plus-mask rendering, zero nonblack masked pixels, no secret/metadata indirect objects or orphan pages. The already accepted ordinary corpus is not repeated. Root accepts Step1 core integration after these ordinary/fractional artifacts, bounded parser/inflater/admission/cancellation tests and fresh review. Full Redact UI, held initial intake, cancellation, cleaned-copy inspection continuation and locale/compact acceptance remain required.

Root independently inspects the two Reader review corrections: **2/2 pass in 3,639.995 ms**, zero skipped/flaky/unexpected/top-level errors (`/tmp/browserpdf-reader-review-corrections-first2-20261019.json`). A native outline heading without a destination stays disabled through page/search/zoom while its valid child navigates to page 3. Rejecting or invalidating continuation with an actual pending Highlight scene leaves that scene intact, without loading the object-scene writer or writing a handoff. This accepts the scoped review corrections, preceding full annotation routes.

The first native Highlight route slice completes **1 passed/2 failed in 38,009.164 ms**, zero skips/flaky/top-level errors (`/tmp/browserpdf-highlight-native-first3-20261019.json`), independently inspected by Root. The actual property/Unicode/AP/held-render/Delete/Undo case passes. Both other cases stop at the native page chooser: entering page 2 or 5 returns to 1. Selection changes call Highlight controls, which call Reader `setDisabled(false)` despite an unchanged lock; the shared control refresh overwrites the user's in-progress number field. This is a real native-input defect. An idempotent shared lock update and unchanged native page-entry assertions must pass before the private four-rotation/multiline/mixed-scene journeys run. No route acceptance is claimed.

The corrected Highlight slice completes **2 passed/3 failed in 56,176.314 ms**, zero skips/flaky/top-level errors (`/tmp/browserpdf-highlight-native-corrected5-20261019.json`), independently inspected by Root. Shared same-lock/native page editing and the exact-owner property/Delete/Undo artifact pass. Four-rotation selection now reaches page 2 but its native drag helper has an endpoint outside the default 720px viewport, with a 587px vertical selection exceeding the 547px viewer clip. A deliberate desktop viewport and both caret endpoints inside the actual viewport/clip preserve the strict text/quads oracle. All intrinsic unsupported-text branches pass; a later ArrowRight-collapse assumption needs an observed native collapsed selection. The new held same-task review case suppresses old output and exposes Retry, but a selection event overwrites its actionable document-changed status; its final fresh-note export remains blocked. The owner is correcting that status priority and the two helper assumptions. Root's private route journeys remain unrun; no native route completion is claimed.

The corrected failed-three slice passes two cases and stops at one remaining native-drag helper in **20,128.525 ms** (`/tmp/browserpdf-highlight-native-failed3-postfix-20261019.json`), inspected by Root. Unsupported/collapsed/outside selection now passes. The held unrelated same-task edit suppresses old publication, preserves its actionable failure status, retries the actual current preview and exports the exact LATEST note. Four-rotation selection still stops at an empty page-2 native range; its export tail has not run. Root's first independent private invocation also stops before mutation at page 1 (`/tmp/browserpdf-root-highlight-native-first/report.json`): both outward bounding-box points hit the text-layer container at the same final child offset, yielding a collapsed range. This classifies that private helper assumption and provides no product defect. All 187 frozen public/test hashes remain unchanged.

Root corrects only its private helper to use real first/last one-character rectangles and read-only native caret hit tests at text offsets zero/final before an actual mouse drag. The second invocation passes **5/5 stages** (`/tmp/browserpdf-root-highlight-native-charhit-second/report.json`, actual 5,745-byte PDF). All four rotations/CropBox/UserUnit variations select their exact phrase; multiline selects both real lines. Independent default-space quads match native ranges, Unicode notes/color/0.6 opacity survive Save/Discard, and Delete/Undo/Clear/Undo restore the scene. Angled/skewed/sideways text is rejected without mutation. The saved annotation counts are `[3,1,1,1,0]`, the original green Unicode note/AP hash survives, and the actual selected-page preview agrees at all **1013×796 native pixels, zero different channels**. Every target span stays connected throughout its drag, so no incidental TextLayer replacement occurs in this journey. Errors/non-GET requests are zero; exactly one explicit PDF download occurs. All 187 frozen hashes remain unchanged and the browser closes.

Root's independent Turkish mixed-object journey then passes **6/6 on its first invocation** (`/tmp/browserpdf-root-highlight-mixed-first/report.json`, actual 17,379-byte PDF). A single native intake continues Text → Image → typed Turkish Signature → Highlight → Add Text → Highlight note edit/Delete/Undo, followed by one explicit download. Task, exact original hash and all asset hashes survive; generic transform controls exclude the highlight while retaining editable text/image/signature objects. The actual five-page output has both Turkish stamps exactly once, image draws `[0,1,1,0,0]`, annotations `[2,0,0,0,0]`, the original green note and the exact edited highlight note. Errors/non-GET requests are zero and all 187 hashes remain unchanged. The browser closes and the window is released. These accept the bounded normal native/mixed paths; fresh review's dirty-result-rail, invalid replacement during opening, Redact draft/rail and remaining lifecycle/layout/Privacy gates still precede complete route acceptance and commit.

The fresh Highlight review corrections pass **3/3 in 6,924.537 ms**, zero skipped/flaky/unexpected/top-level errors (`/tmp/browserpdf-highlight-reviewed-lifecycle-first3-20261019.json`), independently inspected by Root. The portable four-rotation helper now uses native first/last character hit boxes and reaches its unchanged actual quads/AP/original annotation/repeated-byte artifact tail. A real held IndexedDB continuation loses ownership when the user types an unsaved property; the old result/download/navigation is invalidated, and Save produces the actual changed-note PDF. Invalid native B during a held initial A opening waits for and resumes the retained A workspace, which then accepts real annotation actions and exports correctly. Root reviews the synchronous result invalidation/dynamic continuation guard and the awaited opening/resume correction. The normal native/mixed proofs are not repeated for these narrower causes. Redact draft/current-rail, numeric precision, native route, Privacy intake and remaining layout/lifecycle gates stay open.

Redact's first native seven-case slice completes **5 passed/2 test-helper failures in 16,727.030 ms**, zero skips/flaky/top-level errors (`/tmp/browserpdf-redact-native-first7-20261019.json`), independently inspected by Root. The completed cases prove explicit whole-document form/link raster consent and clean indirect objects/capabilities; fractional four-rotation pointer/numeric/keyboard masks with strict saved RGBA; held native encoder cancellation/draining/recovery; and one-field decimal validity plus rejected replacement retaining masks without reviving an old clean-result rail. The two stopped cases pass JSON arrays to Node crypto's byte-only update API before their history/held-read tails. A one-line `Buffer.from(bytes)` normalization preserves the actual ownership/artifact assertions. The exact failed two then pass **2/2 in 4,766.178 ms**, zero skips/flaky/errors (`/tmp/browserpdf-redact-native-failed2-postfix-20261019.json`), independently inspected by Root. Use chooses bytes identical to the clean download with the same task/original; Undo restores source and Redo restores the exact cleaned PDF plus a fresh Privacy rail and byte-identical second download. A completed old initial workflow read cannot replace ready B; the subsequent actual 10,908-byte output retains NEW B PAGE 2 and no OLD A, with a clean indirect-object scan. All seven unique cases have passing aggregate evidence, without claiming one clean seven-case invocation. Product/core source is unchanged across the test-only repair. Remaining lifecycle/layout/touch/Privacy and Root actual route gates stay open.

The first affected Privacy dependency invocation completes **15 passed/2 failed in 29,110.533 ms**, zero skipped/flaky/top-level errors (`/tmp/browserpdf-privacy-dependency-first17-20261019.json`), independently inspected by Root. All seven new guarded-intake cases and both native annotation smokes pass. The idle browser graph actually loads **102,025 bytes**, exceeding the unchanged 100,000-byte limit; the historical static prediction omitted existing graph growth. The delayed-runtime test holds before calling native PDF.js metadata, then calls that native method after Clear destroys its transport, leaving its returned handler unsettled. Pinned PDF.js source supports this test-hook classification. The narrow correction lazily imports only the cleanup engine with retry and exact post-await ownership checks; the test instead holds an already completed native metadata result and still awaits the actual event-handler promise plus the complete stale-output/control-recovery tail. A new native cleanup import-failure/retry case checks the actual verified two-page download. Static graph size is 97,304 bytes after the correction; actual browser performance and the focused five-case postfix remain pending. All 242 frozen hashes stayed unchanged during the first invocation and the browser closed. Preserve the fifteen passes without claiming a clean seventeen-case run or completed broader Privacy work.

The narrow Privacy postfix passes **5/5 in 7,599.822 ms**, zero skipped/flaky/top-level errors (`/tmp/browserpdf-privacy-dependency-corrections-first5-20261019.json`), independently inspected by Root. Both prior failures, existing explicit cleanup, same-task cleanup ownership and the new native import-retry artifact pass. The actual browser gate proves fewer than 100,000 initial bytes and at most sixteen requests; 97,304 remains a separately reconstructed static total because the successful browser test attaches no exact metric. The metadata hook confirms native completion before Clear, then observes the actual handler completion and unchanged full recovery tail. All eighteen unique dependency cases have passing aggregate evidence across retained invocations, without claiming one clean seventeen-case run. The browser closes before Root independent route review.

Root independently passes **3/3 native Redact journeys on the first invocation** (`/tmp/browserpdf-root-redaction-native-first/report.json`, actual 12,147/45,010/58,811-byte PDFs). Real pointer/numeric Save/keyboard Undo produces a hybrid PDF with no secret/metadata in any inspected indirect object, no orphan pages and both untouched selectable-text markers retained. Review preserves current bytes; Use selects the exact download SHA while preserving task/original, Undo/Redo restores exact artifacts, and a native Privacy continuation reads that same chosen SHA and completes its scan. An unsafe repeated form requires explicit whole-document raster consent and its saved output has no selectable text/forms or retained secret/metadata. Four fractional rotations retain exact raw boxes, Rotate/UserUnit and physical viewports; every native 2x RGBA channel matches independent source-plus-mask rendering and every masked pixel is opaque black. Zero page errors/non-GET requests occur, with one explicit download per case. All three contexts and the browser close. Privacy initial-read B/Clear probes and remaining portable lifecycle/layout gates still precede checkpoint acceptance.

Root independently passes both initial Privacy continuation races on their first invocations (`/tmp/browserpdf-root-privacy-initial-B-first/report.json` and `/tmp/browserpdf-root-privacy-initial-Clear-first/report.json`, actual metadata-cleaned PDFs). A native Add Text A edit continues to Privacy while the completed initial workflow read is held. Fully ready native two-page B is scanned before old A is released; the actual initial consumer promise settles without any A File read, and exact B/task/report remains unchanged. In the separate Clear variation, Clear is reachable before release, removes the workflow query and leaves canonical task/current/original null; late A performs no File read. Fresh native B remains usable. Both variations then perform native Scan and explicit metadata cleanup/download; independently reopened saved pages contain only ROOT PRIVACY NEW B PAGE 1/2, with no old A and no source title/author. Zero errors/non-GET requests occur and exactly one explicit download occurs per invocation. All browsers close, all 185 independently frozen source/test hashes remain unchanged, and Root releases the sole window to the remaining portable lifecycle/layout gates. This accepts the new Privacy entry; the confirmed comprehensive initial-read defect in older entries remains Phase4 work.

Root additionally compares the independent verifier's 242-file post-gate manifest, including `public/translations.json`, with the source after its private probes: no changes (`/tmp/browserpdf-root-annotation-private-parent242-check.json`). Before any added Redact layout run, fresh source review identifies a blocked oracle/product-contract seam: the native fixture names are 193/194 characters, while `createArtifact` deliberately retains only 160, and identity title/aria uses that shortened value. No responsive failure is claimed because no browser was launched. A fresh shared owner is discovering a bounded display-name contract that preserves safe output names, original/current/history/handoff ownership and existing resource limits before API lock. The fixture is not shortened to hide the accessibility gap.

For future Phase3 independent script coverage, Root prepares `/tmp/browserpdf-root-script-corpus/manifest.json`: a 1,193-byte deflated DOCX and matching Markdown contain seven regular Arabic/Hebrew, diacritic, mixed Turkish/Greek/Cyrillic/number, explicit LTR/RTL and per-run style paragraphs. Italic is requested only on a Latin run adjacent to regular Arabic and bold Hebrew. A separate 964-byte DOCX requests Arabic italic for an accurate unavailable-style path. ZIP CRC, XML, exact logical text, bidi and style markup pass source-integrity checks. No app conversion, PDF output or visible shaping has run; this is an additional independent input, not service acceptance. Repository product/tests/fixtures and browsers remain untouched.

Root reviews the narrowly implemented typed `displayName` contract and affected unit evidence (`docs/document-display-name-contract.md`, `/tmp/browserpdf-display-name-owner-20261019/`). The display label is limited to 260 UTF-16 units with control removal and surrogate-safe ellipsis; the existing 160-unit export/File/ZIP name remains. Explicit descriptor-name pairing prevents newly named outputs from inheriting a source label. Metadata, scene/plain history/future, resources, deduplicated handoff and preserve-current Reader/object/page/effect continuations retain their own names. The owner's affected Node gate passes **47/47 in 3,412.787792 ms**, zero failures/skips/canceled; eleven syntax checks and diff check pass. Root reads the six real-byte unit bodies, saved isolated diff and native long-name acceptance case. Static eager growth is 109 bytes with no graph-path changes; Privacy 97,413 and Workflows 97,132 are static totals only. Native long-name/idle gates remain pending fresh review; no annotation checkpoint or mobile completion is claimed.

The first frozen display-name native/idle invocation completes **1 passed/1 failed in 18,604.316 ms**, zero skips/flaky/top-level errors (`/tmp/browserpdf-display-name-native-idle-first-20261019.json`), independently inspected by Root. Full native initial/result labels and the actual first Highlight PDF/SHA/AP pass, but Highlight to Add Text reports an unsupported result format. Preserve-current Reader publication/continuation omitted the already known input MIME type; the 160-unit safe name lacks its extension, so inference changes PDF to octet-stream. Object/page-task/page-effect pairs have the same omission. The approved narrow correction forwards their authoritative existing input type, retaining constructor inference/export-name policies and ownership. The mode/history/second-artifact tail remains unverified. The idle case passes. Root independently reconstructs its native trace request paths against unchanged frozen local source lengths, matching the existing test metric: home 39,393B/8 requests, Merge 90,430B/11, Workflows 97,132B/15, Privacy 97,413B/12, Doctor 87,278B/11 (`/tmp/browserpdf-root-display-name-idle-trace-review.json`). JavaScript response bodies are absent from the trace, so these byte totals use frozen file lengths, not captured body sizes. All 243 gate hashes remain unchanged; the browser closes before the narrow correction.

The narrow authoritative-type correction forwards exactly eight existing `input.type` values at the four lazy adapters, with no inference/export-name or idle graph change. Its meaningful workspace-input/deduplicated-File/session unit extension passes with the focused **11/11 in 123.804167 ms**; fresh review and syntax checks pass. The unchanged failed native case then passes **1/1 in 6,524.533 ms**, zero skipped/flaky/top-level errors (`/tmp/browserpdf-display-name-native-type-postfix-first-20261019.json`), independently inspected by Root. Full Highlight to Add Text to Highlight, two Undo/Redo steps and both actual one-page/two-annotation PDFs reach the unchanged task/original/current SHA, title/aria, source text, exact final Unicode note/AP and bounded download-name tail. All 243 frozen hashes remain unchanged and the browser closes. The retained idle pass plus this corrected native pass accept the bounded filename/type seam as aggregate evidence, without claiming one clean two-case invocation. Remaining Redact/Highlight lifecycle/layout, broader appropriate regression and fresh checkpoint review still precede annotation commit.

The added Redact seven-case invocation completes **3 passed/4 identical helper failures in 12,279.519 ms**, zero skipped/flaky/top-level errors (`/tmp/browserpdf-redact-added7-first-20261019.json`), independently inspected by Root. Both native lifecycle races pass: a held encoder loses to Clear and fresh B without reviving identity/output, and an actual held PDF save drains before ready B publishes its fresh usable artifact. Deliberate Use to Privacy passes with exact download/current/scanner SHA for the actual 10,048-byte three-page cleaned PDF; metadata/XMP/forms findings are zero. Each width case passes its English initial width/fit/useful-PDF checks, then compares an omitted English `html.dir` attribute (empty string) with effective LTR and stops. This is a measurement mismatch; Arabic/touch/later native editing and saved-artifact tails have not run. A test-only computed-style direction reading, retaining explicit Arabic RTL and all other assertions, is approved before the exact failed four rerun. No product HTML/CSS or passing-three repeat is indicated. All 243 frozen hashes remain unchanged and the browser closes.

The computed-direction-only postfix completes **1 passed/3 failed in 10,026.011 ms**, zero skipped/flaky/top-level errors (`/tmp/browserpdf-redact-layout-failed4-postfix-first-20261019.json`), independently inspected by Root. The 390px English-light/Arabic-dark case completes actual PDF/strict RGBA and native touch cancellation. At 320/768/1440, native keyboard placement focuses the real mask but its fitting rectangle remains below the viewer clip by 0.375/0.09375/0.03125 CSS pixels; later action/artifact tails stop there. Root decodes the native frame rectangles and inspects focus CSS: the mask has a two-pixel outline plus two-pixel offset, while even the passing 390px bottom clearance is only 0.15625px. A narrow focused-mask native scroll margin is a supported focus-visibility refinement; the exact native scrolling cause is being classified. No saved-pixel/redaction engine defect or general responsive failure is inferred from the subpixel values, and no blanket assertion tolerance or mask geometry change is approved. The browser closes before any correction.

The scoped selected/focus-visible mask rule gains only `scroll-margin:5px`, accounting for its existing 4px focus outline and a 1px reveal buffer. Fresh review confirms no mask/PDF geometry, overflow, preview or assertion change. The exact failed widths then pass **3/3 in 12,254.858 ms**, zero skipped/flaky/top-level errors (`/tmp/browserpdf-redact-focus-margin-failed3-first-20261019.json`), independently inspected by Root. All six 320/768/1440 English-light/Arabic-dark contexts reach native keyboard placement/focus/Arrow/numeric editing without scroll, actual PDF strict zero-different RGBA, all-object secret/metadata exclusion, retained untouched text, full accessible names, theme/direction and unchanged canonical task. Previously clipped placement preconditions remain; final mask clearances are 4.625/4.90625/4.96875px without tolerance changes. All 243 frozen hashes remain unchanged and the browser closes. All seven added unique cases now have passing aggregate evidence, retaining the earlier three lifecycle/Privacy cases and 390px/touch case; this is not one clean seven-case invocation. With the original seven, all fourteen native Redact cases have aggregate passing evidence plus Root's three actual route journeys. Remaining Highlight lifecycle/layout, broader appropriate regression and fresh checkpoint review still precede the annotation commit; complete locales/platform/all32 remain open.

Root additionally validates the new script input through cached integrity-verified Mammoth 1.9.0 public `convertToHtml` in an isolated Node preflight (`/tmp/browserpdf-root-script-corpus/mammoth-preflight.json`). All seven logical paragraphs survive exactly, including diacritics/numbers, Latin-only italic and Hebrew/Turkish bold; requested Arabic italic remains explicit for later accurate font-choice handling. The source has five bidi paragraphs while generated HTML has no explicit direction attribute/style, so preserving Word paragraph direction needs a deliberate model/supplement policy if promised. No app conversion, PDF output or visible shaping is accepted by this upstream check; no browser/network/dependency/repository product/test changes occur.

The first remaining Highlight seven-case invocation completes **3 passed/4 failed in 43,106.877 ms**, zero skipped/flaky/top-level errors (`/tmp/browserpdf-highlight-remaining7-first-20261019.json`), independently inspected by Root. All three actual completed-save/render-held Clear/new-B ownership journeys pass, including ready B before old handler release, exact state/pixels after actual completion, and a fresh real two-page B annotation download. English 320/390 cases reach actual saved AP/Unicode/long-name/task checks, then strict selected-page comparisons report 1,586/2,113 differing RGBA channels. English 768/1440 records native character caret endpoints but its real drag collapses to an empty range. No Arabic layout or stopped artifact tail is accepted. All 190 source/192 extended frozen hashes remain unchanged and the browser closes. Pixel/selection classification proceeds on unchanged source with no tolerance relaxation. Fresh source review also identifies two separately unconfirmed edges, post-Use Redact Cancel retaining old preview and direct export after deleting the last Highlight object; only a narrow private native classifier is allocated before any patch. Root confirms the same empty-object apply guard exists in the shared Text/Image/Signature workspace and tracks that full32 concern separately from already passing nonempty exports/Delete-Undo.

The two narrow private classifiers reproduce both source hypotheses on their first invocation (`/tmp/browserpdf-annotation-edge-classifiers-20261019-a/report.json`), zero errors/non-GET requests and all 189 frozen hashes unchanged. Redact holds an already completed detached 1014x760 candidate render, then native Use commits the exact 6,178-byte cleaned copy. Native Cancel waits for the actual release/drain, then unlocks the unchanged original secret text/pixels under that chosen clean identity: source comparison has zero different channels, clean comparison has 247,791. Canonical saved bytes remain cleaned; this is a stale interactive preview, not evidence that the cleaned file retains source content. Task/original remain exact; ordinary Undo/Redo restores source/clean preview, with clean pixels zero different. Root separately reopens the canonical artifact and checks the unique source marker is absent from inspected indirect objects. A durable current-preview synchronization contract must cover adoption, Retry/Cancel and committed history refresh before further acceptance.

The Highlight classifier first saves a real 1,804-byte one-annotation PDF, then deletes the final object. The source preview/empty scene updates, but Review disables and result/download is hidden. A native Reader continuation still materializes the removal into a same-task 999-byte zero-annotation PDF, separately reopened by Root. This confirms direct zero-scene export is inaccessible, while the deletion model itself works. Shared Text/Image/Signature controls have the same empty-count guard and require coherent full32 treatment. Both classifier browsers close before product changes; accepted nonempty/normal artifacts remain scoped evidence.

The unchanged-source private 320/768 diagnostic closes with all 207 frozen hashes unchanged (`/tmp/browserpdf-highlight-layout-diagnostic-first-20261019/report.json`), independently inspected by Root. At 320, the exact Reader PageViewport, output transform, native dimensions and PDF bytes are retained. The last Reader candidate, result-preview document and actual saved document share SHA `0f356d081d87dafc746c6fe0722ecad0fd45b958f61feea7696aeeed6999df76`; the visible canvas exactly matches that candidate before and after Review. Rendering those identical bytes into an attached probe still reproduces 1,586 changed channels. A separately modified 0.4-alpha diagnostic copy differs by 2,289, excluding the stale-opacity hypothesis. Candidate-versus-probe DOM font-smoothing context remains a concrete cause to classify; the previous Objects checkpoint already records an independently proven inherited-style effect. At 768, connected text nodes, page geometry and render count remain stable while the native drag stays collapsed, excluding the proposed TextLayer replacement during that gesture. The separate immediate Shift+Home control is also empty, without establishing keyboard-selection support. No layout cause or Arabic artifact acceptance is claimed, and strict zero-difference assertions remain.

Root approves two narrow corrections after that diagnostic closes. Redact tracks the exact canonical owner and a ready/pending/blocked preview state across Use, Retry and committed Undo/Redo. Only a successful exact-owner Reader refresh acknowledges synchronization; cancellation or render failure retains the requested canonical version in a blocked state until Retry. All stale source-derived surfaces, including page/text and search/outline/thumbnail panels, must be hidden and inert while replacement, Clear, status and recovery remain reachable. Separately, Highlight and shared object routes may export an edited scene after its last object is removed, using route-local successful-edit/history evidence while retaining all preparation/failure/ownership guards. Native completed-render cancellation/history/recovery and actual Text/Image/Signature/Highlight removal artifacts remain required before acceptance.

The short context diagnostic closes with all 207 frozen hashes unchanged (`/tmp/browserpdf-highlight-layout-context-diagnostic-20261019/report.json`), independently inspected by Root. Six same-byte, same-viewport 320px render variants establish the font-smoothing cause: detached default/auto/antialiased and attached explicit auto all match the actual Reader candidate/visible bitmap with zero different channels; attached inherited or explicit antialiased both reproduce exactly 1,586. A probe-only explicit `webkitFontSmoothing='auto'` matches the actual detached renderer without changing product pixels or the strict zero-difference oracle. At 768, trusted left-button input has no active modifiers, Selection mutation or scripted focus call; connected nodes, geometry and render count remain stable, and selections are collapsed before and after the app handler. The keyboard control produces no native selection-change event and does not resolve the cause. No desktop selection fix or Arabic tail is accepted yet. Fresh Redact source review additionally requires bootstrap acknowledgement to check `reader.ready === true` as well as exact owner: Reader can return an API after catching an initial render error. A native initial-render failure/Retry case is approved alongside the synchronization regressions.

A fresh 768-only foreground/target classifier also closes unchanged (`/tmp/browserpdf-highlight-layout-focus-diagnostic-20261019/report.json`), independently inspected by Root. The original and explicit bring-to-front controls both collapse while the document is focused and visible. The exact span has selectable text, pointer events and no obstructing overlay; native range endpoints advance together while nodes/geometry/render count remain stable. Foreground input is excluded, without establishing a production cause. The selectstart callback's control rebuilding is the next isolated hypothesis; no speculative layout patch is approved.

The coherent correction invocation completes **11 passed/2 failed in 40,918.457 ms**, zero skipped/flaky/top-level errors (`/tmp/browserpdf-annotation-corrections-first13-20261019.json`), independently inspected by Root. Both mobile Highlight cases complete English-light/Arabic-dark native edits and strict actual saved annotations/pixels. All four Text/Image/Signature/Highlight Delete-last journeys complete actual empty-scene PDFs, original AP/text preservation, byte-identical repeat exports and native Undo/Redo. Redact Use/Cancel, failed Retry/Cancel, committed Undo/Redo cancellation, non-Abort history render failure and initial render failure all reach blocked side-surface/accessibility guards and exact successful Retry/artifact tails. The two fresh-B replacement/Clear cases retain exact B/task state, then stop at 12,714 changed channels before their artifact tails. Their comparison helper uses auto smoothing, although these calls follow fresh attached Reader.open rather than detached Reader.refresh. Root's earlier prelaunch assumption that every new helper call followed refresh was incorrect; source/trace classification precedes a narrowly parameterized initial-versus-refresh context correction. Strict zero-difference assertions and the eleven passes remain; no clean thirteen-case invocation or completed replacement tail is claimed.

Root's exact-prefix independent postfix passes **2/2 on its first invocation** (`/tmp/browserpdf-root-annotation-edge-postfix-first/report.json`), with all 243 public/test hashes unchanged and no errors/non-GET requests. Native Redact Use commits the same 6,178-byte cleaned SHA `152cbf37d309ddcc352aa053f7b5558e160af01809cdb45299351a936e32cbad` as the original classifier. Cancel awaits actual completed-candidate release and handler drain; the stale page and populated secret-search/two-thumbnail panels are hidden, inert and aria-hidden, Reader/mask actions remain locked and Clear/Retry are reachable. Native Retry and subsequent Redo show the exact clean 1014x760 bitmap with zero different channels. Root independently reopens all indirect objects: no unique secret/source metadata, Info/XMP, forms or orphan pages remain in the chosen two-page file. Highlight's native Delete-last now permits a direct actual 999-byte zero-annotation PDF, byte-identical repeated export and same-task Reader continuation, all SHA `367655f70361f5ba926abe18a16609904f48ef6e96d6a5412bdce91506c1b7e9`; native Undo/Redo and original/task identities remain exact. Root separately reopens all four saved Highlight files, confirming annotation counts 1 then 0/0/0. One Redact and three Highlight downloads are deliberate. The browser closes and releases the sole window. These exact two findings pass; the stopped fresh-B tails, desktop selection cause and broader checkpoint gates remain open.

The fresh-B trace/source confirms both stopped comparisons follow initial attached Reader.open, without a refresh. The helper now defaults to auto for detached refresh comparisons and requests antialiased explicitly only for those two initial-render callers. Their first focused postfix passes **2/2 in 7,575.573 ms**, zero skipped/flaky/top-level errors (`/tmp/browserpdf-redact-sync-fresh-B-failed2-postfix-20261019.json`), independently inspected by Root. Both actual completed-old-adoption replacement/Clear paths reach exact fresh-B pixels with zero different channels and complete their native fresh-artifact export tails. The original eleven passes remain, giving thirteen unique passing cases across retained invocations, without claiming one clean thirteen-case run. Desktop native selection and the coherent final checkpoint review/regression remain open.

Root independently reopens the four postfix PDFs. Both original cleaned copies remain 10,048 bytes/SHA `f385893d38004a1fc851e47b61054b66d514c8fc49853dba73019dfdda18a316`; both fresh-B results are 10,908 bytes, three pages and SHA `93744f708f2c0c7de738779844fead26a3c6c691936a11a64b5b1acc56a5851a`. The independent all-indirect inspector finds no unique redacted secret, source-private metadata or orphan page in either B result; title/author are absent and forms are zero. No additional browser invocation is needed for this saved-artifact review.

Further desktop controls retain their negative results without speculative product changes. Disabling both app selection callbacks still collapses the native range; an iframe clone is invalid because its font/geometry differs, with CSP blocking only a source-consistent inference because no violation message was captured. Direct documented CDP mouse input also collapses at the same points, so no Playwright drag-interception cause is established. A fresh app-free positioned plain-text span reproduces the same 17/17 collapse with no app modules, stylesheets, transforms or gesture observers (`/tmp/browserpdf-highlight-appfree-native-baseline-20261019/report.json`). These controls exclude app attribution for this stopped test gesture.

The matched app-free endpoint control establishes a cause on its first invocation (`/tmp/browserpdf-highlight-appfree-endpoint-control-20261019/report.json`), independently inspected by Root. With identical DOM/font/viewport/end point and both starts preflighted at native caret0, the sequence midpoint 0.5 → leading 0.1 → midpoint 0.5 produces actual mouse-down positions 1/1 → 0/0 → 1/1. The leading start then selects the exact full phrase at 0/17; both midpoint controls finish collapsed at 17/17. All 207 frozen hashes and HTML/glyph/style/scroll geometry remain unchanged, with no Selection writes or errors. Raw/floored/rounded caret preflights all return zero at the midpoint, so ordinary integer rounding is not established. Root approves the test helper's point order to match the already passing independent helper, preferring 0.1/0.01 before the ambiguous midpoint, with an actual native post-mousedown start check. All final native text/quads/AP/pixel/artifact assertions remain. The exact stopped desktop English/Arabic cases and existing portable four-rotation helper consumer remain pending; no product/API/CSP change is needed for this classification.


The cause-based native-start helper postfix passes the exact stopped desktop cases and its existing four-rotation consumer **3/3 in 10,630.363 ms**, zero skipped/flaky/top-level errors (`/tmp/browserpdf-highlight-desktop-affinity-final3-20261019.json`). All 212 frozen source hashes remain unchanged, including the same 114 production JavaScript/CSS files as the accepted thirteen-case correction gate. Root independently decodes eight actual post-mousedown attachments, each connected at collapsed native offset0. Both 768/1440 English-light and Arabic-dark contexts complete native property edits, Unicode notes, long accessible names, task/original identities, actual AP exports and strict zero-different preview pixels. Root reopens all five PDFs (`/tmp/browserpdf-root-highlight-final3-artifact-review.json`): the four desktop outputs have annotation counts [2,0]; the five-page rotation output has [2,1,1,1,0], preserving the original green AP. The first offline checker incorrectly assumed opacity .41 in both directions; observed native Arabic ArrowRight changes the range to .39, while English changes to .41. All saved values match the actual UI attachments. The browser closes before the broad regression window.

Fresh read-only nonbrowser checks pass alongside the exclusive Root full-browser run (`/tmp/browserpdf-annotation-final-nonbrowser-20261019/summary.json`). The SDK's six exact distribution outputs and no-emit typecheck pass; all eight migration --check processes pass with Python -B; eight root unit files pass **58/58 in 5,341.333333 ms**, zero failed/cancelled/skipped/todo. Every process exits zero and all 231 relevant source hashes remain unchanged, SHA cd7943e20f0184d8e0701851a69e04cf5b669d972e96b7f13d375abe76b90412. SDK build/unit commands are deliberately not repeated because their unit suite rebuilds dist; earlier unchanged SDK evidence is retained. These checks do not write source, generated fixtures or browser state.

Root starts one coherent Playwright invocation of all **331 tests in 28 files**, workers1/retries0, on the existing Wrangler8788 only (`/tmp/browserpdf-root-annotations-full-20261019-results.json`; disposable config disables webServer). Its frozen inventory contains 285 paths, SHA 3c84f15a315617fd9bc4ec2d3bad8d0d4a37386dc83e5089d9619319be958ff4. During the still-running invocation, the unsupported-sideways selection test passes actual native start0 but selects 19 of20 characters despite an end preflight20; later unsupported/collapse/recovery tails stop. Three page-route tests also fail selected rotation, selected crop and Merge continuation assertions. Source/retained trace classification proceeds read-only while the entire invocation continues unchanged. No retry, source mutation, checkpoint commit or broad passing claim is authorized by these partial results. A bounded matched sideways final-glyph control is approved only after this browser window closes, with exact phrase/tails and node/task/bytes retained and status-reflow measurements required before cause attribution.


The coherent broad invocation closes **324 passed/7 failed in 561,512.531 ms**, zero skipped/flaky/top-level errors (`/tmp/browserpdf-root-annotations-full-20261019-results.json`). Root inspects every failure and verifies all 285 frozen paths unchanged; all forty audit files remain. Additional failures are the injected form-error recovery case waiting on disabled Apply and two delayed-sibling text-continuation cases remaining on View PDF. They require source/trace classification. Read-only page-route evidence proves Rotate/Crop start before hydration: the preview still has its default300x150 and no explicit dimensions; the selection subtree is inert while the automated fill leaves its actual all-page range unchanged. Both actual PDFs match that effective selection, without establishing a geometry defect. Merge's actual1405-byte output has exact B2/A2/A3 order, but Use creates a new canonical task while its continuation rail retains the earlier null task owner. Its native Organize click silently returns. This real continuity regression requires exact verified ownership transfer, with stale/group/newer-task guards preserved. No broad passing claim or checkpoint commit follows the seven failures. Root releases the full window only after process completion and unchanged-hash verification, then allocates the previously approved unchanged-source sideways control as the sole browser.


Root independently reproduces the separate direct Merge continuation failure on its first unchanged-source invocation (`/tmp/browserpdf-root-merge-null-owner-prefix-first/report.json`). Before any Use, native Organize enters with no task/current. Its actual returned handler promise settles after creating a new task at revision0/generation1 whose current bytes exactly equal the explicit native 1,286-byte merged download, SHA08df3ca87ee1500f232f0ad27ea6f916bfa3c6ac31ba309282f801ccb21e0c6f. Reopening that actual three-page PDF yields A1/A2/B1 exactly. No workflow or owned file is committed, the URL remains Merge, the button re-enables and no error appears. Errors/non-GET requests are zero and the only download is deliberate. All 285 source hashes remain unchanged; the browser closes. This turns the direct-path null-to-task source inference into runtime evidence, alongside the separate full-run Use-then-Continue failure. Exact rail-bound adoption ownership transfer is required for both paths, without weakening stale result/group/newer-task guards.

The first private sideways matched control stops before its A/B/A trials because its snapshot reads hidden on the pristine absent lazy result element (`/tmp/browserpdf-highlight-sideways-end-affinity-20261019/report.json`). The supported previous-candidate drag completes, no endpoint verdict is reached and all 285 sources remain unchanged. Root retains this private failure and allocates only a null-safe snapshot correction on otherwise unchanged source, with all native/end/reflow assertions retained.


Root inspects the null-safe unchanged-source sideways retry (`/tmp/browserpdf-highlight-sideways-end-affinity-retry-20261019/report.json`). Its exact matched last-glyph y fraction .5→.1→.5 yields native focus19→20→19, with all three actual mousedown ranges connected at0/0 and both alternative endpoints preflighted at20. Every pre-gesture metric across all phases is identical; glyph bounds, canvas/surface/text/viewer/status/actions and scroll remain exact before/after each drag. Task/scene/source/current/canvas/control restoration is exact, unsupported rejection and disabled Add/Apply remain effective and there is no publication/error. All285 source hashes remain unchanged and the browser closes. This proves a native final-glyph affinity distinction; no reflow, rounding, Playwright, app listener or internal browser mechanism is attributed. Root approves only the helper's trailing-edge y preference before midpoint, keeping exact full phrases, actual node/end/start checks and unsupported/collapse/outside/recovery tails.

Root also inspects the retained foundation classification (`/tmp/browserpdf-service-foundation-readonly-classification-20261019.json`). The field failure hook interrupts initial readiness, so its intended native Apply never dispatches. The approved test-only migration awaits an unmocked ready source and ready actual field-draft revision before installing the setter fault immediately before native Apply. Corrected field/flatten preview similarly becomes ready before installing the flatten fault; exact chosen bytes/revisions, visible errors, no success and final actual PDF recovery stay required. The two delayed-sibling text cases correctly retain the newest text and suppress the stale PDF/Clear result, then stop at direct continuation; their traces do not inspect committed manifests, unlike Root's separate exact Merge observer. The shared rail fix and focused tails remain unverified.


Root independently passes the direct Merge postfix on its first invocation (`/tmp/browserpdf-root-merge-null-owner-postfix-first/report.json`). The same native action sequence now settles and reaches a usable three-page Organize workspace with a rendered360x480 actual page. Its new task/revision0 match the actual completed handler, committed workflow and owned input. Handler-after, destination current/original and stored input all match the explicit1,286-byte merged download exactly, SHAd2e24574f9c377a1efb26ac0c377054f07ff7c6a8aa7e445fa1a2717add1b097; reopening yields A1/A2/B1. Errors/non-GET requests are zero and only the deliberate reference download occurs. All286 frozen paths remain unchanged against `/tmp/browserpdf-result-rail-owner-20261019/source-freeze.json`, and the browser closes. The previous failed native direct path remains retained separately; generated artifact dates mean no cross-invocation byte identity is asserted.

Root reads and approves the narrow live-rail source delta and four actual native regression cases. Runtime rail identity/publication intent plus exact reviewed-object/typed-descriptor/bytes pairing permit only guarded synchronous Use or stash ownership transfer. Existing external operation and special strict revision/generation guards stay intact; no new import, public API, core/store or schema changes occur. No-pending-review continuation remains supported. Fresh independent code/test review reports no actionable finding. The added code is1,166UTF8 bytes; static Privacy/Workflows graph estimates remain estimates until the actual idle gate. The fresh affected browser gate must include the seven stopped cases, all affected native Highlight/page/foundation consumers, ownership/retry/group/held-B/Clear paths, eight selected image paths, actual five-route idle measurement and the distinct Redact Use→Privacy/UseCancel rebuilt-rail consumers before checkpoint acceptance.


The affected frozen browser invocation passes **79/79 in116,262.511ms**, zero failed/skipped/flaky/top-level errors,79 attempts and no retries (`/tmp/browserpdf-continuation-owner-gate-20261019-results.json`; independently inspected by Root). The final metadata confirms unchanged286 source paths/config and untracked set; only the authorized globalSetup regenerates11 of22 generated PDFs. It retains69 actual PDFs. All seven stopped full331 cases now have passing focused evidence, with the original324/7 report retained; this is not one clean full331 run. The five-route native requested-resource idle case passes strict<100,000 local JavaScript bytes and≤16 requests; it does not attach successful exact per-route numbers, so98,579/98,298 stay static estimates. Document-handoff Node verification actually executes5/5 passing cases in51.801459ms; the author's earlier discovery count3 is corrected.

Root's subsequent unchanged-source classifier proves an additional exposed Redact direct-before-Use defect on its first invocation (`/tmp/browserpdf-root-redact-direct-continuation-prefix-first/report.json`). Native Privacy continuation's actual handler settles after adopting the exact12,147-byte clean result, SHA14327f38eeda3791a48561b3010f22e5767e89bf37686cbedd4312690d353a74, under the same task at revision1/generation2. No workflow/files commit and the URL remains Redact. The visible noninert Reader still contains the source SECRET text and its900x1200 canvas/mask1 while reporting idle. The actual cleaned PDF is independently all-indirect safe, with no secret, metadata, forms or orphan pages; the defect is continuation and stale presentation. Native Clear then fully opens a fresh two-page B under its exact new task/bytes. Errors/non-GET requests are zero, one download is deliberate, all286 sources stay unchanged and the browser closes.

Root approves only a narrow Redact correction: expose result continuation after deliberate Use and owned successful verification of the chosen preview. Reviewing/downloading remains possible without changing the source/current/drafts. The existing post-synchronization presentChosen path then creates the actionable rail; status must explain Use to continue. This aligns with the route's already explicit pending-mask workspace-mode guard and avoids rebasing generic external operation guards. A new native prerequisite regression, affected Redact consumers, fresh source review and Root's original-prefix postfix remain required before checkpoint approval; the79 core-rail evidence stays retained.


The narrow prerequisite source removes only Review's premature rail publication and explains Use to continue; the existing verified presentChosen publisher remains unchanged. Root inspects the exact production/test patch and the existing actual Review-handler completion observer. Fresh independent review reports no actionable source/guard/core issue. Root's original-prefix postfix passes on its first invocation (`/tmp/browserpdf-root-redact-continuation-prerequisite-postfix-first/report.json`). Its actual cleaned artifact remains exactly12,147 bytes/SHA14327f38eeda3791a48561b3010f22e5767e89bf37686cbedd4312690d353a74, identical to the retained original classifier, independently all-indirect clean. Before Use, source/task/revision/generation and mask draft stay unchanged and no actionable rail appears. Native Use verifies the clean current preview and removes source SECRET text/masks; actual native Privacy continuation settles, stores and receives the exact chosen SHA, immutable original, task and revision1, then scans successfully. Errors/non-GET requests are zero, one download is deliberate, all286 source hashes remain unchanged and the browser closes. Root allocates one full isolated22-case Redact invocation to verify the added completed-render hold and all retained shared-observer consumers. The earlier clean79 shared gate remains valid for unchanged shared source; no checkpoint commit is approved before the22 results/hash closure.


The isolated final Redact invocation passes **22/22 in61,374.922ms**, zero failed/skipped/flaky/top-level errors and no retries (`/tmp/browserpdf-redact-prerequisite-gate-20261019-results.json`). Root independently inspects the report and decodes the new native proof: downloaded, chosen and Privacy input all have SHAf385893d38004a1fc851e47b61054b66d514c8fc49853dba73019dfdda18a316 under the same task/revision1 with the immutable original retained. The actual completed-render hold, hidden/inert pending surfaces/panels, unavailable pre-Use rail and exact zero-channel verified preview all pass. All286 frozen source paths/config remain unchanged;33 actual PDFs are retained. Only authorized globalSetup regenerates11 of22 ignored generated PDFs, with the untracked path set unchanged. The browser closes. This is one clean22-case Redact run, alongside the earlier clean79 shared affected run and Root's exact original-prefix actual artifact/Privacy postfix; the historical324/7 full331 result remains retained. Root accepts the functional annotation gates and awaits exact checkpoint-path/documentation reconciliation before commit approval. Complete locales, later conversion/platform work and final all32 acceptance remain open.


## Verified annotation commit and parallel Phase 3 foundations

Root verifies annotation commit `a28b4ee4845288c91322bd78e912c60556cdea7e`
against HEAD, upstream and the actual feature remote. Its parent is `1184fc6`,
with exactly 46 approved paths, 4,841 insertions and 996 deletions. The message
contains the description only. All 286 frozen runtime/test/SDK/script hashes
remain unchanged; the forty untracked design-audit files are preserved. Proof:
`/tmp/browserpdf-root-annotation-commit-remote-verification-20261019.json`.
No main push or production deployment occurs.

After the user's request for stronger service-level parallelism, Root removes
the intermediate coordinator and directly uses the three available worker
slots. Documents, compression and platform continuity have disjoint owners;
the canonical `service32-execution-queue` tracks all 32 service acceptances
separately. Shared changes still require exact ownership and browser windows
remain exclusive. No service closes from foundations or a continuation link.

The first structural compression core gate passes 11/11 Node cases in
2,796.881542 ms. Root's independent first actual-core invocation additionally
reduces a 69,950-byte synthetic PDF to 3,753 bytes, SHA-256
`1c08689128a8a3ee1d718c4eb9e9055e3e7cc9d283b6d6b5a089a8f01f02171f`.
The actual saved PDF retains selectable text, operator sequence, pixels, title,
form values, URI, application references and decoded streams; previously
filtered streams retain encoded bytes. The second pass is byte-identical, input
and source hashes stay unchanged, and owned canvases release. Evidence:
`/tmp/browserpdf-root-compression-core-first/report.json`. This is Node/native
core evidence, without route or browser-delivery acceptance.

Fresh independent review then blocks core acceptance on two real-runtime
failures: undefined PDF.js text-stream cancellation produces an uncaught closed
controller error during oversized-text rejection; a quoted annotation serializes
8,600,002 bytes before the 8 MiB descriptor check. Initial failures and a clean
private-copy cancellation correction remain under
`/tmp/browserpdf-compression-core-fresh-review-20261019/`; the exact report is
`/tmp/browserpdf-compression-core-fresh-review-20261019.md`. Narrow owned
corrections and meaningful recovery/preflight regressions are authorized.

The bounded ZIP/model author's final first-foundation Node gate passes 22/22 in
3,798.4395 ms. Root's first combined private comparison crashes in Node 22's
native InflateRaw adapter before its nonincremental report; no per-case verdict
is inferred from it. The retained first failure is
`/tmp/browserpdf-root-ooxml-foundation-first/first-invocation.json`. A subsequent
isolated-subprocess comparison attempts all 41 synthetic cases: 39 pass, valid
empty XML comment admission fails, and a 9 MiB XML budget cancellation crashes
the Node native adapter. All three relevant source hashes remain unchanged.
`/tmp/browserpdf-root-ooxml-foundation-isolated/report.json` retains every case,
owned part/input/disposal check and process log. Browser behavior is unclassified.

Fresh ZIP/model review independently proves the empty-comment failure without
an inflater, four malformed XML lexical acceptances, an input-controlled array
map that bypasses finite model validation, and ordinary Node Buffer aliasing
whose disposal erases the original. Report:
`/tmp/browserpdf-ooxml-model-fresh-review-20261019.md`. The five frozen hashes
remain exact. Narrow corrections are authorized; no caller/font/session or
Office conversion acceptance follows these foundation results.

Root separately proves only target native raw-DEFLATE feasibility on pinned
Chromium 151.0.7922.34 in about:blank: the real 969-byte control expands to the
exact 3,514-byte source, while appended-zero and truncated controls reject.
`/tmp/browserpdf-native-rawdeflate-feasibility-20261019/report.json` records zero
requests/errors and a closed browser. No application source, server or shared
fixture is used. Node 22 accepts the appended zero, so Node cannot supply that
negative browser verdict. Actual implemented ZIP/browser lifecycle and budget
gates remain required.

The parallel initial-handoff READ checkpoint passes 44/44 affected Node cases
in 422.612209 ms, with nine JavaScript syntax checks and a clean diff check.
Its guarded old shared entries and exact committed-owner return are frozen at
`/tmp/browserpdf-initial-handoff-source-20261019.json`. Stash write code remains
byte-identical. The 593-byte tool-ui delta has only a static idle estimate;
actual idle measurement, fresh review and all sixteen proposed native artifact
cases remain pending. Full locales, conversion/platform service work and final
all-32 reconciliation remain open.


### Corrected foundations and independent native module acceptance

The corrected compression gate passes 16/16 in 4,497.562208 ms. Fresh focused
review closes the text cancellation and descriptor preflight findings by
replaying both original actual-runtime prefixes; ordinary Buffer/subclass
copying is reviewed separately. Root's corrected independent actual-core
normal path passes again at
`/tmp/browserpdf-root-compression-core-corrected-first/report.json`.
All old failures remain preserved.

The corrected ZIP/model gate passes 29/29 in 4,388.22675 ms. Its first
correction attempt, 28 passed/one cross-realm test-helper failure, is retained
with the cause-based helper correction. Fresh review replays the original
model-map, byte-ownership/Buffer and XML lexical probes successfully, and the
seven added portable regressions pass 7/7 in 248.480375 ms. The five corrected
source/test/document hashes stay unchanged.

Root's first actual-module Chromium 151.0.7922.34 gate passes all 42 independent
ZIP/XML inputs, ten positive and 32 negative, plus a real 65,536-byte inflated
chunk AbortSignal cancellation with both native ends drained and a valid
seven-part successor. The 9 MiB XML rejects cleanly at the 8 MiB part budget,
without the Node adapter error. An exact ZIP payload with trailing compressed
garbage rejects. Literal Turkish/Greek/Cyrillic text, ordered list start seven,
owned model copying and map-override rejection also pass. Evidence:
`/tmp/browserpdf-root-native-foundations-first/report.json`.

That same real-origin gate loads the pinned runtimes and actual structural
compression module. The browser-produced 3,753-byte artifact is byte-identical
to Root's independently inspected corrected Node artifact, SHA-256
`1c08689128a8a3ee1d718c4eb9e9055e3e7cc9d283b6d6b5a089a8f01f02171f`.
Native source/result 612x792 canvases have equal pixel SHA-256
`d0de20190ca5ce546946eb2a1bb97c364b1f0c4efc996d5233558cb0d3074e1d`;
second-pass bytes, original input and released canvases are exact.
`independent-artifact-byte-identity.json` binds the actual browser file to the
separate graph/forms/URI/stream/text/operator/pixel inspection. All five actual
import-closure hashes remain unchanged, no tool-route module is requested,
page/console errors and non-GET requests are zero, and the browser closes.
These accept the pure foundations for reviewed caller integration, without
claiming DOCX/XLSX conversion, font support or Compress route delivery.

Root's independent Add Text original-prefix postfix also passes on its first
invocation. The completed old workflow read loses to ready two-page B; the
actual helper settles, old A File reads remain zero and B's task/current SHA
stays exact. A fresh native edit saves a two-page 5,960-byte B artifact, SHA-256
`c8304ea02ebd29348e28730e221dc591d9cec909ba6af05074b74187ede02ec9`,
independently reopened with both B page markers and the new edit, without old A.
The URL is clean, errors/non-GET requests are zero and two reference/final
downloads are deliberate. All 244 frozen sources stay unchanged. Concurrent
View/Merge/spec corrections are explicitly excluded and never imported, so
this is narrow Add Text evidence, not their acceptance. Proof:
`/tmp/browserpdf-root-initial-handoff-postfix-first/report.json` and its
`source-closure.json`. The corrected twenty-case native matrix remains pending.

### First initial READ matrix and correction classification

The first twenty-case native matrix finishes with 13 passed and seven failed in
233,361.636 ms, zero skipped/flaky cases and zero top-level errors. All 272
runtime/test/SDK/script/package hashes and the private configuration remain
unchanged. Global setup and server lifecycle are disabled. Results and original
traces remain under `/tmp/browserpdf-initial-handoff-native-20261019-results.json`
and `/tmp/browserpdf-initial-handoff-native-20261019-output`; the wrapper closure
is `/tmp/browserpdf-initial-handoff-native-20261019/final.json`.

Four Turkish failures read a null canonical SHA because the test selects the
first module script, the injected `/js/i18n.js`, then imports root `/js/tool-ui.js`
instead of the actual localized `/tr/js/tool-ui.js`. Captured response HTML and
network traces establish the separate module namespaces while B is visibly
ready. This requires a test-helper entry-selection correction, with exact SHA,
task, localization and saved-artifact assertions preserved.

Two Reader cases reach the native continuation step but attempt to click Add
Text inside the closed `readerModes` disclosure. The helper must open the real
disclosure, as existing Reader tests do. The remaining cold page-effects case
retains A but its rejected-B error is hidden; source review identifies the
successful resume render's `hideError()` as a candidate cause. Its exact error
lifecycle is being classified before a product correction. This invocation is
not recorded as a passing matrix. Other workers resume only their disjoint pure
document cores and isolated protection feasibility after this browser closes.

### Verified pure-core commit and corrected initial READ acceptance

The nine-path pure foundation checkpoint is committed and pushed as
`c4af338685971e13f1eb887c2cf44946e1a0e400`, parent `a28b4ee`. Root independently
checks actual feature remote, local HEAD and upstream identity, exact path set,
all accepted hashes, title-only message and empty index. All forty audit files
remain present and excluded work stays intact. The independent proof is
`/tmp/browserpdf-root-pure-foundations-commit-remote-verification-20261019.json`.

The corrected initial READ matrix passes all 21 cases in 66,839.374 ms, zero
skipped/flaky cases or top-level errors. All 272 frozen runtime/test/SDK/script/
package hashes, path inventory and configuration stay exact. All 21 actual
network traces exclude the six concurrent new DOCX adapter paths. Evidence:
`/tmp/browserpdf-initial-handoff-native-corrected-20261019-results.json` and its
wrapper `final.json`. The added native error-lifecycle case preserves rejected-B
feedback while A resumes, clears it after a successful edit, displays a later
actual validation failure, then succeeds and saves a two-page numbered 9/10 PDF
through Use and native Add Text continuation. Its artifact is 9,251 bytes,
SHA-256 `7e2cd9d12c74bfa430bb709c994b09e1b3f24610517ab60c64f460f103866c55`.

The combined configuration's anchored idle grep collected zero idle cases; no
idle pass is inferred from it. The separate actual idle invocation passes 1/1
in 756.662 ms, again with 272 unchanged hashes/path inventory/configuration and
one retained network trace. Its unchanged assertions require fewer than 100,000
first-party JavaScript bytes and at most sixteen requests on the five selected
routes. Proof: `/tmp/browserpdf-initial-handoff-native-idle-20261019-results.json`.
Neither invocation runs global setup or changes the durable server.

Final focused quality and anti-pattern review reports no actionable finding at
`/tmp/browserpdf-initial-handoff-final-corrections-review-20261019.md`; all ten
source/test hashes match before and after. The earlier 44 passing Node cases
remain scoped handoff/composition/text/resource evidence. Store/session sources
and the stash write prefix are unchanged, so existing store/expiry evidence is
retained without claiming a new store test invocation. The first 13/7 matrix
and its six helper causes plus one corrected product feedback race stay intact.
This accepts the narrow initial READ continuity checkpoint. Conversion routes,
remaining platform work, all locales and final all-32 acceptance remain open.

### Protection engine counterexamples

The exact pinned Cantoo 2.7.4 public API fails all sixteen strict preservation
cases across eight synthetic source PDFs, 44,402 aggregate input bytes. Five
unencrypted load/save controls preserve their graphs; ten further classification
controls distinguish encryption corruption from decryption reference loss.
The bounded report and all original failed artifacts remain at
`/tmp/browserpdf-protection-feasibility-20261019/report.md`. No application or
dependency change follows this experiment.

Root independently reopens two source PDFs, their plain-save controls and their
actual unlocked outputs with ordinary pdf-lib. Original Unicode titles survive
plain save but are absent after Unlock; catalog language `en-US` becomes empty,
while the protected output still contains its plaintext literal language string.
All inspected artifact hashes remain unchanged. Root proof:
`/tmp/browserpdf-root-protection-counterexample-20261019.json`. Password access
and matching page pixels do not establish preservation of the complete document.
Alternative engine discovery remains read-only, with Protect and Unlock separate
open services; no automatic page-copy fallback is accepted.

### Verified continuity commit and corrected document adapter checkpoint

Root verifies the initial READ checkpoint commit and actual feature remote as
`e8a3e92fdd0d46ee0fd479486ffd3f2e6fc2d45b`, parent `c4af338`. Its twelve approved
paths, title-only message, empty index and unchanged accepted runtime hashes
match. Root separately reopens all 21 actual saved native artifacts with ordinary
pdf-lib and PDF.js, checking expected page text/order, old versus new source,
edits and page numbering. Every artifact passes and its hash remains exact.
Evidence: `/tmp/browserpdf-root-initial-handoff-commit-remote-verification-20261019.json`
and `/tmp/browserpdf-root-continuity-artifacts-20261019.json`.

The six-path pure document adapter A checkpoint adds bounded DOCX reading,
actual structured DOCX writing and literal plain-text serialization on the
accepted ZIP/model foundation. Initial owner evidence is 17/17 Node cases in
1,037.524625 ms. Fresh independent review then finds three real missing cases:
first nested numbering start12 becomes7, both markup compatibility branches
are concatenated, and simple fields silently flatten. The new regression
invocation against that original core records 17 passed/three failed in
929.613167 ms. Original probes, DOCX files and failed results remain intact.

The corrected-source gate passes 20/20 in 1,096.277959 ms. Focused fresh review
passes at `/tmp/browserpdf-docx-adapters-corrected-review-20261019.md`, replaying
the exact original failed inputs. An independent Python ZIP/XML oracle derives
the saved numbering sequences `[7,12]`, `[7,12,8]` and `[7,12,8,12]`, with exact
levels, restart flags and a shared concrete instance. A later used-child
restart14 preserves the earlier12 and continues15 correctly on a new instance.
Unsupported ancestor continuation rejects before output. Compatibility branches
and simple/complex fields now reject precisely; successful literal Unicode
successors preserve text and input bytes after each rejection.

Root's independent corrected six-control invocation also passes at
`/tmp/browserpdf-root-docx-independent-corrected-20261019/report.json`. It checks
source list7/8, table, exact local image/extent, literal styles and Unicode,
actual saved DOCX/readback, plain text, pre-abort plus successor, and independent
Buffer ownership/disposal. The original simple artifact remains byte-identical:
8,464 bytes, SHA-256
`9f27e0dab78a6e505f8d041da0335cb93ba59db154d56d7fd3371755054587b9`.
The separate standard-library ZIP/XML/media inspection remains passing.
All six corrected paths and six accepted foundation/ZIP-writer hashes remain
exact through review. No browser, Office display, PDF typography, converter
route, shared resource integration or completed document service is inferred.
This accepts pure adapter A for separately reviewed caller integration.

### First Compress route gate and exact canvas classifier

The first isolated Compress/shared-preview gate records 24 passed and two failed
in 28,066.671 ms, without skipped/flaky cases or top-level errors. All 278
runtime/test hashes, 22 generated fixtures, configuration and private idle test
remain exact; all 26 traces exclude the concurrent six DOCX adapter paths.
Evidence: `/tmp/browserpdf-compress-route-native-first-20261019-results.json`
and the matching wrapper `final.json`. No global setup or server lifecycle runs.
Both actual idle tests pass their unchanged byte/request limits. The two failed
cases remain failed evidence; no clean 26-case result is claimed.

The first artifact test stops at unequal source/result canvas PNGs before its
download/Use/Reader tail. Root independently decodes both retained PNGs: equal
695x900 dimensions, 2,659 differing RGB pixels/7,977 channels, maximum channel
difference83 and equal alpha. The owner then uses the same real retained PDF and
pinned Chromium151 to reproduce both original PNG SHA-256 values exactly.
Viewport transforms, loaded fonts and canvas context attributes agree.
An attached canvas inherits the body's font smoothing, while the detached source
canvas does not. A scoped attached smoothing override reproduces the source PNG
exactly, with zero differing channels. The source/result pixel assertion remains
strict. Diagnostic evidence:
`/tmp/browserpdf-root-compress-png-diagnostic-20261019/report.json` and
`/tmp/browserpdf-compress-owner-canvas-diagnostic-20261019/report.json`.

The second failed test observes the old choice-one canvas after clicking
choice-two, before that actual selection handler settles. Trace evidence supports
a completion-observer correction, retaining the chosen identity, record count,
active-native bound and zero-after-drain assertions. Fresh source review also
finds two absent cases: a failed event-driven native destroy can be bypassed by
the next preview event, and an inherited encrypted PDF with an empty opening
password can be rejected instead of retained read-only. Narrow corrections and
actual regression controls are approved; corrected native acceptance is pending.
The diagnostic browser is closed before source edits.

The corrected affected native invocation then passes 20/20 in 16,774.643 ms,
zero skipped/flaky cases or top-level errors. All 283 runtime/test hashes,
configuration, path inventory, private idle test and 22 generated fixtures stay
exact; all twenty traces are retained. Source/anti-pattern review separately
passes at `/tmp/browserpdf-compress-route-corrected-review-20261019.md`, with
15/15 intake Node cases in 350.723333 ms. Evidence:
`/tmp/browserpdf-compress-route-native-corrected20-20261019-results.json` and
its wrapper `final.json`. This is a clean affected twenty-case invocation,
alongside the retained initial 24/2 result.

Root's additional independent Letter corpus finds a distinct preview mismatch
on its first native invocation. The strict comparison stops before download;
no errors/non-GET requests occur and all 283 source hashes remain exact. A new
classifier retains that mismatch as a failed issue while completing manual
download, explicit Use and native Reader continuation. The actual 3,753-byte
output is exactly SHA-256
`1c08689128a8a3ee1d718c4eb9e9055e3e7cc9d283b6d6b5a089a8f01f02171f`,
the independently graph/stream/text/pixel/form/URI-inspected core artifact.
Chosen/current/original/task remain exact throughout Use and Reader. One
download is deliberate, all source/corpus hashes stay unchanged, and the
browser closes. The preview issue still makes the classifier fail.

The actual source page is Letter 612x792. Source and result use algebraically
equal but differently associated scale formulas: the source backing canvas is
695x899 while the result is 695x900. The approved correction reuses the existing
boundedViewport helper in the lazy shared result module, keeping the source
1M/result4M pixel budgets, 900-edge limit, integer floors and cancellation.
Strict Letter/fractional regressions and a new affected gate remain required.
Evidence stays under `/tmp/browserpdf-root-compress-native-independent-first-20261019/`
and `/tmp/browserpdf-root-compress-native-independent-classifier-first-20261019/`.

### Isolated protection interoperability candidate

The exact pdfstudio0.4.0/QPDF12.3.2 candidate has a separate 16/16 compatibility
proof and 35/35 controls, retaining all earlier Cantoo and QPDF failure prefixes.
Fixed public generated-factory/FS/callMain decryption, same-length PDF-name
escape-case normalization and actual ordinary pdf-lib1.17.1 resave preserve the
inspected graph, metadata, forms, geometry, text and pixels in that bounded
eight-source corpus. Diagnostic exits2/3, byte-cap and worker-drain controls are
separate evidence. Report:
`/tmp/browserpdf-protection-compatibility-20261019/report.md`.

Root independently opens the corrected AES128/256 rich artifacts, adds ordinary
PDF text and saves/reopens them. Title, form values, page geometry and attachment
MIME/payload/date remain exact. Each normalized input differs from its low-level
output at only the single lowercase `f` in `/text#2fplain`, now `/text#2Fplain`.
The two actual saved edited PDFs and input hashes are retained at
`/tmp/browserpdf-root-qpdf-compatibility-edit-20261019/report.json`.

Fresh review nevertheless proves two strict-parser gaps: lossy ASCII decoding
admits high-bit syntax, including an invalid full xref keyword, and a lexical
real `/Length 2.0` satisfies the claimed integer-only boundary. Those malformed
acceptances require focused proof corrections before porting. The actual 244
retained PDF hashes remain exact and the positive corpus is not reclassified.
Review: `/tmp/browserpdf-protection-compatibility-fresh-review-20261019.md`.
No production engine, vendor assets, browser/CSP delivery, notice provenance,
bounded Protect adapter or service UI is accepted by these isolated results.


### Compress viewport and independent artifact acceptance

The narrow shared result change now uses the existing boundedViewport helper
with scale 1.5, a 900-pixel edge and the existing 4M result budget. Source
rendering, integer floors, native ownership and the accepted compression core
stay exact. Fresh focused source and anti-pattern review passes at
`/tmp/browserpdf-compress-route-viewport-fresh-review-20261019.md`.

Root's affected native invocation passes **14/14**, 15,527.44 ms, zero
skipped/flaky/unexpected cases or top-level errors. The original strict Compress
case, new Letter and fractional rotated A4 cases, four shared lifecycle cases,
four result foundation consumers, one image consumer and two idle cases pass.
All 301 included runtime/test hashes, source inventory, configuration, private
idle test and 22 generated fixtures stay exact. The five concurrently owned
new Markdown paths are explicitly excluded and absent from all fourteen actual
request traces. No globalSetup, server lifecycle or shared fixture writer runs.
Evidence: `/tmp/browserpdf-compress-route-native-viewport14-20261019/final.json`.

The separate strict original-corpus postfix then passes actual source/result
PNG equality, manual saved artifact, explicit Use and native Reader. The
69,950-byte input becomes the independently inspected 3,753-byte output with
SHA-256 `1c08689128a8a3ee1d718c4eb9e9055e3e7cc9d283b6d6b5a089a8f01f02171f`.
Original/current/task/history remain correct. There are zero page errors,
zero non-GET requests and one deliberate download. All 301 included source
hashes, inventory and independent corpus stay exact; the browser closes.
Evidence: `/tmp/browserpdf-root-compress-native-independent-postfix-first-20261019/report.json`.
The first 26-case result, original Letter failure and failed classifier remain
retained. This accepts the structural route checkpoint, with searchable/form
capability admission, optional raster mode, full locales and final service
acceptance still open.

### Shared Markdown independent artifact checkpoint

The document owner freezes five new parser/serializer/test/doc paths after
25/25 scoped portable checks in 1,250.028917 ms and a corrected 200/200 literal
style corpus. Original first18 14/4 and first literal193/7 results are retained.
This is shared adapter evidence, with no route, PDF layout or font acceptance.

Root independently takes the retained structural Unicode DOCX through the
accepted DOCX reader, new Markdown writer, actual saved local Markdown/image
files and new Markdown reader. The readable 908-byte Markdown has SHA-256
`0f87b676e5100c32101fd61e91d969e49f2d8c2e15ba721f4d97186f28dc19db`.
Literal text, coalesced run styles, heading/list sequence and actual image bytes
remain exact. Expected list identity, table header/width and image size limits
are finite reported differences. Source and nine-module closure hashes remain
exact. Report: `/tmp/browserpdf-root-markdown-independent-first-20261019/report.json`.
Fresh source review remains required before accepting this pure checkpoint.


### Markdown pure checkpoint acceptance and typed Compress continuation

Fresh Markdown review found two real literal-contract defects: ordinary tilde
fence prefixes became code syntax, and closing emphasis omitted promised
punctuation flanking. The first new regressions retain 25 passed / 2 failed.
Corrected scoped tests pass 27/27 in 1,292.739375 ms. Original six-case probes
and adjacent positive controls then pass in focused independent review at
`/tmp/browserpdf-markdown-document-corrected-review-20261019.md`. The corrected
writer saves literal tilde fences with exactly one boundary escape; the reader
preserves punctuation-adjacent unsupported emphasis as complete literal text.
Ordinary prose and intentional code fences remain represented. Original failed
artifacts and thirteen accepted dependency hashes remain unchanged.

Root repeats its separate actual DOCX-to-Markdown artifact inspection on the
corrected adapters. The readable 908-byte output remains byte-identical with
SHA-256 `0f87b676e5100c32101fd61e91d969e49f2d8c2e15ba721f4d97186f28dc19db`.
Literal text, run styles, list sequence and local image bytes remain exact.
Report: `/tmp/browserpdf-root-markdown-independent-corrected-20261019/report.json`.
This accepts only the five-path pure Markdown checkpoint. PDF layout, fonts,
workspace/routes, resource integration and individual service acceptance stay
open; no new browser execution is claimed for these pure adapters.

The narrow shared capability change removes only Compress's searchable/forms
PDF exclusion. The preceding encrypted Unlock-only branch stays exact. Fresh
focused source review passes at
`/tmp/browserpdf-compress-capability-fresh-review-20261019.md`. Its two affected
cases pass within Root's combined first five-case native invocation: typed
session capability contracts and an actual Reader/shared rail/stash/guarded
Compress/result/Use/Reader journey. All 310 runtime/test hashes, path set,
configuration, private idle test and 22 fixtures remain exact. The invocation
passes 5/5 in 6,107.745 ms, zero skipped/flaky/unexpected cases or top-level
errors, with five retained traces. No globalSetup, server or fixture action ran.
Evidence: `/tmp/browserpdf-capability-protection-native-first-20261019/final.json`.

The actual manually saved searchable/form output is 3,298 bytes from 54,711,
SHA-256 `8f0eac4615fa3b92911882cd9162b3b7a48e9c1e141681ea3e71d987599f82ab`.
Source/result PNG, invisible selectable text, fields, checked value, URI and
geometry remain exact. Review preserves current; explicit Use and Reader retain
task, original, chosen current and the established searchable/forms facts.
Encrypted inputs still reject Compress. Optional raster mode, complete locales
and final service/program gates remain open.

### Protection engine first native evidence and remaining cleanup correction

The same first five-case invocation contains three new protection engine cases:
actual same-origin integrity/CSP/Blob module/WASM delivery, native-phase abort
with successor, and held-fetch overlap/stale/corrupt-asset rejection with clean
successors. These pass separately from the two capability cases. Owner Node
checks pass 23/23; the browser serializer matches all sixteen retained low-level
outputs byte-for-byte, without rerunning the old encryption matrix.

Root's separate actual browser artifact inspection passes two cases under the
verified live CSP: AES-256 on its independent structural source and AES-128 on
the retained rich graph source. Wrong credentials reject with a finite code,
then the correct operation succeeds. Actual PDF.js text, annotations, page
geometry and pixels match through encryption and decryption. Six saved
protected/unlocked/ordinary-edited PDFs are retained. Ordinary pdf-lib1.17.1
edit/save preserves inspected Info, language, forms, geometry and attachment
MIME/payload/date. Report:
`/tmp/browserpdf-root-protection-native-independent-first-20261019/report.json`.
All 306 included hashes, inventory and source corpora remain exact; excluded
Markdown modules are absent from actual requests, and the browser closes.

Fresh production source review nevertheless finds one loader cleanup defect:
an admitted signal can override its public removeEventListener method, including
a genuine AbortSignal. Its thrown raw Error interrupts finally cleanup and
leaves the successor permanently busy. Original duck-signal and genuine-signal
probes are retained at
`/tmp/browserpdf-protection-production-fresh-review-20261019.md` and adjacent
probe JSON files. A narrow genuine-brand/captured-intrinsic/independent-cleanup
correction is approved. The first native and independent artifact results
predate this correction; they do not close that finding. Protection engine
acceptance and both Protect/Unlock route/UI tasks remain open.


### Protection engine checkpoint acceptance

The signal cleanup finding is closed by genuine native signal brand checks,
captured native aborted/listener operations, an immutable admitted option
snapshot and independent finite cleanup steps. A failed actual worker stop
still fences a successor. Targeted policy/loader tests pass 22/22; independent
copies of both original failure probes now return finite errors and reach
successor asset work. Original raw-error/permanent-busy results stay retained.
Focused review passes at
`/tmp/browserpdf-protection-production-signal-corrected-review-20261019.md`.
Engine, serializer, worker, prepared browser cases and all vendor files remain
byte-identical; only policy/loader, their tests and the checkpoint doc change.

Root then runs the three affected actual protection cases on the corrected
source: **3/3 PASS**, 3,425.475 ms, zero skipped/flaky/unexpected cases or
top-level errors. All 310 included runtime/test hashes, path inventory,
configuration, private idle test and 22 fixtures remain exact. Three traces
are retained. Existing server only, no globalSetup, server lifecycle or fixture
generation. The browser closes. Evidence:
`/tmp/browserpdf-protection-native-signal-corrected3-20261019/final.json`.
The earlier Root AES-128/AES-256 artifacts remain separate pre-correction
semantic evidence for unchanged engine/serializer code, without an unnecessary
repeat or a claim that they were generated after this correction.

This accepts the exact 24-path unreachable engine distribution and owned
policy/worker/loader checkpoint. Final documentation-only reconciliation leaves
its other 23 paths exact. The pinned JS/WASM and nine copied notice materials,
13-file distribution, all 328 old PDFs, 99 evidence files, audit40 and frozen
isolated parser stay unchanged. The actual CSP, verified Blob module/WASM,
abort/overlap/stale/integrity and positive successor behavior are now supported
by native execution. Compiler identity remains honestly unproved provenance;
no hard native heap or browser termination acknowledgement is claimed.
Protect and Unlock route/UI, private encrypted preview, explicit adoption,
finite return intent, full locales and final service acceptance remain open.


### Pure document PDF core C: independent artifact checkpoint

The new three-path pure builder is frozen against base `6128885994` for
independent review. Owner checks pass **22/22**, 1,062.776833 ms, with twenty
retained PDF/layout files. The first owner failures remain in
`/tmp/browserpdf-document-pdf-owner-20261019`; extractor whitespace formatting
is distinguished from actual saved glyph identity and visible indentation.
The builder uses the accepted logical model directly, requests only actual
styles, pins existing fonts, owns source ranges and serial native promises,
and returns actual PDF plus layout bytes. It has no route/session integration.

Root independently reads the retained actual Word corpus and builds a
20,363-byte PDF: **FIRST PASS**, seventeen source runs reconstructed exactly,
literal punctuation and Turkish/Greek/Cyrillic preserved, list values 7 and 8,
all table paragraphs and the 120 by 60 image retained. Actual PDF.js extraction,
strict reopening and raster output pass; seven module hashes and the source
stay exact. Evidence:
`/tmp/browserpdf-root-document-pdf-independent-first-20261019/report.json`.

Root then builds the same actual Word source inside pinned Chromium
151.0.7922.34 with the existing verified Fontkit/pdf-lib/PDF.js loaders:
**FIRST PASS**, genuine 20,363-byte PDF, SHA256
`1d855a1ad3b4b9b9f1ecc565d797c534980ffc7ba5fd60004c0b3ab0acfbcb45`.
Saved text, list/table/image and long-token content match, with a retained
actual page PNG. All 308 included hashes, path inventory and corpus remain
exact; zero page errors/non-GET requests. The explicitly disjoint thirteen
Protect/Unlock paths are excluded and none is imported. No globalSetup,
fixtures or server lifecycle occurs. The browser closes. Evidence:
`/tmp/browserpdf-root-document-pdf-native-first-20261019/report.json`.

These Root artifacts cover one page and three requested font styles. Native
five-style and tall-table pagination proof remains open. Fresh review has
already confirmed repeated uncharged look-ahead across empty runs for every
CR/LF, with control branches delaying cancellation. The bounded original
probe and unchanged-source artifact passes are retained separately. A narrow
charged linear scan/cooperative-yield correction is required before this core
can be accepted. No document route, editable workspace, shared font service,
manual download, locale or final service row closes at this checkpoint.


### Pure document PDF core C: corrected acceptance

Both fresh findings are closed in the exact three owned paths. Look-ahead
occurs only for a final CR that can pair across runs, with charged linear work
and cooperative yields in hard-boundary, TAB and empty-run paths. Unsupported
content retains zero font requests and rejects nonempty supplied fonts as
unused through the same strict admission. It never parses an unsupported font.

The seven focused regressions first fail **0/7 PASS**, then pass **7/7** after
the correction. The original twenty-two plus seven new checks pass **29/29**,
12,207.91025 ms. All original twenty saved artifact hashes, ten protected
source/font hashes and original test prefix remain exact. Evidence:
`/tmp/browserpdf-document-pdf-core-corrected-20261019/report.json`.
Fresh focused review passes at
`/tmp/browserpdf-document-pdf-core-corrected-review-20261019.md`. Independent
copies of the original public probes now admit the same normal model with
2,714,149 charged visits, while the queued abort fires after thirty layout
records rather than 2,001. The original reason is retained and malformed
font records reject with DOCUMENT_PDF_INPUT. Adjacent exact cross-run CRLF
and font-free positive cases pass. This controlled timing is not a general
performance guarantee. No broad test or artifact matrix was repeated.

Root separately closes the unresolved native five-font and pagination scope
on the corrected source: **FIRST PASS** in pinned Chromium 151. All five real
font styles preserve the same Turkish/Greek/Cyrillic phrase, followed by a
synchronized tall table over two more pages. All 130 unique source line
markers occur exactly once. Each of three actual page PNGs has visible ink;
the saved PDF is 39,985 bytes, SHA256
`dd3447b311738f66c7b5763aea91bdb546af28e4a3add0af1eb3bdc9a000cab8`.
Ten dependency/font hashes and the authored source remain exact. Browser
errors and non-GET requests are zero; the browser closes. Evidence:
`/tmp/browserpdf-root-document-pdf-native-layout-first-20261019/report.json`.
The earlier actual Word artifacts stay distinct pre-correction evidence for
unchanged content/layout behavior.

This accepts the pure builder, finite layout/source model and owned checks.
Document routes, editable correction, shared font loading, joint retained
resources, actual workspace previews/manual downloads, complete scripts,
locales and all final thirty-two service acceptance rows remain open.


### Protect and Unlock workspace first native gates

The thirteen-path standalone workspace is frozen with ten portable checks
passing. Engine24, shared12 and audit40 remain exact. New English help and
JSON-LD describe actual AES-256/AES-128 behavior through new fallback keys;
the complete translated dictionary migration remains open.

Root's independent actual rich-source journey is **FIRST PASS**:
Protect review, explicit encrypted download/Use, typed Unlock handoff,
rejected wrong credential over an empty canonical task, correct-credential
plaintext review while canonical current stays encrypted, explicit plaintext
download/Use, and Reader continuation with the exact chosen bytes. One task,
original and history remain intact. Actual saved plaintext preserves standard
Info, language, forms, attachment MIME/payload and page geometry. Secret
metadata checks pass for session, workflow, browser storage and URL. There are
zero page errors/non-GET requests and exactly two deliberate downloads.
The actual artifacts are 11,123 encrypted bytes, SHA256
`c5733000ec2f2c2b46cc83618af8068fd287881fa74acb51d7985b2d47d4ad05`,
and 8,776 plaintext bytes, SHA256
`4025d0393885873457d0853d94682f8d7d22a3339e5cd573d40be54bf47f3b53`.
All 318 included hashes, path inventory and source stay exact; the browser
closes. The two disjoint document PDF core/test paths are excluded from this
window. Evidence:
`/tmp/browserpdf-root-protection-workspace-journey-first-20261019/report.json`.

Root's separately allocated eleven native cases finish **10 PASS, 1 FAIL**,
25,187.885 ms, zero skipped/flaky/top-level errors. All 358 included hashes,
path inventory, configuration, frozen manifest and audit40 remain exact.
No globalSetup, shared fixture generation or server lifecycle occurs. The
browser closes. Evidence:
`/tmp/browserpdf-protection-workspaces-native-first-20261019/final.json`.
The single failure is an authored test expectation: canonical selection is
page 2, private Previous navigation visits page 1, and Undo correctly restores
the canonical selected-page preview to page 2. The helper incorrectly requires
page 1. All preceding encrypted pixels, explicit download/Use, Unlock-only
rail and private page navigation assertions pass. A test-only expected-page
parameter correction is approved; product selection behavior stays intact.

Fresh independent review also finds a separate P2 product issue: the custom
result passes boundary losses without the required kind, so Use and handoff
drop baking/prior rewrite disclosures, and the private review displays no
losses. Original/history still retain their own boundary. A route-local valid
finite boundary and visible disclosures, including an actual scene-bake and
handoff regression, are approved within the same thirteen paths. Evidence:
`/tmp/browserpdf-protection-workspaces-fresh-review-20261019.md`. All thirteen
hashes stay exact through review. The original ten-pass/one-fail gate and Root
journey remain retained; both service rows, correction acceptance, finite
return intent, full locales and final service checks remain open.

### Protect and Unlock: boundary and responsive corrections accepted

Both boundary findings close in the same thirteen owned paths. The route
passes the required finite `pdf-rewrite` boundary, retains prior and actual
baking disclosures, shows them before Use and preserves an exact no-op
boundary. A union exceeding the supported limit rejects before adoption.
The authored Undo expectation now follows canonical page 2. Five focused
portable checks and six syntax checks pass. Fresh focused review passes at
`/tmp/browserpdf-protection-workspaces-corrected-review-20261019.md`.

Root's three affected actual native cases pass **3/3**, 6,089.103 ms, with no
skips, flakes or top-level errors. They prove the original Undo tail, actual
form-scene baking plus prior boundary through Protect/Unlock Use, history
and Reader continuation, and exact no-op disclosures with a newer-owner
fence. All 424 included source hashes, path inventory, configurations,
manifest and audit40 remain exact; the browser closes. Evidence:
`/tmp/browserpdf-protection-workspaces-corrected3-native-20261019/final.json`.
This is a focused correction gate, not a new single-run thirteen-case result.

Root's independent mobile check then finds a real 320-pixel overflow: the
algorithm SELECT extends to pixel 353. The first preview begins at
2,085.98 pixels below repeated long identities and settings. The original
failed report and diagnostic screenshot are retained in
`/tmp/browserpdf-root-protection-layout-idle-first-20261019/report.json` and
`/tmp/browserpdf-root-protection-320-diagnostic-20261019/`.

The owned correction bounds controls and grid columns, puts preview and
review before settings, and uses keyboard-accessible native document
details. Separate Current and Pending labels retain full accessible names.
Use, history and original recovery refresh the identity; Cancel removes
the pending label while retaining A; Clear resets old labels before a
successor. Only workspace JS/CSS, two affected specs and the checkpoint
document change. The other eight owned paths remain exact. Fresh focused
review passes eleven finite source probes with all thirteen owned and
three shared hashes exact:
`/tmp/browserpdf-protection-responsive-fresh-review-20261019.md`.

Root's actual two affected native cases pass **2/2**, 2,170.419 ms. They
cover exact 260-unit labels, native keyboard expansion, canonical selected
page through history, Clear and a positive successor, and pending encrypted
B over accepted A through wrong credential and Cancel. All 423 included
source hashes, path inventory, configuration, manifest and audit40 remain
exact. The disjoint active document pure modules and Metadata six-path
work are explicitly excluded. Evidence:
`/tmp/browserpdf-root-protection-responsive2-native-first-20261019/final.json`.

Actual idle delivery measures **76,241 first-party JS bytes and eleven
requests** for Protect, and **76,240 bytes and eleven requests** for Unlock.
Both remain below unchanged 100,000-byte and sixteen-request limits; optional
intake, preview, engine and library loader modules are absent. The subsequent
readiness assertion times out at five seconds; a separate fifteen-second
prefix also times out before geometry. Both failed reports remain retained.
A focused 320-pixel diagnostic subsequently loads the actual PDF, records
zero failed network requests and confirms no overflow. These outcomes are
not relabeled as product success or a proven network failure.

The final four-layout gate waits for the actual page canvas and then also
requires the operation button to be ready. It passes Protect at 320-pixel
English/light and 768-pixel Turkish/dark, and Unlock at 390-pixel
Turkish/dark and 1,440-pixel Arabic/light. Body widths match each viewport,
controls do not overflow, actual canvas backing stays within 900 pixels
and one million pixels, and theme/RTL checks pass. Protect's 320-pixel
canvas begins at 1,006.25 pixels; Root visually inspects the saved screenshot.
All included source hashes, path inventory and input corpus remain exact;
page errors and non-GET requests are zero; the browser closes. Evidence:
`/tmp/browserpdf-root-protection-layout-idle-responsive-canvasready-first-20261019/report.json`.

The author's first global closure failure is retained separately. Its two
shared deltas and new test are Root-approved document-workspace work:
readonly `resourceCount` in the actual and empty snapshots, plus a focused
four-case unit. The original failure is not overwritten. Native gates
include the frozen shared changes and exclude only explicitly owned
unrelated active paths. This accepts the standalone workspace and focused
corrections for checkpointing. Finite Unlock return intent, complete
twenty-two-locale semantics and both final service rows remain open.

The exact thirteen workspace paths and this ledger are committed and pushed
as `e6732af120072a1a80c36be164b1822c8aaa552d`, parent
`98a406e52b1c0eba6fdd8c1b10d16c0d6c1b80b1`, title
`Improve PDF protection workspaces`, empty body. All fourteen staged and
committed blobs match Root's immutable allowlist. The index is empty;
actual remote, HEAD and upstream agree. All 406 protected hashes, audit40
and the 420-path inventory outside sixteen explicit concurrent document
and Metadata paths stay exact. The excluded paths are never staged. Root
independently checks the actual remote, commit metadata and all 420 hashes.
Evidence:
`/tmp/browserpdf-protection-workspace-checkpoint-commit-proof-20261019.json`.

### First shared document draft, intake and font checkpoint

The first ten-path foundation adds a bounded editable document draft,
one-job intake and exact pinned font acquisition. Only two shared production
sources change: the real session exposes readonly resource Map cardinality,
and its lazy empty descriptor exposes finite zero resource scalars. No byte
inventory, copy-based usage query, loader signature or SDK export changes.
Readonly SDK distribution and type checks pass without a build or dist write.

The draft retains baseline and bounded local history under joint session
resource and retained-byte admission, reserves before copying, rejects
concurrent mutations, preserves exact list values and literal text/styles,
and exposes finite model/source windows with CR/CRLF offset mapping. Intake
owns the first File read and parser promise, retains at most one latest
unread candidate and drains actual work before successors. Font loading is
serial and limited to five exact pins; bytes are checked before font parsing,
abort/cleanup drain and erase owned arrays, and font-free content loads none.
New local image-file admission and service UI remain a later checkpoint.

The first nineteen portable checks pass, followed by an expanded and final
**20/20**, 394.034917 ms. Four initial scalar checks and two artifact-capture
checks pass. Forty-four protected core, font, loader, result, handoff and SDK
files remain exact. Saved artifacts include nested list edits retaining
7/12/8, a five-style/table/image DOCX and a genuine one-page 29,664-byte PDF,
SHA256 `78813f4112a06248c64e68ac22317bf86c8e4d01d6fa2790763a1dd9b8330940`.
The small build admits its 80 MiB output reserve plus actual scratch and
live state at 86,657,217 bytes, leaving 14,006,079 bytes of retained-byte
headroom. This is application-owned reservation evidence, not a native heap
bound or a new independent pixel/geometry check. Evidence:
`/tmp/browserpdf-document-workspace-pure-first-20261019/report.json`.

Fresh review finds one P2 prerequisite: the actual lazy empty descriptor
omits `resourceBytes`, so the new budget admission rejects the first Markdown
File before parsing. An independent exact-expression probe reproduces the
failure and a single-zero positive control. Other current draft/history,
source-window, list, static-image, intake drain and fixed-font scope passes
review. Evidence:
`/tmp/browserpdf-document-workspace-pure-fresh-review-20261019.md`.

The approved correction changes only the lazy helper, its scalar unit and
checkpoint document. It adds `resourceBytes:0` and exercises the actual
unnormalized empty expression through a real first Markdown File, exactly
one parser call, zero-resource and missing-field controls. The affected
**5/5** pass, 47.166917 ms. An initial 4/5 test result is retained: its hard
break oracle incorrectly expects Markdown CRLF after the accepted reader's
LF conversion. Only that expectation changes. Other seven owned paths,
all forty-four protected files and original artifacts/proofs remain exact.
Evidence:
`/tmp/browserpdf-document-workspace-pure-corrected-20261019/report.json`.
Focused independent review passes and closes the sole P2:
`/tmp/browserpdf-document-workspace-pure-corrected-review-20261019.md`.
Its new probe uses the unnormalized actual empty expression, a genuine File
whose own read override must not run, the real Markdown reader exactly once
and one publisher call. The missing-scalar negative remains strict. All ten
owned, forty-four protected and nineteen evidence hashes stay exact before
and after. This accepts the ten-path foundation for checkpointing. UI
integration, a new-image transaction, route artifacts, manual Download/Use,
full locales and all three final service rows remain open.

### OCR: first actual owned native engine proof

The private one-English native prototype first fails before engine startup:
its CommonJS-to-ESM wrapper redeclares the exported factory. Root corrects
only that wrapper. The next run exposes a real ownership bug: browser timer
functions copied to a plain object receive the wrong receiver and throw
`Illegal invocation` after reserving the lane. A separate actual
DedicatedWorker diagnostic reproduces both timer failures and proves the
captured global receiver succeeds. Both original failed prefixes remain
retained; no OCR success is inferred from them.

The corrected private lane captures the default timer receiver, guards
registration and successful completion cleanup, settles owned promises once,
retains failed handles, attempts direct native termination independently and
fences failed cleanup. Host cancellation cannot acknowledge release for a
busy/fenced lane without an owner. Twenty-three original, eighteen focused
timer and four host controls pass, with no unhandled rejections. The eight
prior genuine-signal checks remain separate historical evidence. All
twenty-eight new private artifact hashes verify. Upstream main/worker/core,
language normalization and the pinned English data stay unchanged.

Root's corrected actual native gate passes **4/4** in Chromium
151.0.7922.34 under the site's real CSP. Normal recognition and its positive
successor return `ROOT ENGLISH OCR 9472` plus LF, confidence 95, one block,
one line and four words. Startup cancellation occurs while the SDK promise
is still pending; recognition cancellation occurs at public progress zero.
Four direct Worker captures each receive exactly one native termination
invocation. Owned ready/recognition promises settle once, the final lane is
idle and unfenced, and parent cleanup terminates its host and revokes owned
URLs. Browser termination remains a void invocation; physical exit and heap
reclamation are not acknowledged.

Exactly six private asset pins are served and verified; unexpected HTTP,
non-GET requests and page errors are zero. All 308 included source hashes
and path inventory remain exact, and the browser closes. The explicitly
excluded document pure, Protection and Metadata paths are not imported.
Evidence:
`/tmp/browserpdf-root-ocr-native-gate-timers-corrected-first-20261019/report.json`.
This proves the bounded private engine/lifecycle case. Fresh focused timer
review, production distribution/route integration, correction UI, actual
saved OCR PDF, other languages and general accuracy acceptance remain open.


### Shared document foundation checkpoint and OCR review closure

Root independently verifies `f0fa2aaa99f275b14c81a7220a767db65b20cafb`
on HEAD, upstream and the actual feature remote. Its title is
`Add shared document draft and intake`, its body is empty, and its parent
is `e6732af120072a1a80c36be164b1822c8aaa552d`. Exactly eleven accepted
paths are committed; 419 protected paths and all forty audit files remain
exact, with seven concurrent Metadata paths explicitly excluded. Evidence:
`/tmp/browserpdf-document-workspace-checkpoint-commit-proof-20261019.json`
and
`/tmp/browserpdf-root-document-workspace-checkpoint-remote-verification-20261019.json`.
These hashes describe the checkpoint before the next authorized document
image/UI changes, rather than asserting those active paths are pristine.

The independent focused OCR timer/native review passes:
`/tmp/browserpdf-ocr-native-timers-corrected-fresh-review-20261019.md`.
It reconciles the twenty-eight private files, retained assets and evidence,
six exact native pins, strict twelve-policy controls and the actual native
4/4 report. No actionable finding remains in that private prototype.
Production distribution, guarded child output, correction UI, saved OCR
PDF, further languages and final service acceptance remain open.

### Metadata workspace: actual correction acceptance

The seven-path workspace implements literal dirty-only standard Info
editing, deliberate replacement of oversized values, controlled eight-key
standard cleanup, original/current field comparison, effective inherited
scene input, actual saved-result review, explicit Download/Use and a
chosen-copy Privacy/Doctor/Reader rail. Creation date and untouched Info
fields remain preserved; standard cleanup does not claim to remove XMP,
attachments, forms or arbitrary hidden content. Its original core/artifact
checks pass 19/19. The first Node adapter failure is retained separately.
The exact initial manifest and artifacts are under
`/tmp/browserpdf-metadata-owner-final-20261019/`.

Root's first actual native run is **12 PASS / 4 FAIL**, not a clean suite:
`/tmp/browserpdf-metadata-native-first-20261019/final.json`.
Two failures come from a test helper that treats tagged scene/composition
history as byte-only records. Two mobile failures place the canvas at
908.84375 and 855.59375 pixels, below the 820-pixel viewport. An unchanged
320-pixel diagnostic confirms a duplicate visible identity precedes the
already collapsed name details; Root retains and views its original PNG.

Independent source review also finds P2: the shared result helper catches
load/render errors and fulfills, while the route treats fulfillment as
readiness. Root extends that finding to the initial review interval, when
shared Use/Download buttons already exist before loading completes.
The correction keeps the actual precreated shared panel inert throughout
initial and post-Use loading, then requires the fresh selected-page marker,
positive bounded canvas, retained label and exact owner. Failure drains,
hides and locks the panel and blocks the rail. Retry reuses the verified
cached bytes and ModDate without saving again. The actual shared identity
moves into the native collapsed details with full accessible labels,
keyboard access and accepted Clear reset. History assertions retain every
typed record, complete scene/composition JSON and source resource hashes.

The first six authored protocol regressions fail before correction and
remain retained. Affected portable checks then pass **12/12**,
435.209291 ms, plus four syntax and focused HTML/CSS checks. The metadata
PDF core and prior field/pixel artifacts are unchanged; that matrix is not
rerun. Independent focused review passes and closes both initial and
post-Use P2 paths using the actual entry, actual shared result body and real
metadata core with non-native injected rendering. Its private sentinel
assertion failure is retained separately. Evidence:
`/tmp/browserpdf-metadata-corrected-fresh-review-20261019.md`.

Root's corrected first affected native run passes **13/13**, consisting of
twelve affected cases and one idle check, 11,487.202 ms. It proves held
initial buttons remain inert; initial and chosen load/render failures block
actions; cached Retry keeps exact saved hashes with one save; dirty edits,
Cancel, Undo/Redo, inherited scenes, chosen clean current, keyboard names
and Clear retain ownership. Natural 320/390 English/light and Arabic/dark
surfaces pass. Skips, flaky results, top-level errors, page errors and
non-GET requests are zero. Exactly 426 included source hashes, included
path inventory, config, private wrapper and seven-file manifest remain
exact. Twenty-two explicitly concurrent Doc/OCR paths are excluded and
never imported; this is a scoped freeze. Evidence:
`/tmp/browserpdf-root-metadata-corrected-native-first-20261019/final.json`.
Actual idle delivery is 76,814 JavaScript bytes in eight requests, with
optional inspection/PDF/result engines absent.

A separate corrected 320-pixel visual capture puts the canvas at
734.84375 pixels with document scroll width exactly 320. Root views the
retained PNG; all seven hashes remain exact, no page errors or non-GET
requests occur and the browser closes. Evidence:
`/tmp/browserpdf-root-metadata-corrected-mobile-visual-first-20261019/report.json`.
The original first sixteen and corrected affected thirteen are distinct
runs; no clean all-twenty-two claim is made. This accepts the scoped
Metadata workspace for checkpointing. Full locale migration, richer
Privacy/Doctor destinations and final service-07/all-32 gates remain open.


### Metadata checkpoint sync

Root independently verifies `9d497161ab3f7d34d5a7405cd79f93cf42bac6c6`
on HEAD, upstream and the actual feature remote. Its title is
`Improve PDF metadata workspace`, its body is empty and its parent is
`f0fa2aaa99f275b14c81a7220a767db65b20cafb`. Exactly eight accepted
paths and their committed blobs, 418 protected paths, the 426-path included
inventory, forty untracked audit files and empty index verify. Twenty-two
concurrent Doc/OCR paths remain explicitly excluded and unstaged. Evidence:
`/tmp/browserpdf-metadata-workspace-checkpoint-commit-proof-20261019.json`
and
`/tmp/browserpdf-root-metadata-workspace-checkpoint-remote-verification-20261019.json`.

### Shared document image transaction and joint ledger acceptance

The five-path pure extension adds atomic local PNG/JPEG image replacement,
one task-lifetime asset Map, current-model asset projection and actual
external intake reservation accounting. Replacing an image keeps its
physical document dimensions. Unreferenced old metadata is omitted from
current exports while its owned bytes remain available for Undo. Forty-eight
owned image entries and sixteen MiB remain lifetime limits even after history
clear. Six retained models share the existing forty-eight-MiB history limit.
Busy is registered before producer access; the first normalization and first
captured disposer promises drain before release or publication. Failed
cleanup retains its reservation and fences new work, history and disposal.

The trusted external-usage accessor combines the real session snapshot,
actual intake reservation Map and UI leases with the draft's own pending
resources. Image peak is charged once; raw File admission remains independent.
The first affected joint image/intake gate passes 17/17, 312.194042 ms.
Actual named PNG/JPEG codec outputs and saved PDF/DOCX artifacts remain
retained separately; they are Node evidence, not browser EXIF proof.

A later typed cleanup-complete early-stop branch loses the exact abort
reason. The narrow captured-signal correction passes six affected checks,
269.917375 ms, and five private stages, including failed-disposer priority.
Fresh independent review then finds one P2: `if (error)` swallows genuine
null, false, zero and empty-string abort reasons. Eight actual-module probes
wrongly fulfill undefined while preserving A and releasing safe resources.
Those original failures remain retained. An explicit caught-presence boolean
corrects the settlement without changing cleanup-fence precedence.

The affected correction passes 3/3, 250.366542 ms, covering all eight falsy
variants, genuine intrinsic/own-override guards, held first work, unchanged
A/resources, valid successors and prior cleanup controls. Independent focused
recheck passes and closes the sole P2:
`/tmp/browserpdf-document-image-ledger-corrected-review-20261019.md`.
It replays the original eight cases with only a new output path; all reject
with the exact reason. All 63 source/evidence checks and a separate post-replay
54-source check match. Root separately replays those eight with strict
assertions, verifies all 54 sources and preserves the original failure JSON:
`/tmp/browserpdf-root-document-image-falsy-abort-corrected-first-20261019-proof.json`.
All six original codec/PDF/DOCX output hashes remain exact.

The final documentation-only five-path reconciliation is frozen under
`/tmp/browserpdf-document-image-checkpoint-final-20261019/` with manifest
SHA-256 `2b33d5840b5da765a894b68665537d068ce604b8091f0b8c84d3e0c9c98fafb1`.
Its four runtime/unit hashes are unchanged. This accepts the scoped pure
image transaction and joint ledger for checkpointing. Markdown source-revision
and initial named-image binding remain private proposals. UI12, real browser
normalization/EXIF/cancellation, actual three-service Download/Use journeys,
locales and final service acceptance remain open.

### Guarded OCR: retained first failure and review finding

The separately pinned private child-output guard passes twenty controlled
source/compiled dispatch controls. Root's first actual guarded-worker run
then fails during normal recognition before any of four cases completes,
with `OCR publication rejected: non-data value`. The failing property is not
identified by that report. Six pins, zero unexpected HTTP/non-GET/page errors,
known direct child release, idle/unfenced lane, host termination, browser
closure and all 426 included source hashes/path inventory verify. Evidence:
`/tmp/browserpdf-root-ocr-native-gate-guarded-first-20261019/report.json`.

Fresh independent review separately proves P2: a hash-correct English view
of 5,199,098 bytes can have a twenty-MiB backing buffer that structured clone
copies in full, exceeding the declared startup cap and reservation. Evidence:
`/tmp/browserpdf-ocr-output-guard-fresh-review-20261019.md`.
All fifty-six frozen private files remain exact. The guard is not accepted.
A new private prefix is authorized for exact startup backing extents and a
bounded property-path/type diagnostic; no generic optional-value relaxation
or production adoption is authorized. Earlier unguarded native 4/4 remains
separate historical evidence. Production OCR, corrected saved output and
other-language native gates remain open.


### Shared document image checkpoint sync

Root verifies `9fd688f6aa8ce8794ea80132a16a129158693615` on HEAD,
upstream and the actual feature remote. Its title is `Add atomic document
image replacement`, its body is empty and its parent is the accepted
Metadata checkpoint `9d497161ab3f7d34d5a7405cd79f93cf42bac6c6`.
Exactly the five accepted image/accounting paths plus this ledger are
committed, +488/-25. Six committed blobs, 425 protected paths, the included
431-path inventory, forty untracked audit files and empty index verify.
Seventeen concurrent Doc UI/OCR paths remain excluded and unstaged.
Evidence: `/tmp/browserpdf-document-image-checkpoint-commit-proof-20261019.json`
and `/tmp/browserpdf-root-document-image-checkpoint-remote-verification-20261019.json`.
The later approved source/init/revision extension is new work and does not
change the scope of this accepted checkpoint.

### Guarded OCR: exact backing and scoped enum correction

The exact-startup-backing correction requires offset zero and an ArrayBuffer
whose full length equals the pinned decoded model length, both before dispatch
and before native publication. Eight author controls, two bounded-diagnostic
controls and twelve independent controls pass. The focused review closes the
backing-extent P2:
`/tmp/browserpdf-ocr-output-guard-backing-corrected-review-20261019.md`.
The diagnostic run retains its expected normal-case failure and identifies
`$.psm typeof=undefined` without exposing a raw value:
`/tmp/browserpdf-root-ocr-native-gate-backing-diagnostic-first-20261019/report.json`.
This does not establish why the underlying module lacks a mapped enum value.

The exact primary dump source can produce undefined root psm/oem fields.
Only those own root recognition data fields may carry undefined; each remains
present and charged nine bytes. Required text, blocks and confidence,
nested values, arrays, startup and progress retain their strict policies.
Eleven author controls and twenty independent controls pass. Fresh focused
review accepts the correction and reconciles all 135 frozen private files:
`/tmp/browserpdf-ocr-output-guard-enum-compatible-review-20261019.md`.

Root's new actual English guarded-worker four-case gate passes normal,
pending startup cancellation, public-progress recognition cancellation and
normal successor. Each native child is captured and terminated once; owned
promises settle once, release is known and the final lane is idle/unfenced.
The normal and successor page and line strings both preserve literal
`ROOT ENGLISH OCR 9472` followed by U+000A. Page confidence is 95 and line
confidence 96. Six private GET pins, no unexpected HTTP/non-GET/page errors,
all 426 included source hashes/path inventory and browser closure verify.
Evidence: `/tmp/browserpdf-root-ocr-native-gate-enum-compatible-first-20261019/report.json`,
SHA-256 `eeee2cf4b81caf32a8ad67022cc1f11438ee9e2d9f1f8850a25aaec82d40cd04`.
Physical worker exit and native heap release are not acknowledged by the
browser API. The publication guard runs after dump and does not cap
WASM/GetJSONText/JSON parse/dump heap.

A separate approved pure-model contract preserves raw text, one literal
terminal LF separator and editable content as reversible provenance. It
never trims, collapses or normalizes source text. Internal/repeated newlines,
CR and user-entered controls remain visible unsupported content until explicit
correction or exclusion. Implementation and actual saved-PDF acceptance
remain separate from the private raw recognition gate.

### Private Turkish selected-model gate

The already acquired Turkish model is 4,680,866 decoded bytes, SHA-256
`f0127d0f3745f9c65e2ae7ec6b23198fbe5aa186a61b35661426f5e1ef9dedd7`.
Adding only its registry entry and then removing it recovers the accepted
English helper byte-for-byte. The host validates genuine exact backing,
selected fixed length and actual SHA before importing the SDK. It submits
one selected model. Eight author controls and seventeen independent controls
pass; all 39 new and 135 previous frozen files remain exact. Fresh review:
`/tmp/browserpdf-ocr-turkish-registry-native-review-20261019.md`, SHA-256
`695bf74b69b20e9a472dbcce4fe2c8436bbb3fc3a7040766d02f36dea971a0fc`.

Root's actual Turkish four-case gate passes the same normal/startup-cancel/
recognition-cancel/successor lifecycle. The predetermined fixture is
`MERHABA İıÇçĞğÖöŞşÜü`; the fixed acceptance fragment is `MERHABA`.
Both normal results actually read `MERHABA İlÇçÖğÖöŞşÜüüÜ` followed by
one U+000A. The accented mismatch is retained. Page and line confidence are
71; the two word confidences are 93 and 49. Two words, 21 symbols, two choices,
bbox [38,106,635,160], sloped baseline [38,150,635,151] and row metrics 54/9/10
are captured literally without projection. This proves bounded loading,
structured transport and lifecycle for the selected model; broader Turkish
recognition accuracy remains unproved.

The six exact private GETs run once, with no additional HTTP/non-GET/page
errors or imports from the 27 explicitly excluded concurrent Doc/OCR/Privacy
paths. All 424 included repository hashes/path inventory and forty audit
files remain exact. Known application-buffer reservation is 48,863,261 bytes,
not a heap measurement. Child release, idle/unfenced lane, host termination
and browser closure verify; physical exit acknowledgement remains false.
Actual report:
`/tmp/browserpdf-root-ocr-native-gate-turkish-first-20261019/report.json`, SHA-256
`93e0977a7b50dea465e64a89b67a9b91678417cc430482baa763a2244f2b2de3`.
Root independent reconciliation:
`/tmp/browserpdf-root-ocr-turkish-native-reconciliation-20261019.json`, SHA-256
`16ec31cb287bd3963364ae7c4b896a8b38e713f9be3e9941215b9a3b8c842248`.

This accepts the private Turkish registry/host delta and native gate.
Production distribution, OCR route/editor, corrected saved output and final
service-17 acceptance remain open. The Word/Markdown source/init/revision
pure extension, three-service UI and Privacy Scan pure/report implementation
also remain active, with final all-32 gates open.


### Shared document source and asynchronous disposal checkpoint

The new five-path pure extension initializes exact named Markdown/image source
bindings at provisional revision zero, applies reader or serialized source
revisions atomically, retains source/model history in one lifetime image pool,
and reports the actual source relation and retained usage. BOM, CRLF and literal
source bytes remain explicit. Digest plus byte equality and alternate-text
identity govern image reuse; source changes and history clear do not reset
lifetime image limits. The original source remains retained.

Draft disposal now returns and drains its first captured disposer promise before
erasing owned bytes. Intake likewise drains the first asynchronous discard before
releasing admission or starting the latest successor. Failed cleanup retains its
reservation and fence. Actual genuine falsy abort reasons preserve identity after
failed first work, with cleanup failure taking priority. These are pure ownership
changes; the three UI routes still need source wiring and native journeys.

The first source selections retain 13/14 then 15/16 results caused by an authored
call to a DOCX result disposer that the actual writer does not expose. The test
uses the actual returned byte ownership after correction. Its focused artifact
case passes. The full affected foundation invocation passes 41/41 in 1081.380916 ms;
a later affected selection passes 17/17 in 556.057042 ms. Actual Markdown, local
PNG, DOCX and PDF artifacts and independent ZIP/XML/media evidence are retained.

Fresh review finds one P2: the source-relation publication rereads producer
command.type after a yield. A genuine bold-style edit can then be mislabeled
parsed when the producer changes its tag to set-paper. The correction captures
the validated tag actually applied on every successful mutation branch.
Three focused getter/data/paper-association controls pass, 196.502417 ms.
Independent original-probe replay now reports bold/literal/outdated/getter-zero,
while the original failed observation remains exact. Fresh focused review closes
the sole finding:
`/tmp/browserpdf-document-source-core-corrected-review-20261019.md`, SHA-256
`d28a143eb84fe6bec219a37e4c29a7bfae6e5281379b220e98bfc285d06e7b1b`.
All 94 recorded paths and 54 post-probe source checks match. Earlier independent
real source/history and rejected-first-digest/falsy-abort controls remain valid.

The corrected five-path manifest is
`/tmp/browserpdf-document-workspace-source-corrected-20261019/final-five-manifest.json`,
SHA-256 `a86b2919671ce09255a8a262e55e5433b9ad9d2da19902fc062c9b47710ef3a9`.
Root verifies those five hashes and all seven retained artifact hashes. Root also
independently checks ZIP CRC, all six XML parts, the actual export-alt attribute,
byte-exact embedded PNG and its Markdown filename:
`/tmp/browserpdf-root-document-source-artifact-reconciliation-20261019.json`.
The shared budget function remains exactly 849 bytes, SHA-256
`29b5868d6a8a11a4cf59449c9cce3d05f8b952bca1165960d79d5ee2581da736`.
This accepts the scoped pure source/init/revision/disposal checkpoint. Actual
source UI wiring, browser image normalization/EXIF, selected-page readiness,
manual Download/Use, three route journeys, locales and final acceptance remain open.

### Parallel Privacy and OCR pure-core review status

Root's actual Privacy normal artifact gate removes all eight raw Info keys from
a new 3439-byte PDF to a 3336-byte result. Four rotated/CropBox/UserUnit pages have
zero source/result RGBA differences. XMP, attachment payload/MIME, form value and
appearance stream, URI, custom Unicode Info and geometry remain exact. Actual
own-signal overrides, successors and locked native input pass. All 429 included
source hashes/path inventory and audit files match outside 22 unrelated Doc/OCR
paths; 21 GETs, no unexpected requests/non-GET/page errors and browser closure verify.
Report: `/tmp/browserpdf-root-privacy-core-native-raw-keys-first-20261019/report.json`,
SHA-256 `2734d37043dae0b1bbf2382574b183effda0a80be1e9bfb6ff5c51e7b09d0260`.
Two earlier Root harness failures remain retained: omitted explicit category and
using PDFDict.has for PDFNull raw-key presence. Only the private checker changed.

Privacy pure-core acceptance remains held for two fresh P2 corrections: native
rejection loses exact cancellation reasons in lifetime/preview/queue, and a logical
field can traverse unlimited widget entries despite finite field limits. The report
is `/tmp/browserpdf-privacy-core-fresh-review-20261019.md`. The author is correcting
those within the five pure paths plus one explicit additive legacy DTO expectation.
UI6 and actual final route/idle acceptance remain open.

OCR pure model/writer has twenty passing author cases and retained twelve-page,
thirty-six-line corrected Unicode/source-preservation evidence. Fresh review finds
three P2s: falsy native failures can fulfill undefined, pending candidate usage is
absent from public joint accounting, and short lines bypass the promised 128-action
preflight yield. Report: `/tmp/browserpdf-ocr-pure-core-fresh-review-20261019.md`.
Those narrow five-path corrections are active. The Root real-raw-recognition to
editable-model to saved-PDF browser harness is authored, not executed. It must
include the actual accepted document-budget dependency hash. OCR distribution,
UI/route and final service-17/all-32 acceptance remain open.

### Shared document source checkpoint sync

The accepted source/init/revision/disposal extension is committed and pushed as
`661fc03cda5370d35e7fed7b86db249235612577`, `Add document source revision history`.
The commit has the exact five approved source/test/documentation paths plus this
ledger, an empty body, parent `9fd688f6aa8ce8794ea80132a16a129158693615`, and
698 insertions/55 deletions. Root independently verifies HEAD, upstream and the
actual feature remote, all six committed blobs, 422 protected hashes, the complete
448-path inventory, forty untracked audit files and an empty index. Evidence:
`/tmp/browserpdf-root-document-source-checkpoint-remote-verification-20261019.json`,
SHA-256 `bfc12077b52ebdfd4f2fb1d011af7cda1c959bc9289a08e8e74d7131b70fdba0`.
The separate twelve-path Word/Markdown UI implementation is frozen for source
review; its nine authored browser cases have not run.

### Privacy corrected pure core and affected browser gates

The two subsequent Privacy P2 corrections preserve exact genuine cancellation
reasons after rejected first native work and bound aggregate field-widget visits.
Fresh focused review passes: 31 independent regressions, twenty original
controlled cancellations, four actual PDF.js cancellations, twelve uncanceled
failure controls and the one-widget/partial-status counterexample. Reverse hashes
prove the narrow corrections and preservation of all previous assertions. The
single legacy DTO expectation adds only `locationsOmitted: 0`.
Review: `/tmp/browserpdf-privacy-core-corrected-review-20261019.md`, SHA-256
`10e0b62d28ae7e3907a9b6878e3a4515540e60e4a81ce1b8171e02313888e29a`.
The corrected six-path manifest has SHA-256
`bfbbf9798108233806e4e1cbe3af507ea12f245cee05d52fe06cd394f18eca26`.

Root's actual browser rejection gate passes six cases: lifetime null/false/zero/
empty-string, preview false and queue-to-lifetime zero. In each case cancellation
occurs before the first real PDF.js load settles; the actual Loading-aborted
rejection drains, task destruction occurs once, the exact owned reason survives,
and a valid successor opens. Preview cancellation clears the canvas. Normal
cleanup again produces the byte-identical 3336-byte `77ff0064...` artifact, retaining
the prior rich graph and four-page zero-RGBA evidence by actual output identity.
All 434 included source hashes/path inventory and forty audit files are unchanged;
21 GETs, zero errors/non-GET/excluded imports and browser closure verify.
Report: `/tmp/browserpdf-root-privacy-rejected-native-first-20261019/report.json`,
SHA-256 `d2215d02c94086ae6f3a6fdea014d1b4380bebda27c7a07d3cb99b05a9f9fe7e`.

The retained legacy Privacy scan/cleanup/intake/chosen-Redact gate passes 9/9 in
9591.083 ms, zero skipped/flaky/top-level errors. Two deliberate actual downloads
and exact chosen-current/original/task handoff assertions pass. All 434 included
source hashes/path inventory and all 22 generated fixtures remain exact. Report:
`/tmp/browserpdf-root-privacy-legacy-selection-corrected-first-20261019/report.json`,
SHA-256 `238563950528b82a9fcd379fb7e2533b10f8fbb73a6b74aee2cb8dc50e6197c9`.
The first private runner selected zero tests because its regexp matched only raw
titles while Playwright matches file/suite/title paths. That failure is retained;
only the private selector changed, with every test body/assertion preserved.

The additional unchanged phase9 keyboard/idle invocation passes the real keyboard
flow and fails the Privacy idle byte ceiling: 107132 bytes against less than
100000. Its 16-request ceiling is unchanged. The eager scanner import causes the
growth. Report: `/tmp/browserpdf-root-privacy-phase9-first-20261019/report.json`,
SHA-256 `ecb9aeade08263ea89e6aa58e2623103b1c4496bd04ab5d9a13df4feabeed9fa`.
All 434 included sources and 22 generated fixtures remain exact. The six-path UI
author now owns a retryable lazy entry/workspace correction and actual report,
preview and chosen-result UI. Privacy checkpoint acceptance is held for that
correction and its source/native/idle gates. Service 31 and locales remain open.

### OCR pure model and saved invisible overlay acceptance

The original three P2 findings are corrected: falsy native failures now have an
explicit failure-present flag and finite error with the exact cause; pending
candidate bytes/slots are published before construction and retained through
first settlement/disposal; preflight yields after 16384 charged visits or 128
actions, including short lines. Eleven focused owner controls and the three
original corrected replays pass. The original actual-font 1000-short-line
cancellation now runs at exactly 128 layout calls. Original failed observations
remain retained. The twelve-page/thirty-six-line/sixteen-PNG preservation matrix
is unchanged and was not redundantly rerendered.

A focused review then finds one final callback-boundary P2: a final budget/owner
callback can cancel or replace ownership immediately before publication. The
final correction rechecks captured owner/revision and then genuine signal/closing
after those callbacks, immediately before construction or ownership transfer.
The original pending replay passes 4/4 and twenty-one independent controls pass,
including external/session/final-owner callbacks, falsy cancellation, owner
replacement, disposal, retained redo history and valid successors. All 25 final,
44 corrected, 43 original and 174 earlier private evidence pins match. The writer
is unchanged at `55be2048b200a11fa42821b10ae95074425bd188a9711e9e46b4964304d0851f`;
the model is `498c72046903668d36310c0208ec677b55ffa98c897b629c68ed49d5f8956fa0`.
Review: `/tmp/browserpdf-ocr-pure-core-callback-review-20261019.md`, SHA-256
`4e3a7eca11060797b9d6922dd1076fddcb4bb8bc1408b364a821446ce2f3e279`.

Root's actual browser integration starts from the retained real English/Turkish
recognition outputs and their exact raster images, without rerunning recognition.
It preserves raw text, the reversible LF separator, confidence and the actual
sloped Turkish baseline; applies a literal Turkish correction; verifies exact
Undo/Redo; and saves/reopens a new searchable PDF. The extracted strings are
exactly `ROOT ENGLISH OCR 9472` and `MERHABA İıÇçĞğÖöŞşÜü`. The source is 20311 bytes,
SHA-256 `ea726218edf940e7f94f7fd2fe9ac99b2b7f63bfb6e80b87f164e8a4a8b3490a`;
the saved PDF is 27763 bytes, SHA-256
`9cb0e34d8b018f5451f698e823fd6ae72153851d8798d5ba32263df6fd6df73b`.
Every original encoded stream remains byte-identical. Both nonblank 750x300
page renders have identical source/result RGBA hashes, confirming the overlay
does not alter the visible raster. Root visually inspects the Turkish page.
The pure writer does not adopt the output into the canonical task.

All 433 included source hashes/path inventory and forty audit files are exact
outside the 23 explicit concurrent Doc-UI/Privacy/Spreadsheet paths. The actual
accepted Doc dependency remains included at `1d1a6def...`, with the unchanged
849-byte budget helper. There are 22 GETs, no page errors/non-GET/excluded imports,
and the browser closes. Report:
`/tmp/browserpdf-root-ocr-pure-native-first-20261019/report.json`, SHA-256
`bd17220e2548109ecb2688c06d3272c57db2a761715b50819fa2734317d16bd1`.
This accepts the scoped five-path OCR model/writer/test/documentation checkpoint.
Production engine distribution, OCR editor/route, additional scripts/languages,
locales and final service-17/all-32 acceptance remain open. No deployment occurred.

### OCR pure checkpoint sync

The accepted five OCR paths and this ledger are committed and feature-pushed as
`aefec751f244347137941a57bc92e30c44d984a4`, `Add bounded OCR editing and PDF writer`.
The body is empty, parent is `661fc03cda5370d35e7fed7b86db249235612577`, and tree is
`df21bc9b0dfac8484535588f1811c4d81260ecec`. Root independently verifies actual remote,
upstream, exact six changed paths/committed blobs, 436 protected files, ten evidence
pins, forty untracked audit files, the path set outside 23 mutable exceptions and
an empty index. Proof:
`/tmp/browserpdf-root-ocr-pure-checkpoint-remote-verification-20261019.json`, SHA-256
`63d9e134409d86c00b17de3481f0ae804a23d2169dc81db5724fe969f80161ea`.
No main push or deployment occurred; the existing deployment workflow triggers
only on main pushes.

### Pure spreadsheet model and bounded inference acceptance

The first five-path spreadsheet checkpoint supplies a strict sparse typed model,
immutable source, explicit raw/display/formula/cache distinctions, atomic edits,
six-version history and bounded view windows. Edits mark remaining formula caches
unverified and never calculate formulas or infer dates/numbers from literal text.
The separate inference core consumes already admitted page/item geometry, retains
exact source text/references and records angled, outside or ambiguous content as
explicit unplaced data. It does not perform PDF extraction or open workbooks.

The affected owner invocation passes 22/22 in 1065.030375 ms, with four syntax
checks and nine unchanged protected sources. Earlier failed invocations remain
retained. Fresh review independently finds a final callback guard P2: an external
budget callback can abort with false immediately before Apply or Undo mutates
current/history. Original actual-API reproductions retain those failed outcomes.
The correction adds callback-free checks after budget/owner callbacks and before
publication/history mutation, including admission and final initialization.

Five focused owner tests pass in 112.254167 ms, with two syntax checks. Both
original independent scripts now reject with the exact false reason and preserve
the previous model/history. Two additional independent held-FIRST-disposer
controls prove pending usage stays charged until the once-only disposer drains,
then canonical replacement/disposal rejects without publication. All 37 scoped
source/evidence checks remain exact. The inference core and its test are unchanged.
Fresh corrected review:
`/tmp/browserpdf-spreadsheet-core-corrected-review-20261019.md`, SHA-256
`2ef90a009312d8c2d4acc669ea7c87d0c78dc8ed400a4d895b9acb129026d2b3`.

The accepted five-path freeze is
`/tmp/browserpdf-spreadsheet-core-final-guard-corrected-20261019/final-five-manifest.json`,
SHA-256 `9b3831e206ce5dfbd30cae5895455c1b95e37b5ce707b1e4cd78476c4edb1929`.
The model is `95efb72e313f808dce8b48f35fdf69387e4fa9a8a2203979df2a33737ce34751`;
inference is `f97729bcb70fb3a26c33f133f4a17a52df18f91531b458e1feef0a256a5a22fb`.
The accepted document budget dependency remains unchanged. This accepts only the
pure model/inference checkpoint. XLSX/CSV admission, SheetJS integration, editable
route UI, actual PDF extraction, saved workbook/PDF, browser integration, locales
and final services 26/27 remain open.

### Document UI functional gates and remaining default-layout refinement

Fresh review reproduces four UI P2s: loss of an initial Markdown BOM from immutable
original bytes, releasing an unproved result panel from inertness, boundary page
buttons invalidating ready actions without rendering, and stale fulfilled source
producers missing their first disposer before releasing accounting. The narrow
correction preserves exact source bytes, separates the readonly display projection,
keeps failed initial/post-Use panels inert, preserves no-op page readiness and
captures/drains each fulfilled producer's first disposer before stale/admission
checks. Nineteen owner controls and the independent original four plus three
additional controls pass. Fresh scoped review:
`/tmp/browserpdf-document-ui-corrected-review-20261019.md`, SHA-256
`13a818c34ac13c2f90b43dc9106e56a128cbb174f9e003b82a3fd6c831fce74a`.

The first actual route run passes 10/11 in 43954.594 ms. Its one failure waits for
the nonexistent Add Text selector previewCanvas after successful handoff; that
mode actually uses placementCanvas. A test-only correction keeps all artifact and
handoff assertions and adds finite canvas/page/current scene-revision and task-ID
proof. Only that affected case is rerun and passes in 4655.638 ms. The first failed
run remains exact; a clean new all-eleven invocation is not claimed.
Evidence: `/tmp/browserpdf-root-document-workspace-native-first-20261019/report.json`
and `/tmp/browserpdf-root-document-workspace-handoff-native-first-20261019/report.json`,
the latter SHA-256 `2e35a8cb1f2960b376f2dbca437ad5b33e79ca2d1bfcfe503ccfd1cfca16914f`.
Both runs preserve all 448 included source hashes/path inventory, 22 generated
fixtures and private harness files, with no skipped/flaky cases.

Root independently reopens the actual five-page Word and Markdown PDFs. The
39470-byte Word PDF, SHA-256 `0ff93734f6076d70b6b67e3afc2965d0136648b5a6d9e650e1089e9edb272a7b`,
has Letter geometry, five used font IDs, literal Unicode and final Page marker 69.
The 32413-byte Markdown PDF, SHA-256
`464f7c88380e85544741a736bcdd819e38124cfd104fb622161447b6027b1b48`,
has A4 landscape geometry, five used font IDs and final Marker 89. Root renders
and visually inspects the actual saved pages, independently of element screenshots.
Proof: `/tmp/browserpdf-root-document-native-artifact-inspection-20261019/report.json`,
SHA-256 `8bb3505e881e4f747c21fcd9128c71c2a533f398828216e03b7ecac956a5750d`.

Independent ZIP CRC and payload inspection verifies exact original/current/ZIP
Markdown bytes, the two named entries and local PNG signature. Actual original
and current BOM downloads match at 37 bytes with BOM and CRLF preserved.
Proof: `/tmp/browserpdf-root-document-native-zip-bom-reconciliation-20261019.json`,
SHA-256 `c29582ba15e60d4910505fd5ffe9e706868eb0e6791d77665b8ad21130e2e865`.

Root's two additional actual cases pass in 5560.787 ms: explicit plain-Markdown
Use to the next Markdown converter preserves exact current/original SHA and task,
and three 320/390-pixel Word/Viewer/converter layouts have no horizontal overflow,
finite selected-page canvases and ready Download/Use buttons inside the viewport.
All 448 included source hashes and 22 generated fixtures remain exact. Report:
`/tmp/browserpdf-root-document-ui-independent-first-20261019/report.json`, SHA-256
`be855e8ccc4d1d1e38bcac95481a2781d3863ee9d7e05a6b05200b150717461b`.
The separate idle case passes: Word 49641 bytes/11 requests, both Markdown routes
49649/11, with no parser/font/PDF workspace loaded before deliberate use.

Root's actual mobile screenshot still exposes too many technical editing controls
by default. A bounded same-twelve-path refinement now groups advanced controls in
collapsed sections while retaining the primary source/text/review/Download/Use
flow and every existing operation. The author owns that DOM/layout-only delta;
affected source review/native checks and checkpoint acceptance remain pending it.
Image-bearing standalone Markdown Use stays explicitly unavailable because the
shared API cannot adopt named sidecar resources; complete ZIP download and PDF
continuation remain supported. All three service/locales/final rows remain open.

Privacy UI fresh review separately finds restored-page selection, inherited alias
entry-count admission and original-alias/Redo history-copy reservation P2s.
The same six-path author is correcting those; the accepted Privacy core remains
frozen. No Privacy UI native or service acceptance is claimed.

### Document workspace disclosure acceptance

The twelve-path presentation refinement replaces the dense default editing form
with native collapsed details for page, table, paragraph, text-part and history
settings. Literal text, style, Save, correction Undo/Redo and review actions stay
directly available. Section headings use readable names. Opening state survives
editor rerenders; all existing operations and bounded windows remain available.
Seven ownership, source, export, readiness and cleanup regions remain byte exact.
Fresh scoped source review passes without a product finding:
`/tmp/browserpdf-document-ui-disclosure-review-20261019.md`, SHA-256
`eed98563f4dbe5945c6fa03d649b25dafa8bf941e6ec9cd5450f43b050c31927`.

The evidence-only corrected freeze records the actual eight changed presentation
paths and four unchanged entry/routes; inherited historical scope fields were
removed. All twelve owned and 54 protected pins remain exact. Manifest:
`/tmp/browserpdf-document-workspace-disclosure-20261019/final-twelve-manifest-metadata-corrected.json`,
SHA-256 `16d05cffe26d962190226a0ff03680aad8c1ababa3c148f601ba0530f89b943f`.

Root's new affected invocation passes all 13 cases in 18457.674 ms, with zero
skipped, flaky or retried cases. These are the eleven author journeys plus two
independent Root cases, strengthened to prove initially closed editor groups,
primary actions outside details and real focused Enter open/close on all three
mobile shells. Exact plain-Markdown current/original bytes and task survive Use
and the next converter. The 320-pixel light Word, 320-pixel dark RTL Viewer and
390-pixel dark converter have no horizontal overflow and keep ready Download/Use
inside the viewport. Root visually inspects the actual updated mobile screenshot.

Report: `/tmp/browserpdf-root-document-disclosure-native-first-20261019/report.json`,
SHA-256 `970b83b541880c8580dd42406c50efe195c0ad890fedbc673ccbae282674c280`.
All 453 included source hashes and paths, 22 generated fixtures and private harness
files stay exact. The 47 explicit concurrent Privacy/OCR paths are never imported.
Every actual request is GET; there are no page errors. Chromium is 151.0.7922.34.
Earlier failures and independent saved PDF/ZIP/BOM/idle proofs remain retained.
This accepts the common three-service UI checkpoint. Full locale coverage and
final service acceptance for 22, 25 and 29 remain open.

### Privacy workspace scoped acceptance

The Privacy workspace now reviews the actual selected PDF page, shows thirteen
bounded categories with explicit coverage/status and keeps raw sensitive matches
collapsed in local 25-row windows. Standard Info cleanup compares before/after,
preserves the source and requires a positive selected-page result preview before
manual Download or Use. Chosen bytes and typed source/history continue to Reader,
Metadata or the stored Doctor handoff. This does not claim Doctor UI acceptance.

Fresh UI review reproduces three P2s: restored canonical page selection was lost,
resource IDs sharing backing buffers were undercounted, and original/resource
aliases and future history copies escaped prospective Undo/Redo admission. The
corrections restore/clamp the selected page, count entries independently of byte
deduplication and reserve all three public history copies before mutation. An
owned intake admission callback captures frozen own-data begin options after
parsing/drain. A final focused review catches one further stale-owner callback
after the last owner snapshot. Reordering caller callbacks before the final
owner/signal check closes that counterexample: zero begins, A retained and exact
false/zero failures preserved. All earlier failing probes remain retained.
Final focused review:
`/tmp/browserpdf-privacy-ui-final-callback-review-20261019.md`, SHA-256
`985e198d8cc55a618270346590f97eed2d289d489dd6c425362f3dd123534c9d`.

The first actual new UI invocation passes 31/36 in 40820.963 ms. All 26 functional
author cases, four wide layouts and Root's independent golden journey pass.
Four small-screen cases put the canvas below the 820-pixel viewport. The fifth
failure is an authored idle-path regex treating the real js directory as a
two-letter locale, not a measured runtime-budget failure. Report:
`/tmp/browserpdf-root-privacy-workspace-native-first-20261019/report.json`, SHA-256
`f800b6403b8c6de6ddec332ebf6c739790b46dbf87728314bf4b76325d691eba`.

Root's unchanged EN320 diagnostic proves shared mobile button widths stack both
page controls full-width, with duplicate heading/status margins. Scoped selected
mobile CSS corrects those widths and margins while retaining every control,
label and full name. The idle test maps literal root paths with containment and
keeps the original 100000-byte/16-request limits and optional-import negatives.
Fresh scoped review passes, SHA-256
`41ce316151dd49dab82c9a5b76a7d444fbf71ce901f854a1ed59e10eba1b5e24`.
Only the affected eight layouts and idle case are rerun: 9/9 pass in 10082.349 ms.
Report: `/tmp/browserpdf-root-privacy-mobile-idle-native-first-20261019/report.json`,
SHA-256 `c186e7ddbe466dc67c97a0606a6abb83d64e7e013f639ff69d16986b3c1c7d73`.
The actual empty route requests eight first-party scripts totaling 72030 source
bytes and eleven total resources, with no optional engine. Root visually inspects
the corrected EN320 screenshot. No clean repeated all-36 invocation is claimed.

Root's golden source has four rotations, CropBox/UserUnit, custom Info, XMP,
attachment, form appearance and URI data. Page-four review and actual manual
download produce the exact prior independently verified 3336-byte artifact,
SHA-256 `77ff006474ba31ecb9f8e78c138506447a196b012ff5c02515ee4125d33a412c`.
Use and the actual ready Reader retain that hash, source original and task. The
rich saved-output preservation proof remains
`/tmp/browserpdf-root-privacy-core-native-raw-keys-first-20261019/report.json`,
SHA-256 `2734d37043dae0b1bbf2382574b183effda0a80be1e9bfb6ff5c51e7b09d0260`.

The unchanged legacy UI eight-case invocation passes seven and fails only its
obsolete clean-summary expectation. Its disabled-checkbox/busy/Clear/WebMCP
scenario passes unchanged. The old cleanup negative is a transient false positive:
it passes before the asynchronous report exists. Two test-only migrations now
wait for a settled visible report, require all thirteen named categories and
validate zero/complete metadata or clean statuses with their proper scope. All
original/output-byte and XMP/attachment assertions remain. The other eleven test
bodies stay exact. A single user-facing copy suffix replaces engineering memory
accounting with a plain original-preservation/review instruction; scene/composition
loss disclosures and all controller logic remain exact.

Root's independent small-delta review passes, SHA-256
`616cca11147a6008a176099f5da9edce16061fc17c3b447a1357144fb8f9ffa4`.
Only the two affected legacy cases are rerun and pass in 4091.562 ms. Report:
`/tmp/browserpdf-root-privacy-legacy-two-native-first-20261019/report.json`, SHA-256
`136c54e2ab5c19d1be0360f1c0378849a9aa1b13eeb83c2628659e5b731938dc`.
Final UI6 plus intentional phase5 test migration manifest:
`/tmp/browserpdf-privacy-ui-legacy-two-copy-20261019/seven-path-sha256.json`, SHA-256
`0abcdb4cf200ef838bde3176265eb33822eca9c0b14bd34d6124708636564c4d`.
The other five accepted core/test/doc paths remain unchanged. Each new invocation
preserves all 459 included source hashes/path inventory, 22 generated fixtures
and private harness files, with zero skipped/flaky cases and no page errors or
non-GET requests. Concurrent OCR41 and PDF-reader3 paths are never imported.

This accepts the Privacy core/workspace checkpoint. Opaque scene-bake cleanup
failures conservatively retain their fence and require reload; no heap or physical
exit guarantee is made. Full locale coverage and final service31/all32 acceptance
remain open. No production deployment is performed.

## Owned OCR engine foundation checkpoint, 2026-10-19

The exact forty-one new foundation paths provide the pinned English and Turkish
assets, upstream sources, reversible compatibility recipe, notices, owned loader,
host and envelope protocol. They do not activate the existing OCR route. The
offline construction, inverse mapping and forty portable controls pass in the
retained owner evidence. No additional model or dependency is acquired here.

Fresh source review found two P2 defects in the recognition entry: callbacks
could reenter before its pending marker, and the original mutable request or a
public typed-array buffer property could introduce unadmitted packet bytes or
transfer the wrong backing. The corrected loader reserves its FIRST slot before
inspection or callbacks, captures only the four own input fields and uses the
intrinsic fixed PNG backing. Final checks precede the closed packet transfer.
Original failing probes remain retained. Their corrected replays, six focused
owner controls and independent recheck pass. The other thirty-six foundation
files remain exact, including the host, engine, envelope and language assets.

Corrected forty-one-file manifest:
`/tmp/browserpdf-ocr-foundation-recognition-corrected-20261019/foundation41.json`,
SHA-256 `62dc59dbb1420a9597ed34ffec2112378c356661dcfbb2289c1f787e6ac051fd`.
Independent corrected source review:
`/tmp/browserpdf-ocr-foundation-corrected-review-20261019.md`, SHA-256
`0f533e3868de0fbe54b1886d0552ee43f492724221bb2bc79f9cf15201971f3a`.

Root then exercises the actual new public loader and host under the unchanged
production CSP in Chromium 151.0.7922.34. Two tests pass in 5402.512 ms, each
covering normal recognition, startup cancellation, recognition cancellation and
a successful successor. Every task makes exactly six same-origin GETs for the
selected model and pinned assets. A genuine canonical PDF session and fixture
buffers participate in the joint budget. Each task releases once, terminates
its observed host once, revokes all five parent-created URLs and finishes with
zero owned reservation, no pending work and no fence. False cancellation reasons
are preserved. The current PDF, original PDF and owner tuple remain unchanged.

The literal English and Turkish fixture DTOs match the retained prior captures.
The Turkish accent mismatch is retained; this is not a general accuracy claim.
The observer sees the parent host and protocol release facts. It does not observe
the host's child directly or establish physical exit or a native heap bound.
The first invocation stopped before recognition because of a private test-local
shadowed variable. That failure remains retained; only its local name and private
package references change before the passing invocation. Product sources remain
unchanged across both invocations.

Passing native report:
`/tmp/browserpdf-root-ocr-foundation-native-tdz-corrected-first-20261019/report.json`,
SHA-256 `f8a92e445760dddfd36c168d982041db2c185538598201e427e91b75e35ff15d`.
Root verification:
`/tmp/browserpdf-root-ocr-foundation-native-verification-20261019.json`, SHA-256
`e86146f9fa58c93d613e1c52b490a87113d90597095896ef110ea2ac2cbe87d7`.
All 503 included source hashes and their path inventory, twenty-two generated
fixtures and private harness files remain exact. Concurrent spreadsheet reader
paths are excluded and never imported. No skipped, flaky, page-error or non-GET
case occurs. Earlier portable and engine matrices are retained without reruns.

This accepts the engine foundation checkpoint only. The editable OCR workspace,
route integration, selected-page rasterization, complete locale coverage and
final service17/all32 acceptance remain open. No production deployment occurs.

## Literal PDF document reader checkpoint, 2026-10-19

The three new pure reader/test/checkpoint paths provide a direct PDF text model
for PDF to Markdown, PDF to Word and Extract Text. The model preserves every
returned PDF.js item string and EOL flag in stream order, including empty items,
with a separate source-page/item-span sidecar and all-page coverage. It does not
infer tables, lists, images, styles or layout. Its fidelity boundary is the actual
PDF.js disable-normalization projection; it does not claim raw PDF operator or
whitespace identity, and it performs no automatic OCR or Markdown roundtrip.

The retained owner twenty-seven-case gate and saved literal MD/DOCX/TXT proof
pass. Fresh review then finds two P2 defects: disposal invokes its release
callback before caching FIRST, allowing reentry and a false cleanup-failure
bypass, and a source-copy pair performs 32768 visits before cooperation. Exactly
two runtime lines change: cache a scheduled FIRST before callbacks and copy
8192-byte pairs. The three focused correction cases pass without rerunning the
prior twenty-seven cases. Original failing probes remain retained.

Independent corrected review passes the original reentry/copy probes and a
sole-release-throws-false control. All disposer callers share the exact FIRST;
release occurs once, and its false failure retains the shared CLEANUP error,
ownership and charge. Copy intervals now stay within 16384 visits while total
visits and byte identity remain exact. All 142 reviewed pins remain unchanged.
Corrected three-file manifest:
`/tmp/browserpdf-pdf-document-corrected-20261019/final-three-manifest.json`, SHA-256
`2517759205abb48682f8a715b570072f3f658434dd3d60821f9f801f2833c2af`.
Fresh corrected review:
`/tmp/browserpdf-pdf-document-corrected-review-20261019.md`, SHA-256
`dac50a3ef304588f56991c9906ce50d8e417d7be1045d652bf025f61a9ed75a9`.

Root's actual Chromium 151.0.7922.34 gate passes two tests in 2872.487 ms using
the public verified PDF.js 6.2.108 loader and exact frozen reader source. An
independent five-page native getTextContent baseline supplies 159 item strings
and EOL flags. All item spans, 150 literal paragraphs, page geometry and four
page boundaries agree with the reader model. Actual direct writers produce a
12479-byte Markdown file, 35006-byte DOCX and 12330-byte TXT. Root separately
reads the six saved artifacts, validates every DOCX ZIP CRC/XML part and exact
paragraph/page-break sequence, checks literal Markdown escape projection and
matches all TXT text with explicit page separators. None of these checks
reconstructs the original table/image/style layout.

The second actual test holds FIRST after the real PDF load resolves. Abort(false)
destroys that real task once, but the outer result remains pending with its
4199168-byte resource and 78940-byte artifact reservation until the held promise
is explicitly released. It then rejects with the exact false reason, publishes
nothing, releases owned usage and permits a valid five-page successor. Both
tests use a genuine populated canonical session and joint admission; current,
original, input bytes and owner remain exact. The normal peak is 50718068 known
resource bytes and twenty groups, inside the shared limits. This is not a native
heap or physical-exit guarantee.

Native report:
`/tmp/browserpdf-root-pdf-document-native-first-20261019/report.json`, SHA-256
`347a23c83c7a230f4c3003121b75551809c29ce3f17fa1f7d62afbcca2576301`.
Independent saved-artifact verification passes 191 checks:
`/tmp/browserpdf-root-pdf-document-native-artifact-verification-20261019.json`,
SHA-256 `f5d57cd82db1a7683acd2d2260b8afbfa0b4c9477627c99ae245543558ac0216`.
All 503 included source hashes/path inventory, twenty-two generated fixtures and
private harness files remain unchanged. No skipped/flaky cases, page errors or
non-GET requests occur. Concurrent spreadsheet paths are never imported.

This accepts the pure reader checkpoint only. The later PDF intake/draft seams
must explicitly account for retained extraction sidecars and their ownership
handoff. The three service workspaces, source preview, editable order, original
PDF OCR handoff, locale coverage and final service20/21/23/all32 gates remain
open. No production deployment occurs.

## Literal spreadsheet reader and intake checkpoint, 2026-10-19

The five new pure reader/intake/test/checkpoint paths preserve XLSX raw values,
source formula caches, date system and separate provenance. CSV fields remain
literal strings, including leading zeros, formula-looking text and embedded CRLF.
Unsupported meaningful workbook projections return needs-choice with no usable
partial model. The public pinned SheetJS 0.18.5 SSF formatter supplies supported
number displays; the reader does not call XLSX.read or recalculate formulas.

The retained initial nineteen owner controls pass. Fresh review finds three P2s:
the intake rejects the genuine nineteen-field canonical snapshot, a falsy release
failure can lose its shared cleanup error or fence, and the final usage callback
can invalidate ownership after the last check. The same five paths correct these
cases. Six focused regressions and the original failure replays pass. Independent
review then passes nine further controls with all sixty-four pins unchanged.
No broad nineteen-case or earlier model/SSF matrix is repeated.
Corrected five-file manifest:
`/tmp/browserpdf-spreadsheet-reader-corrected-20261019/freeze-manifest.json`, SHA-256
`ffe6a62b634d874fef34ee1bf01faa7c166c221469ee6fc9099b4015314f6064`.
Independent corrected review:
`/tmp/browserpdf-spreadsheet-reader-corrected-review-20261019.md`, SHA-256
`89a716a8665c3d696e9ee07cfdfa454305ed74e90d752c6900ba29e15c33a3eb`.

Root's actual Chromium 151.0.7922.34 gate passes two tests in 1932.557 ms. The
first uses the real public verified formatter and fourteen real raw-DEFLATE part
inflations on two independently authored workbooks. Both sheet names, Unicode,
leading zeros, spaces, uncalculated source formula/cache, the 1904 date, percent
and decimal displays agree with the independent input manifest. The unsafe 1900
serial-sixty workbook retains its raw source and reports a blocked date projection
without inventing a date. The UTF-8 BOM CSV preserves all nine literal cells,
including CRLF and formula-looking strings. FIRST disposal erases owned buffers
and releases declared usage while every independent source remains exact.

The second test holds the actual first File arrayBuffer result. Cancellation with
false leaves that promise and its 252-byte artifact charge live; queued B stays
unread until the held first operation drains. A never parses or publishes. B is
accepted through actual tool-ui documentSession adoption with the same task and
one revision/generation advance. Invalid UTF-8 C preserves B's model, source,
owner and original. A tiny D succeeds afterward. Each real File is read once,
the publisher owns its candidate before the intake releases its lease, and the
final FIRST disposers leave zero owned usage and a cleared canonical session.

Native report:
`/tmp/browserpdf-root-spreadsheet-native2-20261019/report.json`, SHA-256
`367109b7e479ee98cf0795dec2d33838c090acb85a5d109ee0c714c22c3bc801`.
Root independently rechecks the evidence and current source/input/harness bytes:
`/tmp/browserpdf-root-spreadsheet-native2-verification-20261019.json`, SHA-256
`11736e08c3621a9b82e266dd3ebfb92b79e9fa217becbc501af852c5a19e4965`,
651 checks pass. All 508 included source hashes/path inventory, twenty-two
generated fixtures and private harness files stay unchanged. No skipped/flaky
case, page error, excluded import or non-GET request occurs. Peak declared
resource use is 53181470 bytes and seventy-six groups in case one, and 147516
bytes and twenty-six groups in case two, inside the shared limits.

The fixed private HTML route does not prove production CSP or workspace UI.
These are controlled literal workbook and CSV cases, not a general spreadsheet
fidelity, native heap or physical-exit guarantee. The old independent long-sheet
corpus is unused here. This accepts the pure reader/intake checkpoint only.
Editable grids, spreadsheet print/export, PDF table extraction, service26/27
workspaces, full locales and all32 final acceptance remain open. No production
deployment occurs.
## PDF Doctor policy and lifetime foundation, 2026-10-19

Four new pure policy/lifetime/test/checkpoint paths add bounded diagnostic data,
least-lossy advice and owned public PDF.js job lifetimes. Recommendations do not
execute repairs. Rebuild admission requires failed strict and tolerant parsing
plus complete deep page-render evidence; encrypted input is directed to Unlock.
The shared 512 MiB retained, 96 MiB known resource and 128-entry limits remain.
No existing Doctor route, SDK or UI imports these helpers.

The initial retained owner seventy-two-case gate passes. Fresh independent review
then finds four P2 defects: page cleanup after successful task destruction can
create an impossible Retry, registered getter work can outlive page cleanup,
a usage callback can insert a native handle after result validation, and the
public timeout can await native work past the clarified sixty-second deadline.
The original five RED controls remain unchanged. The last finding is an
availability gap against Root's explicit deadline clarification, not an assertion
that the earlier contract unambiguously specified public settlement.

The corrected lifetime uses its tracked successful loadingTask.destroy FIRST as
context-teardown acknowledgement, without private PDF.js methods or repeated
destruction. Page getter/render FIRSTs drain before page cleanup. Validated owned
result trees freeze before later caller callbacks. Finite public inspection and
queue envelopes remain separate from actual native FIRSTs and retained leases.
Late native exit alone cannot clear a failed deadline fence or admit successors.
A genuine prior page-cleanup failure retains the same error; explicit Retry can
release only after the exact owned teardown acknowledgement, without reparsing.
Policy bytes remain unchanged.

The owner runs twenty-two new focused controls and eighteen directly affected
lifecycle controls, all passing, plus two syntax checks. Independent corrected
review passes six controls in 69.477416 ms: five copied probes and one new neighbor.
It verifies getter ordering, exact false cancellation, callback insertion refusal,
finite public timeout with held leases, late-exit fencing and conservative prior
cleanup failure/acknowledged Retry. These six controls include five corrected
original probes and one new neighbor. The owner's 22/18 and original 72-case
suites are not rerun by the reviewer.

Corrected four-file manifest:
`/tmp/browserpdf-doctor-first4-corrected-owner-20261019/corrected-four-manifest.json`,
SHA-256 `9ea9c9d3e472c9575261abf8d04735b3993e32bc627578dac099dd32469f6ebc`.
Independent corrected review:
`/tmp/browserpdf-doctor-first4-corrected-fresh-review-20261019/review.md`, SHA-256
`c5953fe7d48cb6a7f62f83dc5ed5e9beb271a78c0603d2e39cbc687d7296e4c4`.
All 189 before/after verification rows remain exact, including thirty-four
protected dependencies and the ordered 493-byte five-checkpoint aggregate.
Repeated evidence roles are verification rows, not a unique-file count.

This accepts the pure foundation only. Portable public-shaped facades and
installed API source inspection do not establish actual PDF.js native behavior,
physical worker exit or heap reclamation. Doctor v1/v2 core integration, SDK
schema/distribution, UI, loss disclosure, locales and Doctor/all32 final gates
remain open. No production deployment occurs.
