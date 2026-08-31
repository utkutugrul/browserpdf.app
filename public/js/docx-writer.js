'use strict';

// Minimal .docx writer with zero dependencies. A .docx file is a ZIP archive
// of XML parts; this module builds the smallest set of parts that Word,
// Pages, LibreOffice, and Google Docs all accept, and packs them into an
// uncompressed ("stored") ZIP, which every unzip implementation can read.
// Input is the block model produced by md-blocks.js (headings, paragraphs,
// list items, horizontal rules, with bold/italic/code runs).

import { zipStore } from './zip-writer.js';

/* ---------- WordprocessingML ---------- */

function escapeXml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function runXml(run) {
  const props = [];
  if (run.bold) props.push('<w:b/>');
  if (run.italic) props.push('<w:i/>');
  if (run.code) props.push('<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/>');
  const rPr = props.length ? `<w:rPr>${props.join('')}</w:rPr>` : '';
  return `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(run.text)}</w:t></w:r>`;
}

function paragraphXml(pPr, runs) {
  return `<w:p>${pPr}${runs.map(runXml).join('')}</w:p>`;
}

function blockToXml(block) {
  switch (block.type) {
    case 'heading':
      return paragraphXml(`<w:pPr><w:pStyle w:val="Heading${block.level}"/></w:pPr>`, block.runs);
    case 'list-item': {
      const marker = block.ordered ? `${block.index}. ` : '• ';
      const runs = [{ text: marker }, ...block.runs];
      return paragraphXml('<w:pPr><w:ind w:left="360"/></w:pPr>', runs);
    }
    case 'hr':
      return '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="999999"/></w:pBdr></w:pPr></w:p>';
    default:
      return paragraphXml('', block.runs);
  }
}

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;

const RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

const DOC_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

function headingStyle(id, name, halfPoints) {
  return `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="${Number(id.slice(-1)) - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${halfPoints}"/><w:szCs w:val="${halfPoints}"/></w:rPr></w:style>`;
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:style>${headingStyle('Heading1', 'heading 1', 44)}${headingStyle('Heading2', 'heading 2', 36)}${headingStyle('Heading3', 'heading 3', 30)}${headingStyle('Heading4', 'heading 4', 26)}</w:styles>`;

// blocks: output of parseMarkdownBlocks() from md-blocks.js.
export function buildDocx(blocks) {
  const body = blocks.map(blockToXml).join('');
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;

  const encoder = new TextEncoder();
  const zipBytes = zipStore([
    { name: '[Content_Types].xml', data: encoder.encode(CONTENT_TYPES_XML) },
    { name: '_rels/.rels', data: encoder.encode(RELS_XML) },
    { name: 'word/_rels/document.xml.rels', data: encoder.encode(DOC_RELS_XML) },
    { name: 'word/styles.xml', data: encoder.encode(STYLES_XML) },
    { name: 'word/document.xml', data: encoder.encode(documentXml) },
  ]);
  return new Blob([zipBytes], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}
