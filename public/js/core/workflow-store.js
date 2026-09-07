'use strict';

import { WORKFLOW_MANIFEST_VERSION } from './workflow-manifest.js';

export const WORKFLOW_DB_NAME = 'browserpdf-workflows';
export const WORKFLOW_DB_VERSION = 2;
export const WORKFLOW_TTL_MS = 24 * 60 * 60 * 1000;
const WORKFLOWS = 'workflows';
const FILES = 'files';

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted.'));
  });
}

export function openWorkflowDb(indexedDb = globalThis.indexedDB) {
  if (!indexedDb) return Promise.reject(new Error('IndexedDB is unavailable.'));
  return new Promise((resolve, reject) => {
    const request = indexedDb.open(WORKFLOW_DB_NAME, WORKFLOW_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(WORKFLOWS)) db.createObjectStore(WORKFLOWS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(FILES)) {
        const store = db.createObjectStore(FILES, { keyPath: 'id' });
        store.createIndex('workflowId', 'workflowId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function createWorkflowStore({ indexedDb = globalThis.indexedDB, now = () => Date.now() } = {}) {
  async function withDb(storeNames, mode, operation) {
    const db = await openWorkflowDb(indexedDb);
    try {
      const tx = db.transaction(storeNames, mode);
      let result;
      try {
        result = await operation(tx);
      } catch (error) {
        try { tx.abort(); } catch { /* transaction already inactive */ }
        throw error;
      }
      await transactionDone(tx);
      return result;
    } finally {
      db.close();
    }
  }

  async function putWorkflow(workflow) {
    const stamp = now();
    const record = {
      ...workflow,
      manifestVersion: WORKFLOW_MANIFEST_VERSION,
      createdAt: workflow.createdAt || stamp,
      updatedAt: stamp,
      expiresAt: workflow.expiresAt || stamp + WORKFLOW_TTL_MS,
    };
    await withDb([WORKFLOWS], 'readwrite', (tx) => requestResult(tx.objectStore(WORKFLOWS).put(record)));
    return record;
  }

  async function getWorkflow(id) {
    const record = await withDb([WORKFLOWS], 'readonly', (tx) => requestResult(tx.objectStore(WORKFLOWS).get(id)));
    if (!record) return null;
    if (record.expiresAt <= now()) {
      await deleteWorkflow(id);
      return null;
    }
    return record;
  }

  async function putFile(workflowId, file) {
    const id = file.id || `${workflowId}:${crypto.randomUUID()}`;
    const stamp = now();
    const record = { ...file, id, workflowId, updatedAt: stamp, expiresAt: file.expiresAt || stamp + WORKFLOW_TTL_MS };
    await withDb([FILES], 'readwrite', (tx) => requestResult(tx.objectStore(FILES).put(record)));
    return record;
  }

  async function putWorkflowBundle(workflow, files) {
    const stamp = now();
    const workflowRecord = {
      ...workflow,
      manifestVersion: WORKFLOW_MANIFEST_VERSION,
      createdAt: workflow.createdAt || stamp,
      updatedAt: stamp,
      expiresAt: workflow.expiresAt || stamp + WORKFLOW_TTL_MS,
    };
    const fileRecords = files.map((file) => ({
      ...file,
      workflowId: workflowRecord.id,
      updatedAt: stamp,
      expiresAt: file.expiresAt || workflowRecord.expiresAt,
    }));
    await withDb([WORKFLOWS, FILES], 'readwrite', async (tx) => {
      const workflowStore = tx.objectStore(WORKFLOWS);
      const fileStore = tx.objectStore(FILES);
      const existingIds = await requestResult(fileStore.index('workflowId').getAllKeys(workflowRecord.id));
      const retainedIds = new Set(fileRecords.map((file) => file.id));
      existingIds.filter((id) => !retainedIds.has(id)).forEach((id) => fileStore.delete(id));
      for (const file of fileRecords) await requestResult(fileStore.put(file));
      // Write the owner last. If it or any file cannot be cloned, abort rolls
      // back every request in this transaction, leaving no orphan bytes.
      await requestResult(workflowStore.put(workflowRecord));
    });
    return { workflow: workflowRecord, files: fileRecords };
  }

  async function getFile(id) {
    return withDb([FILES], 'readonly', (tx) => requestResult(tx.objectStore(FILES).get(id)));
  }

  async function listFiles(workflowId) {
    return withDb([FILES], 'readonly', (tx) => requestResult(tx.objectStore(FILES).index('workflowId').getAll(workflowId)));
  }

  async function deleteWorkflow(id) {
    return withDb([WORKFLOWS, FILES], 'readwrite', async (tx) => {
      tx.objectStore(WORKFLOWS).delete(id);
      const fileStore = tx.objectStore(FILES);
      const ids = await requestResult(fileStore.index('workflowId').getAllKeys(id));
      ids.forEach((fileId) => fileStore.delete(fileId));
    });
  }

  async function cleanupExpired() {
    const stamp = now();
    return withDb([WORKFLOWS, FILES], 'readwrite', async (tx) => {
      const workflowStore = tx.objectStore(WORKFLOWS);
      const fileStore = tx.objectStore(FILES);
      const [workflows, files] = await Promise.all([
        requestResult(workflowStore.getAll()),
        requestResult(fileStore.getAll()),
      ]);
      const owners = new Map(workflows.map((workflow) => [workflow.id, workflow]));
      const expiredIds = new Set(workflows.filter((workflow) => workflow.expiresAt <= stamp).map((workflow) => workflow.id));
      expiredIds.forEach((id) => workflowStore.delete(id));
      let removedFiles = 0;
      for (const file of files) {
        const owner = owners.get(file.workflowId);
        const fileExpiry = file.expiresAt || ((file.updatedAt || 0) + WORKFLOW_TTL_MS);
        const unreferenced = owner && !new Set(owner.fileRefs || []).has(file.id);
        if (expiredIds.has(file.workflowId) || (!owner && fileExpiry <= stamp) || (unreferenced && fileExpiry <= stamp)) {
          fileStore.delete(file.id);
          removedFiles++;
        }
      }
      return { workflows: expiredIds.size, files: removedFiles };
    });
  }

  return { putWorkflow, putWorkflowBundle, getWorkflow, putFile, getFile, listFiles, deleteWorkflow, cleanupExpired };
}
