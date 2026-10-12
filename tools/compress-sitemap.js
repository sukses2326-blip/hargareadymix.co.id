/**
 * tools/compress-sitemap.js — runs after `hugo --minify` (see "build" in package.json).
 * Writes public/robots.txt and public/sitemap.xml.gz.
 */
const fs   = require('fs');
const zlib = require('zlib');
const path = require('path');
const toml = require('toml');

const ROOT = path.join(__dirname, '..');
const configPath = ['hugo.toml', 'config.toml'].map(f => path.join(ROOT, f)).find(f => fs.existsSync(f));
const sitemapPath     = path.join(ROOT, 'public', 'sitemap.xml');
const sitemapGzipPath = path.join(ROOT, 'public', 'sitemap.xml.gz');
const robotsPath      = path.join(ROOT, 'public', 'robots.txt');

function getBaseUrl() {
  const config = toml.parse(fs.readFileSync(configPath, 'utf-8'));
  return config.baseURL.endsWith('/') ? config.baseURL.slice(0, -1) : config.baseURL;
}

function ensureRobotsTxt() {
  const baseUrl = getBaseUrl();
  // "Noindex" is NOT a valid robots.txt directive (Google ignores it) — use <meta name="robots">
  // or X-Robots-Tag for that. Google also only reads sitemap.xml from robots.txt, not .gz.
  const robotsContent = `User-agent: *
Allow: /

Disallow: /categories/*/page/
Disallow: /tags/*/page/
Disallow: /page/

Sitemap: ${baseUrl}/sitemap.xml`;
  fs.writeFileSync(robotsPath, robotsContent);
  console.log('robots.txt berhasil dibuat atau diperbarui.');
}

function compressSitemap() {
  if (!fs.existsSync(sitemapPath)) {
    console.error('sitemap.xml tidak ditemukan di public/. Pastikan Hugo build sudah selesai.');
    process.exit(1);
  }
  fs.createReadStream(sitemapPath).pipe(zlib.createGzip()).pipe(fs.createWriteStream(sitemapGzipPath))
    .on('finish', () => console.log('sitemap.xml berhasil dikompres menjadi sitemap.xml.gz'))
    .on('error', err => { console.error('Error saat mengompresi sitemap:', err); process.exit(1); });
}

ensureRobotsTxt();
compressSitemap();
