/**
 * tools/lib/content-url.js
 *
 * Works out the PUBLIC URL of a content/**\/*.md file the way Hugo would, so internal links
 * (generate / revise / fix-orphans) and IndexNow submissions never point at a 404.
 *
 * hargareadymix.co.id layout:
 *   content/blog/x.md          -> /blog/x/            (default: /<section>/<filename>/)
 *   content/readymix/x.md      -> /readymix/x/
 *   [permalinks] in hugo.toml  -> e.g. post = "/:slug/" makes content/post/x.md -> /x/
 *
 * Resolution order: front matter `url:` > [permalinks] pattern for the section > default path.
 * Supported permalink tokens: :slug (slug, else urlized title), :slugorfilename, :filename,
 * :title, :section, :sections. Anything fancier (dates, nested per-kind tables) falls back to
 * the default path.
 */

const fs   = require('fs');
const path = require('path');
const toml = require('toml');

const REPO_ROOT = path.join(__dirname, '..', '..');

let _permalinks = null;
function loadPermalinks() {
  if (_permalinks) return _permalinks;
  _permalinks = {};
  for (const name of ['hugo.toml', 'config.toml']) {
    const file = path.join(REPO_ROOT, name);
    if (!fs.existsSync(file)) continue;
    try {
      const cfg = toml.parse(fs.readFileSync(file, 'utf8'));
      if (cfg.permalinks && typeof cfg.permalinks === 'object') {
        for (const [k, v] of Object.entries(cfg.permalinks)) if (typeof v === 'string') _permalinks[k] = v;
      }
      break;
    } catch { /* unreadable config: fall back to default paths */ }
  }
  return _permalinks;
}

// Close enough to Hugo's urlize() for the Latin-script titles used on this site.
function urlize(text) {
  return String(text || '').toLowerCase().trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function normalize(url) {
  let u = String(url).trim();
  if (!u.startsWith('/')) u = '/' + u;
  if (!u.endsWith('/')) u += '/';
  return u.replace(/\/{2,}/g, '/');
}

// First folder under content/ ("blog", "readymix", ...). '' for files directly in content/.
function sectionOf(filePath, contentRoot) {
  const parts = path.relative(contentRoot, filePath).replace(/\\/g, '/').split('/');
  return parts.length > 1 ? parts[0] : '';
}

/**
 * @param {string} filePath    absolute path of the .md file
 * @param {string} contentRoot absolute path of content/
 * @param {{title?:string, slug?:string, url?:string}} data  parsed front matter (see frontmatter.js)
 */
function resolveUrl(filePath, contentRoot, data = {}) {
  if (data.url && !/^https?:/i.test(data.url)) return normalize(data.url);

  const parts = path.relative(contentRoot, filePath).replace(/\\/g, '/').replace(/\.md$/i, '').split('/');
  if (parts[parts.length - 1] === 'index') parts.pop(); // page bundle: content/x/y/index.md -> y
  const filename = parts[parts.length - 1] || '';
  const section  = parts.length > 1 ? parts[0] : '';
  const dirs     = parts.slice(0, -1);

  const pattern = loadPermalinks()[section];
  if (pattern) {
    const url = pattern
      .replace(/:slugorfilename/g, data.slug || filename)
      .replace(/:slug/g,           data.slug || urlize(data.title) || filename)
      .replace(/:filename/g,       filename)
      .replace(/:title/g,          urlize(data.title) || filename)
      .replace(/:sections/g,       dirs.join('/'))
      .replace(/:section/g,        section);
    if (!/:[a-z]/i.test(url)) return normalize(url);
  }

  return normalize([...dirs, data.slug || filename].join('/'));
}

module.exports = { resolveUrl, sectionOf, urlize, normalize };
