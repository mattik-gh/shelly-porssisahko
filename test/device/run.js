/**
 * Laitetesti: ajaa skriptin oikeassa Shelly-laitteessa ja tarkistaa perustoiminnot.
 *
 * Täydentää simulaattoritestejä asioilla, joita simulaattori ei näe: laitteen muisti,
 * tulkin erot (esim. Gen 2:n pieni kutsupino), oikeat releet ja oikea hintahaku.
 *
 * HUOM: VAIN KEHITYSLAITTEELLE, JOSSA EI OLE KUORMAA. Testi kytkee releitä päälle ja pois,
 * korvaa laitteen pörssisähköskriptin ja kirjoittaa sen asetuksia.
 *
 * Käyttö:
 *   node test/device/run.js <laitteen osoite> [valinnat]
 *
 *   --file <polku>   ladattava skripti (oletus dist/shelly-porssisahko.js, tee ensin npm run build)
 *   --clock          ajaa myös kellotestit (siirtää laitteen kelloa, kestää noin 3 min)
 *   --clock-only     ajaa vain käynnistyksen ja kellotestit
 *   --addon <nimi>   testaa lisäosaversion (dist/shelly-porssisahko-<nimi>.js) pääskriptin sijaan:
 *                    addon-temp, addon-temp-hours, ht-sensor-temp, open-meteo-api tai 1-instance-no-history
 *                    Lopuksi laitteeseen palautetaan tavallinen skripti (--file tai dist/shelly-porssisahko.js)
 *   --fresh          uusi asennus: poistaa ensin pörssisähkön skriptin ja kaikki asetukset (myös version 3.x),
 *                    ja tarkistaa, että tyhjään laitteeseen luodaan oletusasetukset
 *   --upgrade        päivitys: asentaa ensin alkuperäisen version 3.4.0 (test/fixtures) ja sille asetukset,
 *                    päivittää version 10 ja tarkistaa, että asetukset siirtyvät ja ohjaus toimii niillä
 *                    (ei yhdessä valinnan --addon kanssa)
 *                    Valinnoilla --fresh ja --upgrade kaikki asetukset palautetaan lopuksi ennalleen
 *   --dst            kellonsiirtotestit testirajapinnalla (kestää noin 12 min): asentaa toiseksi skriptiksi
 *                    test/device/fake-elering.js, joka vastaa Eleringin tavoin, ja lataa pääskriptistä kopion,
 *                    jossa hakuosoite on vaihdettu siihen. Kello siirretään seuraaviin kellonsiirtopäiviin, ja laitetta
 *                    verrataan simulaattoriin samoilla asetuksilla ja hinnoilla. Lopuksi testirajapinta poistetaan ja
 *                    tavallinen skripti palautetaan (julkaistavaa tiedostoa ei muuteta). Ei yhdessä muiden valintojen kanssa
 *   --yes            ei kysy vahvistusta (automaattiseen ajoon)
 *
 * Esimerkki:
 *   node test/device/run.js 192.168.1.50
 */

//Testiajo (node --test) käy läpi kaikki test-hakemiston tiedostot - tätä ei ajeta sen osana
if (process.env.NODE_TEST_CONTEXT) {
  process.exit(0);
}

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { uiShared } = require('../sim/ui-shared.js');
const readline = require('node:readline');

const ROOT = path.join(__dirname, '..', '..');
const NAME = 'shelly-porssisahko.js';
const args = process.argv.slice(2);
const HOST = args.find((a, i) => !a.startsWith('--') && !['--file', '--addon'].includes(args[i - 1]));
const ADDON = args.includes('--addon') ? args[args.indexOf('--addon') + 1] : null;
const ADDON_FILE = ADDON ? path.join(ROOT, 'dist', `shelly-porssisahko-${ADDON}.js`) : null;
const FILE = args.includes('--file') ? args[args.indexOf('--file') + 1] : path.join(ROOT, 'dist', NAME);
const CLOCK_ONLY = args.includes('--clock-only');
const CLOCK = args.includes('--clock') || CLOCK_ONLY;
const YES = args.includes('--yes');
const FRESH = args.includes('--fresh');
const UPGRADE = args.includes('--upgrade');
const ORIG_FILE = path.join(__dirname, '..', 'fixtures', 'shelly-porssisahko-3.4.0.js');
const DST = args.includes('--dst');
/** Kellonsiirtotestien testirajapinta (valinta --dst) */
const FAKE_FILE = path.join(__dirname, 'fake-elering.js');
const FAKE_NAME = 'elering-testirajapinta';
let fakeId = null;

if (DST && (ADDON || FRESH || UPGRADE || CLOCK)) {
  console.error('Valintaa --dst ei voi käyttää muiden testivalintojen kanssa');
  process.exit(1);
}

if (FRESH && UPGRADE) {
  console.error('Valitse joko --fresh tai --upgrade');
  process.exit(1);
}
if (UPGRADE && ADDON) {
  console.error('Valintaa --upgrade ei voi käyttää lisäosaversion kanssa');
  process.exit(1);
}

if (!HOST) {
  console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^\/\*\*\n?/, '').replace(/^ \* ?/gm, ''));
  process.exit(1);
}

const BASE = `http://${HOST.replace(/^https?:\/\//, '').replace(/\/$/, '')}`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, '0');
const fmt = (e) => { const d = new Date(e * 1000); return `${d.getDate()}.${d.getMonth() + 1}. ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };

//-------------------------------------------------------------------------
// Yhteys laitteeseen
//-------------------------------------------------------------------------
let scriptId = 1;
/** Laitteen tiedot (Shelly.GetDeviceInfo) - luetaan ajon alussa */
let info;

async function rpc(method, params) {
  const res = await fetch(`${BASE}/rpc`, { method: 'POST', body: JSON.stringify({ id: 1, method, params }) });
  const json = await res.json();
  if (json.error) {
    const err = new Error(`${method}: ${JSON.stringify(json.error)}`);
    err.code = json.error.code;
    throw err;
  }
  return json.result;
}

/** Pyyntö skriptille. Odottaa, jos skriptin suoritus on aktiivinen (503) */
async function get(query, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`${BASE}/script/${scriptId}?${query}`);
      if (res.status !== 503) {
        return res;
      }
    } catch (e) { }
    await sleep(300);
  }
  throw new Error(`skripti ei vastaa: ${query}`);
}

async function state(inst = 0) {
  for (let i = 0; i < 60; i++) {
    const res = await get(`r=s&i=${inst}`);
    if (res.status === 200) {
      return res.json();
    }
    await sleep(300);
  }
  throw new Error('tilaa ei saatu');
}

const scriptStatus = () => rpc('Script.GetStatus', { id: scriptId });
const unpack = (b64) => { const raw = Buffer.from(b64, 'base64'); const res = []; for (let i = 0; i < raw.length; i += 3) res.push((raw[i] << 16 | raw[i + 1] << 8 | raw[i + 2]) - 8388608); return res; };

/** Odottaa, kunnes ehto täyttyy. Palauttaa viimeisimmän arvon (tai null, jos aika loppui) */
async function waitFor(read, pred, timeoutMs = 20000, stepMs = 500) {
  const end = Date.now() + timeoutMs;
  let value;
  do {
    try { value = await read(); if (pred(value)) return value; } catch (e) { }
    await sleep(stepMs);
  } while (Date.now() < end);
  return null;
}

//-------------------------------------------------------------------------
// Tulokset
//-------------------------------------------------------------------------
let passed = 0;
let failed = [];
let group = '';

function section(name) {
  group = name;
  console.log(`\n== ${name}`);
}

function check(name, ok, info = '') {
  if (ok) {
    passed++;
  } else {
    failed.push(`${group}: ${name}${info !== '' ? ' (' + info + ')' : ''}`);
  }
  console.log(`${ok ? '  ok   ' : '  VIRHE'} ${name}${info !== '' ? ' - ' + info : ''}`);
  return ok;
}

function note(text) {
  console.log(`         ${text}`);
}

//-------------------------------------------------------------------------
// Laitteen tila ja asetukset
//-------------------------------------------------------------------------
//Asetukset ovat KVS:ssä arvojen listana avaimissa porssisahko ja porssisahko-1... (ks. pack() skriptissä)
//Version 3.x avaimiin (porssi...) skripti ei kirjoita, joten niitä ei tarvitse varmuuskopioida
const KEYS = ['porssisahko', 'porssisahko-1', 'porssisahko-2', 'porssisahko-3'];
//Version 3.x avaimet: valinnat --fresh ja --upgrade poistavat ja kirjoittavat myös niitä
const OLD_KEYS = ['porssi', 'porssi-1', 'porssi-2', 'porssi-3'];
const BACKUP_KEYS = FRESH || UPGRADE ? KEYS.concat(OLD_KEYS) : KEYS;
const { kvsPack, kvsUnpack, kvsSwap, createSim, ELERING_URL } = require('../sim/shelly-sim');
const DEF = { en: 0, mode: 0, m0: { c: 0 }, m1: { l: 0 }, m2: { p: 24, c: 0, l: -999, s: 0, m: 999, ps: 0, pe: 23, ps2: 0, pe2: 23, c2: 0, s2: 0 }, b: 0, e: 0, o: [0], f: 0, fc: 0, i: 0, m: 60, oc: 0, q: 0 };
let switches = [];

async function kvsGet(key) {
  try { return (await rpc('KVS.Get', { key })).value; } catch (e) { return null; }
}

async function relays() {
  const res = [];
  for (const id of switches) res.push((await rpc('Switch.GetStatus', { id })).output ? 1 : 0);
  return res.join('');
}

/** Releiden odotettu tila merkkijonona, kun annetut lähdöt ovat päällä ja muut pois (esim. on(0) -> "100") */
const on = (...ids) => switches.map(id => ids.includes(id) ? 1 : 0).join('');

/** Odottaa, että releet ovat halutussa tilassa (esim. "10") */
async function expectRelays(name, expected, timeoutMs = 12000) {
  const value = await waitFor(relays, v => v === expected, timeoutMs, 400);
  return check(name, value === expected, value === expected ? '' : `releet ${await relays()}, odotettu ${expected}`);
}

/** Kirjoittaa ohjauksen asetukset (oletukset + muutokset) ja pyytää skriptiä lataamaan ne */
async function cfg(inst, patch) {
  const c = JSON.parse(JSON.stringify(DEF));
  for (const k in patch) c[k] = (typeof patch[k] === 'object' && !Array.isArray(patch[k])) ? Object.assign({}, c[k], patch[k]) : patch[k];
  const before = (await state(inst)).si;
  await rpc('KVS.Set', { key: `porssisahko-${inst + 1}`, value: kvsPack(inst, c) });
  const res = await get(`r=r&i=${inst}`);
  if (res.status !== 204) throw new Error(`asetusten latauspyyntö: ${res.status}`);

  //Odotetaan, että asetukset ovat voimassa ja logiikka on ajettu niillä (tai ohjaus ei ole käytössä)
  const want = JSON.stringify(c);
  await waitFor(() => state(inst), st => st.ci && JSON.stringify(st.ci) === want && (!c.en || (st.si.chkTs > 0 && st.si.chkTs !== before.chkTs)), 12000, 400);
  await sleep(600);
  return c;
}

async function common(patch) {
  const c = Object.assign(kvsUnpack(-1, await kvsGet('porssisahko')), patch);
  await rpc('KVS.Set', { key: 'porssisahko', value: kvsPack(-1, c) });
  await get('r=r');
  await waitFor(() => state(0), st => Object.keys(patch).every(k => JSON.stringify(st.c[k]) === JSON.stringify(patch[k])), 15000, 400);
  await sleep(1500);
}

/** Tilasivun laskema suunnitelma laitteen tilasta (sama koodi kuin selaimessa): rivit { t: 'hh:mm', on } */
function plan(st) {
  const elements = {};
  const src = fs.readFileSync(path.join(ROOT, 'src', 'statics', 'tab-status.js'), 'utf8');
  const s = JSON.parse(JSON.stringify(st));
  s.p = st.p.map(unpack);
  const now = st.t * 1000;
  class FixedDate extends Date { constructor(...a) { if (a.length === 0) super(now); else super(...a); } }
  const ctx = vm.createContext({
      ...uiShared(),
    state: s, inst: 0, CBS: [], Date: FixedDate, console,
    qs: (id) => elements[id] ?? (elements[id] = { innerHTML: '', style: {} }),
    MODE_STR: ['a', 'b', 'c'], STATE_STR: new Array(14).fill('tila'),
    formatTime: (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`, formatDateTime: (d) => d.toISOString()
  });
  vm.runInContext(src, ctx);
  return (elements['s-pa'].innerHTML + elements['s-pb'].innerHTML).split('<tr style=').slice(1)
    .map(r => ({ t: r.match(/class="fit">(\d\d:\d\d)/)[1], on: /&#x2714;/.test(r), now: r.includes('font-weight:bold') }));
}

//-------------------------------------------------------------------------
// Testit
//-------------------------------------------------------------------------
/** Korvaa laitteen pörssisähköskriptin annetulla koodilla ja käynnistää sen */
async function uploadCode(code) {
  for (const s of (await rpc('Script.List')).scripts.filter(s => s.name === NAME)) {
    if (s.running) await rpc('Script.Stop', { id: s.id });
    await rpc('Script.Delete', { id: s.id });
  }

  scriptId = (await rpc('Script.Create', { name: NAME })).id;
  for (let pos = 0; pos < code.length; pos += 1024) {
    await rpc('Script.PutCode', { id: scriptId, code: code.substring(pos, pos + 1024), append: pos > 0 });
  }
  await rpc('Script.SetConfig', { id: scriptId, config: { enable: true } });
  await rpc('Script.Start', { id: scriptId });
}

async function testStart(file, code = null) {
  section('Lataus ja käynnistys');
  code = code ?? fs.readFileSync(file, 'utf8');
  await uploadCode(code);
  check(`skripti ladattu (${path.basename(file)}, ${code.length} merkkiä, id ${scriptId})`, true);

  const afternoon = new Date().getHours() >= 15;
  //Odotetaan myös, että ohjauksen #1 asetukset on luettu (ja uudessa asennuksessa tallennettu):
  //ne luetaan vasta hintahaun jälkeen
  const st = await waitFor(() => state(0), s => s.s.p[0].ts > 0 && (!afternoon || s.s.p[1].ts > 0 || s.s.errTot > 0) && s.si.configOK == 1, 60000, 1500);
  const m = await scriptStatus();

  if (!check('skripti käynnissä', m.running === true, m.running ? '' : JSON.stringify(m.errors || m).substring(0, 200)) || !st) {
    check('tämän päivän hinnat haettu', false, 'tilaa ei saatu');
    return false;
  }

  const today = unpack(st.p[0]);
  check('versio', /^\d+\.\d+\.\d+$/.test(st.s.v), st.s.v);
  check('kellonaika tiedossa', st.s.timeOK === true);
  //Skriptin Date käyttää kaikille päivämäärille nykyistä aikavyöhykkeen poikkeamaa (mitattu laiteohjelmistolla 2.0.1),
  //vaikka laite itse noudattaa kesäaikaa. Skripti (jaksojen rajat kellonsiirtopäivinä, _off) ja simulaattori olettavat tämän.
  //Tarkistus: 15.1. ja 15.7. (talvi- ja kesäaika) näkyvät samalla poikkeamalla. Jos laiteohjelmisto alkaa käyttää
  //aikavyöhykesääntöjä, poikkeamat eroavat ja tarkistus epäonnistuu
  const jan = Date.UTC(2026, 0, 15, 12), jul = Date.UTC(2026, 6, 15, 12);
  const tz = JSON.parse((await rpc('Script.Eval', { id: scriptId, code: `JSON.stringify([new Date(${jan}).toString(), new Date(${jul}).toString()])` })).result)
    .map(t => t.substring(t.indexOf('GMT')));
  check('skriptin päivämäärät nykyisellä aikavyöhykkeen poikkeamalla (oletus)', tz[0] === tz[1],
    tz[0] === tz[1] ? `15.1. ja 15.7. ${tz[0]}`
      : `15.1. ${tz[0]}, 15.7. ${tz[1]}: skriptin Date käyttää nyt aikavyöhykesääntöjä - tarkista jaksojen rajat kellonsiirtopäivinä (_off skriptissä ja tilasivulla) ja simulaattorin SimDate`);
  check('tämän päivän hinnat haettu', today.length * st.s.p[0].sl >= 23 * 3600, `${today.length} jaksoa, jakso ${st.s.p[0].sl} s, haettu ${fmt(st.s.p[0].ts)}`);
  if (afternoon) check('huomisen hinnat haettu (kello on yli 15)', unpack(st.p[1]).length > 0, `${unpack(st.p[1]).length} jaksoa`);
  check('hintahaussa ei virheitä', st.s.errTot === 0, `virheitä ${st.s.errTot}`);
  check('skriptimuistin koko', m.mem_used + m.mem_free > 20000, `käytössä ${m.mem_used} + vapaana ${m.mem_free} = ${m.mem_used + m.mem_free} tavua`);
  check('muistihuippu alle 22 000 tavua', m.mem_peak < 22000, `huippu ${m.mem_peak}, käytössä ${m.mem_used}`);
  //Yleiset asetukset ja ohjaus #1 ovat aina olemassa (ohjaukset #2 ja #3 vain, jos ne ovat käytössä)
  check('asetukset luotu', (await Promise.all(KEYS.slice(0, 2).map(kvsGet))).every(v => typeof v === 'string' && v.startsWith('[1,')));
  return true;
}

/** Poistaa pörssisähkön asetukset (myös version 3.x) - valinnat --fresh ja --upgrade */
async function clearSettings() {
  for (const s of (await rpc('Script.List')).scripts.filter(s => s.name === NAME)) {
    if (s.running) await rpc('Script.Stop', { id: s.id });
  }
  for (const key of KEYS.concat(OLD_KEYS)) {
    if (await kvsGet(key) !== null) await rpc('KVS.Delete', { key });
  }
}

/** Uusi asennus: tarkistukset käynnistyksen jälkeen (valinta --fresh) */
async function testFresh() {
  section('Uusi asennus tyhjään laitteeseen');
  const st = await state(0);
  check('yksi ohjaus käytössä', st.c.cnt === 1, `cnt ${st.c.cnt}`);
  check('ohjauksen #1 asetukset ovat oletusarvot', JSON.stringify(st.ci) === JSON.stringify(DEF), JSON.stringify(st.ci));
  const v = {};
  for (const key of KEYS.concat(OLD_KEYS)) v[key] = await kvsGet(key);
  check('yleiset asetukset ja ohjaus #1 tallennettu', [v['porssisahko'], v['porssisahko-1']].every(x => typeof x === 'string' && x.startsWith('[1,')));
  check('ohjauksille #2 ja #3 ei luotu asetuksia', v['porssisahko-2'] === null && v['porssisahko-3'] === null);
  check('version 3.x avaimiin ei kirjoitettu', OLD_KEYS.every(k => v[k] === null));
}

/** Version 3.4.0 asetukset (JSON, asetusten nimillä) - todenmukaiset arvot kaikille ohjaustavoille */
function oldSettings() {
  const two = switches.length > 1;
  const m2 = { p: 24, c: 0, l: -999, s: 0, m: 999, ps: 0, pe: 23, ps2: 0, pe2: 23, c2: 0 };
  return {
    common: { g: 'fi', vat: 25.5, day: 4.1, night: 2.35, names: ['Lämminvesivaraaja', 'Kiuas ÄÖ', '-'] },
    inst: [
      //Halvimmat tunnit kahdella omalla jaksolla, peräkkäiset, hintarajat, varmuustunnit 2-4 ja 18, pakko-ohjaus 5-6 päälle ja 20 pois
      { en: 1, mode: 2, m0: { c: 0 }, m1: { l: 0 }, m2: { p: -2, c: 3, l: -1.5, s: 1, m: 25.5, ps: 0, pe: 7, ps2: 7, pe2: 24, c2: 2 }, b: (1 << 2) | (1 << 3) | (1 << 4) | (1 << 18), e: 1, o: [switches[0]], f: (1 << 5) | (1 << 6) | (1 << 20), fc: (1 << 5) | (1 << 6), i: 0, m: 60, oc: 0 },
      //Hintaraja, käänteinen, 30 min, "aina" (käytössä vain, jos laitteessa on toinen lähtö)
      { en: two ? 1 : 0, mode: 1, m0: { c: 0 }, m1: { l: 4.25 }, m2: Object.assign({}, m2), b: 0, e: 0, o: [two ? switches[1] : switches[0]], f: 0, fc: 0, i: 1, m: 30, oc: 1 },
      //Käsiohjaus, pois käytöstä
      { en: 0, mode: 0, m0: { c: 1 }, m1: { l: 0 }, m2: Object.assign({}, m2), b: 0, e: 0, o: [switches[0]], f: 0, fc: 0, i: 0, m: 60, oc: 0 }
    ]
  };
}

/** Päivitys: asentaa version 3.4.0 ja sille asetukset (valinta --upgrade). Palauttaa avainten arvot, jotka 3.4.0 tallensi */
async function installOld() {
  section('Alkuperäinen versio 3.4.0');
  const old = oldSettings();
  await uploadCode(fs.readFileSync(ORIG_FILE, 'utf8'));
  let st = await waitFor(() => state(0), s => s.s.v === '3.4.0' && s.s.configOK && s.si.configOK, 60000, 1500);
  check('versio 3.4.0 käynnissä', !!st, st ? '' : JSON.stringify((await scriptStatus()).errors || ''));

  //Laite laskee pituuteen lainausmerkit kahtena (ks. README, Mihin asetukset tallentuvat?)
  const values = [JSON.stringify(old.common)].concat(old.inst.map(c => JSON.stringify(c)));
  const lengths = values.map(v => Buffer.byteLength(JSON.stringify(v)) - 2);
  check('asetukset mahtuvat version 3.4.0 rajaan (253)', lengths.every(l => l <= 253), lengths.join(', '));
  for (let i = 0; i < OLD_KEYS.length; i++) {
    await rpc('KVS.Set', { key: OLD_KEYS[i], value: values[i] });
  }
  //Uudelleenkäynnistys lukee kaikki asetukset (3.4.0 kaatuu pyyntöön r=r ilman ohjauksen numeroa)
  await rpc('Script.Stop', { id: scriptId });
  await rpc('Script.Start', { id: scriptId });
  st = await waitFor(() => Promise.all([0, 1, 2].map(state)), a => a.every((s, i) => s.si.configOK && JSON.stringify(s.ci) === JSON.stringify(old.inst[i])), 30000, 1500);
  check('versio 3.4.0 käyttää asetuksia', !!st);

  const stored = {};
  for (const key of OLD_KEYS) stored[key] = await kvsGet(key);
  return stored;
}

/** Päivitys: tarkistukset version 10 käynnistyttyä version 3.4.0 asetuksilla (valinta --upgrade) */
async function testUpgrade(stored) {
  section('Päivitys versiosta 3.4.0');
  const old = oldSettings();
  const all = await waitFor(() => Promise.all([0, 1, 2].map(state)), a => a.every(s => s.si.configOK == 1), 30000, 1500);
  if (!check('kaikkien ohjausten asetukset luettu', !!all)) {
    return;
  }
  const c = all[0].c;
  check('kolme ohjausta käytössä (version 3.x asetuksissa ei ole määrää)', c.cnt === 3, `cnt ${c.cnt}`);
  check('yleiset asetukset siirtyivät', ['g', 'vat', 'day', 'night', 'names'].every(k => JSON.stringify(c[k]) === JSON.stringify(old.common[k])), JSON.stringify(c));
  check('historian pituus on oletus', c.hist === 24, `hist ${c.hist}`);

  for (let i = 0; i < 3; i++) {
    const ci = all[i].ci;
    const want = Object.assign({}, old.inst[i], { m2: Object.assign({}, old.inst[i].m2, { s2: old.inst[i].m2.s }), q: 0 });
    check(`ohjauksen #${i + 1} asetukset siirtyivät (uudet: tarkkuus tunti, jakson 2 peräkkäisyys kuten jaksolla 1)`, JSON.stringify(ci) === JSON.stringify(want), JSON.stringify(ci));
    const v = await kvsGet(KEYS[i + 1]);
    check(`ohjaus #${i + 1} tallennettu uuteen avaimeen`, typeof v === 'string' && v.startsWith('[1,') && JSON.stringify(kvsUnpack(i, v)) === JSON.stringify(ci), v);
  }
  check('yleiset asetukset tallennettu uuteen avaimeen', JSON.stringify(kvsUnpack(-1, await kvsGet('porssisahko'))) === JSON.stringify(c));

  //Ohjaus toimii siirretyillä asetuksilla
  for (let i = 0; i < 2; i++) {
    if (!old.inst[i].en) continue;
    const st = await waitFor(() => state(i), s => s.si.chkTs > 0, 30000, 1000);
    const out = switches.indexOf(old.inst[i].o[0]);
    const r = await relays();
    check(`ohjaus #${i + 1} ajettu ja lähtö ${old.inst[i].o[0]} ohjauksen mukaan`, !!st && r[out] === (st.si.cmd ? '1' : '0'), st ? `tila ${st.si.st}, ohjaus ${st.si.cmd}, releet ${r}` : 'logiikkaa ei ajettu');
  }

  //Tallennus menee uuteen avaimeen
  const res = await get('r=w&i=0&m2.c=4');
  const saved = await waitFor(() => kvsGet('porssisahko-1'), v => v && kvsUnpack(0, v).m2.c === 4, 15000, 1000);
  check('asetuksen muutos tallentuu uuteen avaimeen', res.status === 204 && !!saved, `vastaus ${res.status}`);

  let same = true;
  for (const key of OLD_KEYS) same = same && (await kvsGet(key)) === stored[key];
  check('version 3.x avaimet ennallaan (paluu versioon 3.x mahdollinen)', same);
  check('skripti käynnissä', (await scriptStatus()).running === true);
}

async function testPages() {
  section('Rajapinta ja sivut');
  const types = { '': 'text/html', 'r=s.js': 'text/javascript', 'r=s.css': 'text/css', 'r=status': 'text/html', 'r=status.js': 'text/javascript', 'r=history': 'text/html', 'r=history.js': 'text/javascript', 'r=config': 'text/html', 'r=config.js': 'text/javascript', 'r=en.js': 'text/javascript', 'r=en-config.js': 'text/javascript' };
  let ok = true;
  let sizes = [];

  for (const q in types) {
    const res = await get(q);
    const body = await res.text();
    const good = res.status === 200 && (res.headers.get('content-type') || '').startsWith(types[q]) && body.length > 100;
    if (!good) note(`${q || '(etusivu)'}: ${res.status} ${res.headers.get('content-type')} ${body.length} merkkiä`);
    ok = ok && good;
    sizes.push(body.length);
  }
  check(`kaikki ${sizes.length} sivun tiedostoa latautuvat ja purkautuvat`, ok, `yhteensä ${sizes.reduce((a, b) => a + b, 0)} merkkiä purettuna`);

  const st = await state(0);
  check('tila: kentät', ['c', 'ci', 'm', 'p', 's', 'si', 't'].every(k => k in st));
  check('tila: hinnat ovat pakattuja (3 tavua per jakso)', st.p.every(p => Buffer.from(p, 'base64').length % 3 === 0));
  const sys = await rpc('Sys.GetStatus');
  check('tila: laitteen kellonaika', Math.abs(st.t - sys.unixtime) <= 3, `ero ${st.t - sys.unixtime} s`);
  check('asetukset (r=c)', (await (await get('r=c')).json()).g !== undefined && (await (await get('r=c&i=0')).json()).mode !== undefined);
  check('historia (r=h) on base64-merkkijono', typeof (await (await get('r=h&i=0')).json()) === 'string');
  check('tuntematon pyyntö palauttaa 404', (await get('r=xyz')).status === 404);
  check('ohjaus, jota ei ole, palauttaa vain yleisen tilan', !('si' in await (await get('r=s&i=9')).json()));
  const m = await scriptStatus();
  check('skripti käynnissä sivulatausten jälkeen', m.running, `muistihuippu ${m.mem_peak}`);
}

async function testConfig() {
  section('Asetusten tallennus ja lataus');
  const orig = kvsUnpack(-1, await kvsGet('porssisahko'));

  //Asetusten lataus hintojen ollessa muistissa (Gen 2:ssa tämä kaatoi skriptin: liian syvä kutsupino)
  await common({ vat: 10, day: 3, night: 1 });
  let st = await state(0);
  check('ALV:n ja siirtomaksujen muutos tulee voimaan', st.c.vat === 10 && st.c.day === 3);
  const prices = unpack(st.p[0]);
  const lowest = Math.min(...prices) / 1000;
  check('keskihinta lasketaan uudelleen ilman hintahakua', st.s.p[0].avg >= 1 && st.s.p[0].low >= (lowest > 0 ? lowest * 1.1 : lowest) + 1 - 0.001, `keskihinta ${st.s.p[0].avg.toFixed(2)}, halvin ${st.s.p[0].low.toFixed(2)}`);
  for (let i = 0; i < 3; i++) { await get('r=r'); await sleep(2500); }
  check('kolme peräkkäistä latausta: skripti käynnissä', (await scriptStatus()).running === true);
  await common({ vat: orig.vat, day: orig.day, night: orig.night });

  //Ohjausten määrä
  const mem = {};
  for (const cnt of [1, 3]) {
    await common({ cnt });
    await sleep(2500);
    mem[cnt] = (await scriptStatus()).mem_used;
  }
  check('ohjausten määrä 1 vie vähemmän muistia kuin 3', mem[1] < mem[3], `1: ${mem[1]} tavua, 3: ${mem[3]} tavua`);
  await common({ cnt: 1 });
  check('ohjaus #2 ei ole käytössä, kun määrä on 1', !('si' in await (await get('r=s&i=1')).json()));
  await common({ cnt: 3 });

  //Virheelliset asetukset eivät saa pysäyttää skriptiä
  const good = kvsUnpack(0, await kvsGet('porssisahko-1'));
  await rpc('KVS.Set', { key: 'porssisahko-1', value: '[1,1,0,[1]' });
  await get('r=r&i=0');
  await sleep(4000);
  check('rikkinäinen JSON asetuksissa: skripti käynnissä', (await scriptStatus()).running === true);
  st = await state(0);
  check('rikkinäinen JSON asetuksissa: aiemmat asetukset voimassa', st.ci.mode === good.mode && st.ci.en === good.en && JSON.stringify(st.ci.o) === JSON.stringify(good.o));

  //Listassa jakson asetusten (m2) tilalla null ja lähtölistan tilalla luku
  const bad = JSON.parse(kvsSwap(kvsPack(0, good)));
  bad[5] = null;
  bad[8] = 5;
  await rpc('KVS.Set', { key: 'porssisahko-1', value: kvsSwap(JSON.stringify(bad)) });
  await get('r=r&i=0');
  await sleep(4000);
  st = await state(0);
  check('väärän tyyppiset arvot (o, m2) korvataan', (await scriptStatus()).running === true && Array.isArray(st.ci.o) && typeof st.ci.m2 === 'object' && st.ci.m2 !== null, `o ${JSON.stringify(st.ci.o)}`);

  await rpc('KVS.Set', { key: 'porssisahko-1', value: kvsPack(0, Object.assign({}, good, { mode: 2, en: 1, o: [], m2: Object.assign({}, DEF.m2, { p: 0, c: 2 }) })) });
  await get('r=r&i=0');
  await sleep(5000);
  st = await state(0);
  check('jakson pituus 0 ei jumita skriptiä', (await scriptStatus()).running === true && st.ci.m2.p === 24, `jakson pituus ${st.ci.m2.p}`);
  await cfg(0, { en: 0 });
}

async function testRelays() {
  section(`Releohjaukset (lähdöt ${switches.join(', ')})`);
  const a = switches[0];
  //Ohjauksia on enintään kolme ja yhdellä ohjauksella enintään neljä lähtöä
  const insts = Math.min(3, switches.length);
  const outs = switches.slice(0, 4);

  for (const id of switches) await rpc('Switch.Set', { id, on: false });

  await cfg(0, { en: 1, mode: 0, m0: { c: 1 }, o: [a] });
  await expectRelays(`käsiohjaus päälle, lähtö ${a}`, on(a));
  await cfg(0, { en: 1, mode: 0, m0: { c: 0 }, o: [a] });
  await expectRelays(`käsiohjaus pois, lähtö ${a}`, on());
  await cfg(0, { en: 1, mode: 0, m0: { c: 0 }, o: [a], i: 1 });
  await expectRelays('käänteinen ohjaus', on(a));
  await cfg(0, { en: 1, mode: 0, m0: { c: 0 }, o: [a] });
  await expectRelays('käänteinen pois päältä', on());

  if (switches.length >= 2) {
    //Yksi ohjaus ohjaa kaikkia lähtöjä
    await cfg(0, { en: 1, mode: 0, m0: { c: 1 }, o: outs });
    await expectRelays(`yksi ohjaus, ${outs.length} lähtöä päälle`, on(...outs));
    await cfg(0, { en: 1, mode: 0, m0: { c: 0 }, o: outs });
    await expectRelays(`yksi ohjaus, ${outs.length} lähtöä pois`, on());

    //Jokaisella ohjauksella oma lähtönsä: kytketään yksi kerrallaan päälle ja tarkistetaan, ettei muihin kosketa
    for (let i = 0; i < insts; i++) {
      await cfg(i, { en: 1, mode: 0, m0: { c: 0 }, o: [switches[i]] });
    }
    await expectRelays(`${insts} ohjausta omilla lähdöillään, kaikki pois`, on());

    for (let i = 0; i < insts; i++) {
      await cfg(i, { en: 1, mode: 0, m0: { c: 1 }, o: [switches[i]] });
      await expectRelays(`ohjaus #${i + 1} päälle: vain lähtö ${switches[i]} päällä`, on(switches[i]));
      await cfg(i, { en: 1, mode: 0, m0: { c: 0 }, o: [switches[i]] });
    }

    //Kaikki ohjaukset päälle yhtä aikaa ja pois käänteisessä järjestyksessä
    for (let i = 0; i < insts; i++) {
      await cfg(i, { en: 1, mode: 0, m0: { c: 1 }, o: [switches[i]] });
    }
    await expectRelays(`${insts} ohjausta päällä yhtä aikaa`, on(...switches.slice(0, insts)));

    for (let i = insts - 1; i >= 1; i--) {
      await cfg(i, { en: 0 });
      await rpc('Switch.Set', { id: switches[i], on: false });
    }
    await cfg(0, { en: 1, mode: 0, m0: { c: 0 }, o: [a] });
    await expectRelays('muut ohjaukset pois käytöstä, kaikki lähdöt pois', on());
  }

  //Lähtö, jota laitteessa ei ole
  await cfg(0, { en: 1, mode: 0, m0: { c: 1 }, o: [a, 99] });
  await expectRelays('olemassa oleva ja olematon lähtö: olemassa oleva ohjataan', on(a));
  let st = await waitFor(() => state(0), s => s.si.oe === 99, 8000);
  check('olemattomasta lähdöstä varoitus', !!st, st ? '' : `oe ${(await state(0)).si.oe}`);
  const chk = (await state(0)).si.chkTs;
  await sleep(23000);
  check('olematonta lähtöä ei yritetä uudelleen 10 s välein', (await state(0)).si.chkTs === chk && chk > 0);

  //Lähdön ohjaustapa
  await cfg(0, { en: 1, mode: 0, m0: { c: 0 }, o: [a], oc: 1 });
  await expectRelays('ohjaus pois', on());
  await rpc('Switch.Set', { id: a, on: true });
  await get('r=r&i=0');
  await sleep(5000);
  check('"vain muuttuessa": käsin kytketty rele jää päälle', (await relays()) === on(a));
  await cfg(0, { en: 1, mode: 0, m0: { c: 0 }, o: [a], oc: 0 });
  await expectRelays('"aina": rele palautetaan pois', on());

  //Pakko-ohjaus
  await get(`r=f&i=0&ts=${Math.floor(Date.now() / 1000) + 3600}&c=1`);
  await expectRelays('pakko-ohjaus päälle', on(a));
  check('pakko-ohjauksen tila 9', (await state(0)).si.st === 9);
  await get('r=f&i=0&ts=0&c=0');
  await expectRelays('pakko-ohjauksen peruutus', on());

  //Historia
  const h = Buffer.from(await (await get('r=h&i=0')).json(), 'base64');
  const last = h.length >= 4 ? ((h[h.length - 4] << 16 | h[h.length - 3] << 8 | h[h.length - 2]) + 26000000) * 60 : 0;
  check('historiaan kertyi rivejä', h.length >= 16 && h.length % 4 === 0, `${h.length / 4} riviä`);
  check('viimeisimmän rivin aika on nykyhetki', Math.abs(last - Date.now() / 1000) < 180, fmt(last));

  //Tyhjä lähtölista
  await rpc('Switch.Set', { id: a, on: false });
  await cfg(0, { en: 1, mode: 0, m0: { c: 1 }, o: [] });
  await sleep(3000);
  st = await state(0);
  check('tyhjä lähtölista: logiikka ajetaan, releisiin ei kosketa', st.si.cmd === 1 && (await relays()) === on());
}

async function testPrices() {
  section('Ohjaus oikeilla hinnoilla');
  const a = switches[0];

  await cfg(0, { en: 1, mode: 1, m1: { l: 999 }, o: [a] });
  await expectRelays('hintaraja 999: päälle', on(a));
  check('tila 2 (hinta alle rajan)', (await state(0)).si.st === 2);
  await cfg(0, { en: 1, mode: 1, m1: { l: -999 }, o: [a] });
  await expectRelays('hintaraja -999: pois', on());
  check('tila 3 (hinta yli rajan)', (await state(0)).si.st === 3);

  //Laitteen ohjaus verrattuna tilasivun laskemaan suunnitelmaan (lähtöjä ei käytetä)
  const cases = [
    ['tunti, 24 h jakso, 6 h', { mode: 2, q: 0, m2: { p: 24, c: 6 } }],
    ['tunti, 8 h jaksot, 2 h peräkkäin', { mode: 2, q: 0, m2: { p: 8, c: 2, s: 1 } }],
    ['30 min, 12 h jaksot, 2.5 h', { mode: 2, q: 2, m2: { p: 12, c: 2.5 } }],
    ['15 min, 6 h jaksot, 1.5 h', { mode: 2, q: 1, m2: { p: 6, c: 1.5 } }],
    ['15 min, 24 h jakso, 4 h peräkkäin', { mode: 2, q: 1, m2: { p: 24, c: 4, s: 1 } }],
    ['15 min, hintaraja keskihinta', { mode: 1, q: 1, m1: { l: 'avg' } }],
    ['tunti, oma jakso 00-24, 12 h', { mode: 2, q: 0, m2: { p: -1, ps: 0, pe: 24, c: 12 } }]
  ];

  for (const [name, patch] of cases) {
    await cfg(0, Object.assign({ en: 1, o: [] }, patch));
    await sleep(1500);
    const st = await state(0);
    const rows = plan(st);
    const current = rows.find(r => r.now);
    check(`${name}: laite ja tilasivu samaa mieltä`, !!current && (st.si.cmd === 1) === current.on,
      current ? `kello ${current.t}: laite ${st.si.cmd ? 'päällä' : 'pois'}, tilasivu ${current.on ? 'päällä' : 'pois'}, päivässä päällä ${rows.filter(r => r.on).length}/${rows.length}` : 'kuluvaa riviä ei löytynyt');
  }

  const m = await scriptStatus();
  check('skripti käynnissä, muistihuippu alle 22 000 tavua', m.running && m.mem_peak < 22000, `käytössä ${m.mem_used}, huippu ${m.mem_peak}`);
  await cfg(0, { en: 0 });
}

async function testClock() {
  section('Kellotestit (laitteen kelloa siirretään)');
  const a = switches[0];
  const setTime = (date) => rpc('Sys.SetTime', { unixtime: Math.floor(date.getTime() / 1000) });
  const today = new Date();
  const at = (days, h, m, s) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + days, h, m, s);

  try {
    await cfg(0, { en: 1, mode: 1, m1: { l: 999 }, o: [a] });
    await expectRelays('lähtötilanne: hintaraja 999, rele päällä', on(a));

    //Vuorokauden vaihde
    await setTime(at(0, 23, 58, 40));
    //Kellon hyppy tyhjentää hinnat: odotetaan, että sekä tämän päivän että huomisen hinnat on haettu uudelleen
    //(aikaa on noin 80 s ennen keskiyötä)
    let st = await waitFor(() => state(0), s => s.s.p[0].ts > 0 && new Date(s.s.p[0].ts * 1000).getHours() === 23 && unpack(s.p[1]).length > 0, 45000, 1500);
    const hadTomorrow = !!st;
    note(`kello 23:58, huomisen hinnat ${hadTomorrow ? 'muistissa' : 'eivät saatavilla'}`);
    await waitFor(() => rpc('Sys.GetStatus'), s => s.time >= '00:00' && s.time < '00:10', 120000, 3000);
    st = await waitFor(() => state(0), s => new Date(s.s.p[0].st * 1000).getDate() === at(1, 0, 0, 0).getDate() && unpack(s.p[0]).length > 0 && s.si.chkTs >= Math.floor(at(1, 0, 0, 0).getTime() / 1000), 40000, 1500);
    if (hadTomorrow) {
      check('keskiyöllä uuden päivän hinnat ovat käytössä', !!st, st ? `hinnat alkaen ${fmt(st.s.p[0].st)}, logiikka ajettu ${fmt(st.si.chkTs)}` : 'hinnat eivät vaihtuneet');
      //Varmistushaku odottaa laitekohtaisen viiveen (180-300 s MAC-osoitteesta, sama kaava kuin skriptissä)
      const delay = 180 + Math.floor((parseInt(info.mac.slice(-2), 16) * 173 % 256) * 120 / 255);
      const sys = await rpc('Sys.GetStatus');
      const sec = Number(sys.time.split(':')[1]) * 60 + (sys.unixtime % 60);
      if (st && sec < delay - 5) {
        check(`varmistushaku odottaa laitekohtaisen viiveen (${delay} s)`, st.s.p[0].ts === 0, `${st.s.p[0].ts ? 'haettu jo ' + fmt(st.s.p[0].ts) : 'ei vielä haettu'}, kello 00:${pad(Math.floor(sec / 60))}:${pad(sec % 60)}`);
      } else {
        note(`viivettä (${delay} s) ei ehditty tarkistaa (kello jo 00:${pad(Math.floor(sec / 60))}:${pad(sec % 60)})`);
      }
      st = await waitFor(() => state(0), s => s.s.p[0].ts > 0 && new Date(s.s.p[0].ts * 1000).getDate() === at(1, 0, 0, 0).getDate(), (delay + 40) * 1000, 2000);
      check('varmistushaku tehty viiveen jälkeen', !!st, st ? `haettu ${fmt(st.s.p[0].ts)}` : 'hakua ei tehty');
      check('ohjaus jatkuu hinnan mukaan (tila 2)', !!st && st.si.st === 2);
      await expectRelays('rele pysyy päällä vaihteen yli', on(a));
    } else {
      note('huomisen hintoja ei ollut ennen keskiyötä -> vaihdetta ei voi tarkistaa (aja testi kello 15 jälkeen)');
    }

    //Jakson vaihtuminen 15 min tarkkuudella
    await cfg(0, { en: 1, mode: 1, m1: { l: 999 }, o: [a], q: 1 });
    //Huom: kellon hyppy käynnistää itse hintahaun ja logiikan ajon, joten odotetaan nimenomaan vartin jälkeistä ajoa
    await setTime(at(1, 0, 14, 30));
    const quarter = Math.floor(at(1, 0, 15, 0).getTime() / 1000);
    st = await waitFor(() => state(0), s => s.si.chkTs >= quarter, 70000, 1500);
    check('15 min tarkkuus: logiikka ajetaan vartin vaihtuessa', !!st && st.si.chkTs - quarter < 20, st ? `ajettu ${fmt(st.si.chkTs)}` : `ei ajettu, viimeisin ${fmt((await state(0)).si.chkTs)}`);

    //Paluu nykyhetkeen: kello hyppää taaksepäin
    await setTime(new Date());
    st = await waitFor(() => state(0), s => unpack(s.p[0]).length > 0 && new Date(s.s.p[0].st * 1000).getDate() === new Date().getDate() && s.si.st === 2, 60000, 1500);
    check('paluu nykyhetkeen: hinnat haetaan uudelleen ja ohjaus jatkuu', !!st, st ? `hinnat haettu ${fmt(st.s.p[0].ts)}` : 'ei palautunut');
    check('virhetauko ei jää päälle', !!st && st.s.errCnt < 3, st ? `errCnt ${st.s.errCnt}` : '');
    check('skripti käynnissä', (await scriptStatus()).running === true);
  } finally {
    await setTime(new Date());
    await cfg(0, { en: 0 });
  }
}

//-------------------------------------------------------------------------
// Kellonsiirrot testirajapinnalla (valinta --dst)
//-------------------------------------------------------------------------
/** Asentaa testirajapinnan toiseksi skriptiksi (ei käynnisty laitteen käynnistyessä) */
async function installFake() {
  await removeFake();
  const code = fs.readFileSync(FAKE_FILE, 'utf8');
  fakeId = (await rpc('Script.Create', { name: FAKE_NAME })).id;
  for (let pos = 0; pos < code.length; pos += 1024) {
    await rpc('Script.PutCode', { id: fakeId, code: code.substring(pos, pos + 1024), append: pos > 0 });
  }
  await rpc('Script.Start', { id: fakeId });
}

async function removeFake() {
  for (const s of (await rpc('Script.List')).scripts.filter(s => s.name === FAKE_NAME)) {
    if (s.running) await rpc('Script.Stop', { id: s.id });
    await rpc('Script.Delete', { id: s.id });
  }
}

/** Pääskriptin kopio, jossa hakuosoite on testirajapinta (julkaistavaa tiedostoa ei muuteta) */
function fakeCode(id) {
  const code = fs.readFileSync(FILE, 'utf8');
  if (code.split(ELERING_URL).length !== 2) throw new Error('Eleringin osoite ei löydy skriptistä yhden kerran');
  return code.replace(ELERING_URL, `"http://localhost/script/${id}/prices?fields="`);
}

/**
 * Sama skenaario simulaattorissa: käynnistys hetkellä startMs laitteen asetuksilla, hinnat samasta testirajapinnasta,
 * ja tila hetkellä untilS (laitteen kellon mukaan)
 */
function simulate(c, ci, startMs, untilS) {
  const sim = createSim({
    start: startMs,
    mac: info.mac,
    priceUrl: '"http://localhost/script/2/prices?fields="',
    kvs: { porssisahko: kvsPack(-1, c), 'porssisahko-1': kvsPack(0, ci) }
  });
  sim.runScript(fs.readFileSync(FAKE_FILE, 'utf8'), 'fake-elering.js');
  sim.advanceTo(new Date(untilS * 1000));
  //Tila samassa muodossa kuin laitteelta (hinnat pakattuina, base64)
  return sim.get('r=s&i=0').json;
}

/** Vertaa laitteen tilaa simulaattoriin: hinnat, ohjaus ja tilan syy */
function compareSim(label, st, c, ci, startMs) {
  const s = simulate(c, ci, startMs, st.t);
  check(`${label}: hinnat samat kuin simulaattorissa`, st.p[0] === s.p[0] && st.s.p[0].st === s.s.p[0].st,
    `laite ${unpack(st.p[0]).length} jaksoa alkaen ${fmt(st.s.p[0].st)}, simulaattori ${unpack(s.p[0]).length} jaksoa alkaen ${fmt(s.s.p[0].st)}`);
  check(`${label}: ohjaus sama kuin simulaattorissa`, st.si.cmd === s.si.cmd && st.si.st === s.si.st,
    `laite ${st.si.cmd} (tila ${st.si.st}), simulaattori ${s.si.cmd} (tila ${s.si.st})`);
}

async function testDst() {
  section('Kellonsiirrot testirajapinnalla (laitteen kelloa siirretään)');
  const a = switches[0];
  const setTime = (date) => rpc('Sys.SetTime', { unixtime: Math.floor(date.getTime() / 1000) });
  //Hintatietojen maat: sama aika ja sama EU:n kesäaikasääntö
  const zones = ['Europe/Helsinki', 'Europe/Tallinn', 'Europe/Riga', 'Europe/Vilnius'];
  const devTz = ((await rpc('Sys.GetConfig')).location || {}).tz;
  const hostTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  //Testirajapinta ja vertailu olettavat Suomen, Viron, Latvian tai Liettuan ajan (myös tämän koneen kello, josta päivät lasketaan)
  if (!check('aikavyöhyke Suomi, Viro, Latvia tai Liettua (laite ja testikone)', zones.includes(devTz) && zones.includes(hostTz), `laite ${devTz}, kone ${hostTz}`)) {
    return;
  }

  //Seuraavat kaksi kellonsiirtoa (vähintään vuorokauden päässä) testirajapinnan laskemina: maaliskuun ja lokakuun viimeinen sunnuntai klo 01 UTC
  const ctx = vm.createContext({ HTTPServer: { registerEndpoint() { } } });
  vm.runInContext(fs.readFileSync(FAKE_FILE, 'utf8'), ctx);
  const nowS = Math.floor(Date.now() / 1000);
  const shifts = [];
  for (let y = new Date().getFullYear(); shifts.length < 2; y++) {
    for (const [m, name] of [[3, 'kesäaikaan'], [10, 'talviaikaan']]) {
      const t = vm.runInContext(`fakeLastSunday(${y}, ${m})`, ctx);
      if (t > nowS + 86400 && shifts.length < 2) shifts.push({ t, name });
    }
  }

  try {
    const ci = await cfg(0, { en: 1, mode: 2, m2: { p: 24, c: 6 }, o: [a] });
    const c = (await state(0)).c;

    for (const { t, name } of shifts) {
      const shift = new Date(t * 1000);
      const day = new Date(shift.getFullYear(), shift.getMonth(), shift.getDate());
      const dayS = Math.floor(day.getTime() / 1000);
      const startMs = day.getTime() - 80000;
      note(`${name} siirtyminen ${day.getDate()}.${day.getMonth() + 1}.${day.getFullYear()}, kello ${pad(shift.getHours())}:00`);

      //Edellinen ilta: kello hyppää, hinnat haetaan uudelleen testirajapinnasta (tämä ja huominen)
      await setTime(new Date(startMs));
      let st = await waitFor(() => state(0), s => s.s.p[0].ts > 0 && unpack(s.p[1]).length > 0, 60000, 1500);
      check(`${name}: huomisen hinnat testirajapinnasta ennen keskiyötä`, !!st, st ? `${unpack(st.p[1]).length} jaksoa` : 'ei saatu');

      //Keskiyö: huomisen hinnat käyttöön
      st = await waitFor(() => state(0), s => s.s.p[0].st === dayS && s.si.chkTs >= dayS, 150000, 2000);
      if (check(`${name}: keskiyöllä uuden päivän hinnat käytössä`, !!st, st ? `${unpack(st.p[0]).length} jaksoa, logiikka ajettu ${fmt(st.si.chkTs)}` : 'ei vaihtunut')) {
        compareSim(`${name}: keskiyön jälkeen`, st, c, ci, startMs);
      }

      //Varmistushaku laitekohtaisen viiveen jälkeen
      st = await waitFor(() => state(0), s => s.s.p[0].ts >= dayS, 160000, 2000);
      check(`${name}: varmistushaku testirajapinnasta, ei virheitä`, !!st && st.s.errTot === 0, st ? `haettu ${fmt(st.s.p[0].ts)}, virheitä ${st.s.errTot}` : 'hakua ei tehty');

      //Kellonsiirto: 90 s ennen siirtoa, odotetaan siirron yli
      await setTime(new Date((t - 90) * 1000));
      st = await waitFor(() => state(0), s => s.t >= t + 10 && s.si.chkTs >= t, 150000, 2000);
      if (check(`${name}: logiikka ajetaan kellonsiirron jälkeen`, !!st, st ? `ajettu ${fmt(st.si.chkTs)}` : 'ei ajettu')) {
        compareSim(`${name}: kellonsiirron jälkeen`, st, c, ci, startMs);
        const row = plan(st).find(r => r.now);
        check(`${name}: laite ja tilasivu samaa mieltä`, !!row && row.on === (st.si.cmd === 1), row ? `laite ${st.si.cmd}, tilasivu ${row.on ? 1 : 0} (${row.t})` : 'kuluvaa riviä ei löytynyt');
        check(`${name}: ei hintahaun virheitä`, st.s.errTot === 0, `virheitä ${st.s.errTot}`);
      }
    }
    check('testirajapinta vastasi', Number((await rpc('Script.Eval', { id: fakeId, code: 'fakeCount' })).result) > 0);
    check('skripti käynnissä', (await scriptStatus()).running === true);
  } finally {
    await setTime(new Date());
    await cfg(0, { en: 0 });
  }
}

/**
 * Lisäosaversion testi: lisäosa ajetaan laitteella pääskriptin kanssa.
 * Ohjauksella #1 ei ole lähtöjä, joten releisiin ei kosketa.
 */
async function testAddon(name) {
  section(`Lisäosa ${name}`);
  const str = async () => (await state(0)).si.str;

  if (name === '1-instance-no-history') {
    const st = await state(0);
    check('ohjauksia on yksi', st.c.cnt === 1 && !('si' in await (await get('r=s&i=1')).json()), `määrä ${st.c.cnt}`);
    await cfg(0, { en: 1, mode: 0, m0: { c: 1 }, o: [] });
    await cfg(0, { en: 1, mode: 0, m0: { c: 0 }, o: [] });
    check('historia ei ole käytössä', (await (await get('r=h&i=0')).json()) === '');
    check('skripti käynnissä', (await scriptStatus()).running === true);
    await cfg(0, { en: 0 });
    return;
  }

  //Jakson halvimmat tunnit: lisäosat säätävät tuntimäärää tai ylikirjoittavat ohjauksen
  await cfg(0, { en: 1, mode: 2, m2: { p: 24, c: 4 }, o: [] });
  let st = await waitFor(() => state(0), s => s.si.chkTs > 0 && s.si.str !== '', 30000, 1000);
  check('logiikka ajettu ja lisäosa on kirjoittanut selitteen', !!st, st ? `"${st.si.str}"` : `selite "${await str()}"`);

  //Lisäosan koodi ajetaan myös asetuksia ladattaessa (vastauskäsittelijän sisällä)
  for (let i = 0; i < 3; i++) { await get('r=r'); await sleep(2500); }
  check('kolme asetusten latausta: skripti käynnissä', (await scriptStatus()).running === true);

  if (name === 'open-meteo-api') {
    st = await waitFor(() => state(0), s => /Kylmintä tänään: -?[\d.]+°C -> halvat tunnit: \d+ h/.test(s.si.str), 30000, 1000);
    check('sääennuste haettu', !!st, st ? `"${st.si.str}"` : `selite "${await str()}"`);
    check('tuntimäärä on lisäosan sääntöjen mukainen', !!st && [4, 6, 7, 8].includes(st.ci.m2.c), st ? `${st.ci.m2.c} h, ${st.ci.m} min` : '');

    //Virhetilanne: mahdottomat koordinaatit -> sääpalvelu vastaa virheellä
    const code = fs.readFileSync(ADDON_FILE, 'utf8');
    const bad = code.replace(/LATITUDE\s*=\s*"[^"]*"/, 'LATITUDE="999"');
    if (check('virhetilannetta varten koordinaatti löytyy koodista', bad !== code)) {
      await uploadCode(bad);
      st = await waitFor(() => state(0), s => /^Virhe lämpötilaohjauksessa/.test(s.si.str) && s.si.chkTs > 0, 60000, 1500);
      check('ennusteen haku epäonnistuu: virheteksti ja logiikka ajetaan silti', !!st, st ? `"${st.si.str.substring(0, 70)}", tuntimäärä ${st.ci.m2.c}` : `selite "${await str()}"`);
      check('tuntimäärä on käyttäjän asettama', !!st && st.ci.m2.c === 4);
    }

  } else if (name === 'ht-sensor-temp') {
    check('ilman lämpötilaa käytetään asetettua tuntimäärää', /ei tiedossa/.test(await str()) && (await state(0)).ci.m2.c === 4, `"${await str()}"`);
    let res = await fetch(`${BASE}/script/${scriptId}/update-temp?temp=-20`);
    check('lämpötilan vastaanotto (update-temp?temp=-20)', res.status === 200, `vastaus ${res.status}`);
    st = await waitFor(() => state(0), s => s.ci.m2.c === 8, 20000, 1000);
    check('-20 °C nostaa tuntimäärän kahdeksaan', !!st, st ? `"${st.si.str}"` : `tuntimäärä ${(await state(0)).ci.m2.c}`);
    res = await fetch(`${BASE}/script/${scriptId}/update-temp?foo=1`);
    check('pyyntö ilman lämpötilaa palauttaa 400', res.status === 400, `vastaus ${res.status}`);
    res = await fetch(`${BASE}/script/${scriptId}/update-temp?temp=5`);
    st = await waitFor(() => state(0), s => s.ci.m2.c === 4, 20000, 1000);
    check('+5 °C palauttaa asetetun tuntimäärän', !!st);

  } else {
    //addon-temp ja addon-temp-hours lukevat Add-on-anturia 100
    let sensor = null;
    try { sensor = await rpc('Temperature.GetStatus', { id: 100 }); } catch (e) { }
    const text = await str();
    if (sensor && sensor.tC != null) {
      check(`anturi 100 löytyy (${sensor.tC} °C): lämpötila näkyy selitteessä`, /Lämpötila -?[\d.]+°C/.test(text), `"${text}"`);
    } else {
      //Asetusten lataukset nollaavat logiikan ajoajan: odotetaan, että logiikka on ajettu uudelleen
      const ran = await waitFor(() => state(0), s => s.si.chkTs > 0, 20000, 1000);
      check('anturia 100 ei ole: virheteksti ja ohjaus jatkuu', /anturia 100 ei löytynyt|Onko anturi kytketty/i.test(text) && !!ran, `"${text}"${ran ? '' : ', logiikkaa ei ajettu'}`);
    }
  }

  const m = await scriptStatus();
  check('skripti käynnissä, muistihuippu alle 22 000 tavua', m.running === true && m.mem_peak < 22000, `käytössä ${m.mem_used}, huippu ${m.mem_peak}`);
  await cfg(0, { en: 0 });
}

//-------------------------------------------------------------------------
// Ajo
//-------------------------------------------------------------------------
function confirm(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, answer => { rl.close(); resolve(answer); });
  });
}

(async () => {
  let scripts;

  try {
    info = await rpc('Shelly.GetDeviceInfo');
    scripts = (await rpc('Script.List')).scripts;
  } catch (e) {
    console.error(`Laitteeseen ${BASE} ei saada yhteyttä: ${e.message}`);
    process.exit(1);
  }

  for (const file of [FILE, ADDON_FILE]) {
    if (file && !fs.existsSync(file)) {
      console.error(`Skriptiä ei löydy: ${file} (aja ensin npm run build)`);
      process.exit(1);
    }
  }

  for (let id = 0; id < 4; id++) {
    try { await rpc('Switch.GetStatus', { id }); switches.push(id); } catch (e) { }
  }

  const backup = {};
  for (const key of BACKUP_KEYS) backup[key] = await kvsGet(key);
  const relaysBefore = await relays();
  const others = scripts.filter(s => s.name !== NAME);

  console.log(`
==================================================================
  VAROITUS - TÄMÄ TESTI ON VAIN KEHITYSLAITTEELLE
==================================================================
  Laite:    ${info.app || info.model} (${info.id}), sukupolvi ${info.gen}, laiteohjelmisto ${info.ver}
  Osoite:   ${BASE}
  Skripti:  ${path.relative(process.cwd(), ADDON_FILE || FILE)}${ADDON ? ' (lisäosaversio)' : ''}

  Testi tekee laitteelle seuraavaa:
   - KYTKEE RELEITÄ PÄÄLLE JA POIS useita kertoja (lähdöt ${switches.join(', ') || 'ei löytynyt'})
     -> releisiin ei saa olla kytkettynä kuormaa
   - korvaa laitteen skriptin "${NAME}"${scripts.some(s => s.name === NAME) ? ' (laitteessa on sellainen nyt)' : ''}
   - kirjoittaa pörssisähkön asetuksia (${BACKUP_KEYS.filter(k => backup[k] !== null).length ? 'nykyiset palautetaan lopuksi' : 'laitteessa ei ole asetuksia'})${FRESH ? `
   - UUSI ASENNUS: poistaa ensin pörssisähkön skriptin ja kaikki sen asetukset (myös version 3.x)` : ''}${UPGRADE ? `
   - PÄIVITYS: poistaa ensin pörssisähkön skriptin ja asetukset, asentaa version 3.4.0 ja sille asetukset` : ''}
   - hakee hinnat ${DST ? `testirajapinnasta (skripti "${FAKE_NAME}" asennetaan testin ajaksi)` : 'Eleringistä muutaman kerran'}${CLOCK || DST ? `
   - SIIRTÄÄ LAITTEEN KELLOA ja palauttaa sen lopuksi` : ''}

  Lopuksi: asetukset ja releiden tila palautetaan, laitteeseen jää ${ADDON ? `tavallinen skripti (${path.relative(process.cwd(), FILE)})` : 'testattu skripti'}.${others.length ? `
  Muihin skripteihin (${others.map(s => s.name).join(', ')}) ei kosketa, mutta ne jakavat saman muistin.` : ''}
==================================================================`);

  if (!switches.length) {
    console.error('Laitteesta ei löytynyt yhtään lähtöä.');
    process.exit(1);
  }

  if (!YES) {
    if (!process.stdin.isTTY) {
      console.error('\nVahvistusta ei voi kysyä (ei päätettä). Lisää --yes, jos haluat ajaa testin ilman kysymystä.');
      process.exit(1);
    }
    const answer = await confirm('\nKirjoita KYLLÄ, jos laite on kehityslaite ilman kuormaa ja testin saa ajaa: ');
    if (!/^kyll[äa]$/i.test(answer.trim())) {
      console.log('Testiä ei ajettu.');
      process.exit(1);
    }
  } else {
    console.log('\n(--yes: vahvistusta ei kysytty)');
  }

  const started = Date.now();

  try {
    let stored = null;
    if (FRESH || UPGRADE) {
      await clearSettings();
    }
    if (UPGRADE) {
      stored = await installOld();
    }
    if (DST) {
      await installFake();
    }
    if (await testStart(ADDON_FILE || FILE, DST ? fakeCode(fakeId) : null)) {
      if (FRESH) await testFresh();
      if (UPGRADE) await testUpgrade(stored);

      //Kaikki ohjaukset pois käytöstä, jotta laitteen omat asetukset eivät ohjaa releitä testin aikana
      const count = (await state(0)).c.cnt;
      if (ADDON !== '1-instance-no-history') await common({ cnt: 3 });
      for (let i = 0; i < (ADDON === '1-instance-no-history' ? count : 3); i++) await cfg(i, { en: 0 });

      if (ADDON) {
        await testAddon(ADDON);
      } else if (DST) {
        await testDst();
      } else if (!CLOCK_ONLY) {
        await testPages();
        await testConfig();
        await testRelays();
        await testPrices();
      }
      if (CLOCK && !ADDON) await testClock();
    }
  } catch (e) {
    check('testiajo keskeytyi virheeseen', false, e.message);
  } finally {
    section('Palautus');
    try {
      if (CLOCK || DST) await rpc('Sys.SetTime', { unixtime: Math.floor(Date.now() / 1000) });
      //Uusi asennus ja päivitys: skripti pysäytetään, jotta se ei kirjoita muistissa olevia asetuksia takaisin
      if (FRESH || UPGRADE) await rpc('Script.Stop', { id: scriptId });
      for (const key of BACKUP_KEYS) {
        if (backup[key] !== null) await rpc('KVS.Set', { key, value: backup[key] });
        //Avain, jota ei ollut ennen testiä (ohjaus ei ollut käytössä), poistetaan
        else if (await kvsGet(key) !== null) await rpc('KVS.Delete', { key });
      }
      if (DST) {
        //Testirajapinta pois ja testikopion tilalle tavallinen skripti
        await removeFake();
        await uploadCode(fs.readFileSync(FILE, 'utf8'));
        await waitFor(() => state(0), st => st.s.p[0].ts > 0, 60000, 1500);
        console.log(`  testirajapinta poistettu, tavallinen skripti palautettu (${path.basename(FILE)})`);
      } else if (ADDON) {
        //Lisäosaversion tilalle tavallinen skripti
        await uploadCode(fs.readFileSync(FILE, 'utf8'));
        await waitFor(() => state(0), st => st.s.p[0].ts > 0, 60000, 1500);
        console.log(`  tavallinen skripti palautettu (${path.basename(FILE)})`);
      } else if (CLOCK) {
        //Kellotestit jättävät historiaan rivejä väärällä päivämäärällä -> skripti käynnistetään uudelleen (historia on vain työmuistissa)
        await rpc('Script.Stop', { id: scriptId });
        await rpc('Script.Start', { id: scriptId });
        await waitFor(() => state(0), st => st.s.p[0].ts > 0, 60000, 1500);
        console.log('  skripti käynnistetty uudelleen (historia tyhjennetty)');
      } else if (FRESH || UPGRADE) {
        await rpc('Script.Start', { id: scriptId });
        await waitFor(() => state(0), st => st.s.p[0].ts > 0, 60000, 1500);
        console.log('  skripti käynnistetty uudelleen palautetuilla asetuksilla');
      } else {
        try { await get('r=r'); } catch (e) { }
      }
      await sleep(6000);
      //Releet takaisin alkutilaan (jos palautettu ohjaus ei jo ohjannut niitä)
      for (let i = 0; i < switches.length; i++) {
        await rpc('Switch.Set', { id: switches[i], on: relaysBefore[i] === '1' });
      }
      const m = await scriptStatus().catch(() => ({}));
      const sys = await rpc('Sys.GetStatus');
      console.log(`  asetukset palautettu, releet ${await relays()} (ennen testiä ${relaysBefore}), kellon ero ${sys.unixtime - Math.floor(Date.now() / 1000)} s`);
      console.log(`  skripti käynnissä: ${m.running}, muisti käytössä ${m.mem_used}, huippu ${m.mem_peak}`);
    } catch (e) {
      console.log(`  PALAUTUS EPÄONNISTUI: ${e.message}`);
      console.log(`  Asetukset ennen testiä: ${JSON.stringify(backup)}`);
      failed.push('Palautus: ' + e.message);
    }
  }

  console.log(`\n==================================================================`);
  console.log(`  ${info.app || info.model} gen ${info.gen}: ${passed} ok, ${failed.length} virhettä, kesto ${Math.round((Date.now() - started) / 1000)} s`);
  failed.forEach(f => console.log(`  VIRHE: ${f}`));
  console.log(`==================================================================`);
  process.exit(failed.length ? 1 : 0);
})();
