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

  async function getFiles(workflowId, ids) {
    const unique = [...new Set(ids)].filter((id) => typeof id === 'string' && id.startsWith(`${workflowId}:`)).slice(0, 160);
    return withDb([FILES], 'readonly', async (tx) => {
      const values = []; let retainedBytes = 0;
      for (const id of unique) {
        const value = await requestResult(tx.objectStore(FILES).get(id));
        if (value?.workflowId !== workflowId) continue;
        retainedBytes += value.bytes?.byteLength || 0;
        if (retainedBytes > 512 * 1024 * 1024) throw new RangeError('This task exceeds the local resource limit.');
        values.push(value);
      }
      return values;
    });
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
      const workflows = [];
      await new Promise((resolve, reject) => {
        const request = workflowStore.openCursor();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => { const cursor = request.result; if (!cursor) { resolve(); return; }
          const value = cursor.value;
          workflows.push({ id: value.id, expiresAt: value.expiresAt, fileRefs: value.fileRefs || [] }); cursor.continue(); };
      });
      const owners = new Map(workflows.map((workflow) => [workflow.id, workflow]));
      const ownersByFile = new Map();
      for (const owner of workflows) for (const id of owner.fileRefs || []) ownersByFile.set(id, owner);
      const expiredIds = new Set(workflows.filter((workflow) => workflow.expiresAt <= stamp).map((workflow) => workflow.id));
      // Expired ownership is deleted through index keys, without reading bytes.
      let removedFiles = 0;
      for (const id of expiredIds) {
        const keys = await requestResult(fileStore.index('workflowId').getAllKeys(id));
        for (const key of keys) { fileStore.delete(key); removedFiles++; }
        workflowStore.delete(id);
      }
      await new Promise((resolve, reject) => {
        const request = fileStore.openKeyCursor();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) { resolve(); return; }
          // Live referenced files require only their primary keys. Legacy v2
          // unreferenced/orphan records are inspected individually for expiry.
          const owner = ownersByFile.get(cursor.primaryKey);
          if (owner) { cursor.continue(); return; }
          const read = fileStore.get(cursor.primaryKey);
          read.onerror = () => reject(read.error);
          read.onsuccess = () => {
            const file = read.result;
            if (file) {
              const fileOwner = owners.get(file.workflowId);
              const expiry = file.expiresAt || ((file.updatedAt || 0) + WORKFLOW_TTL_MS);
              if (expiredIds.has(file.workflowId) || ((!fileOwner || !(fileOwner.fileRefs || []).includes(file.id)) && expiry <= stamp)) { fileStore.delete(cursor.primaryKey); removedFiles++; }
            }
            cursor.continue();
          };
        };
      });
      return { workflows: expiredIds.size, files: removedFiles };
    });
  }

  return { putWorkflow, putWorkflowBundle, getWorkflow, putFile, getFile, listFiles, getFiles, deleteWorkflow, cleanupExpired };
}
