import { readFile } from 'node:fs/promises';

const HOST = 'browserpdf.app';
const ENDPOINT = 'https://api.indexnow.org/indexnow';
const key = process.env.INDEXNOW_KEY;
const dryRun = process.argv.includes('--dry-run');
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

if (!key || !/^[A-Za-z0-9-]{8,128}$/.test(key)) {
  throw new Error('INDEXNOW_KEY must contain 8-128 letters, numbers, or hyphens.');
}

const sitemap = await readFile(new URL('../public/sitemap.xml', import.meta.url), 'utf8');
const urlList = [...sitemap.matchAll(/<loc>(https:\/\/[^<]+)<\/loc>/g)].map((match) => match[1]);
const uniqueUrls = [...new Set(urlList)];

if (urlList.length === 0 || urlList.length > 10_000) {
  throw new Error(`IndexNow URL count must be between 1 and 10000; received ${urlList.length}.`);
}
if (uniqueUrls.length !== urlList.length) {
  throw new Error('Sitemap contains duplicate canonical URLs.');
}
if (urlList.some((url) => new URL(url).hostname !== HOST)) {
  throw new Error(`Every IndexNow URL must belong to ${HOST}.`);
}

const payload = {
  host: HOST,
  key,
  keyLocation: `https://${HOST}/${key}.txt`,
  urlList,
};

if (dryRun) {
  console.log(`IndexNow dry run validated ${urlList.length} canonical URLs.`);
  process.exit(0);
}

// A Worker secret update and the following public request can briefly land on
// different Cloudflare isolates. Do not submit until IndexNow can retrieve the
// exact ownership proof from production.
let ownershipReady = false;
for (let attempt = 0; attempt < 7; attempt++) {
  const proof = await fetch(payload.keyLocation, {
    headers: { 'cache-control': 'no-cache' },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (proof?.ok && (await proof.text()).trim() === key) {
    ownershipReady = true;
    break;
  }
  if (attempt < 6) await sleep(2 ** attempt * 1_000);
}

if (!ownershipReady) {
  throw new Error('IndexNow ownership proof was not available from production after retries.');
}

let response;
for (let attempt = 0; attempt < 4; attempt++) {
  response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 200 || response.status === 202) break;
  if (![403, 429].includes(response.status) || attempt === 3) break;
  await sleep(2 ** attempt * 2_000);
}

if (response.status !== 200 && response.status !== 202) {
  throw new Error(`IndexNow submission failed with HTTP ${response.status}.`);
}

console.log(`IndexNow accepted ${urlList.length} canonical URLs (HTTP ${response.status}).`);
