# Shared document workspace: first pure checkpoint

This checkpoint is based on verified feature HEAD
`98a406e52b1c0eba6fdd8c1b10d16c0d6c1b80b1`. Its scope is the resource-count
scalar seam and pure draft, intake, and pinned-font acquisition modules. It is
ready for independent review. Word to PDF, Markdown to PDF, Markdown Viewer,
their editable workspace, saved-file review, Download, and Use remain open.
The other three document services, locales, and final service gates remain open.

The approved private contract is
`/tmp/browserpdf-document-workspace-three-service-contract-20261019.md`, SHA256
`316169e3c794c50b9bc07e82d0cdc0dd991119040dcf0dbb53fe20be99c57e2c`.
Only ten approved paths changed: the two scalar-seam sources, their new unit,
the three new pure sources, their three new units, and this document. The
twelve proposed UI paths are held. Accepted readers, model, PDF layout, fonts,
loader, result, handoff, SDK, styles, and locale files are unchanged.

## Resource-count seam

`document-session.js` returns `resourceCount: resources.size` in its existing
snapshot. The corrected empty session in `tool-ui.js` returns
`resourceBytes: 0` and `resourceCount: 0`. The
value counts the actual resource Map without transferring, copying, or
serializing session state. No session schema or SDK export changed.

The actual SDK source/build dependency graph does not include the session or
tool UI. Read-only `npm run check:dist --prefix sdk` and
`npm run typecheck --prefix sdk` passed. No SDK build or dist write ran; the
final private manifest compares SDK source/dist files with HEAD.

## Private draft API and ownership

`createDocumentDraft(bundle, {owner, sourceName, sourceType, sessionUsage})`
takes ownership of a trusted, already admitted DOCX/Markdown reader bundle.
This is not a public arbitrary-object reader. `sessionUsage` is a trusted
function returning the latest canonical snapshot. The constructor validates
and freezes a fresh logical model, retains the original source/model buffers,
and owns the reader's admitted asset bytes and captured disposer. The caller
must stop using the transferred bundle. `model()` and `assets()` are trusted
read-only borrows; asset byte arrays must not be mutated by consumers.

The draft exposes `snapshot()`, `view(options)`, async `apply(command, options)`,
`undo()`, `redo()`, `clearUndo()`, `acceptOwner(before, next)`, and idempotent
`dispose()`. Snapshots include local revision, exact canonical owner, paper,
dirty/history state, serialized model bytes, and current private resource and
artifact usage. `acceptOwner` requires both the exact prior owner and the
actual current canonical owner. It does not adopt a file itself.

Commands use the exact `type` discriminant. Supported commands cover literal
run-range replacement, run style/direction/insert/remove/split/equal-style
merge, paragraph kind/direction, list identity/level/value/restart, block
order/insert/remove, table row/column order/insert/remove/width, cell paragraph
order/insert/remove, existing asset-ID image replacement, physical image size
and alternate text, and paper settings. Targets contain a block ID, optional
cell `{row, column}`, paragraph index, and run index. Source offsets are UTF-16
and cannot split a Unicode scalar. Inserted text is at most 65,536 units per
command. The accepted model validator enforces the final finite model.

An apply registers one active mutation before inspecting a competing command
or reserving/copying data. Concurrent apply, Undo, Redo, history clear, owner
transfer, and dispose reject busy. A mutation captures local revision and
canonical owner, yields before model copying and again before publication,
then checks genuine abort state, both owners, current joint usage, and local
revision. Malformed, cancelled, stale, or over-budget candidates retain the
prior good model/history. Failed candidate bytes are erased. Signals use
captured native accessors/methods rather than producer overrides.

Baseline, current, Undo, and Redo together retain at most six unique model
versions and 48 MiB of serialized model bytes. Full history rejects the next
edit; it never silently evicts history. Explicit clear retains the immutable
baseline and current version and erases unreferenced owned model buffers.
Asset retention is deterministic for the draft's full lifetime, including
images referenced by history: at most 48 IDs and 16 MiB aggregate. Removal
does not erase an image needed by Undo. Dispose erases captured original and
new model buffers and original asset buffers before calling the captured
reader disposer. It never erases the caller's original input DOCX bytes.

The accepted first checkpoint had a static image pool. `replace-image` still
selects an already owned asset ID. The later atomic transaction described
below adds a new image and its model change together. A standalone asset
admission followed by an independent edit is not implemented.

## Bounded editor projection

`view({start, count, blockId, cell, paragraphIndex, runIndex, textStart,
textCount})` returns at most 40 block summaries of 120 text units, 20 run
descriptors, one active run window of 16,384 units, and table counts with at
most ten column widths. It does not construct one input per model cell/run.
The future DOM editor must use these bounded projections.

The textarea projection displays CRLF and CR as LF and returns an exact
`sourceOffsets` boundary map plus original source range. Applying a displayed
range must use that map. The logical model and untouched literal bytes are
not normalized. A style-only change keeps CR, CRLF, LF, SP, NBSP, punctuation,
and markup-looking text exact. There is no DOCX-to-Markdown roundtrip.

## Intake and drain API

`createDocumentIntake({getOwner, getUsage, readCandidate, publishCandidate,
onState})` accepts trusted callbacks. `getUsage()` returns `{snapshot, live}`.
The lane exposes `select(actualFile, {role, intent, isCurrent, signal})`,
`cancel(reason)`, `drain()`, `dispose()`, and `snapshot()`.
Selection returns an accepted, cancelled, or rejected status record.

One actual captured native File read/parser job and one latest unread file
are retained. Every native choice invalidates prior intent, including an
invalid new file. A newer unread choice replaces the older unread choice.
Only after the first read/parser/publish job and its cleanup drain can the
latest successor begin. There is no Promise.race that abandons the first
native promise. Clear and native B prevent an old initial handoff from
parsing or committing. The lane itself makes no canonical change.

DOCX inputs are at most 32 MiB; Markdown/plain inputs at most 8 MiB; images at
most 16 MiB; file names at most 260 units. Actual File and AbortSignal methods
are captured. Parser and publisher receive the owned read bytes, descriptor,
signal, captured owner, and reservation callback. Publisher additionally gets
`isCurrent` and `assertCurrent` and must return its exact actual new owner.
These trusted callbacks must validate the entire private candidate before a
canonical begin and preserve inherited original/history/resources. The first
callback promises are awaited before discarding a candidate or releasing its
reservations. Discard calls the captured candidate disposer and erases the
owned read buffer. Accepted bundle ownership transfers to the publisher.

A valid model with an unproved PDF script remains editable and accepted.
Malformed or budget-failing B retains A. A portable Hebrew Markdown control
has zero font requests. This does not add Hebrew/Arabic PDF support.

## Joint admission and pinned fonts

`assertDocumentWorkspaceBudget(snapshot, live, extra)` accepts exact finite
usage fields `resourceBytes`, `resourceCount`, `artifactBytes`,
`expandedBytes`, and `expandedCount`. It combines the existing canonical
snapshot and all supplied private usage under the existing 96 MiB/128-resource
and 512 MiB retained limits. Known JS ZIP/XML expansion counts as resource
memory. `reserve(extra)` checks all simultaneous intake leases with latest
canonical and private usage and returns an idempotent release function.
The future parser/publisher must reserve known raw/expanded/temp/output work
before allocating it. This checkpoint supplies that mechanism, not a wired
route or a new ZIP preflight API. Native allocator/RSS peaks remain unbounded.

The draft reserves bounded clone/serialized scratch before copying and checks
actual final serialized bytes. The positive artifact control reserves 80 MiB
output staging plus actual serialized model scratch and all live versions,
image/font bytes, and canonical retained bytes. Its actual generated seven-part
DOCX has 5,134 expanded bytes; model 1,320 bytes; five fonts 2,765,852 bytes;
resource reservation 86,657,217 bytes; remaining resource headroom 14,006,079
bytes. This is a JS ledger admission proof, not measured native peak memory.

`loadRequestedDocumentFonts(requests, {signal, isCurrent, onStatus}, environment)`
only accepts exact requests matching the five accepted Noto pins. The optional
third argument is trusted test/environment injection with `fetch` and
`ensureFontkit`; defaults are actual global fetch and the existing lazy public
loader. Producer URLs/dependency configuration are not accepted. Only requested
`/fonts/<fixed-file>` URLs are fetched, serially. Total font bytes are at most
3 MiB, streams at most 65,536 chunks, and all lengths/SHA256 pins are checked
before native font parsing. Actual zero requests cause no font fetch or loader.
No FontFace, global byte cache, new font, or dependency is introduced.

The loader owns fresh standard byte arrays and returns `{fonts, fontkit,
dispose}`. Abort drains the first fetch, read, first reader cancellation,
digest, and loader promises before settlement/cleanup. Captured AbortSignal
reason accessors also ignore own-property overrides. Invalid/stale work erases
owned buffers. The accepted PDF core still determines actual supported runs,
styles, mapping and positioning; there is no silent fallback or wider script
claim.

## Scoped evidence and remaining gates

The scalar seam unit passed 4/4 in 50.023916 ms. The first three-module run
passed 19/19 in 335.904208 ms. Added real list/image/table controls passed 20/20
in 396.834792 ms. After captured abort-reason hardening, the final owned run
passed 20/20 in 394.034917 ms, with no skip, failure, cancellation, or retry.
The earlier reports are retained rather than overwritten. Two selected
artifact-producing controls additionally passed 2/2 in 334.128875 ms.

Independent review then found one P2: the original empty lazy snapshot omitted
`resourceBytes`, so a real first Markdown File failed joint admission before
its parser. The retained original executable reproducer confirms that failure
and its single-scalar positive control. The narrow correction adds the missing
zero scalar. The affected unit now evaluates the actual unnormalized
`emptySession` expression, proves zero joint usage/full headroom, rejects the
missing-field control, and accepts the first real Markdown File through the
actual reader with exactly one parse and publication. Its input bytes arrive
exact, and actual logical italic style and Markdown hard break are asserted.

The correction's first affected unit run passed 4/5 and failed one newly
authored test expectation: it incorrectly expected Markdown's two-space CRLF
hard-break syntax to remain literal model characters. The accepted parser
correctly emits LF. That first report/source are retained, the expectation
was corrected to the declared parser semantics, and the affected unit passed
5/5 in 47.166917 ms. Only tool UI, the scalar unit, and this document changed
after the first ten-path freeze. Unchanged font/draft matrices and SDK checks
were not repeated; the SDK dependency graph is unchanged.

Portable controls generate their own inputs and use repository-pinned assets.
They cover first-read and parser holds, latest unread, Clear/invalid B,
transactional limits, busy-before-producer access, exact abort reasons and
successors, CR/CRLF offsets, actual list 7/12/8 edits, cell paragraphs/order,
history capacity, imported PNG retention/Undo/disposal, fixed font integrity,
held first cancellation/fetch/loader, and genuine DOCX/PDF output. A small actual
DOCX with all five styles, a two-column table, and a two-color image saves a
one-page PDF with an actual image layout item. The unit suite does not perform
new independent PDF pixel/geometry extraction or browser UI acceptance.

Private artifacts, TAP history, exact path hashes, accepted-core/SDK comparisons,
and source diff are under
`/tmp/browserpdf-document-workspace-pure-first-20261019/`.
The correction history and new ten-path review freeze are under
`/tmp/browserpdf-document-workspace-pure-corrected-20261019/`, including
`final-ten-manifest.json`, the original before-failure proof, and both affected
unit reports. The original artifacts and earlier ten-path manifest remain
unchanged. No browser, server lifecycle,
shared fixture generation, SDK build, route/UI change, or commit ran. Fresh
review, separately allocated native integration, the twelve UI paths, atomic
new-image replacement, all three first service journeys, and the remaining
program gates are still required.

## Atomic image subcheckpoint

Root verified the first ten-path foundation and ledger commit as
`f0fa2aaa99f275b14c81a7220a767db65b20cafb`. A separately approved pure image
subcheckpoint changes only this document, `core/document-draft.js`, and its
existing unit. It is frozen for fresh review before browser acceptance. The
private proposal is
`/tmp/browserpdf-document-workspace-new-image-transaction-contract-20261019.md`,
SHA256 `f9699380b37bc0d056b5388be8fcff0dbe4ef616b7125d8713494becfb34938e`.

`createDocumentDraft(bundle, settings, {normalizeImage})` optionally captures a
trusted normalizer. Existing draft operations require no normalizer.
`replaceImageWithNewAsset({blockId}, {type, bytes, alt}, {signal})` uses the
same single active mutation slot as apply. It rejects busy before inspecting
producer records, copying bytes, reserving work or invoking the normalizer.
The exact record accepts actual nonshared Uint8Array, including Buffer and
cross-realm Uint8Array, or ArrayBuffer. It intrinsically copies to a new standard
array. Input must be nonempty PNG/JPEG, at most 16 MiB, 4096 per edge and eight
million pixels. Alt text is literal and at most 10,000 units. It changes an
existing image's asset and alt text while preserving physical size and order.

One new draft-owned ID, owned PNG bytes, model version and history transition
publish synchronously together after all checks. No source/canonical mutation,
result, Download, Use or output publication occurs. The captured local revision
and exact canonical owner are checked across every yield/native boundary and
before publication. Failure preserves the old model, paper, history, asset
pool and ID counter. After a failed transaction the next successful ID remains
`draft-image-1`. Existing asset-ID replacement can re-declare an older admitted
ID without copying its bytes.

The lifetime Map retains every old/new admitted ID and its bytes through all
Undo/Redo and explicit history clear, under the same 48-ID/16-MiB lifetime cap.
`assets()` returns only the IDs declared by the current model, in model order;
snapshot resource accounting includes the entire lifetime Map. A replacement
removes just the replaced old metadata when no current block references it.
Shared old images keep their metadata. Undo/Redo restores exact matching model
and asset selection without supplying obsolete image records to output cores.

Before copying, the transaction reserves one joint lease using the maximum of
`2*N + 8*P + 2*B` and `3*S + 2*B`, plus six resource slots, where N is raw input
bytes, P declared pixels, B remaining lifetime image bytes, and S the bounded
new model estimate. These are sequential normalization and model stages; all
existing canonical, draft, input-lane and output reservations remain charged.
Actual output/model lengths are reconciled before publication. Six-version and
48-MiB history capacity are checked before copying. Known expanded/raw/temp JS
bytes are counted, and the conservative native-plane allowance is not a hard
codec heap or RSS guarantee.

The trusted normalizer receives the private raw copy and
`{type, maxOutputBytes, signal}`. It returns its first Promise of exact owned
`{type:'image/png', bytes, width, height, dispose}`. The callback must close its
bitmap/reset its canvas before that Promise settles; this subcheckpoint adds
no browser normalizer yet. Native PNG/JPEG orientation/encode support is still
a later browser gate. The pure draft verifies output dimensions/type/size,
allows only original or swapped edge dimensions, owns a fresh PNG copy, captures
the returned disposer once and awaits its actual first returned Promise before
any commit or lease release. Input and candidate buffers are erased on failure.

`DOCUMENT_IMAGE_NORMALIZE` is the trusted adapter's explicit decode/encode
failure with cleanup already complete. Other failures before an owned disposer,
or any disposer rejection, create a finite cleanup fence. Its full pending
reservation remains charged; `snapshot().cleanupBlocked` is true and subsequent
mutations, native image transactions, owner transfer, history actions and
dispose reject `DOCUMENT_DRAFT_CLEANUP`. There is no invented retry or native
abort API. The future workspace must reject native intake before read while
this flag is set and offer page reload. Snapshot `imageReports` is at most one
`local-image-normalized-to-png` record per new lifetime ID, outside the accepted
model warning enum. No unproved normalization is silently represented as an
unchanged source image.

Scoped Node checks passed 8/8 in 310.91175 ms: six new transaction controls and
the two affected history/disposal controls. Unchanged font/intake/SDK matrices
were not repeated. Actual repository-installed Node canvas PNG/JPEG codecs are
used only as trusted unit environment, not browser acceptance. Real PNG and
JPEG inputs normalize to owned PNGs, preserve input bytes and interior colors,
and save real image-only one-page PDFs and DOCX packages with actual retained
media. Both positive cases fit the existing conservative 80-MiB PDF staging
with five-font byte admission, plus live image/history bytes and actual scratch.

The first six-case image run passed 5/6 and failed a new 2-by-1 JPEG fixture's
color expectation. Its encoder had already subsampled adjacent red/blue pixels
to `[150,24,150]` and `[103,0,103]` before normalization. Original input, report,
source hashes and diagnostic are retained. The corrected control uses 32-by-16
red/blue regions and keeps positive interior-color assertions. It does not
weaken a product fidelity check or claim JPEG is lossless. Corrected artifacts,
TAP, three-path source diff/manifest and unchanged protected-path proof are
under `/tmp/browserpdf-document-workspace-new-image-20261019/`.

Pure source review, actual browser normalization/EXIF/abort/cleanup proof and
all three service UI journeys remain open. The original foundation, original
failed reports, all accepted core/font/session paths and prior artifacts stay
unchanged outside the exact approved three-path extension.


## Joint image/intake ledger refinement

Root approved a narrow five-path extension of the pure image checkpoint:
existing draft/intake sources, their existing units, and this document. The
constructor's trusted environment now additionally accepts optional
`getExternalUsage()`, defaulting to zero. Its result has only the same five
finite numeric usage fields. Every draft budget check combines its actual
`sessionUsage()` canonical snapshot, its own lifetime/pending usage, and that
accessor. No producer option or invented canonical snapshot scalar replaces
actual session usage. The optional legacy apply `sessionUsage` field cannot
replace the trusted canonical accessor in admission.

Intake reader/publisher context adds `reservationUsage()`: a fresh scalar sum
of its actual active reservation Map, including the existing `3*rawN` artifact
reservation. Returned metadata is not the Map; mutating it cannot change leases.
Each reservation component must itself be a finite nonnegative safe integer,
so negative values cannot cancel a prior reservation. Release is idempotent,
and the accessor reports zero only after the first active publish job drains.
No transfer, model bytes, session clone or generic state bag is exposed.

The workspace must bind the active context through the first read, parse,
publish, normalizer and captured disposer promises. Draft external usage adds
this actual Map sum and all distinct UI font/output leases. It excludes the
draft's own image peak. Intake `getUsage().live` includes the draft's pending
peak and UI leases; intake itself adds its Map once. The method is the sole
owner of its peak reservation. A cleanup fence retains that peak after the
raw File job has actually drained, rather than claiming all native cleanup
succeeded. New native admission must check the fence before File read.

Parser/model ownership transfer is synchronous: the parser reservation covers
reader candidate bytes until its first reader Promise settles. Before candidate
construction, release that staging reservation and immediately admit/transfer
the same bundle into a private draft, whose own usage then accounts for those
buffers. No await or duplicate lease for those same buffers is allowed across
that transition. The intake raw `3*N` reservation stays live independently until
its entire first job drains. On constructor failure the caller still owns and
disposes the candidate. UI integration has not yet proved these callers.

The affected image/history/intake invocation passed 17/17 on its first run in
312.194042 ms. It includes actual File `role:'image'` intake through publisher
to the real atomic draft method with unchanged canonical owner, plus an ordinary
positive and a combined near-512-MiB boundary rejection before any decoder call.
The boundary deliberately uses a finite numeric canonical usage fixture rather
than allocating hundreds of MiB: without the live raw lease the calculated
image peak fits; with the actual intake Map's `3*N` lease it rejects and keeps
model A byte-exact. This is an integration/accounting control, not measured
native memory or a large real SDK task claim. A held-normalizer control changes
external usage and proves it is rechecked, cleanup drains, and no stale candidate
commits; restoring capacity admits a valid successor.

No unchanged font/SDK/whole-core matrices were rerun. Original image three-path
proofs, first JPEG-fixture failure, original artifacts and outside-scope hashes
remain retained. The new five-path freeze/report/diff/TAP and artifacts are in
`/tmp/browserpdf-document-workspace-image-ledger-corrected-20261019/`. Service UI,
actual browser normalization/preview/Download/Use and final locales remain open.


## Exact abort-reason correction

A private actual-frozen-core probe exposed one remaining narrow branch: after
native decode and cleanup completed but before encode started, a trusted
`DOCUMENT_IMAGE_NORMALIZE` cancellation returned that typed wrapper rather
than the original genuine signal reason. The original five-case report is
retained at `/tmp/browserpdf-document-workspace-abort-reason-seam-20261019/`.
Already-aborted, held decode, held encode and rejecting first disposer cases
already followed the intended drain/fence contract.

Root approved only capturing the genuine signal in method scope and invoking
the captured intrinsic check after finally has drained cleanup and after the
cleanup-fence error takes precedence. This preserves the exact signal reason
without reading own `reason` or `throwIfAborted` overrides; it never hides a
cleanup failure or releases its reservation. The portable new regression proves
no encode starts, old model/revision/usage remain exact, settlement waits for
the first held stage, and a valid successor succeeds. Six affected controls
passed 6/6 on the first correction run in 269.917375 ms. The independent private
five-stage actual-module replay also passes all five intended outcomes. A
rejecting disposer still keeps its 33,567,556-byte charged fence.

The new corrected five-path manifest, narrow source diff, TAP and replay are
under `/tmp/browserpdf-document-workspace-abort-corrected-20261019/`. Intake
source/unit remain exact to the prior five-path freeze; only draft source/unit
and this document changed. No unrelated matrix, browser or service acceptance
is implied. The source-revision API contract is still private and unimplemented;
its discarded UI frame skeleton is retained as private work history.


## Falsy abort-payload correction

Fresh focused review then found one P2 in the error-presence check: genuine
abort reasons null, false, zero and empty string were treated as no caught
error and the image method fulfilled undefined. Original eight failing actual
module probes and the review are retained at
`/tmp/browserpdf-document-image-ledger-falsy-abort-probe-20261019.json` and
`/tmp/browserpdf-document-image-ledger-fresh-review-20261019.md`.

The approved narrow correction tracks caught exception presence explicitly,
independently of payload truthiness. Cleanup-fence priority is unchanged. After
actual first cleanup drains, a caught operation invokes the captured intrinsic
abort check and rejects with the exact payload even when falsy. The owned
regression covers all four reasons before decode and after a held first
normalizer, own reason/method overrides, no early settlement, unchanged old
model/revision/resource bytes/count, and a valid successor in every case.

Three affected tests passed 3/3 on their first invocation in 250.366542 ms,
including the eight-case falsy matrix, earlier cleanup-complete abort branch
and rejecting-disposer fence. A separate replay of the reviewer's original
actual-module harness now rejects all eight with exact reasons and unchanged
old models/resources. It writes a new report; original failures are untouched.
The new five-path manifest and evidence are in
`/tmp/browserpdf-document-workspace-falsy-abort-corrected-20261019/`. Intake
source/unit and all49 outside paths remain exact. No full matrix, browser,
source-revision API or service acceptance is claimed.


## Final pure image/accounting checkpoint acceptance

Root accepted the frozen five-path pure image/accounting checkpoint after the
focused corrected review passed. The sole P2 from the preceding review is
closed: exception presence is independent of falsy abort payloads, with cleanup
failure still taking precedence and retaining its charge. The accepted evidence
includes the original 17/17 joint-ledger invocation, 6/6 typed-abort correction
controls, 3/3 falsy correction controls, the reviewer's corrected original eight
actual-module probes, and Root's separate strict eight-case replay.

The final focused review is
`/tmp/browserpdf-document-image-ledger-corrected-review-20261019.md`. Root's
`/tmp/browserpdf-root-document-image-falsy-abort-corrected-first-20261019-proof.json`
records eight passing cases, all 54 captured source records exact, and the
original failing eight-case report unchanged. The reviewer separately checked
63 source/evidence records with zero mismatches. These are scoped pure Node
proofs. The original six PNG/JPEG, saved Markdown/local-image, PDF and DOCX
codec/output artifacts remain separate and unchanged. Earlier open-review
statements above describe the historical checkpoint at that point.

This final reconciliation changes only this document. All four accepted
runtime/unit paths remain byte-exact. The final five-path manifest and retained
proof hashes are in
`/tmp/browserpdf-document-image-checkpoint-final-20261019/`. All first failures
remain retained under the original new-image, accounting, abort and falsy
correction prefixes listed above; no old report was overwritten.

This acceptance covers the pure atomic image transaction, lifetime image/history
ownership, joint intake accounting and exact abort/drain/fence correction only.
The Markdown source-revision and initial named-image binding seams remain
private proposals. UI12 is incomplete and has no browser acceptance. Actual
browser normalization, EXIF orientation, native cancellation/cleanup, saved-byte
selected-page review, manual Download, explicit Use, all three service journeys,
locales and final service gates remain open. No service row is complete.


## Source initialization, revision and cleanup checkpoint

Root approved the private source contract after independently verifying the
image checkpoint at 9fd688f6aa8ce8794ea80132a16a129158693615. This new pure
checkpoint changes only the same five draft/intake/unit/document paths. The
source seam described as a private proposal in earlier historical sections is
now implemented in these pure paths, pending fresh review. UI12 has not wired
these new APIs and remains incomplete.

The draft adds initializeMarkdownSource(localAssets, options) and
applyMarkdownRevision(candidate, options). Both require the actual current
model reference, local revision and canonical owner captured before the
associated reader/writer work, plus an optional genuine signal. The same
one-active guard rejects before examining a competing producer. A stale
capture cannot publish even if its text happens to match. A caller retains
ownership of a candidate rejected before its fields/disposer are inspected;
trusted async cleanup wrappers must return their captured first cleanup
promise idempotently.

Initialization is restricted to an unchanged Markdown/plain baseline at local
revision zero, once. Exact preparse named records bind to actual baseline pool
bytes through SHA-256 indexing and byte comparison, never reader array order.
The name map supplies bytes and dimensions only. Every original alternate-text
identity remains in the literal model. Initial source uses the existing owned
UTF-8 bytes and a fatal decode with ignoreBOM:true, preserving U+FEFF, CR, CRLF
and LF. Attachment creates source revision zero without changing model bytes,
asset IDs, paper, local revision, dirty state or Undo. The trusted workspace
must complete this step before publishing its provisional Markdown draft or
committing the new canonical task. Word never passes through this method.

Reader revisions copy and validate their actual literal model, remap structural
IDs against the one task-lifetime image pool, and preserve semantic text/styles,
directions, provenance and list/table structure. Repeated reader image IDs
cannot establish ownership. Reuse requires MIME, dimensions, actual encoded
bytes and immutable alternate-text identity; changed bytes or alternate text
need their own owned ID. Current assets project only current declared IDs,
while historical bytes and IDs remain charged for Undo and history clear.
Exact local names survive source reparsing. Serialized revisions require the
actual writer's output for the captured model and preserve that model reference
and logical data while attaching its explicit generated source. sourceRelation
is parsed, serialized, outdated or none. Ordinary edits share their source
record and mark it outdated; paper changes preserve the relation. One Undo/Redo
order restores the matching model, source and image selection.

markdownSource() returns the current primitive source string; markdownAssets()
borrows at most48 frozen named records backed by lifetime-owned bytes. Snapshot
adds actual retainedModelCount/Bytes, lifetimeAssetCount/Bytes, sourceRevision
and sourceRelation. These are private draft scalars. No session/SDK schema,
source-frame stack or second resource pool was added.

Six retained versions, 48MiB aggregate model bytes, six referenced source
records and 48MiB aggregate UTF-8 source bytes stay finite. Each source remains
at most8MiB UTF-8 and UTF-16 units. Actual decoded UTF-16 content and one128KiB
metadata allowance per source record are charged, plus one128KiB/one-resource
allowance while a finite per-pool digest cache exists. Initial source bytes
share their baseline owner and are counted once. Unreferenced private source
copies are erased by explicit history cleanup; baseline and lifetime images
remain. No silent eviction restores capacity.

Known copy/hash stages use the same joint96MiB/128 and512MiB limits. Initial
binding reserves 2*B+2*max(A,P)+256KiB and six slots. Revisions reserve
3*S+3*B+3*max(A,P)+256KiB and56slots, including known source/model/image
copies and one serial temporary/digest input. Before reader model copies,
a bounded own-data preflight measures actual JSON byte size, with an initial
4MiB/four-slot work reservation, finite depth/nodes/keys and cooperative checks.
It rejects changed size records, accessors and nonstandard/sparse arrays.
The measured size plus bounded remapping allowance determines S, capped16MiB.
This is admission for the existing finite document model, not another Markdown
parser. Native codec or total heap/RSS bounds are not claimed.

Every first digest and candidate cleanup promise drains before release or
publication. All control, comparison and copying loops yield/check at finite
boundaries. Captured signal intrinsics preserve exact abort reasons, including
falsy values. Cleanup rejection has priority, retains pending ownership/charge,
and fences further mutations until page reset. A failed candidate keeps the
old literal model, original, source association, history and asset counters.

The draft's dispose() now returns one owned promise. It captures and awaits the
first original bundle-disposer result before erasing its own retained buffers
or reporting release. Concurrent calls return that same promise. Held disposal
keeps bytes and usage live; rejection retains a typed cleanup fence and charged
ownership, with no retry API. New callers must await it. Accepted synchronous
reader disposers still work; affected unit callers now await completion.

Intake discard similarly captures/awaits its first disposer before erasing raw
bytes, clearing actual reservations, settling the job or starting its latest
unread successor. Cleanup failure beats cancellation and fences select/drain/
dispose with DOCUMENT_INTAKE_CLEANUP while bytes and reservation Map remain
owned. A newer intent arriving during cleanup is classified after cleanup
settles. Accepted candidates deliberately transfer to their publisher.

Portable controls generate actual reader/writer bundles and PNG fixtures.
They cover original named-image baseline/reparse/Undo, alternate-text aliases,
changed bytes with repeated reader IDs, malformed/missing/case-fold/mutated
providers, source/block/serialization history, six-version and joint limits,
strict measured admission, first hash cancellation, falsy cleanup cancellation,
failed cleanup priority, held/rejected draft disposal and unread queued B.
Real selected Markdown/local PNG, DOCX media/XML and image-only one-page PDF
artifacts are retained. Existing image/ledger/abort proofs remain separate.

The first new scoped invocation passed13/14 and the second passed15/16; both
retain the same authored test error calling a nonexistent DOCX writer disposer.
The verified writer returns owned bytes/type/report/usage. The test now erases
its owned output bytes after inspecting them. Its separate artifact control
passed1/1. The first complete affected draft/intake invocation passed41/41 in
1081.380916ms. After final candidate-union/ASCII-ID tightening and a new
late-intent control, the final affected source/disposal/intake invocation passed
17/17 in556.057042ms. No first failure was overwritten and no broad unchanged
font/SDK/shared-unit matrix or browser gate was run. The complete affected
invocation includes the existing small five-font positive and old image/abort
controls because this checkpoint changes their draft lifecycle.

All before-files, source-hash history, first reports, final scoped reports,
source diff, artifacts and final five-path manifest are under
/tmp/browserpdf-document-workspace-source-first-20261019/. The prior accepted
image checkpoint manifests, artifacts and protected source hashes stay exact.
These five paths are frozen for fresh review. Actual first-intake UI ownership
transfer, source editor wiring, browser normalization/EXIF/cancellation,
saved-byte selected-page preview, manual Download, explicit Use, three separate
service journeys, locales and final service gates remain open.


## Captured applied-command source relation correction

Fresh source review identified one P2 after the new pure source checkpoint:
ordinary apply published sourceRelation by rereading raw command.type after
its final yield. An actual style edit followed by a producer getter returning
set-paper committed bold but incorrectly reported parsed source and invoked
the late getter. The original private probe and review remain untouched at
/tmp/browserpdf-document-source-core-late-command-probe-20261019.{mjs,json}
and /tmp/browserpdf-document-source-core-fresh-review-20261019.md.

The correction makes mutate return the validated local tag actually applied,
including every early-return branch. apply captures that return before its
next await and uses it at publication, with no later producer-field read.
Logical edits therefore mark source outdated even when the producer changes
its own data or installs a getter. Paper-only edits preserve the current
parsed or serialized source relation.

Three focused controls passed3/3 on their first invocation in196.502417ms:
late getter after an actual bold edit, ordinary changed type data with Undo,
and paper-only changes preserving both parsed and serialized associations.
A separate replay of the original actual-module probe, changing only its
output path, now records bold/source literal/sourceRelation outdated,
lateGetterCalls0/revision1. The original failure is retained byte-exact.

The reviewer's two already-passing real named-image history and rejected
FIRST-digest/falsy-zero controls are retained as unchanged evidence at
/tmp/browserpdf-document-source-core-review-probes-20261019.{mjs,json}.
No full41-test, accepted-image, codec/artifact or browser matrix was rerun.
All earlier source/artifact reports and the five-path before-files remain.

The shared assertDocumentWorkspaceBudget function is byte-exact. Actual
OCR pure modules core/ocr-model.js and core/ocr-writer.js import that function
from document-draft.js; neither dependency was edited or executed here.
Intake runtime/unit remain exact. Only draft runtime/unit and this document
changed within the approved five. The corrected diff, focused TAP, replay,
unchanged-evidence and budget-function hashes, and final five-path freeze
manifest are under /tmp/browserpdf-document-workspace-source-corrected-20261019/.

This remains a pure source correction awaiting focused review. UI source
wiring, browser/native behavior, selected-page readiness, manual Download/Use,
three separate service journeys, locales and final acceptance remain open.
