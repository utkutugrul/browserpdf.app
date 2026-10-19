import { PROTECTION_LIMITS, PdfProtectionError, protectionError, validateProtectionRequest, copyProtectionBytes, byteLength, checkProtectionOwner } from './pdf-protection-policy.js';
import { normalizePdfNameEscapeCase } from './pdf-name-serialization.js';

const INPUT = '/job/in.pdf', OUTPUT = '/job/out.pdf';
const decoder = new TextDecoder('utf-8', { fatal: true }), encoder = new TextEncoder();
function inspectEncryption(bytes) {
  let json; try { json = JSON.parse(decoder.decode(bytes)); } catch { throw protectionError('verification-failed'); }
  const encryption = json?.encrypt; if (typeof encryption?.encrypted !== 'boolean') throw protectionError('verification-failed');
  if (!encryption.encrypted) return { encrypted: false };
  const p = encryption.parameters; if (!p || (p.key !== undefined && p.key !== null) || !Number.isSafeInteger(p.bits) || !Number.isSafeInteger(p.V) || !Number.isSafeInteger(p.R) || !['AESv2', 'AESv3'].includes(p.method)) throw protectionError('verification-failed');
  return { encrypted: true, bits: p.bits, V: p.V, R: p.R, method: p.method };
}

export async function runProtectionEngine(request, environment) {
  const validated = validateProtectionRequest(request);
  const owned = Object.freeze({ ...validated, bytes: copyProtectionBytes(validated.bytes) });
  if (!environment || typeof environment.createModule !== 'function') throw protectionError('engine-error');
  const { createModule, signal, isCurrent, onPhase } = environment, guard = () => checkProtectionOwner({ signal, isCurrent });
  const phase = value => { guard(); onPhase?.(value); guard(); };
  async function execute(action, input, password = '') {
    guard(); const captured = new Uint8Array(PROTECTION_LIMITS.diagnosticBytes); let count = 0, stdout = 0, stderr = 0, capped = false, module;
    const receive = (channel, value) => { if (value === null) return; if (channel === 'out') stdout++; else stderr++; if (count === captured.length) { capped = true; throw protectionError('diagnostic-limit'); } captured[count++] = value; };
    const fallback = (channel, text) => { if (typeof text !== 'string') throw protectionError('engine-error'); for (const character of text) for (const value of encoder.encode(character)) receive(channel, value); receive(channel, 10); };
    const init = { print: text => fallback('out', text), printErr: text => fallback('err', text), preRun: [() => init.FS.init(null, value => receive('out', value), value => receive('err', value))] };
    try {
      module = await createModule(init); guard(); module.FS.mkdir('/job'); module.FS.writeFile(INPUT, input); guard();
      let args;
      if (action === 'protect') {
        const p = owned.permissions;
        args = ['--suppress-recovery', '--object-streams=disable', '--encrypt', '--user-password=' + owned.userPassword, '--owner-password=' + owned.ownerPassword, '--bits=' + (owned.algorithm === 'aes256' ? 256 : 128), ...(owned.algorithm === 'aes128' ? ['--use-aes=y'] : []), '--print=' + p.print, '--modify=' + p.modify, '--extract=' + (p.extract ? 'y' : 'n'), '--accessibility=y', '--', INPUT, OUTPUT];
      } else if (action === 'decrypt') args = ['--password=' + password, '--decrypt', '--object-streams=disable', '--suppress-recovery', INPUT, OUTPUT];
      else if (action === 'inspect') args = ['--password=' + password, '--suppress-recovery', '--json', '--json-key=encrypt', INPUT];
      else if (action === 'pages') args = ['--password=' + password, '--suppress-recovery', '--show-npages', INPUT];
      else throw protectionError('engine-error');
      phase(action === 'protect' || action === 'decrypt' ? 'native' : 'verifying');
      let status; try { status = module.callMain(args); } catch (error) { if (error?.name === 'ExitStatus') status = error.status; else if (!capped) throw protectionError('engine-error'); }
      guard();
      if (capped) throw protectionError('diagnostic-limit');
      if (status !== 0) {
        if (status === 3) throw protectionError('engine-warning');
        let credential = false; try { credential = /invalid password|password.*(?:required|incorrect)/i.test(decoder.decode(captured.subarray(0, count))); } catch {}
        throw protectionError(credential ? 'credential-rejected' : 'engine-error');
      }
      const inspection = action === 'inspect' || action === 'pages';
      // Acceptance is inside the adapter and precedes its only output read.
      if (stderr || (!inspection && stdout)) throw protectionError('unexpected-diagnostics');
      if (inspection) {
        if (!stdout) throw protectionError('verification-failed');
        if (action === 'inspect') return inspectEncryption(captured.subarray(0, count));
        let text; try { text = decoder.decode(captured.subarray(0, count)); } catch { throw protectionError('verification-failed'); }
        if (!/^[0-9]+\r?\n?$/.test(text)) throw protectionError('verification-failed');
        const pages = Number(text); if (!Number.isSafeInteger(pages) || pages < 1 || pages > PROTECTION_LIMITS.pages) throw protectionError('output-limit'); return pages;
      }
      const output = module.FS.readFile(OUTPUT, { encoding: 'binary' }); guard();
      try { byteLength(output, PROTECTION_LIMITS.outputBytes); } catch { throw protectionError('output-limit'); }
      return copyProtectionBytes(output, PROTECTION_LIMITS.outputBytes);
    } finally {
      captured.fill(0);
      if (module) { for (const path of [OUTPUT, INPUT]) try { if (module.FS.analyzePath(path).exists) module.FS.unlink(path); } catch {} try { module.FS.rmdir('/job'); } catch {} }
    }
  }
  guard();
  try {
    const inputState = await execute('inspect', owned.bytes, owned.operation === 'unlock' ? owned.password : ''); guard();
    if (owned.operation === 'protect' && inputState.encrypted) throw protectionError('requires-unlock');
    if (owned.operation === 'unlock' && !inputState.encrypted) throw protectionError('already-unlocked');
    let output, plain, algorithm = 'none';
    if (owned.operation === 'protect') {
      output = await execute('protect', owned.bytes); guard();
      const encrypted = await execute('inspect', output, owned.userPassword); guard();
      const aes256 = owned.algorithm === 'aes256';
      if (!encrypted.encrypted || encrypted.bits !== (aes256 ? 256 : 128) || encrypted.V !== (aes256 ? 5 : 4) || encrypted.R !== (aes256 ? 6 : 4) || encrypted.method !== (aes256 ? 'AESv3' : 'AESv2')) throw protectionError('verification-failed');
      plain = await execute('decrypt', output, owned.userPassword); guard(); algorithm = owned.algorithm;
    } else { plain = await execute('decrypt', owned.bytes, owned.password); guard(); }
    phase('verifying'); let normalized;
    try { normalized = await normalizePdfNameEscapeCase(plain, { signal, isCurrent }); } catch (error) { guard(); throw protectionError(error?.code === 'aborted' ? 'canceled' : error?.code === 'stale' ? 'stale' : 'unsupported-serialization'); }
    guard(); const pages = await execute('pages', normalized.bytes); guard();
    if (owned.operation === 'unlock') output = normalized.bytes;
    return { bytes: output, facts: Object.freeze({ operation: owned.operation, encrypted: owned.operation === 'protect', algorithm, engineVersion: '12.3.2', inputBytes: byteLength(owned.bytes), outputBytes: byteLength(output, PROTECTION_LIMITS.outputBytes), pages, objects: normalized.facts.objectCount, normalizedNameTokens: owned.operation === 'unlock' ? normalized.facts.changedNameTokens : 0 }) };
  } catch (error) { guard(); throw error instanceof PdfProtectionError ? error : protectionError('engine-error'); }
}
