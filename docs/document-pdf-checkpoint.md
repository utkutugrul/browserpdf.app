# Finite document PDF checkpoint C

This checkpoint adds only `public/js/core/document-pdf.js`,
`tests/document-pdf.unit.mjs`, and this document on base
`6128885994660350728451cbdbf4d9e48be16893`. It implements a pure model-to-PDF
candidate and source layout. Root accepted this bounded pure-core checkpoint
after corrected owner tests, focused independent re-review, and separately
allocated native browser proof. It does not complete a document service or integrate
an editable workspace, font loader, preview, route, session, or download.

## Public contract

`preflightDocumentPdf(model, {fontkit, fonts = []}, options)` returns a Promise
with `status`, `fontRequests`, `missingFontIds`, `issues`, `report`, and `usage`.
Status is `unsupported`, `needs-fonts`, or `ready`. Ready additionally owns
`layout`, `layoutBytes`, and an idempotent `dispose()`.

`buildDocumentPdf(model, {pdfLib, fontkit, fonts = []}, options)` repeats current
model admission and returns genuine `application/pdf` bytes, `layout`,
`layoutBytes`, `report`, `usage`, and `dispose()`. It refuses unsupported content
or missing fonts before PDF creation. An empty, image-only, rule-only, or
hard-break-only document with no generated list marker requests no font and
does not inspect or require fontkit. A genuine pdf-lib dependency is still
required to build PDF bytes.

Options have exact own enumerable data keys `paper`, `landscape`, `margin`,
`assets`, and `signal`. Defaults are Letter, portrait, 48 points, and an empty
asset array. A4 and landscape are supported; margin is finite 0 through 72.
Arrays must be standard and dense. Signals are actual AbortSignals, checked
through captured intrinsic methods. Hidden, symbolic, accessor, extra, sparse,
and subclass producer data are rejected. The accepted validator owns a fresh
logical model. Literal text is never passed through Markdown syntax.

Font records are `{id, bytes}`. Image records are
`{id, type, bytes, width, height}` and must match a model-owned PNG/JPEG asset.
Actual Uint8Array (including Buffer and cross-realm Uint8Array) and ArrayBuffer
bytes are intrinsically copied into fresh standard Uint8Arrays. Actual
Blob/File image bytes use a captured native arrayBuffer call. Producer slice,
species, iterator, and overridden methods are not used. Every supplied image
is admitted before selection; missing, duplicate, extra, and mismatched IDs
reject. Unreferenced model assets create no PDF image resource. Dispose closes
over the actual returned buffers, so replacing result properties cannot erase
input bytes or escape cleanup. There is no fetch, URL, DOM, cache, adoption,
history, output publication, or source mutation.

## Supported text and fonts

Trusted injected dependencies are the existing pdf-lib 1.17.1 and public pinned
Fontkit 1.1.1. Fontkit layout uses its documented two arguments. Each call gets
a fresh `{kern:false, liga:false, clig:false}` feature object because Fontkit
mutates that object. The code uses public font metrics and PDF methods, not
positioned-glyph injection or undocumented direction arguments.

Only actual nonempty run styles, TAB space metrics, and emitted regular list
markers produce font requests. Heading appearance does not force another
style. IDs `regular`, `bold`, `italic`, `boldItalic`, and `code` pin the five
existing Noto Sans / Noto Sans Mono files and their exact byte sizes and SHA256
values from `public/fonts/provenance.json`. Source is noto-fonts commit
`c971829a87e7920f960e7277c3dafd9bedd3c601`, SIL OFL 1.1. No font, license,
dependency, shared loader, or payload changed. Supplied font bytes are copied
and checked with native SHA256 before native font parsing. Unused fonts reject.
Missing fonts need no fontkit handle. When source preprocessing is already
unsupported, it publishes zero requests and every nonempty supplied font set
is rejected as unused through the same strict own-record admission. This path
never reads font bytes, hashes them, or inspects fontkit. An explicit null font
array is invalid rather than an empty default.

The finite candidate policy covers Latin, Greek, Cyrillic, and Common script
characters with actual glyph, scalar mapping, and nominal-position checks.
It does not promise every character in these scripts is available. Explicit
RTL, unproved scripts, combining marks, bidi controls, and joiners return typed
preprocessing issues without a font request or native font layout. Arabic and
Hebrew font assets are not described as unavailable. Their saved shaping and
logical text remain unproved here. U+0085/U+2028/U+2029 are also reported as
unproved logical mapping because pdf-lib drawText rewrites them.

For each admitted native span the glyph must be nonzero, map to the exact
input scalar, and have nominal xAdvance and zero x/y offset and yAdvance.
Conflicting glyph-ID Unicode mappings reject. Each saved PDF font width is
checked against the planned width within 0.000001 point. No character
normalization, glyph substitution, style fallback, hidden alternate text, or
invisible fallback is used.

## Source layout and controls

Layout version 1 contains paper dimensions/margin, numbered pages, finite items,
and accepted source warnings. Text items retain block ID, run index, UTF-16
source range, emitted text, font/style, size, and separate run and paragraph
directions. Source page numbers remain provenance, with a reflow report.
Marker, image, rule, border, break, and empty-line items describe their actual
geometry. The saved bytes are the candidate for a future genuine PDF preview.
The layout is evidence, not a replacement HTML preview.

The model retains exact SP/NBSP, repeated and leading/trailing spaces, literal
punctuation, and original controls. CRLF, CR, and LF are visual hard boundaries.
A within-run CRLF has one source-crlf record with its exact two-unit range.
When CR and LF are separated across runs (including empty intervening runs),
two adjacent source-cr/source-lf records occupy exactly the same page/x/y
boundary and retain their actual per-run ranges. The latter LF is the
continuation of the preceding CR, not a second visual advance. Consumers must
recognize that adjacent same-boundary CR/LF pair as one boundary. Separate CR
or LF records at different boundaries each advance one line. Soft-wrap records
have empty source text and zero-length source ranges.

Tabs use content-origin anchored 36-point stops, or four actual current-font
space advances in code blocks. Whole spaces are emitted up to the stop, with
the remaining fractional advance retained in subsequent x coordinates. Stops
reset on each line. An overflowing tab moves to the next line and first stop.
A column too narrow for the stop rejects. The finite control projection report
counts TAB, CR, and CRLF without changing source strings. PDF extraction may
collapse whitespace or infer line breaks. Actual emitted glyph sequences and
visible indentation are proved separately from extractor formatting.

Body/code sizes are 11/10 points; heading sizes are 22/18/16/14/12/11. Native
ascent/descent determine baselines and minimum line heights. Overlong tokens
wrap without losing literal characters, and a glyph wider than a column
rejects. The preprocessed subset excludes unproved grapheme positioning.
Lists retain actual level, value, and restart, including parent7/child12/parent8.
Tables use weighted columns, four-point padding, 0.5-point borders, all cell
paragraphs and styles, and synchronized line bands for tall rows. A row that
fits a fresh page remains together; splitting is reported and retains row and
column identity. Empty cells add visual space without invented logical text.
Owned images retain physical size when they fit and proportionally shrink
with a report otherwise. Deliberate page breaks retain blank pages; an empty
document has one blank page.

## Bounds, cancellation, and limits

Accepted model bounds remain 1M UTF-16 logical units / 16 MiB JSON, 10,000
paragraphs, 50,000 runs, 500 tables, aggregate 10,000 rows, 100 columns,
200,000 cells, and 48 model assets. This adapter additionally bounds:

- 1,000 output pages, 200,000 combined items, 16 MiB layout JSON;
- 32 Mi charged visits, 2M native glyph requests, spans at most 4,096 units;
- five exact pinned fonts, less than 3 MiB combined;
- 16 MiB supplied image bytes, 16M aggregate pixels, 8M PNG pixels;
- 100 finite issue/report records each, at most 12 sampled code points;
- 8 MiB conservative committed operator estimate before drawing;
- 32 MiB final PDF, guarded after the single native save;
- at most 48 MiB returned PDF plus layout in two owned buffers.

Layout item/JSON, planned glyph, and operator charges precede append/drawing.
The JSON estimate reserves per-item numeric/provenance overhead and page/warning
headroom before final encoding. Planned draw and width checks count toward the
2M native glyph budget before a ready plan is returned. Rejection is
transactional; there is no truncation or eviction. Native save is not a bounded
stream and has no public abort API. The core does not claim a 32 MiB allocation
or RSS ceiling. It awaits the first save with objectsPerTick50, rejects an
oversized temporary result, and clears admitted font/image buffers after save
before making the final owned copy. Returned owned resources fit within the
existing later caller reservation of 96 MiB / 128 resources; that joint limit
and retained512 MiB are not additional adapter capacity.

Synchronous model validation is finite and honestly synchronous. Cooperative
layout and parsing checks/yields occur between bounded work chunks and native
jobs. Native read/digest/font parse/layout/embed/save work cannot be forcibly
interrupted by an invented API. The first native promise is awaited; an abort
then rejects with the original reason, and candidate buffers are cleared.
Successor operations start after the held native job drains. A native library
failure also prevents publication. No browser renderer or service task is
owned by this pure module.

## Scoped portable evidence

Run `node --test tests/document-pdf.unit.mjs`. The test generates all models,
PNG/JPEG data, and timing holds locally; only repository fonts, provenance pins,
and the pinned Fontkit UMD are read. Installed pdf-lib, PDF.js, and existing
@napi-rs/canvas provide real saved artifacts, an independent parser, and raster
checks. No /tmp fixture is a required oracle and no package was added. Set
`DOCUMENT_PDF_ARTIFACT_DIR` to retain optional PDF/layout files.

The scoped suite covers actual 15 Turkish/Greek/Cyrillic/style combinations,
five saved fonts, per-run native requests, unsupported preprocessing, literal
math and SP/NBSP, exact saved content/ToUnicode glyph sequences, PDF.js visible
text, tab/control source ranges, cross-run CRLF, code wrapping and four-space
raster indentation, list7/12/8, multiparagraph tall-row tables, blank pages,
paper geometry, and independent red/blue PNG/JPEG pixels. It also covers
Buffer/ArrayBuffer ownership, producer overrides/hidden keys, pin integrity,
page/model/column/image limits, post-save size rejection, first held font/image
embed, save and Blob-read drain, reason identity, and valid successors.

Historical owner runs are retained under
`/tmp/browserpdf-document-pdf-owner-20261019`: first14/15 (a bound fixture
expected LIMIT for single-run invalid input), second16/17 (PDF.js text-item
width excludes leading spaces), third/fourth17/18 (extractor whitespace identity
was too strong). The replacement saved-stream assertion preserves the stronger
actual SP/NBSP glyph sequence, while PDF.js is used for visible text and
raster geometry. These failures remain evidence, not overwritten passes.

Original pre-correction scoped run: 22/22 PASS in 1062.776833 ms. Twenty optional artifact
files (ten genuine PDFs and ten layout JSON files) were retained. The actual
LTR15 PDF is 41,307 bytes, SHA256
`ba36705b60c0cad7ead00486bb5d06b52d363fe662978b3364ce57d57a7cff6e`.
The original owner report, frozen manifest, and optional artifacts remain
retained separately from corrected acceptance below. These successful cases
do not imply general Unicode, source-layout fidelity, or service acceptance. Routes, shared font service, editable
correction, actual saved-artifact workspace preview, guarded intake, manual
Downloads, individual conversion/extraction services, locales/platform gates,
and the full all32 program remain open.


## Fresh-review corrections

The initial frozen 22/22 owner result and Root's actual one-page DOCX Node and
native PDF proofs remain retained at their original paths. Fresh review found
two additional cases: an uncharged repeated lookahead through empty runs in the
control layout loop, and unsupported source returning before checking supplied
font records. The original review and both private probe results remain at
`/tmp/browserpdf-document-pdf-core-fresh-review-20261019.md` and
`/tmp/browserpdf-document-pdf-core-review-probe{,-second}-20261019.json`.

Only a CR at a run's end can now look beyond that run. The helper inspects each
next run with a work charge and cooperative check/yield, stopping at the first
nonempty run. Within each paragraph/pass these scanned gaps are disjoint, so
total lookahead is linear in the number of runs. LF and within-run CR need no
lookahead. Source counting, policy, metric scanning, and layout charge and yield
through empty runs. CR/LF/TAB layout branches yield before continuing, rather
than bypassing the ordinary-text yield point. Original literal ranges and the
two co-located cross-run CR/LF records retain their single visual advance.

Unsupported source uses strict font-record admission with an empty request set.
Malformed records fail, and otherwise valid nonempty font inputs are unused and
fail with DOCUMENT_PDF_INPUT. This happens before font copying, hashing, parsing,
or inspection of fontkit. Unsupported source with no fonts still returns its
precise issues and no font requests. There is no fallback or eager font load.

Seven portable focused tests reproduced both original findings before changes
(0/7 PASS), and the first corrected focused run passes 7/7. Tests cover the exact
2,000-LF/49,999-empty-run corpus, charged linear work after subtracting model
serialization, a long empty-run cross-run CRLF, and cancellation scheduled only
when layout begins for LF, CR, TAB, and empty-run cases. They count work completed
before the timer runs instead of asserting machine-dependent milliseconds.
They also cover null/hidden/accessor/unknown/duplicate/unused supplied fonts on
unsupported and empty source, absence of native font work, and valid successors.
The original 22 tests and assertions remain intact. The single affected full
owned run passes 29/29 in 12207.91025 ms. The exact LF corpus now reports
2,714,149 work visits, including 249,995 additional charged visits for the
49,999 extra runs across the five passes. Layout cancellation observes its
original reason after 60 LF, 178 CR, or 94 TAB item serializations in this run;
the empty-run case stops after 80 further font-map reads instead of completing
all 11,999. These are retained observations; portable tests assert finite chunk
counts rather than exact scheduling or elapsed time.

Correction snapshots, before/after focused TAP, the affected full owned-suite
TAP, report, source diff, and exact three-path manifest are retained under
`/tmp/browserpdf-document-pdf-core-corrected-20261019`. No original artifacts or
failure evidence is overwritten. The focused correction re-review and the
separate native five-font/tall-table proof have now passed as recorded below;
route and service integration remain open.


## Final scoped acceptance

Root accepted corrected pure PDF core C after the focused review at
`/tmp/browserpdf-document-pdf-core-corrected-review-20261019.md` and its
`/tmp/browserpdf-document-pdf-core-corrected-review-20261019/evidence.json`.
Both original findings are closed for the reviewed delta. Independent replays
preserve the original abort reason, observe cancellation after 30 empty-line
serializations, retain the ready 44-page/4,001-item result and its 2,714,149
charged work visits, and reject unsupported Hebrew plus `fonts:[null]` with
DOCUMENT_PDF_INPUT. The adjacent cross-run CRLF positive retains exact ranges,
a single visual advance, and an unchanged source model without fontkit access.
The original failure prefixes and seven failing-before-fix regressions remain
retained; the independent review did not rerun the owned suite.

A new, separately allocated native first proof is retained at
`/tmp/browserpdf-root-document-pdf-native-layout-first-20261019/report.json`.
Chromium 151.0.7922.34 used the actual pinned public loaders and all five actual
fonts for Turkish, Greek, and Cyrillic text. A genuine three-page PDF preserves
65 left-column and 65 right-column tall-row markers exactly once, with a
reported synchronized row split. All three saved pages rendered nonempty PNGs.
The 39,985-byte PDF is
`/tmp/browserpdf-root-document-pdf-native-layout-first-20261019/actual-five-style-table-pages.pdf`,
SHA256 `dd3447b311738f66c7b5763aea91bdb546af28e4a3add0af1eb3bdc9a000cab8`.
The report records no browser errors or non-GET requests, unchanged source
model and closure, and a closed browser. Root separately verified the ten-file
import closure. This adds scoped actual browser/font/pagination evidence;
it does not claim complete script, visual fidelity, or service coverage.

Root's first actual DOCX one-page/three-style Node and native proofs remain
separate pre-correction evidence, along with the original twenty owned saved
artifact files. No original proof was overwritten or repeated for this final
documentation reconciliation. The corrected runtime and unit identities stay
`bbc575bd27e82bd61a3a5790f560a5027139c6937fda93be6c68c61d525c2134` and
`e0b36df46e4333f4eae88b36f61d290e12a3864a9c8fd8abcc50c30dcf203a69`.
Only this documentation changed after the corrected freeze. The final exact
three-path manifest is retained at
`/tmp/browserpdf-document-pdf-core-corrected-20261019/final-three-path-manifest.json`
for Root's allowlisted checkpoint commit. No tests, browser, research, or
caller contract was added during reconciliation.

All six document services, editable workspaces/corrections, routes, shared font
provider and copy, locales, resource/session/result integration, final user
Downloads, and the full all32 final gates remain open. This acceptance is for
the finite pure core and its scoped evidence only.
