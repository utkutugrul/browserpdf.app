'use strict';

import { COMPOSITION_LIMITS, safeComposition, safeCompositionSources, imageDimensions, validateCompositionResources } from './composition-state.js';
import { validateHighlight } from './highlight-annotations.js';
export { COMPOSITION_LIMITS } from './composition-state.js';

export const MAX_ARTIFACT_BYTES = 250 * 1024 * 1024;
export const MAX_HISTORY_BYTES = 64 * 1024 * 1024;
export const MAX_HISTORY_ENTRIES = 5;
export const MAX_SESSION_BYTES = 512 * 1024 * 1024;
export const MAX_ARTIFACT_DISPLAY_NAME_LENGTH = 260;
export const BOUNDARY_LOSSES = Object.freeze(['page-copy-structures-unverified', 'page-copy-form-definitions', 'page-copy-document-metadata', 'page-copy-bookmarks', 'page-copy-tags', 'page-copy-named-resources', 'page-copy-labels', 'signature-rewrite', 'structure-inspection-incomplete', 'crop-hidden-content', 'scene-baked', 'composition-baked', 'redaction-selected-pages-rasterized', 'redaction-document-rasterized', 'redaction-metadata-removed']);
function boundary(value) { return value && ['page-copy', 'pdf-rewrite', 'raster-redaction'].includes(value.kind) ? { kind: value.kind, losses: [...new Set((value.losses || []).filter((code) => BOUNDARY_LOSSES.includes(code)))].slice(0, 12) } : undefined; }
function safeScene(value) {
  if (!value) return null;
  if (value.version !== 1 || typeof value.sourceRef !== 'string' || !Array.isArray(value.objects) || value.objects.length > 300) throw new Error('Invalid workspace scene.');
  const objects = value.objects.map((o) => {
    if (o.kind === 'highlight') {
      if (typeof o.id !== 'string' || !o.id || o.id.length > 100 || !Number.isInteger(o.pageIndex) || o.pageIndex < 0) throw new Error('Invalid highlight object.');
      return { id: o.id, kind: o.kind, pageIndex: o.pageIndex, ...validateHighlight(o) };
    }
    if (!['text', 'image', 'signature'].includes(o.kind) || typeof o.id !== 'string' || ![o.x, o.y, o.width, o.height].every(Number.isFinite) || o.width <= 0 || o.height <= 0 || !Number.isInteger(o.pageIndex) || o.pageIndex < 0) throw new Error('Invalid workspace object.');
    const out = { id: o.id.slice(0, 100), kind: o.kind, pageIndex: o.pageIndex, x: o.x, y: o.y, width: o.width, height: o.height };
    if (o.kind === 'text') {
      if (typeof o.text !== 'string' || o.text.length > 10000 || !(o.fontSize > 0 && o.fontSize < 10000)) throw new Error('Invalid object text.');
      Object.assign(out, { text: o.text, fontSize: o.fontSize, weight: ['regular', 'bold', 'italic', 'boldItalic', 'code'].includes(o.weight) ? o.weight : 'regular', color: Array.isArray(o.color) && o.color.length === 3 && o.color.every((n) => Number.isFinite(n) && n >= 0 && n <= 1) ? [...o.color] : [0, 0, 0] });
    } else { if (typeof o.assetId !== 'string') throw new Error('Invalid image reference.'); out.assetId = o.assetId; out.opacity = Number.isFinite(o.opacity) ? Math.max(0, Math.min(1, o.opacity)) : 1; }
    return out;
  });
  const fields = Object.create(null);
  const entries = Object.entries(value.fields || {});
  if (entries.length > 1000) throw new RangeError('This workspace supports at most 1000 edited form fields. Previous values were retained.');
  for (const [name, field] of entries) {
    if (!['text', 'checkbox', 'dropdown', 'optionlist', 'radio'].includes(field.kind)) throw new Error('Invalid form field type.');
    if (name.length > 10000) throw new RangeError('A field name exceeds the 10000-character limit. Previous values were retained.');
    const validValue = typeof field.value === 'boolean' || typeof field.value === 'string' || Array.isArray(field.value);
    if (!validValue || (typeof field.value === 'string' && field.value.length > 10000) || (Array.isArray(field.value) && (field.value.length > 300 || field.value.some((v) => typeof v !== 'string' || v.length > 10000)))) throw new RangeError('A field value exceeds the 10000-character or 300-option limit. Previous values were retained.');
    fields[name] = { kind: field.kind, value: Array.isArray(field.value) ? [...field.value] : field.value };
  }
  const state = { version: 1, sourceRef: value.sourceRef, objects, fields, flatten: value.flatten === true };
  if (JSON.stringify(state).length > 512000) throw new RangeError('Workspace state exceeds 500 KB.');
  return state;
}
const MIME_BY_EXTENSION = { pdf: 'application/pdf', md: 'text/markdown', txt: 'text/plain', csv: 'text/csv', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', zip: 'application/zip', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
const MIME_TYPES = new Set(Object.values(MIME_BY_EXTENSION));
const CAPABILITIES = ['encrypted', 'searchable', 'forms', 'rasterized'];

export function artifactType(name, type) {
  if (typeof type === 'string' && MIME_TYPES.has(type)) return type;
  return MIME_BY_EXTENSION[String(name).split('.').pop().toLowerCase()] || 'application/octet-stream';
}

function artifactDisplayName(name, safeName, options) {
  // A descriptor can preserve its label only for that exact filename. A new
  // output name must not inherit a source label through {...current} options.
  let value = (options.name === name && typeof options.displayName === 'string' ? options.displayName : String(name)).replace(/[\u0000-\u001f\u007f-\u009f]/g, '');
  if (!value.trim()) value = safeName.replace(/[\u007f-\u009f]/g, '');
  if (!value.trim()) value = 'document.pdf';
  if (value.length > MAX_ARTIFACT_DISPLAY_NAME_LENGTH) value = value.slice(0, MAX_ARTIFACT_DISPLAY_NAME_LENGTH - 1).replace(/[\ud800-\udbff]$/, '') + '…';
  return value;
}

function artifactDetails(name, options) {
  const capabilities = {};
  for (const key of CAPABILITIES) if (typeof options.capabilities?.[key] === 'boolean') capabilities[key] = options.capabilities[key];
  const safeName = String(name).replace(/[\u0000-\u001f]/g, '').slice(0, 160);
  return { boundary: boundary(options.boundary), name: safeName, displayName: artifactDisplayName(name, safeName, options), type: artifactType(name, options.type), capabilities };
}

export function createArtifact(bytes, name = 'document.pdf', options = {}) {
  if ((bytes?.byteLength || bytes?.length || 0) > MAX_ARTIFACT_BYTES) throw new RangeError('Choose a non-empty result smaller than 250 MB.');
  const owned = bytes instanceof ArrayBuffer ? new Uint8Array(bytes.slice(0)) : Uint8Array.from(bytes);
  if (!owned.length || owned.length > MAX_ARTIFACT_BYTES) throw new RangeError('Choose a non-empty result smaller than 250 MB.');
  return { ...artifactDetails(name, options), bytes: owned };
}

// This intentionally has no generic metadata bag: passwords and arbitrary form
// parameters can never enter the document history or a serialized handoff.
export function createDocumentSession() {
  let original = null;
  let current = null;
  let revision = 0;
  let generation = 0;
  let history = [];
  let future = [];
  let selection = [];
  let taskId = null;
  let scene = null;
  let composition = null, compositionSources = null, compositionPublishedRevision = null;
  let resources = new Map();
  const cloneScene = safeScene;
  const entry = () => ({ ...current, bytes: scene ? resources.get(scene.sourceRef).bytes : current.bytes, scene: cloneScene(scene), composition: safeComposition(composition), compositionPublishedRevision });
  const historySize = (items) => [...new Set(items.map((a) => a.bytes))].filter((bytes) => bytes !== current?.bytes && bytes !== original?.bytes && ![...resources.values()].some((r) => r.bytes === bytes)).reduce((n, bytes) => n + bytes.length, 0);
  const restore = (value) => { scene = cloneScene(value.scene); composition = safeComposition(value.composition); compositionPublishedRevision = value.compositionPublishedRevision ?? null; return createArtifact(value.bytes, value.name, value); };
  const resourceBytes = () => [...resources.values()].reduce((n, value) => n + value.bytes.length, 0);
  const compositionUsage = () => {
    const originalRefs = new Set(compositionSources?.originals.map((item) => item.originalRef) || []), assetRefs = new Set();
    for (const state of [composition, ...history.map((a) => a.composition), ...future.map((a) => a.composition)].filter(Boolean)) for (const item of state.items) assetRefs.add(item.assetId);
    return { compositionRawBytes: [...originalRefs].reduce((n, key) => n + (resources.get(key)?.bytes.length || 0), 0), compositionNormalizedBytes: [...assetRefs].reduce((n, key) => n + (resources.get(key)?.bytes.length || 0), 0) };
  };
  function referencedResources(activeScene = scene, activeComposition = composition, sources = compositionSources, past = history, upcoming = future) {
    const ids = new Set(sources?.originals.map((item) => item.originalRef) || []);
    for (const state of [activeScene, ...past.map((a) => a.scene), ...upcoming.map((a) => a.scene)].filter(Boolean)) {
      ids.add(state.sourceRef);
      for (const object of state.objects) if (object.assetId) ids.add(object.assetId);
    }
    for (const state of [activeComposition, ...past.map((a) => a.composition), ...upcoming.map((a) => a.composition)].filter(Boolean)) for (const item of state.items) { ids.add(item.originalRef); ids.add(item.assetId); }
    return ids;
  }
  function collectResources() {
    const ids = referencedResources();
    for (const id of resources.keys()) if (!ids.has(id)) resources.delete(id);
  }
  const copy = (value) => value ? createArtifact(value.bytes, value.name, value) : null;
  const metadata = (value) => value ? { boundary: boundary(value.boundary), name: value.name, displayName: value.displayName, type: value.type, size: value.bytes.length, capabilities: { ...value.capabilities } } : null;
  const retainedBytes = () => [...new Set([original, current, ...history, ...future].filter(Boolean).map((a) => a.bytes))].reduce((n, bytes) => n + bytes.length, resourceBytes());
  function bound() {
    collectResources();
    while (history.length && (history.length > MAX_HISTORY_ENTRIES || historySize(history) > MAX_HISTORY_BYTES || retainedBytes() > MAX_SESSION_BYTES)) history.shift();
    while (future.length && (future.length > MAX_HISTORY_ENTRIES || historySize(future) > MAX_HISTORY_BYTES || retainedBytes() > MAX_SESSION_BYTES)) future.shift();
    collectResources();
  }
  function assertCompositionOwner({ expectedTaskId, expectedRevision, signal } = {}, ownerGeneration = generation) {
    signal?.throwIfAborted();
    if (expectedTaskId !== taskId || expectedRevision !== revision || ownerGeneration !== generation) throw new DOMException('This image operation was replaced or cancelled.', 'AbortError');
  }
  function validateStagedComposition(next, sources, staged, past, upcoming, nextCurrent = current, nextOriginal = original, activeScene = scene) {
    validateCompositionResources(sources, [next, ...past.map((a) => a.composition), ...upcoming.map((a) => a.composition)], staged);
    const refs = referencedResources(activeScene, next, sources, past, upcoming);
    const retained = new Map([...staged].filter(([key]) => refs.has(key)));
    if (retained.size !== refs.size) throw new Error('A retained workspace resource is missing.');
    const size = [...retained.values()].reduce((n, value) => n + value.bytes.length, 0);
    if (retained.size > 128 || size > 96 * 1024 * 1024) throw new RangeError('All retained workspace resources share a 96 MB/128-resource limit. Start a new task to release originals and prior sources.');
    const byteSets = new Set([...retained.values(), nextCurrent, nextOriginal, ...past, ...upcoming].filter(Boolean).map((a) => a.bytes));
    if ([...byteSets].reduce((n, bytes) => n + bytes.length, 0) > MAX_SESSION_BYTES) throw new RangeError('This result and its retained sources exceed the 512 MB session limit.');
    return retained;
  }
  async function stagePairs(pairs, guards, baseResources, sources) {
    if (!Array.isArray(pairs) || !pairs.length || pairs.length > COMPOSITION_LIMITS.entries) throw new RangeError('Choose between 1 and 48 images.');
    const ownerGeneration = generation, staged = new Map(baseResources), group = safeCompositionSources(sources), originals = group?.originals || [], items = [], ids = new Set();
    const assetRefs = new Set();
    for (const state of [composition, ...history.map((a) => a.composition), ...future.map((a) => a.composition)].filter(Boolean)) for (const item of state.items) if (baseResources.has(item.assetId)) assetRefs.add(item.assetId);
    const digest = async (bytes) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((n) => n.toString(16).padStart(2, '0')).join('');
    for (const pair of pairs) {
      assertCompositionOwner(guards, ownerGeneration);
      if (!pair || typeof pair.id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(pair.id) || ids.has(pair.id)) throw new Error('Invalid or duplicate image identity.');
      ids.add(pair.id);
      for (const image of [pair.original, pair.asset]) if (!(image?.bytes?.byteLength > 0) || image.bytes.byteLength > COMPOSITION_LIMITS.imageBytes) throw new RangeError('Original and normalized images must each be at most 16 MB.');
      const raw = createArtifact(pair.original?.bytes, pair.original?.name, pair.original || {}), normalized = createArtifact(pair.asset?.bytes, pair.asset?.name, pair.asset || {});
      if (!['image/png', 'image/jpeg'].includes(raw.type) || normalized.type !== 'image/png' || raw.bytes.length > COMPOSITION_LIMITS.imageBytes || normalized.bytes.length > COMPOSITION_LIMITS.imageBytes) throw new RangeError('Original and normalized images must each be at most 16 MB.');
      imageDimensions(raw.bytes, raw.type);
      const dimensions = imageDimensions(normalized.bytes, normalized.type);
      if (dimensions.width !== pair.asset.width || dimensions.height !== pair.asset.height) throw new Error('Normalized image dimensions do not match its bytes.');
      const originalRef = `source-${await digest(raw.bytes)}`; assertCompositionOwner(guards, ownerGeneration);
      const assetId = `asset-${await digest(normalized.bytes)}`; assertCompositionOwner(guards, ownerGeneration);
      const displayName = typeof pair.original.name === 'string' ? pair.original.name.replace(/[\u0000-\u001f]/g,'').slice(0,260) : raw.name;
      const newOriginal = !originals.some((item) => item.originalRef === originalRef), newAsset = !assetRefs.has(assetId);
      const rawTotal = originals.reduce((n, item) => n + staged.get(item.originalRef).bytes.length, 0) + (newOriginal ? raw.bytes.length : 0);
      const normalizedTotal = [...assetRefs].reduce((n, key) => n + staged.get(key).bytes.length, 0) + (newAsset ? normalized.bytes.length : 0);
      if (originals.length + Number(newOriginal) > COMPOSITION_LIMITS.originals || assetRefs.size + Number(newAsset) > COMPOSITION_LIMITS.assets || rawTotal > COMPOSITION_LIMITS.rawBytes || normalizedTotal > COMPOSITION_LIMITS.normalizedBytes) throw new RangeError('Retained images exceed the 48 original/48 MB image limit. Start a new task to release originals.');
      const additions = [[originalRef, raw], [assetId, normalized]].filter(([key]) => !staged.has(key));
      const addedBytes = additions.reduce((n, [, image]) => n + image.bytes.length, 0);
      if (staged.size + additions.length > 128 || [...staged.values()].reduce((n, image) => n + image.bytes.length, addedBytes) > 96 * 1024 * 1024) throw new RangeError('All retained workspace resources share a 96 MB/128-resource limit. Start a new task to release originals and prior sources.');
      for (const [key, artifact] of [[originalRef, raw], [assetId, normalized]]) {
        const existing = staged.get(key);
        if (existing && (existing.type !== artifact.type || existing.bytes.length !== artifact.bytes.length || !existing.bytes.every((byte, index) => byte === artifact.bytes[index]))) throw new Error('Conflicting immutable image resource.');
        if (!existing) staged.set(key, { ...artifact, id: key });
      }
      if (newOriginal) originals.push({ originalRef, name: displayName, type: raw.type });
      assetRefs.add(assetId);
      items.push({ id: pair.id, originalRef, assetId, ...dimensions, rotation: pair.rotation ?? 0, fit: pair.fit ?? 'fit', name:displayName });
    }
    return { items, resources: staged, sources: safeCompositionSources({ version: 1, originals }), ownerGeneration };
  }
  return {
    begin(bytes, name, options = {}) {
      const incomingSize = (options.resources || []).reduce((n, value) => n + (value.bytes?.byteLength || value.bytes?.length || 0), 0);
      const baseSize = (bytes?.byteLength || bytes?.length || 0) + (options.original ? options.original.bytes?.byteLength || options.original.bytes?.length || 0 : 0) + incomingSize;
      if (baseSize > MAX_SESSION_BYTES) throw new RangeError('This document and its source resources exceed the 512 MB session limit.');
      const ownedCopies = new Map();
      const stageArtifact = (input, inputName, descriptor) => {
        if (ownedCopies.has(input)) return { ...artifactDetails(inputName, descriptor), bytes: ownedCopies.get(input) };
        const artifact = createArtifact(input, inputName, descriptor); ownedCopies.set(input, artifact.bytes); return artifact;
      };
      const currentDescriptor = options.current?.name === name ? { ...options, name: options.current.name, displayName: options.current.displayName } : options;
      const candidate = stageArtifact(bytes, name, currentDescriptor);
      const source = options.original ? stageArtifact(options.original.bytes, options.original.name, options.original) : candidate;
      const incoming = Array.isArray(options.resources) ? options.resources : [];
      if (incoming.length > 128 || incoming.reduce((n, a) => n + (a.bytes?.byteLength || 0), 0) > 96 * 1024 * 1024) throw new RangeError('Workspace resources exceed 96 MB.');
      const stagedResources = new Map(incoming.map((a) => {
        if (typeof a.id !== 'string' || !/^(source|asset)-[a-zA-Z0-9-]{1,80}$/.test(a.id)) throw new Error('Invalid workspace resource.');
        return [a.id, { ...stageArtifact(a.bytes, a.name, a), id: a.id }];
      }));
      if (stagedResources.size !== incoming.length) throw new Error('Duplicate workspace resource.');
      const restoreCheckpoint = (a) => {
        const bytes = a.scene ? stagedResources.get(a.sourceRef || a.scene.sourceRef)?.bytes : a.bytes;
        if (!bytes) throw new Error('Workspace history source is missing.');
        // Scene history owns state plus the already-staged immutable source;
        // alias before joint validation rather than copying 80 MiB per edit.
        const artifact = a.scene ? { ...artifactDetails(a.name, a), bytes } : stageArtifact(bytes, a.name, a);
        return { ...artifact, scene: cloneScene(a.scene), composition: safeComposition(a.composition), compositionPublishedRevision: Number.isSafeInteger(a.compositionPublishedRevision) ? a.compositionPublishedRevision : null };
      };
      const past = (Array.isArray(options.history) ? options.history : []).slice(-MAX_HISTORY_ENTRIES).map(restoreCheckpoint);
      const upcoming = (Array.isArray(options.future) ? options.future : []).slice(-MAX_HISTORY_ENTRIES).map(restoreCheckpoint);
      const stagedScene = cloneScene(options.scene);
      const stagedComposition = safeComposition(options.composition), stagedSources = safeCompositionSources(options.compositionSources);
      if (stagedScene && stagedComposition) throw new Error('Choose either an editable PDF scene or image composition.');
      for (const state of [stagedScene, ...past.map((a) => a.scene), ...upcoming.map((a) => a.scene)].filter(Boolean)) {
        if (!stagedResources.has(state.sourceRef) || state.objects.some((o) => o.assetId && !stagedResources.has(o.assetId))) throw new Error('Workspace resource is missing.');
        const editableSource = stagedResources.get(state.sourceRef);
        if (!state.sourceRef.startsWith('source-') || editableSource.type !== 'application/pdf' || editableSource.bytes.length > 80 * 1024 * 1024) throw new RangeError('Editable workspace source PDFs are limited to 80 MB.');
        for (const object of state.objects) if (object.assetId) {
          const asset = stagedResources.get(object.assetId);
          if (!object.assetId.startsWith('asset-') || !['image/png', 'image/jpeg'].includes(asset.type) || asset.bytes.length > 16 * 1024 * 1024) throw new RangeError('Invalid workspace image resource (PNG/JPEG, at most 16 MB).');
        }
      }
      const stagedTaskId = typeof options.taskId === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(options.taskId) ? options.taskId : crypto.randomUUID();
      const stagedRevision = Math.max(0, Math.min(100000, Number(options.revision) || 0));
      const stagedSelection = [...new Set((Array.isArray(options.selection) ? options.selection : []).filter(Number.isInteger).filter((n) => n >= 0))].slice(0, 10000);
      validateStagedComposition(stagedComposition, stagedSources, stagedResources, past, upcoming, candidate, source, stagedScene);
      // Commit only after every resource, scene and identity input validates.
      generation++; revision = stagedRevision; taskId = stagedTaskId;
      resources = stagedResources; scene = stagedScene; composition = stagedComposition; compositionSources = stagedSources; compositionPublishedRevision = Number.isSafeInteger(options.compositionPublishedRevision) ? options.compositionPublishedRevision : null;
      for (const item of [...past, ...upcoming]) if (item.scene) item.bytes = stagedResources.get(item.scene.sourceRef).bytes;
      current = candidate; original = source; history = past; future = upcoming;
      selection = stagedSelection; bound();
      return this.snapshot();
    },
    adopt(bytes, name, options = {}) {
      const next = createArtifact(bytes, name, { ...options, capabilities: options.capabilities || current?.capabilities });
      const adoptedTaskId = taskId || crypto.randomUUID();
      if (!composition && current && current.type === next.type && JSON.stringify(current.capabilities) === JSON.stringify(next.capabilities) && current.bytes.length === next.bytes.length && current.bytes.every((byte, index) => byte === next.bytes[index])) { taskId = adoptedTaskId; current = { ...current, name: next.name, displayName: next.displayName }; return this.snapshot(); }
      const stagedHistory = current ? [...history, entry()].slice(-MAX_HISTORY_ENTRIES) : [];
      validateStagedComposition(null, compositionSources, resources, stagedHistory, [], next, original || next, null);
      if (!original) original = copy(next);
      if (current) history.push(entry());
      taskId = adoptedTaskId; current = next; scene = null; composition = null; compositionPublishedRevision = null; future = []; revision++; generation++; bound();
      return this.snapshot();
    },
    historyTarget(kind) { const value = (kind === 'redo' ? future : history).at(-1); return value ? { artifact: copy(value), scene: cloneScene(value.scene), composition: safeComposition(value.composition), revision, generation } : null; },
    undo() { if (!history.length) return null; future.push(entry()); current = restore(history.pop()); revision++; generation++; bound(); return copy(current); },
    redo() { if (!future.length) return null; history.push(entry()); current = restore(future.pop()); revision++; generation++; bound(); return copy(current); },
    setSelection(pages) { selection = [...new Set((Array.isArray(pages) ? pages : []).filter(Number.isInteger).filter((n) => n >= 0))].slice(0, 10000); },
    invalidate() { generation++; },
    clear() { scene = composition = compositionSources = null; compositionPublishedRevision = null; resources.clear(); original = current = null; taskId = null; history = []; future = []; selection = []; generation++; revision = 0; },
    snapshot({ includeBytes = false } = {}) { return { taskId, original: includeBytes ? copy(original) : metadata(original), current: includeBytes ? copy(current) : metadata(current), revision, generation, selection: [...selection], canUndo: history.length > 0, canRedo: future.length > 0, historyBytes: historySize(history), retainedBytes: retainedBytes(), hasScene: !!scene, objectCount: scene?.objects.length || 0, resourceBytes: resourceBytes(), resourceCount: resources.size, hasComposition: !!composition, compositionPublishedRevision, originalImageCount: compositionSources?.originals.length || 0, ...compositionUsage() }; },
    transfer() {
      const copies = new Map();
      const transferArtifact = (a) => {
        if (!a) return null;
        const result = { ...a, capabilities: { ...a.capabilities }, boundary: boundary(a.boundary) };
        if (!copies.has(a.bytes)) copies.set(a.bytes, a.bytes.slice());
        result.bytes = copies.get(a.bytes); return result;
      };
      const checkpoint = (a) => a.scene ? { name: a.name, displayName: a.displayName, type: a.type, capabilities: { ...a.capabilities }, boundary: boundary(a.boundary), sourceRef: a.scene.sourceRef, scene: cloneScene(a.scene) } : { ...transferArtifact(a), composition: safeComposition(a.composition), compositionPublishedRevision: a.compositionPublishedRevision ?? null };
      return { ...this.snapshot(), original: transferArtifact(original), current: transferArtifact(current), history: history.map(checkpoint), future: future.map(checkpoint), scene: cloneScene(scene), composition: safeComposition(composition), compositionSources: safeCompositionSources(compositionSources), resources: [...resources.values()].map(transferArtifact) };
    },
    composition() { return safeComposition(composition); },
    compositionSources() { return safeCompositionSources(compositionSources); },
    async beginComposition(pairs, guards = {}) {
      assertCompositionOwner(guards);
      const staged = await stagePairs(pairs, guards, new Map(), null);
      const next = safeComposition({ version: 1, items: staged.items, paper: 'image', orientation: 'portrait', margin: 0, selectedId: staged.items[0].id });
      const first = staged.resources.get(next.items[0].originalRef);
      validateStagedComposition(next, staged.sources, staged.resources, [], [], first, first, null);
      assertCompositionOwner(guards, staged.ownerGeneration);
      return this.begin(first.bytes, first.name, { name: first.name, displayName: first.displayName, type: first.type, composition: next, compositionSources: staged.sources, resources: [...staged.resources.values()] });
    },
    async startCompositionFromCurrent(pair, guards = {}) {
      assertCompositionOwner(guards);
      if (composition || !current || !['image/png', 'image/jpeg'].includes(current.type)) throw new Error('Choose a current PNG/JPEG before starting its composition.');
      const incoming = pair?.original?.bytes;
      if (pair?.original?.type !== current.type || incoming?.length !== current.bytes.length || !current.bytes.every((byte, index) => byte === incoming[index])) throw new Error('The composition input must be the exact chosen current image.');
      const staged = await stagePairs([pair], guards, resources, compositionSources);
      assertCompositionOwner(guards, staged.ownerGeneration);
      const next = safeComposition({ version: 1, items: staged.items, paper: 'image', orientation: 'portrait', margin: 0, selectedId: staged.items[0].id }), past = [...history, entry()].slice(-MAX_HISTORY_ENTRIES);
      const retained = validateStagedComposition(next, staged.sources, staged.resources, past, [], current, original, null);
      resources = retained; compositionSources = staged.sources; history = past; future = []; scene = null; composition = next; compositionPublishedRevision = null; revision++; generation++; bound(); return this.snapshot();
    },
    async appendCompositionInputs(pairs, guards = {}) {
      assertCompositionOwner(guards);
      if (!composition) throw new Error('Open an image composition first.');
      const staged = await stagePairs(pairs, guards, resources, compositionSources);
      assertCompositionOwner(guards, staged.ownerGeneration);
      const next = safeComposition({ ...composition, items: [...composition.items, ...staged.items], selectedId: staged.items.at(-1).id }), past = [...history, entry()].slice(-MAX_HISTORY_ENTRIES);
      const retained = validateStagedComposition(next, staged.sources, staged.resources, past, []);
      resources = retained; compositionSources = staged.sources; history = past; future = []; composition = next; compositionPublishedRevision = null; revision++; generation++; bound(); return this.snapshot();
    },
    changeComposition(next, guards = {}) {
      assertCompositionOwner(guards);
      if (!composition) throw new Error('Open an image composition first.');
      const staged = safeComposition(next);
      if (JSON.stringify(staged) === JSON.stringify(composition)) return this.snapshot();
      const past = [...history, entry()].slice(-MAX_HISTORY_ENTRIES), retained = validateStagedComposition(staged, compositionSources, resources, past, []);
      resources = retained; history = past; future = []; composition = staged; compositionPublishedRevision = null; revision++; generation++; bound(); return this.snapshot();
    },
    setCompositionSelection(id, guards = {}) {
      assertCompositionOwner(guards);
      if (!composition || (id !== null && !composition.items.some((item) => item.id === id))) throw new Error('Choose an existing composition image.');
      composition = { ...composition, selectedId: id }; return this.snapshot();
    },
    publishComposition(bytes, name, options = {}) {
      assertCompositionOwner(options);
      if (!composition) throw new Error('Open an image composition first.');
      const next = createArtifact(bytes, name, { ...options, type: 'application/pdf', capabilities: options.capabilities || { encrypted: false, searchable: false, forms: false, rasterized: true } });
      validateStagedComposition(composition, compositionSources, resources, history, future, next);
      if (compositionPublishedRevision === revision && current.type === next.type && current.bytes.length === next.bytes.length && current.bytes.every((byte, index) => byte === next.bytes[index])) return this.snapshot();
      current = next; compositionPublishedRevision = revision; generation++; bound(); return this.snapshot();
    },
    beginScene() {
      if (!current || current.type !== 'application/pdf') throw new Error('Open a PDF first.');
      if (composition) throw new Error('Choose the composed PDF result before opening a PDF editor.');
      if (!scene) {
        if (current.bytes.length > 80 * 1024 * 1024) throw new RangeError('Editable workspace PDFs are limited to 80 MB to reserve space for images and history.');
        const id = `source-${crypto.randomUUID()}`;
        const stagedScene = { version: 1, sourceRef: id, objects: [], fields: Object.create(null), flatten: false }, stagedResources = new Map(resources);
        stagedResources.set(id, { ...current, id });
        const retained = validateStagedComposition(composition, compositionSources, stagedResources, history, future, current, original, stagedScene);
        resources = retained; scene = stagedScene;
      }
      return cloneScene(scene);
    },
    scene() { return cloneScene(scene); },
    resource(id) { const value = resources.get(id); return value ? { ...copy(value), id } : null; },
    async addAsset(bytes, type, name = 'asset.png') {
      const owner = taskId, sourceRef = scene?.sourceRef, ownerGeneration = generation;
      if (!sourceRef) throw new Error('Open an editable workspace first.');
      const owned = Uint8Array.from(bytes);
      if (!owned.length || owned.length > 16 * 1024 * 1024) throw new RangeError('Choose an image smaller than 16 MB.');
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', owned))].map((n) => n.toString(16).padStart(2, '0')).join('');
      if (taskId !== owner || scene?.sourceRef !== sourceRef || generation !== ownerGeneration) throw new DOMException('Image intake was replaced or cancelled.', 'AbortError');
      const id = `asset-${digest}`;
      if (!resources.has(id)) {
        if (resources.size >= 128 || resourceBytes() + owned.length > 96 * 1024 * 1024 || retainedBytes() + owned.length > MAX_SESSION_BYTES) throw new RangeError('Workspace resources exceed the local 96 MB limit. Remove objects or start a new task.');
        resources.set(id, { ...createArtifact(owned, name, { type }), id });
      }
      return id;
    },
    changeScene(next) {
      if (!scene || next.sourceRef !== scene.sourceRef || !Array.isArray(next.objects) || next.objects.length > 300 || JSON.stringify(next).length > 512000) throw new RangeError('Workspace object limit exceeded.');
      if (JSON.stringify(next) === JSON.stringify(scene)) return this.snapshot();
      for (const object of next.objects) if (object.assetId && !resources.has(object.assetId)) throw new Error('Missing workspace image.');
      const staged = cloneScene(next); history.push(entry()); scene = staged; future = []; revision++; generation++; bound(); return this.snapshot();
    },
    publishScene(bytes, name, options = {}) {
      if (scene) { const refs = new Set([scene.sourceRef, ...scene.objects.map((o) => o.assetId).filter(Boolean)]); const required = [...refs].reduce((n, id) => n + (resources.get(id)?.bytes.length || 0), 0); if ((bytes?.byteLength || bytes?.length || 0) + (original?.bytes.length || 0) + required > MAX_SESSION_BYTES) throw new RangeError('This result and its editable resources exceed the 512 MB session limit.'); }
      if (!scene) return this.adopt(bytes, name, options);
      const next = createArtifact(bytes, name, { ...options, capabilities: options.capabilities || current.capabilities });
      validateStagedComposition(composition, compositionSources, resources, history, future, next);
      current = next;
      generation++; bound(); return this.snapshot();
    },
    current() { return copy(current); },
    original() { return copy(original); },
  };
}

export function acceptsArtifact(slug, artifact) {
  const pdfTools = ['add-text', 'add-image', 'fill-sign', 'highlight', 'redact', 'view-pdf', 'edit-metadata', 'merge', 'split', 'organize', 'rotate', 'delete-pages', 'crop', 'page-numbers', 'watermark', 'compress', 'ocr-pdf', 'protect', 'unlock', 'pdf-to-markdown', 'pdf-to-word', 'extract-text', 'images', 'pdf-to-excel', 'workflows', 'privacy-scan', 'document-doctor'];
  if (artifact.capabilities?.encrypted) return artifact.type === 'application/pdf' && slug === 'unlock';
  if (artifact.type === 'application/pdf') return pdfTools.includes(slug);
  if (['text/markdown', 'text/plain'].includes(artifact.type)) return ['markdown-to-pdf', 'markdown-viewer'].includes(slug);
  if (artifact.type.startsWith('image/')) return ['jpg-to-pdf', 'images'].includes(slug);
  if (/wordprocessingml/.test(artifact.type)) return slug === 'word-to-pdf';
  if (/spreadsheetml/.test(artifact.type)) return slug === 'excel-to-pdf';
  if (artifact.type === 'text/csv') return slug === 'excel-to-pdf';
  return false;
}

export { createOperationScope } from './operation-scope.js';
