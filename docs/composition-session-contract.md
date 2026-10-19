# Image composition session contract

The shared state is implemented in `core/composition-state.js` and
`core/document-session.js`. Both image entries use the same entry-local
`tool-ui.js` delegate. Await `ensureDocumentSession()` before intake. No second
persistent composer session is created.

```js
const guards = () => {
  const state = documentSession.snapshot();
  return { expectedTaskId: state.taskId, expectedRevision: state.revision, signal };
};
const pair = {
  id: crypto.randomUUID(),
  original: { bytes: rawBytes, name: file.name, type: file.type },
  asset: { ...await imageAsset(file, { trim: false, signal }) },
  rotation: 0, fit: 'fit',
};
await documentSession.beginComposition([pair], guards()); // new chosen task
await documentSession.startCompositionFromCurrent(pair, guards()); // inherited chosen image
await documentSession.appendCompositionInputs([pair], guards()); // existing task
const next = documentSession.composition();
next.items[0].rotation = 90;
documentSession.changeComposition(next, guards());
documentSession.setCompositionSelection(next.items[0].id, guards());
```

The pair example illustrates alternatives; it must not append an already-used
item ID. Guards are obtained immediately before committing normalized pairs.
Pending normalization must preserve its own task/intake token and merge against
the latest canonical state. A stale hash rejects with `AbortError`; retry is
allowed only while that same task/intake still owns the intent.

These calls are alternatives. A retained chosen-image handoff without existing
composition first restores `browserpdfSession` through `begin`, then calls
`startCompositionFromCurrent(pair,guards())`. Its raw bytes/type must exactly
match the chosen current image. This preserves task ID, original PDF, bounded
history and all prior provenance/resources. It validates the combined resource
budget before committing; it never uses new-task `beginComposition` as an
adoption workaround. Explicit fresh local-file intake uses `beginComposition`.

`composition()` returns a cloned finite descriptor:

```js
{ version: 1, items: [{ id, originalRef, assetId, width, height, name,
  rotation: 0, fit: 'fit' }], paper: 'image', orientation: 'portrait',
  margin: 0, selectedId: null }
```

Rotation is 0/90/180/270; fit is `fit`/`fill`; paper is `image`/`a4`/`letter`;
margin is 0–72 points and must leave positive content space. Image paper uses
the rotated image aspect with an 842-point longest edge; orientation applies to
fixed paper. Selection changes do not increment edit revision or generation.
Other successful edits invalidate publication and use shared undo/redo.
Removing the last item permits `items:[]` with `selectedId:null`; originals stay
retained, Undo restores the image, and PDF export remains disabled until an image
is present.

Each item retains its own input `name` (control characters removed, at most 260
UTF-16 characters), including identical bytes selected under different names.
Legacy descriptors may omit this field and use the unique original group name.
The group also preserves its first input name within that bound; resource
artifact descriptors retain their existing 160-character filename bound.

Every input original is immutable. `compositionSources()` returns
`{version:1,originals:[{originalRef,name,type}]}`. This provenance group survives
generic adoption and history pruning until Clear or deliberate new-task intake.
Removing an item does not release its original. Normalized assets remain while
referenced by active/undo/redo composition states. `resource(ref)` returns an
owned byte copy. Snapshot metadata supplies `originalImageCount`,
`compositionRawBytes`, `compositionNormalizedBytes`, `hasComposition`, and
`compositionPublishedRevision` without copying image bytes.

Use the actual PDF writer for both selected-page preview and final review:

```js
const state = documentSession.snapshot();
const result = await composeImagesPdf(documentSession.composition(), {
  resource: documentSession.resource, pdfLib, signal
});
await reviewResult(result.bytes, 'images.pdf', {
  ...result, operation, compositionRevision: state.revision,
  onAdopt(snapshot, artifact) { /* synchronous chosen-result notification */ }
});
```

`compositionRevision` is the finite explicit-Use mode. It checks task, revision
and generation at review creation and adoption, then calls
`publishComposition(bytes,name,{expectedTaskId,expectedRevision,capabilities})`.
Publication retains editable composition, keeps edit revision, records that
published revision, and increments generation; identical repeated publication
is a no-op. Generic `adopt()` instead archives and clears active composition,
including the same-byte case. Originals remain available for source comparison.

`stashCompositionForChain('images'|'jpg-to-pdf',guards())` retains the editable
composition before export and after Use, returning
`{workflowId,fileId,isCurrent}`. Check `isCurrent()` immediately before navigation.
It serializes the chosen current artifact and validated composition; inherited
`File.browserpdfSession` restores through existing `begin(bytes,name,options)`
without renormalizing. PDF tools use ordinary `stashForChain` after the actual
composition PDF is chosen. `getWorkspaceInput({bakeComposition:true,operation})`
can render pending composition into owned bytes with actual capabilities and
`composition-baked` loss; it does not adopt them.

PDF modes use `restoreCompositionHistory('undo'|'redo',{operation})` before their
ordinary PDF history path. A composition target renders before committing Undo,
then returns `{targetSlug:'jpg-to-pdf',handoff}` for guarded compatible navigation.
Empty targets skip PDF export and retain a usable empty composer. Storage failure
rolls back the history transition while it still owns the committed state.
Object, page-task and page-effect adapters consume this finite helper.

`readPdfFile(file,{validate:true,operation})` accepts an external intake owner
with `signal`/`isCurrent()`. It checks every asynchronous validation boundary and
the final `begin`; abort destroys PDF.js loading work. Browser file reads and
pdf-lib parsing may finish after cancellation but cannot publish. Mixed image/PDF
entries own this token separately from the common document operation scope and
invalidate it on newer image intent or Clear.

Limits are exported as `COMPOSITION_LIMITS` from the state/session modules:
48 active plus pending entries, at most 16 pending, 48 task-lifetime unique
originals, 48 retained unique normalized assets, 48 MiB raw and 48 MiB normalized,
and 16 MiB/4096-edge/16M pixels per image. Original and normalized dimensions
validate against their encoded headers. Every retained resource, including PDF
scene/history sources, shares the existing 96-MiB/128-resource cap. Session
retention remains 512 MiB, history five entries/64 MiB, and stored file references
160. Admission rejects transactionally; it does not evict history to make room.
The ordinary five-entry history policy still applies to edits.

Serial normalization must retain reservations until abandoned native jobs drain.
`imageAsset(file,{trim:false,signal})` checks cancellation around native jobs and
closes its bitmap/releases both canvases in `finally`; native decode/encoding
cannot itself be interrupted. These bounds do not guarantee native codec heap.

## Separate handoff ownership correction

`stashForChain` now checks ownership across optional-module loading, store
loading, expiry cleanup and bundle completion. `putWorkflowBundle(workflow,
files,{isCurrent,signal})` also checks after DB open and before awaited writes,
aborting stale transactions atomically. The third argument is optional for
existing callers. There is no stale `deleteWorkflow(taskId)`: a later handoff
with the same task ID must survive an older completion. Returned ownership is
checked by all navigation callers; canceled results cannot restore an old task.

Focused Node checks pass for state/ref/header validation, immutable provenance,
history/transfer, same-byte boundaries, held hashing, held cleanup/bundle, and
newer same-task bundle survival. Native browser/artifact gates and independent
review are required before this checkpoint is called verified.
