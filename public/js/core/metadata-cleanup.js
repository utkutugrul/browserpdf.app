'use strict';

const INFO_KEYS = Object.freeze([
  'Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer', 'CreationDate', 'ModDate',
]);

export async function removeStandardMetadata(inputBytes, pdfLib, { signal } = {}) {
  if (!pdfLib?.PDFDocument || !pdfLib?.PDFName) throw new TypeError('A pdf-lib runtime is required.');
  const owned = Uint8Array.from(inputBytes instanceof Uint8Array ? inputBytes : new Uint8Array(inputBytes));
  signal?.throwIfAborted();
  const pdfDocument = await pdfLib.PDFDocument.load(owned, { ignoreEncryption: true, updateMetadata: false });
  const infoRef = pdfDocument.context.trailerInfo.Info;
  if (infoRef) {
    const info = pdfDocument.context.lookup(infoRef);
    for (const key of INFO_KEYS) info.delete(pdfLib.PDFName.of(key));
  }
  signal?.throwIfAborted();
  return Uint8Array.from(await pdfDocument.save({ updateFieldAppearances: false }));
}
