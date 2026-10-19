import { runProtectionEngine } from './core/pdf-protection-engine.js';
import { exactRecord, validateProtectionRequest, protectionError } from './core/pdf-protection-policy.js';

let received = false;
self.onmessage = async event => {
  if (received) return; received = true; self.onmessage = null;
  let id = 0;
  try {
    const message = event.data; exactRecord(message, ['type', 'id', 'request', 'bootstrap']);
    if (message.type !== 'run' || !Number.isSafeInteger(message.id) || message.id < 1) throw protectionError('worker-protocol'); id = message.id;
    exactRecord(message.bootstrap, ['moduleUrl', 'wasmUrl']);
    for (const key of ['moduleUrl', 'wasmUrl']) if (typeof message.bootstrap[key] !== 'string' || !message.bootstrap[key].startsWith('blob:')) throw protectionError('worker-protocol');
    const request = validateProtectionRequest(message.request), bootstrap = message.bootstrap;
    const { default: factory } = await import(bootstrap.moduleUrl); if (typeof factory !== 'function') throw protectionError('worker-protocol');
    const createModule = init => {
      init.locateFile = path => { if (path !== 'qpdf.wasm') throw protectionError('worker-protocol'); return bootstrap.wasmUrl; };
      return factory(init);
    };
    const result = await runProtectionEngine(request, { createModule, onPhase: phase => self.postMessage({ type: 'phase', id, phase }) });
    self.postMessage({ type: 'result', id, ownerToken: request.ownerToken, operationRevision: request.operationRevision, bytes: result.bytes, facts: result.facts }, [result.bytes.buffer]);
  } catch (error) { const safe = protectionError(error?.code); self.postMessage({ type: 'error', id, code: safe.code }); }
};
