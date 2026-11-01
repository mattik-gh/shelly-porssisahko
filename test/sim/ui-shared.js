/**
 * Käyttöliittymän yhteiset funktiot (t, tr, dur, drawChart, maskNum, msg, n, limit, feeAt, canon) tiedostosta src/statics/s.js testien käyttöön.
 * Funktiot otetaan lähdekoodista sellaisinaan (kommenttien shared-start ja shared-end väli).
 *
 * Käyttö: vm.createContext({ ...uiShared(), ... }) tai englanniksi uiShared('en')
 */
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', '..', 'src', 'statics');

/** Lukee käännökset tiedostoista en.js ja en-config.js (asetussivun tekstit) */
function translations() {
  return new Function(`let TR; ${fs.readFileSync(path.join(DIR, 'en.js'), 'utf8')}; ${fs.readFileSync(path.join(DIR, 'en-config.js'), 'utf8')}; return TR;`)();
}

function uiShared(lang = 'fi', doc = {}) {
  const source = fs.readFileSync(path.join(DIR, 's.js'), 'utf8');
  const match = /\/\* shared-start[\s\S]*?\/\* shared-end \*\//.exec(source);

  if (!match) {
    throw new Error('s.js: yhteistä osaa ei löydy');
  }

  const LANG = lang;
  const TR = lang == 'en' ? translations() : {};

  return { LANG, TR, ...new Function('LANG', 'TR', 'doc', `${match[0]}; return { t, tr, dur, drawChart, maskNum, msg, n, limit, feeAt, canon };`)(LANG, TR, doc) };
}

module.exports = { uiShared, translations };
