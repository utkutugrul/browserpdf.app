'use strict';

export const MAX_ARTIFACT_BYTES = 250 * 1024 * 1024;
export const MAX_HISTORY_BYTES = 64 * 1024 * 1024;
export const MAX_HISTORY_ENTRIES = 5;
export const MAX_SESSION_BYTES = 512 * 1024 * 1024;
export const BOUNDARY_LOSSES = Object.freeze(['page-copy-structures-unverified', 'page-copy-form-definitions', 'page-copy-document-metadata', 'page-copy-bookmarks', 'page-copy-tags', 'page-copy-named-resources', 'page-copy-labels', 'signature-rewrite', 'structure-inspection-incomplete', 'crop-hidden-content', 'scene-baked']);
function boundary(value) { return value && ['page-copy', 'pdf-rewrite', 'raster-redaction'].includes(value.kind) ? { kind: value.kind, losses: [...new Set((value.losses || []).filter((code) => BOUNDARY_LOSSES.includes(code)))].slice(0, 12) } : undefined; }
function safeScene(value) {
  if (!value) return null;
  if (value.version !== 1 || typeof value.sourceRef !== 'string' || !Array.isArray(value.objects) || value.objects.length > 300) throw new Error('Invalid workspace scene.');
  const objects = value.objects.map((o) => {
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

export function createArtifact(bytes, name = 'document.pdf', options = {}) {
  if ((bytes?.byteLength || bytes?.length || 0) > MAX_ARTIFACT_BYTES) throw new RangeError('Choose a non-empty result smaller than 250 MB.');
  const owned = bytes instanceof ArrayBuffer ? new Uint8Array(bytes.slice(0)) : Uint8Array.from(bytes);
  if (!owned.length || owned.length > MAX_ARTIFACT_BYTES) throw new RangeError('Choose a non-empty result smaller than 250 MB.');
  const capabilities = {};
  for (const key of CAPABILITIES) if (typeof options.capabilities?.[key] === 'boolean') capabilities[key] = options.capabilities[key];
  return { boundary: boundary(options.boundary), bytes: owned, name: String(name).replace(/[\u0000-\u001f]/g, '').slice(0, 160), type: artifactType(name, options.type), capabilities };
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
  let resources = new Map();
  const cloneScene = safeScene;
  const entry = () => ({ ...current, bytes: scene ? resources.get(scene.sourceRef).bytes : current.bytes, scene: cloneScene(scene) });
  const historySize = (items) => [...new Set(items.map((a) => a.bytes))].filter((bytes) => bytes !== current?.bytes && bytes !== original?.bytes && ![...resources.values()].some((r) => r.bytes === bytes)).reduce((n, bytes) => n + bytes.length, 0);
  const restore = (value) => { scene = cloneScene(value.scene); return createArtifact(value.bytes, value.name, value); };
  const resourceBytes = () => [...resources.values()].reduce((n, value) => n + value.bytes.length, 0);
  function collectResources() {
    const ids = new Set();
    for (const state of [scene, ...history.map((a) => a.scene), ...future.map((a) => a.scene)].filter(Boolean)) {
      ids.add(state.sourceRef);
      for (const object of state.objects) if (object.assetId) ids.add(object.assetId);
    }
    for (const id of resources.keys()) if (!ids.has(id)) resources.delete(id);
  }
  const copy = (value) => value ? createArtifact(value.bytes, value.name, value) : null;
  const metadata = (value) => value ? { boundary: boundary(value.boundary), name: value.name, type: value.type, size: value.bytes.length, capabilities: { ...value.capabilities } } : null;
  const retainedBytes = () => [...new Set([original, current, ...history, ...future].filter(Boolean).map((a) => a.bytes))].reduce((n, bytes) => n + bytes.length, resourceBytes());
  function bound() {
    collectResources();
    while (history.length && (history.length > MAX_HISTORY_ENTRIES || historySize(history) > MAX_HISTORY_BYTES || retainedBytes() > MAX_SESSION_BYTES)) history.shift();
    while (future.length && (future.length > MAX_HISTORY_ENTRIES || historySize(future) > MAX_HISTORY_BYTES || retainedBytes() > MAX_SESSION_BYTES)) future.shift();
    collectResources();
  }
  return {
    begin(bytes, name, options = {}) {
      const incomingSize = (options.resources || []).reduce((n, value) => n + (value.bytes?.byteLength || value.bytes?.length || 0), 0);
      const baseSize = (bytes?.byteLength || bytes?.length || 0) + (options.original ? options.original.bytes?.byteLength || options.original.bytes?.length || 0 : 0) + incomingSize;
      if (baseSize > MAX_SESSION_BYTES) throw new RangeError('This document and its source resources exceed the 512 MB session limit.');
      const candidate = createArtifact(bytes, name, options);
      const source = options.original ? createArtifact(options.original.bytes, options.original.name, options.original) : candidate;
      const incoming = Array.isArray(options.resources) ? options.resources : [];
      if (incoming.length > 128 || incoming.reduce((n, a) => n + (a.bytes?.byteLength || 0), 0) > 96 * 1024 * 1024) throw new RangeError('Workspace resources exceed 96 MB.');
      const stagedResources = new Map(incoming.map((a) => {
        if (typeof a.id !== 'string' || !/^(source|asset)-[a-zA-Z0-9-]{1,80}$/.test(a.id)) throw new Error('Invalid workspace resource.');
        return [a.id, { ...createArtifact(a.bytes, a.name, a), id: a.id }];
      }));
      const restoreCheckpoint = (a) => {
        const bytes = a.scene ? stagedResources.get(a.sourceRef || a.scene.sourceRef)?.bytes : a.bytes;
        if (!bytes) throw new Error('Workspace history source is missing.');
        return { ...createArtifact(bytes, a.name, a), scene: cloneScene(a.scene) };
      };
      const past = (Array.isArray(options.history) ? options.history : []).slice(-MAX_HISTORY_ENTRIES).map(restoreCheckpoint);
      const upcoming = (Array.isArray(options.future) ? options.future : []).slice(-MAX_HISTORY_ENTRIES).map(restoreCheckpoint);
      const stagedScene = cloneScene(options.scene);
      for (const state of [stagedScene, ...past.map((a) => a.scene), ...upcoming.map((a) => a.scene)].filter(Boolean)) {
        if (!stagedResources.has(state.sourceRef) || state.objects.some((o) => o.assetId && !stagedResources.has(o.assetId))) throw new Error('Workspace resource is missing.');
      }
      const stagedTaskId = typeof options.taskId === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(options.taskId) ? options.taskId : crypto.randomUUID();
      const stagedRevision = Math.max(0, Math.min(100000, Number(options.revision) || 0));
      const stagedSelection = [...new Set((Array.isArray(options.selection) ? options.selection : []).filter(Number.isInteger).filter((n) => n >= 0))].slice(0, 10000);
      // Commit only after every resource, scene and identity input validates.
      generation++; revision = stagedRevision; taskId = stagedTaskId;
      resources = stagedResources; scene = stagedScene;
      for (const item of [...past, ...upcoming]) if (item.scene) item.bytes = stagedResources.get(item.scene.sourceRef).bytes;
      current = candidate; original = source; history = past; future = upcoming;
      selection = stagedSelection; bound();
      return this.snapshot();
    },
    adopt(bytes, name, options = {}) {
      const next = createArtifact(bytes, name, { ...options, capabilities: options.capabilities || current?.capabilities });
      if (current && current.type === next.type && JSON.stringify(current.capabilities) === JSON.stringify(next.capabilities) && current.bytes.length === next.bytes.length && current.bytes.every((byte, index) => byte === next.bytes[index])) { current = { ...current, name: next.name }; return this.snapshot(); }
      if (!original) original = copy(next);
      if (current) history.push(entry());
      current = next; scene = null; future = []; revision++; generation++; bound();
      return this.snapshot();
    },
    historyTarget(kind) { const value = (kind === 'redo' ? future : history).at(-1); return value ? { artifact: copy(value), scene: cloneScene(value.scene), revision, generation } : null; },
    undo() { if (!history.length) return null; future.push(entry()); current = restore(history.pop()); revision++; generation++; bound(); return copy(current); },
    redo() { if (!future.length) return null; history.push(entry()); current = restore(future.pop()); revision++; generation++; bound(); return copy(current); },
    setSelection(pages) { selection = [...new Set((Array.isArray(pages) ? pages : []).filter(Number.isInteger).filter((n) => n >= 0))].slice(0, 10000); },
    invalidate() { generation++; },
    clear() { scene = null; resources.clear(); original = current = null; taskId = null; history = []; future = []; selection = []; generation++; revision = 0; },
    snapshot({ includeBytes = false } = {}) { return { taskId, original: includeBytes ? copy(original) : metadata(original), current: includeBytes ? copy(current) : metadata(current), revision, generation, selection: [...selection], canUndo: history.length > 0, canRedo: future.length > 0, historyBytes: historySize(history), retainedBytes: retainedBytes(), hasScene: !!scene, objectCount: scene?.objects.length || 0, resourceBytes: resourceBytes() }; },
    transfer() {
      const copies = new Map();
      const transferArtifact = (a) => {
        if (!a) return null;
        const result = { ...a, capabilities: { ...a.capabilities }, boundary: boundary(a.boundary) };
        if (!copies.has(a.bytes)) copies.set(a.bytes, a.bytes.slice());
        result.bytes = copies.get(a.bytes); return result;
      };
      const checkpoint = (a) => a.scene ? { name: a.name, type: a.type, capabilities: { ...a.capabilities }, boundary: boundary(a.boundary), sourceRef: a.scene.sourceRef, scene: cloneScene(a.scene) } : transferArtifact(a);
      return { ...this.snapshot(), original: transferArtifact(original), current: transferArtifact(current), history: history.map(checkpoint), future: future.map(checkpoint), scene: cloneScene(scene), resources: [...resources.values()].map(transferArtifact) };
    },
    beginScene() {
      if (!current || current.type !== 'application/pdf') throw new Error('Open a PDF first.');
      if (!scene) {
        if (current.bytes.length > 80 * 1024 * 1024) throw new RangeError('Editable workspace PDFs are limited to 80 MB to reserve space for images and history.');
        const id = `source-${crypto.randomUUID()}`;
        resources.set(id, { ...current, id });
        scene = { version: 1, sourceRef: id, objects: [], fields: Object.create(null), flatten: false };
      }
      return cloneScene(scene);
    },
    scene() { return cloneScene(scene); },
    resource(id) { const value = resources.get(id); return value ? { ...copy(value), id } : null; },
    async addAsset(bytes, type, name = 'asset.png') {
      const owner = taskId, sourceRef = scene?.sourceRef;
      if (!sourceRef) throw new Error('Open an editable workspace first.');
      const owned = Uint8Array.from(bytes);
      if (!owned.length || owned.length > 16 * 1024 * 1024) throw new RangeError('Choose an image smaller than 16 MB.');
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', owned))].map((n) => n.toString(16).padStart(2, '0')).join('');
      if (taskId !== owner || scene?.sourceRef !== sourceRef) throw new DOMException('Image intake was replaced or cancelled.', 'AbortError');
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
      current = createArtifact(bytes, name, { ...options, capabilities: options.capabilities || current.capabilities });
      generation++; bound(); return this.snapshot();
    },
    current() { return copy(current); },
    original() { return copy(original); },
  };
}

export function acceptsArtifact(slug, artifact) {
  const pdfTools = ['add-text', 'add-image', 'fill-sign', 'highlight', 'redact', 'view-pdf', 'edit-metadata', 'merge', 'split', 'organize', 'rotate', 'delete-pages', 'crop', 'page-numbers', 'watermark', 'compress', 'ocr-pdf', 'protect', 'unlock', 'pdf-to-markdown', 'pdf-to-word', 'extract-text', 'images', 'pdf-to-excel', 'workflows', 'privacy-scan', 'document-doctor'];
  if (artifact.capabilities?.encrypted) return artifact.type === 'application/pdf' && slug === 'unlock';
  if (artifact.type === 'application/pdf') return pdfTools.includes(slug) && !(slug === 'compress' && (artifact.capabilities?.searchable || artifact.capabilities?.forms));
  if (['text/markdown', 'text/plain'].includes(artifact.type)) return ['markdown-to-pdf', 'markdown-viewer'].includes(slug);
  if (artifact.type.startsWith('image/')) return ['jpg-to-pdf', 'images'].includes(slug);
  if (/wordprocessingml/.test(artifact.type)) return slug === 'word-to-pdf';
  if (/spreadsheetml/.test(artifact.type)) return slug === 'excel-to-pdf';
  if (artifact.type === 'text/csv') return slug === 'excel-to-pdf';
  return false;
}

export { createOperationScope } from './operation-scope.js';
