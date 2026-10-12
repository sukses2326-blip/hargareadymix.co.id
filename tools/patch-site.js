/**
 * tools/patch-site.js  —  run ONCE:  node tools/patch-site.js
 *
 * Applies small, anchored edits to big site files that are not shipped whole in this update
 * (so none of your existing markup/CSS/config is retyped):
 *
 *   hugo.toml AND config.toml (both are patched identically, if present)
 *     - [markup.goldmark.renderer] unsafe = true  (REQUIRED: generated tables are raw HTML)
 *     - "Blog" menu item -> /blog/
 *
 *   themes/saeseen-hugo/layouts/partials/head.html
 *     - meta description + og/twitter description use the front matter `description` when present
 *       (generated blog articles have one); other pages keep using .Summary as before
 *     - adds <meta property="article:modified_time"> (from `lastmod`)
 *     - adds BlogPosting JSON-LD for pages in the "blog" section (no fake Product/Service schema)
 *   themes/saeseen-hugo/layouts/_default/single.amp.html
 *     - same description rule
 *     - "Diperbarui" label (lastmod) next to the creation date
 *     - guard against indexing past the end of the related-pages list (would abort the build)
 *
 * Idempotent: a file that already contains "tools/patch-site.js" is skipped. A missing anchor is
 * reported (never silently ignored) and that file is left untouched.
 */
const fs   = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const MARK = 'tools/patch-site.js';

const BLOG_SCHEMA = `{{- else if eq .Section "blog" }}
  {{/* ${MARK}: BlogPosting schema for generated articles */}}
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "mainEntityOfPage": { "@type": "WebPage", "@id": {{ .Permalink | jsonify }} },
    "headline": {{ .Title | jsonify }},
    "description": {{ (or .Description (.Summary | plainify | truncate 160)) | jsonify }},
    "image": {{ (.Params.featured_image | absURL) | jsonify }},
    "datePublished": "{{ .Date.Format "2006-01-02T15:04:05Z07:00" }}",
    "dateModified": "{{ .Lastmod.Format "2006-01-02T15:04:05Z07:00" }}",
    "author": { "@type": "Person", "name": {{ .Site.Params.author | jsonify }} },
    "publisher": {
      "@type": "Organization",
      "name": {{ .Site.Title | jsonify }},
      "logo": { "@type": "ImageObject", "url": {{ (.Site.Params.footer_logo | absURL) | jsonify }} }
    }
  }
  </script>
`;

const TOML_EDITS = [
  { find: '    title = "Uditch"\n    url = "/uditch/"\n',
    repl: '    title = "Uditch"\n    url = "/uditch/"\n\n  [[params.menu_items]]\n    title = "Blog"\n    url = "/blog/"\n' },
  { find: '  [markup.tableOfContents]\n    startLevel = 1\n    endLevel = 3\n',
    repl: '  [markup.tableOfContents]\n    startLevel = 1\n    endLevel = 3\n\n  # Required by tools/lib/safe-table.js: AI-generated tables are rendered as raw HTML\n  # (<table class="table">), which Hugo only keeps when unsafe = true.\n  [markup.goldmark.renderer]\n    unsafe = true\n' },
];

const PATCHES = [
  { file: 'hugo.toml',   toml: true, edits: TOML_EDITS },
  { file: 'config.toml', toml: true, edits: TOML_EDITS },
  {
    file: 'themes/saeseen-hugo/layouts/partials/head.html',
    edits: [
      { find: '{{ else }}{{ .Summary | plainify | truncate 160 }}{{ end }}">',
        repl: '{{ else if .Description }}{{ .Description }}{{ else }}{{ .Summary | plainify | truncate 160 }}{{ end }}">' },
      { find: '{{- $ogDescription := cond .IsHome .Site.Params.meta_description (.Summary | plainify | truncate 160) -}}',
        repl: '{{- $ogDescription := cond .IsHome .Site.Params.meta_description (or .Description (.Summary | plainify | truncate 160)) -}}' },
      { find: '<meta property="og:description" content="{{ $ogDescription }}">',
        repl: '<meta property="og:description" content="{{ $ogDescription }}">\n{{ if .IsPage }}<meta property="article:modified_time" content="{{ .Lastmod.Format "2006-01-02T15:04:05Z07:00" }}">{{ end }}' },
      // Insert the blog branch right before the two closing {{- end }} that end the file.
      { regex: /(<\/script>\s*)(\{\{- end \}\}\s*\{\{- end \}\}\s*)$/, repl: (m, a, b) => `${a}${BLOG_SCHEMA}${b}` },
    ],
  },
  {
    file: 'themes/saeseen-hugo/layouts/_default/single.amp.html',
    edits: [
      { find: '<meta name="description" content="{{ .Summary | plainify | truncate 160 }}">',
        repl: '<meta name="description" content="{{ or .Description (.Summary | plainify | truncate 160) }}">' },
      { find: '{{- $ogDescription := .Summary | plainify | truncate 160 -}}',
        repl: '{{- $ogDescription := or .Description (.Summary | plainify | truncate 160) -}}' },
      { find: '<p class="post-meta">Dibuat pada {{ .Date.Format "2 January 2006" }} Oleh {{ .Site.Params.author }}</p>',
        repl: '<p class="post-meta">Dibuat pada {{ .Date.Format "2 January 2006" }}{{ if and (not .Lastmod.IsZero) (ne (.Lastmod.Format "2006-01-02") (.Date.Format "2006-01-02")) }} &middot; Diperbarui {{ .Lastmod.Format "2 January 2006" }}{{ end }} Oleh {{ .Site.Params.author }}</p>' },
      { find: '{{ if and (gt $count 3) (lt $relatedCount 3) }}',
        repl: '{{ if and (gt $count 3) (lt $relatedCount 3) (lt $relatedCount (len $shuffledRelated)) }}' },
    ],
  },
];

let failed = false;
for (const { file, edits, toml } of PATCHES) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) { console.log(`⚠️  ${file}: tidak ditemukan — dilewati.`); if (!toml) failed = true; continue; }
  let s = fs.readFileSync(full, 'utf8');
  const crlf = s.includes('\r\n');
  s = s.replace(/\r\n/g, '\n'); // anchors are written with \n; CRLF is restored on save
  if (s.replace(/\r\n/g, '\n').includes(MARK)) { console.log(`✓  ${file}: sudah dipatch.`); continue; }
  let ok = true;
  for (const e of edits) {
    if (e.find) {
      if (!s.includes(e.find)) { console.log(`❌ ${file}: anchor tidak ditemukan: ${e.find.slice(0, 70)}…`); ok = false; break; }
      s = s.replace(e.find, () => e.repl);
    } else {
      if (!e.regex.test(s)) { console.log(`❌ ${file}: akhir file tidak sesuai pola yang diharapkan.`); ok = false; break; }
      s = s.replace(e.regex, e.repl);
    }
  }
  if (!ok) { failed = true; continue; }
  if (!s.includes(MARK)) s = `${s.replace(/\s*$/, '')}\n${toml ? `# patched by ${MARK}` : `{{/* patched by ${MARK} */}}`}\n`;
  fs.writeFileSync(full, crlf ? s.replace(/\n/g, '\r\n') : s);
  console.log(`✅ ${file}: dipatch.`);
}
process.exit(failed ? 1 : 0);
