# Pure spreadsheet model and PDF table inference checkpoint

This checkpoint owns exactly two new pure cores, two unit files and this document.
It does not change Excel/PDF routes, read XLSX/CSV, run SheetJS, load fonts, render,
write files, publish results, or complete services26/27. All coordinates supplied
to inference already describe an admitted source. No browser is used here.

## Exact model and validation API

`validateSpreadsheetModel(input, options={})` is asynchronous and returns an owned
bundle `{model,bytes,usage,dispose}`. `model` is a deeply frozen fresh own-data copy;
`bytes` is its UTF8 JSON. Dispose zeros the actual owned bytes once. Caller data
and strings are never erased. Options are `signal`, `yieldControl`, `getUsage`,
`onUsage`, `workLimit`. The latter only lowers the32Mi visit ceiling. Signals are genuine AbortSignals checked through captured intrinsics.
`yieldControl` is a trusted scheduler only, returning no owned resource; its FIRST
promise always settles before cancellation returns. `getUsage` returns
`{snapshot,live}` for the accepted joint scalar budget helper. Standalone pure
validation defaults to an empty canonical snapshot; integration must supply the
actual canonical and external live usage. `onUsage` is synchronous notification.

Schema v1 has `version:1`, `sourceKind` (`xlsx|csv|pdf|authored`), `sheets`, `reports`, `unplaced`. Unplaced records are
`{pageNumber,itemRef,text,reason,x,y}` with finite source coordinates and reason
unsupported-angle/outside-region/overlapping-regions; all strings count.
Each sheet has `id`, `name`, `rows`, `columns`, `cells`, `columnWidths`,
`rowMetadata`, `merges`, `hidden` (`visible|hidden|very-hidden`), `selected`, `print`.
IDs use ASCII letters/digits/hyphens, at most100. Names are literal nonempty text,
at most31 units and case-insensitively unique. A print object is
`{paper:a4|letter,landscape:boolean,margin:0..72,range:null|{top,left,bottom,right}}`.
Ranges use inclusive zero-based cell indices. Merges are nonoverlapping ranges,
with at least two cells; every underlying cell remains independently retained.
Row metadata is `{row,hidden,height}`; height is null or finite1..4096 points.
Widths are positive finite point weights, at most10000, one per column.

Cells are sparse `{row,column,raw,text,display,formula,source}`. Raw and cached
values are `{type:string|number|boolean|error|blank,value}`; blank is null, error
is a literal string. Missing cell and a present empty string are distinct.
`text` and `display` remain literal independent strings. A formula is null or
`{text,cached,state:source|unverified|missing}`; cached is a raw value or null,
and null requires missing. The core does not calculate or establish cache truth.
Source is null or `{pageNumber,regionId,itemRefs,rawTexts,separator}`; indices refer
to supplied page items and rawTexts retain their exact strings in the same order.
`separator` records an explicit inferred join, never trimming/normalizing inputs.
Reports are `{code,sheetId,pageNumber,count}` with nullable sheet/page references
and finite codes defined in `SPREADSHEET_REPORT_CODES`. No arbitrary metadata,
URLs, confidence estimates or producer methods are accepted.

Limits:16 sheets,10000 aggregate rows,100 columns/sheet,200000 rectangular cell
slots and stored cells,1M stored UTF16 units including ALL raw/display/formula/
cache/provenance/metadata strings,32767 units per cell text,1024 per formula,
1000 aggregate merges and100 reports. Model JSON is16MiB. One model's known
charge is JSON bytes plus two bytes per stored string unit plus128 bytes per
copied object/array; native object heap is not measured. Both model and charge
are bounded by48MiB. Operations stop at32Mi charged visits, yielding after16384
visits or128 actions. Comparisons, scans and structural copies consume work.

## Draft ownership, commands, history and accounting

`createSpreadsheetDraft(input, {owner,sessionUsage,getExternalUsage?,
yieldControl?,prepareCandidate?,preparationUsage?,signal?})` is asynchronous. Owner is the
actual `{taskId,revision,generation}`; sessionUsage returns the canonical snapshot
including these fields and retainedBytes/resourceBytes/resourceCount. External
usage uses the accepted five scalar names. The private initial model remains
immutable and available through `source()`; `model()` returns the current frozen
model. `snapshot()` returns local revision, owner, busy/closed/cleanupBlocked,
history counts, current model bytes, pending usage and total private usage.

`apply(command,{signal?,expectedModel?,expectedRevision?,expectedOwner?})` owns one
mutation lane. Commands: `replace-cell` (sheetId,row,column,text,replaceFormula?),
`replace-range` (sheetId,top,left,values,replaceFormula?), `set-column-width`
(sheetId,column,width), `set-selected` (sheetId,selected), `set-print`
(sheetId,print), `set-row` (sheetId,metadata), `unmerge` (sheetId,index),
`move-sheet` (sheetId,delta=-1|1). All keys are exact. Cell edits retain raw/source,
replace text/display literally, and require replaceFormula:true to remove a
formula. Newly present cells have raw blank/null. Every successful edit marks
ALL remaining nonmissing formula caches unverified. No implicit type conversion,
evaluation, source erasure or Unicode normalization occurs.

Pending48MiB/two resources PLUS one current-model cloning charge/resource and
preparationUsage is visible and admitted BEFORE candidate construction. This
uses cooperative strict cloning. Final bounded JSON stringification/encoding
cannot receive event-loop cancellation until the native operation returns. Their known
serialization peak must fit the48MiB construction reservation.
Optional trusted prepareCandidate receives the frozen candidate and
`{signal,revision,usage}` and must return an owned `{dispose}`. Its declared
preparationUsage is reserved before invocation; its FIRST promise and FIRST
disposer settle before publication/release/successor. Rejecting a preparation
promise promises that its own work has drained. Fulfillment without an owned
disposer, or disposal failure, fences the draft with charges retained until page
reset. The core does not invent a cleanup retry. Owner, actual model identity,
local revision and genuine signal are rechecked after every callback/await.

At most six distinct models, including initial and Redo, share48MiB known charge.
No pruning credit is used before commit; a new branch discards Redo only after
admission. `undo`, `redo` and explicit `clearUndo` refuse while busy and check
canonical ownership; every model restoration increments local revision.
`view({sheetId?,row?,column?})` returns at most40x12 cell summaries and16384 text
units, with explicit offset/totalUnits/hasMore projection. `cellView` selects one
cell field (`text|display|raw|formula|cached`) and a scalar-safe offset window.
Projection never edits the model. `drained()` waits for active work and rejects
cleanup fences. `dispose()` captures one promise, cancels active work, waits for
FIRST work/cleanup, then erases owned JSON bytes. A failed fence retains charges.

All budget checks call the unchanged accepted assertDocumentWorkspaceBudget.
Canonical plus private/external live/pending bytes share512MiB retained,
96MiB resource bytes and128 resources. One owned model record/JSON buffer counts
one resource; pending construction counts two plus the clone and preparation. This is not an additional
pool or a hard RSS bound. Callers must charge returned bundles/view records and
source/parser/native allocations separately and must not omit canonical copies.

## Inference API

`inferPdfTables(input, options={})` returns an owned validated bundle plus finite
`work` counters. Unplaced records live in model.unplaced and are serialized. Options match validation. Input is `{pages}`. Each page is
`{number,viewport,items,regions}`. Viewport is `{width,height,transform}` with a
finite invertible six-number PDF-to-top-left viewport affine transform, already
including CropBox/UserUnit/page rotation. Items are
`{text,transform,width,height,hasEOL}` using finite six-number PDF text transforms
and nonnegative extents. Regions are `{id,name,box,separators,rowTolerance}`;
box is `{x,y,width,height}` in viewport coordinates, separators are strictly
increasing interior x positions, rowTolerance is finite0.1..100. Up to100 selected
pages from source page numbers1..1000,16 regions and100000 items total,10000 items/100000 text
units per page,1M source units total. No regions means no invented table.

Only text whose transformed baseline is horizontal and left-to-right is inferred;
other nonempty items receive an unsupported-angle report, retaining source refs
and original text in returned `unplaced` records. Out-of-region items also remain
in unplaced. Region overlap or a text extent crossing a separator is reported;
no reliable table geometry or detection confidence is claimed. Explicit regions
and separators determine columns; stable bounded merge-sort orders rows/items.
Each nonempty item belongs to at most one region; ambiguous overlap remains
unplaced. Row grouping uses explicit tolerance, not inferred font confidence.
Strings within a cell are joined using one explicit SP separator; rawTexts,
itemRefs and hasEOL-independent original strings stay exact. Empty/whitespace
strings are retained; no trim or silent item loss. Empty pages are reported.
Unplaced baselines remain inspectable; placed item refs address the original
supplied geometry. Unplaced data counts
toward the same model/resource budget and must be shown before later export.
Inference reserves32MiB/two resources for intermediate owned geometry/table data
and48MiB/two for subsequent validation, jointly with actual canonical/external
usage BEFORE construction. Smaller available headroom rejects conservatively.

Actual PDF extraction/rendering, XLSX/CSV admission, readers/writers, source-byte
preservation, formula PDF choices, print fidelity, saved artifacts, OCR/handoff,
manual Use/Download, route idle/mobile/22 locales and independent review remain
future gates. Portable tests generate small own models and geometry only.


## Owner verification and stable handoff

`rtk proxy node --test tests/spreadsheet-model.unit.mjs tests/pdf-table-model.unit.mjs`
passes22/22, zero failed/cancelled/skipped,1065.030375ms in
`/tmp/browserpdf-spreadsheet-pure5-owner-20261019/final-22-corrected.tap`.
Four final syntax checks pass. Nine protected shared/entry hashes match the
pre-implementation prefix. This is pure Node/model/geometry evidence only.

The first18-case invocation passed2/failed16: internal optional fields were
incorrectly supplied as explicit undefined to strict own-data options, and the
fixture supplied a full snapshot where the documented three-field owner was
required. Both were corrected without weakening data admission. A later
cooperative-copy change initially kept mutable candidate records frozen:
9passed/6failed/7cancelled in final-22.tap. Mutable construction was corrected;
returned/public models remain deeply frozen. Original logs are retained.

Small focused controls additionally prove settled apply snapshots, first held
owner/signal/disposer boundaries, cleanup charges/fences, all four genuine falsy
abort reasons, and visit-based yields through astral strings. No browser, real
PDF extraction, saved workbook/PDF, route, locale, or full-suite acceptance is
claimed. Exact five-path manifest/private report support independent review.


Focused review correction: final budget/owner callbacks could abort apply or Undo
while the following mutation still published. Callback-free local guards now
recheck the captured model/revision, genuine signal and closing state AFTER those
callbacks, immediately before apply/history transfer. Admission and final opening
use the same ordering. FIRST preparation/disposer drains and cleanup fences stay.
The two original independent repros now reject exact false and preserve A/history;
uncanceled and rotated-text controls pass. Focused5-case evidence is retained in
`/tmp/browserpdf-spreadsheet-core-final-guard-corrected-20261019/`.
Inference core/tests are byte-identical. The full22-case suite was not rerun.
