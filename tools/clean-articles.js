/**
 * tools/clean-articles.js
 *
 * One-off repair of artefacts that an earlier revise-articles.js run left in article bodies:
 *   1. "(not detected)" — a fake location name the model copied from the prompt
 *        "... untuk proyek Anda di (not detected)."   -> "... untuk proyek Anda."
 *        "Di wilayah (not detected), banyak pemilik"  -> "Banyak pemilik"
 *        "..., termasuk (not detected), karena Kami"   -> "..., karena Kami"
 *   2. "[[[PLACEHOLDER_N]]] ..." — a protection token that leaked into the text (rest of that line is dropped)
 *   3. "[Judul Artikel](URL)" — a literal "URL" link target; resolved to the real URL when the anchor
 *      text is exactly the title of an existing article, otherwise the link is reduced to plain text.
 * Only the BODY changes (front matter is byte-identical apart from `lastmod`). Default is DRY-RUN.
 *
 * USAGE:
 *   node tools/clean-articles.js                  → preview (which files/lines would change)
 *   node tools/clean-articles.js --apply          → write changes
 *   node tools/clean-articles.js --dir=content/blog
 */
const fs   = require('fs');
const path = require('path');
const FM   = require('./lib/frontmatter.js');
const { buildArticleIndex } = require('./lib/related-articles.js');

const ARGS  = process.argv.slice(2);
const APPLY = ARGS.includes('--apply');
const DIR   = (ARGS.find(a => a.startsWith('--dir=')) || '--dir=content').replace('--dir=', '');
const ROOT  = path.join(process.cwd(), 'content');
const SCAN  = path.join(process.cwd(), DIR);

const NOT_DETECTED = '\\(\\s*not detected\\s*\\)';

function walk(dir) {
  let out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out = out.concat(walk(full));
    else if (e.name.endsWith('.md') && e.name !== '_index.md') out.push(full);
  }
  return out;
}

const upperFirst = t => t.charAt(0).toUpperCase() + t.slice(1);

function cleanBody(body, titleToUrl) {
  let b = body;
  const counts = { notDetected: 0, token: 0, urlLink: 0 };

  // 1a. sentence-initial "Di/Pada (wilayah) (not detected), X" -> "X" (capitalised)
  b = b.replace(new RegExp(`(^|[.!?]\\s+|\\n)(?:Di|Pada)\\s+(?:wilayah\\s+)?${NOT_DETECTED},\\s*(\\S)`, 'g'),
    (m, pre, ch) => { counts.notDetected++; return pre + upperFirst(ch); });
  // 1b. ", termasuk (not detected)" / " di (wilayah) (not detected)" / bare "(not detected)"
  const patterns = [
    new RegExp(`,\\s*termasuk\\s+${NOT_DETECTED}`, 'gi'),
    new RegExp(`\\s+(?:di|pada)\\s+(?:wilayah\\s+)?${NOT_DETECTED}`, 'gi'),
    new RegExp(`\\s*${NOT_DETECTED}`, 'gi'),
  ];
  for (const re of patterns) b = b.replace(re, () => { counts.notDetected++; return ''; });
  b = b.replace(/ {2,}([,.;:!?])/g, '$1');                      // "proyek Anda ." -> "proyek Anda."

  // 2. leaked protection token: drop it and the rest of that line
  b = b.replace(/[ \t]*\[\[\[PLACEHOLDER_[^\]\n]*\]\]\][^\n]*/g, () => { counts.token++; return ''; });

  // 3. literal "(URL)" link targets
  b = b.replace(/(?<!!)\[([^\]]+)\]\(URL\)/g, (m, text) => {
    counts.urlLink++;
    const url = titleToUrl.get(text.trim().toLowerCase());
    return url ? `[${text}](${url})` : text;
  });
  return { body: b, counts };
}

const index = buildArticleIndex(ROOT);
const titleToUrl = new Map(index.map(a => [a.title.trim().toLowerCase(), a.url]));

let changed = 0;
for (const file of walk(SCAN)) {
  const raw = fs.readFileSync(file, 'utf8');
  const fm = FM.parse(raw);
  if (!fm.delim) continue;
  const { body, counts } = cleanBody(fm.body, titleToUrl);
  if (body === fm.body) continue;
  changed++;
  console.log(`${APPLY ? '✏️ ' : '👀'} ${path.relative(process.cwd(), file)} — "(not detected)": ${counts.notDetected}, token bocor: ${counts.token}, link "(URL)": ${counts.urlLink}`);
  if (APPLY) {
    const matter = FM.setLastmod(fm.rawMatter, new Date().toISOString().split('T')[0], fm.delim);
    fs.writeFileSync(file, FM.join(fm.delim, matter, body));
  }
}
console.log(`\n${changed} file ${APPLY ? 'diperbaiki' : 'akan diperbaiki (dry-run, jalankan lagi dengan --apply)'}.`);
