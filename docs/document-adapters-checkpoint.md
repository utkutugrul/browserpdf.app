# Pure document adapters checkpoint A

This checkpoint adds direct DOCX reading, finite literal document models,
actual DOCX writing and plain-text serialization in six new owned paths.
It is ready for fresh review. No route, font, session, result, workspace,
loader, dependency, browser or server change is included. The accepted ZIP/model
foundation and existing stored ZIP writer remain unchanged.

The reviewed proposal is retained at
`/tmp/browserpdf-document-adapters-contract-20261019.md`. Markdown reader and
serializer checkpoint B remains unimplemented. This is a pure structural and
logical document checkpoint, with no completed document service or general
Office layout/rendering claim.

## Public operations and ownership

`readDocxDocument(input,{signal,onProgress})` returns a promise of
`{model,modelBytes,sourceBytes,assets,report,usage,dispose}`. It accepts actual
Blob/File, ArrayBuffer and Uint8Array types through the accepted admission API,
including Buffer and cross-realm byte inputs. It always owns a completed
`admitOoxmlArchive(...,{kind:'docx'})` before structural parsing. There is no
caller-supplied admitted-parts overload or validation bypass flag.

The returned model is a fresh `validateDocumentModel` result. `modelBytes` is
its UTF-8 JSON, `sourceBytes` is an independent original DOCX copy, and each
asset is `{id,type,bytes,width,height}` with standard owned Uint8Array bytes.
`dispose()` zeros the operation's captured buffers and releases its internal
byte references. It is idempotent, does not traverse caller-replaced arrays,
and does not mutate input bytes. JavaScript string erasure is not claimed.

`buildDocxDocument(model,{assets,paper='letter',landscape=false,margin=56,
signal,onProgress})` returns `{bytes,type,report,usage}`. `type` is the exported
`DOCX_MIME`. Paper is letter/A4, margin is 0 to 72 points, and assets have the
same explicit five fields listed above. Model validation and standard dense
asset array checks precede traversal. Native brand getters and intrinsic
copies bypass caller slice/species/iterator/method overrides, including Buffer
slice aliasing. Arbitrary duck-typed byte producers are rejected.

`documentToPlainText(model,{pageLabels=false,pageBreaks=false,imageAlt=true,
signal})` returns a literal string. It preserves run characters and whitespace,
uses explicit paragraph/newline and cell/tab boundaries, and optionally emits
source-page labels, form-feed page breaks and alternate text. It introduces no
Markdown punctuation, list numbering or formatting markers.

Settings require plain own enumerable data fields; accessors, hidden/unknown
fields and controlled array traversal methods cannot bypass checks. Signal and
progress callback are the explicit operational fields. Results remain
ephemeral. None of these operations adopts a canonical document, writes history
or storage, fetches a URL, loads a library, navigates or downloads a file.

## Admission and XML responsibility

`ooxml-zip.js` retains sole responsibility for every-entry raw/expanded byte
admission, complete record envelopes, CRC, native inflater drain, strict XML
encodings and lexical well-formedness, DTD/entity rejection and package XML
node/depth/attribute limits. This includes XML not retained for conversion.

The new internal `document-xml.js` consumes this operation's admitted parts.
It adds namespace-expanded element/attribute matching, unbound/reserved prefix
and duplicate expanded attribute checks, bounded namespace frames and immediate
start/text/end events. It deliberately normalizes XML source line endings and
attribute whitespace before decoding predefined/numeric character references;
CDATA stays literal. It builds no DOM or complete Office tree and performs no
external resolution. Its exported helper is internal to this pipeline, not an
independent Office admission API or a replacement schema validator.

Structural storage is capped at 64 frames, 65536 UTF-16 units per pending token
or attribute, 1024 units per expanded name/namespace URI, 32 in-scope namespace
bindings and 256 distinct package bindings. Metadata has a shared 1-MiB JSON
budget, including content-type/relationship records, style definitions and
resolved style cache. Content-type and relationship records are each capped at
512, source IDs at 100 units and local target names at 1024 encoded bytes.
Styles are capped at 2048 definitions and 16 inheritance steps with cycle
rejection. Numbering is capped at 256 abstract definitions, 512 concrete
instances and nine levels.

## Literal model and supported Word structures

The reader resolves standard correctly typed local document, style, numbering
and image parts. Alternative main/style/numbering locations are precise
unsupported package errors. Every source archive is admitted before these
relationships are interpreted, including archives whose later model rejects.

Actual `w:t` contents, inline tabs, line breaks, punctuation and diacritics stay
literal. Paragraph `w:bidi` and run `w:rtl` remain independent direction fields;
strings are never reversed or passed through Markdown. Style defaults,
paragraph/character inheritance, toggle properties and direct on/off values
are resolved for actual runs. Complex-script bold/italic variants are separate
from Latin variants. Arabic/Hebrew automatic style selection is supported where
one exact style fits the run; conflicting mixed implicit styles reject with
`DOCX_UNSUPPORTED_STYLE`. Unrepresentable combined monospace plus bold/italic
styles also reject. Source face/size/other style losses have finite report codes.
No font loading, glyph coverage or visible shaping support follows from this.

The reader follows actual `numId -> abstractNumId -> lvl` links, start values,
instance overrides and `startOverride`. It maintains independent instance
counters, continuation and default deeper-level restart, including never-restart
levels. Decimal `%N.` and the bullet character `•` are supported. Other formats,
picture/linked numbering and unsupported restart rules reject. Model list IDs
are generated per source instance/level so each model definition has one exact
ordered flag/start. No arbitrary source IDs are copied into the model.

Simple grid tables retain cell paragraphs, empty cells and relative widths.
Missing widths are inferred with a report; merged, offset, ragged or nested
tables reject. Local PNG/JPEG media retains actual bytes, dimensions, alternate
text and physical extent. Inline/floating placement becomes ordered blocks with
an explicit layout report. Cropped, transformed and non-picture drawing
structures outside this subset reject. Images inside tables/numbered paragraphs
are unsupported. External images are blocked, with alternate text where present,
and are never fetched. Required missing or mistyped media rejects.

Header/footer, notes, hyperlinks and Office layout losses have bounded reports.
Fields, tracked changes, Office math/OLE and other explicitly unsupported
structures reject. Authored DOCX models have no guessed source page count;
explicit source page breaks remain blocks. Real Word pagination is outside this
checkpoint. Reports have at most 100 fixed `{code,blockId?}` entries without
arbitrary source warning strings or URLs.

The unchanged model caps apply during construction: one million UTF-16 text
units; 16-MiB serialized model; 10000 paragraphs/50000 runs; 500 tables/10000
aggregate rows/100 columns/200000 cells; 48 assets; finite IDs/directions/styles
and references. Incremental byte accounting charges actual serialized model
components, including table/cell wrappers and JSON keys, and is compared with
the final validated JSON size. Asset alternate text shares the text budget.

## Saved artifacts, bounds and cancellation

The writer emits actual `numbering.xml`, `numPr`, abstract definitions and
concrete per-level start overrides. A first-use nested level can add an override
to its parent's concrete instance without restarting the parent. A used level's
global override is never changed retroactively. Restarts that require another
concrete instance preserve prior paragraphs; ancestor continuation across that
nested instance change is precisely unsupported in this subset unless the
ancestor explicitly restarts. No partial output is returned on rejection.
Headings, rules, page breaks, code, table/grid/cell XML and DrawingML/media
relationships are actual Word structures. Code paragraphs require explicit code
runs. Text uses XML escaping and `xml:space="preserve"`, with real Word tab/break
elements. Chunk boundaries preserve supplementary Unicode characters.

Generated XML is capped at 8 MiB/part, 16 MiB/package and 100000 emitted nodes.
All stored ZIP bytes, names, headers, directory and end record are preflighted
before `zipStore`. The archive is capped at 32 MiB/512 parts so the accepted
admission API can reopen it. Output and prospective retained-asset budgets are
checked before copies/assembly. Plain text is capped at 8 MiB UTF-8.

A returned read bundle measures source + modelBytes + selected asset copies
against 96 MiB/128 resources before retained copies. This is no additional
capacity or heap guarantee. Future route integration must admit these against
the existing scene/task/history resources within the same shared 96-MiB/128
and 512-MiB retained-session ceilings.

Admission owns and drains native read/inflate work. Structural parsing and
builders cooperate at bounded byte/element intervals, with signal checks around
awaits. Blob reads drain before rejecting. Model validation, JSON encoding and
stored ZIP CRC/assembly are synchronous bounded sections; they do not pretend
to receive event-loop cancellation mid-call. Yield/checkpoints before final
publication allow queued cancellation to reject and release candidates. Failed
operations return no partial artifact and leave supplied bytes/model unchanged.

## Portable and independent evidence

Scoped command:

`node --test tests/docx-document.unit.mjs tests/document-text.unit.mjs`

Initial checkpoint result: **17 PASS**, zero fail/skip/cancel, 1037.524625 ms.
`/tmp/browserpdf-document-adapters-owner-20261019/final17.tap` retains the full
invocation. Earlier successful 13/16-test prefixes are retained separately;
they are not represented as a final-source freeze. Five owned JS/test syntax
checks passed. Final source hashes and unchanged foundation comparison are
recorded in the adjacent `stable-report.json`. This is retained pre-review
evidence, not the corrected-source freeze below.

Portable tests generate their own stored/real raw-DEFLATE DOCX inputs and valid
two-color PNG. They prove exact literal/Unicode/mark text, requested styles,
separate direction, source abstract start7/instance override12/continuation and
deeper restart, table/media ownership, Buffer/cross-realm/Blob safety, namespace
semantics, UTF-16 and chunk boundaries, resource rejections, real asynchronous
operation cancellation and a valid successor. They inspect actual saved ZIP
CRC/XML/media/numbering independently of reader/writer roundtrip.

An additional independent Python standard-library inspection reads final test
artifacts through `zipfile` and ElementTree, computes actual numbering values
`[7,8,12]`, checks every ZIP/XML part, actual two-by-two table/grid, PNG chunk CRC
and exact red/blue pixels, and saved Unicode logical text/styles/direction.
It passes. Evidence is
`/tmp/browserpdf-document-adapters-owner-20261019/independent-artifacts.json`.
Its executable inspector is retained alongside it and is not a portable test
dependency. Actual source/saved DOCX, plain text, model and Unicode DOCX/text
paths and hashes are in that report.

## Fresh review corrections and corrected freeze

The fresh review at `/tmp/browserpdf-docx-adapters-fresh-review-20261019.md`
found three additional real cases not covered by the initial 17 controls:
first-use nested start12 was emitted as7, markup compatibility alternatives were
concatenated, and simple fields silently became literal field results. Original
private probes and the `[7,7,8]` follow-up remain unchanged under `/tmp`.
Root's earlier six independent controls and separate Python/simple-DOCX artifact
checks at `/tmp/browserpdf-root-docx-independent-first-20261019/` remain scoped
historical positive evidence; they do not override these reviewed failures.

The corrected writer records up to nine start overrides per concrete instance.
The first child start12 now shares the existing instance with parent7 and its
continuation8. Tracking which levels have already appeared prevents a later
override from renumbering earlier paragraphs. A changed used level starts a new
instance, and an ancestor continuation that cannot retain exact restart
semantics rejects before output. This uses ordinary OOXML
[level overrides](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.leveloverride?view=openxml-3.0.1),
with no model or public API change.

The DOCX adapter rejects namespace-expanded `mc:AlternateContent`, `Choice`
and `Fallback` in every structurally consumed part before processing branch
descendants. The typed error is `DOCX_UNSUPPORTED_COMPATIBILITY`; no MCE branch
selection or full MCE support is claimed. `w:fldSimple`, `fldChar` and
`instrText` return `DOCX_UNSUPPORTED_FIELD`. Field instructions are never
evaluated or silently flattened. Names resembling these structures inside
literal text remain literal.

The three added portable tests first reproduce exactly **17 PASS / 3 FAIL**,
929.613167 ms, against the original core. Their full first invocation and
source hashes are retained in
`/tmp/browserpdf-document-adapters-corrections-20261019/first20.tap` and
`first20-source.json`. Corrected-source result: **20 PASS**, zero
fail/skip/cancel, 1096.277959 ms, in `frozen20.tap`. Earlier corrected prefixes
are retained separately. All original 17 tests remain present and pass.

The added controls inspect actual saved XML independently of readback for
`[7,12]`, `[7,12,8]` and `[7,12,8,12]`, including exact levels/restart flags,
one shared numId and the actual level1/startOverride12. Another control proves
that changing an already-used child start leaves earlier12 untouched; precise
unsupported ancestor continuation is checked rather than returning altered
numbering. Stored/deflated compatibility inputs, namespace-remapped simple
fields, immutable input bytes and literal/plain-successor controls exercise
actual ZIP inputs through public operations.

An independent Python `zipfile`/ElementTree inspection also confirms all three
nested sequences, per-level overrides, shared instance and exact restart/level
values, and verifies every retained input/output ZIP CRC and XML part. It
passes. Report: `independent-numbering.json`; actual DOCX/JSON inputs and outputs
are retained in `artifacts/`, both in the corrections evidence directory.
`stable-corrected.json` contains the final six owned hashes, source-hash history,
syntax/whitespace checks and unchanged accepted foundation comparison. The six
paths are frozen for focused fresh replay; no browser or service acceptance is
inferred from these fixes.

No browser/module gate, actual Office display or PDF typography acceptance has
run for these adapters. In particular, logical Arabic/Hebrew marks in saved
DOCX XML do not establish visible PDF shaping or saved PDF logical text.
PDF to Markdown, PDF to Word, Word to PDF, Extract Text, Markdown to PDF and
Viewer each remain open services. Markdown B, fonts, canonical resource
integration, editable correction/workspace, output previews, actual manual
download, initial handoff guards, locales/platform and final all32 gates remain.

Primary style semantics consulted include Microsoft's
[complex-script bold](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.boldcomplexscript?view=openxml-3.0.1)
and [run direction](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.righttolefttext?view=openxml-3.0.1)
documentation. The exact APIs used here are first-party source and public
platform/standard-library APIs; no dependency or undocumented runtime argument
was introduced.
