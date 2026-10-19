# Structural Compress route checkpoint

Status: structural Compress route accepted by Root's focused native gates,
independent saved-artifact continuation check and fresh source review below.
Known searchable and form PDF admission is accepted by its separate two-case
gate below. Raster compression, complete translations, OCR, either Excel
service and the full 32-service program remain open.

## Ownership and accepted dependency

Implementation follows `/tmp/browserpdf-compress-route-contract-20261019.md`
and Root's explicit release of `tool-ui.js` and `document-result.js` after
continuity commit `e8a3e92fdd0d46ee0fd479486ffd3f2e6fc2d45b`.

Owned paths are `public/js/compress.js`, `compress-intake.js`,
`compress-workspace.js`, `public/css/compress-workspace.css`,
`public/compress.html`, `tests/compress-intake.unit.mjs`,
`tests/compress-workspace.spec.mjs`, this document, and the two shared cleanup
helpers plus their `tests/document-result-lifecycle.spec.mjs` proof.
No loader pins, dependencies, fonts, session schema, capability admission,
global styles, dictionaries, legacy smoke rows or other service source changed.

The accepted pure compression dependency remains frozen:

| Path | SHA-256 |
| --- | --- |
| `public/js/core/pdf-compression.js` | `11d4442bc3dd6f933cf65ac4e7107784e86989d84c690ad53845075ab668a5d6` |
| `tests/pdf-compression.unit.mjs` | `617f626a22dece0a9a198829cfd11d5f3a25a99d8ee37fb3e47ed4896f2187b8` |
| `docs/compression-core-checkpoint.md` | `c2c594a64070e5ba7bd1f35ad2ce894ba2fd6116714e63bd0178d55185d06883` |

Historical accepted evidence remains owner 16/16, fresh corrected core review
at `/tmp/browserpdf-compression-core-corrected-review-20261019.md` and Root's
independent actual 69,950 to 3,753-byte artifact verification at
`/tmp/browserpdf-root-compression-core-corrected-first/report.json`.
These are pure-core evidence, not route delivery evidence.

## Route behavior and limits

The entry statically loads only the shared shell and localization. File intent
loads strict intake, the serial native lane and pinned runtime loader. Accepted
task intent loads the workspace, its scoped stylesheet and the accepted core.
Failed optional imports and stylesheet requests can be retried.

Native input admission is nonempty PDF data up to 80 MiB and 250 pages. Metadata
and actual bytes are checked separately before strict pdf-lib and PDF.js
validation. pdf-lib receives `ignoreEncryption:false`,
`throwOnInvalidObject:true`, `updateMetadata:false`. PDF.js receives the pinned
asset options, `stopAtErrors:true` and `enableXfa:false`. Both parsers must agree
on page count. Staging does not call `getForm`, serialize or adopt. Every PDF.js
task must destroy before synchronous transactional session begin. Returned owner
identity comes from that exact begin result.

Initial workflow consumption captures local intent and canonical task identity
before its first await. Any native B, including a rejected B, invalidates that
initial intent. Candidate validation has one active native reservation and one
latest pending descriptor. Superseded pending files are never read. An accepted
A has a separate construction lifetime: optional A module loading cannot block
B validation, and rejected B retains A's task and usable surface. A successful
replacement or Clear disposes A. Native success removes workflow URL parameters;
rejection retains them; Clear removes them immediately.

Actual guarded inherited tasks above 80 MiB through 250 MiB, or above 250 pages
through 10,000 pages, restore in read-only state. The optimizer is unavailable.
The UI exposes an explicit guarded current-PDF Reader continuation and explicit
current-file download. An inherited locked task requires a public password /
encryption signal and has Unlock as its processing continuation. Native
oversized, invalid or locked replacements leave the previous task unchanged.

The source preview is the exact `getWorkspaceInput` result, including pending
scene/composition edits. A baked artifact above the compression byte limit
becomes read-only without replacing the canonical editable task. Source page
rendering uses a temporary canvas with at most 900-pixel edges and one million
pixels; a successful owned render is copied to the visible canvas, then the
temporary is zeroed and its parser destroyed. Only the latest requested page
waits behind an active render.

Optimize calls the accepted core with injected pinned engines, pinned PDF.js
assets, a native canvas factory, owned cancellation, typed capabilities and
owned progress. Its unchanged object, stream, graph, text, annotation, page and
paired-render budgets apply. There is no raster or reserialization fallback.

The shared result host remains hidden until an actual completed result page
exists. A failed first preview exposes no Download or Use. Retry reuses the
verified candidate without recompression. Shared Use alone adopts; its actual
returned owner rebases the workspace. The continuation rail is created only
after Use and a successful owned preview. Cancel does not undo Use. Final
download requires the shared native Download action. Source and result have
independent numbered page controls; paging is not represented as synchronized.

Reduced results receive a bounded `-optimized.pdf` name and matching display
label, reserving suffix space without cutting a surrogate. A no-op retains the
exact input bytes and bound name pair, with an explicit no-reduction state.
Known searchability/forms/rasterized facts are retained. Only a rewritten
candidate carries the signature-rewrite warning; genuinely unchanged input
keeps its existing boundary. Pending edit baking is separately identified with
the existing scene/composition loss codes. No signature validity claim is made.

## Shared cleanup contract

`tool-ui.clearResultAndDrain(): Promise<void>` invalidates the result, rail and
group synchronously and captures already-started single/group review work.
When the result module is already loaded it immediately calls
`document-result.clearDocumentResultAndDrain(): Promise<void>`. A held module
import has no native generation yet; its old guarded callback cannot start a
preview after invalidation. The helper waits for its captured review work to
settle, then reports native cleanup failure. It never clears a later native
generation after an old import resolves.

The native module tracks initial loads, event-driven PDF/image loads, render
promises, active tasks and retiring task destruction by preview generation.
Clear captures and invalidates those records before awaiting. It cancels
renders, hides the panel and zeroes its visible canvases immediately. Already
started image bitmap work, including an external image work lane, drains via
its owned promises. The drain never awaits an external lane tail and never
waits from inside that same lane, avoiding reentrant queue deadlock.

Ordinary preview/import/render failure and expected cancellation settle without
becoming a permanent native cleanup blocker. A failed native destroy retains
its task and failure fence. Concurrent explicit drains share that exact cleanup
attempt and rejection. A later explicit drain retries actual native destruction;
the task is removed only when destruction succeeds. Old void clear calls remain
synchronous and safely handle ignored cleanup promises. Source/intake cleanup
failures likewise retain native tasks and are reported before successor native
work; a following owned retry must successfully destroy those resources.

Settled old records prune only after work, cleanup and native tasks are empty
and there are no retained cleanup failures. Current records remain available
for native events. Detached old event handlers return before touching the
current task, so a pruned generation cannot register new native work.

## Evidence and pending gates

Portable strict-intake gate: **13/13 PASS**, 352.875209 ms, zero failed,
cancelled, skipped or todo, at
`/tmp/browserpdf-compress-intake-stable13-20261019.tap`.

The gate uses the installed pdf-lib, pinned PDF.js and actual session public
APIs for ordinary intake, malformed rejection, 251-page native/inherited
boundaries, inherited original/history/names/capabilities, held read/parser/
destroy cancellation, failed cleanup, obsolete failed cleanup, latest pending
descriptor and successful successors. The 81-MiB case explicitly uses a
controlled public parser seam to isolate actual byte-budget admission; it is
not native large-PDF parsing evidence. Initial 10/12 failure evidence is retained
at `/tmp/browserpdf-compress-intake-first-20261019.json`: test descriptors used
raw `session.transfer()` instead of the real handoff's top-level typed-current
fields. Correcting those descriptors yielded the prior 12/12 gate at
`/tmp/browserpdf-compress-intake-corrected-20261019.tap`. An additional obsolete
cleanup-failure regression and its resource fence produced the stable 13-case
gate above. No assertion or production admission was weakened.

Authored native specs have syntax checks only; no browser was run:

* `tests/compress-workspace.spec.mjs`: actual saved structural reduction and
  reopened forms/check/URI/text, matching native source/result pixels,
  no automatic download, explicit Use and same-task Reader continuation,
  no-op/second-pass byte identity and names, invalid B recovery, actual completed
  initial READ losing to B before old File read, held native stream cancellation,
  failed first result preview and retry without recompression, inherited
  251-page read-only Reader continuation, 320/390/768/1440 layouts and RTL.
* `tests/document-result-lifecycle.spec.mjs`: held result module, actual PDF.js
  load, retiring destroy, actual render, ordinary page failure, external-lane
  native bitmap closure, concurrent cleanup rejection/retry/successor, and
  repeated native result selections. Its retention observer is injected only
  into the private test module response; no production debug API was added.

A static source-graph calculation gives Compress 52,710 first-party JS bytes
and Privacy 99,885 bytes. This is explicitly **not native request-graph proof**.
The strict less-than-100,000-byte and at-most-16-request gates are unchanged.
Root's allocated actual idle gate must determine acceptance; the narrow Privacy
margin must not be treated as future growth allowance.

Pending acceptance includes fresh source review, the shared native lifecycle
suite, Compress native saved artifacts/lifecycle/layout, actual unchanged idle
gate, a native 80–250-MiB inherited read-only artifact gate and Root independent
inspection. Root will separately coordinate the safe Compress capability
change and the eventual Compress-only legacy smoke migration. Raster mode, OCR,
both Excel services, P4, all 22 locales and the final all-32 gates remain open.

No server, global setup, shared fixture writer, deployment or commit was started
by this owner. The allocated diagnostic browser described below is closed.
Corrected native specs remain unrun. Root ledger and the 40 audit files remain
outside this owner's edits.

## First native gate and narrow corrections

Root's first gate closed with **24 PASS / 2 FAIL**, 28,066.671 ms, zero skips,
flaky results or top-level errors. All 278 source/test hashes, fixture hashes and
configuration remained exact. Preserve
`/tmp/browserpdf-compress-route-native-first-20261019-results.json`, its adjacent
`final.json`, all 26 traces and actual output artifacts. This first gate is
historical evidence; the corrections below require an allocated follow-up gate.

The first failure compared input/result canvas PNGs before download or Use.
Both were 695 by 900 pixels. Independent extraction by Root and this owner
found exactly 2,659 differing RGB pixels, 7,977 channels, maximum channel
difference 83, with identical alpha, confined to heading/form text. No pixel
assertion or threshold was changed.

Root allocated a single diagnostic browser on unchanged sources, pinned
Chromium 151.0.7922.34, reusing an existing first-pass artifact without fixture
generation or global setup. Its report is
`/tmp/browserpdf-compress-owner-canvas-diagnostic-20261019/report.json`, with
trace and seven native PNGs adjacent. Own eleven plus accepted three hashes
remained exact, no page error occurred, and the browser closed before edits.
The source/result viewport dimensions, scale and transform were bit identical;
the document fonts were loaded before and after every render.

Rendering the same actual PDF page detached versus attached reproduced the
original 2,659/7,977/max-83 difference exactly. The attached canvas inherits
`-webkit-font-smoothing:antialiased` from the page body. Overriding only that
attached canvas to `auto` produced zero differing RGBA bytes against the
detached render. Copying the detached canvas into an attached canvas likewise
produced zero differences. Matched opaque/read-frequently contexts still
reproduced the original difference when attached font smoothing differed.
This isolates inherited font smoothing as the cause. The correction sets
`-webkit-font-smoothing:auto` only on Compress workspace canvases; the strict
source/result PNG comparison stays unchanged. Viewports, engine rendering
arguments and the accepted compression core remain unchanged.

The second failure read a retained record count of two during result selection.
The preserved trace's `after@call@345` still shows a canvas labeled
`choice-one.pdf` after `choice-two.pdf` was clicked at `call@341`; the count was
read at `call@347`. Its readiness helper had observed the previous canvas
before the actual new selection handler completed. A private test-only
delegation wrapper now captures the real `selectArtifact` returned promise.
The test awaits that complete selection, then checks the actual chosen canvas
identity before the unchanged at-most-one retained record, one active task,
maximum-one task and zero-after-drain assertions. No arbitrary delay or relaxed
retention bound was introduced.

The fresh review at
`/tmp/browserpdf-compress-route-fresh-review-20261019.md` also identified two
source defects. A PDF/image event could bypass a failed retiring destroy when
global `activeTask` had already been cleared. The corrected cleanup-only
barrier captures retained native tasks up to the calling preview generation,
including older failed records when a new review has no active task. It retries
actual failed native destruction before any next PDF load or image decode.
Concurrent event retries share the same native attempt. It never waits for
`record.work`, its own event promise, a lane tail or later-generation work.
Thus successful actual destruction can release a new preview while an old,
invalidated wrapper-load promise remains held. New native controls cover
same-record PDF events, a PDF-to-image event followed by PDF success, and a
new-review generation after event destruction failure, all with actual native
creation/destruction counters and a successful successor.

Inherited empty-user-password encryption required an additional precise public
API check. The first bounded synthetic Cantoo attempt used object streams and
ordinary strict pdf-lib rejected an encrypted object before encryption
classification. The retained prefix is
`/tmp/browserpdf-compress-empty-user-diagnostic-20261019/first-object-stream-empty-user.pdf`
with its first generator script at
`/tmp/browserpdf-compress-empty-user-diagnostic-first-script-20261019.mjs`.
This unsupported strict parse is not admitted or relaxed.

The second attempt used the documented `useObjectStreams:false` save option
and produced a 1,236-byte encrypted classic PDF. It exposed that pinned
pdf-lib 1.17.1's ES5 `EncryptedPDFError` returns an ordinary Error: its name and
constructor are `Error`, and `instanceof EncryptedPDFError` is false. The public
error source and actual behavior are retained in
`/tmp/browserpdf-compress-empty-user-diagnostic-20261019/public-api-proof.json`.
No production message/name matching was added.

After an inherited-only strict `ignoreEncryption:false` rejection, the owned
fallback now performs public strict load with `ignoreEncryption:true`,
`throwOnInvalidObject:true`, `updateMetadata:false`, and requires actual
`doc.isEncrypted === true`. If the probe rejects or is not encrypted, the
original rejection is retained. Every await checks signal and exact owner.
Independent PDF.js must still provide a finite readable page count or genuine
PasswordException. A successfully opened empty-user-password PDF remains
encrypted and read-only; it cannot reach optimization. Native replacements
never enter this fallback and remain transactional rejections. There is no
decrypt/save step, password persistence or production encryption-engine change.

The bounded fixture used ordinary pdf-lib to create its simple source, then the
existing integrity-verified Cantoo 2.7.4 public load/encrypt/save APIs, with a
generated owner credential kept only in process memory. Input and output stayed
below one MiB, and all output stayed
under the owner's `/tmp` diagnostic directory. No graph-preservation claim is
made for its writer. Corrected actual intake proof at
`/tmp/browserpdf-compress-empty-user-diagnostic-20261019/corrected-intake-proof.json`
records native rejection with A retained, inherited locked/read-only state,
finite one-page load, exact chosen/original bytes, exact task/history, and one
created/one destroyed PDF.js task. A portable browser regression creates its
own bounded encrypted control in memory using the existing pinned public
runtime, then exercises native rejection and actual guarded inherited intake.

Corrected portable intake gate: **15/15 PASS**, 350.723333 ms, zero failed,
cancelled, skipped or todo, at
`/tmp/browserpdf-compress-intake-corrected15-20261019.tap`. Added controls cover
malformed inherited unencrypted input, an unencrypted fallback probe preserving
the original error, positive successors, and ownership change during a held
fallback parse. Previous 13-case and first fixture failure evidence remain
retained.

Proposed follow-up native gate is 20 cases: the failed Compress actual-artifact
case and new actual empty-user encrypted case; all eleven shared lifecycle
cases, including the corrected selection observer and three event/successor
controls; the four affected result foundation cases from the first gate; the
selected-image decoder/drain consumer; and the existing idle plus Compress
idle cases. Root owns allocation, invocation, source freeze and independent
inspection. No corrected browser test has been invoked by this owner.

## Independent Letter preview correction

Root subsequently closed that corrected gate with **20/20 PASS**,
16,774.643 ms, zero skips, flaky results or top-level errors. The 283 source/test
hashes, path set, configuration, private idle test and generated fixture hashes
remained exact; twenty traces are retained with
`/tmp/browserpdf-compress-route-native-corrected20-20261019-results.json` and its
matching `final.json`. Fresh corrected source review passed. This evidence
precedes the additional viewport correction below.

Root's independent 69,950-byte Letter corpus then exposed a distinct preview
failure, retained at
`/tmp/browserpdf-root-compress-native-independent-first-20261019/report.json`.
The source canvas was 695 by 899; the result canvas was 695 by 900. The actual
MediaBox and CropBox are 612 by 792. Source rendering used the shared bounded
viewport calculation starting at scale 1.5, while result rendering duplicated
the algebra starting at scale 1. In JavaScript the source scale was
`1.1363636363636362`, yielding height `899.9999999999999`; the result scale was
`1.1363636363636365`, yielding height `900.0000000000001`. Their unchanged integer
floors therefore differed. This is separate from the proven font-smoothing
correction; the prior 560-by-725 portable case did not expose this association.

Root's separate classifier preserved the strict PNG mismatch as an issue while
continuing through explicit download, Use and native Reader. Its retained
report is
`/tmp/browserpdf-root-compress-native-independent-classifier-first-20261019/report.json`.
The actual saved output was 3,753 bytes, SHA-256
`1c08689128a8a3ee1d718c4eb9e9055e3e7cc9d283b6d6b5a089a8f01f02171f`,
exactly matching Root's independently inspected graph/stream/text/pixel/form/URI
artifact. Use and Reader retained the same task, original and chosen current.
There were zero page errors, zero non-GET requests and one manual download;
all 283 source/test hashes and the independent corpus remained exact. The
classifier's overall pass remains false because the preview mismatch remained.
Both independent failure prefixes are immutable historical evidence.

The narrow correction imports existing public `boundedViewport` only into lazy
`document-result.js` and derives its PDF viewport with
`{scale:1.5,maxDimension:900,maxPixels:4000000}`. Source rendering continues to
use its existing one-million-pixel budget; result rendering retains its
four-million-pixel budget. The common 900-pixel edge dominates both. Existing
integer floors, cancellation, canvas contexts, scoped font smoothing and native
task ownership remain unchanged. Neither `core/bounded-renderer.js` nor the
accepted compression core changes, and no assertion or tolerance is relaxed.

Two authored controls use portable in-memory PDFs: Letter 612 by 792 and
fractional A4 595.28 by 841.89 with rotation 90 and a nonzero fractional CropBox.
Both require exact source/result canvas dimensions and PNG bytes, a genuinely
smaller manually saved artifact, strict reopened MediaBox/CropBox/rotation,
title, prefilled field and checked box, and exact native text/URI/page-view
facts. No browser or fixture generator was run for this correction; only syntax,
diff and stable hash checks are performed by this owner.

The allocated focused native gate covered fourteen cases: the original Compress artifact
case plus both new geometry controls; four shared lifecycle render consumers
(held native load with surviving successor, held actual render, external image
lane with PDF successor, repeated native selections); four existing result
foundation cases; the selected-image decoder/drain consumer; and the existing
idle plus Compress idle cases. Root's prepared strict independent postfix
harness supplies a separate artifact acceptance check. Unchanged core and
intake gates were not repeated. Root owned review, source freeze and browser
allocation.

## Final structural route acceptance

Root closed the viewport gate with **14/14 PASS** in 15,527.44 ms, zero skipped,
unexpected or flaky cases and zero top-level errors. All 301 runtime/test
hashes, the path set, configuration, private idle test and all 22 generated
fixtures remained exact. Fourteen traces are retained; no excluded Markdown
runtime was imported. The final record is
`/tmp/browserpdf-compress-route-native-viewport14-20261019/final.json`, with
results at `/tmp/browserpdf-compress-route-native-viewport14-20261019-results.json`.
This gate used the existing server without global setup or fixture generation.

Root's separate strict independent postfix passed at
`/tmp/browserpdf-root-compress-native-independent-postfix-first-20261019/report.json`.
The original independent PDF remained 69,950 bytes, SHA-256
`57db6b3925fd1cbe28b106e7020d922c9bf8bb55e2d08a7581efd67f6dd9cfa3`.
Its actual source/result PNGs were exactly equal. The one manually downloaded
output was 3,753 bytes, SHA-256
`1c08689128a8a3ee1d718c4eb9e9055e3e7cc9d283b6d6b5a089a8f01f02171f`,
exactly matching the independently inspected graph/stream/text/pixel/form/URI
artifact. Explicit Use and native Reader retained the same task, unchanged
original and exact chosen current. There were zero page errors, zero non-GET
requests and one download. All 301 source/test hashes, path set and independent
corpus remained exact; no excluded Markdown runtime was imported. The browser
closed after this gate. Both original failure prefixes remain unchanged.

Fresh focused source review passed at
`/tmp/browserpdf-compress-route-viewport-fresh-review-20261019.md`. Its source
PASS, the native fourteen-case PASS and the separate independent postfix PASS
are distinct evidence. This final reconciliation changes only this checkpoint;
the ten owned runtime/test paths remain identical to the accepted gate hashes.
No further tests, browser work, fixture writes or server actions were performed
by this owner. Root owns the ledger and checkpoint commit. The open capability,
raster, translation and service-program work listed above is not accepted by
this structural checkpoint.

## Known searchable and form PDF admission

Root verified the structural checkpoint on the feature remote at
`af2d87fabeb49fd3dde0a7e19894074af92e9f23`, parent
`97f57af8a9321dd63143856d7611dcff30146713`; verification is retained at
`/tmp/browserpdf-root-compress-route-commit-remote-verification-20261019.json`.
The following separate capability delta is accepted by the focused source
review and native evidence recorded below. It is not included in the earlier
structural-route native evidence.

The PDF branch of `acceptsArtifact` now permits the existing PDF-tool list
without excluding Compress when `searchable` or `forms` is known true. Its
preceding encrypted-PDF branch remains byte identical and still permits only
Unlock. No capability inference, schema, public signature, font, dependency,
budget, optimizer or raster behavior changes. Compatibility admission does not
guarantee that an input fits the strict Compress intake or yields a reduction.
The accepted structural core still validates the actual rewritten artifact and
retains known boolean facts; it has no lossy raster fallback.

The real foundation consumer test covers plain, searchable, form, combined and
rasterized PDF admission, descriptor immutability, unknown-tool and non-PDF MIME
rejection, and encrypted Compress rejection with Unlock retained. One new
portable native case creates its own actual selectable transparent text layer,
prefilled field, checked box, URI and reducible stream through existing public
pdf-lib APIs. Source inspection establishes those facts before the session
carries `searchable:true` and `forms:true`. The case clicks the actual shared
Compress rail, exercising its filter, owned stash, local storage and guarded
destination intake. It then requires unchanged task/current/original on arrival
and before Use, exact source/result PNGs, one manually downloaded smaller PDF,
strict reopened text/field/check/URI/geometry, and retained capabilities through
native Use and Reader. This is a compatibility and artifact-preservation test;
it does not claim Tesseract recognition accuracy or new Unicode font support.

Only `core/document-session.js`, `tests/service-foundation.spec.mjs`,
`tests/compress-workspace.spec.mjs` and this checkpoint belong to this delta.
The scoped actual-predicate Node check passed 24 assertions across ten input
descriptors, including the byte-identical encrypted branch and unchanged source
hashes. Evidence is retained at
`/tmp/browserpdf-compress-capability-predicate-first-20261019.json`. Syntax checks
for the three JavaScript files and `git diff --check` passed. The stable
four-path manifest is supplied to Root separately. No browser, global setup, shared
fixture generation, unchanged core/intake rerun or server action was performed
by this owner. Raster, full translations, OCR, Excel and final all-service
acceptance remain open.

Root's focused capability source review passed at
`/tmp/browserpdf-compress-capability-fresh-review-20261019.md`. Root then ran the
two exact capability cases within a combined five-case allocation: the actual
typed-session foundation consumer passed, and the new searchable/forms
Reader-to-Compress-to-Reader journey passed. The other three cases belonged to
the separate protection-engine checkpoint. The combined gate was **5/5 PASS**
in 6,107.745 ms with zero unexpected, skipped or flaky cases and zero top-level
errors. All 310 runtime/test hashes, path set, configuration, private idle test
and all 22 generated fixtures remained exact; five traces are retained. No
excluded runtime was imported, and no global setup or server lifecycle action
occurred. Final evidence is
`/tmp/browserpdf-capability-protection-native-first-20261019/final.json`, with
results at `/tmp/browserpdf-capability-protection-native-first-20261019-results.json`.
This is acceptance of these two capability cases, not a full Compress or
all-service regression run.

The native `actual-searchable-form-retention` attachment in that result records
54,711 source bytes, SHA-256
`93f1e3acf3e484c09aee0d98a678e8be1ec6c50ab3a6018918f67579787bb63e`,
and the actual manually saved 3,298-byte output, SHA-256
`8f0eac4615fa3b92911882cd9162b3b7a48e9c1e141681ea3e71d987599f82ab`.
The saved artifact is retained at
`/tmp/browserpdf-capability-protection-native-first-20261019-output/compress-workspace-typed-s-fdf95-ties-through-Use-and-Reader-typed-compress/searchable-form-actual.pdf`;
its size and digest match the attachment. Actual source/output facts agree on
the visible text and `RETAINED INVISIBLE SEARCH LAYER`, URI, one-page view,
rotation and UserUnit. Passing assertions also require exact source/result
PNGs, prefilled field and checked box preservation, unchanged current before
Use, and one manual download with zero page errors or non-GET requests. The
attached chosen and Reader snapshots retain the same task and immutable
original, the exact saved current, and
`{encrypted:false,searchable:true,forms:true}`.

This final reconciliation changes only this checkpoint. The predicate and both
test files remain byte identical to the accepted native gate. No additional
tests, browser work, OCR discovery, fixture writes or server actions were
performed by this owner. Root owns the final ledger and checkpoint sync.
