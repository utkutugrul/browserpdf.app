# Bounded document display names

This is the approved narrow annotation filename contract. The implementation
has a passing 47-case affected unit gate, browser-observed idle request-graph
acceptance and the complete native continuation/history/export postfix.
The first native journey exposed a continuation type-forwarding defect, which
the focused postfix resolves. This does not close Highlight,
Redact, complete locales or the remaining 32-service program.

## Filename and display identity

`createArtifact(bytes, name = 'document.pdf', options = {})` keeps its existing
signature. Every artifact and its metadata descriptor now have an explicit
`displayName` string alongside `name`, `type`, capabilities and the finite
boundary descriptor. No generic metadata object is retained.

`name` retains the existing C0 removal and 160-UTF-16-unit bound. It remains the
filename used for Download, `File.name`, output/ZIP names and MIME inference.
No export filename or type policy changes in this checkpoint.

`displayName` is for document/result text, title, status and accessible preview
labels. Native positional names are its default. It preserves ordinary Unicode
including Turkish and Arabic, removes C0 and DEL/C1 controls, and retains at
most 260 UTF-16 units. An oversized value ends with an ellipsis within that
bound without splitting a surrogate pair. A blank value falls back to the
nonblank safe filename, then `document.pdf`. The unbounded raw input is never
retained in an artifact or handoff descriptor.

A supplied display label belongs to a specific descriptor: it is retained only
when `options.name === name` and `options.displayName` is a string. Otherwise
the constructor derives the label from its new positional name. For example:

```js
createArtifact(bytes, current.name, current); // retains current.displayName
createArtifact(bytes, 'new-output.pdf', { ...current }); // new-output.pdf
```

Legacy descriptors without `displayName` fall back to their existing `name`.
An intentionally supplied alternate label must include its matching `name`.
The exact positional comparison happens before the filename's 160-unit cut.

## Session and continuation

`begin`, `adopt`, `publishScene`, `publishComposition`, `current`, `original`,
`historyTarget`, `snapshot` and `transfer` retain their existing signatures.
Original/current metadata, ordinary and scene history/future, and resources
carry the explicit field. Full `transfer()` restoration through
`begin(transfer.current.bytes, transfer.current.name, transfer)` reads the
bound current descriptor. A same-byte adoption updates both names together
without adding a revision, generation or history entry, as before.

The first image-composition original passes its bound descriptor into `begin`.
Existing composition item/group name rules and provenance limits are unchanged.
`getWorkspaceInput({bakeScene,bakeComposition,operation})` adds `displayName`
to its typed return: ordinary or scene input preserves current identity;
composition baking derives the label from that operation's new `.pdf` name.
Preserve-current Reader, object, page-task and page-effect continuations pass
the explicit matching name pair and the input's existing `type` through
publication and storage. A bounded safe filename can lose its extension, so
these callers must retain the typed input rather than infer a new type from
that filename. The constructor and MIME inference policy remain unchanged.

`stashForChain` stores the field in its explicit input/original/resource and
history/future descriptors. Descriptor identity is independent of byte-file
deduplication: differently named artifacts can share one stored byte record.
`takeChainedFile` keeps the bounded `File.name` and places its matching
`name`/`displayName` pair in `File.browserpdfSession`. Native `readPdfFile`
spreads that inherited pair into `begin`; a fresh native File derives its label
from its full filename. Original/resource/checkpoint descriptors restore their
own labels.

Task ownership, immutable original bytes, finite history, byte/resource caps,
idempotence, guarded publication, transactional storage and expiry remain
unchanged. IndexedDB stays at v2; no schema migration, SDK API or WebMCP metadata
expansion is introduced. The display-name schema lives in the already lazy
session module; UI consumers add no eager module or request.

## Focused acceptance

`tests/document-display-name.unit.mjs` has six real-byte cases: Unicode and
bounded/control fallback, output-name defaulting against spread source options,
ordinary history and same-byte adoption, scene/future/resource transfer,
deduplicated typed handoff, and first-composition-original publication/transfer.
The six cases passed in 100.841 ms. The affected session/handoff/composition,
Reader, Highlight and Redact unit gate passed **47/47**, zero failed, skipped or
canceled, in **3,412.787792 ms**. The retained TAP report is
`/tmp/browserpdf-display-name-owner-20261019/affected-units-first.tap`.

The native test in `tests/highlight-workspace.spec.mjs` uses real mouse text
selection and actual downloaded PDFs. It checks a long original and generated
result through Highlight → Add Text → Highlight, two Undo/Redo steps, exact
text/title/aria labels, bounded native download names, retained task/original
SHA, actual annotation contents/AP and source text.

The first two-case native/idle invocation finished **1 passed / 1 failed**, zero
skipped/flaky, in **18,604.316 ms**. All 243 frozen source hashes remained
unchanged and the browser closed. Its JSON and retained artifacts are at
`/tmp/browserpdf-display-name-native-idle-first-20261019.json` and the matching
`-output` directory. The idle graph test passed: Home 39,393 bytes/eight
requests; Merge 90,430/eleven; Workflows 97,132/fifteen; Privacy 97,413/twelve;
Doctor 87,278/eleven. Byte totals sum unchanged local source-file lengths for
the browser-observed requested paths; the trace contains no JavaScript response
bodies. Root's independent path/count/local-length match is retained at
`/tmp/browserpdf-root-display-name-idle-trace-review.json`. No threshold changed.

The native case passed initial full labels, real native selection, the first
actual saved PDF, exact source/current SHA and its two Highlight annotations
with appearance streams. It then failed before reaching Add Text. Reader's
preserve-current publication/storage pair omitted the existing input type;
the 160-unit filename had no `.pdf`, so the constructor correctly inferred
`application/octet-stream` and continuation visibly rejected the format.
The independent `-type-forwarding-proof.json` beside that report records the
real artifact and confirms explicit forwarding retains `application/pdf`.
The narrow postfix adds that existing `type` at the equivalent Reader, object,
page-task and page-effect boundaries. No constructor/name/MIME API changes or
idle rerun are required.
The strengthened typed-input handoff and retained handoff unit gate passes
**11/11**, zero failed/skipped/canceled, in **123.804167 ms**; its TAP is
`/tmp/browserpdf-display-name-owner-20261019/type-forwarding-focused11-first.tap`.

The focused unchanged native postfix passed **1/1**, zero failed/skipped/flaky,
in **6,524.533 ms** at
`/tmp/browserpdf-display-name-native-type-postfix-first-20261019.json` and the
matching `-output` directory. It completed both mode continuations, two Undo
and two Redo actions, the second real PDF, full original/current/result labels,
native bounded download filenames, immutable original SHA and annotation
contents/AP plus retained source text. The earlier idle pass remains accepted.

Redact's eight natural 320/390/768/1440 English-light/Arabic-dark contexts retain
their full 193/194-character names and actual artifact assertions. Their
prelaunch full-name contract mismatch was resolved by the shared contract,
without shortening fixtures. The coordinator subsequently accepted all eight
contexts and the added-seven lifecycle/layout/Privacy gate with aggregate
passing evidence; detailed invocations and helper corrections belong to
`redaction-checkpoint.md`. The later complete Redact 22-case gate and shared
79-case affected gate are accepted, with the historical aggregates and failed
reports preserved. Highlight's accepted lifecycle/layout and direct empty-scene
evidence is described in `highlight-checkpoint.md`. The
[current program checkpoint](../plans/02-browserpdf-service-improvements.md#current-accepted-annotation-checkpoint)
records the retained nonbrowser checks and exact scope; complete locales,
Phase 3/4 and final all-32 acceptance remain open.
