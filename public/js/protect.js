'use strict';

import { ensureCantooPdfLib } from './lib-loader.js';
import {
  showError, hideError, setProgress, showProgress, finishProgress, hideProgress,
  downloadBytes, wireDropzone, readPdfFile, offerChain, takeChainedFile,
} from './tool-ui.js';
import { t } from './i18n.js';

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const optionsSection = document.getElementById('optionsSection');
const passwordInput = document.getElementById('passwordInput');
const confirmInput = document.getElementById('confirmInput');
const ownerInput = document.getElementById('ownerInput');
const protectBtn = document.getElementById('protectBtn');
const printingSelect = document.getElementById('printingSelect');
const copyingChk = document.getElementById('copyingChk');
const modifyingChk = document.getElementById('modifyingChk');
const annotatingChk = document.getElementById('annotatingChk');
const fillingFormsChk = document.getElementById('fillingFormsChk');
const assemblyChk = document.getElementById('assemblyChk');

let currentBytes = null;
let currentFileName = null;

async function handleFile(file) {
  hideError();
  optionsSection.hidden = true;
  const parsed = await readPdfFile(file);
  if (!parsed) return;
  currentBytes = parsed.bytes;
  currentFileName = parsed.baseName;

  showProgress(t('common.js_loading_pdf', 'Loading PDF…'));
  try {
    const pdfLib = await ensureCantooPdfLib(msg => setProgress(0, msg));
    try {
      await pdfLib.PDFDocument.load(currentBytes);
    } catch (err) {
      const alreadyEncrypted =
        err &&
        ((pdfLib.EncryptedPDFError && err instanceof pdfLib.EncryptedPDFError) ||
          (err.message && err.message.toLowerCase().includes('encrypt')));
      if (alreadyEncrypted) {
        hideProgress();
        showError(t('protect.js_err_already', 'This PDF is already password-protected. Use the Unlock tool first to remove the existing password, then protect it with a new one.'));
        return;
      }
      throw err;
    }
    hideProgress();
    optionsSection.hidden = false;
    passwordInput.focus();
  } catch (err) {
    console.error(err);
    hideProgress();
    showError(err && err.message ? err.message : t('common.js_err_read', 'Could not read this PDF.'));
  }
}

function buildPermissions() {
  const printing = printingSelect.value;
  return {
    printing: printing === 'high' ? 'highResolution' : printing === 'low' ? 'lowResolution' : false,
    copying: copyingChk.checked,
    modifying: modifyingChk.checked,
    annotating: annotatingChk.checked,
    fillingForms: fillingFormsChk.checked,
    contentAccessibility: true,
    documentAssembly: assemblyChk.checked,
  };
}

async function doProtect() {
  if (!currentBytes) return;
  const password = passwordInput.value;
  if (!password) {
    showError(t('protect.js_err_no_password', 'Please enter a password.'));
    return;
  }
  if (password !== confirmInput.value) {
    showError(t('protect.js_err_mismatch', 'Passwords do not match.'));
    return;
  }
  hideError();
  showProgress(t('protect.js_encrypting', 'Encrypting…'));
  protectBtn.disabled = true;
  try {
    const pdfLib = await ensureCantooPdfLib(msg => setProgress(0, msg));
    const doc = await pdfLib.PDFDocument.load(currentBytes);
    setProgress(50, t('common.js_saving', 'Saving…'));
    const ownerPassword = ownerInput.value || password;
    // Encryption has to be armed with doc.encrypt() before saving: passing these
    // options to save() is silently ignored and hands back an unprotected file.
    doc.encrypt({
      userPassword: password,
      ownerPassword: ownerPassword,
      permissions: buildPermissions(),
    });
    const outBytes = await doc.save();
    const outName = currentFileName + '-protected.pdf';
    downloadBytes(outBytes, outName);
    offerChain(outBytes, outName, [
      { slug: 'unlock', label: 'Unlock' },
      { slug: 'merge', label: 'Merge' },
      { slug: 'compress', label: 'Compress' },
    ]);
    finishProgress();
  } catch (err) {
    console.error(err);
    hideProgress();
    showError(err && err.message ? err.message : t('protect.js_err_protect', 'Could not protect this PDF.'));
  } finally {
    protectBtn.disabled = false;
  }
}

wireDropzone(dropzone, fileInput, files => handleFile(files[0]));

protectBtn.addEventListener('click', doProtect);

takeChainedFile().then(file => { if (file) handleFile(file); });
