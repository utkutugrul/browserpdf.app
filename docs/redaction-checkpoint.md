# Safe redaction checkpoint

This work starts from verified base
`1184fc6addf80f4aa5a2fc49e10aab1f8d178ad4`. The core is independently
accepted. Root has accepted the final clean **22/22** native Redact invocation,
the independent route/artifact proofs and scoped annotation regression/review.
The earlier twenty-one-case aggregate, failed prefixes and their corrections
remain historical evidence below. Review and the actual clean Download preserve
the canonical source/current identity and local mask drafts. Actionable result
continuation requires deliberate **Use** followed by successful verification of
the exact chosen current preview, including after Cancel/Retry and history.
Complete locales, Phase 3/4 and final 32-service acceptance remain open. Commit
execution is separate from this accepted functional checkpoint; no commit,
push, deployment or server lifecycle action was performed by this owner.

## Injected APIs

`public/js/core/redaction.js` exports:

```js
inspectRedaction(bytes, { masks, mode: 'hybrid' | 'raster', scale: 1 | 2 }, env)
redactPdf(bytes, { masks, mode: 'hybrid' | 'raster', scale: 1 | 2 }, env)
inflateRedactionStream(bytes, { limit, signal })
```

Each mask is `{pageIndex,x,y,width,height}` in default user coordinates, wholly
inside the actual visible MediaBox/CropBox intersection. `env` injects `pdfLib`,
`pdfjs`, `pdfjsAssets`, `canvasFactory`, `encodeCanvas`, optional bounded
`inflate`, `signal` and `onProgress`. `inspectRedaction` returns finite geometry,
pixel estimates, capabilities and boundary losses, or `{supported:false,reason,
fallback:'raster'}` for unsupported structures. Cancellation propagates as
`AbortError`. Invalid geometry and resource limits reject visibly. `redactPdf`
repeats validation and returns serialized, reopened PDF bytes plus the same
facts. Neither API modifies canonical session state.

Hybrid mode renders masked pages and rebuilds supported untouched primitive
content into a fresh PDF context. There is no page copying, PDF object copier,
source-object reuse, page embedding or source metadata transfer. Source
resource names and comments are discarded; encountered font resources receive
fresh names. Untouched pages support only the twelve standard Latin Type1
Helvetica/Courier/Times fonts with explicit WinAnsiEncoding, bounded primitive
graphics/text operators and typed operands. Unknown encodings, populated image
or graphics-state resources, forms, annotations, links and other document
graphs require an explicit whole-document raster decision. Empty buckets
emitted by pdf-lib normalization are accepted only when actually empty.

The fresh document omits Info/XMP and preserves numeric MediaBox, CropBox,
BleedBox/TrimBox/ArtBox when present, Rotate and UserUnit. PDF.js viewports and
the verified shared `visualTransform` map rendered pixels into those original
boxes. Requested-scale backing dimensions are floored. Fractional bitmaps are
placed at `nativeWidth/scale` by `nativeHeight/scale`, anchored at visual
top-left; they are never stretched across a larger logical viewport. The
remaining subpixel bottom/right edge is outside the captured bitmap. Output
page geometry and physical size remain unchanged.

## Resource and cancellation policy

There are at most 10,000 pages, 300 document masks and 100 masks per page.
Serialized masks are bounded to 128 KiB; primitive plans to 16 MiB; content to
2 MiB decoded per page/16 MiB per document and 100,000 operators per page.
The grammar bounds strings, arrays and graphics nesting. Native streaming
decompression counts output before retaining it, backpressures small input
writes, and cancels/drains both reader and writer on failure. There is no
fallback to pdf-lib's unbounded content-stream decoder.

Before output creation or embedding, exact requested 1×/2× dimensions must fit
4096 pixels per edge, 16 million pixels per raster page and 48 million pixels
across every raster page. Exceeding a limit rejects; choosing a lower resolution
is explicit. Encoded raster inputs and final PDF each remain at most 96 MiB.
Rendering, encoding and embedding are serial within an operation. The caller
must drain a canceled operation before starting its successor. Native codecs,
the installed PDF parser and compression contexts have opaque internal memory;
these application limits do not guarantee process heap usage.

Canceled encoding, embedding and saving are awaited before the operation
settles; completion cannot return output after cancellation. Canvas cleanup
runs in `finally`. Loading and verification destruction are also drained;
cleanup rejection preserves the primary cancellation/failure. Session resource,
history and storage budgets remain owned by the existing shared session.

## Verification

The first isolated gate passed 13/13 in 3,284.328334 ms. Fresh independent
quality review then found fractional bitmap stretching at 2×: the retained
prefix evidence is `/tmp/browserpdf-quality-fractional-redaction-prefix/`.
That was a resampling defect, not a demonstrated secret leak. The correction
preserves requested pixel scale and visual top-left placement; no pixel
threshold was relaxed.

The portable suite owns its generated in-memory fixtures. It reopens actual
serialized output with both installed engines, checks every indirect object
and decoded stream for selected text/Info/XMP secrets, counts all PageLeaf
objects including orphans, and proves real untouched text retention. Repeated
AcroForm Parent/Kids/P and internal Link/Dest inputs require explicit full
raster. Separate integer and fractional fixtures cover all four rotations,
nonzero CropBox, UserUnit 1/2, exact physical/page geometry, entirely opaque
mask pixels and zero changed channels outside masks. Held encoder/embed/save
and rejecting loading/verification cleanup tests prove cancellation and drain.

Use `rtk proxy node --test tests/redaction-core.unit.mjs` for this isolated gate.
The corrected gate passes **17/17**, zero skipped/canceled/failed, in
**5,012.071792 ms**. Syntax, whitespace and source anti-pattern checks pass.
Fresh review and independent fractional postfix reproduction are required
before route acceptance. Root's independent fractional postfix now passes:
`/tmp/browserpdf-root-redaction-fractional-postfix-first/report.json` retains
the actual 60,139-byte PDF, exact four-rotation/UserUnit boxes, opaque mask
pixels, zero changed outside channels and clean all-object inspection.

## Scoped route integration and first native slice

`redact.js` captures local intake intent before the initial chained-file read.
New native intake and Clear invalidate it immediately. Intake validates up to
250 MiB current PDFs through the shared owned-session contract; it creates no
editable scene merely to retain masks. Rejected replacement preserves the
chosen task and drafts. Prior native work drains before a successor opens.

`redact-workspace.js` consumes the documented Reader refresh/continuation APIs.
Masks remain bounded local descriptors with five mask-history entries,
pointer capture, keyboard move/resize/delete and numeric Save/Discard.
Uncommitted coordinate changes gate page/mode navigation, review and history.
Only explicit placement reveals a newly created mask. Output mode, requested
resolution and memory estimates are visible; unknown graphs require an
explicit full-raster choice and loss acknowledgement.

Current-input baking, inspection and export share one serial lane. Actual
result review precedes deliberate Use. Only the synchronous adoption callback
rebases its exact canonical owner; successful Reader refresh publishes a new
clean-result rail. Explicit document Redo also republishes solely the exact
current verified raster-redaction artifact. No old rail survives arbitrary
history changes. The separate narrow guarded Privacy destination intake now
has actual cleaned-result inspection evidence below. Rich Privacy inspection
and actions remain Phase 4.

The first native slice contains seven cases in `redact-workspace.spec.mjs`:
keyboard/dirty/history plus real hybrid download, form/link fallback artifacts,
fractional four-rotation pointer/numeric output pixels, held encoder Cancel,
held initial READ versus newer native intake, and rejected replacement retaining
one-field decimal mask changes without recreating a prior clean-result rail.
Numeric controls accept arbitrary finite decimal precision; saving one field
retains untouched fields at their original precision. The chosen-result
publication guard refuses local masks and unsaved coordinates. Keyboard steps
project default-user-space unit vectors through the actual logical/CSS
viewport, including independently floored CSS dimensions; the fractional
four-rotation case saves and verifies the exact native ArrowRight adjustment.

The first invocation passed **5/7**, with two test-helper failures, zero
skipped/flaky/global errors, in **16,727.03 ms**:
`/tmp/browserpdf-redact-native-first7-20261019.json` and its matching `-output`
directory. All 187 public/test/config source hashes remained unchanged
(`e1c7e1ba8fdd376184f6d27724f8da87662b3f79d31ed38f83fa61b5ace599a3`).
The SHA helper passed plain snapshot arrays directly to Node's hash API.
Both failures stopped there: document-history and late-initial-read release
tails had not executed. The prefix reports/traces and six actual PDF downloads
remain retained.

After the authorized one-line `Buffer.from(bytes)` test correction, only those
two cases ran once: **2/2 passed**, zero skipped/flaky/unexpected/global errors,
in **4,766.178 ms**, at
`/tmp/browserpdf-redact-native-failed2-postfix-20261019.json` and its matching
`-output` directory. Only the authorized test file changed from the first
invocation; all 187 hashes remained unchanged during the postfix
(`1084c0f7aafa6426c2bb477e019e820fbd0a03c5d4890db98a970ed0af0d6114`).
This is seven unique aggregate passing cases, not a single clean seven-case
invocation. Both browser invocations ended and closed their browsers.

Actual route artifacts prove all-indirect secret/Info/XMP absence, selectable
text on supported untouched pages, explicit form/link whole-document raster
consent and truthful capabilities, native encoder Cancel/drain with recovery,
and fractional four-rotation pointer/numeric/keyboard geometry with zero
changed outside pixels and fully opaque black mask pixels. The 10,048-byte
hybrid chosen artifact and the later document-Redo download have identical
SHA-256 `f385893d38004a1fc851e47b61054b66d514c8fc49853dba73019dfdda18a316`.
Use retains the same task and exact immutable original, clears the editable
scene, and explicit Undo restores the source. Redo restores the exact cleaned
artifact and a newly owned continuation rail. A held initial workflow READ
finishing after new B is ready cannot replace it; the actual 10,908-byte B
download has SHA-256
`93744f708f2c0c7de738779844fead26a3c6c691936a11a64b5b1acc56a5851a`,
selectable `NEW B PAGE 2`, and no old-A content. These are scoped route proofs,
not complete Privacy inspection or final 32-service acceptance.

## Added lifecycle, Privacy and layout slice

The seven added cases have passing aggregate evidence across the following
retained invocations. Each report has its matching `-output` directory;
summaries, context attachments, actual PDF downloads and failure traces remain
under the same `/tmp` prefix. All 243 frozen public/test hashes stayed unchanged
during each invocation, and each browser closed afterward. Skips, flaky results
and top-level errors are zero in every invocation.

| Report | Result | Duration |
| --- | --- | --- |
| `/tmp/browserpdf-redact-added7-first-20261019.json` | 3 passed / 4 test-measurement failures | 12,279.519 ms |
| `/tmp/browserpdf-redact-layout-failed4-postfix-first-20261019.json` | 1 passed / 3 focus-visibility failures | 10,026.011 ms |
| `/tmp/browserpdf-redact-focus-margin-failed3-first-20261019.json` | 3 passed | 12,254.858 ms |

The first three completed cases prove Clear during held native encoding,
valid B replacement during an actual held PDF save, and deliberate Use to
Privacy. Clear removes canonical identity/task and old output; fresh B commits
while the abandoned encoder drains, then opens without old completion reviving
the cleared task. Valid replacement similarly permits canonical B to commit
while its preview waits for old saving to drain. After release, B becomes ready
without reselection and exports the actual latest document. Both artifacts
retain B's untouched selectable text, exclude old-A content and all indirect
secret/metadata, and have zero changed RGBA outside the opaque mask.

The Privacy journey deliberately uses the actual 10,048-byte clean download.
Download, chosen canonical current and native scanner input have the same
SHA-256 `f385893d38004a1fc851e47b61054b66d514c8fc49853dba73019dfdda18a316`.
The same task and exact immutable original survive, with no editable scene.
The actual three-page scan reports zero standard metadata/XMP/forms findings.
`/tmp/browserpdf-redact-added7-first-20261019-privacy-digests.json` retains
the digest/length and bounded native summary. The test-only module wrapper
hashes input before invoking the original scanner; it records no source bytes.
This bounded scan is not a general privacy certification.

All four first layout cases passed English initial body/default-fit/useful-PDF
measurements, then stopped because an omitted English `html.dir` reflects as
an empty string although effective CSS direction is LTR. Only the test
measurement changed to computed direction; the explicit Arabic `dir="rtl"`
assertion remains. No product HTML/CSS fix or passing lifecycle/Privacy rerun
was needed. Native Arabic, touch and later artifact tails were unverified at
that stage. The 193/194-character source names were retained throughout; the
shared bounded display-name contract preserves their full accessible labels
separately from safe export names.

The corrected four-width invocation completed 390px English-light and
Arabic-dark, including real CDP touch placement/cancel and actual saved PDFs.
The other widths reached focused native keyboard placement but the fitting
mask rectangle extended below its viewer clip by **0.375px at 320**,
**0.09375px at 768** and **0.03125px at 1440**. Their later tails stopped there.
Root's decoded native rectangles also showed only **0.15625px** bottom clearance
in the passing 390px case. The mask's existing 2px outline plus 2px outline
offset extends 4px beyond its rectangle. This is concrete focus-visibility
geometry; neither an integer-only rounding assumption nor a saved-PDF pixel
or redaction-engine defect is established by those values. No assertion
tolerance, mask coordinate, raster resolution or global overflow rule changed.

Only the existing selected/focus-visible mask CSS rule gained
`scroll-margin:5px`: room for the existing 4px focus ring plus a 1px reveal
buffer. The exact failed 320/768/1440 cases then passed with bottom clearances
of **4.625/4.90625/4.96875px**, respectively. Their precondition still proves
actual clipping of the predicted default mask in the current scroller/window
clip before native keyboard Add; the real mask must receive focus and fit the
available clip, using the size-aware rule only when physically larger.

Across the retained 390px pass and final six contexts, all **eight**
320/390/768/1440 English-light/Arabic-dark contexts complete their unchanged
task and artifact assertions. Natural initial layout is measured before any
harness scrolling: useful primary PDF visibility is at least half a page or
35 percent of the viewport, whichever is smaller, with no body or default-fit
surface overflow. Full source names remain available in identity title/aria;
theme, effective direction and explicit Arabic RTL are checked. Native Add
reveals/focuses a zoomed mask, Arrow nudges without page navigation, numeric
typing preserves focus and window/page-scroll offsets, and native Save uses
the requested coordinates. The 390px contexts additionally perform real touch
placement and touch cancellation. Every actual saved artifact passes strict
full-channel comparisons (zero changed outside pixels and opaque black inside),
all-indirect secret/Info/XMP exclusion and untouched selectable-text retention;
the canonical task stays unchanged before deliberate adoption.

The final context and summary evidence is
`/tmp/browserpdf-redact-focus-margin-failed3-first-20261019-contexts.json` and
`/tmp/browserpdf-redact-focus-margin-failed3-first-20261019-summary.json`;
the retained 390px evidence uses the corresponding
`browserpdf-redact-layout-failed4-postfix-first-20261019` prefix. All seven
added unique cases, and all fourteen native Redact cases overall, have passing
aggregate evidence. No single clean seven- or fourteen-case invocation is
claimed.

## Root independent actual route journeys

`/tmp/browserpdf-root-redaction-native-first/report.json` passes **3/3 on its
first invocation** with actual **12,147 / 45,010 / 58,811-byte PDFs**. Native
pointer placement, numeric Save and keyboard Undo produce a hybrid artifact
with no secret/Info/XMP in any inspected indirect object, zero orphan pages,
and both untouched selectable-text markers. Review leaves canonical bytes
unchanged; Use chooses the exact downloaded SHA with the same task/original;
Undo/Redo restores exact artifacts; native Privacy continuation reads the same
chosen SHA and completes its scan.

The repeated-form journey requires explicit whole-document raster consent;
its saved artifact has no selectable text/forms or retained secret/metadata.
The four fractional rotations preserve raw boxes, Rotate/UserUnit and physical
viewports. All native 2× RGBA channels match independent source-plus-mask
rendering, with every mask pixel opaque black. Each case has zero page errors
and non-GET requests and one explicit download; all three contexts and the
browser close. These independent inputs are not portable-suite dependencies.

These retain the original scoped Redact functional evidence. At this earlier
stage, final fresh checkpoint review and appropriate broader regression were
still open; their accepted current status appears below. Complete locales and
remaining platform/all32 work remain open.

## Current-preview cancellation correction and verification

Fresh Root proof `/tmp/browserpdf-annotation-edge-classifiers-20261019-a/`
holds an actually completed detached candidate render before Reader publishes
it. Native Use selects the actual clean **6,178-byte** PDF (SHA-256
`152cbf37d309ddcc352aa053f7b5558e160af01809cdb45299351a936e32cbad`).
Native Cancel waits for release/drain, but the former route then unlocks the
old source pixels/text under that clean current identity. The source comparison
is exact, while 247,791 channels differ from the actual clean rendering.
Undo/Redo recovers the clean rendering with zero changed channels. The saved
PDF stays clean; this is a confirmed current-preview synchronization defect,
not a content-removal defect. The completed-native hook, actual returned Cancel
promise, canonical artifact, report, summary and images remain retained.

The scoped correction records the exact task/revision/generation acknowledged
by the preview separately from busy/drain state. Adoption, Retry and document
history share a pending/blocked/ready refresh path. Only `Reader.refresh ===
true` with the same target, attempt and lifetime acknowledges a subsequent
current version. Initial bootstrap separately requires an unchanged captured
owner and `reader.ready === true`; initial render failure exposes owned Retry.
Old page pixels/text and artifact-derived search/outline/thumbnail panels are
hidden without changing their layout dimensions, inert and aria-hidden while
unverified. Page/mask/mode/history actions stay locked; Retry, Replace, Clear
and explanatory status remain available.

Cancel still aborts and drains native work. It cannot turn an unverified
chosen/history preview into a ready one. It restores an already acknowledged
same-current preview only when that exact owner still matches after drain;
otherwise Retry is required. Plain Undo/Redo failures retain the deliberately
requested canonical version instead of implicitly running inverse history.
Stale replacement/Clear completions cannot acknowledge, reveal, roll back or
publish over a newer owner. A chosen-result review/rail is rebuilt only from
the exact verified current artifact and its existing boundary/loss facts.
There are no core, export-geometry or shared Reader API changes.

Seven new native cases in `redact-workspace.spec.mjs` use generated portable
fixtures and actual completed-render holds: Use/Cancel, failed Retry/Cancel,
Undo/Redo cancellation, non-Abort Undo/Redo failure, held adoption versus B,
held adoption versus Clear/fresh B, and initial-render failure/Retry. They
observe actual Cancel/Retry/history handler promises; require hidden/inert/
aria-hidden old surface and side panels; preserve exact current/original/task/
page through recovery; and compare actual recovered preview channels with
the current PDF. Replacement B may commit while the serialized preview waits
for old work to drain. Actual recovered downloads retain their expected
SHA/content/mask pixels. The prior fourteen, Root three and accepted core gates
remain retained rather than repeated as new evidence.

The first mixed focused invocation passes **11/13**, with two Redact test
context failures, zero skipped/flaky/top-level errors, in **40,918.457 ms**:
`/tmp/browserpdf-annotation-corrections-first13-20261019.json` and its matching
`-output` directory. Five of the seven new Redact cases pass completely:
Use/Cancel, failed Retry/Cancel, Undo/Redo cancellation, non-Abort Undo/Redo
failure and initial-render failure/Retry. The two fresh-B cases already pass
their exact current/task ownership assertions, then stop at a **12,714-channel**
preview comparison mismatch. Their final B artifact tails had not run. Both
failure traces and results remain retained, including the `9e603` replacement
and `64f2d` Clear case directories.

Trace inspection shows native fresh B intake followed by readiness/snapshot
checks and the comparison, with no intervening Retry. Reader's initial open
renders into an attached canvas inheriting `antialiased` font smoothing;
Reader.refresh renders its candidate detached with `auto`. The first helper
assumed every caller followed a refresh and forced `auto`, incorrectly
including those two fresh initial B previews. The cause-based test correction
adds an explicit context parameter: refresh/recovery callers retain the
`auto` default, and only the two fresh-B initial comparisons pass
`antialiased`. No production code, PDF geometry, resolution, pixel tolerance
or artifact assertion changes for this repair; `changed === 0` stays strict.

Only the two failed cases then run once and pass **2/2 in 7,575.573 ms**, zero
skipped/flaky/unexpected/top-level errors:
`/tmp/browserpdf-redact-sync-fresh-B-failed2-postfix-20261019.json` and its
matching `-output` directory. All **195** files in that gate's source manifest
stay unchanged, SHA-256
`bc508fc4b398a08afb8b2821b487f41c135ab5fe47fc72268fe5c62f77d811eb`.
The helper-only patch, preflight, source manifests, verification summary and
PDF-artifact summary remain under the same prefix. Both attached initial B
source previews now compare at zero changed channels. Their complete fresh
artifact tails pass strict mask pixels, all-indirect secret/Info/XMP exclusion,
selectable B text and no old-A content. Four actual PDFs reopen: two setup
10,048-byte cleaned artifacts and two **10,908-byte, three-page** B artifacts.
Both B downloads have SHA-256
`93744f708f2c0c7de738779844fead26a3c6c691936a11a64b5b1acc56a5851a`.
The browser closes; the five passing Redact cases and other mixed passes are
not rerun for this test-only context correction.

Root's independent original-prefix postfix also passes on its **first 2/2
invocation** at `/tmp/browserpdf-root-annotation-edge-postfix-first/report.json`
(one Redact cancellation case and one separately owned Highlight case).
The Redact case deliberately uses the same actual **6,178-byte** clean PDF and
SHA `152cbf37d309ddcc352aa053f7b5558e160af01809cdb45299351a936e32cbad`
as the retained failing proof. After native Use and Cancel with actual
completion/drain, the old surface, populated SECRET search results and two
thumbnails remain hidden, inert, aria-hidden and locked. Retry restores the
actual chosen preview at **1014×760**, zero different RGBA channels; native
Undo/Redo returns the exact source/clean chosen versions and Redo also compares
at zero changed channels. Canonical task and immutable original stay exact.
Independent inspection of the actual cleaned artifact finds no secret,
Info/XMP, forms or orphan pages. Page errors and non-GET requests are zero;
the contexts and browser close.

The correction preserves the `raster-redaction` boundary and exact loss facts:
`redaction-selected-pages-rasterized` for the hybrid selected-page scope,
`redaction-document-rasterized` only for explicit full-document raster, and
`redaction-metadata-removed` for omitted Info/XMP. Cancel does not undo
deliberate Use or the user's requested history version, and no old
result/continuation rail is revived while the preview is unverified. Only
the exact verified current artifact rebuilds that rail. The seven focused
Redact cases had passing aggregate evidence at this synchronization checkpoint;
combined with the prior fourteen, this was **twenty-one unique native Redact
cases**. No single clean seven-, thirteen- or twenty-one-case invocation was
claimed at that stage. The later complete twenty-two-case invocation below
accepts the prerequisite correction as well. Complete locales and platform/all32
acceptance remain open.

## Explicit Use prerequisite and current accepted checkpoint

Root's independent native prefix at
`/tmp/browserpdf-root-redact-direct-continuation-prefix-first/report.json`
confirms that clicking a result-chain Privacy action before Use adopted the
actual clean download but left the old source preview and mask visible. The
cleaned PDF remained safe under all-object inspection; the defect was the
pre-Use continuation bypassing Redact's owned preview synchronization.

Review now leaves result-chain actions unavailable and explicitly says,
"Use this cleaned result to continue." The actual reviewed cleaned Download
remains available. Review and Download retain the exact canonical source,
current/task/revision/generation and local masks. Deliberate Use continues
through the existing pending/blocked/ready preview path; only `presentChosen`
publishes a rail for the exact verified clean current artifact. Cancel/Retry
and document history retain that same rule. Shared continuation/session APIs,
redaction core, serialization, geometry and pixels are unchanged.

The added native prerequisite regression downloads and inspects the actual
clean PDF, asserts no actionable result-chain rail before Use and retains
exact canonical state and mask descriptors. It holds an actually completed
Use candidate render, observes the returned render promise's settlement,
requires hidden/inert source surfaces and panels with no rail while pending,
then compares the verified clean current preview at zero changed channels.
Native Privacy continuation must receive the exact downloaded SHA, immutable
original, task and chosen revision and enable Scan. The retained Use/Cancel
case also checks that successful owned Retry restores an enabled Privacy
action; existing Undo/Redo cases remain intact.

Fresh stable-source review reports no actionable finding. Root's independent
original-prefix postfix passes on its first invocation at
`/tmp/browserpdf-root-redact-continuation-prerequisite-postfix-first/report.json`.
It uses the exact **12,147-byte** clean artifact from the retained failing prefix,
SHA-256 `14327f38eeda3791a48561b3010f22e5767e89bf37686cbedd4312690d353a74`.
Before Use, canonical source/current/task/revision/generation and masks remain
unchanged with no actionable rail. Use verifies the clean preview; native Privacy
continuation receives the exact chosen bytes, immutable original, task and
revision 1, then scans successfully. All-object inspection remains clean; errors
and non-GET requests are zero, all 286 source hashes stay unchanged and the
browser closes.

The complete isolated Redact invocation then passes **22/22 in 61,374.922 ms**,
zero failed/skipped/flaky/top-level errors or retries, with 22 attempts:
`/tmp/browserpdf-redact-prerequisite-gate-20261019-results.json` and
`/tmp/browserpdf-redact-prerequisite-gate-20261019-final.json`. All **286** updated
runtime/test/SDK/script inventory hashes remain unchanged; the browser closes
and **33 actual PDFs** remain in the matching `-output` directory. This covers
the added completed-render prerequisite hold and all retained Redact cases,
including Cancel/Retry, Undo/Redo, replacement/Clear, geometry, explicit raster
fallback, responsive layouts and chosen-copy Privacy continuation.

The portable prerequisite attachment records identical downloaded, chosen and
Privacy SHA-256 values of
`f385893d38004a1fc851e47b61054b66d514c8fc49853dba73019dfdda18a316`.
That generated fixture is distinct from Root's 12,147-byte prefix/postfix
artifact above; no equality between the two corpora is claimed.

Root accepts the functional annotation gates and fresh review. The shared
79-case affected regression and retained broader/nonbrowser evidence are
reconciled in the [current program checkpoint](../plans/02-browserpdf-service-improvements.md#current-accepted-annotation-checkpoint).
The retained broad invocation is 324 passed/7 failed, not a clean full-suite
pass. Earlier failed reports and the historical twenty-one-case aggregate stay
preserved. Complete locales, remaining Phase 3/4 and final all-32 verification
remain required.
