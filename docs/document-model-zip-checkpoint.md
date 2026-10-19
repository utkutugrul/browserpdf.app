# Bounded Office intake and logical document foundation

This checkpoint begins at verified `a28b4ee4845288c91322bd78e912c60556cdea7e`.
Root approved only new `core/ooxml-zip.js`, `core/document-model.js`, owned
portable tests and this documentation. Callers, session/result integration,
fonts/loaders/dependencies, routes and browser acceptance remain separate gates.
No document service is complete from these foundations.

Implemented APIs are `admitOoxmlArchive(input,{kind,signal,onProgress})` returning
`{kind,bytes,entries,parts,stats,dispose()}`, and
`validateDocumentModel(value,{signal})` returning a separately owned finite
model. `kind` is explicitly `docx` or `xlsx`; archive inputs are File/Blob,
ArrayBuffer or Uint8Array. The result appears only after every entry's size,
CRC and XML checks. `dispose()` clears/zeros its owned retained bytes and is
idempotent; callers must finish with those bytes first. The synchronous model
schema requires version/origin/pages/lists/blocks/assets/warnings and rejects
unknown fields, accessor properties and sparse/extra-index arrays.

The ZIP contract validates complete local-record envelopes: header, encoded
name, extra fields, compressed payload and optional descriptor. Their half-open
ranges cannot overlap one another, the central directory or end record/comment.
Non-ASCII names require the ZIP UTF-8 flag; unflagged names are ASCII only,
avoiding different legacy-decoder interpretations. Percent-encoded part names
are explicitly unsupported, avoiding URI/path aliases before caller lock.
Method 0 and native method 8 raw DEFLATE are supported; all entries consume the
actual expanded-byte/CRC budget, including discarded entries. Decompression
cancellation caches and awaits the FIRST abort/cancel promises, both current
read/write jobs and their completion before settling; repeating reader.cancel
does not establish draining of the first underlying cancellation. No fallback
inflater or new dependency is introduced.

XML admission is an incremental lexical scan before downstream Office/DOM
parsing, including unretained XML and content-types-declared XML regardless of
extension. DTD/entity declarations and unsupported declarations are rejected.
Only strict UTF-8 and BOM/pattern-consistent UTF-16LE/BE XML 1.0 are admitted;
encoding declarations must agree. Node/depth/attribute counters run during
the scan, not through an unbounded DOM walk. XML names are bounded to 1,024
UTF-16 units; content-type declarations/prolog tokens to 4,096. General XML
attribute values are scanned without accumulating them. Predefined/numeric
character references are validated; external/general entities are unavailable.

Limits are raw ZIP 32 MiB, 512 entries, central directory 1 MiB, encoded names
1,024 bytes, every-entry actual expansion 64 MiB, individual entry 16 MiB,
XML part 8 MiB, retained XML 16 MiB, package XML nodes 100,000, depth 64 and
32 attributes per element. Retention is deterministic by package kind/path;
there is no selection argument. PNG/JPEG assets have 16-MiB/4,096-edge/16M-pixel
limits, 48 retained assets and 48 MiB aggregate. Promotion to selected model
assets is a later reader operation.

The pure logical model retains literal logical run text, requested styles,
paragraph/run direction, source page/OCR provenance, real list start/restart,
simple table cells and owned image references. IDs and references are finite
and validated, with uniqueness across block/asset/list definitions. Warnings
use a finite code enum, at most 100; confidence is 0–100; finite boxes have
bounded position/extent. No arbitrary metadata or remote image URL is retained.
Model text is at most one million UTF-16 units, serialized model/plan 16 MiB,
paragraphs 10,000, runs 50,000, fragments 200,000 and source/output pages 1,000.
Tables are at most 500, aggregate rows 10,000, columns 100 and total cells 200,000.
Proposed retained models (six) and output (96 MiB/three alternatives sharing
96 MiB) are future integration caps, not extra session capacity. Shared
resources must remain within existing 96 MiB/128 resources and 512 MiB retained
session; no history eviction to admit resources.

Validation is synchronous with bounded periodic AbortSignal checks. It cannot
receive event-loop cancellation while executing. ZIP reading/inflation/XML
scanning cooperatively yields at bounded byte intervals and checks cancellation
around awaited work. These application limits do not guarantee native heap.

Open service checklist: PDF→Markdown, PDF→Word, Word→PDF, Extract Text,
Markdown→PDF and Markdown Viewer each still require their own route/model/edit/
actual saved artifact/continuity evidence. XLSX grid/reference preflight,
typography/shaping and shared session/result seams await separate approval.
Portable tests create their own data; Root's private corpora are comparison
evidence only. No browser, commit, deployment or full-program acceptance is
claimed here.

The first complete author Node invocation passes **22/22** in
**3,823.088333 ms**, zero failed/skipped/cancelled, retained at
`/tmp/browserpdf-documents-foundation-20261019/second-invocation.tap`.
The initial invocation had eight model passes and a ZIP-spec syntax compile
failure before ZIP execution; its exact summary/source hashes remain in
`first-invocation.json`. Later source corrections require their own postfix.

The complete author postfix passes **22/22** in **3,798.4395 ms**, zero
failed/skipped/cancelled, at
`/tmp/browserpdf-documents-foundation-20261019/postfix-invocation.tap`.
It includes decoded character references in content-types, optional-extension
XML-looking malformed UTF-8, exact dense/accessor-free nested model arrays,
aggregate table rows and first-underlying-cancellation draining. Tests generate
independent real stored/raw-deflated archives; none imports Root's corpus.

Native compressed trailing-byte rejection by this module remains an allocated
browser gate. Root independently
observed Node's raw inflater accepting a known-good stream plus one zero byte.
CRC and expanded size therefore do not prove exact compressed-input consumption;
no such native API is assumed. The allocated source-frozen browser gate must
exercise real trailing-byte data. Root's separate private about:blank-only probe
on pinned Chromium **151.0.7922.34** accepted a real 969-byte raw control with
exact 3,514-byte output, rejected control+zero and rejected truncation. Evidence
is `/tmp/browserpdf-native-rawdeflate-feasibility-20261019/report.json`.
This establishes target-native feasibility only; it did not import the app or
test this ZIP module. Node v22.23.1 differs from the WHATWG trailing-byte
requirement. No downstream caller is approved on the basis of these Node
results, and no production typography change is included.

Fresh independent review found three real foundation defects after the original
22-case gate: input-controlled array methods could bypass model validation;
Buffer/overridden slice could alias and then erase the caller's source on
disposal; and the XML scanner rejected empty comments while admitting malformed
text/whitespace/declarations. The review and original public-API, ownership,
Buffer and independent ElementTree probes remain at
`/tmp/browserpdf-ooxml-model-fresh-review-20261019.md` and its indexed evidence.
The original five hashes are retained in `review-corrections-prefix.json` beside
the author reports. Earlier passes did not cover these defects.

The narrow corrections require plain enumerable own JSON data properties,
full own-key inspection and standard dense arrays. Array entries are copied by
descriptor/index into fresh standard arrays before traversal; input methods,
constructors/species and iterators cannot skip validation. Hidden/symbolic/
undefined fields reject, and serialized budgeting counts the copied fields.
ZIP intake uses intrinsic brand getters and byte copy into a fresh standard
Uint8Array for actual Uint8Array (including Buffer), ArrayBuffer and Blob/File
inputs. Caller slice, iterator, byte getters and Blob read overrides are not
called; duck-typed byte producers reject. Disposal cannot erase caller bytes.

The bounded XML scanner now accepts empty comments, rejects literal `]]>` in
text, uses exactly space/TAB/CR/LF for XML syntax whitespace and validates the
XML 1.0 declaration's exact start position, uniqueness, pseudoattribute order,
quotes, version, encoding and optional yes/no standalone flag. Ordinary PI,
comment and CDATA controls remain supported. Stored-entry tests split the
comment/terminator controls across the actual scanner feed boundaries.

The first correction invocation was **28 passed / 1 failed**, **4,401.336584 ms**,
zero skipped/cancelled, at `review-corrections-first.tap`. All product assertions
reached by the ownership case passed, then its helper misidentified an accepted
cross-realm ArrayBuffer as a Blob using instanceof. The helper now uses native
brand getters too, and also checks overridden byte getters. The complete
corrected invocation passes **29/29**, **4,388.22675 ms**, zero failed/skipped/
cancelled, at `review-corrections-postfix.tap`. These are author Node results;
fresh review and the actual-module browser gate remain required.

Root's earlier isolated actual-module Node comparison was **39/41**: valid
empty comment rejected, and an oversized 9-MiB XML case hit Node v22's native
InflateRaw adapter `ERR_INVALID_STATE` instead of returning a rejection.
`/tmp/browserpdf-root-ooxml-foundation-isolated/report.json` preserves those
outcomes. No speculative runtime patch was made. Target-browser budget,
cancellation and error-free successor behavior still require the allocated
gate, separately from the documented Node trailing-byte discrepancy.
