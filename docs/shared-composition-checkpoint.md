# Shared composition and handoff checkpoint

This work starts from verified `917f92ee6aa209c7dae2511dcf12d1aa8810b452`.
It extends the shared contract used by the separate composer implementation;
it does not complete Highlight, Redact, Phase 2, localization or the full
32-service program. No commit/push or server lifecycle action was performed by
this implementing owner. The root-owned audit directory and independent-review
document were preserved.

## Implemented shared files and APIs

`core/composition-state.js` validates finite descriptors, image headers and
resource references. `core/document-session.js` owns canonical composition,
task-lifetime immutable originals, transactional admission, selection and
bounded history. Exact caller examples and signatures are in
`composition-session-contract.md`.

`tool-ui.js` exposes those methods through the existing lazy session delegate;
`document-handoff.js` serializes/restores composition and source groups in the
existing owned task; `core/workflow-store.js` retains atomic, scoped storage
with 160 references/512 MiB and optional transaction ownership guards.
`document-workspace-support.js` lazily renders composition and restores
composition history through a compatible image mode. Object, page-task and
page-effect history callers use that helper. The Reader caller passes guarded
handoff ownership without changing its viewport/navigation behavior.

`core/object-scene.js` preserves the existing normalization API while adding
optional AbortSignal checks and bitmap/canvas cleanup. `document-result.js`
compares every immutable original through one bounded canvas and shares the
composer image-work lane when supplied; chosen image results use the same
bounded preview path. Clear zeroes retained result canvases, and stale native
decode completion closes its bitmap without repopulating the view.

New shared tests are `composition-state.unit.mjs`, `document-handoff.unit.mjs`,
`document-handoff.spec.mjs` and `composition-review.spec.mjs`. Composer files,
their tests and the migrated image smoke belong to the sibling owner.

## Bounds and deliberately retained state

The task retains at most 48 unique original images, including removed items,
until Clear or deliberate new-task intake. It retains at most 48 normalized
composition assets across active/history/future state. Raw and normalized
image buckets are each 48 MiB; **all** PDF/image resources jointly share
96 MiB and 128 references. Session/history/store ceilings remain unchanged.
Admission rejects without silently evicting history to fit new resources.
Ordinary five-entry/64-MiB history pruning remains explicit.

Raw source groups survive generic adoption and history pruning. Item labels
preserve distinct selected filenames even when bytes deduplicate; item/group
names are bounded to 260 UTF-16 characters and artifact names keep their
existing 160-character limit. No lifetime alias-name list is retained.

`beginComposition` deliberately starts a fresh task. The distinct
`startCompositionFromCurrent` method bootstraps a chosen image while preserving
its original PDF, task ID and prior history. Its input must match the exact
chosen current image. Generic adoption archives active composition even for
byte-identical PDFs. Explicit composition Use retains editable state.

Scene checkpoints alias their already-owned source **before** joint validation.
This avoids charging/copying a 75-MiB source five times during inherited restore.
Missing references and resource/session overflows still reject transactionally.

## Separate held-handoff ownership correction

The root reproduced two existing native IndexedDB races: stale cleanup could
adopt old A into new B, and stale bundle completion could navigate back to A.
Ownership is now checked across lazy-module/store loading, expiry cleanup,
transaction writes and completion. All navigation callers check the returned
guard. Stale completion never deletes a task ID, because that could erase a
newer explicit bundle under the same task.

Initial frozen portable gate:

```sh
rtk proxy env BASE_URL=http://localhost:8788 PLAYWRIGHT_JSON_OUTPUT_NAME=/tmp/browserpdf-shared-composition-handoff-first10-20261019.json npx playwright test tests/document-handoff.spec.mjs tests/lazy-workspace-support.spec.mjs tests/object-shell.spec.mjs tests/phase9.spec.mjs --grep 'held native IDB|held old native bundle|canceled explicit continuation|lazy workspace|owned handoff import|rapid image intakes|result review begins|requested initial first-party' --workers=1 --retries=0 --output=/tmp/browserpdf-shared-composition-handoff-first10-20261019 --reporter=line,json
# 7 passed / 3 failed; 68,516.351 ms; no skipped/flaky/top-level errors.
```

Two failures observed a detached old button instead of actual handler completion;
the third edited an unselected draft instead of its existing object. Test-only
migration observes the native async click handler's returned promise and
explicitly selects the existing object through its native control. Every B-task,
current/original, URL, stored-byte and actual fresh/reopened PDF assertion stays.

```sh
rtk proxy env BASE_URL=http://localhost:8788 PLAYWRIGHT_JSON_OUTPUT_NAME=/tmp/browserpdf-shared-handoff-migrated3-20261019.json npx playwright test tests/document-handoff.spec.mjs --grep 'held native IDB|held old native bundle' --workers=1 --retries=0 --output=/tmp/browserpdf-shared-handoff-migrated3-20261019 --reporter=line,json
# 3 passed; 14,770.302 ms; zero unexpected/skipped/flaky/top-level errors.
```

All ten unique cases have aggregate passing evidence; this is not one clean
ten-case run. Root independently passed both native replacement races with
fresh actual two-page B artifacts in
`/tmp/browserpdf-root-held-handoff-postfix-first/report.json`.

The current core gate passes **21/21**:

```sh
rtk proxy node --test tests/composition-state.unit.mjs tests/document-handoff.unit.mjs tests/reader-text.unit.mjs
```

It includes precise combined-resource rejection below the image-count ceiling,
incremental admission stopping before later inputs are read, held hash rollback,
same-byte boundaries, source-group retention, selected-image bootstrap,
empty-composition history/storage rollback and an independently generated valid
75-MiB PDF with five scene-history entries.

Root's separate actual-source postfix evidence is
`/tmp/browserpdf-root-scene-history-alias-postfix-first/report.json`: one valid
78,644,170-byte PDF, five same-source checkpoints, exact restored current,
original, scene, history and resource fingerprints, retained bytes unchanged at
235,932,510. The joint resource rejection postfix is independently recorded at
`/tmp/browserpdf-root-composition-resource-postfix-first/report.json`.

The final frozen fifteen-case shared browser gate covers source comparison,
held-decoder Clear, chosen-PDF/editor/Undo continuation, external intake
ownership, the four handoff cases, lazy recovery, actual image/object handoffs,
the real large inherited Reader handoff and unchanged idle-load bounds:

```sh
rtk proxy env BASE_URL=http://localhost:8788 PLAYWRIGHT_JSON_OUTPUT_NAME=/tmp/browserpdf-shared-composition-final15-first-20261019.json npx playwright test tests/composition-review.spec.mjs tests/document-handoff.spec.mjs tests/lazy-workspace-support.spec.mjs tests/object-shell.spec.mjs tests/reader-workspace.spec.mjs tests/phase9.spec.mjs --grep 'composition review|Clear during held original|composition PDF Use|operation-aware PDF|held native IDB|held old native bundle|canceled explicit continuation|lazy workspace|owned handoff import|rapid image intakes|result review begins|owned inherited scene larger|requested initial first-party' --workers=1 --retries=0 --output=/tmp/browserpdf-shared-composition-final15-first-20261019 --reporter=line,json
# 15 passed; 31,833.181 ms; zero unexpected/skipped/flaky/top-level errors.
```

All public/test sources stayed frozen through each allocated invocation; the
browser closed after each run. The final gate includes actual downloaded PDFs,
exact source pixels/bounds, native held-handler completion, immutable current
and source checks, and actual editable composition after a PDF-mode Undo.
Sibling composer browser acceptance, independent continuation checks and fresh
quality/anti-pattern review remain gates. No verified commit or full service
completion is claimed here.

One resource seam was identified read-only during this final run:
`createOutputGroup` did not forward the runtime `imageWorkLane` to result review.
Thus its fallback image decoder could outlive the PDF-image adapter's own drain
before a successor composer starts. The coordinator assigned the narrow optional
forwarding plus adapter propagation and a held selected-result decode/successor
normalization artifact regression to the composer owner **after** this run.
That follow-up is not covered by the fifteen-case result and must be verified
before the composer checkpoint is accepted. No duplicate group-file edit was
made by this owner.

## Immediate next annotation owner

Highlight and Redact remain unimplemented. No unfinished annotation module is
included in public source. Two unused, unintegrated preflight drafts were moved
to `/tmp/browserpdf-annotations-preflight-20261019/`:

- `highlight-annotations.js`, SHA-256
  `588b95563d79935f0ea1609917997a37f389b2b5858a72629a33bbd9a9038eb8`
- `highlight-selection.js`, SHA-256
  `67fc215b30fc517ccfd7aaeb845252126d98316420ab3bbdc634f7cda6cd886c`

They contain a finite quad writer/selection proposal only, not route acceptance.
Read the annotation handoff and pinned library declarations again before
integration. Preserve the Reader logical viewport and native selection behavior.
Root independently confirmed the held named-destination race at
`/tmp/browserpdf-root-reader-navigation-prefix-first/report.json`: newer page 2
loses to obsolete page 3 after resolution. Unify navigation ownership and prove
the actual rendered page during Highlight integration.

Redact requires strict safe primitive/font reconstruction in fresh pages without
page copying, explicit whole-document raster fallback for unknown/interactive
graphs, and inspection of every indirect stream/PageLeaf/Info/XMP secret. Root's
plain/form/link and four-rotation/CropBox/UserUnit corpora are independent
comparison evidence. Portable tests must generate their own inputs. Complete
all later conversion/platform/localization phases and all 32 ledger rows.
