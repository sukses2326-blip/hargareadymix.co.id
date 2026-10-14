/**
 * tools/lib/index-ping.js
 *
 * IndexNow submission (Bing, Yandex, Seznam, Naver, Yep — Google does NOT participate).
 *
 * HOW INDEXNOW WORKS: one POST to api.indexnow.org with the host, a secret key, the public
 * location of a text file that contains EXACTLY that key (proves you own the domain) and the list
 * of URLs that were added/changed. The search engine then fetches the key file and the URLs, so
 * BOTH must already be live when the request is made — this is why tools/indexnow-submit.js runs
 * at the END of deploy.yml (after public/ is pushed and Cloudflare Pages has published it) and not
 * from the content workflows.
 *
 * GOOGLE: there is no supported "push this URL" call for ordinary pages (the old sitemap ping
 * endpoint was retired in 2023; the Indexing API is only for job-posting/livestream pages). The
 * supported signal is an accurate sitemap.xml with correct <lastmod> (Hugo builds it from the
 * `lastmod` front matter, which every tool in tools/ maintains) plus the Sitemap line in robots.txt.
 */

const fs     = require('fs');
const path   = require('path');
const https  = require('https');
const crypto = require('crypto');

const ROOT           = path.join(__dirname, '..', '..');
const KEY_STATE_FILE = path.join(ROOT, '.indexnow-key.json');
const STATIC_DIR     = path.join(ROOT, 'static');

/**
 * Returns this site's persistent IndexNow key, generating it (and the required
 * static/<key>.txt verification file) only if it does not exist yet. The SAME key must keep being
 * used forever, so .indexnow-key.json AND static/<key>.txt must be committed (deploy.yml does it).
 */
function ensureIndexNowKey() {
  let key;
  if (fs.existsSync(KEY_STATE_FILE)) {
    try { key = JSON.parse(fs.readFileSync(KEY_STATE_FILE, 'utf8')).key; } catch { key = null; }
  }
  if (!key || !/^[a-f0-9]{32}$/i.test(key)) {
    key = crypto.randomBytes(16).toString('hex');
    fs.writeFileSync(KEY_STATE_FILE, JSON.stringify({ key, createdAt: new Date().toISOString() }, null, 2));
    console.log(`   🔑 New IndexNow key generated and saved to ${path.basename(KEY_STATE_FILE)}: ${key}`);
  }

  const keyFilePath = path.join(STATIC_DIR, `${key}.txt`);
  if (!fs.existsSync(keyFilePath)) {
    if (!fs.existsSync(STATIC_DIR)) fs.mkdirSync(STATIC_DIR, { recursive: true });
    fs.writeFileSync(keyFilePath, key); // file content must be EXACTLY the key, no extra whitespace
    console.log(`   🔑 IndexNow key file created: static/${key}.txt`);
  }
  return key;
}

function httpsPostJson(hostname, reqPath, payload, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request({
      hostname, path: reqPath, method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`Timeout after ${timeoutMs / 1000}s (${hostname}${reqPath})`)));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

const STATUS_HELP = {
  200: 'OK — URL diterima.',
  202: 'Diterima; verifikasi key masih tertunda (normal untuk submit pertama).',
  400: 'Request tidak valid (format JSON/URL salah).',
  403: 'Key tidak valid: file https://<domain>/<key>.txt belum live atau isinya tidak sama persis dengan key.',
  422: 'URL tidak sesuai host/key (domain di urlList harus sama dengan "host").',
  429: 'Terlalu banyak request (rate limit).',
};

/**
 * Polls `url` until it answers HTTP 200 (and, if `expectBody` is given, the trimmed body equals it).
 * Returns true/false; never throws.
 */
async function waitUntilLive(url, { expectBody = null, timeoutMs = 8 * 60 * 1000, intervalMs = 20000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(url, { redirect: 'follow', headers: { 'Cache-Control': 'no-cache' } });
      if (res.status === 200) {
        if (expectBody === null) return true;
        if ((await res.text()).trim() === expectBody) return true;
      }
    } catch { /* network hiccup: keep polling */ }
    if (Date.now() + intervalMs > deadline) return false;
    await sleep(intervalMs);
  }
}

/**
 * Submits `urls` (full https:// page URLs that were actually added/changed — NOT a sitemap URL)
 * to IndexNow in batched calls (the protocol allows 10,000 per call). Retries once on 429/5xx.
 *
 * @param {string} siteUrl - e.g. "https://hargareadymix.co.id/"
 * @param {string[]} urls  - full page URLs, same host as siteUrl
 */
async function submitToIndexNow(siteUrl, urls) {
  if (!urls || !urls.length) return { skipped: true, reason: 'no URLs to submit' };

  const key = ensureIndexNowKey();
  const host = new URL(siteUrl).host;
  const keyLocation = `${siteUrl.replace(/\/$/, '')}/${key}.txt`;
  const unique = [...new Set(urls)].filter(u => { try { return new URL(u).host === host; } catch { return false; } });
  let ok = true, lastStatus = null;

  for (let i = 0; i < unique.length; i += 10000) {
    const payload = { host, key, keyLocation, urlList: unique.slice(i, i + 10000) };
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const { statusCode, body } = await httpsPostJson('api.indexnow.org', '/indexnow', payload);
        lastStatus = statusCode;
        if (statusCode === 200 || statusCode === 202) {
          console.log(`   ✅ IndexNow: ${payload.urlList.length} URL dikirim (HTTP ${statusCode}) — ${STATUS_HELP[statusCode]}`);
          break;
        }
        if ((statusCode === 429 || statusCode >= 500) && attempt === 1) { await sleep(5000); continue; }
        ok = false;
        console.warn(`   ⚠️  IndexNow HTTP ${statusCode}: ${STATUS_HELP[statusCode] || 'status tidak dikenal'} ${body ? '| ' + body.slice(0, 200) : ''}`);
        break;
      } catch (err) {
        if (attempt === 1) { await sleep(5000); continue; }
        ok = false;
        console.warn(`   ⚠️  IndexNow gagal: ${err.message}`);
      }
    }
  }
  return { ok, statusCode: lastStatus, submitted: unique.length };
}

module.exports = { submitToIndexNow, ensureIndexNowKey, waitUntilLive };
