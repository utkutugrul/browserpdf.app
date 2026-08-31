'use strict';

import { ensureMammoth, ensurePdfLib } from './lib-loader.js';
import { layoutMarkdownToPdf } from './md-layout.js';
import { t } from './i18n.js';
import {
  showError, hideError, setProgress, showProgress, finishProgress, hideProgress,
  downloadBytes, offerChain,
} from './tool-ui.js';

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const convertBtn = document.getElementById('convertBtn');
const fileSummary = document.getElementById('fileSummary');
const panel = document.getElementById('optionsSection');
const preview = document.getElementById('previewText');

let currentFile = null;
let currentMarkdown = null;

function looksLikeDocx(file) {
  return file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    || /\.docx$/i.test(file.name);
}

function htmlToMarkdown(html) {
  const root = document.createElement('div');
  root.innerHTML = html;
  const lines = [];
  function walk(node, ctx) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent.replace(/\s+/g, ' ');
      if (text.trim()) lines.push({ type: 'text', text, bold: ctx.bold, italic: ctx.italic });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.tagName.toLowerCase();
    if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4') {
      const level = Number(tag[1]);
      const text = node.textContent.trim();
      if (text) lines.push({ type: 'heading', level, text });
      lines.push({ type: 'break' });
      return;
    }
    if (tag === 'p' || tag === 'div') {
      const before = lines.length;
      for (const child of node.childNodes) walk(child, ctx);
      if (lines.length > before) lines.push({ type: 'break' });
      return;
    }
    if (tag === 'li') {
      const text = node.textContent.trim();
      if (text) lines.push({ type: 'li', text });
      return;
    }
    if (tag === 'ul' || tag === 'ol') {
      for (const child of node.childNodes) walk(child, ctx);
      lines.push({ type: 'break' });
      return;
    }
    if (tag === 'br') { lines.push({ type: 'break' }); return; }
    if (tag === 'strong' || tag === 'b') {
      for (const child of node.childNodes) walk(child, { ...ctx, bold: true });
      return;
    }
    if (tag === 'em' || tag === 'i') {
      for (const child of node.childNodes) walk(child, { ...ctx, italic: true });
      return;
    }
    for (const child of node.childNodes) walk(child, ctx);
  }
  walk(root, { bold: false, italic: false });
  let md = '';
  let para = '';
  const flush = () => {
    if (para.trim()) {
      md += para.trim() + '\n\n';
      para = '';
    }
  };
  for (const item of lines) {
    if (item.type === 'heading') {
      flush();
      md += '#'.repeat(item.level) + ' ' + item.text + '\n\n';
    } else if (item.type === 'li') {
      flush();
      md += '- ' + item.text + '\n';
    } else if (item.type === 'break') {
      flush();
    } else if (item.type === 'text') {
      let t = item.text;
      if (item.bold && item.italic) t = '***' + t + '***';
      else if (item.bold) t = '**' + t + '**';
      else if (item.italic) t = '*' + t + '*';
      para += t;
    }
  }
  flush();
  return md.trim() || root.textContent.trim();
}

async function handleFile(file) {
  hideError();
  panel.hidden = true;
  if (!looksLikeDocx(file)) {
    showError(t('word-to-pdf.js_err_not_docx', 'Please select a .docx Word file.'));
    return;
  }
  currentFile = file;
  showProgress(t('word-to-pdf.js_reading', 'Reading Word file…'));
  try {
    const mammoth = await ensureMammoth((m) => setProgress(10, m));
    const buf = await file.arrayBuffer();
    setProgress(40, t('word-to-pdf.js_converting', 'Converting…'));
    const result = await mammoth.convertToHtml({ arrayBuffer: buf });
    const md = htmlToMarkdown(result.value);
    currentMarkdown = md;
    preview.textContent = md.slice(0, 4000) + (md.length > 4000 ? '\n…' : '');
    fileSummary.textContent = file.name;
    panel.hidden = false;
    hideProgress();
  } catch (err) {
    console.error(err);
    hideProgress();
    showError(err?.message || t('word-to-pdf.js_err_read', 'Could not read this Word file.'));
  }
}

convertBtn.addEventListener('click', async () => {
  if (!currentFile) return;
  hideError();
  convertBtn.disabled = true;
  showProgress(t('word-to-pdf.js_building', 'Building PDF…'));
  try {
    const md = currentMarkdown || '';
    if (!md.trim()) {
      showError(t('word-to-pdf.js_err_empty', 'No text found in this document.'));
      hideProgress();
      return;
    }
    const pdfLib = await ensurePdfLib((m) => setProgress(50, m));
    setProgress(70, t('word-to-pdf.js_laying_out', 'Laying out pages…'));
    const doc = await layoutMarkdownToPdf(md, pdfLib);
    setProgress(90, t('common.js_saving', 'Saving…'));
    const bytes = await doc.save();
    const name = (currentFile.name.replace(/\.docx$/i, '') || 'document') + '.pdf';
    downloadBytes(bytes, name);
    offerChain(bytes, name, [
      { slug: 'compress', label: 'Compress' },
      { slug: 'protect', label: 'Protect' },
      { slug: 'merge', label: 'Merge' },
    ]);
    finishProgress();
  } catch (err) {
    console.error(err);
    hideProgress();
    showError(err?.message || t('word-to-pdf.js_err_generic', 'Something went wrong while converting.'));
  } finally {
    convertBtn.disabled = false;
  }
});

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
});
['dragenter','dragover'].forEach((evt) => dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.add('dragover'); }));
['dragleave','drop'].forEach((evt) => dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.remove('dragover'); }));
dropzone.addEventListener('drop', (e) => { const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); });
fileInput.addEventListener('change', () => { const f = fileInput.files?.[0]; if (f) handleFile(f); fileInput.value = ''; });
