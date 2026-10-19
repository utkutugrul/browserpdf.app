# Spreadsheet extraction and XLSX export checkpoint

This pure checkpoint adds literal PDF item capture/projection and a bounded XLSX writer. Existing models/inference/reader/intake/helper/fonts/SDKs/routes/locales remain unchanged. Grid, spreadsheet print/PDF, Download/Use/handoff and final services26/27 acceptance remain open. No layout reconstruction, OCR recognition, formula evaluation or native/browser acceptance is claimed.

## Exact public APIs

`readPdfTableSource(bytes,{pdfjs,pdfjsAssets},{pageNumbers,signal?,getUsage,isCurrent,onUsage?})`

Input is attached fixed nonshared Uint8Array/ArrayBuffer with PDF header,<=12MiB. pageNumbers is an explicit dense unique selection<=100 from actual<=1000 pages. Assets allow only standardFontDataUrl/cMapUrl/cMapPacked/wasmUrl. Injected public PDF.js promises and genuine ReadableStreams are required; the portable native facades are synthetic.

Returns exactly `{sourceBytes,pages,extractionBytes,status,report,usage,dispose}`. status is source-ready|needs-ocr and describes embedded extraction only. An empty selected page gives needs-ocr; no empty workbook is invented. Original bytes and selected/excluded page inventories are retained.

Raw page keys are `{pageNumber,view,rotate,userUnit,viewport,items,styles,chunks,selection}`. Actual view/rotation/UserUnit and scale1 viewport width/height/transform are preserved. Raw item keys are `{pageNumber,itemIndex,chunkIndex,itemInChunk,str,dir,transform,width,height,fontName,hasEOL,styleRef}`. Empty/whitespace items keep original indices. styleRef is original defining `{chunkIndex,fontName}`, or null plus a report. Chunk language/counts and chunk-scoped original style inventories remain separate. No normalization/trim/filter/reindex/guessed geometry. PDF.js API output does not prove original PDF byte/glyph fidelity.

Limits:50k total/10k page items;1M total/100k page units;32767 units/item;2048 items/131072 units/256 styles/2MiB per chunk;100k chunks. Conservative retained builder<=8MiB is checked before item/style construction. Geometry JSON<=2MiB and known resident<=8MiB. Native decoder/packet allocation precedes JS inspection; these are logical limits, not native physical heap caps.

`projectPdfTableSource(source,{regionsByPage,signal?,getUsage,isCurrent,onUsage?})`

Returns exactly `{input,usage,dispose}`. Manual region descriptors are captured before callbacks. Each selected page has exact `{number,regions}` in the same order.<=16 regions total, each `{id,name,box:{x,y,width,height},separators,rowTolerance}`; finite in-viewport boxes, ordered explicit separators and tolerance0.1..100. Names/identities are valid/unique. No automatic regions or confidence.

Projection is ONLY `{pages:[{number,viewport:{width,height,transform},items:[{text,transform,width,height,hasEOL}],regions}]}`. Every raw item maps in unchanged order, text=raw.str, including empty items. Font/style/dir extras stay raw. It does not run inference or claim a model. Separate projection8MiB admission coexists with the raw lease; over-limit rejects the whole projection.

`writeSpreadsheetXlsx(model,{sourceModel,provenance,exportTicket,signal?,getUsage,isCurrent,onUsage?})`

Inputs are immutable borrowed accepted-core data. Own model/baseline copies are validated. Returns exactly `{status,bytes,type,report,usage,dispose}`. Type is application/vnd.openxmlformats-officedocument.spreadsheetml.sheet. ready owns Uint8Array; needs-choice has bytes:null for the WHOLE workbook and cannot publish. Both statuses retain1MiB/1group conservative diagnostic ownership and a FIRST disposer. Reports are frozen<=100 `{code,sheetId,pageNumber,count}`. Malformed/limit/stale data throws typed errors; no partial success or truncation.

## Trusted local ticket and output policy

Ticket is NEW caller data, not an existing draft.exportTicket API, SDK credential or security brand. Exact own keys:

`{model,sourceModel,provenance,draftRevision,owner,sourceId,regionVersion,reviewReport,reviewedReports,projection}`

Reference fields equal actual arguments; reviewReport is actual model.reports. draftRevision/regionVersion0..100000; owner exact `{taskId,revision,generation}` with bounded nullable task ID and safe counters; sourceId is a local non-control1..100-unit token whose real source owner the caller checks. reviewedReports is an ordered<=100 own tuple copy, no fabricated report IDs. Unplaced/angle/outside/overlap/separator-crossed/empty/source-unsupported reports still block whole output after review.

Projection exact `{scope:'all',date1904,formatPolicy,columnWidths,printPolicy}`. date1904 Boolean must match source; no date-system conversion. formatPolicy source-unchanged|general, with explicit reported whole-workbook General projection. Width list follows all sheets: `{sheetId,mode,values}`, source-unchanged/null requires matching baseline; excel-units is exact-column-count values0.001..255. No relative-weight conversion/clamp. printPolicy editable|source-unchanged explicitly chooses model settings or supported original metadata. Extra/hidden/outside source data and unknown features/names require whole choice.

Own enumerable data/dense arrays only; accessors/symbol/unknown keys rejected. Scalar/width choices are copied; model/source references remain borrowed. Metadata is copied under4MiB. Baseline value/formula/cache equality and typed source part/address constraints are required; an address alone cannot graft formatting/cache.

All sheets/order/hidden data emit,>=1 visible sheet required. Absent cells omit c; present blank c has no v; empty strings use inlineStr. Literal =/+/-/@, leading zeros, Unicode/whitespace/CR remain strings. Explicit Boolean/error/finite numeric types remain typed. Current literal edits do not overwrite original raw/source. All merged underlying values emit. Hidden/height rows, explicit widths/print paper/orientation/margins/ranges remain intentional.

Only unchanged scalar source formulas with source-state matching stored cache emit f plus typed v. Missing/unverified caches, unsupported formula kinds, unsafe precision and1900serial60 date projection block. No invented zero/Date/evaluation. Formats use the existing nine-format allowlist. ST_Xstring CR/control/literal_xHHHH_ protection is separate from formula character data, cached values and allowlisted format attributes. Manual calcMode expresses stored-cache policy; other apps may recalculate, and no fresh result is promised. Default typography is an explicit style projection; originals remain externally retained.

Five fixed ZIP parts plus<=16 worksheets, UTF8 names, fixed timestamp, correct local/central CRC32/size/offset/EOCD; no macros/external links. Each part<=4MiB; expanded XML/final ZIP<=8MiB,<=21 entries. XML uses premeasured4KiB chunks and bounded yielding CRC/copy loops. No zipStore/XLSX.read/write shortcut. Index/plan profile<=12MiB inside32MiB build scratch; larger plans reject whole output.

## Joint ownership and callback boundary

usage/onUsage have exactly five numeric fields: resourceBytes/resourceCount/artifactBytes/expandedBytes/expandedCount. getUsage returns `{snapshot,live}` using the actual full canonical metadata object, with required own scalar validation. All OTHER owners remain in live. Caller creates an exact lease handle before invocation, exposes onUsage to other owners and excludes ONLY that handle from its own callback. OldA/history/source/SDK/fonts/canvas/pendingB/review/result/handoff copies share unchanged512MiB/96MiB/128. Producer statistics do not establish native bounds.

Source starts13MiB/17groups plus two source-sized artifact copies, grows before serialization and releases decoder/worker ownership only after FIRST native drain. Projector admits8MiB/2groups alongside raw. Writer starts53MiB/5groups:48MiB validator+4MiB metadata+1MiB diagnostics. Only validator.getUsage excludes that exact48MiB/2group stage so unchanged validator adds it once. Stage remains authoritative externally through FIRST. Build admits actual own models+37MiB (32build+4metadata+1diagnostics). Actual output lease is acquired BEFORE allocation/staging credit. Resident ready keeps1MiB diagnostics+actual artifact bytes; needs-choice still owns1MiB.

Inference remains external: retain ONE80MiB/4group authoritative handle through FIRST inferPdfTables AND its validator. Other owners see80MiB. Only infer.getUsage excludes that exact handle because inference internally adds32+48MiB. Raw/projection/other pending owners remain. onUsage32/zero cannot credit80 early. Register returned validated model before releasing stage. Own tiny integration proves this with real full canonical snapshots and unchanged inference/model APIs.

Mandatory synchronous isCurrent(context) samples actual draft.model()/source(), revision, retained source/provenance/region/report identity and canonical tuple; reader context binds actual source/selection before draft exists. It samples owner last and returns false on replacement. Usage/status callbacks finish, then last isCurrent, then genuine signal/closing/fence guards, then callback-free transfer. A dishonest trusted predicate cannot be detected by ticket equality. These cores never adopt canonical state; real publisher integration is later.

One lane per exact getUsage callback rejects reentry before producer inspection. It lasts through FIRST result disposal and retains cleanup fence. Separate callback identities have separate owners: caller MUST retain failed operation/error lease and refuse successors for that source owner. This is not a new pool, global caller policing or invented drained API.

## FIRST, deadlines and tests

Early operation/FIRST markers precede callbacks/native getter inspection. Exact false/0/undefined reasons survive. Task/page/reader and FIRST jobs remain strongly held. Each read is observed; cancel/release/page cleanup/task destroy each runs once per handle. Failure awaits FIRST work before zeroing own buffers/releasing usage. Disposer returns the same FIRST promise. Automatic30s operation cancellation plus5s cleanup envelope: missing/throwing native promise inspection, cleanup/release failure or expired cleanup caches one typed CLEANUP with exact cause/held handles/jobs/conservative reservation. Public timeout never means release/physical exit. Late settlement cannot publish or remove fence. Borrowed/canonical originals remain unchanged. Disposed DTOs must be discarded even when immutable JS references still exist.

Own portable tests cover real full populated/empty canonical metadata; raw whitespace/styles/rotated viewport/source bytes; strict projection/manual capture; unchanged inference80MiB and validator48MiB integration; every ZIP local/central CRC and all XML; literal/blank/absent/merge/type/cache/date/format/print; needs-choice; early budget/busy/held callbacks; final usage/current abortfalse/owner changes; failed-release FIRST identity/falsy causes; synthetic-clock automatic deadline/late settlement. Synthetic native facades are not real PDF.js evidence. Initial failures/corrections are retained privately.

No old suites, native/browser/SDK execution, assets/network, fixtures/server/Git changes. Root independent source review and actual pinned PDF.js/saved-XLSX public reopening remain. Grid, PDF print geometry/content, Download/Use/rail/current-original, mobile/keyboard/locales and final service acceptance are open.

Primary schema context supplied by Root: [ST_Xstring](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oe376/bd0aa042-434a-4ca7-b25f-4e1fd25a954d), [formula/cache](https://learn.microsoft.com/en-us/office/open-xml/spreadsheet/working-with-formulas), [calcMode](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.spreadsheet.calculationproperties.calculationmode?view=openxml-3.0.1). This worker performed no web/SDK lookup.


## Focused review corrections

SSX-01: Only the PDF.js text-stream adapter supplies one stable, bounded actual Error to native cancel. The original genuine signal/internal failure remains separate and exact, including false/0. This does not alter Fetch/DEFLATE cancellation or shared PDF readers. FIRST cancel/destroy remain one per handle.

SSX-02: Zero onUsage is a prospective release acknowledgement. Owned buffers/references stay intact while it is pending. Cleanup checks the same cached fence after every awaited native/work/observer boundary and before credits/removal. A5s expired observer cannot later zero authoritative pending/declared usage, drop held resources or admit that same owner. The FIRST disposer and error remain identical. A timely acknowledgement releases own buffers once; callers must retain the conservative operation reservation until acknowledgement succeeds, and retain a fenced reservation after failure. A zero notification or observer-promise resolution alone cannot credit an external lease: FIRST disposal success confirms release; a cached CLEANUP retains the maximum reservation after any late observer settlement.

SSX-03: Loading-promise inspection and public task-destroy capture are independent attempts after acquiring the task record. A throwing/missing promise cannot skip an available destroy. The first uncertainty/error remains even if destruction succeeds; destruction cannot substitute for an uninspectable loading FIRST or prove physical exit.

SSX-04: Supported Print_Area uses the accepted reader's1..10-digit localSheetId string. It must select an existing baseline sheet and a single in-profile A1 rectangle with matching quoted/unquoted sheet name, valid apostrophe escaping and no unions/external references. Duplicate/unknown/malformed or baseline-contradictory names refuse the whole workbook. Source-unchanged preserves its supported original definition; editable print policy emits current model range with an explicit print-area-projection report, including deliberate range removal. Shared reader representation is unchanged.


SSX-05: nativeProperty unwraps a cause only when an actual non-null cached fence exists and the caught value is that identical fence. Otherwise the caught value goes unchanged to the first fence, including null/false/0/undefined/empty string. The initial null sentinel cannot become a TypeError or lose precedence to later destroy failure. Independent destroy acquisition/one attempt, charged uncertainty, genuine pending FIRST and cached error identity are unchanged. Only new SSX-05/null controls are rerun; closed SSX-01..04 and prior suites retain their existing evidence.
