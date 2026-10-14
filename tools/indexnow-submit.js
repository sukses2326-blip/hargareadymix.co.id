/**
 * tools/indexnow-submit.js
 *
 * Runs at the END of deploy.yml (after public/ was pushed) and tells IndexNow (Bing, Yandex, Seznam,
 * Naver, Yep) exactly which pages were added or changed in content/ since the previous deploy.
 *
 * WHY HERE AND NOT IN THE CONTENT WORKFLOWS: IndexNow makes the search engine fetch the key file and
 * the pages immediately. Pinging right after `git push` (before Hugo built and Cloudflare Pages
 * published anything) means the engine sees 404s / an old page. So we: (1) diff content/ between the
 * previous "Build site" commit and the commit that was just built, (2) wait until the new pages are
 * really live, (3) submit.
 *
 * USAGE:
 *   node tools/indexnow-submit.js --ensure-key                 create .indexnow-key.json + static/<key>.txt if missing
 *   node tools/indexnow-submit.js --prev=<sha> --head=<sha> [--wait] [--dry-run]
 *
 * Google does not support IndexNow — it relies on sitemap.xml <lastmod> (see lib/index-ping.js).
 */
const fs   = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const FM   = require('./lib/frontmatter.js');
const { resolveUrl } = require('./lib/content-url.js');
const { submitToIndexNow, ensureIndexNowKey, waitUntilLive } = require('./lib/index-ping.js');

const SITE_URL = 'https://hargareadymix.co.id/';
const ROOT = path.join(__dirname, '..');
const CONTENT_DIR = path.join(ROOT, 'content');
const ARGS = process.argv.slice(2);
const arg = name => (ARGS.find(a => a.startsWith(`--${name}=`)) || '').replace(`--${name}=`, '');
const DRY = ARGS.includes('--dry-run');
const WAIT = ARGS.includes('--wait');

const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' });

// Added / modified / renamed .md files under content/ between two commits.
function changedContentFiles(prev, head) {
  const out = git('diff', '--name-status', '--diff-filter=AMR', '-M', prev, head, '--', 'content/');
  const files = [];
  for (const line of out.split('\n').filter(Boolean)) {
    const cols = line.split('\t');
    const status = cols[0][0];
    const file = cols[cols.length - 1];
    if (!file.endsWith('.md') || path.basename(file) === '_index.md') continue;
    files.push({ file, added: status === 'A' || status === 'R' });
  }
  return files;
}

async function main() {
  if (ARGS.includes('--ensure-key')) { ensureIndexNowKey(); return; }

  const prev = arg('prev'), head = arg('head') || 'HEAD';
  console.log(`\n📡 IndexNow — kirim URL yang berubah ${DRY ? '[DRY-RUN]' : ''}`);
  if (!prev) {
    console.log('ℹ️  Tidak ada deploy sebelumnya ("Build site") sebagai pembanding — dilewati. Mulai deploy berikutnya akan aktif.');
    return;
  }

  let files;
  try { files = changedContentFiles(prev, head); }
  catch (err) { console.warn(`⚠️  git diff ${prev.slice(0, 7)}..${head.slice(0, 7)} gagal: ${err.message.split('\n')[0]} — dilewati.`); return; }

  const urls = [], newUrls = [];
  for (const { file, added } of files) {
    const full = path.join(ROOT, file);
    if (!fs.existsSync(full)) continue;
    const fm = FM.parse(fs.readFileSync(full, 'utf8'));
    if (!fm.delim || fm.data.draft) continue; // no front matter / unpublished draft
    const url = SITE_URL.replace(/\/$/, '') + resolveUrl(full, CONTENT_DIR, fm.data);
    urls.push(url);
    if (added) newUrls.push(url);
  }
  // A new blog article also changes the blog index page, which is how crawlers discover it.
  if (newUrls.some(u => u.includes('/blog/'))) urls.push(SITE_URL + 'blog/');

  console.log(`   ${files.length} file content berubah → ${urls.length} URL (${newUrls.length} halaman baru).`);
  urls.slice(0, 15).forEach(u => console.log(`   • ${u}`));
  if (urls.length > 15) console.log(`   … dan ${urls.length - 15} lainnya`);
  if (!urls.length) { console.log('   Tidak ada URL untuk dikirim.'); return; }
  if (DRY) { console.log('\n🧪 Dry-run: tidak ada yang dikirim.'); return; }

  if (WAIT) {
    const key = ensureIndexNowKey();
    console.log('   ⏳ Menunggu situs live (Cloudflare Pages)...');
    const keyLive = await waitUntilLive(`${SITE_URL}${key}.txt`, { expectBody: key, timeoutMs: 5 * 60 * 1000 });
    if (!keyLive) console.warn(`   ⚠️  File key ${SITE_URL}${key}.txt belum live — IndexNow kemungkinan menolak (403). Pastikan static/${key}.txt ter-commit dan ikut ter-deploy.`);
    if (newUrls.length) {
      const live = await waitUntilLive(newUrls[0], { timeoutMs: 8 * 60 * 1000 });
      if (!live) console.warn(`   ⚠️  ${newUrls[0]} belum bisa diakses setelah 8 menit — tetap dikirim, mesin pencari akan mencoba lagi.`);
    } else {
      await new Promise(r => setTimeout(r, 90000)); // only modified pages: no new URL to poll, give the deploy time
    }
  }

  const result = await submitToIndexNow(SITE_URL, urls);
  if (result.ok === false) console.warn('⚠️  Pengiriman IndexNow tidak berhasil sepenuhnya (lihat pesan di atas). Deploy tetap dianggap sukses.');
}

main().catch(err => { console.warn(`⚠️  indexnow-submit error (tidak menggagalkan deploy): ${err.message}`); });
