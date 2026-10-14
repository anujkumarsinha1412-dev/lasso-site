import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const SITE = 'https://agenquest.com';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const options = () => ({ cache: 'no-store', signal: AbortSignal.timeout(5000) });

export async function waitForDeployment(commit, { fetcher = fetch, sleep = pause, attempts = 36 } = {}) {
  if (!/^[a-f0-9]{40}$/i.test(commit || '')) throw new Error('A full expected commit SHA is required');
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetcher(`${SITE}/deployment.json?v=${commit}`, options());
      if (response.ok && (await response.json()).commit === commit) return;
    } catch {}
    if (attempt + 1 < attempts) await sleep(10000);
  }
  throw new Error('Production did not serve the expected commit; no URLs were submitted');
}

export function locations(xml) {
  return [...xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/g)].map(match => match[1].trim().replace(/&amp;/g, '&'));
}

function ownUrl(raw) {
  const url = new URL(raw);
  if (url.origin !== SITE || url.username || url.password) throw new Error('Sitemap contains a URL outside the production site');
  return url.href;
}

export async function sitemapUrls(fetcher = fetch) {
  const pending = [`${SITE}/sitemap-index.xml`];
  const visited = new Set();
  const urls = new Set();
  while (pending.length) {
    const url = ownUrl(pending.shift());
    if (visited.has(url)) continue;
    if (visited.size >= 10) throw new Error('Unexpected sitemap depth');
    visited.add(url);
    const response = await fetcher(url, options());
    if (!response.ok) throw new Error('The production sitemap could not be retrieved');
    const xml = await response.text();
    if (xml.includes('<sitemapindex')) pending.push(...locations(xml).map(ownUrl));
    else if (xml.includes('<urlset')) for (const page of locations(xml)) urls.add(ownUrl(page));
    else throw new Error('The production sitemap response is not sitemap XML');
  }
  if (!urls.size || urls.size > 10000) throw new Error('Invalid production URL count');
  return [...urls];
}

export async function submitIndexNow({ commit, fetcher = fetch, sleep = pause, key } = {}) {
  await waitForDeployment(commit, { fetcher, sleep });
  const verificationKey = key || (await readFile(new URL('../public/3370b49b0ed350a48ac9478580e33d4c.txt', import.meta.url), 'utf8')).trim();
  if (!/^[a-z0-9-]{8,128}$/i.test(verificationKey)) throw new Error('Invalid IndexNow site-verification file');
  const keyLocation = `${SITE}/${verificationKey}.txt`;
  const hostedKey = await fetcher(keyLocation, options());
  if (!hostedKey.ok || (await hostedKey.text()).trim() !== verificationKey) throw new Error('The production verification file does not match');
  const urlList = await sitemapUrls(fetcher);
  const response = await fetcher('https://api.indexnow.org/indexnow', {
    method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: 'agenquest.com', key: verificationKey, keyLocation, urlList }),
    signal: AbortSignal.timeout(15000),
  });
  if (![200, 202].includes(response.status)) throw new Error(`IndexNow rejected the submission (HTTP ${response.status})`);
  // Submission acknowledgement is not proof of crawling or indexing.
  return { submitted: urlList.length, status: response.status };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await submitIndexNow({ commit: process.env.GITHUB_SHA });
    console.log(`IndexNow accepted ${result.submitted} production URLs (HTTP ${result.status}); indexing is not guaranteed.`);
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
