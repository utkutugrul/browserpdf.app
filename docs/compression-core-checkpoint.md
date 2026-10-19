# Structural compression core checkpoint

This is the pure-core Phase 3 checkpoint based on accepted annotation commit
`a28b4ee4845288c91322bd78e912c60556cdea7e`. It does not change the Compress
route or establish a browser-delivered compression capability. OCR,
spreadsheets, the raster choice, complete locales/platform work and final
all-32 acceptance remain open. No browser, shared fixture generator, server
lifecycle, dependency, SDK, commit, push or deployment action was performed.

## Implemented files and public boundary

`public/js/core/pdf-compression.js` exports `COMPRESSION_LIMITS` and:

```js
optimizePdfStructure(bytes, {
  pdfLib, pdfjs, pdfjsAssets, canvasFactory, signal, onProgress, capabilities,
  compressionStreamFactory, decompressionStreamFactory,
})
```

The input is a nonempty `Uint8Array`; the core copies it before parsing. An
intrinsic typed-array byteLength getter and intrinsic `Uint8Array.prototype.set`
create a plain owned `Uint8Array`, including for ordinary Node Buffers and
subclasses. Input-controlled slice, species, iterator and shadowed byteLength or
length getters are not used.
Engines/canvas are injected. Native factories default to
`new CompressionStream('deflate')` and
`new DecompressionStream('deflate')`; no library, font, UI, or network module is
imported by the core. Optional native factories support deterministic failure,
boundedness and cancellation tests. Progress contains phase/count metadata.

The pinned public pdf-lib 1.17.1 interfaces are
`PDFRawStream.of(dict,Uint8Array)`, `getContents/getContentsSize`,
`PDFDict.clone/entries/lookup/get/has/set`, public string/name `asString`, and
`PDFContext.assign/lookup/enumerateIndirectObjects`. Loading uses
`ignoreEncryption:false`, `throwOnInvalidObject:true`, `updateMetadata:false`.
Saving uses `useObjectStreams:true`, `addDefaultPage:false`,
`objectsPerTick:25`, `updateFieldAppearances:false`. AcroForm is inspected by
catalog lookup; production code never calls `getForm()`, which could create a
form or remove XFA. No page copying, form flattening, appearance generation,
font embedding or metadata editing occurs.

WHATWG's [Compression Standard](https://compression.spec.whatwg.org/) defines
native `deflate` as zlib/RFC1950 with DEFLATE/RFC1951. Adobe's
[PDF32000-1:2008](https://opensource.adobe.com/dc-acrobat-sdk-docs/standards/pdfstandards/pdf/PDF32000_2008.pdf),
Table 5 and section 7.4.4, defines matching FlateDecode and the external stream
dictionary semantics. Installed pinned types and source are the version
authority. Exact primary-source discovery is retained at
`/tmp/browserpdf-phase3-engines-phase0-20261019.md`.

## Transform, bounds and verification

The core deflates only sufficiently large unfiltered raw streams. It skips
existing Filter, DecodeParms and external F/FFilter/FDecodeParms entries;
cross-reference/object-stream bookkeeping never becomes an optimized content
stream. Encrypted inputs and linearization offset hints reject. A smaller
encoded stream replaces the same indirect reference, using a cloned dictionary
with FlateDecode and the original decoded bytes. There must be at least one
actual stream optimization and a smaller final PDF. A reserialization alone
never qualifies as compression.

Admission limits are 80 MiB input/output, 250 pages, 25,000 application objects,
16 MiB per eligible raw stream and 64 MiB eligible streams in total, and 64 MiB
retained compressed streams. Direct graph depth is 64; descriptor budgets are
8 MiB and 100,000 nodes. Keys, prefixes, delimiters and brackets count before
concatenation. Escaped JSON string UTF-8 size is counted incrementally before
JSON.stringify allocation, including quotes, control escapes, backslashes,
multibyte characters, valid surrogate pairs and isolated-surrogate escapes.
Text item arrays reserve their complete exact JSON size before serialization;
raw PDF strings and hex strings reserve their public `asString` payload,
wrapper and length prefix before `toString` allocation. Annotation arrays and
typed arrays preflight their lengths and
iterate without making an `Array.from` copy. Text streams count at most 1M
UTF-16 characters, 200,000 items and 8 MiB serialized descriptors per source or
result, and annotations at most 10,000 with the finite descriptor budget.
Native parser, renderer and codec heaps are not hard application-memory bounds.

Native transforms write 16 KiB chunks with backpressure while reading output
concurrently. Output is counted before retention. Cancellation cancels the
reader, aborts the writer and waits for both ends and the writing job to drain.
Every asynchronous parser/save/text/render boundary checks AbortSignal. PDF.js
loading tasks are destroyed and drained. PDF.js text-reader cancellation always
receives an actual Error, including arbitrary non-Error AbortSignal reasons;
the active cancellation promise is retained and awaited before releasing the
reader lock. Render tasks cancel before their
canvas is released. Rejected work returns no publishable candidate.

The strict reopened candidate must retain every original application reference,
direct dictionary/array/primitive value and Root/Info/ID/Encrypt trailer value.
pdf-lib consumes writer-generated XRef/ObjStm bookkeeping during public loading;
the reopened application graph must have the same reference set. Serialization
updates stream Length values, so every other stream dictionary entry is checked
and exact stream contents are verified separately: untouched streams keep their
**encoded** bytes, while optimized streams must decode through the native
bounded inflater to their exact original bytes. The added filter must be
exactly FlateDecode. Missing/new application references, metadata or field-value
changes reject.

Every page additionally has exact PDF.js text-item, inert annotation and
geometry comparisons. Rendering uses the same injected canvas factory, opaque
2D context options, white background, viewport and annotation mode for source
and result. Pixel arrays must be identical; no tolerance or normalized image
comparison is used.

Before canvas allocation, the complete render plan starts at scale
`min(1,1200/longestEdge,sqrt(2M/pageArea))`. It counts both source/result integer
canvases across all pages. If the total exceeds 48M pixels, one common factor
reduces every page's scale until the full plan fits. The finite exact per-page
resolution is returned in verification metadata. This proves parity at those
bounded resolutions, alongside exact graph and text checks; it does not claim
full-resolution rendering of arbitrary PDFs. Canvases are zeroed in finally.

The finite result includes PDF bytes/type, actual input/result sizes,
`reduced/retainedOriginal`, stream/skipped counts, known inherited capabilities,
and verification counts/resolutions. Structural compression retains known
searchable/forms/rasterized facts and verifies unencrypted input/output. A
selected rewritten output records the existing `signature-rewrite` loss and
makes no signature-preservation claim. A no-op, nonreducing stream, or larger
saved candidate returns byte-identical original bytes with an explanation and
no rewrite loss. The second pass is byte-identical.

## Portable Node evidence

`tests/pdf-compression.unit.mjs` generates its own PDFs using pinned pdf-lib and
uses installed PDF.js 6.2.108 with `@napi-rs/canvas` for same-environment pixel
comparisons. It does not consume Root's private corpus or rewrite shared
`test-fixtures/generated` files.

The first retained complete invocation passed **8/8**, zero failed, cancelled,
skipped or todo, in **2,080.145958 ms**. Its TAP is
`/tmp/browserpdf-compression-owner-core-recorded-20261019.tap`. An earlier
invocation exposed only its first two passing cases before its process handle
was lost; no full result is claimed from that incomplete output.

After adding real high-entropy no-gain/larger-candidate retention and exact
descriptor/typed-array admission cases, the complete gate passed **11/11**,
zero failed, cancelled, skipped or todo, in **2,796.881542 ms**:

```sh
rtk proxy env BPDF_COMPRESSION_ARTIFACT_DIR=/tmp/browserpdf-compression-owner-core-expanded-20261019/artifacts node --test tests/pdf-compression.unit.mjs > /tmp/browserpdf-compression-owner-core-expanded-20261019.tap 2>&1
```

The own source PDF is **78,255 bytes**; the actual optimized PDF is
**3,543 bytes**, about **95.47% smaller**. One 70,010-byte raw vector stream is
optimized; seven existing filtered streams retain exact encoded bytes. Its
prefilled text field, checked checkbox, URI link, font resources, outline,
metadata, ID and selectable literal punctuation survive strict graph/content
checks. Paired same-context render verification covers **678,300 pixels**.
Source/result PDFs, four-rotation PDFs, second-pass PDF and a finite report with
SHA-256 values are retained in the command's `/artifacts` directory.

The eleven cases cover actual reduction/fidelity; second-pass, filtered/small
and high-entropy byte identity; larger candidate retention; all four rotations,
nonzero CropBox/UserUnit; untouched unsupported stream policy and linearization
rejection; input/page/object/raw-stream admission before canvas allocation;
serialized overhead from 50,000 empty dictionaries; oversized annotation arrays
and typed arrays before traversal/copy with both parser tasks destroyed; native
corruption, failed save/reopen and changed graph; held native cancellation/drain
and a real successful successor; and a separately injected 250-page render-plan
budget check. The last case tests planning through public-runtime facades, not
250-page actual artifact fidelity. Syntax checks passed for both new modules.

## Fresh review, retained failures and corrected gate

The fresh independent review at
`/tmp/browserpdf-compression-core-fresh-review-20261019.md` found two real
rejection-path defects after the eleven positive cases passed. Its preserved
actual-runtime text-limit probe passed `undefined` to the pinned PDF.js text
reader cancellation API, which requires Error. Cancellation rejected, teardown
then raised an uncaught closed-controller error, and that probe exited 43. A
private one-line cause proof is retained by the reviewer; it was not substituted
for a production correction. The second probe showed a 4,300,000-character
quoted annotation serialized to 8,600,002 bytes before rejection against the
8,388,608-byte descriptor bound. Those source PDFs, scripts, logs and reports
remain unchanged in the review's private directory.

The correction supplies and retains one Error cancellation promise, drains it
on limits/abort, and performs exact escaped UTF-8 string admission before JSON
serialization. Prefix/key and raw PDF primitive construction have matching
pre-concatenation reservation. A separate Root ownership review also identified
the accepted Buffer/subclass slice-alias risk; intrinsic plain copying corrects
that boundary without changing the API or caps.

The first complete corrected invocation passes **16/16**, zero failed,
cancelled, skipped or todo, in **4,497.562208 ms**:

```sh
rtk proxy env BPDF_COMPRESSION_ARTIFACT_DIR=/tmp/browserpdf-compression-owner-core-corrected-first-20261019/artifacts node --test tests/pdf-compression.unit.mjs > /tmp/browserpdf-compression-owner-core-corrected-first-20261019.tap 2>&1
```

It includes all original eleven cases plus five regressions:

* An actual generated PDF.js over-budget text stream produces the intended
  RangeError, exactly one valid Error/RangeError cancellation resolves and
  drains, both parser tasks finish destruction, and no canvas is allocated.
  A subsequent real structural optimization succeeds with verified pixels;
  all four parser tasks across the two operations are destroyed.
* A custom string AbortSignal reason on actual PDF.js text becomes a valid
  cancellation Error. An intentionally held cancellation completion prevents
  the operation from settling until release. Both tasks destroy, then a fresh
  real document succeeds.
* Real quoted and control-character Text annotations exceed escaped descriptor
  admission before native JSON.stringify sees their large primitive strings.
  Each actual payload is observed from PDF.js twice; both cases record zero
  oversized serializations, zero canvas allocations and both tasks destroyed.
  A real successor also succeeds.
* Ordinary Buffer inputs pass actual parsers on both optimized and no-op
  paths, remain immutable, and produce independently owned plain Uint8Array
  output; mutations across the returned/input boundary remain isolated.
* An accepted Uint8Array subclass with poisoned slice, species, iterator and
  shadowed byteLength/length getters invokes none of them, retains its exact
  input, and completes actual optimization/pixel verification.

The corresponding own PDFs and finite rejection/drain reports are in the new
command's `/artifacts` directory. The earlier 8/11-case evidence and Root's
independent 69,950-to-3,753-byte report at
`/tmp/browserpdf-root-compression-core-first/report.json` remain historical
pre-correction normal-path evidence. The corrected sixteen-case gate does not
erase either review finding or establish browser-route delivery. Corrected
core and tests remain frozen for fresh independent review; acceptance is held
until that review passes.

## Held acceptance

Fresh independent core/artifact review is required before callers lock this
API. Compress route/native intake/review/Use/final-download work, lossy raster
choice, shared continuation capability/loss-list changes and native browser
artifact gates remain held until separately reviewed and allocated. The 80–250
MiB inherited read-only policy is accepted design only. No app-delivered
compression claim, locale completion or all-32 completion is made here.
