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

The current image pool is static. `replace-image` selects an already owned
asset ID. A new local image will require a separately reviewed atomic
replace-with-new-owned-asset transaction before UI integration. A standalone
asset admission followed by an independent edit is not implemented.

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
