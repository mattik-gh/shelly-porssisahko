/**
 * Muistin käytön arvio.
 *
 * Laitteen todellista muistia ei voi mitata Nodessa. Tämä testi laskee arvion
 * hintahaun muistihuipusta laitteelta mitattujen vakioiden avulla ja valvoo
 * niiden tietoerien kokoa, joista huippu syntyy. Lopullinen luku luetaan aina
 * laitteelta (Script.GetStatus -> mem_peak).
 *
 * Mittaukset: Shelly Outdoor Plug S Gen3, fw 2.0.1
 *
 *  - Skriptin muisti yhteensä 25 186 B
 *  - Huippu syntyy, kun laite luovuttaa HTTP-vastauksen takaisinkutsulle:
 *    muistissa on base64-vastaus (n. 1,38 B per merkki) ja vastauksen otsikot (n. 2,7 kB).
 *    Skriptin koodi ei voi vaikuttaa tähän, joten huippua pienennetään vain
 *    pienentämällä lepokäyttöä (hintataulukot, ohjausten määrä).
 *  - Jäsennys lisää huippuun n. 1,4 kB (paloittain purku, split, kasvava hintataulukko)
 *  - Hinnat on pakattu merkkijonoon, 3 tavua per jakso: 96 jaksoa = n. 0,46 kB per päivä hintatasosta
 *    riippumatta. (Kokonaislukutaulukossa alkio vie 15 B vain välillä -8192...8191, muuten 29 B,
 *    ja vanha rivimuoto [aika, hinta] vei 24 rivillä 2,1 kB.)
 *  - Historia on pakattu merkkijonoon, 4 tavua per rivi: mitattu 5,6 B per rivi (vanha muoto 84 B)
 *  - Mitattu kahden päivän hinnoilla: lepokäyttö 6 916 B, huippu 18 228 B
 *    (alkuperäinen v3.4.0: lepokäyttö 9 394 B, huippu 18 870 - 18 940 B)
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { boot, assertAlive } = require('./helpers');

/** Laitteelta mitatut vakiot (tavua) */
const DEVICE = {
  /** Skriptin muisti yhteensä */
  total: 25186,
  /** Lepokäyttö ilman hintoja ja tuntihintojen välimuistia, kolme ohjausta pois käytöstä */
  base: 5992,
  /** Yksi hinta pakatussa merkkijonossa (3 tavua, mitattu 462 B / 96 hintaa) */
  slot: 4.8,
  /** Merkkijonon muistinkulutus per merkki */
  char: 1.38,
  /** HTTP-vastauksen otsikot ja muu vastausolio takaisinkutsun alussa */
  response: 3300,
  /** Jäsennyksen lisä huippuun */
  parse: 1400,
  /** Mitattu huippu käynnistyksessä (ei hintoja muistissa ennen hakua) */
  peakAtStart: 17850
};

/** Paljonko muistia pitää jäädä vapaaksi huipun aikana */
const SAFETY_MARGIN = 3000;

const FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures', 'elering-fi-2026-10-03.csv'), 'latin1');
const DIST = path.join(__dirname, '..', 'dist', 'shelly-porssisahko.js');

/** 25 tunnin vuorokausi: 100 riviä 96:n sijaan */
const FIXTURE_25H = (() => {
  const lines = FIXTURE.trim().split('\n');
  const last = Number(lines[lines.length - 1].split('"')[1]);
  const extra = lines.slice(1, 5).map((l, i) => l.replace(/^"\d+"/, `"${last + (i + 1) * 900}"`));
  return lines.concat(extra).join('\n') + '\n';
})();

/**
 * Ajaa hintahaun simulaattorissa ja laskee arvion muistihuipusta.
 *
 * @param {string} csv Elering-vastaus
 * @param {number} otherSlots muistissa haun aikana olevat muut hinnat (toinen päivä tai vanhat varahinnat)
 */
function fetchPeak(csv, otherSlots) {
  const sim = boot({ start: '2026-10-03T10:00:00', settle: false });
  sim.net.body = () => csv;
  sim.settle();
  assertAlive(sim);

  const b64 = sim.httpLog[0].b64;
  const slots = sim.prices(0).length;
  const chunkOut = Math.max(...sim.atobLog.map(c => c.out));

  const peak = Math.round(DEVICE.base + otherSlots * DEVICE.slot + b64 * DEVICE.char + DEVICE.response + DEVICE.parse);

  return { b64, slots, calls: sim.atobLog.length, chunkOut, peak };
}

/** Oikeat hinnat molemmille päiville, kolme ohjausta käytössä, pitkät nimet */
function fullSetup() {
  const rows = FIXTURE.trim().split('\n').slice(1)
    .map(l => Number(l.split(';')[2].replace(/"/g, '').replace(',', '.')) / 10);
  const price = (e, d) => rows[d.getHours() * 4 + d.getMinutes() / 15];

  const sim = boot({
    start: '2026-10-05T23:50:00',
    price,
    common: { vat: 25.5, day: 4.51, night: 2.53, names: ['Lämminvesivaraaja', 'Lattialämmitys', 'Auton lataus'] },
    inst: { mode: 1, m1: { l: 'avg' }, o: [0] },
    kvs: {
      'porssi-2': { en: 1, mode: 1, m1: { l: 6 }, o: [1] },
      'porssi-3': { en: 1, mode: 2, m2: { p: 6, c: 2 }, o: [2] }
    }
  });

  //Ajetaan yli vuorokausi, jotta historia täyttyy ja huomisen hinnat on haettu
  for (let h = 0; h < 40; h++) {
    sim.advance(3600e3);
  }
  assertAlive(sim);
  return sim;
}

describe('muistin käytön arvio', () => {
  test('malli vastaa laitteen mittausta käynnistyksessä', (t) => {
    const res = fetchPeak(FIXTURE, 0);

    t.diagnostic(`huippu käynnistyksessä: mitattu ${DEVICE.peakAtStart} B, malli ${res.peak} B`);

    //Jos malli poikkeaa mittauksesta paljon, se ei kuvaa laitetta
    assert.ok(Math.abs(DEVICE.peakAtStart - res.peak) < 500, `mitattu ${DEVICE.peakAtStart} B, malli ${res.peak} B`);
  });

  test('hintavastaus puretaan paloina eikä kerralla', (t) => {
    const res = fetchPeak(FIXTURE, 0);

    t.diagnostic(`atob-kutsuja ${res.calls}, suurin purettu pala ${res.chunkOut} B, jaksoja ${res.slots}`);
    assert.ok(res.chunkOut <= 256, `suurin purettu pala on ${res.chunkOut} B`);
    assert.equal(res.slots, 96);
  });

  test('hintahaun muistihuippu jättää varmuusvaran', (t) => {
    //Pahin tapaus: toisen päivän hinnat (tai vanhat varahinnat) ovat muistissa haun aikana
    const res = fetchPeak(FIXTURE, 96);
    const free = DEVICE.total - res.peak;

    t.diagnostic(`arvioitu huippu ${res.peak} B, vapaana ${free} B (varmuusvara ${SAFETY_MARGIN} B)`);
    assert.ok(free >= SAFETY_MARGIN, `huipun aikana vapaana vain ${free} B`);
  });

  test('25 tunnin vuorokausi (talviaikaan siirtyminen) jättää varmuusvaran', (t) => {
    const res = fetchPeak(FIXTURE_25H, 100);
    const free = DEVICE.total - res.peak;

    t.diagnostic(`jaksoja ${res.slots}, arvioitu huippu ${res.peak} B, vapaana ${free} B`);
    assert.equal(res.slots, 100);
    assert.ok(free >= SAFETY_MARGIN, `huipun aikana vapaana vain ${free} B`);
  });

  test('skriptin pyytämä vastaus on oikean kokoinen', () => {
    //Varmistaa, että pyyntö hakee yhden vuorokauden eikä esim. kahta
    const sim = boot({ start: '2026-10-05T10:00:00' });
    const rows = sim.httpLog[0].bytes / (FIXTURE.length / 97);

    assert.ok(rows > 90 && rows < 104, `vastauksessa noin ${Math.round(rows)} riviä`);
  });

  test('pysyvät tietorakenteet pysyvät rajoissa', (t) => {
    const sim = fullSetup();
    const p = [sim.prices(0), sim.prices(1)];
    const packed = sim.evaluate('[_.p[0].length, _.p[1].length]');
    const h = [0, 1, 2].map(i => sim.history(i));
    const histRows = h.reduce((sum, inst) => sum + inst.length, 0);

    //Hinnat ja historia ovat pakattuina merkkijonoissa: 3 tavua per hinta ja 4 tavua per historiarivi
    assert.deepEqual(packed, [p[0].length * 3, p[1].length * 3]);
    assert.deepEqual(sim.evaluate('_.h.map(function (x) { return typeof x + x.length; })'), h.map(x => 'string' + x.length * 4));

    t.diagnostic(`hintajaksoja ${p[0].length} + ${p[1].length} (n. ${(p[0].length + p[1].length) * DEVICE.slot} B), historiarivejä ${h.map(i => i.length).join(' + ')}`);

    assert.ok(p[0].length <= 100 && p[1].length <= 100, 'enintään 100 hintajaksoa per päivä');
    assert.ok(p[0].concat(p[1]).every(v => Number.isInteger(v)), 'hinnat ovat kokonaislukuja');
    assert.ok(histRows <= 24, `historiassa on ${histRows} riviä (enintään 24 yhteensä)`);
    assert.ok(h.every(inst => inst.every(row => row.length === 3)), 'historiarivissä on kolme arvoa');
  });

  test('HTTP-vastaukset pysyvät rajoissa', (t) => {
    const sim = fullSetup();
    const sizes = {
      'r=s (tila)': sim.get('r=s&i=0').body.length,
      'r=h (historia)': sim.get('r=h&i=0').body.length,
      'r=c (asetukset)': sim.get('r=c&i=0').body.length
    };

    for (const name in sizes) {
      t.diagnostic(`${name}: ${sizes[name]} B`);
    }

    assert.ok(sizes['r=s (tila)'] <= 3000, `tilavastaus ${sizes['r=s (tila)']} B`);
    assert.ok(sizes['r=h (historia)'] <= 600, `historiavastaus ${sizes['r=h (historia)']} B`);
    assert.ok(sizes['r=c (asetukset)'] <= 400, `asetusvastaus ${sizes['r=c (asetukset)']} B`);
  });

  test('asetukset mahtuvat KVS:n arvon enimmäispituuteen', (t) => {
    //Shellyn dokumentaation mukaan KVS-arvon enimmäispituus on 253
    const sim = fullSetup();

    for (const [key, value] of sim.kvs) {
      t.diagnostic(`${key}: ${value.length} / 253 merkkiä`);
      assert.ok(value.length <= 253, `${key} on ${value.length} merkkiä`);
    }
  });

  test('dist: staattiset tiedostot ja skriptin koko pysyvät rajoissa', { skip: !fs.existsSync(DIST) && 'dist puuttuu (npm run build)' }, (t) => {
    const dist = fs.readFileSync(DIST, 'utf8');
    const statics = [...dist.matchAll(/atob\((["'])(.*?)\1\)/g)].map(m => m[2].length);
    const largest = Math.max(...statics);

    //MIKSI TÄMÄ RAJA ON:
    //Laitteen skriptimuisti on 25 186 tavua, ja suurin hetkellinen tarve on hintahaku (huippu noin 18,5 kt,
    //Cloudflaren isoilla otsakkeilla noin 20 kt). Sivutiedostot ovat skriptissä base64-vakioina. Kun laite
    //lähettää tiedoston selaimelle, muistissa on hetken sekä vakio että siitä purettu sisältö.
    //Tavoite: sivun lataus ei saa koskaan olla se, joka määrää muistihuipun. Siksi suurimman tiedoston
    //lähetyksen arvioitu tarve pidetään pienempänä kuin hintahaun (base64-vastaus ja otsikot, n. 10,4 kB).
    //Näin muistihuippu riippuu vain hintahausta, joka on mitattu ja jonka varmuusvara tunnetaan,
    //eikä käyttöliittymän tekstien lisääminen voi huomaamatta syödä tätä varaa.
    //Arvio on varovainen (laite ei välttämättä pidä molempia kopioita yhtä aikaa täysimääräisinä),
    //joten se tarkistetaan mittaamalla: Script.GetStatus -> mem_peak ennen ja jälkeen tiedoston haun.
    const transient = Math.round((largest + largest * 3 / 4) * DEVICE.char);
    const fetchTransient = Math.round(5160 * DEVICE.char + DEVICE.response);

    t.diagnostic(`skripti ${dist.length} B, staattisia ${statics.length} kpl, suurin ${largest} B base64`);
    t.diagnostic(`suurimman tiedoston palvelu: n. ${transient} B hetkellisesti (hintahaku n. ${fetchTransient} B)`);

    assert.equal(statics.length, 11);
    //Varaa pidetään 1000 B.
    //Historia: kun englanninkieliset käännökset olivat yhdessä tiedostossa (en.js, 4052-4168 B base64, arvio 9,8-10,1 kB),
    //varaa laskettiin mittausten perusteella kahdesti (1000 -> 500 -> 300). Mittauksissa (Gen 3 ja Gen 2)
    //tiedoston haku ei nostanut muistihuippua, mutta raja tuli silti vastaan, ja käännökset jaettiin
    //kahteen tiedostoon (en.js ja en-config.js) ja vara palautettiin 1000 B:hen.
    //Jos raja ylittyy, jaa suurin tiedosto - älä laske varaa.
    //Huomaa myös, että kaksi suurta tiedostoa yhtä aikaa nostaa huippua (mitattu yhdellä käännöstiedostolla:
    //en.js + s.js 18,9 kt, kaksi en.js-hakua 20,4 kt) - siksi sivu hakee käännökset yksi tiedosto kerrallaan
    //ennen muita tiedostoja (index.html ja openTab() tiedostossa s.js).
    assert.ok(transient <= fetchTransient - 1000, `suurimman staattisen tiedoston palvelu vie n. ${transient} B (raja ${fetchTransient - 1000} B)`);
    //Laitteen raja skriptin koolle on 65 535 tavua (mitattu laitteella). Lisäosaversiot ovat noin 6 kt pääskriptiä suurempia.
    assert.ok(dist.length <= 55000, `skriptin koko ${dist.length} B`);
  });
});
