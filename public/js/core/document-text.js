import { validateDocumentModel } from './document-model.js';

const pause = () => new Promise(resolve => setTimeout(resolve, 0));
function options(value) {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError('Invalid plain-text options.');
  const out = {};
  for (const key of Reflect.ownKeys(value)) { const d = Object.getOwnPropertyDescriptor(value, key); if (!['pageLabels','pageBreaks','imageAlt','signal'].includes(key) || !d.enumerable || !Object.hasOwn(d, 'value') || d.value === undefined) throw new TypeError('Invalid plain-text option.'); out[key] = d.value; }
  for (const key of ['pageLabels','pageBreaks','imageAlt']) if (out[key] !== undefined && typeof out[key] !== 'boolean') throw new TypeError('Plain-text switches must be boolean.');
  return out;
}
export async function documentToPlainText(input, settings = {}) {
  const {pageLabels = false, pageBreaks = false, imageAlt = true, signal} = options(settings);
  signal?.throwIfAborted(); const model = validateDocumentModel(input, {signal}), chunks = [], encoder = new TextEncoder(), assets = new Map(model.assets.map(asset => [asset.id, asset]));
  let bytes = 0, work = 0, elements = 0, page = null;
  const add = value => { const size = encoder.encode(value).length; if (bytes + size > 8 * 1024 * 1024) throw new RangeError('Plain-text output exceeds 8 MiB.'); bytes += size; chunks.push(value); work += value.length; };
  const cooperative = async () => { if (work >= 65536 || ++elements >= 256) { work = 0; elements = 0; await pause(); signal?.throwIfAborted(); } };
  const paragraph = async value => { for (const run of value.runs) { add(run.text); await cooperative(); } };
  for (const block of model.blocks) {
    signal?.throwIfAborted();
    if (block.source && block.source.pageNumber !== page) { page = block.source.pageNumber; if (pageLabels) add(`[Page ${page}]\n`); }
    if (['paragraph','heading','list-item','code'].includes(block.kind)) { await paragraph(block); add('\n'); }
    else if (block.kind === 'table') for (const row of block.rows) { for (let cellIndex = 0; cellIndex < row.length; cellIndex++) { if (cellIndex) add('\t'); const cell = row[cellIndex]; for (let p = 0; p < cell.paragraphs.length; p++) { if (p) add('\n'); await paragraph(cell.paragraphs[p]); } await cooperative(); } add('\n'); }
    else if (block.kind === 'image' && imageAlt) add(assets.get(block.assetId).alt + '\n');
    else if (block.kind === 'page-break' && pageBreaks) add('\f\n');
    await cooperative();
  }
  await pause(); signal?.throwIfAborted(); return chunks.join('');
}
