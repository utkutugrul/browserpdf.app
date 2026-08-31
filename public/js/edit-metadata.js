'use strict';

import { ensurePdfLib } from './lib-loader.js';
import {
  showError, hideError, showProgress, setProgress, finishProgress, hideProgress,
  downloadBytes, wireDropzone, readPdfFile, offerChain, takeChainedFile,
} from './tool-ui.js';
import { t } from './i18n.js';

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const optionsSection = document.getElementById('optionsSection');
const fileSummary = document.getElementById('fileSummary');
const titleInput = document.getElementById('titleInput');
const authorInput = document.getElementById('authorInput');
const subjectInput = document.getElementById('subjectInput');
const keywordsInput = document.getElementById('keywordsInput');
const creatorInput = document.getElementById('creatorInput');
const producerInput = document.getElementById('producerInput');
const creationDateInput = document.getElementById('creationDateInput');
const modificationDateInput = document.getElementById('modificationDateInput');
const applyBtn = document.getElementById('applyBtn');

let currentBytes = null;
let currentFileName = 'document';

function formatDate(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString();
}

function fillField(input, value) {
  input.value = typeof value === 'string' ? value : (value || '');
}

async function handleFile(file) {
  hideError();
  optionsSection.hidden = true;
  const parsed = await readPdfFile(file);
  if (!parsed) return;
  currentBytes = parsed.bytes;
  currentFileName = parsed.baseName;
  fileSummary.textContent = file.name;
  showProgress(t('common.js_loading_pdflib', 'Loading pdf-lib…'));
  try {
    const pdfLib = await ensurePdfLib((msg) => setProgress(0, msg));
    setProgress(50, t('edit-metadata.js_reading', 'Reading metadata…'));
    const doc = await pdfLib.PDFDocument.load(currentBytes, { ignoreEncryption: true });
    fillField(titleInput, doc.getTitle());
    fillField(authorInput, doc.getAuthor());
    fillField(subjectInput, doc.getSubject());
    fillField(keywordsInput, doc.getKeywords());
    fillField(creatorInput, doc.getCreator());
    fillField(producerInput, doc.getProducer());
    creationDateInput.value = formatDate(doc.getCreationDate());
    modificationDateInput.value = formatDate(doc.getModificationDate());
    optionsSection.hidden = false;
  } catch (err) {
    console.error(err);
    showError(err?.message || t('edit-metadata.js_err_read', 'Could not read this PDF.'));
  } finally {
    hideProgress();
  }
}

wireDropzone(dropzone, fileInput, (files) => handleFile(files[0]));

applyBtn.addEventListener('click', async () => {
  if (!currentBytes) return;
  hideError();
  showProgress(t('common.js_loading_pdflib', 'Loading pdf-lib…'));
  applyBtn.disabled = true;
  try {
    const pdfLib = await ensurePdfLib((msg) => setProgress(0, msg));
    setProgress(40, t('edit-metadata.js_loading_pdf', 'Loading PDF…'));
    const doc = await pdfLib.PDFDocument.load(currentBytes, { ignoreEncryption: true });
    setProgress(70, t('edit-metadata.js_updating', 'Updating metadata…'));
    doc.setTitle(titleInput.value);
    doc.setAuthor(authorInput.value);
    doc.setSubject(subjectInput.value);
    // pdf-lib requires an array here; handing it the raw string throws and
    // aborted the whole apply before anything was saved.
    doc.setKeywords(
      keywordsInput.value
        .split(',')
        .map((keyword) => keyword.trim())
        .filter(Boolean),
    );
    doc.setCreator(creatorInput.value);
    doc.setProducer(producerInput.value);
    doc.setModificationDate(new Date());
    setProgress(90, t('common.js_saving', 'Saving…'));
    const outBytes = await doc.save();
    const outName = `${currentFileName}-metadata.pdf`;
    downloadBytes(outBytes, outName);
    offerChain(outBytes, outName, [
      { slug: 'compress', label: t('edit-metadata.js_chain_compress', 'Compress') },
      { slug: 'page-numbers', label: t('edit-metadata.js_chain_page_numbers', 'Add Page Numbers') },
    ]);
    finishProgress();
  } catch (err) {
    console.error(err);
    showError(err?.message || t('edit-metadata.js_err_save', 'Something went wrong while saving the metadata.'));
    hideProgress();
  } finally {
    applyBtn.disabled = false;
  }
});

takeChainedFile().then((file) => {
  if (file) handleFile(file);
});
