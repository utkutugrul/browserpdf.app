# Phase 4 platform, continuity and localization handoff

## Primary goal

A person can inspect, clean, protect or batch-process the current document, understand the available action and continue with the chosen result. Tool changes, file replacement and translated controls preserve the same task without reviving stale work.

This is the next coordination handoff for the existing full 32-service authorization. Read `02-browserpdf-service-improvements.md`, the current annotation/composition contracts and `03-conversion-engine-handoff.md`. Current implementation and independently verified HEAD must be supplied by the lead after the preceding checkpoints; this document does not claim Phase 4 is implemented or authorize overwriting work in progress.

## Ownership and operating rules

Use fresh documentation/implementation owners and explicit shared-file ownership. A shared-continuity/platform owner owns document handoff/session/result adapters, Metadata/Protect/Unlock and Privacy/Doctor integration. A separate workflow/localization owner owns the bounded recipe/queue UI and central copy migrations, requesting shared changes through the first owner. Confirm the actual partition before edits; source and shared cores may have changed during Phase 3. At most two workers, no nested agents, one allocated browser/globalSetup window at a time and frozen public/tests during every gate.

Root owns the durable `http://localhost:8788` server and `docs/service-improvements-independent-review.md`. Do not start/stop the server, modify that document, commit audit files, push main or deploy. Every shell command is `rtk` prefixed. Explicit final Download stays a download. Passwords never enter history, IndexedDB, analytics, WebMCP, logs or handoff metadata. Preserve local processing, CSP, SDK isolation and owned cache boundaries. No privacy/repair/signature certification claims.

Copy the verified typed name contract in `../docs/document-display-name-contract.md`. A preserved artifact carries authoritative `type` plus its bound `name`/`displayName` pair through every explicit descriptor/publication boundary; the bounded operational name may no longer contain its original extension. A deliberately renamed or converted output derives its own display label and declares its actual type. Do not add a metadata bag, expand export-name limits or infer an existing type from a truncated label.

## Phase 0 — Discover actual contracts and remaining gaps

**How this serves the primary goal:** recommendations and task transitions reflect the actual supported engines and ownership boundaries.

Fresh discovery reports sources read, exact public signatures, copy-ready locations and confidence/gaps before implementation. Read `docs/platform-architecture.md`, current checkpoint/contract documents and the primary 32-row ledger. Verify these current seams rather than assuming names:

- `public/js/core/privacy-scan.js`: `withPdfDocument`, `scanPdfPrivacy`, `summarizePrivacyReport`; `privacy-cleanup.js`: `cleanPdfPrivacy` and `SUPPORTED_PRIVACY_CLEANUP`. Standard document-info cleanup is the current supported scope. Raw findings remain local/collapsed and excluded from WebMCP summaries.
- `public/js/core/document-doctor.js`: `diagnosePdf`, `summarizeDoctorReport`; `document-doctor-output.js`: `normalizePdfStructure`, `rebuildPdfPageContent`. Diagnosis distinguishes strict/tolerant/error/unknown states. Normalize is reserialization; rebuild is explicitly lossy. Verify current aggregate native/encoded budgets before extending them.
- `public/js/edit-metadata.js`, `protect.js`, `unlock.js`: inspect current forms, `readPdfFile`, reviewed results, capability flags and actual encryption/decryption APIs. Protect uses pinned Cantoo pdf-lib; do not invent password or decryption APIs. Inspect original graph preservation and source/result output honestly.
- `public/js/core/workflow-manifest.js`: strict step schemas, `getWorkflowStep`, `getStarterRecipe`, `materializeRecipe`; `workflow-engine.js`: `executeWorkflow`; `batch-queue.js`: `LocalBatchQueue`, deterministic safe output naming. Existing queue admission is 20 PDFs/250 MiB with concurrency one. Preserve reservation, import epoch, Clear, cancellation, retry and successful-output behavior.
- `public/js/document-handoff.js`, `tool-ui.js`, `image-tool-entry.js` and current annotation entries: typed owned file descriptors, lazy helpers, initial intake guards and exact stale-write ownership. Derive imports from actual localized entry URLs; absolute `/js/tool-ui.js` observes a different module/session on localized routes.
- `public/js/core/workflow-store.js`: atomic `putWorkflowBundle(workflow,files,{isCurrent,signal})`, owned `getFiles`, expiry and exact scoped deletion. **The old blanket cleanup `getAll` concern is historical:** current cleanup uses workflow metadata, indexed keys and file key cursors, skipping live referenced file bytes. It reads unreferenced legacy/orphan records individually. Preserve that behavior; define any remaining global quota/legacy-orphan policy precisely instead of reimplementing the fixed issue.
- `public/js/i18n.js`, `scripts/update-phase*-translations.py`, `scripts/update-phase1-public-html.py`, locale dictionaries and current route/JSON-LD tests: discover the complete language set and actual migration semantics. Keep retryable feature loading and idle delivery below 100,000 JavaScript bytes/sixteen requests.

The remaining initial-handoff READ race has runtime proof: `/tmp/browserpdf-root-initial-handoff-prefix-first/report.json`. A native destination workflow read is held; the user selects a fully ready new two-page B; releasing the old read restores old A's task and exact one-page artifact. This is distinct from the stale handoff WRITEs already fixed and verified in `1184fc6`. Keep those write guards and newer same-task bundle protections intact. No unconditional task-ID cleanup may delete a newer owned bundle.

The scoped annotation dependency now has accepted Privacy intake evidence in `../docs/privacy-intake-contract.md`: Root's chosen Redact → Privacy checks exact bytes, while the native initial-read B and Clear variations retain the intended task/report and save actual two-page B cleanup outputs. This is not the richer Phase 4 inspection/action implementation or a blanket repair of older adapters. Root's current read-only inventory still identifies unguarded callbacks in `object-route`, `page-route`, `page-effects-route`, `view-pdf`, `merge`, `edit-metadata`, `protect`, `unlock`, `compress`, `ocr-pdf`, `extract-text`, `pdf-to-word` and `pdf-to-excel`. Recheck after Phase 3: its rewritten conversion/OCR/compression entries must start guarded, and the comprehensive pass must include shared object/page/effect routes plus Merge's `readPdfFile` mutation before `addFiles`.

Unsaved visible edits invalidate old review/download/result-rail publication immediately, not only workspace mode buttons. Native jobs and delayed store callbacks must lose ownership after the new intent. Resume/retry/history may rebuild a rail only for the exact chosen current copy when no incompatible local draft exists; do not resurrect an old result merely because its task ID still matches.

## Phase 1 — Complete transactional continuity and inspection actions

**How this serves the primary goal:** inspection and cleanup use the current chosen copy and cannot replace a later user choice with an older import.

Repair initial chained-input consumption across every remaining route through an explicit caller-intent contract, including after module, workflow/file read and candidate validation awaits. A new native file choice/Clear invalidates the initial intent immediately, while a rejected candidate retains the previous good task and usable draft. Use the guarded image/annotation entry patterns; check the actual helper's mutation boundaries. Preserve lazy empty-route guards, storage failure retry and localized namespace ownership.

Privacy Scan presents what was found, where it was found, what supported action is available and what remains unknown. A page-oriented finding can open the current copy at the affected page without following untrusted document URLs. Clean only the promised supported categories; show actual source/result and before/after findings. Explicit Use chooses the verified cleaned copy; Continue passes that copy, including a chosen redacted result, rather than rebaking an older scene source. Do not imply standard metadata cleanup removes XMP, attachments or arbitrary hidden content unless a new bounded transform and saved-artifact proof are deliberately added.

Doctor gives a plain problem/remedy explanation, affected-page inspection and the least-lossy supported recommendation. Normalize and raster rebuild have distinct losses and actual selected-page source/result review. The user explicitly imports a chosen verified result. Preserve original/history, error/unknown inspection states, native cancellation and meaningful image/structure limits. Metadata provides original/current before-and-after fields, controlled standard cleanup and a useful Privacy continuation; it does not invent comprehensive sanitization.

Verify native current PDF → Privacy → Metadata cleanup → Doctor → editor, and chosen Redact → Privacy with exact artifact SHA and no secret-source rebake. Verify affected-page selection, actual saved metadata/bytes, retained original, Cancel/Clear/storage retry and invalid replacement. Replay the confirmed native held initial-read prefix positively on every shared pattern and representative old/new localized routes: fully ready B remains exact, no navigation, then a fresh native edit and actual two-page B download work. Include older writes, same-task newer bundle, expiry and owned-storage isolation regressions.

## Phase 2 — Protection and honest return intent

**How this serves the primary goal:** password protection has a clear task end, and unlocking returns the person to the operation they intended to perform.

Protect adds visible show/hide controls, clear credential feedback and actual encrypted-result review without storing a password. An encrypted artifact offers only compatible actions. If a requested mode requires decryption, preserve a finite allowlisted non-secret return intent, lead through Unlock and return to that mode with the chosen decrypted bytes. This is a proposed contract until discovery locks its actual schema and ownership; never use a generic metadata bag or arbitrary navigation URL.

Verify actual encrypted output rejects no/wrong password and opens with the right one; after decryption set `encrypted:false` deliberately. Test what survives for forms, bookmarks, attachments, page geometry and tags, and explain unverified or lossy graph boundaries instead of claiming complete preservation. Any rewrite can invalidate a digital signature. Keep electronic image signing separate from certificate claims. After the new structure-preserving Compress route is actually accepted, revisit the old capability filter that excluded searchable/form PDFs because the previous compressor rasterized them; do not remove the guard before that safe path exists.

Verify current edit → Protect → incompatible target → Unlock → original intended mode using one task and actual final artifacts. Confirm passwords are absent from persisted workflow/session transfers, reports, WebMCP and network requests. Keep supported encryption-library pins and SDK peers unchanged.

## Phase 3 — Bounded workflows built from shared step cores

**How this serves the primary goal:** a person can apply a small understandable sequence to the current document and review the chosen output before continuing.

Import the current chosen PDF into the existing bounded queue. Add selected output/report review, complete named outputs/ZIP and explicit chosen-result continuation, keeping existing explicit queue downloads. Add finite step composition only for supported manifest definitions, with strict parameters, declared input/output capabilities and explicit maximum steps/retained bytes locked before implementation. Encryption is terminal unless a supported in-memory decryption step is deliberately defined; persisted recipes never retain a password.

Replace duplicate workflow implementations with the verified shared operation cores where supported. The current engine still has an independent ASCII-filtered watermark, page-number/page-copy logic and raster compressor; adding a recipe UI over those stale algorithms would not complete this requirement. Reuse the accepted Unicode/rotation/page-selection/effect/compression cores and their actual loss/capability policies. Preserve stable IDs or provide a bounded migration for stored recipes; do not evaluate arbitrary code or invoke arbitrary tool names.

Verify edited recipe parameters and actual PDF content, page selection/order, Unicode watermark/number geometry and safe compression facts. Test current import, selected output review/continue, multi-output naming, 20-file/250-MiB reservations, concurrency one, cancellation during each owned native phase, Clear/import races, retry retaining successes, storage quota/error recovery and expiry. Reopen final artifacts rather than checking only queue statuses. Reports remain bounded and WebMCP metadata-only.

## Phase 4 — Complete copy, locales and final user flows

**How this serves the primary goal:** every supported language describes the actual operation, state, limits and next action consistently.

Migrate all language dictionaries centrally and idempotently, including old keys as well as new ones. Old font labels, Add-and-download instructions, signing/help text, FAQ and JSON-LD can overwrite the new apply/review semantics on non-English routes. Correct quota-versus-resource-limit copy (for example Watermark's old unlimited-service wording), empty-ready versus pending-edit states, actual font choices, crop-versus-removal claims, supported script limitations, lossy boundaries, source/current identity and explicit Use/Download actions. Do not translate a false claim consistently.

Root's current verified search needles include Turkish `add-text.about_2_body` and `add-text.faq_2_a` (old Helvetica/Times/Courier and skipped-character promises), old `*.btn_apply` strings promising automatic download, `add-image.preview_title`/`about_1_body`, `page-numbers.preview_first`/`about_1_body` and `watermark.about_1_body`/`faq_2_a` (first-page/Helvetica claims). Redact FAQ/JSON-LD must describe explicit unsafe form/link whole-document raster boundaries; Redact/Watermark JSON-LD `featureList` must distinguish service quotas from finite resource limits. Recheck these across all 21 translated dictionaries plus English when the final operations are stable; these are discovery findings, not completed migration evidence.

Semantic checks include Turkish and the full dictionary set, not just key existence. Verify all retained URLs, localized same-task native handoff and 320/390/768/1440 light/dark/RTL surfaces with full accessible filenames and useful initial PDF visibility. Keep locale and public-HTML migrations' `--check` idempotence, request/byte budgets, normal CSP/no-store, WebMCP exclusions and owned offline cache behavior. The SDK is private/pinned; if shared copied cores change, run deterministic build/dist/type/unit/consumer checks and inspect its public boundaries rather than introducing GUI or site-shell dependencies.

## Phase 5 — Reconcile all 32 and deliver verified changes

**How this serves the primary goal:** the final result is a proven complete task across the audited services, not a collection of improved links.

Run fresh verification, code-quality and antipattern review after coherent checkpoints, then the appropriate full Playwright/SDK/migration/route release gate on frozen source. Preserve failed prefixes and report exact aggregate versus single-run evidence honestly. Reconcile every primary ledger row against its service-specific UI and saved-artifact/report acceptance, including earlier object, page, annotation, image and conversion work. No row closes merely because Continue exists.

Commit/sync only verified allowlisted paths through a fresh agent, with a description-only message and no attribution; preserve the audit directory and unrelated changes. Report exact commits, tests, branch status and material limitations. Continue until the full user-authorized scope is complete; this handoff and any intermediate checkpoint are not overall completion.
