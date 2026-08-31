'use strict';

import { ensureCantooPdfLib } from './lib-loader.js';
import {
  showError, hideError, setProgress, showProgress, finishProgress, hideProgress,
  downloadBytes, wireDropzone, readPdfFile, offerChain, takeChainedFile,
} from './tool-ui.js';
import { t } from './i18n.js';

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const passwordSection = document.getElementById('passwordSection');
const passwordInput = document.getElementById('passwordInput');
const unlockBtn = document.getElementById('unlockBtn');
const notEncryptedSection = document.getElementById('notEncryptedSection');
const downloadUnlockedBtn = document.getElementById('downloadUnlockedBtn');

let currentBytes = null;
let currentFileName = null;
let unlockedBytes = null;

async function handleFile(file) {
  hideError();
  passwordSection.hidden = true;
  notEncryptedSection.hidden = true;
  const parsed = await readPdfFile(file);
  if (!parsed) return;
  currentBytes = parsed.bytes;
  currentFileName = parsed.baseName;
  unlockedBytes = null;

  showProgress(t('common.js_loading_pdf', 'Loading PDF…'));
  try {
    const pdfLib = await ensureCantooPdfLib(msg => setProgress(0, msg));
    let doc;
    try {
      doc = await pdfLib.PDFDocument.load(currentBytes);
      hideProgress();
      notEncryptedSection.hidden = false;
      unlockedBytes = await doc.save();
    } catch (err) {
      const isEncrypted =
        err &&
        ((pdfLib.EncryptedPDFError && err instanceof pdfLib.EncryptedPDFError) ||
          (err.message && err.message.toLowerCase().includes('encrypt')));
      if (isEncrypted) {
        hideProgress();
        passwordSection.hidden = false;
        passwordInput.value = '';
        passwordInput.focus();
      } else {
        throw err;
      }
    }
  } catch (err) {
    console.error(err);
    hideProgress();
    showError(err && err.message ? err.message : t('common.js_err_read', 'Could not read this PDF.'));
  }
}

// Rebuilding the document drops the original's Info dictionary, so carry the
// fields over by hand. Each setter is guarded: a malformed value in the source
// must not sink the whole unlock.
function copyDocumentInfo(src, dest) {
  const carry = (read, write) => {
    try {
      const value = read();
      if (value !== undefined && value !== null && value !== '') write(value);
    } catch {
      /* skip anything the source stores in an unreadable shape */
    }
  };
  carry(() => src.getTitle(), (v) => dest.setTitle(v));
  carry(() => src.getAuthor(), (v) => dest.setAuthor(v));
  carry(() => src.getSubject(), (v) => dest.setSubject(v));
  carry(() => src.getCreator(), (v) => dest.setCreator(v));
  carry(() => src.getProducer(), (v) => dest.setProducer(v));
  carry(() => src.getCreationDate(), (v) => dest.setCreationDate(v));
  carry(
    () => src.getKeywords(),
    (v) =>
      dest.setKeywords(
        String(v)
          .split(',')
          .map((keyword) => keyword.trim())
          .filter(Boolean),
      ),
  );
}

async function doUnlock() {
  if (!currentBytes) return;
  const password = passwordInput.value;
  if (!password) {
    showError(t('unlock.js_err_no_password', 'Please enter the PDF password.'));
    return;
  }
  hideError();
  showProgress(t('unlock.js_unlocking', 'Unlocking…'));
  unlockBtn.disabled = true;
  try {
    const pdfLib = await ensureCantooPdfLib(msg => setProgress(0, msg));
    let doc;
    try {
      doc = await pdfLib.PDFDocument.load(currentBytes, { password });
    } catch (err) {
      if (err && err.message && err.message.toLowerCase().includes('password')) {
        showError(t('unlock.js_err_wrong_password', 'Incorrect password. Try again.'));
        hideProgress();
        return;
      }
      throw err;
    }
    setProgress(60, t('common.js_saving', 'Saving…'));
    // Saving the decrypted document in place keeps its /Encrypt dictionary,
    // because streams are decrypted lazily and are written back untouched: the
    // output would still demand the password. Copying the pages into a fresh
    // document forces every stream through the decryption path instead.
    const out = await pdfLib.PDFDocument.create();
    const pages = await out.copyPages(doc, doc.getPageIndices());
    for (const page of pages) out.addPage(page);
    copyDocumentInfo(doc, out);
    const outBytes = await out.save();
    unlockedBytes = outBytes;
    const outName = currentFileName + '-unlocked.pdf';
    downloadBytes(outBytes, outName);
    offerChain(outBytes, outName, [
      { slug: 'merge', label: 'Merge' },
      { slug: 'compress', label: 'Compress' },
      { slug: 'organize', label: 'Organize' },
      { slug: 'protect', label: 'Protect' },
    ]);
    finishProgress();
  } catch (err) {
    console.error(err);
    hideProgress();
    showError(err && err.message ? err.message : t('unlock.js_err_unlock', 'Could not unlock this PDF. The password may be incorrect.'));
  } finally {
    unlockBtn.disabled = false;
  }
}

wireDropzone(dropzone, fileInput, files => handleFile(files[0]));

unlockBtn.addEventListener('click', doUnlock);
passwordInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); doUnlock(); }
});
if (downloadUnlockedBtn) {
  downloadUnlockedBtn.addEventListener('click', () => {
    if (unlockedBytes) downloadBytes(unlockedBytes, currentFileName + '-unlocked.pdf');
  });
}

takeChainedFile().then(file => { if (file) handleFile(file); });
