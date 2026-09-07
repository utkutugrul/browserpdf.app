import { cp, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sdkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(sdkRoot, '..');
const outputRoot = path.join(sdkRoot, 'dist');
const files = new Map([
  ['index.js', path.join(sdkRoot, 'src/index.js')],
  ['index.d.ts', path.join(sdkRoot, 'index.d.ts')],
  ['core/merge-pdf.js', path.join(repositoryRoot, 'public/js/core/merge-pdf.js')],
  ['core/privacy-scan.js', path.join(repositoryRoot, 'public/js/core/privacy-scan.js')],
  ['core/document-doctor.js', path.join(repositoryRoot, 'public/js/core/document-doctor.js')],
  ['core/document-doctor-output.js', path.join(repositoryRoot, 'public/js/core/document-doctor-output.js')],
]);

async function outputFiles(directory, prefix = '') {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) found.push(...await outputFiles(path.join(directory, entry.name), relative));
    else found.push(relative);
  }
  return found.sort();
}

async function check() {
  const actual = await outputFiles(outputRoot);
  const expected = [...files.keys()].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`SDK output allowlist mismatch. Expected ${expected.join(', ')}; found ${actual.join(', ') || '(empty)'}.`);
  }
  for (const [relative, source] of files) {
    const [sourceBytes, outputBytes] = await Promise.all([readFile(source), readFile(path.join(outputRoot, relative))]);
    if (!sourceBytes.equals(outputBytes)) throw new Error(`Stale SDK output: ${relative}`);
  }
}

if (process.argv.includes('--check')) {
  await check();
} else {
  if (path.dirname(outputRoot) !== sdkRoot || path.basename(outputRoot) !== 'dist') throw new Error('Refusing unsafe build output path.');
  await rm(outputRoot, { recursive: true, force: true });
  for (const [relative, source] of files) {
    const destination = path.join(outputRoot, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(source, destination);
  }
  await check();
}
