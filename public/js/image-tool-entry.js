import * as ui from './tool-ui.js';
import { t } from './i18n.js';
import { IMAGE_INTAKE_LIMITS } from './core/image-limits.js';

export function mountImageTool({ combined = false } = {}) {
  const input = document.getElementById(combined ? 'imgFileInput' : 'fileInput'), dropzone = document.getElementById(combined ? 'imgDropzone' : 'dropzone'), imageContainer = document.getElementById(combined ? 'imgListSection' : 'fileListSection');
  let composer = null, composerOpening = null, pdfWorkspace = null, pdfOpening = null, transition = Promise.resolve();
  const intakeScope = ui.createOperationScope(); let localIntent = 0, pdfIntent = 0;
  const reservations = new Set(); let reservedCount = 0, reservedBytes = 0;
  const pdfContainer = combined ? document.getElementById('imgPageGridSection') : null;
  const pdfSection = document.getElementById('pdfToImgSection'), imageSection = document.getElementById('imgToPdfSection');
  const pdfMode = document.getElementById('modePdfToImg'), imageMode = document.getElementById('modeImgToPdf');
  function fail(error) { if (error.name !== 'AbortError') ui.showError(error.message); }
  function releaseReservations() { for (const reservation of [...reservations]) reservation.release(); }
  function reserve(files) {
    const accepted = [], errors = [], current = ui.documentSession.snapshot(), pending = composer?.pending() || { pending: 0, rawReserved: 0 }, entries = ui.documentSession.composition()?.items.length || 0; let rejected = 0;
    for (const file of files) {
      let error;
      if (!['image/png','image/jpeg'].includes(file.type) || !file.size || file.size > IMAGE_INTAKE_LIMITS.fileBytes) error = 'Choose non-empty PNG/JPEG images smaller than 16 MiB.';
      else if (reservedCount + pending.pending >= IMAGE_INTAKE_LIMITS.pending) error = 'At most 16 images may wait for image work to finish.';
      else if (Math.max(entries,current.originalImageCount || 0) + reservedCount + pending.pending >= IMAGE_INTAKE_LIMITS.entries) error = 'This task retains at most 48 original images, including removed images and pending inputs. Clear starts a new task.';
      else if ((current.compositionRawBytes || 0) + reservedBytes + pending.rawReserved + file.size > IMAGE_INTAKE_LIMITS.rawBytes) error = 'Original images and pending inputs exceed 48 MiB. Start a smaller task.';
      if (error) { rejected++; if (errors.length < 5) errors.push(`${file.name}: ${error}`); continue; } accepted.push(file); reservedCount++; reservedBytes += file.size;
    }
    if (rejected > 5) errors.push(`${rejected - 5} additional files were not added.`);
    const reservation = { files: accepted, errors, release() { if (!reservations.has(reservation)) return; reservations.delete(reservation); reservedCount -= reservation.files.length; reservedBytes -= reservation.files.reduce((sum,file) => sum + file.size,0); reservation.files = []; } };
    reservations.add(reservation); if (errors.length) ui.showError(errors.join(' ')); return reservation;
  }
  function queue(work) { transition = transition.catch(() => {}).then(work); void transition.catch(fail); return transition; }
  async function imageSurface() {
    if (composer) return composer;
    if (!composerOpening) {
      imageContainer.hidden = false; imageContainer.replaceChildren();
      composerOpening = import('./image-composer.js').then((module) => module.createImageComposer({ container: imageContainer, fileInput: input, dropzone, reviewButtonId: combined ? 'createPdfBtn' : 'createBtn', ui, onClear: () => { localIntent++; pdfIntent++; releaseReservations(); intakeScope.cancel(); } })).then((surface) => (composer = surface)).finally(() => { composerOpening = null; });
    }
    return composerOpening;
  }
  async function closePdfForImages() {
    if (!pdfWorkspace) return; const preceding = pdfWorkspace; pdfWorkspace = null; preceding.dispose();
    const waiting = document.createElement('p'); waiting.id = 'imageTransitionStatus'; waiting.setAttribute('role','status'); waiting.textContent = t('composer.draining', 'Finishing previous image work before opening this image task…'); (imageSection || imageContainer).append(waiting);
    try { await preceding.settled(); } finally { waiting.remove(); }
  }
  async function imageFiles(reservation, expectedPdfIntent) {
    if (expectedPdfIntent !== pdfIntent) return;
    await closePdfForImages();
    if (pdfOpening) { try { await pdfOpening; } catch {} }
    const surface = await imageSurface(); if (expectedPdfIntent === pdfIntent && reservation.files.length) { const files = reservation.files; reservation.release(); surface.addFiles(files); if (reservation.errors.length) ui.showError(reservation.errors.join(' ')); }
  }
  ui.wireDropzone(dropzone, input, (files) => { const reservation = reserve(files); if (!reservation.files.length) { reservation.release(); return; } localIntent++; intakeScope.cancel(); const expectedPdfIntent = pdfIntent; void queue(async () => { try { await imageFiles(reservation, expectedPdfIntent); } finally { reservation.release(); } }); });
  async function pdfSurface() {
    if (!combined || ui.documentSession.snapshot().current?.type !== 'application/pdf') return;
    if (composer) { composer.pause(); await composer.settled(); }
    if (pdfWorkspace) { pdfWorkspace.dispose(); await pdfWorkspace.settled(); pdfWorkspace = null; }
    if (pdfOpening) { try { await pdfOpening; } catch {} }
    pdfContainer.hidden = false; pdfContainer.replaceChildren();
    pdfOpening = import('./pdf-images-workspace.js').then((module) => module.createPdfImagesWorkspace({ container: pdfContainer, ui, onAdopt: () => { void queue(async () => { if (pdfWorkspace) { pdfWorkspace.dispose(); await pdfWorkspace.settled(); pdfWorkspace = null; } setMode('images'); if (composer) { composer.dispose(); composer = null; } const surface = await imageSurface(); surface.startFromCurrent(); }); } })).then((surface) => (pdfWorkspace = surface)).finally(() => { pdfOpening = null; });
    return pdfOpening;
  }
  function setMode(value) {
    if (!combined) return; const pdf = value === 'pdf'; pdfSection.hidden = !pdf; imageSection.hidden = pdf; pdfMode.classList.toggle('active', pdf); imageMode.classList.toggle('active', !pdf); pdfMode.setAttribute('aria-selected', String(pdf)); imageMode.setAttribute('aria-selected', String(!pdf));
  }
  if (combined) {
    pdfMode.addEventListener('click', () => { setMode('pdf'); void queue(pdfSurface); });
    imageMode.addEventListener('click', () => { setMode('images'); void queue(async () => { await closePdfForImages(); if (composer) composer.refresh(); else if (ui.documentSession.composition() || ui.documentSession.snapshot().current?.type.startsWith('image/')) (await imageSurface()).startFromCurrent(); }); });
    const pdfInput = document.getElementById('pdfFileInput');
    ui.wireDropzone(document.getElementById('pdfDropzone'), pdfInput, (files) => {
      const file = files[0]; if (!file) return;
      pdfIntent++; releaseReservations(); const intent = ++localIntent, token = intakeScope.begin(), before = ui.documentSession.snapshot();
      const operation = { signal: token.signal, isCurrent: () => { const current = ui.documentSession.snapshot(); return token.isCurrent() && current.taskId === before.taskId && current.revision === before.revision && current.generation === before.generation; } };
      if (composer) composer.pause();
      void ui.readPdfFile(file, { validate: true, maxPages: 10000, operation }).then((accepted) => {
        if (!accepted) { if (localIntent === intent && composer) composer.refresh(); return; }
        const taskId = ui.documentSession.snapshot().taskId;
        void queue(async () => { if (localIntent !== intent || ui.documentSession.snapshot().taskId !== taskId) return; if (composer) { composer.dispose(); await composer.settled(); composer = null; } setMode('pdf'); await pdfSurface(); });
      }).catch((error) => { if (localIntent === intent) fail(error); });
    });
  }
  void ui.takeChainedFile().then(async (file) => {
    if (!file || localIntent) return;
    const bytes = new Uint8Array(await file.arrayBuffer()); await ui.ensureDocumentSession();
    if (localIntent) return;
    await ui.documentSession.begin(bytes, file.name, { ...file.browserpdfSession, type: file.type }); ui.showDocumentIdentity();
    await queue(async () => {
      if (localIntent) return;
      if (ui.documentSession.composition() || file.type.startsWith('image/')) { setMode('images'); (await imageSurface()).startFromCurrent(); }
      else if (combined && file.type === 'application/pdf') { setMode('pdf'); await pdfSurface(); }
      else ui.showError(t('composer.choose_image', 'This entry accepts an image task. Open the chosen PDF in PDF & Images to export its pages.'));
    });
  }).catch(fail);
}
