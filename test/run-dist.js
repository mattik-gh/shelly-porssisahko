/**
 * Ajaa koko testisarjan koontiversiota (dist/shelly-porssisahko.js) vastaan.
 *
 * Simulaattoritestit ajavat muuten lähdekoodia (src/shelly-porssisahko.js). Laitteelle menee
 * kuitenkin pienennetty koontiversio, jossa let ja const on muutettu var-muotoon
 * (ks. shelly-builder.js). Tämä ajo varmistaa, että se toimii samoin.
 *
 * Koontiversion pitää olla tehty lähdekoodin viimeisimmistä muutoksista (npm run build).
 *
 * Käyttö: node test/run-dist.js (ajetaan osana npm test)
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist', 'shelly-porssisahko.js');

/** Uusin muokkausaika hakemiston tiedostoista (alihakemistot mukaan lukien) */
function newest(dir) {
  let t = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    t = Math.max(t, e.isDirectory() ? newest(p) : fs.statSync(p).mtimeMs);
  }
  return t;
}

if (!fs.existsSync(DIST)) {
  console.error('Koontiversiota ei ole. Tee ensin: npm run build');
  process.exit(1);
}

const src = Math.max(newest(path.join(ROOT, 'src')), fs.statSync(path.join(ROOT, 'shelly-builder.js')).mtimeMs);
if (fs.statSync(DIST).mtimeMs < src) {
  console.error('Koontiversio on vanhempi kuin lähdekoodi. Tee ensin: npm run build');
  process.exit(1);
}

console.log('\nTestit koontiversiota vastaan: dist/shelly-porssisahko.js\n');

const res = spawnSync(process.execPath, ['--test', 'test/*.test.js', 'test/addons/*.test.js'], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, SIM_MAIN: DIST }
});

process.exit(res.status ?? 1);
