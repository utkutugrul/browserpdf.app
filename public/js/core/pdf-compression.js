// A lossless stream transform, separate from page rasterization. Runtimes are
// injected; importing this module loads no engine, font, UI or network asset.
export const COMPRESSION_LIMITS = Object.freeze({
  inputBytes: 80 * 1024 * 1024, outputBytes: 80 * 1024 * 1024,
  pages: 250, objects: 25000, streamBytes: 16 * 1024 * 1024,
  streamTotalBytes: 64 * 1024 * 1024, compressedBytes: 64 * 1024 * 1024,
  graphBytes: 8 * 1024 * 1024, graphNodes: 100000, depth: 64,
  textCharacters: 1000000, textItems: 200000, annotations: 10000,
  renderDimension: 1200, pagePixels: 2000000, verificationPixels: 48000000,
});
const LOAD = Object.freeze({ ignoreEncryption: false, throwOnInvalidObject: true, updateMetadata: false });
const SAVE = Object.freeze({ useObjectStreams: true, addDefaultPage: false, objectsPerTick: 25, updateFieldAppearances: false });
const check = (signal) => signal?.throwIfAborted();
const equalBytes = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);
const pause = () => new Promise((resolve) => setTimeout(resolve, 0));
const byteLengthOf = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength').get;
const setBytes = Uint8Array.prototype.set;

function descriptorOverflow() { throw new RangeError('PDF verification descriptors exceed the 8 MiB byte limit.'); }
function utf8Length(value, limit = COMPRESSION_LIMITS.graphBytes) {
  let bytes = 0;
  if (limit < 0) descriptorOverflow();
  for (const character of value) {
    const code = character.codePointAt(0); bytes += code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4;
    if (bytes > limit) descriptorOverflow();
  }
  return bytes;
}
function budget() { return { bytes: 0, nodes: 0 }; }
function reserve(state, bytes) {
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > COMPRESSION_LIMITS.graphBytes - state.bytes) descriptorOverflow();
  state.bytes += bytes;
}
function count(state, value) {
  reserve(state, utf8Length(value, COMPRESSION_LIMITS.graphBytes - state.bytes)); return value;
}
function prefixed(state, value, suffix = '') {
  const prefix = `${value.length}:`, overhead = prefix.length + suffix.length;
  reserve(state, overhead + utf8Length(value, COMPRESSION_LIMITS.graphBytes - state.bytes - overhead));
  return prefix + value + suffix;
}
function visit(state) { if (++state.nodes > COMPRESSION_LIMITS.graphNodes) throw new RangeError('PDF verification descriptors exceed the 100,000-node limit.'); }

// Count JSON's exact escaped UTF-8 representation without creating that string.
// Well-formed JSON.stringify escapes isolated UTF-16 surrogates as six ASCII
// bytes, while a valid pair remains one four-byte UTF-8 character.
function jsonStringBytes(value, limit) {
  let bytes = 2;
  if (bytes > limit) descriptorOverflow();
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code === 34 || code === 92 || code === 8 || code === 9 || code === 10 || code === 12 || code === 13) bytes += 2;
    else if (code < 32) bytes += 6;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) { bytes += 4; index++; } else bytes += 6;
    } else if (code >= 0xdc00 && code <= 0xdfff) bytes += 6;
    else bytes += code < 128 ? 1 : code < 2048 ? 2 : 3;
    if (bytes > limit) descriptorOverflow();
  }
  return bytes;
}
function jsonScalar(value) {
  if (value === null || value === undefined || typeof value === 'number' && !Number.isFinite(value)) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  throw new Error('Unsupported JSON verification primitive.');
}
function jsonBytes(value, limit, depth = 0) {
  if (depth > COMPRESSION_LIMITS.depth) throw new RangeError('JSON verification nesting exceeds the descriptor limit.');
  if (typeof value === 'string') return jsonStringBytes(value, limit);
  if (Array.isArray(value)) {
    let bytes = 2 + Math.max(0, value.length - 1);
    if (bytes > limit) descriptorOverflow();
    for (let index = 0; index < value.length; index++) bytes += jsonBytes(value[index], limit - bytes, depth + 1);
    return bytes;
  }
  const bytes = jsonScalar(value).length;
  if (bytes > limit) descriptorOverflow(); return bytes;
}

// Follow direct values only. Indirect references are compared as references,
// avoiding cycles and preserving document-level relationships exactly.
function describe(object, lib, state, depth = 0, omitted = null) {
  if (depth > COMPRESSION_LIMITS.depth) throw new RangeError('A PDF verification descriptor exceeds 64 nested values.');
  visit(state);
  if (object instanceof lib.PDFDict) {
    const entries = object.entries();
    if (entries.length > COMPRESSION_LIMITS.graphNodes - state.nodes) throw new RangeError('PDF dictionary entries exceed the verification limit.');
    const pieces = [count(state, '{')]; let included = 0;
    for (const [key, value] of entries.sort(([a], [b]) => a.asString().localeCompare(b.asString()))) {
      if (omitted?.has(key.asString())) continue;
      visit(state); if (included++) pieces.push(count(state, '|'));
      pieces.push(prefixed(state, key.asString(), ':'), describe(value, lib, state, depth + 1));
    }
    pieces.push(count(state, '}')); return pieces.join('');
  }
  if (object instanceof lib.PDFArray) {
    if (object.size() > COMPRESSION_LIMITS.graphNodes - state.nodes) throw new RangeError('PDF array entries exceed the verification limit.');
    const values = [count(state, '[')];
    for (let index = 0; index < object.size(); index++) { if (index) values.push(count(state, '|')); values.push(describe(object.get(index), lib, state, depth + 1)); }
    values.push(count(state, ']')); return values.join('');
  }
  if (!object || object instanceof lib.PDFRawStream || typeof object.sizeInBytes !== 'function' || object.sizeInBytes() > COMPRESSION_LIMITS.graphBytes - state.bytes) throw new RangeError('Unsupported or oversized direct PDF value.');
  if (object instanceof lib.PDFString || object instanceof lib.PDFHexString) {
    const raw = object.asString(), prefix = `${raw.length + 2}:`, overhead = prefix.length + 2;
    reserve(state, overhead + utf8Length(raw, COMPRESSION_LIMITS.graphBytes - state.bytes - overhead));
    return prefix + object.toString();
  }
  if (object instanceof lib.PDFName) return prefixed(state, object.asString());
  const size = object.sizeInBytes();
  if (!(object instanceof lib.PDFNumber || object instanceof lib.PDFBool || object instanceof lib.PDFRef || object === lib.PDFNull)) throw new Error('Unsupported direct PDF verification primitive.');
  reserve(state, size + String(size).length + 1);
  return `${size}:${object.toString()}`;
}

function streamType(object, lib) {
  const value = object.dict.lookup(lib.PDFName.of('Type'));
  return value instanceof lib.PDFName ? value.asString() : null;
}
function snapshotGraph(doc, lib, optimized = new Set()) {
  const objects = doc.context.enumerateIndirectObjects(), state = budget(), graph = new Map();
  if (objects.length > COMPRESSION_LIMITS.objects) throw new RangeError('Structure-preserving compression supports at most 25,000 PDF objects.');
  for (const [ref, object] of objects) {
    if (object instanceof lib.PDFRawStream && ['/XRef', '/ObjStm'].includes(streamType(object, lib))) throw new Error('Unexpected cross-reference or object-stream bookkeeping in the application graph.');
    if (object instanceof lib.PDFDict && object.has(lib.PDFName.of('Linearized'))) throw new Error('Linearized PDFs have offset hints that this optimizer cannot preserve. The original was retained.');
    const id = ref.toString(), stream = object instanceof lib.PDFRawStream;
    prefixed(state, id, ':');
    const omitted = new Set(['/Length']);
    if (optimized.has(id)) {
      const filter = object.dict.get(lib.PDFName.of('Filter'));
      if (!(filter instanceof lib.PDFName) || filter.asString() !== '/FlateDecode') throw new Error('An optimized stream lost its exact FlateDecode filter.');
      omitted.add('/Filter');
    }
    graph.set(id, { signature: describe(stream ? object.dict : object, lib, state, 0, stream ? omitted : null), stream: stream ? object : null });
  }
  const trailer = [count(state, 'T[')];
  for (const [index, key] of ['Root', 'Info', 'ID', 'Encrypt'].entries()) {
    if (index) trailer.push(count(state, '|'));
    trailer.push(count(state, `${key}:`), doc.context.trailerInfo[key] ? describe(doc.context.trailerInfo[key], lib, state) : count(state, 'null'));
  }
  trailer.push(count(state, ']')); return { graph, trailer: trailer.join('') };
}

// WHATWG Compression §§3–5: 'deflate' is RFC1950 + RFC1951, matching
// PDF32000-1 §7.4.4. Both ends are drained even when an output bound wins.
async function nativeTransform(bytes, factory, limit, signal) {
  check(signal);
  const stream = factory('deflate'), writer = stream.writable.getWriter(), reader = stream.readable.getReader();
  let stopping, completed = false, length = 0;
  const chunks = [];
  const stop = (reason) => stopping ||= Promise.allSettled([reader.cancel(reason), writer.abort(reason)]);
  const abort = () => { void stop(signal.reason); };
  signal?.addEventListener('abort', abort, { once: true });
  const writing = (async () => {
    for (let offset = 0; offset < bytes.length; offset += 16384) { check(signal); await writer.write(bytes.subarray(offset, offset + 16384)); }
    check(signal); await writer.close();
  })();
  void writing.catch(() => {});
  try {
    while (true) {
      check(signal); const { value, done } = await reader.read(); check(signal); if (done) break;
      if (!(value instanceof Uint8Array) || length + value.length > limit) throw new RangeError('Native stream output exceeds the compression verification byte limit.');
      chunks.push(value.slice()); length += value.length;
    }
    await writing; check(signal);
    const output = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
    completed = true; return output;
  } finally {
    signal?.removeEventListener('abort', abort);
    if (!completed) await stop();
    await Promise.allSettled([writing]);
    chunks.length = 0; reader.releaseLock(); writer.releaseLock();
  }
}

async function withDocument(bytes, env, work) {
  check(env.signal);
  const task = env.pdfjs.getDocument({ data: bytes.slice(), ...env.pdfjsAssets, stopAtErrors: true, enableXfa: false });
  let destroying;
  const destroy = () => destroying ||= Promise.resolve().then(() => task.destroy());
  const abort = () => { void destroy().catch(() => {}); };
  env.signal?.addEventListener('abort', abort, { once: true });
  let primary;
  try { const doc = await task.promise; check(env.signal); return await work(doc); }
  catch (error) { primary = error; check(env.signal); throw error; }
  finally {
    env.signal?.removeEventListener('abort', abort);
    try { await destroy(); } catch (error) { if (!primary) throw error; }
    check(env.signal);
  }
}

function geometry(page) {
  const viewport = page.getViewport({ scale: 1 });
  if (![viewport.width, viewport.height, page.userUnit, ...page.view, ...viewport.transform].every(Number.isFinite) || viewport.width <= 0 || viewport.height <= 0 || !Number.isFinite(viewport.width * viewport.height) || page.userUnit <= 0) throw new Error('Unsupported nonfinite or empty page geometry.');
  return { width: viewport.width, height: viewport.height, rotation: page.rotate, userUnit: page.userUnit, view: [...page.view], transform: [...viewport.transform] };
}
async function renderPlan(pdf, env) {
  if (!pdf.numPages || pdf.numPages > COMPRESSION_LIMITS.pages) throw new RangeError('Structure-preserving compression supports 1–250 pages.');
  const pages = [];
  for (let number = 1; number <= pdf.numPages; number++) {
    check(env.signal); const page = await pdf.getPage(number); check(env.signal);
    try {
      const shape = geometry(page), scale = Math.min(1, COMPRESSION_LIMITS.renderDimension / Math.max(shape.width, shape.height), Math.sqrt(COMPRESSION_LIMITS.pagePixels / (shape.width * shape.height)));
      pages.push({ number, shape, scale });
    } finally { page.cleanup(); }
  }
  let factor = 1;
  const plan = () => pages.map((item) => ({ ...item, scale: item.scale * factor, width: Math.max(1, Math.floor(item.shape.width * item.scale * factor)), height: Math.max(1, Math.floor(item.shape.height * item.scale * factor)) }));
  let result = plan(), pixels = result.reduce((sum, item) => sum + 2 * item.width * item.height, 0);
  while (pixels > COMPRESSION_LIMITS.verificationPixels) { factor *= Math.sqrt(COMPRESSION_LIMITS.verificationPixels / pixels) * 0.999999; result = plan(); pixels = result.reduce((sum, item) => sum + 2 * item.width * item.height, 0); }
  return { pages: result, pixels };
}

async function textSignature(page, env, state) {
  const reader = page.streamTextContent({ disableNormalization: true }).getReader(), pieces = [];
  let completed = false, cancellation, failure;
  const cancel = (reason) => cancellation ||= reader.cancel(reason instanceof Error ? reason : new Error('PDF text verification stopped.'));
  // PDF.js requires Error as its public text-stream cancellation reason. The
  // event handler observes rejection early; finally awaits this same promise.
  const abort = () => { void cancel(env.signal.reason).catch(() => {}); };
  env.signal?.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      check(env.signal); const { value, done } = await reader.read(); check(env.signal); if (done) break;
      for (const item of value.items || []) {
        if (typeof item.str !== 'string') continue;
        state.items++; state.characters += item.str.length;
        if (state.items > COMPRESSION_LIMITS.textItems || state.characters > COMPRESSION_LIMITS.textCharacters) throw new RangeError('PDF text exceeds the 1M-character/200,000-item verification limit.');
        const value = [item.str, item.dir, item.width, item.height, item.transform, item.hasEOL], separator = pieces.length ? 1 : 0;
        reserve(state, separator + jsonBytes(value, COMPRESSION_LIMITS.graphBytes - state.bytes - separator));
        pieces.push(JSON.stringify(value));
      }
    }
    completed = true; return pieces.join('\n');
  } catch (error) {
    failure = error; throw error;
  } finally {
    env.signal?.removeEventListener('abort', abort);
    try { if (!completed) await cancel(failure || env.signal?.reason); }
    finally { reader.releaseLock(); }
  }
}
function jsonSignature(value, state, depth = 0) {
  if (depth > COMPRESSION_LIMITS.depth) throw new RangeError('Annotation nesting exceeds the verification limit.');
  visit(state);
  if (typeof value === 'string') {
    reserve(state, jsonStringBytes(value, COMPRESSION_LIMITS.graphBytes - state.bytes)); return JSON.stringify(value);
  }
  if (value === null || ['boolean', 'number'].includes(typeof value)) return count(state, jsonScalar(value));
  if (value === undefined) return count(state, 'undefined');
  if (Array.isArray(value) || ArrayBuffer.isView(value)) {
    if (!Number.isSafeInteger(value.length) || value.length > COMPRESSION_LIMITS.graphNodes - state.nodes || value.length + 2 > COMPRESSION_LIMITS.graphBytes - state.bytes) throw new RangeError('Annotation array exceeds the verification descriptor limit.');
    const parts = [count(state, '[')];
    for (let index = 0; index < value.length; index++) { if (index) parts.push(count(state, '|')); parts.push(jsonSignature(value[index], state, depth + 1)); }
    parts.push(count(state, ']')); return parts.join('');
  }
  if (typeof value !== 'object') throw new Error('Unsupported annotation verification value.');
  const keys = Object.keys(value).sort();
  if (keys.length > COMPRESSION_LIMITS.graphNodes - state.nodes) throw new RangeError('Annotation keys exceed the verification descriptor limit.');
  const parts = [count(state, '{')];
  for (const [index, key] of keys.entries()) { visit(state); if (index) parts.push(count(state, '|')); parts.push(prefixed(state, key, ':'), jsonSignature(value[key], state, depth + 1)); }
  parts.push(count(state, '}')); return parts.join('');
}
async function renderPixels(page, item, env) {
  check(env.signal);
  const canvas = env.canvasFactory(); let task;
  try {
    canvas.width = item.width; canvas.height = item.height;
    const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    if (!context) throw new Error('A 2D canvas context is required for compression verification.');
    task = page.render({ canvasContext: context, viewport: page.getViewport({ scale: item.scale }), background: 'rgb(255,255,255)', annotationMode: env.pdfjs.AnnotationMode.ENABLE });
    const abort = () => task.cancel(); env.signal?.addEventListener('abort', abort, { once: true });
    try { await task.promise; check(env.signal); } finally { env.signal?.removeEventListener('abort', abort); }
    return new Uint8Array(context.getImageData(0, 0, item.width, item.height).data);
  } finally { canvas.width = canvas.height = 0; }
}
async function verifyViews(source, output, plan, env) {
  if (source.numPages !== output.numPages) throw new Error('Compressed PDF page count changed.');
  const beforeText = { items: 0, characters: 0, bytes: 0 }, afterText = { items: 0, characters: 0, bytes: 0 }, annotationBudget = budget();
  let annotations = 0;
  for (const item of plan.pages) {
    check(env.signal); const before = await source.getPage(item.number); check(env.signal); const after = await output.getPage(item.number); check(env.signal);
    try {
      if (JSON.stringify(geometry(after)) !== JSON.stringify(item.shape)) throw new Error('Compressed PDF page geometry changed.');
      if (await textSignature(before, env, beforeText) !== await textSignature(after, env, afterText)) throw new Error('Compressed PDF selectable text changed.');
      const originalAnnotations = await before.getAnnotations({ intent: 'display' }); check(env.signal);
      const resultAnnotations = await after.getAnnotations({ intent: 'display' }); check(env.signal);
      annotations += originalAnnotations.length;
      if (annotations > COMPRESSION_LIMITS.annotations || resultAnnotations.length !== originalAnnotations.length) throw new Error('PDF annotations exceed the 10,000-item limit or changed.');
      if (jsonSignature(originalAnnotations, annotationBudget) !== jsonSignature(resultAnnotations, annotationBudget)) throw new Error('Compressed PDF annotations, links or form values changed.');
      // Explicitly use the same canvas factory, opaque context options, viewport,
      // white background and annotation mode on both sides in this environment.
      const originalPixels = await renderPixels(before, item, env), resultPixels = await renderPixels(after, item, env);
      if (!equalBytes(originalPixels, resultPixels)) throw new Error('Compressed PDF pixels differ at the verified resolution.');
      env.onProgress?.({ phase: 'verify-page', completed: item.number, total: plan.pages.length });
    } finally { before.cleanup(); after.cleanup(); }
    await pause(); check(env.signal);
  }
  return { textCharacters: beforeText.characters, textItems: beforeText.items, annotationCount: annotations, renderedPages: plan.pages.map((item) => item.number), renderedPixels: plan.pixels, renderPlan: plan.pages.map(({ number, scale, width, height }) => ({ number, scale, width, height })) };
}

export async function optimizePdfStructure(input, env = {}) {
  if (!env.pdfLib?.PDFDocument || !env.pdfjs?.getDocument || typeof env.canvasFactory !== 'function') throw new TypeError('Pinned pdf-lib, PDF.js and a canvas factory are required.');
  check(env.signal);
  if (!(input instanceof Uint8Array)) throw new RangeError('Structure-preserving compression requires a nonempty PDF no larger than 80 MiB. The current document was retained.');
  const inputLength = byteLengthOf.call(input);
  if (!inputLength || inputLength > COMPRESSION_LIMITS.inputBytes) throw new RangeError('Structure-preserving compression requires a nonempty PDF no larger than 80 MiB. The current document was retained.');
  // Buffer.slice is a view; subclasses may also override slice, species or the
  // iterator. Intrinsic typed-array copying always produces plain owned bytes.
  const original = new Uint8Array(inputLength), lib = env.pdfLib; setBytes.call(original, input);
  const doc = await lib.PDFDocument.load(original.slice(), LOAD); check(env.signal);
  if (doc.context.trailerInfo.Encrypt) throw new Error('Unlock this encrypted PDF before compression. No access controls were removed.');
  const countPages = doc.getPageCount();
  if (!countPages || countPages > COMPRESSION_LIMITS.pages) throw new RangeError('Structure-preserving compression supports 1–250 pages.');
  const baseline = snapshotGraph(doc, lib), candidates = [], skipped = { filtered: 0, decodeParams: 0, external: 0, structural: 0, small: 0, nonReducing: 0 };
  let rawBytes = 0, compressedBytes = 0;
  for (const [ref, object] of doc.context.enumerateIndirectObjects()) {
    check(env.signal); if (!(object instanceof lib.PDFRawStream)) continue;
    const has = (key) => object.dict.has(lib.PDFName.of(key));
    if (has('F') || has('FFilter') || has('FDecodeParms')) { skipped.external++; continue; }
    if (has('DecodeParms')) { skipped.decodeParams++; continue; }
    if (has('Filter')) { skipped.filtered++; continue; }
    if (['/XRef', '/ObjStm'].includes(streamType(object, lib))) { skipped.structural++; continue; }
    const size = object.getContentsSize();
    if (size < 64) { skipped.small++; continue; }
    rawBytes += size;
    if (size > COMPRESSION_LIMITS.streamBytes || rawBytes > COMPRESSION_LIMITS.streamTotalBytes) throw new RangeError('Eligible unfiltered streams exceed 16 MiB per stream or 64 MiB in total. The original was retained.');
    candidates.push({ ref, object });
  }
  const capabilities = { ...Object.fromEntries(['searchable', 'forms', 'rasterized'].filter((key) => typeof env.capabilities?.[key] === 'boolean').map((key) => [key, env.capabilities[key]])), encrypted: false };
  const unchanged = (reason, attemptedStreams = 0) => ({ bytes: original, type: 'application/pdf', reduced: false, retainedOriginal: true, reason, sourceBytes: original.length, resultBytes: original.length, optimizedStreams: 0, attemptedStreams, skipped, capabilities, verification: { originalByteIdentical: true } });
  if (!candidates.length) return unchanged('No eligible unfiltered stream can be reduced. The original bytes were retained.');
  const compression = env.compressionStreamFactory || ((format) => new CompressionStream(format));
  const decompression = env.decompressionStreamFactory || ((format) => new DecompressionStream(format));
  const optimized = new Set();
  for (const candidate of candidates) {
    check(env.signal); let encoded;
    try { encoded = await nativeTransform(candidate.object.getContents(), compression, COMPRESSION_LIMITS.streamBytes + 65536, env.signal); }
    catch (error) { check(env.signal); throw new Error(`Structure-preserving stream compression failed: ${error.message}`, { cause: error }); }
    check(env.signal);
    if (encoded.length + 32 >= candidate.object.getContentsSize()) { skipped.nonReducing++; continue; }
    compressedBytes += encoded.length;
    if (compressedBytes > COMPRESSION_LIMITS.compressedBytes) throw new RangeError('Retained compressed streams exceed 64 MiB.');
    const decoded = await nativeTransform(encoded, decompression, candidate.object.getContentsSize(), env.signal); check(env.signal);
    if (!equalBytes(decoded, candidate.object.getContents())) throw new Error('Compressed stream round-trip verification failed.');
    const dict = candidate.object.dict.clone(doc.context); dict.set(lib.PDFName.of('Filter'), lib.PDFName.of('FlateDecode'));
    doc.context.assign(candidate.ref, lib.PDFRawStream.of(dict, encoded)); optimized.add(candidate.ref.toString());
    env.onProgress?.({ phase: 'compress-stream', completed: optimized.size, total: candidates.length });
    await pause(); check(env.signal);
  }
  if (!optimized.size) return unchanged('The eligible streams did not become smaller. The original bytes were retained.', candidates.length);
  // Inspect AcroForm through its catalog reference only. getForm() can create a
  // form dictionary and remove XFA; it is deliberately never called here.
  const form = doc.catalog.lookup(lib.PDFName.of('AcroForm'));
  if (form && !(form instanceof lib.PDFDict)) throw new Error('Unsupported AcroForm dictionary. The original was retained.');
  env.onProgress?.({ phase: 'serialize' });
  const output = new Uint8Array(await doc.save(SAVE)); check(env.signal);
  if (output.length >= original.length) return unchanged('The saved candidate was not smaller. The original bytes were retained.', candidates.length);
  if (output.length > COMPRESSION_LIMITS.outputBytes) throw new RangeError('The compressed PDF exceeds 80 MiB.');
  const reopened = await lib.PDFDocument.load(output.slice(), LOAD); check(env.signal);
  if (reopened.getPageCount() !== countPages) throw new Error('Strict reopen changed the PDF page count.');
  const verified = snapshotGraph(reopened, lib, optimized);
  if (verified.trailer !== baseline.trailer || verified.graph.size !== baseline.graph.size) throw new Error('Compressed PDF document references or metadata changed.');
  for (const [ref, expected] of baseline.graph) {
    check(env.signal); const actual = verified.graph.get(ref);
    if (!actual || actual.signature !== expected.signature || !!actual.stream !== !!expected.stream) throw new Error(`Compressed PDF object graph changed at ${ref}.`);
    if (expected.stream) {
      const actualBytes = optimized.has(ref) ? await nativeTransform(actual.stream.getContents(), decompression, expected.stream.getContentsSize(), env.signal) : actual.stream.getContents();
      if (!equalBytes(actualBytes, expected.stream.getContents())) throw new Error(`Compressed PDF stream bytes changed at ${ref}.`);
    }
  }
  const view = await withDocument(original, env, async (source) => {
    if (source.numPages !== countPages) throw new Error('Source page count differs between the PDF engines.');
    const plan = await renderPlan(source, env); check(env.signal);
    return withDocument(output, env, (result) => verifyViews(source, result, plan, env));
  });
  check(env.signal);
  return { bytes: output, type: 'application/pdf', reduced: true, retainedOriginal: false, sourceBytes: original.length, resultBytes: output.length, optimizedStreams: optimized.size, attemptedStreams: candidates.length, skipped, capabilities,
    boundary: { kind: 'pdf-rewrite', losses: ['signature-rewrite'] },
    verification: { strictReopen: true, objectGraph: true, optimizedDecodedBytes: true, untouchedEncodedBytes: true, text: true, annotations: true, geometry: true, pixels: true, ...view } };
}
