# Literal PDF document adapter, checkpoint A

This pure checkpoint proposes no route/service completion. Services20 PDF to Markdown,21 PDF to Word and23 Extract Text still use their legacy entrypoints. No accepted intake/draft/UI/font/loader/session/result/SDK/locales API changed. The next shared seams and UI require separate Root approval.

The approved contract is `/tmp/browserpdf-pdf-document-services-phase0-20261019.md`, SHA82d018bdd4f19dcdc2cc07ce2277deab9e7b3099e7fdcb892926543ee09a7f92. Discovery used actual verified416befbd9810bbce50aec8ba4bc111ecde0473d4. This implementation owns exactly `public/js/core/pdf-document.js`, `tests/pdf-document.unit.mjs` and this document. It imports only the accepted model validator.

## Public contract and ownership

`PDF_DOCUMENT_LIMITS` is frozen. `readPdfDocument(input,{pdfjs,pdfjsAssets},{signal,admitUsage})` returns an owned reader bundle:

```
{model, modelBytes, sourceBytes, assets: [], report, usage, dispose,
 extraction, extractionBytes}
```

`pdfjs` and asset locations are trusted first-party injection. No loaders, browser globals, fonts, OCR, canvas rendering, document URL, storage, session publication, download or network client are implemented in this core. Its PDF.js calls may require the caller's already configured matching worker/assets; no offline claim follows.

The mandatory synchronous admission callback receives only finite resourceBytes/resourceCount/artifactBytes. It updates the operation's unique reservation in the existing joint ledger. Thenable returns reject. Admission and intrinsic genuine-signal checks precede raw copies, each admitted item and final allocation/publication. A caller must not fabricate snapshot values or add a separate budget. An ordinary positive real-budget control and96MiB/128-resource/512MiB negative controls are included.

Inputs are actual fixed, attached, nonshared ArrayBuffer or Uint8Array views, including Node Buffer/subclasses. Captured brand/backing/offset/length/resizable getters bypass own overrides. Shared, resizable, detached, Blob/duck inputs and other views reject. Fresh standard source and worker arrays are copied with intrinsic set and bounded views; no input slice, species, iterator or overridden backing getter executes. The original input remains unchanged after success, failure and disposal.

The bundle owns source/model/provenance bytes. Successful native work has fully drained before the bundle resolves. Its dispose caches the FIRST scheduled promise before erasure or any external release callback executes. Repeated and release-callback reentrant calls return that exact promise. It zeroes only owned attached buffers, then releases its reservation once. A transferred/detached worker buffer is not written. A rejected cleanup, including thrown false, rejects that shared promise, retains references in a nonenumerable typed CLEANUP error and leaves ownership charged. The caller must fence all native successors until page reset; there is no retry API or physical worker-exit/RSS guarantee.

Later draft integration must keep the parser reservation through successful construction, then synchronously transfer source/model ownership into draft.live and retain a keyed auxiliary provenance/producer-model lease. There must be no await, duplicate buffer charge or uncharged gap at this transfer. The captured bundle disposer releases the auxiliary lease only after draft disposal drains. No such caller integration is implemented here.

## Literal extraction and provenance

Pages are read in order through the documented `streamTextContent({includeMarkedContent:false,disableNormalization:true})`. No y/x sorting, heading/list/style/table/image inference, whitespace trimming, punctuation escaping, Markdown parsing or OCR occurs. Each TextItem becomes one regular run, including empty and SP/NBSP-only strings. A single glyph and any nonempty whitespace string count as embedded text. Paragraphs close at hasEOL; source pages have explicit page-break blocks between them, including consecutive empty pages.

Item literals and structural separators are distinct. `extraction.items` maps each page/item to its original block/run range plus hasEOL, without duplicating text or appending a newline to a returned string. Writers may add their own line/page separators; the saved artifact controls inspect these separately. Every source page appears in both model.pages and extraction.pages, with embedded/no-embedded-text status, item/text counts and finite source geometry. An empty page is not asserted to be a scan; the future UI must offer explicit original-PDF OCR rather than exporting an apparently complete empty result.

The adapter retains ltr/rtl run direction; mixed paragraphs use auto. Vertical text uses auto and a precise vertical-layout report. Rotation/skew/vertical flags are preserved per page. No ink box is fabricated from item width/height; source.box is absent. Baseline provenance is frozen; later edits may retain original page references but must not claim that edited text still matches its original item range.

This is literal identity to the text returned by pinned PDF.js, not raw-PDF operator text or a universal logical-text reconstruction. PDF.js6.2.108 documents whitespace projection to SP. Its worker still runs bidi transformation with disableNormalization enabled. Public TextStyle metadata does not establish bold/italic identity. Original fonts, images, tables, columns and headers are not reconstructed by this first subset. MD/TXT/DOCX can retain the extracted Unicode; broader saved-PDF shaping remains under the accepted PDF core's precise support policy.

Model warnings use the accepted reading-order-inferred/complex-layout enum. Eight fixed report codes aggregate stream-order, upstream projection, missing text, styles/layout limits, geometry and synthesized separator facts; counts and at most16 sample page numbers are retained. No raw text/URLs are put into reports.

## Admission and work limits

Source≤12MiB; pages≤1000; total items/runs≤50000; paragraphs≤10000; logical text≤1M UTF16; one item≤65536 units; model≤16MiB; provenance≤8MiB. Chunk caps are2048 items,131072 text units,256 styles and2MiB serialized metadata; max100000 chunks and32Mi work visits. Native chunk size is admitted on receipt, before application copying. The PDF.js100-item high-water mark is not used as a hard allocation bound.

Metadata keys, style-only/empty chunks, array indices, geometry and strings are charged before stringification/copy. Raw metadata is never stringified. Own enumerable data, dense standard arrays and finite shapes are required. Controls, unpaired surrogates, malformed geometry and excess data reject the entire candidate; there is no truncation or silent replacement.

Raw source/worker copies charge additional2N artifact bytes. Known parsing, validation, serialization and encoding scratch is admitted from bounded estimates S/P as4S+3P+4MiB and16 resources. Only admitted owned structures are stringified, and UTF8 lengths are scanned before final buffer allocation/encodeInto. Final usage conservatively charges source bytes, owned serialized model/provenance, live representations and logical text. PDF.js decoder/worker/internal JS allocations and an already emitted oversized chunk are not prebounded; no application-level native heap/RSS ceiling is claimed.

Scanning/copy/empty/metadata branches cooperate by16384 work visits or128 actions, and check captured signal intrinsics. Raw-copy blocks contain at most8192 source bytes: their two intrinsic copies charge at most16384 visits before cooperation, with total work2N unchanged. The accepted synchronous model validator remains bounded synchronous; it does not become an asynchronous cancellation API. There is no history eviction, extra pool or change to the accepted document workspace budget helper used by OCR.

## FIRST native cleanup

Task and page records are registered immediately after fulfillment, before stale checks. A reader created during synchronous abort is likewise registered before checking. Actual loading/getPage/read promises are captured; completed reader/page records are released as processing advances rather than retaining every page's extraction object.

Abort starts the exact FIRST reader.cancel and task.destroy, caches their promises and never substitutes a later call. Finally starts independent cleanup attempts even if another rejects, awaits the first jobs, releases the reader lock after cancellation/read drain and awaits task destruction. Public page.cleanup is attempted; a false return can defer native resource disposal to final task.destroy. No private page._destroy is called. Cleanup failure, including thrown/rejected false, takes precedence and keeps the lease/fence. Otherwise a genuine captured abort reason null/false/0/empty string is rethrown exactly; explicit caught-presence flags also preserve falsy native failures.

## Owned evidence

Only the new owned unit file was run. The first25/25 pass is retained at `/tmp/browserpdf-pdf-document-owner-first-20261019/first.tap` with its generated artifacts. After explicit key/index work charging and two additional aggregate/cancellation controls, the complete affected owned invocation passes27/27, zero failed/skipped/cancelled, in15070.973333ms, at `/tmp/browserpdf-pdf-document-owner-first-20261019/corrected/affected27.tap`. No earlier accepted matrix or browser was run. No first failing product invocation occurred.

The meaningful controls cover literal markup/math/SP/NBSP/empty items, all-page coverage, directions/geometry, ownership/brand/copy restrictions, strict records and aggregate caps, ordinary/near-limit joint admission, metadata-only work, raw-copy cancellation, final-admission abort, late load/page/reader fulfillment, exact falsy reasons, held FIRST cancel+destroy, failed cleanup charge/priority, exact disposer identity and valid successors.

The actual installed PDF.js control uses the existing Node canvas bootstrap and repository Noto/fontkit fixture assets. It generates a real three-page PDF with Turkish/Greek/Cyrillic literal punctuation, an image-only page and an empty page. An independent PDF.js getTextContent reference supplies item strings/EOL; the adapter preserves every returned item and all three page statuses. The test writes real Markdown, TXT and DOCX from the model, independently checks stored ZIP CRCs and Word XML text/page breaks, and reopens the saved MD/DOCX for literal text verification. This is a focused structural artifact proof, not typography, native browser or route acceptance. Portable test inputs do not depend on /tmp.

Final artifacts are under `/tmp/browserpdf-pdf-document-owner-first-20261019/corrected/artifacts/`: source.pdf, model.json, extraction.json, reference-items.json, literal.md, literal.docx, literal.txt and artifact-proof.json. Original25 artifacts remain separately retained. The final three-path manifest records source/test/doc and unchanged primary/accepted/runtime pins.

Fresh source review subsequently found two P2 failures: synchronous disposal could reenter before FIRST promise assignment, double-release and hide a nested false cleanup failure; raw-copy batches charged32768 visits before cooperation. The original report and probes remain at `/tmp/browserpdf-pdf-document-fresh-review-20261019.md` and `/tmp/browserpdf-pdf-document-review-controls-20261019/`. Their independent retained-artifact check is historical evidence, not another artifact-generation run.

The narrow correction changes only FIRST disposal scheduling and the raw-copy block size. Three new portable controls reproduce both failures before the fix (0/3 PASS) and pass afterward (3/3 PASS, zero failures/skips/cancellations,199.760042ms). They verify reentrant promise identity/release once, a shared exact cause=false CLEANUP error and retained charge, the actual source loop's quantum/total/copy identity and partial-copy abort, genuine full-source cancellation, unchanged caller input and a valid successor. The failed release control intentionally admits no successor through its fenced reservation.

New evidence is under `/tmp/browserpdf-pdf-document-corrected-20261019/`: `focused-before.tap`, `focused-after.tap`, original controls copied without mutation, and original probe replays under `replays/`. The unmodified disposal probe's second-release-only false branch is now unreachable because release occurs once; the new portable false-release control directly exercises shared failure fencing. The actual-loop replay reports max16384 visits, total131072 for64KiB input and both copies exact. Core/unit syntax checks pass. The prior27, saved artifacts, parser/font/browser matrices were not rerun. The corrected manifest pins the same109 protected sources,8 retained artifacts,2 discovery/contract files and historical first manifest/report.

No route/intake/draft/result/loader/font/shared/locale/dependency edit, native browser, globalSetup, shared fixture generation, server lifecycle, git operation, commit or nested worker occurred. Next: focused correction review and separately allocated native core gate, then separately approved intake/draft and UI work. All three service acceptance rows remain open.
