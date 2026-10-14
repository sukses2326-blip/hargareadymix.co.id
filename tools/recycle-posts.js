/**
 * tools/recycle-posts.js
 *
 * Marks articles that are >= 12 months old (counted from `lastmod`, else `date`) as freshly
 * touched by setting `lastmod:` to today. `date: (the real publish date) is NEVER overwritten — the old root-level script did
 * that and every recycled article looked newly published. Hugo's sitemap uses `lastmod`.
 *
 * No Hugo build and no IndexNow ping happen here: recycle.yml dispatches deploy.yml, which builds
 * public/ and (after the site is live) pings IndexNow via tools/indexnow-submit.js.
 */
const fs   = require('fs');
const path = require('path');
const FM   = require('./lib/frontmatter.js');

const contentDir = path.join(__dirname, '..', 'content');
const now = new Date();

function walkMarkdownFiles(dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) results = results.concat(walkMarkdownFiles(fullPath));
    else if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== '_index.md') results.push(fullPath);
  }
  return results;
}

// Returns true when the file was recycled.
function recyclePost(filePath) {
  const parsed = FM.parse(fs.readFileSync(filePath, 'utf8'));
  if (!parsed.delim || parsed.data.draft) return null; // no front matter, or unpublished draft

  const postDate = new Date(parsed.data.date);
  if (!parsed.data.date || isNaN(postDate.getTime())) return null;

  const lastTouch = parsed.data.lastmod ? new Date(parsed.data.lastmod) : postDate;
  const reference = isNaN(lastTouch.getTime()) ? postDate : lastTouch;
  const monthsDiff = (now.getFullYear() - reference.getFullYear()) * 12 + now.getMonth() - reference.getMonth();
  if (monthsDiff < 12) return null;

  const newDate = now.toISOString().split('T')[0];
  fs.writeFileSync(filePath, FM.join(parsed.delim, FM.setLastmod(parsed.rawMatter, newDate, parsed.delim), parsed.body));
  return true;
}

const markdownFiles = walkMarkdownFiles(contentDir);
console.log(`📁 ${markdownFiles.length} .md files found in ${contentDir} (recursive).`);

let updated = 0;
for (const f of markdownFiles) if (recyclePost(f)) updated++;
console.log(updated ? `${updated} article(s) updated (lastmod).` : 'There are no articles that need to be updated.');
