import { readFile } from 'node:fs/promises';

const HOST = 'browserpdf.app';
const ENDPOINT = 'https://api.indexnow.org/indexnow';
const key = process.env.INDEXNOW_KEY;
const dryRun = process.argv.includes('--dry-run');

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

const response = await fetch(ENDPOINT, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(payload),
  signal: AbortSignal.timeout(30_000),
});

if (response.status !== 200 && response.status !== 202) {
  throw new Error(`IndexNow submission failed with HTTP ${response.status}.`);
}

console.log(`IndexNow accepted ${urlList.length} canonical URLs (HTTP ${response.status}).`);
