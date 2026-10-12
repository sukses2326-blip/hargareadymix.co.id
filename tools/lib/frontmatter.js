/**
 * tools/lib/frontmatter.js
 *
 * Small, dependency-free front matter helper shared by every tool in tools/.
 *
 * WHY NOT gray-matter EVERYWHERE: gray-matter only understands YAML ("---") by default. Hugo
 * sites often mix YAML ("---") and TOML ("+++") front matter. This helper reads simple scalar
 * fields (title, date, lastmod, slug, url, draft, focus_keyphrase, ...) from BOTH syntaxes with
 * regexes, and — most important — edits the raw front matter TEXT surgically (never a full
 * re-serialize), so a recycled / revised file stays byte-identical apart from `lastmod`.
 *
 * CONVENTION: `rawMatter` always INCLUDES its leading newline (same as gray-matter's `.matter`),
 * so a file is rebuilt as:  `${delim}${rawMatter}\n${delim}\n${body}`.
 */

// Returns { delim: '---' | '+++', rawMatter, body } or null when the file has no front matter.
function split(raw) {
  const m = raw.match(/^(---|\+\+\+)(\r?\n[\s\S]*?)\r?\n\1[ \t]*(?:\r?\n|$)([\s\S]*)$/);
  if (!m) return null;
  return { delim: m[1], rawMatter: m[2], body: m[3] || '' };
}

function join(delim, rawMatter, body) {
  return `${delim}${rawMatter}\n${delim}\n${body}`;
}

function unquote(v) {
  const t = String(v).trim();
  if (t.length >= 2 && ((t[0] === '"' && t[t.length - 1] === '"') || (t[0] === "'" && t[t.length - 1] === "'"))) {
    const inner = t.slice(1, -1);
    return t[0] === '"' ? inner.replace(/\\"/g, '"').replace(/\\\\/g, '\\') : inner.replace(/''/g, "'");
  }
  return t.replace(/\s+#.*$/, ''); // bare value: drop trailing "# comment"
}

// Reads ONE top-level scalar. Works for `key: value` (YAML) and `key = value` (TOML).
// Returns a string, a boolean for true/false, or undefined when the key is absent.
function getField(rawMatter, key) {
  const k = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = rawMatter.match(new RegExp(`^${k}[ \\t]*[:=][ \\t]*(.*?)[ \\t]*$`, 'm'));
  if (!m) return undefined;
  const v = unquote(m[1]);
  if (v === 'true') return true;
  if (v === 'false') return false;
  return v;
}

// Convenience: the fields the tools care about, parsed from a whole file's text.
function parse(raw) {
  const parts = split(raw);
  if (!parts) return { delim: null, rawMatter: '', body: raw, data: {} };
  const g = key => getField(parts.rawMatter, key);
  return {
    ...parts,
    data: {
      title: g('title') || '',
      date: g('date'),
      lastmod: g('lastmod'),
      slug: g('slug'),
      url: g('url'),
      draft: g('draft') === true,
      categories: g('categories'),
      focus_keyphrase: g('focus_keyphrase') || g('keywords') || '',
    },
  };
}

// Adds/updates `lastmod` inside the RAW front matter text. `date` (original publish date) is
// never touched. `delim` decides the syntax: TOML (+++) → `lastmod = "..."`, YAML → `lastmod: "..."`.
function setLastmod(rawMatter, newDate, delim = '---') {
  const line = delim === '+++' ? `lastmod = "${newDate}"` : `lastmod: "${newDate}"`;
  if (/^lastmod[ \t]*[:=].*$/m.test(rawMatter)) return rawMatter.replace(/^lastmod[ \t]*[:=].*$/m, line);
  if (/^date[ \t]*[:=].*$/m.test(rawMatter)) return rawMatter.replace(/^(date[ \t]*[:=].*)$/m, `$1\n${line}`);
  return `${rawMatter}\n${line}`;
}

module.exports = { split, join, getField, parse, setLastmod, unquote };
