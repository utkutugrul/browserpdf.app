// Builds the input files the smoke tests feed to the tools. Generated rather
// than committed so the fixtures stay in sync with pdf-lib and stay diffable.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createCanvas } from '@napi-rs/canvas';
import {
  PDFDocument, PDFArray, PDFHexString, PDFName, PDFNumber, PDFString,
  StandardFonts, TextRenderingMode, beginText, endText, moveText,
  rgb, setFontAndSize, setTextRenderingMode, showText,
} from 'pdf-lib';

export const FIXTURE_DIR = path.resolve(import.meta.dirname, '../test-fixtures/generated');

const REPORT_PAGES = [
  {
    heading: 'Quarterly Report 2026',
    body: [
      'This document is generated input for the BrowserPDF smoke tests. It carries',
      'a few paragraphs of ordinary prose, a heading per page and a short table so',
      'that text extraction, conversion and page rendering all have real content to',
      'work with.',
      '',
      'Revenue grew across all three regions. Two new distribution partners signed',
      'in March, and support response time fell to under four hours.',
    ],
  },
  {
    heading: 'Regional Breakdown',
    body: [
      'Region        Q1        Q2       Change',
      'North         1,240     1,455    +17%',
      'Central         860       910     +6%',
      'South           415       602    +45%',
      '',
      'Figures are unaudited and rounded to the nearest unit.',
    ],
  },
  {
    heading: 'Notes',
    body: [
      'The next review is scheduled for the following quarter. Nothing in this file',
      'is real data; it exists only so the tools have something to chew on.',
    ],
  },
];

async function writeReport(file, pages) {
  const doc = await PDFDocument.create();
  const body = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  for (const page of pages) {
    const p = doc.addPage([612, 792]);
    p.drawText(page.heading, { x: 64, y: 720, size: 18, font: bold });
    page.body.forEach((line, i) => {
      if (!line) return;
      p.drawText(line, { x: 64, y: 680 - i * 18, size: 11, font: body });
    });
  }
  writeFileSync(file, await doc.save());
}

async function writeForm(file) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const form = doc.getForm();

  page.drawText('Membership Application Form', { x: 64, y: 720, size: 18, font: bold });

  const labels = [
    ['full_name', 'Full name'],
    ['email', 'Email address'],
    ['company', 'Company'],
    ['start_date', 'Start date'],
  ];
  labels.forEach(([name, label], i) => {
    const y = 660 - i * 44;
    page.drawText(label, { x: 64, y: y + 7, size: 11, font });
    const field = form.createTextField(name);
    field.addToPage(page, { x: 180, y, width: 320, height: 24, font, borderWidth: 1 });
  });

  page.drawText('Subscribe to the newsletter', { x: 92, y: 491, size: 11, font });
  form.createCheckBox('newsletter').addToPage(page, { x: 64, y: 486, width: 18, height: 18 });

  page.drawText('Plan', { x: 64, y: 447, size: 11, font });
  const plan = form.createDropdown('plan');
  plan.addOptions(['Standard', 'Professional', 'Enterprise']);
  plan.select('Standard');
  plan.addToPage(page, { x: 180, y: 440, width: 160, height: 24, font, borderWidth: 1 });

  page.drawText('Billing period', { x: 64, y: 397, size: 11, font });
  const billing = form.createRadioGroup('billing');
  billing.addOptionToPage('monthly', page, { x: 180, y: 392, width: 16, height: 16 });
  billing.addOptionToPage('yearly', page, { x: 260, y: 392, width: 16, height: 16 });
  page.drawText('monthly', { x: 202, y: 396, size: 10, font });
  page.drawText('yearly', { x: 282, y: 396, size: 10, font });

  page.drawText('Signature', { x: 64, y: 330, size: 11, font });
  page.drawLine({ start: { x: 180, y: 328 }, end: { x: 420, y: 328 }, thickness: 0.8, color: rgb(0.6, 0.6, 0.6) });

  writeFileSync(file, await doc.save());
}

async function writePrivacyFixtures(richFile, cleanFile, signedFile) {
  const doc = await PDFDocument.create();
  doc.setTitle('Private fixture title');
  doc.setAuthor('BrowserPDF fixture author');
  doc.setSubject('Metadata cleanup verification');
  doc.setKeywords(['privacy', 'fixture']);
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Contact qa@example.test or 415-555-0123. SSN 123-45-6789.', { x: 54, y: 720, size: 11, font });
  page.pushOperators(
    beginText(), setFontAndSize(font.name, 10), setTextRenderingMode(TextRenderingMode.Invisible),
    moveText(54, 690), showText(font.encodeText('Invisible review note')), endText(),
  );
  await doc.attach(new TextEncoder().encode('inert fixture attachment'), 'catalog-note.txt', {
    mimeType: 'text/plain', description: 'Catalog fixture',
  });
  const catalogAttachment = doc.embeddedFiles.at(-1);
  await catalogAttachment.embed();
  doc.context.lookup(catalogAttachment.ref).set(PDFName.of('AFRelationship'), PDFName.of('Data'));
  doc.addJavaScript('fixture-script', "app.alert('THIS MUST NEVER EXECUTE')");

  const context = doc.context;
  const xmp = context.stream(new TextEncoder().encode('<?xpacket begin=""><x:xmpmeta xmlns:x="adobe:ns:meta/"><fixture>present</fixture></x:xmpmeta><?xpacket end="w"?>'), {
    Type: PDFName.of('Metadata'), Subtype: PDFName.of('XML'),
  });
  doc.catalog.set(PDFName.of('Metadata'), context.register(xmp));

  const uriAction = context.register(context.obj({ S: PDFName.of('URI'), URI: PDFString.of('https://example.invalid/never-open') }));
  const link = context.register(context.obj({
    Type: PDFName.of('Annot'), Subtype: PDFName.of('Link'),
    Rect: context.obj([PDFNumber.of(50), PDFNumber.of(640), PDFNumber.of(260), PDFNumber.of(665)]),
    A: uriAction,
  }));
  const attachmentStream = context.register(context.flateStream(new TextEncoder().encode('page attachment')));
  const fileSpec = context.register(context.obj({
    Type: PDFName.of('Filespec'), F: PDFString.of('page-note.txt'),
    EF: context.obj({ F: attachmentStream }),
  }));
  const fileAnnotation = context.register(context.obj({
    Type: PDFName.of('Annot'), Subtype: PDFName.of('FileAttachment'),
    Rect: context.obj([PDFNumber.of(50), PDFNumber.of(600), PDFNumber.of(70), PDFNumber.of(620)]), FS: fileSpec,
  }));
  const textField = context.register(context.obj({
    Type: PDFName.of('Annot'), Subtype: PDFName.of('Widget'), FT: PDFName.of('Tx'),
    T: PDFString.of('contact_email'), V: PDFString.of(''), Rect: context.obj([54, 540, 314, 564]),
    F: PDFNumber.of(4), P: page.ref,
  }));
  page.node.set(PDFName.of('Annots'), context.obj([link, fileAnnotation, textField]));
  const pageScript = context.register(context.obj({ S: PDFName.of('JavaScript'), JS: PDFString.of("app.alert('PAGE MUST NEVER EXECUTE')") }));
  page.node.set(PDFName.of('AA'), context.obj({ O: pageScript }));

  doc.catalog.set(PDFName.of('AcroForm'), context.obj({
    Fields: context.obj([textField]), CO: context.obj([textField]),
    DA: PDFString.of('/Helvetica 10 Tf 0 g'),
  }));
  writeFileSync(richFile, await doc.save({ useObjectStreams: false }));

  const clean = await PDFDocument.create();
  const cleanPage = clean.addPage([320, 240]);
  const cleanFont = await clean.embedFont(StandardFonts.Helvetica);
  cleanPage.drawText('Clean fixture', { x: 32, y: 180, size: 14, font: cleanFont });
  const cleanInfo = clean.context.lookup(clean.context.trailerInfo.Info);
  for (const key of ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer', 'CreationDate', 'ModDate']) cleanInfo?.delete(PDFName.of(key));
  writeFileSync(cleanFile, await clean.save({ useObjectStreams: false }));

  const signed = await PDFDocument.create();
  signed.addPage([320, 240]).drawText('Signature warning fixture', { x: 32, y: 180, size: 14 });
  const signatureValue = signed.context.obj({
    Type: PDFName.of('Sig'), Filter: PDFName.of('Adobe.PPKLite'), SubFilter: PDFName.of('adbe.pkcs7.detached'),
    ByteRange: PDFArray.withContext(signed.context), Contents: PDFHexString.of('00'),
  });
  signatureValue.lookup(PDFName.of('ByteRange'), PDFArray).push(PDFNumber.of(0));
  signatureValue.lookup(PDFName.of('ByteRange'), PDFArray).push(PDFNumber.of(1));
  signatureValue.lookup(PDFName.of('ByteRange'), PDFArray).push(PDFNumber.of(2));
  signatureValue.lookup(PDFName.of('ByteRange'), PDFArray).push(PDFNumber.of(3));
  const signature = signed.context.register(signatureValue);
  const signatureField = signed.context.register(signed.context.obj({
    Type: PDFName.of('Annot'), Subtype: PDFName.of('Widget'), FT: PDFName.of('Sig'),
    T: PDFString.of('fixture_signature'), V: signature, Rect: signed.context.obj([20, 20, 180, 48]),
    F: PDFNumber.of(4), P: signed.getPage(0).ref,
  }));
  signed.getPage(0).node.set(PDFName.of('Annots'), signed.context.obj([signatureField]));
  signed.catalog.set(PDFName.of('AcroForm'), signed.context.obj({ Fields: signed.context.obj([signatureField]), SigFlags: PDFNumber.of(3) }));
  writeFileSync(signedFile, await signed.save({ useObjectStreams: false }));
}

async function writeDoctorFixtures(taggedFile, truncatedTreeFile, brokenBoxFile, malformedFile, renderFailureFile) {
  const tagged = await PDFDocument.create();
  tagged.setTitle('Tagged readiness fixture');
  const taggedPage = tagged.addPage([320, 240]);
  taggedPage.drawText('Tagged readiness signal fixture', { x: 32, y: 180, size: 14 });
  tagged.catalog.set(PDFName.of('Lang'), PDFString.of('en-US'));
  tagged.catalog.set(PDFName.of('MarkInfo'), tagged.context.obj({ Marked: true }));
  const figure = tagged.context.register(tagged.context.obj({
    Type: PDFName.of('StructElem'), S: PDFName.of('Figure'), Alt: PDFString.of('Fixture figure alternative text'),
  }));
  tagged.catalog.set(PDFName.of('StructTreeRoot'), tagged.context.register(tagged.context.obj({
    Type: PDFName.of('StructTreeRoot'), K: tagged.context.obj([figure]),
  })));
  writeFileSync(taggedFile, await tagged.save({ useObjectStreams: false }));

  const truncated = await PDFDocument.create();
  truncated.addPage([320, 240]).drawText('Bounded structure traversal fixture', { x: 32, y: 180, size: 14 });
  const nodes = [];
  for (let index = 0; index < 1005; index++) {
    nodes.push(truncated.context.register(truncated.context.obj({
      Type: PDFName.of('StructElem'), S: PDFName.of('Figure'), Alt: PDFString.of(`Figure ${index + 1}`),
    })));
  }
  truncated.catalog.set(PDFName.of('StructTreeRoot'), truncated.context.register(truncated.context.obj({
    Type: PDFName.of('StructTreeRoot'), K: truncated.context.obj(nodes),
  })));
  writeFileSync(truncatedTreeFile, await truncated.save({ useObjectStreams: false }));

  const broken = await PDFDocument.create();
  const brokenPage = broken.addPage([320, 240]);
  brokenPage.drawText('Invalid page box fixture', { x: 32, y: 180, size: 14 });
  brokenPage.node.set(PDFName.of('MediaBox'), broken.context.obj([0, 0, 0, 240]));
  brokenPage.node.set(PDFName.of('CropBox'), broken.context.obj([0, 0, 400, 300]));
  writeFileSync(brokenBoxFile, await broken.save({ useObjectStreams: false }));

  const malformed = await PDFDocument.create();
  malformed.addPage([320, 240]).drawText('Malformed object fixture', { x: 32, y: 180, size: 14 });
  const malformedValue = malformed.context.register(malformed.context.obj({
    Marker: PDFString.of('DOCTOR_MALFORMED_MARKER'), Value: PDFString.of('keep'),
  }));
  malformed.catalog.set(PDFName.of('DoctorFixture'), malformedValue);
  const malformedBytes = Buffer.from(await malformed.save({ useObjectStreams: false }));
  const malformedText = malformedBytes.toString('latin1');
  const markerAt = malformedText.indexOf('/Marker (DOCTOR_MALFORMED_MARKER)');
  const valueAt = malformedText.indexOf('/Value (keep)', markerAt);
  if (markerAt < 0 || valueAt < 0) throw new Error('Could not locate malformed fixture marker.');
  malformedBytes.write('/Value [ >> ', valueAt, 'latin1');
  writeFileSync(malformedFile, malformedBytes);

  const renderFailure = await PDFDocument.create();
  const renderPage = renderFailure.addPage([50000, 50000]);
  renderPage.drawText('Bounded render surface fixture', { x: 32, y: 49900, size: 14 });
  writeFileSync(renderFailureFile, await renderFailure.save({ useObjectStreams: false }));
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

// Minimal PNG encoder: the image tools only need a real, decodable raster.
function writePng(file, size = 96) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    raw[row] = 0; // no filter
    for (let x = 0; x < size; x++) {
      const px = row + 1 + x * 3;
      raw[px] = (x * 255) / size;
      raw[px + 1] = (y * 255) / size;
      raw[px + 2] = 160;
    }
  }
  writeFileSync(
    file,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', zlib.deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

function makeTextPng() {
  const canvas = createCanvas(1400, 520);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#000000';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = 'bold 150px Arial, sans-serif';
  context.fillText('BROWSER PDF', canvas.width / 2, 175);
  context.fillText('OCR TEST', canvas.width / 2, 365);
  return canvas.toBuffer('image/png');
}

async function writeScannedImagePdf(file) {
  const document = await PDFDocument.create();
  const image = await document.embedPng(makeTextPng());
  const page = document.addPage([700, 260]);
  page.drawImage(image, { x: 0, y: 0, width: 700, height: 260 });
  writeFileSync(file, await document.save());
}

// Minimal ZIP writer (stored, no compression): enough to build real .xlsx and
// .docx packages that SheetJS and mammoth parse, without adding a dependency.
function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of files) {
    const data = Buffer.from(content, 'utf8');
    const nameBuf = Buffer.from(name, 'ascii');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x21, 12); // any valid DOS date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, nameBuf]));
    offset += local.length + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

function writeXlsx(file) {
  const rows = [
    ['Region', 'Q1', 'Q2'],
    ['North', '1240', '1455'],
    ['Central', '860', '910'],
    ['South', '415', '602'],
  ];
  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows
    .map(
      (row, r) =>
        `<row r="${r + 1}">${row
          .map((v, c) => `<c r="${String.fromCharCode(65 + c)}${r + 1}" t="inlineStr"><is><t>${v}</t></is></c>`)
          .join('')}</row>`
    )
    .join('')}</sheetData></worksheet>`;
  writeFileSync(file, zip([
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sales" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`],
    ['xl/worksheets/sheet1.xml', sheetXml],
  ]));
}

function writeDocx(file) {
  writeFileSync(file, zip([
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`],
    ['word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>BrowserPDF DOCX fixture</w:t></w:r></w:p><w:p><w:r><w:t>The quick brown fox jumps over the lazy dog.</w:t></w:r></w:p></w:body></w:document>`],
  ]));
}

export default async function globalSetup() {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  await writeReport(path.join(FIXTURE_DIR, 'report.pdf'), REPORT_PAGES);
  await writeReport(path.join(FIXTURE_DIR, 'appendix.pdf'), [
    { heading: 'Appendix A', body: ['Supplementary material for the merge and organize tests.'] },
    { heading: 'Appendix B', body: ['A second page, so merged output is easy to tell apart.'] },
  ]);
  await writeForm(path.join(FIXTURE_DIR, 'form.pdf'));
  await writePrivacyFixtures(
    path.join(FIXTURE_DIR, 'privacy-rich.pdf'),
    path.join(FIXTURE_DIR, 'privacy-clean.pdf'),
    path.join(FIXTURE_DIR, 'privacy-signed.pdf'),
  );
  await writeDoctorFixtures(
    path.join(FIXTURE_DIR, 'doctor-tagged.pdf'),
    path.join(FIXTURE_DIR, 'doctor-truncated-tree.pdf'),
    path.join(FIXTURE_DIR, 'doctor-broken-box.pdf'),
    path.join(FIXTURE_DIR, 'doctor-malformed.pdf'),
    path.join(FIXTURE_DIR, 'doctor-render-failure.pdf'),
  );
  await writeScannedImagePdf(path.join(FIXTURE_DIR, 'scanned-english.pdf'));
  writePng(path.join(FIXTURE_DIR, 'photo.png'));
  writeXlsx(path.join(FIXTURE_DIR, 'sheet.xlsx'));
  writeDocx(path.join(FIXTURE_DIR, 'letter.docx'));
}
