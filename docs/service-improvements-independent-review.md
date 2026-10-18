# Independent acceptance review — 32-service improvements

Primary goal: a user opens a document once, performs compatible operations without losing changes, reviews the current output, and exports a faithful result. Baseline `ab0a4f6`; authorized scope is the 2026-10-18 32-service audit. This is a verification ledger, not a claim of completed implementation.

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
