'use strict';

export const MAX_ARTIFACT_BYTES = 250 * 1024 * 1024;
export const MAX_HISTORY_BYTES = 64 * 1024 * 1024;
export const MAX_HISTORY_ENTRIES = 5;
export const MAX_SESSION_BYTES = 512 * 1024 * 1024;
const MIME_BY_EXTENSION = { pdf: 'application/pdf', md: 'text/markdown', txt: 'text/plain', csv: 'text/csv', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', zip: 'application/zip', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
const MIME_TYPES = new Set(Object.values(MIME_BY_EXTENSION));
const CAPABILITIES = ['encrypted', 'searchable', 'forms', 'rasterized'];

export function artifactType(name, type) {
  if (typeof type === 'string' && MIME_TYPES.has(type)) return type;
  return MIME_BY_EXTENSION[String(name).split('.').pop().toLowerCase()] || 'application/octet-stream';
}

export function createArtifact(bytes, name = 'document.pdf', options = {}) {
  const owned = bytes instanceof ArrayBuffer ? new Uint8Array(bytes.slice(0)) : Uint8Array.from(bytes);
  if (!owned.length || owned.length > MAX_ARTIFACT_BYTES) throw new RangeError('Choose a non-empty result smaller than 250 MB.');
  const capabilities = {};
  for (const key of CAPABILITIES) if (typeof options.capabilities?.[key] === 'boolean') capabilities[key] = options.capabilities[key];
  return { bytes: owned, name: String(name).replace(/[\u0000-\u001f]/g, '').slice(0, 160), type: artifactType(name, options.type), capabilities };
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
  const copy = (value) => value ? createArtifact(value.bytes, value.name, value) : null;
  const metadata = (value) => value ? { name: value.name, type: value.type, size: value.bytes.length, capabilities: { ...value.capabilities } } : null;
  const retainedBytes = () => [...new Set([original, current, ...history, ...future].filter(Boolean))].reduce((n, a) => n + a.bytes.length, 0);
  function bound() {
    while (history.length && (history.length > MAX_HISTORY_ENTRIES || history.reduce((n, a) => n + a.bytes.length, 0) > MAX_HISTORY_BYTES || retainedBytes() > MAX_SESSION_BYTES)) history.shift();
    while (future.length && (future.length > MAX_HISTORY_ENTRIES || future.reduce((n, a) => n + a.bytes.length, 0) > MAX_HISTORY_BYTES || retainedBytes() > MAX_SESSION_BYTES)) future.shift();
  }
  return {
    begin(bytes, name, options = {}) {
      const candidate = createArtifact(bytes, name, options);
      const source = options.original ? createArtifact(options.original.bytes, options.original.name, options.original) : candidate;
      const past = (Array.isArray(options.history) ? options.history : []).slice(-MAX_HISTORY_ENTRIES).map((a) => createArtifact(a.bytes, a.name, a));
      const upcoming = (Array.isArray(options.future) ? options.future : []).slice(-MAX_HISTORY_ENTRIES).map((a) => createArtifact(a.bytes, a.name, a));
      generation++; revision = Math.max(0, Math.min(100000, Number(options.revision) || 0));
      taskId = typeof options.taskId === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(options.taskId) ? options.taskId : crypto.randomUUID();
      current = candidate; original = source; history = past; future = upcoming;
      selection = []; this.setSelection(options.selection || []); bound();
      return this.snapshot();
    },
    adopt(bytes, name, options = {}) {
      const next = createArtifact(bytes, name, { ...options, capabilities: options.capabilities || current?.capabilities });
      if (current && current.type === next.type && JSON.stringify(current.capabilities) === JSON.stringify(next.capabilities) && current.bytes.length === next.bytes.length && current.bytes.every((byte, index) => byte === next.bytes[index])) { current = { ...current, name: next.name }; return this.snapshot(); }
      if (!original) original = copy(next);
      if (current) history.push(current);
      current = next; future = []; revision++; generation++; bound();
      return this.snapshot();
    },
    undo() { if (!history.length) return null; future.push(current); current = history.pop(); revision++; generation++; bound(); return copy(current); },
    redo() { if (!future.length) return null; history.push(current); current = future.pop(); revision++; generation++; bound(); return copy(current); },
    setSelection(pages) { selection = [...new Set((Array.isArray(pages) ? pages : []).filter(Number.isInteger).filter((n) => n >= 0))].slice(0, 10000); },
    invalidate() { generation++; },
    clear() { original = current = null; taskId = null; history = []; future = []; selection = []; generation++; revision = 0; },
    snapshot({ includeBytes = false } = {}) { return { taskId, original: includeBytes ? copy(original) : metadata(original), current: includeBytes ? copy(current) : metadata(current), revision, generation, selection: [...selection], canUndo: history.length > 0, canRedo: future.length > 0, historyBytes: history.reduce((n, a) => n + a.bytes.length, 0), retainedBytes: retainedBytes() }; },
    transfer() { return { ...this.snapshot({ includeBytes: true }), history: history.map(copy), future: future.map(copy) }; },
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
