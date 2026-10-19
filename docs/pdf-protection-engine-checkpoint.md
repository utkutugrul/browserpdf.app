# PDF protection engine checkpoint

Status: isolated engine checkpoint accepted after focused signal correction source review and Root's corrected actual native 3/3 gate. Protect task 18 and Unlock task 19 remain open. No service route, HTML, shared session/handoff, capability filter or existing library loader imports this engine. Acceptance here covers the owned engine boundary, not either service UI or its locale/final acceptance.

## Scope and files

Five new runtime modules own this boundary:

- `public/js/core/pdf-protection-policy.js`: exact request, credential, permission, byte and ownership admission.
- `public/js/core/pdf-protection-engine.js`: fixed public QPDF calls, bounded private diagnostics, encryption inspection, output acceptance and page bounds.
- `public/js/core/pdf-name-serialization.js`: the corrected strict same-length PDF name escape case policy, with browser-exact byte mapping.
- `public/js/pdf-protection-worker.js`: one job in one disposable module worker; finite messages and private engine memory.
- `public/js/pdf-protection-loader.js`: one active byte job, fixed asset fetch/hash, main-owned Blob URLs, cancellation and cleanup.

`public/vendor/pdfstudio-0.4.0/` contains two unchanged executable assets, nine unchanged notice/license materials, an owned provenance manifest and notice index. Runtime pins live in trusted loader code. The manifest is documentation and is not an unchecked runtime source of URLs or hashes.

Four owned Node test files cover policy, serialization, actual engine execution and mocked browser bridge lifecycle. Root executed the three opt-in native cases in `tests/pdf-protection-engine.spec.mjs` after the signal correction; all passed. No dependency, package script, server, globalSetup or shared fixture was changed by this checkpoint's implementation.

## Public byte bridge

Import `runProtectionJob` from `/js/pdf-protection-loader.js`. Protect accepts this exact record:

```js
{
  operation: 'protect',
  bytes: Uint8Array,
  ownerToken: { taskId: string, revision: integer, generation: integer },
  operationRevision: 0, // Optional nonnegative safe integer.
  algorithm: 'aes256', // Optional: aes256 or aes128.
  userPassword: string,
  ownerPassword: string, // Optional, defaults to userPassword only when undefined.
  permissions: { // Optional; individual defaults apply only when undefined.
    print: 'full', // full, low, none.
    modify: 'all', // all, annotate, form, assembly, none.
    extract: true,
    accessibility: true // Only true is supported.
  }
}
```

Unlock accepts only `operation: 'unlock'`, `bytes`, `ownerToken`, optional `operationRevision` and `password: string`. An empty Unlock password is valid admission for encrypted PDFs with an empty opening credential. Protect-specific fields on Unlock, and Unlock's `password` field on Protect, reject even when present as undefined. Records reject unknown keys, symbols and accessors. Null typed values reject instead of granting defaults. There is one authoritative `bytes` field; an options byte override cannot mask it.

The second argument is exactly `{ signal?: AbortSignal, isCurrent?: () => boolean }`. Signal admission uses the captured native AbortSignal aborted getter as its brand check. Ownership checks use that same getter and listener registration/removal use captured native EventTarget methods. Public signal getters and listener overrides are not read or called. Data options are snapshotted at admission, so later caller mutation cannot replace the cleanup signal. No caller URL, module factory, arbitrary command argument, File queue, metadata bag or return navigation target is accepted. Callers retain their original input bytes. The bridge snapshots bytes before its first await; the engine takes its own authoritative snapshot before its factory await.

Success returns an owned `{ bytes, facts }`. Facts contain only `operation`, `encrypted`, `algorithm`, the pinned `engineVersion`, `inputBytes`, `outputBytes`, `pages`, `objects` and `normalizedNameTokens`. The worker result must match the admitted owner token and operation revision before publication. The bridge checks `isCurrent` before/after awaits and after final cleanup. The later route must supply the actual guarded read's `{ taskId, revision, generation }` and an operation revision, abort its signal on replacement/Clear/Cancel, and await the owned job before starting its successor.

`busy` rejects an overlapping call before inspecting the second request, copying its bytes, fetching assets or constructing a worker. The caller owns later File intake and latest-descriptor queuing. This bridge has no hidden pending byte job.

## Supported policy and limits

Protect requires a nonempty opening credential and a nonempty owner credential. AES-256 admits at most 127 UTF-8 bytes. AES-128 admits at most 32 printable ASCII bytes. Both reject NUL, C0/C1/DEL controls and malformed UTF-16 surrogates. Unlock permits empty credentials and otherwise uses the same 127-byte/control/surrogate admission. Credentials exist only in live caller inputs and owned operation/worker memory. No credential is included in result facts, error messages, URLs, session/handoff/artifact metadata, WebMCP, logs or network requests.

Input admission is 32 MiB. Accepted output is at most 64 MiB and 1,000 pages. The serialization validator admits at most 100,000 objects, 1,000,000 tokens and structural/literal depth 64. Every job has a 20-second loader deadline, including fetch and verification. Captured engine diagnostics have one 4,096-byte cap per invocation. These are byte/count/deadline policies, not a native heap cap. The published WASM declares about 19.2 MB initial memory and up to 2 GiB linear memory per instance. Multiple short-lived factory instances can exist during a worker job; native allocation and hard termination are governed by the browser's public worker semantics.

Already-unencrypted Unlock input rejects with `already-unlocked` and leaves its original bytes intact. Future UI must present an explicit no-op continuation without inventing a transformed artifact. Protect input that is encrypted and opens with the empty credential rejects with `requires-unlock`; an encrypted input requiring another credential rejects with `credential-rejected`. No page-copy fallback, metadata deletion or library-internal encryption patch exists here.

The compatible plaintext serialization is deliberately narrow: PDF 1.0 through 1.7, classic single-revision xref, complete resolvable objects/references, no encryption, ObjStm, XRef streams, Prev, XRefStm or linearization, and direct lexical integer stream Length with exact endstream bounds. Unsupported or ambiguous output rejects. This policy can reject otherwise valid PDF 2.0 or unusual serialization. It preserves the document graph rather than silently dropping unsupported structures.

The normalizer uppercases only the two hex digits in syntactic PDF name escapes. It never decodes and re-encodes names, never rewrites content streams, and never changes byte length or xref offsets. `/text#2fplain` becomes `/text#2Fplain`; `/text#232fplain` remains literal `text#2fplain`. Dictionary collision detection decodes escapes exactly once and treats raw byte 0x80 as equal to escaped #80. Byte mapping uses String.fromCharCode chunks; WHATWG latin1/ascii decoders would instead fold 0x80 to Euro. All literal strings, hex strings, comments and raw stream ranges remain byte-identical. Existing source extension entries are retained.

## Engine acceptance and errors

The implementation uses the published generated module's default factory, `FS.init`, `mkdir`, `writeFile`, `readFile`, `analyzePath`, `unlink`, `rmdir`, and `callMain`. It does not access the wrapper's TypeScript-private runner. Each call uses fixed private MEMFS paths and a finite named-option argument set. Transform calls select `--object-streams=disable` and `--suppress-recovery`, plus fixed encryption/permission options or `--decrypt` with the owned credential. There is no caller-supplied command line.

The actual engine helper checks status and diagnostics before its only output read. Transform calls require exit 0 and zero stdout/stderr bytes. Exit 3 rejects as `engine-warning`; other nonzero statuses reject. The diagnostic cap rejects immediately. Inspection calls deliberately admit only their bounded expected stdout: encryption-only JSON or a decimal page count; any stderr rejects. Missing, malformed or inconsistent inspection results reject. Raw diagnostic text and raw argv remain private and are never propagated. A bounded private diagnostic check maps a rejected credential to the finite `credential-rejected` code.

Protect first inspects the input, writes an encrypted result, verifies its actual encryption dictionary (AES-256 V5/R6/AESv3 or AES-128 V4/R4/AESv2), privately decrypts that actual result, validates compatible serialization and its page count, then returns only the encrypted bytes. Unlock first verifies encrypted input, decrypts it with the supplied credential, normalizes/validates the actual plaintext output, checks its page count and returns those plaintext bytes. This is engine acceptance; later selected-page review, explicit Use, history adoption, encrypted capability routing and compatible Unlock remain separate service work.

Error codes are finite policy, ownership, asset, worker, engine, credential and serialization codes from `PdfProtectionError`. They carry no native message, stack or credential. The core catches unsupported serialization as `unsupported-serialization`; lifecycle errors include `busy`, `canceled`, `stale` and `timeout`.

## Asset and worker ownership

The main loader fetches only `/vendor/pdfstudio-0.4.0/qpdf.js` (62,770 bytes) and `qpdf.wasm` (2,244,725 bytes), requires exact length and SHA-384 pins, rejects redirects and cross-origin responses, and creates both verified Blob URLs itself. It waits for both asset operations to settle after failure. The worker receives those loader-created bootstrap URLs, uses the fixed local worker module, imports the verified JS default factory, and supplies the verified WASM URL through documented `locateFile`.

Every job creates a fresh module worker. On success, error, cancellation, stale ownership or timeout, the main loader detaches callbacks, calls `Worker.terminate()`, clears owned timers/listeners, awaits its fetch-reader cleanup, revokes all owned Blob URLs, clears job references and releases its active slot. Cleanup steps continue independently if another step throws, and cleanup errors remain finite. Reader cancellation is awaited even when a reader throws synchronously. A successor is admitted after owned cleanup; an actual worker stop failure keeps the active slot fenced while remaining cleanup still runs. Browser `Worker.terminate()` returns void. There is no browser exit event or termination Promise, and no claimed exact heap-release acknowledgement. Naturally completed worker results are messages; hard cancellation uses the documented immediate termination request and owned queue cleanup. Node tests separately await Node's actual `worker.terminate()` Promise.

Source CSP at `worker.js:147-161` permits same-origin/blob scripts, blob workers and wasm-unsafe-eval. Root's corrected native gate exercised the actual loader, module Worker, verified JS/WASM Blob assets, output artifacts, native-phase cancellation/successor, and held-fetch overlap/stale/integrity cleanup under that existing CSP. No CSP change is included. Worker construction/termination counters measure public ownership calls, not an exact native heap-release acknowledgement.

## Provenance and evidence

The retained package is pdfstudio 0.4.0, source commit `c5c1f2d9f378199d1e2d333dbe4ca20e9ff737ad`. Its registry archive SRI and exact source Git-blob matches are recorded in `public/vendor/pdfstudio-0.4.0/manifest.json`. The executed published engine diagnostic observed QPDF 12.3.2. The runtime remains unmodified. The nine retained materials cover the wrapper, QPDF license/NOTICE, zlib 1.3.2, IJG JPEG 9f, Emscripten, musl, libc++ and libc++abi, including cryptography/path attributions. The notice index includes the required IJG acknowledgement.

Exact compiler identity remains unproved. Runtime-reference notices name a separately identified upstream Emscripten source reference rather than asserting an attested compiler build. The package integrity, actual Git-blob match, observed engine version and retained materials are the present provenance. No unrequested rebuild or dependency installation was performed.

Portable validation command:

```sh
rtk proxy node --test tests/pdf-protection-policy.unit.mjs tests/pdf-name-serialization.unit.mjs tests/pdf-protection-engine.unit.mjs tests/pdf-protection-loader.unit.mjs
```

Original checkpoint: 23/23 Node tests passed before the signal correction below. Actual engine tests use owned in-memory PDFs and disposable Node workers, with a 20-second parent deadline, max one active worker, and awaited termination before successors. Independent pdf-lib graph inspection accounts for legitimate object numbering and lossless Flate representation, while retaining catalog, Info/XMP, fields, URI, outlines, attachment MIME/payload/dates, tags, labels and geometry. Independent PDF.js text and RGBA pixels match protected and unlocked/ordinary-resaved controls for both AES modes. Strict code-0 diagnostics, warning-3 and capped diagnostics reject before any output read. Mutation, abort-after-factory, stale-phase, mocked browser timeout, held asset read, malformed ownership, overlap and positive successor controls pass. Node resourceLimits govern V8, not WASM linear memory.

The browser serializer port also produces byte-identical accepted output for all 16 retained actual low-level inputs: `/tmp/browserpdf-protection-production-serializer-parity-20261019.json`. It creates no new PDF artifacts. The frozen corrected /tmp parser remains unchanged. Earlier matrix evidence and original failure prefixes remain retained in the phase reports; this port did not rerun the full 16-case encryption matrix.

The original native five-case gate and Root's independent AES-256/AES-128 artifact report predate the signal correction. The independent report is `/tmp/browserpdf-root-protection-native-independent-first-20261019/report.json`: both cases pass, input remains unchanged, actual protected/unlocked text/geometry/annotations/pixels match, wrong credentials reject before a correct successor, and actual ordinary pdf-lib edit/save retains attachment MIME/payload, Info and forms. Its errors and non-GET request lists are empty and the browser is closed. Those results remain retained under their original chronology.

## Focused signal cleanup correction

Fresh review retained two counterexamples: a duck signal and a genuine AbortController signal with a throwing public removeEventListener both exposed a raw private error and left the successor permanently busy. Their original scripts, JSON and review remain unchanged. This correction changes only policy, loader, their two owned Node tests and this document. Captured native signal/listener operations close both original cases without calling overrides. Independent cleanup boundaries prevent one failure from skipping worker stop, reader drain or remaining URL cleanup; stop failure still prevents successor admission.

Focused command: `rtk proxy node --test tests/pdf-protection-policy.unit.mjs tests/pdf-protection-loader.unit.mjs`. Observed 22/22 pass, including both original cases, rejected duck accessors, genuine throwing public method/getter overrides, normal/pre-aborted/late abort signals, later option mutation, finite cleanup error continuation, stop-failure fencing, and positive successors. No unchanged engine/serializer tests, old encryption matrices or actual-input parity were rerun. New-prefix replays of both original probes now expose no private message and their successor reaches the mocked asset operation instead of busy. Reports and exact 24-path closure are retained in `/tmp/browserpdf-protection-production-signal-correction-20261019/`.

Focused independent source review then passed at `/tmp/browserpdf-protection-production-signal-corrected-review-20261019.md`. Its independent replays close both original failures. The review confirms engine, serializer, worker, engine tests, prepared native spec and vendor files remained unchanged, and explicitly finds no output change that warrants repeating Root's earlier independent AES artifacts.

After that review, Root executed the affected three actual browser cases against the corrected source. `/tmp/browserpdf-protection-native-signal-corrected3-20261019/final.json` records exit 0, 3/3 expected, zero skipped/unexpected/flaky/top-level errors, three traces, and 3425.475 ms test duration. All 310 source/test hashes, their path set, config/private idle test and 22 fixture files remained exact. Global setup and server lifecycle were not invoked; the browser is closed. The corresponding result file is `/tmp/browserpdf-protection-native-signal-corrected3-20261019-results.json`. These post-correction lifecycle results are distinct from the retained pre-correction independent artifact evidence.

This final reconciliation changes only this document. Final 24-path sizes/hashes are in `/tmp/browserpdf-protection-engine-accepted-20261019/manifest.json`, with the other 23 owned paths exact against the accepted correction freeze. Original hashes remain in `/tmp/browserpdf-protection-production-final-20261019.json` and `/tmp/browserpdf-protection-production-signal-correction-20261019/final-manifest.json`. The opt-in native configuration remains `/tmp/browserpdf-protection-native-20261019.config.mjs`. No tests or browser were invoked during this documentation reconciliation.

Next work requires separately approved Protect route/UI integration and Unlock route/UI/finite return intent integration. Actual encrypted selected-page review, transactional intake/Clear/Cancel, explicit Use/manual Download, original/history retention, capability routing and service/locale acceptance remain open. No service row is closed by this engine checkpoint.
