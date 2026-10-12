/**
 * tools/process-spintax.js
 *
 * Expands {option1|option2|...} spintax in `[[params.testimonials]]` (hugo.toml / config.toml)
 * and writes data/testimonials.yaml, which the theme's testimonial partial reads.
 * Runs automatically before every build via the "prebuild" npm script.
 */
const fs   = require('fs');
const path = require('path');
const toml = require('toml');
const yaml = require('js-yaml');

const ROOT = path.join(__dirname, '..');

function findConfigFile() {
  for (const name of ['hugo.toml', 'config.toml']) {
    const f = path.join(ROOT, name);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

function processSpintax(text) {
  if (typeof text !== 'string') return text;
  const regex = /\{([^{}]+)\}/g;
  let result = text, match;
  while ((match = regex.exec(result)) !== null) {
    const options = match[1].split('|');
    const replacement = options[Math.floor(Math.random() * options.length)];
    result = result.substring(0, match.index) + replacement + result.substring(match.index + match[0].length);
    regex.lastIndex = 0;
  }
  return result;
}

try {
  const configPath = findConfigFile();
  if (!configPath) throw new Error('hugo.toml / config.toml tidak ditemukan di root proyek.');
  console.log(`Menggunakan konfigurasi dari: ${configPath}`);

  const config = toml.parse(fs.readFileSync(configPath, 'utf8'));
  if (!config.params || !Array.isArray(config.params.testimonials)) {
    throw new Error('params.testimonials tidak ditemukan atau bukan array.');
  }

  const processed = config.params.testimonials.map(t => ({
    ...t,
    name: processSpintax(t.name),
    message: processSpintax(t.message),
    response: processSpintax(t.response),
  }));

  const dataDir = path.join(ROOT, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'testimonials.yaml'), yaml.dump({ testimonials: processed }));
  console.log(`Testimonials diproses (${processed.length}) dan data/testimonials.yaml dibuat.`);
} catch (error) {
  console.error('Terjadi kesalahan:', error.message);
  process.exit(1);
}
