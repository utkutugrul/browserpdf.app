'use strict';

import { t } from './i18n.js';

const panel = document.getElementById('pwaPanel');
const storageText = document.getElementById('pwaStorage');
const status = document.getElementById('pwaStatus');
const persistButton = document.getElementById('pwaPersist');
const removeButton = document.getElementById('pwaRemove');
const updateButton = document.getElementById('pwaUpdate');

function setStatus(key, fallback) { if (status) status.textContent = t(key, fallback); }

async function updateStorage() {
  if (!storageText || !navigator.storage?.estimate) return;
  try {
    const estimate = await navigator.storage.estimate();
    const used = ((estimate.usage || 0) / 1_000_000).toFixed(1);
    const quota = ((estimate.quota || 0) / 1_000_000).toFixed(1);
    storageText.textContent = t('pwa.storage_usage', '{used} MB used of {quota} MB browser storage.', { used, quota });
  } catch {
    storageText.textContent = t('pwa.storage_unknown', 'Browser storage estimate unavailable.');
  }
}

function showWaiting(registration) {
  if (!registration.waiting || !updateButton) return;
  updateButton.hidden = false;
  updateButton.onclick = () => {
    updateButton.disabled = true;
    registration.waiting?.postMessage({ type: 'ACTIVATE_WAITING_UPDATE' });
  };
}

function disableWorker(worker) {
  if (!worker) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => reject(new Error('offline cache disable timed out')), 5_000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      if (event.data?.disabled === true) resolve();
      else reject(new Error('offline cache disable was not acknowledged'));
    };
    worker.postMessage({ type: 'DISABLE_OFFLINE_CACHE' }, [channel.port2]);
  });
}

async function start() {
  if (!panel || !('serviceWorker' in navigator) || !isSecureContext) return;
  const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
  panel.hidden = false;
  setStatus('pwa.registered', 'Static shell caching is ready. Document tools are not enabled for offline use.');
  await updateStorage();
  showWaiting(registration);
  registration.addEventListener('updatefound', () => {
    const installing = registration.installing;
    installing?.addEventListener('statechange', () => {
      if (installing.state === 'installed' && navigator.serviceWorker.controller) showWaiting(registration);
    });
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    updateButton.hidden = true;
    setStatus('pwa.update_activated', 'Update activated. Reload when you are ready.');
  });

  persistButton?.addEventListener('click', async () => {
    if (!navigator.storage?.persist) return;
    try {
      const granted = await navigator.storage.persist();
      setStatus(granted ? 'pwa.persisted' : 'pwa.persist_denied', granted
        ? 'Persistent storage was granted by this browser.'
        : 'Persistent storage was not granted. The browser may remove cached shell files.');
      await updateStorage();
    } catch {
      setStatus('pwa.action_failed', 'The browser could not complete this storage request.');
    }
  });
  removeButton?.addEventListener('click', async () => {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      const owned = registrations.filter((entry) => entry.scope === registration.scope);
      const workers = new Set(owned
        .flatMap((entry) => [entry.installing, entry.waiting, entry.active])
        .filter(Boolean));
      await Promise.all([...workers].map(disableWorker));
      await Promise.all(owned.map((entry) => entry.unregister()));
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name.startsWith('bpdf-')).map((name) => caches.delete(name)));
      setStatus('pwa.removed', 'BrowserPDF offline shell data and its registration were removed.');
      await updateStorage();
    } catch {
      setStatus('pwa.action_failed', 'The browser could not complete this storage request.');
    }
  });
}

void start().catch(() => { if (panel) panel.hidden = true; });
