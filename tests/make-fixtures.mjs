// Builds the input files the smoke tests feed to the tools. Generated rather
// than committed so the fixtures stay in sync with pdf-lib and stay diffable.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

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
  writePng(path.join(FIXTURE_DIR, 'photo.png'));
  writeXlsx(path.join(FIXTURE_DIR, 'sheet.xlsx'));
  writeDocx(path.join(FIXTURE_DIR, 'letter.docx'));
}
