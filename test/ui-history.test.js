/**
 * Historiasivu (src/statics/tab-history.js): ohjaushistorian purku ja hintahaun virhetilasto
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { uiShared } = require('./sim/ui-shared.js');
const { boot } = require('./helpers');

const TAB_HISTORY = fs.readFileSync(path.join(__dirname, '..', 'src', 'statics', 'tab-history.js'), 'utf8');

/** Ajaa historiasivun simulaattorin tilalla ja palauttaa sivun elementit */
async function historyPage(sim, inst = 0) {
  const elements = {};
  const pad = (n) => String(n).padStart(2, '0');
  const context = vm.createContext({
      ...uiShared(),
    state: sim.status(inst), inst, CBS: [], URLS: '', activeTab: 'tab-history', console,
    atob: (s) => Buffer.from(s, 'base64').toString('latin1'),
    qs: (id) => elements[id] ?? (elements[id] = { innerHTML: '', style: {} }),
    STATE_STR: new Array(14).fill(0).map((x, i) => `tila ${i}`),
    formatDateTime: (d, sec = true) => `${d.getDate()}.${d.getMonth() + 1}. ${pad(d.getHours())}:${pad(d.getMinutes())}${sec ? ':' + pad(d.getSeconds()) : ''}`,
    formatTime: (d, sec = true) => `${pad(d.getHours())}:${pad(d.getMinutes())}${sec ? ':' + pad(d.getSeconds()) : ''}`,
    getData: async (url) => { const r = sim.get(url.replace('?', '')); return { ok: r.code === 200, code: r.code, data: r.json }; }
  });
  vm.runInContext(TAB_HISTORY, context, { filename: 'tab-history.js' });
  //Sivun päivitys on asynkroninen
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  return elements;
}

describe('historiasivu', () => {
  test('ohjaushistoria puretaan riveiksi, uusin ensin', async () => {
    const sim = boot({ start: '2026-10-05T10:00:00', inst: { mode: 0, m0: { c: 1 } } });
    sim.advance(3 * 60e3);
    sim.saveConfig(0, { m0: { c: 0 } });
    const el = await historyPage(sim);
    const rows = el['s-hist'].innerHTML.split('<tr>').slice(1);

    assert.equal(rows.length, 2);
    assert.match(rows[0], /Ohjaus pois/);
    assert.match(rows[1], /5\.10\. 10:00/);
    assert.match(rows[1], /Ohjaus päälle/);
  });

  test('saman minuutin rivit ovat tapahtumajärjestyksessä, uusin ensin', async () => {
    //Käsiohjaus päälle, pois, päälle ja pois nopeasti peräkkäin (kaksi ensimmäistä saman minuutin aikana)
    const sim = boot({ start: '2026-10-05T10:00:00', inst: { mode: 0, m0: { c: 1 } } });

    for (const c of [0, 1, 0]) {
      sim.advance(10e3);
      sim.saveConfig(0, { m0: { c } });
      sim.advance(5e3);
    }
    const el = await historyPage(sim);
    const rows = el['s-hist'].innerHTML.split('<tr>').slice(1);

    assert.equal(rows.length, 4);
    assert.ok(rows.filter(row => /5\.10\. 10:00/.test(row)).length >= 2, 'vähintään kaksi riviä on samalla minuutilla');
    assert.deepEqual(rows.map(row => /Ohjaus päälle/.test(row) ? 'päälle' : 'pois'), ['pois', 'päälle', 'pois', 'päälle']);
  });

  test('hintahaun virheet: ei virheitä', async () => {
    const sim = boot({ start: '2026-10-05T10:00:00', inst: { mode: 0, m0: { c: 1 } } });
    const el = await historyPage(sim);
    assert.equal(el['s-err'].innerHTML, 'Hintahaun virheitä käynnistyksen jälkeen: 0');
  });

  test('hintahaun virheet: määrä ja ensimmäinen virhe, viimeisin katko alkuineen ja loppuineen', async () => {
    const sim = boot({ start: '2026-10-05T14:59:00', inst: { mode: 0, m0: { c: 1 } } });
    //Huomisen hintoja ei saada klo 15 alkaen
    sim.net.mode = 'error';
    sim.advanceTo('2026-10-05T15:10:00');
    const s = sim.status(0).s;
    const el = await historyPage(sim);

    assert.ok(s.errTot >= 3);
    assert.equal(s.errN, s.errTot, 'yksi katko');
    //Määrä ja ensimmäinen virhe samalla rivillä, viimeisin katko omalla rivillään (loppu ilman päivämäärää, sama päivä)
    assert.match(el['s-err'].innerHTML, new RegExp(`^Hintahaun virheitä käynnistyksen jälkeen: ${s.errTot} \\(ensimmäinen 5\\.10\\. 15:03:\\d\\d\\)<br>Viimeisin katko: 5\\.10\\. 15:03:\\d\\d – 15:\\d\\d:\\d\\d, ${s.errN} virhettä$`));
  });

  test('kaksi erillistä katkoa: määrä ja ensimmäinen koko ajalta, viimeisin katko erikseen', async () => {
    const sim = boot({ start: '2026-10-05T14:59:00', inst: { mode: 0, m0: { c: 1 } } });
    sim.net.mode = 'error';
    sim.advanceTo('2026-10-05T15:04:00');
    const first = sim.status(0).s;
    sim.net.mode = 'ok';
    sim.advanceTo('2026-10-05T15:20:00');
    assert.equal(sim.status(0).s.errCnt, 0, 'haku onnistui välillä');

    //Toinen katko seuraavana päivänä
    sim.advanceTo('2026-10-06T14:59:00');
    sim.net.mode = 'error';
    sim.advanceTo('2026-10-06T15:08:00');
    const s = sim.status(0).s;
    const el = await historyPage(sim);

    assert.equal(s.errT0, first.errT0, 'ensimmäinen virhe pysyy');
    assert.equal(s.errTot, first.errTot + s.errN, 'kokonaismäärä on molempien katkojen summa');
    assert.ok(new Date(s.errT1 * 1000).getDate() === 6, 'viimeisin katko alkoi 6.10.');
    assert.match(el['s-err'].innerHTML, new RegExp(`\\(ensimmäinen 5\\.10\\. 15:03:\\d\\d\\)<br>Viimeisin katko: 6\\.10\\. 15:\\d\\d:\\d\\d – 15:\\d\\d:\\d\\d, ${s.errN} virhettä$`));
  });

  test('yhden virheen katko: "1 virhe"', async () => {
    const sim = boot({ start: '2026-10-05T14:59:00', inst: { mode: 0, m0: { c: 1 } } });
    sim.net.mode = 'error';
    sim.advanceTo('2026-10-05T15:03:00');
    assert.equal(sim.status(0).s.errN, 1);
    sim.net.mode = 'ok';
    sim.advanceTo('2026-10-05T15:04:00');
    const el = await historyPage(sim);
    assert.match(el['s-err'].innerHTML, /, 1 virhe$/);
  });

  test('keskiyön yli jatkuva katko on yksi katko, ja loppuaika näytetään päivämäärän kanssa', async () => {
    const sim = boot({ start: '2026-10-05T23:50:00', inst: { mode: 0, m0: { c: 1 } } });
    sim.net.mode = 'error';
    sim.advanceTo('2026-10-05T23:59:00');
    sim.evaluate('(_.s.p[0].ts = 0, 0)');
    sim.advanceTo('2026-10-06T00:20:00');
    const s = sim.status(0).s;
    const el = await historyPage(sim);
    assert.equal(new Date(s.errT1 * 1000).getDate(), 5, 'katko alkoi 5.10.');
    assert.equal(s.errN, s.errTot, 'päivän vaihtuminen ei aloita uutta katkoa');
    assert.match(el['s-err'].innerHTML, /Viimeisin katko: 5\.10\. 23:\d\d:\d\d – 6\.10\. 00:\d\d:\d\d, \d+ virhettä$/);
  });

  test('virhetilasto näkyy, vaikka ohjauksella ei ole historiaa', async () => {
    const sim = boot({ start: '2026-10-05T10:00:00', inst: { en: 0 } });
    const el = await historyPage(sim);
    assert.match(el['s-hist'].innerHTML, /Ei historiaa/);
    assert.equal(el['s-err'].innerHTML, 'Hintahaun virheitä käynnistyksen jälkeen: 0');
  });

  test('ilman kellonaikaa kirjattu rivi näkyy nollina ja oikeassa järjestyksessä', async () => {
    //Laite käynnistyy eikä saa kellonaikaa: käsiohjaus toimii silti
    const sim = boot({ start: '2026-10-05T10:00:00', timeSynced: false, inst: { mode: 0, m0: { c: 1 } }, settle: false });
    sim.advance(30e3);
    sim.saveConfig(0, { m0: { c: 0 } });
    sim.advance(5 * 60e3);
    sim.saveConfig(0, { m0: { c: 1 } });

    //Tallennettu arvo on minuutteja laitteen käynnistyksestä (pieni luku), ei kellonaika
    const raw = Buffer.from(sim.get('r=h&i=0').json, 'base64');
    const minutes = [];
    for (let i = 0; i < raw.length; i += 4) minutes.push(raw[i] << 16 | raw[i + 1] << 8 | raw[i + 2]);
    assert.equal(minutes.length, 3);
    assert.ok(minutes.every(m => m < 100000), `pienet arvot: ${minutes}`);
    assert.ok(minutes[0] <= minutes[1] && minutes[1] < minutes[2], `kasvava järjestys: ${minutes}`);

    //Kello saadaan ja ohjaus vaihtuu vielä kerran
    sim.timeSynced = true;
    sim.advance(60e3);
    sim.saveConfig(0, { m0: { c: 0 } });

    const el = await historyPage(sim);
    const rows = el['s-hist'].innerHTML.split('<tr>').slice(1).map(r => ({ time: r.match(/class="fit">([^<]*)</)[1], on: /Ohjaus päälle/.test(r) }));

    assert.equal(rows.length, 4);
    assert.match(rows[0].time, /^5\.10\. 10:\d\d$/, 'kellonajan saamisen jälkeinen rivi on ylimpänä');
    assert.deepEqual(rows.slice(1).map(r => r.time), ['00.00.0000 00:00', '00.00.0000 00:00', '00.00.0000 00:00']);
    assert.deepEqual(rows.slice(1).map(r => r.on), [true, false, true], 'uusin ensin');
  });

  test('kellonajan kanssa kirjatussa rivissä on oikea aika', async () => {
    const sim = boot({ start: '2026-10-05T10:00:00', inst: { mode: 0, m0: { c: 1 } } });
    const raw = Buffer.from(sim.get('r=h&i=0').json, 'base64');
    assert.ok((raw[0] << 16 | raw[1] << 8 | raw[2]) > 3000000);
    assert.match((await historyPage(sim))['s-hist'].innerHTML, /5\.10\. 10:00/);
  });

  test('tilasivulla ei ole enää virhetilastoa', () => {
    const status = fs.readFileSync(path.join(__dirname, '..', 'src', 'statics', 'tab-status.js'), 'utf8');
    assert.ok(!status.includes('Hintahaun virheitä'));
  });
});
