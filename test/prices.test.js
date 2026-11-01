/**
 * Hintojen haun ja jäsennyksen testit
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { boot, assertAlive, near } = require('./helpers');
const { DEFAULT_HOURLY } = require('./sim/elering');

const urlOf = (entry) => decodeURIComponent(entry.url);

describe('hakujen ajoitus', () => {
  test('käynnistyessä haetaan tämän päivän hinnat', () => {
    const sim = boot({ start: '2026-10-05T10:00:00' });

    assert.equal(sim.fetchCount(), 1);
    assert.equal(
      sim.httpLog[0].url,
      'https://dashboard.elering.ee/api/nps/price/csv?fields=fi&start=2026-10-05T00:00:00%2b03:00&end=2026-10-05T23:59:59%2b03:00'
    );

    const st = sim.status(0);
    assert.equal(sim.rows(0).length, 24);
    assert.equal(sim.rows(1).length, 0);
    assert.equal(st.s.p[1].ts, 0);
  });

  test('huomisen hinnat haetaan klo 15', () => {
    const sim = boot({ start: '2026-10-05T10:00:00' });

    sim.advanceTo('2026-10-05T14:59:45');
    assert.equal(sim.fetchCount(), 1);

    sim.advanceTo('2026-10-05T15:02:55');
    assert.equal(sim.fetchCount(), 1, 'ei hakua ennen 3 minuuttia');

    sim.advanceTo('2026-10-05T15:03:30');
    assert.equal(sim.fetchCount(), 2);
    assert.match(urlOf(sim.httpLog[1]), /start=2026-10-06T00:00:00\+03:00&end=2026-10-06T23:59:59\+03:00/);

    const st = sim.status(0);
    assert.equal(sim.rows(1).length, 24);
    assert.equal(new Date(sim.rows(1)[0][0] * 1000).getDate(), 6);
  });

  test('klo 15 haku odottaa laitekohtaisen viiveen (3-5 min) eikä osu tasatunnin hakuihin', () => {
    //MAC päättyy A8 -> viive 180 + floor((168 * 173 mod 256) * 120 / 255) = 180 + 64 = 244 s
    const sim = boot({ start: '2026-10-05T14:59:00', mac: 'AABBCCDDEEA8' });
    assert.equal(sim.evaluate('fetchDelay'), 244);
    assert.equal(sim.fetchCount(), 1);

    sim.advanceTo('2026-10-05T15:03:55');
    assert.equal(sim.fetchCount(), 1, 'ei hakua ennen viivettä');

    sim.advanceTo('2026-10-05T15:04:15');
    assert.equal(sim.fetchCount(), 2, 'haku viiveen jälkeen');
    assert.match(urlOf(sim.httpLog[1]), /start=2026-10-06T00:00:00/);
    assert.ok(sim.httpLog[1].t >= new Date('2026-10-05T15:04:04').getTime(), 'haku aikaisintaan klo 15:04:04');
  });

  test('viive on 3-5 min (180-300 s) ja peräkkäiset MAC-osoitteet saavat kaukana toisistaan olevat viiveet', () => {
    const delays = ['A8', 'A9', 'AA', '00', 'FF', '24', '70'].map(b => boot({ mac: 'AABBCCDDEE' + b }).evaluate('fetchDelay'));
    //Eri tavut voivat saada saman viiveen (FF ja 24): 256 arvoa jaetaan 121 sekunnille
    assert.deepEqual(delays, [244, 204, 286, 180, 219, 219, 262]);
    for (const d of delays) assert.ok(d >= 180 && d <= 300);
    //Rajat: tavu 00 antaa tasan 3 min ja DB (219 * 173 mod 256 = 255) tasan 5 min
    assert.equal(boot({ mac: 'AABBCCDDEEDB' }).evaluate('fetchDelay'), 300);
  });

  test('keskiyön varmistushaku odottaa viiveen, ja huomisen hinnat ovat käytössä sillä välin', () => {
    const price = (e, d) => d.getDate() === 6 ? 20 : 5;
    const sim = boot({ start: '2026-10-05T18:00:00', mac: 'AABBCCDDEEA8', price, inst: { mode: 1, m1: { l: 10 } } });
    assert.equal(sim.fetchCount(), 2);
    assert.equal(sim.relays[0], true, 'tänään 5 c < 10 c');

    sim.advanceTo('2026-10-06T00:00:30');
    assert.equal(sim.fetchCount(), 2, 'ei hakua ennen viivettä');
    assert.equal(sim.status(0).s.p[0].now, 20, 'huomisen hinnat ovat jo päivän hintoja');
    assert.equal(sim.relays[0], false, 'ohjaus uuden päivän hinnan mukaan: 20 c > 10 c');

    sim.advanceTo('2026-10-06T00:03:55');
    assert.equal(sim.fetchCount(), 2, 'ei hakua ennen viivettä');

    sim.advanceTo('2026-10-06T00:04:15');
    assert.equal(sim.fetchCount(), 3, 'varmistushaku viiveen jälkeen');
    assert.match(urlOf(sim.httpLog[2]), /start=2026-10-06T00:00:00/);
  });

  test('keskiyöllä haetaan heti, jos päivälle ei ole hintoja', () => {
    //Huomisen haku epäonnistuu koko illan -> keskiyöllä on vain eilisen hinnat, eikä viive saa viivyttää hakua
    const sim = boot({ start: '2026-10-05T14:00:00', mac: 'AABBCCDDEEA8' });
    sim.advanceTo('2026-10-05T14:59:00');
    sim.net.mode = 'error';
    sim.advanceTo('2026-10-05T23:59:55');
    assert.equal(sim.prices(1).length, 0, 'huomisen hintoja ei saatu');

    //Verkko palaa juuri ennen keskiyötä. Virhetauko nollataan, jotta se ei sekoitu viiveeseen
    sim.net.mode = 'ok';
    sim.evaluate('_.s.errCnt = 0');
    const before = sim.fetchCount();
    sim.advanceTo('2026-10-06T00:00:05');
    assert.equal(sim.fetchCount(), before + 1, 'haku heti keskiyön ensimmäisellä kierroksella');
    assert.match(urlOf(sim.httpLog[sim.httpLog.length - 1]), /start=2026-10-06T00:00:00/);
    assert.ok(sim.status(0).s.p[0].ts > 0 && sim.prices(0).length > 0, 'tämän päivän hinnat käytössä');
  });

  test('käynnistyessä haetaan heti myös tasatunnin jälkeen', () => {
    const sim = boot({ start: '2026-10-06T00:00:05', mac: 'AABBCCDDEEA8' });
    assert.equal(sim.fetchCount(), 1, 'tämän päivän hinnat heti');
    const sim2 = boot({ start: '2026-10-05T15:00:05', mac: 'AABBCCDDEEA8' });
    assert.equal(sim2.fetchCount(), 1, 'tämän päivän hinnat heti, huomisen vasta viiveen jälkeen');
    sim2.advanceTo('2026-10-05T15:04:15');
    assert.equal(sim2.fetchCount(), 2);
  });

  test('klo 15 jälkeen käynnistyessä haetaan molemmat päivät', () => {
    const sim = boot({ start: '2026-10-05T18:00:00' });
    assert.equal(sim.fetchCount(), 2);
    assert.equal(sim.rows(1).length, 24);
  });

  test('vuorokauden vaihtuessa haetaan uudet hinnat ja huomisen hinnat tyhjennetään', () => {
    const sim = boot({ start: '2026-10-05T18:00:00' });

    sim.advanceTo('2026-10-06T00:03:30');
    assert.equal(sim.fetchCount(), 3);
    assert.match(urlOf(sim.httpLog[2]), /start=2026-10-06T00:00:00/);

    const st = sim.status(0);
    assert.equal(new Date(sim.rows(0)[0][0] * 1000).getDate(), 6);
    assert.equal(sim.rows(1).length, 0);
  });

  test('normaalipäivänä tehdään kaksi hakua', () => {
    const sim = boot({ start: '2026-10-05T23:59:00' });
    const before = sim.fetchCount();

    sim.advanceTo('2026-10-06T23:59:00');
    assert.equal(sim.fetchCount() - before, 2);
  });

  test('talviajalla aikavyöhyke on +02:00', () => {
    const sim = boot({ start: '2026-12-01T10:00:00' });
    assert.match(urlOf(sim.httpLog[0]), /start=2026-12-01T00:00:00\+02:00/);
    assert.equal(sim.status(0).s.tz, '+02:00');
    assert.equal(sim.status(0).s.tzh, 2);
  });

  test('maan valinta välittyy pyyntöön', () => {
    const sim = boot({ common: { g: 'ee' } });
    assert.match(sim.httpLog[0].url, /fields=ee&/);
  });

  test('yli 5 minuutin kellonajan hyppäys hakee hinnat uudelleen', () => {
    const sim = boot({ start: '2026-10-05T10:00:00' });
    assert.equal(sim.fetchCount(), 1);

    sim.setTime('2026-10-05T10:04:00');
    sim.settle();
    assert.equal(sim.fetchCount(), 1, 'alle 5 min hyppäys ei vaikuta');

    sim.setTime('2026-10-05T10:30:00');
    sim.settle();
    assert.equal(sim.fetchCount(), 2);
  });

  test('asetusten tallennus ei hae hintoja uudelleen', () => {
    //Hinnat tallennetaan raakahintoina, joten ALV ja siirtohinnat lasketaan niistä ilman uutta hakua
    const sim = boot({ start: '2026-10-05T18:00:00', price: () => 10 });
    assert.equal(sim.fetchCount(), 2);
    assert.equal(sim.rows(0)[12][1], 10);

    sim.saveConfig(0, { mode: 0 }, { vat: 10, day: 1 });
    assert.equal(sim.fetchCount(), 2);
    assert.equal(sim.rows(0)[12][1], 12);
    assert.equal(sim.status(0).s.p[0].avg, 11 + 15 / 24, 'tunnusluvut päivittyvät');
    assert.equal(sim.status(0).s.p[1].high, 12);
  });

  test('ALV:n ja siirtohinnan muutos vaikuttaa ohjaukseen heti ilman uutta hakua', () => {
    //Hinta 10 c/kWh ja raja 11 c/kWh -> päällä. ALV 25,5 % nostaa hinnan 12,55:een -> pois.
    const sim = boot({ start: '2026-10-05T10:00:00', price: () => 10, inst: { mode: 1, m1: { l: 11 } } });
    assert.equal(sim.relays[0], true);
    assert.equal(sim.status(0).s.p[0].now, 10);

    sim.saveConfig(0, {}, { vat: 25.5 });
    assert.equal(sim.fetchCount(), 1);
    assert.equal(sim.status(0).s.p[0].now, 12.55);
    assert.equal(sim.relays[0], false);

    //Yösiirto ei vaikuta päivätuntiin, päiväsiirto vaikuttaa
    sim.saveConfig(0, {}, { vat: 0, night: 5 });
    assert.equal(sim.relays[0], true);
    sim.saveConfig(0, {}, { day: 1.5 });
    assert.equal(sim.status(0).s.p[0].now, 11.5);
    assert.equal(sim.relays[0], false);
  });

  test('tuntihintojen välimuisti päivittyy hintojen vaihtuessa', () => {
    //Hinta riippuu päivästä: 5.10. = 1 c, 6.10. = 20 c. Raja 10 c.
    const price = (e, d) => d.getDate() === 5 ? 1 : 20;
    const sim = boot({ start: '2026-10-05T14:50:00', price, inst: { mode: 1, m1: { l: 10 } } });
    assert.equal(sim.relays[0], true);
    assert.equal(sim.evaluate('hourly.length'), 24);

    //Huomisen hintojen haku ei sotke tämän päivän ohjausta
    sim.advanceTo('2026-10-05T16:30:00');
    assert.equal(sim.relays[0], true);
    assert.equal(sim.status(0).s.p[0].now, 1);

    //Vuorokauden vaihtuessa käytetään uuden päivän hintoja
    sim.advanceTo('2026-10-06T00:30:00');
    assert.equal(sim.status(0).s.p[0].now, 20);
    assert.equal(sim.relays[0], false);
  });

  test('tuntihintojen välimuisti ei ole muistissa hintahaun aikana', () => {
    const sim = boot({ start: '2026-10-05T14:59:00', inst: { mode: 1, m1: { l: 10 } } });
    sim.net.delay = 4000;
    assert.equal(sim.evaluate('hourly.length'), 24);

    //Huomisen hintojen haku käynnissä (alkaa viiveen jälkeen klo 15:03:00)
    sim.advanceTo('2026-10-05T15:03:02');
    assert.equal(sim.fetchCount(), 2);
    assert.equal(sim.evaluate('hourly.length'), 0);

    //Seuraava logiikka-ajo laskee välimuistin uudelleen
    sim.advanceTo('2026-10-05T16:01:00');
    assert.equal(sim.evaluate('hourly.length'), 24);
  });

  test('maan vaihtaminen hakee hinnat uudelleen', () => {
    const sim = boot({ start: '2026-10-05T18:00:00' });
    assert.equal(sim.fetchCount(), 2);

    sim.saveConfig(0, {}, { g: 'ee' });
    assert.equal(sim.fetchCount(), 4);
    assert.match(sim.httpLog[3].url, /fields=ee&/);
    assert.equal(sim.rows(0).length, 24);
  });
});

describe('hintojen jäsennys', () => {
  test('tuntihinnat ja tunnusluvut', () => {
    const sim = boot({ start: '2026-10-05T13:20:00' });
    const st = sim.status(0);

    assert.deepEqual(sim.rows(0).map(r => r[1]), DEFAULT_HOURLY);
    sim.rows(0).forEach((row, h) => {
      const d = new Date(row[0] * 1000);
      assert.equal(d.getHours(), h);
      assert.equal(d.getMinutes(), 0);
    });

    assert.equal(st.s.p[0].now, 5);
    assert.equal(st.s.p[0].low, 1);
    assert.equal(st.s.p[0].high, 16);
    near(st.s.p[0].avg, DEFAULT_HOURLY.reduce((a, b) => a + b) / 24, 'keskiarvo');
  });

  test('15 minuutin hinnoista lasketaan tunnin keskiarvo', () => {
    //tunnin h vartit: h, h+1, h+2, h+3 -> keskiarvo h + 1.5
    const price = (e, d) => d.getHours() + d.getMinutes() / 15;
    const sim = boot({ start: '2026-10-05T10:00:00', price, resolution: 15 });
    const st = sim.status(0);

    assert.equal(sim.rows(0).length, 24);
    sim.rows(0).forEach((row, h) => near(row[1], h + 1.5, `tunti ${h}`));
    near(st.s.p[0].now, 11.5, 'nykyinen hinta');
  });

  test('tuntiresoluution data toimii myös', () => {
    const sim = boot({ start: '2026-10-05T10:00:00', resolution: 60 });
    assert.deepEqual(sim.rows(0).map(r => r[1]), DEFAULT_HOURLY);
  });

  test('ALV lisätään vain positiivisiin hintoihin', () => {
    const price = (e, d) => d.getHours() === 3 ? -2 : 10;
    const sim = boot({ price, common: { vat: 25.5 } });
    const p = sim.rows(0);

    near(p[3][1], -2, 'negatiivinen hinta');
    near(p[4][1], 12.55, 'positiivinen hinta');
  });

  test('siirtohinnat: päivä 07-22, yö 22-07', () => {
    const sim = boot({ price: () => 10, common: { vat: 0, day: 3, night: 1 } });
    const p = sim.rows(0);

    near(p[6][1], 11, '06 on yötä');
    near(p[7][1], 13, '07 on päivää');
    near(p[21][1], 13, '21 on päivää');
    near(p[22][1], 11, '22 on yötä');
    near(p[0][1], 11, '00 on yötä');
  });

  test('ALV ja siirto yhdessä', () => {
    const sim = boot({ price: () => 4, common: { vat: 25.5, day: 5.5, night: 2.5 } });
    const p = sim.rows(0);

    near(p[12][1], 4 * 1.255 + 5.5);
    near(p[2][1], 4 * 1.255 + 2.5);
  });

  test('oikea Elering-vastaus (3.10.2026) jäsentyy oikein', () => {
    const csv = fs.readFileSync(path.join(__dirname, 'fixtures', 'elering-fi-2026-10-03.csv'), 'latin1');

    //Riippumaton laskenta suoraan tiedostosta
    const expected = [];
    csv.trim().split('\n').slice(1).forEach(line => {
      const cols = line.split(';').map(c => c.replace(/"/g, ''));
      const hour = new Date(Number(cols[0]) * 1000).getHours();
      expected[hour] = expected[hour] ?? { ts: Number(cols[0]), sum: 0, n: 0 };
      expected[hour].sum += Number(cols[2].replace(',', '.'));
      expected[hour].n++;
    });

    const sim = boot({ start: '2026-10-03T10:00:00', settle: false });
    sim.net.body = () => csv;
    sim.settle();
    assertAlive(sim);

    const st = sim.status(0);
    assert.equal(sim.rows(0).length, 24);

    sim.rows(0).forEach((row, h) => {
      assert.equal(row[0], expected[h].ts, `tunnin ${h} aikaleima`);
      near(row[1], expected[h].sum / expected[h].n / 10, `tunnin ${h} hinta`);
    });

    near(st.s.p[0].now, expected[10].sum / 4 / 10, 'nykyinen hinta');
    assert.equal(st.s.errCnt, 0);
  });

  test('kesäaikaan siirtymispäivänä (23 h) hinnat saadaan ja ohjaus toimii', () => {
    const sim = boot({ start: '2026-03-29T10:00:00', inst: { mode: 1, m1: { l: 999 } } });
    const st = sim.status(0);

    //Hintojen tarkka sisältö tänä päivänä: ks. known-issues.test.js
    assert.equal(st.s.errCnt, 0);
    assert.equal(st.s.p[0].now, DEFAULT_HOURLY[10]);
    assert.equal(sim.relays[0], true);
  });
});

describe('hintojen tallennusmuoto', () => {
  test('tilavastauksessa on raakahinnat, alkuhetki ja jakson pituus', () => {
    const sim = boot({ start: '2026-10-05T10:00:00', price: (e, d) => d.getHours() + d.getMinutes() / 100 });
    const st = sim.status(0);

    assert.equal(st.p[0].length, 96);
    assert.equal(st.s.p[0].sl, 900);
    assert.equal(st.s.p[0].st, Math.floor(new Date('2026-10-05T00:00:00').getTime() / 1000));

    //Raakahinta on kokonaisluku yksikössä 0,01 EUR/MWh: 10,15 c/kWh = 101,5 EUR/MWh = 10150
    assert.equal(st.p[0][41], 10150);
    assert.ok(st.p[0].every(v => Number.isInteger(v)));
    assert.deepEqual(st.p[1], []);
  });

  test('tuntiresoluution datassa on 24 jaksoa', () => {
    const sim = boot({ start: '2026-10-05T10:00:00', resolution: 60 });
    const st = sim.status(0);

    assert.equal(st.p[0].length, 24);
    assert.equal(st.s.p[0].sl, 3600);
  });

  test('negatiiviset hinnat ja desimaalit säilyvät tarkasti', () => {
    const csvPrices = ['-0,01', '0', '0,5', '-500', '4000', '31,93', '30,7', '28'];
    const sim = boot({ start: '2026-10-05T10:00:00', settle: false });
    sim.net.body = (url) => {
      const start = Math.floor(new Date('2026-10-05T00:00:00').getTime() / 1000);
      let rows = ['"Ajatempel (UTC)";"Kuupaev (Eesti aeg)";"NPS Soome"'];
      for (let i = 0; i < 96; i++) {
        rows.push(`"${start + i * 900}";"05.10.2026 00:00";"${csvPrices[i % csvPrices.length]}"`);
      }
      return rows.join('\n') + '\n';
    };
    sim.settle();

    assert.deepEqual(sim.status(0).p[0].slice(0, 8), [-1, 0, 50, -50000, 400000, 3193, 3070, 2800]);
  });

  test('viimeinen rivi luetaan, vaikka sen perässä ei ole rivinvaihtoa', () => {
    const sim = boot({ start: '2026-10-05T10:00:00', settle: false });
    sim.net.trailingNewline = false;
    sim.settle();

    assert.equal(sim.status(0).p[0].length, 96);
    assert.equal(sim.rows(0).length, 24);
    assert.equal(sim.rows(0)[23][1], DEFAULT_HOURLY[23]);
  });

  test('puuttuva rivi korvataan edellisellä hinnalla', () => {
    const sim = boot({ start: '2026-10-05T10:00:00', settle: false, price: (e, d) => d.getHours() });
    const original = sim.net.body;
    sim.net.body = null;
    const { eleringCsv } = require('./sim/elering');
    //Poistetaan klo 05:15 ja 05:30 rivit
    sim.net.body = (url) => eleringCsv(url, sim.net).split('\n').filter(l => !l.includes(' 05:15"') && !l.includes(' 05:30"')).join('\n');
    sim.settle();
    assertAlive(sim);

    const p = sim.status(0).p[0];
    assert.equal(p.length, 96, 'jaksot pysyvät paikoillaan');
    assert.deepEqual(p.slice(19, 25), [4000, 5000, 5000, 5000, 5000, 6000]);
    assert.equal(sim.status(0).s.errCnt, 0);
  });

  for (const [name, mutate] of Object.entries({
    'rivit väärässä järjestyksessä': (lines) => { const t = lines[10]; lines[10] = lines[11]; lines[11] = t; },
    'sama rivi kahdesti': (lines) => { lines.splice(10, 0, lines[10]); },
    'aikaleima ei ole luku': (lines) => { lines[10] = lines[10].replace(/^"\d+"/, '"abc"'); },
    'hinta ei ole luku': (lines) => { lines[10] = lines[10].replace(/"[^"]*"$/, '"n/a"'); },
    'epätasainen aikaväli': (lines) => { lines[10] = lines[10].replace(/^"(\d+)"/, (m, e) => `"${Number(e) + 60}"`); }
  })) {
    test(`virheellinen data hylätään: ${name}`, () => {
      const { eleringCsv } = require('./sim/elering');
      const sim = boot({ start: '2026-10-05T10:00:00', settle: false });
      sim.net.body = (url) => {
        const lines = eleringCsv(url, sim.net).split('\n');
        mutate(lines);
        return lines.join('\n');
      };
      sim.settle(8000);
      assertAlive(sim);

      assert.ok(sim.evaluate('_.s.errCnt') >= 1);
      assert.equal(sim.prices(0).length, 0);
    });
  }
});

describe('vanhat hinnat varalla', () => {
  test('vuorokauden vaihtuessa huomisen hinnat siirtyvät tälle päivälle ja haetaan silti uudelleen', () => {
    const sim = boot({ start: '2026-10-05T18:00:00', inst: { mode: 2, m2: { p: 24, c: 4 } } });
    const tomorrow = sim.status(0).p[1];
    sim.net.delay = 5000;

    //Heti vuorokauden vaihduttua haku on vielä kesken, mutta hinnat ovat jo käytössä
    sim.advanceTo('2026-10-06T00:00:03');
    assert.deepEqual(sim.prices(0), tomorrow);
    assert.deepEqual(sim.prices(1), []);
    assert.equal(sim.evaluate('_.s.p[0].ts'), 0, 'uusi haku on pyydetty');

    sim.advanceTo('2026-10-06T00:04:00');
    assert.equal(sim.fetchCount(), 3);
    assert.ok(sim.status(0).s.p[0].ts > 0);
  });

  test('nettikatko vuorokauden yli: ohjaus jatkuu hinnoilla ja palautuu kun yhteys palaa', () => {
    const sim = boot({ start: '2026-10-05T18:00:00', inst: { mode: 2, m2: { p: 24, c: 4 } } });
    sim.net.mode = 'error';

    sim.advanceTo('2026-10-06T02:30:00');
    assertAlive(sim);
    assert.equal(sim.relays[0], true, '02:30 on halvimpia tunteja');
    assert.equal(sim.status(0).si.st, 5);
    assert.equal(sim.status(0).s.p[0].ts, 0);

    sim.net.mode = 'ok';
    sim.advanceTo('2026-10-06T02:40:00');
    assert.ok(sim.status(0).s.p[0].ts > 0, 'hinnat haettu uudelleen');
    assert.equal(sim.relays[0], true);
  });

  test('kahden vuorokauden katkon jälkeen siirrytään varmuustunneille', () => {
    const sim = boot({ start: '2026-10-05T18:00:00', inst: { mode: 2, m2: { p: 24, c: 4 }, b: 0 } });
    sim.net.mode = 'error';

    sim.advanceTo('2026-10-07T02:30:00');
    assertAlive(sim);
    assert.equal(sim.status(0).si.st, 7, 'hintoja ei ole tälle päivälle');
    assert.equal(sim.relays[0], false);
    assert.equal(sim.prices(0).length, 0, 'vanhentuneet hinnat on poistettu');
  });

  test('epäonnistunut haku ei hukkaa käytössä olevia hintoja', () => {
    const sim = boot({ start: '2026-10-05T10:00:00', inst: { mode: 1, m1: { l: 999 } } });
    const prices = sim.status(0).p[0];

    //Kellon hyppäys alle vuorokauden sisällä pyytää uuden haun, joka epäonnistuu
    sim.net.mode = 500;
    sim.evaluate('(_.s.p[0].ts = 0)');
    sim.advance(5 * 60e3);

    assert.deepEqual(sim.prices(0), prices);
    assert.equal(sim.status(0).si.st, 2);
    assert.equal(sim.relays[0], true);
  });
});

describe('kellonsiirtopäivät oikealla Elering-datalla', () => {
  //Vastaukset on haettu Eleringiltä samoilla pyynnöillä, jotka laite tekee: laite käyttää pyynnössä
  //sitä aikavyöhykettä, joka on voimassa hakuhetkellä (ennen kellonsiirtoa tai sen jälkeen)
  const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'latin1');

  /**
   * Palauttaa oikean vastauksen pyynnön mukaan.
   * v10: kellonsiirtopäivän pyyntö on tunnin pidempi kummastakin päästä. Sen vastaus on molempien tallennettujen
   * vastausten rivit yhdistettynä (ne kattavat yhdessä koko päivän; viereisten päivien tunnit jäävät pois kuten
   * skriptin suodatuksessakin)
   */
  const dstBody = (day) => (url) => {
    if (!url.includes(`start=${day}T00:00:00`)) {
      //Muut päivät (huomisen hinnat klo 15 jälkeen): simulaattorin oletusvastaus
      return null;
    }
    const a = fixture(`elering-fi-${day}-ennen-kellonsiirtoa.csv`).trim().split('\n');
    const b = fixture(`elering-fi-${day}-kellonsiirron-jalkeen.csv`).trim().split('\n');
    const rows = [...new Set(a.slice(1).concat(b.slice(1)))].sort((x, y) => Number(x.split('"')[1]) - Number(y.split('"')[1]));
    return [a[0]].concat(rows).join('\n') + '\n';
  };

  test('kesäaikaan siirtyminen 29.3.2026, haku ennen kellonsiirtoa: pyyntö tunnin pidempi, muiden päivien tunnit jätetään pois', () => {
    const sim = boot({ start: '2026-03-29T00:30:00', settle: false });
    sim.net.body = dstBody('2026-03-29');
    sim.settle();
    assertAlive(sim);

    assert.match(sim.httpLog[0].url, /start=2026-03-29T00:00:00%2b03:00&end=2026-03-29T23:59:59%2b01:00/);
    const st = sim.status(0);
    assert.equal(st.p[0].length, 92, 'päivässä on 23 tuntia');
    assert.equal(new Date(st.s.p[0].st * 1000).toISOString(), '2026-03-28T22:00:00.000Z');
    assert.equal(st.s.errTot, 0);
  });

  test('kesäaikaan siirtyminen 29.3.2026, haku kellonsiirron jälkeen: muiden päivien tunnit jätetään pois', () => {
    const sim = boot({ start: '2026-03-29T10:00:00', settle: false });
    sim.net.body = dstBody('2026-03-29');
    sim.settle();
    assertAlive(sim);

    assert.match(sim.httpLog[0].url, /start=2026-03-29T00:00:00%2b04:00&end=2026-03-29T23:59:59%2b02:00/);
    const st = sim.status(0);
    assert.equal(st.p[0].length, 92);
    assert.equal(new Date(st.s.p[0].st * 1000).toISOString(), '2026-03-28T22:00:00.000Z');
    assert.equal(sim.rows(0).length, 23);
  });

  test('kesäaikaan siirtyminen 29.3.2026: ohjaus toimii hinnan mukaan koko päivän', () => {
    const sim = boot({ start: '2026-03-29T00:30:00', inst: { mode: 1, m1: { l: 999 }, b: 0 }, settle: false });
    sim.net.body = dstBody('2026-03-29');
    //Näyte jokaiselta tunnilta klo xx:31 (päivässä on 23 tuntia)
    const start = sim.now().getTime() + 60e3;

    for (let h = 0; h < 23; h++) {
      sim.advanceTo(new Date(start + h * 3600e3));
      assertAlive(sim);
      assert.equal(sim.status(0).si.st, 2, `tunti ${h}`);
      assert.equal(sim.status(0).p[0].length, 92, `tunti ${h}`);
    }
    assert.equal(sim.now().getHours(), 23);
    assert.equal(sim.status(0).s.errTot, 0);
  });

  test('talviaikaan siirtyminen 26.10.2025: ohjaus toimii hinnan mukaan kaikilla 25 tunnilla', () => {
    const sim = boot({ start: '2025-10-26T00:30:00', inst: { mode: 1, m1: { l: 999 }, b: 0 }, settle: false });
    sim.net.body = dstBody('2025-10-26');
    sim.settle();

    //v10: jo ennen kellonsiirtoa haetuissa hinnoissa on kaikki 25 tuntia (aiemmin päivän viimeinen tunti puuttui)
    assert.match(sim.httpLog[0].url, /start=2025-10-26T00:00:00%2b04:00&end=2025-10-26T23:59:59%2b02:00/);
    assert.equal(sim.status(0).p[0].length, 100);
    assert.equal(new Date(sim.status(0).s.p[0].st * 1000).toISOString(), '2025-10-25T21:00:00.000Z');

    //Näyte jokaiselta tunnilta klo xx:31 (päivässä on 25 tuntia)
    const start = sim.now().getTime() + 30e3;
    for (let h = 0; h < 25; h++) {
      sim.advanceTo(new Date(start + h * 3600e3));
      assertAlive(sim);
      assert.equal(sim.status(0).si.st, 2, `tunti ${h}`);
      assert.equal(sim.relays[0], true, `tunti ${h}`);
    }

    //v10: kellonsiirto ei hae hintoja uudelleen (aiemmin haku kellonsiirron jälkeen jätti päivän ensimmäisen tunnin pois)
    assert.equal(sim.now().getHours(), 23);
    const requests = sim.httpLog.filter(h => h.url.includes('start=2025-10-26'));
    assert.equal(requests.length, 1, 'yksi haku koko päivänä');
    const rows = sim.rows(0);
    assert.equal(rows.length, 25);
    assert.equal(new Date(rows[0][0] * 1000).toISOString(), '2025-10-25T21:00:00.000Z');
    assert.equal(new Date(rows[rows.length - 1][0] * 1000).toISOString(), '2025-10-26T21:00:00.000Z');
    assert.equal(sim.status(0).s.errTot, 0);
  });
});

describe('virhetilanteet', () => {
  test('epäonnistuneet haut lasketaan ja ensimmäisen ja viimeisen virheen aika tallennetaan', () => {
    const sim = boot({ start: '2026-10-05T10:00:00' });
    let s = sim.status(0).s;
    assert.equal(s.errTot, 0);
    assert.equal(s.errT0, 0);

    //Katko alkaa ennen huomisen hintojen hakua
    sim.net.mode = 'error';
    sim.advanceTo('2026-10-05T15:03:30');
    s = sim.status(0).s;
    assert.equal(s.errTot, 3, 'kolme yritystä ennen taukoa');
    assert.equal(new Date(s.errT0 * 1000).getHours(), 15);
    const first = s.errT0;

    sim.advanceTo('2026-10-05T15:30:00');
    s = sim.status(0).s;
    //3 yritystä noin 5 s välein, sitten 2 min välein kolmesti ja 10 min välein: puolessa tunnissa 8 yritystä (ks. uusintayritysten testi)
    assert.equal(s.errTot, 8, `yrityksiä ${s.errTot}`);
    assert.equal(s.errT0, first, 'ensimmäisen virheen aika ei muutu');
    assert.ok(s.errTs > first);

    //Yhteys palaa -> kokonaislaskuri ja ajat säilyvät, aktiivinen virhelaskuri nollautuu onnistuneesta hausta
    sim.net.mode = 'ok';
    sim.advanceTo('2026-10-05T16:00:00');
    const after = sim.status(0).s;
    assert.equal(sim.rows(1).length, 24);
    assert.equal(after.errCnt, 0, 'onnistunut haku nollaa aktiivisen laskurin');

    sim.advanceTo('2026-10-06T10:00:00');
    const next = sim.status(0).s;
    assert.equal(next.errTot, after.errTot, 'onnistuneet haut eivät muuta laskuria');
    assert.equal(next.errT0, first);
    assert.equal(next.errTs, after.errTs);
  });

  test('kellon siirtyminen taaksepäin virheiden jälkeen ei estä hintojen hakua', () => {
    //Laitteella todettu: virheen aikaleima jäi tulevaisuuteen, jolloin virhetauko ei päättynyt koskaan
    const sim = boot({ start: '2026-10-05T10:00:00', inst: { mode: 1, m1: { l: 999 } } });

    //Kello hyppää kauas eteenpäin (hintoja ei ole) -> virheitä
    sim.net.maxHours = 0;
    sim.setTime('2027-03-28T10:00:00');
    sim.advance(60e3);
    assert.equal(sim.evaluate('_.s.errCnt'), 3);

    //Kello korjaantuu takaisin -> hinnat haetaan heti
    sim.net.maxHours = null;
    sim.setTime('2026-10-05T10:05:00');
    sim.advance(60e3);
    assertAlive(sim);

    const st = sim.status(0);
    assert.equal(st.p[0].length, 96);
    assert.equal(st.si.st, 2);
    assert.equal(sim.relays[0], true);
    assert.ok(st.s.errTot >= 3, 'virhetilasto säilyy');
  });

  test('virhelaskuri pysähtyy enimmäisarvoon', () => {
    const sim = boot({ start: '2026-10-05T10:00:00' });
    sim.evaluate('(_.s.errTot = 999998)');
    sim.net.mode = 'error';
    sim.evaluate('(_.s.p[0].ts = 0)');
    sim.advance(10 * 60e3);

    assert.equal(sim.status(0).s.errTot, 999999);
  });

  test('uusintayritykset: 3 yritystä, 2 min tauot, sitten 10 min tauot', () => {
    const sim = boot({ start: '2026-10-05T10:00:00', settle: false });
    sim.net.mode = 'error';

    sim.advance(60e3);
    assertAlive(sim);
    assert.equal(sim.fetchCount(), 3, 'kolme yritystä noin 5 s välein');
    assert.equal(sim.status(0).s.errCnt, 3);

    //Yritysten välit: kolme noin 5 s välein (uusi yritys 5 s epäonnistumisen jälkeen), sitten 2 min tauko kolmesti,
    //sen jälkeen 10 min tauot. Tauko lasketaan viimeisestä virheestä, ja haku alkaa seuraavalla kierroksella (10 s)
    const t0 = sim.httpLog[0].t;
    sim.advanceTo(new Date(t0 + 1700e3));
    const times = sim.httpLog.map(h => (h.t - t0) / 1000);
    assert.equal(times.length, 8, `yrityksiä ${times.length}: ${times.join(', ')}`);
    const gaps = times.slice(1).map((t, i) => t - times[i]);
    //Virheen aika on sekunnin tarkkuudella, joten väli voi olla hieman alle 5 s
    assert.ok(gaps[0] >= 4 && gaps[0] < 12 && gaps[1] >= 4 && gaps[1] < 12, `nopeat yritykset noin 5 s välein: ${gaps}`);
    for (const g of gaps.slice(2, 5)) assert.ok(g >= 120 && g < 135, `2 min tauko: ${g}`);
    for (const g of gaps.slice(5)) assert.ok(g >= 600 && g < 615, `10 min tauko: ${g}`);
    assert.equal(sim.status(0).s.errCnt, 8);

    //Tauon aikana ei haeta: juuri ennen seuraavaa yritystä
    const last = sim.httpLog[7].t;
    sim.advanceTo(new Date(last + 595e3));
    assert.equal(sim.fetchCount(), 8, 'tauon aikana ei haeta');
    sim.advanceTo(new Date(last + 620e3));
    assert.equal(sim.fetchCount(), 9, 'seuraava yritys 10 min tauon jälkeen');
  });

  test('onnistunut haku aloittaa uusintayritykset alusta', () => {
    const sim = boot({ start: '2026-10-05T10:00:00', settle: false });
    sim.net.mode = 'error';
    sim.advance(10 * 60e3);
    assert.equal(sim.status(0).s.errCnt, 6, 'pitkä tauko alkanut');

    sim.net.mode = 'ok';
    sim.advance(10 * 60e3);
    assertAlive(sim);
    assert.equal(sim.rows(0).length, 24);
    assert.equal(sim.status(0).s.errCnt, 0);

    //Uusi katko: taas kolme nopeaa yritystä
    sim.net.mode = 'error';
    sim.evaluate('(_.s.p[0].ts = 0)');
    const before = sim.fetchCount();
    sim.advance(60e3);
    assert.equal(sim.fetchCount(), before + 3);
  });

  test('maan vaihto katkon aikana hakee heti', () => {
    const sim = boot({ start: '2026-10-05T10:00:00' });
    sim.net.mode = 'error';
    sim.evaluate('(_.s.p[0].ts = 0)');
    sim.advance(10 * 60e3);
    assert.ok(sim.status(0).s.errCnt >= 6, 'pitkä tauko päällä');
    const before = sim.fetchCount();

    sim.net.mode = 'ok';
    sim.saveConfig(0, {}, { g: 'ee' });
    sim.advance(30e3);
    assertAlive(sim);
    assert.equal(sim.fetchCount(), before + 1, 'haku heti maan vaihdon jälkeen');
    assert.match(urlOf(sim.httpLog[sim.httpLog.length - 1]), /fields=ee/);
    assert.equal(sim.status(0).s.errCnt, 0);
  });

  test('vuorokauden vaihtuminen katkossa hakee uuden päivän hinnat heti', () => {
    //Katko alkaa ennen klo 15, huomisen hintoja ei saada -> keskiyöllä ei ole hintoja
    const sim = boot({ start: '2026-10-05T14:00:00' });
    sim.net.mode = 'error';
    sim.advanceTo('2026-10-05T23:50:00');
    assert.ok(sim.status(0).s.errCnt >= 6, 'pitkä tauko päällä');
    assert.equal(sim.prices(1).length, 0);

    //Viimeinen epäonnistunut yritys juuri ennen keskiyötä: ilman nollausta seuraava yritys olisi vasta 00:08
    sim.advanceTo('2026-10-05T23:58:00');
    sim.evaluate(`(_.s.errTs = ${Math.floor(new Date('2026-10-05T23:58:00').getTime() / 1000)})`);
    const before = sim.fetchCount();
    sim.advanceTo('2026-10-05T23:59:50');
    assert.equal(sim.fetchCount(), before, 'tauko on voimassa ennen keskiyötä');

    //Elering on palannut
    sim.net.mode = 'ok';
    sim.advanceTo('2026-10-06T00:00:15');
    assert.equal(sim.fetchCount(), before + 1, 'haku heti keskiyön jälkeen');
    assert.match(urlOf(sim.httpLog[before]), /start=2026-10-06T00:00:00/);
    assert.equal(sim.status(0).s.errCnt, 0);
    assert.ok(sim.prices(0).length > 0, 'uuden päivän hinnat käytössä');
  });

  test('aktiivinen virhelaskuri pysähtyy arvoon 7999', () => {
    const sim = boot({ start: '2026-10-05T10:00:00' });
    sim.evaluate('(_.s.errCnt = 7998)');
    sim.net.mode = 'error';
    sim.evaluate('(_.s.p[0].ts = 0)');
    sim.advance(25 * 60e3);
    assert.equal(sim.status(0).s.errCnt, 7999);
  });

  test('haku onnistuu kun yhteys palaa', () => {
    const sim = boot({ start: '2026-10-05T10:00:00', inst: { mode: 1, m1: { l: 999 } }, settle: false });
    sim.net.mode = 'error';
    sim.advance(60e3);
    assert.equal(sim.status(0).si.st, 7);
    assert.equal(sim.relays[0], false);

    sim.net.mode = 'ok';
    sim.advance(180e3);
    assertAlive(sim);

    const st = sim.status(0);
    assert.equal(sim.rows(0).length, 24);
    assert.equal(st.si.st, 2);
    assert.equal(sim.relays[0], true);
  });

  test('HTTP-virhekoodi tulkitaan virheeksi', () => {
    const sim = boot({ settle: false });
    sim.net.mode = 500;
    sim.settle(8000);
    assertAlive(sim);
    assert.ok(sim.status(0).s.errCnt >= 1);
    assert.equal(sim.rows(0).length, 0);
  });

  test('aikakatkaisu tulkitaan virheeksi', () => {
    const sim = boot({ settle: false });
    sim.net.mode = 'timeout';

    //Pyynnön aikakatkaisu on 5 s
    sim.advance(4500);
    assert.equal(sim.evaluate('_.s.errCnt'), 0);

    sim.advance(2000);
    assertAlive(sim);
    assert.equal(sim.evaluate('_.s.errCnt'), 1);
    assert.equal(sim.evaluate('_.s.p[0].ts'), 0);
  });

  test('vajaa data (alle 23 tuntia) hylätään', () => {
    const sim = boot({ settle: false });
    sim.net.maxHours = 20;
    sim.settle(8000);
    assertAlive(sim);

    const st = sim.status(0);
    assert.ok(st.s.errCnt >= 1);
    assert.equal(sim.rows(0).length, 0);
    assert.equal(st.s.p[0].ts, 0);
  });

  test('tyhjä vastaus hylätään', () => {
    const sim = boot({ settle: false });
    sim.net.body = () => '';
    sim.settle(8000);
    assertAlive(sim);
    assert.ok(sim.status(0).s.errCnt >= 1);
  });

  test('roskavastaus ei kaada skriptiä', () => {
    const sim = boot({ settle: false });
    sim.net.body = () => '<html><body>502 Bad Gateway</body></html>';
    sim.settle(8000);
    assertAlive(sim);
    assert.equal(sim.rows(0).length, 0);
  });

  test('huomisen hintojen puuttuminen ei vaikuta tämän päivän ohjaukseen', () => {
    const sim = boot({ start: '2026-10-05T14:50:00', inst: { mode: 1, m1: { l: 999 } } });
    assert.equal(sim.relays[0], true);

    //Huomisen hintoja ei ole vielä julkaistu
    sim.net.maxHours = 0;
    sim.advanceTo('2026-10-05T15:30:00');
    assertAlive(sim);

    const st = sim.status(0);
    assert.equal(sim.rows(0).length, 24);
    assert.equal(sim.rows(1).length, 0);
    assert.equal(st.si.st, 2);
    assert.equal(sim.relays[0], true);

    //Hinnat julkaistaan -> haku onnistuu
    sim.net.maxHours = null;
    sim.advanceTo('2026-10-05T15:40:00');
    assert.equal(sim.rows(1).length, 24);
  });
});

describe('virheellinen vastaus hintahaussa', () => {
  /** Palauttaa ensimmäisen epäonnistuneen haun lokirivit */
  const failed = (res) => {
    const sim = boot({ start: '2026-10-05T10:00:00', settle: false });
    sim.net.res = res;
    sim.advance(3e3);
    assertAlive(sim);
    assert.ok(sim.status(0).s.errTot >= 1, 'haku kirjautuu virheeksi');
    //Vain ensimmäinen yritys (hakua yritetään heti uudelleen)
    let all = sim.logLines();
    all = all.slice(0, all.findIndex(l => /Error: /.test(l)) + 1);
    return { sim, all, error: all[all.length - 1] };
  };

  test('lokiin kirjataan vastauskoodi ja sisällön pituus', () => {
    const body = '{"status":"BAD_REQUEST","messages":["Method parameter"]}';
    const { error } = failed({ code: 400, body });
    assert.ok(error.endsWith('code 400, length ' + body.length), error);
  });

  test('vastauksen sisältöä tai otsakkeita ei kirjoiteta lokiin', () => {
    //Sisältö on ulkopuolista dataa ja voi olla suuri (esim. välityspalvelimen virhesivu)
    const body = '<html>SALAINEN\n\u001b[31m' + 'x'.repeat(30000) + '</html>';
    const { error, all, sim } = failed({ code: 403, body, headers: { 'Set-Cookie': 'a'.repeat(400) } });
    assert.ok(error.endsWith('code 403, length ' + body.length), error);
    assert.ok(all.every(l => l.length <= 128), 'Shellyn loki katkaisee rivit 128 merkkiin');
    assert.ok(!all.some(l => /SALAINEN|xxxx|aaaa|html/.test(l)));
    assert.ok(all.every(l => !/[^\x20-\x7e]/.test(l)), 'vain tulostuvia ASCII-merkkejä');
  });

  test('base64-muotoista virhevastausta ei pureta', () => {
    const { sim, error } = failed({ code: 503, body_b64: Buffer.from('Service unavailable '.repeat(2000)).toString('base64') });
    assert.ok(error.includes('code 503, length '), error);
    assert.equal(sim.atobLog.filter(a => a.in > 0 && a.in <= 400).length, 0);
  });

  test('koodi 200 ilman sisältöä tai tyhjä vastaus ei kaada skriptiä', () => {
    assert.ok(failed({ code: 200 }).error.endsWith('code 200, length 0'));
    failed({ code: 200, body: '' });
    failed({ code: 500, body: null, body_b64: null, headers: null });
  });
});

describe('siirtotuote: aikasiirto ja kausisiirto (v10)', () => {
  //Hinta 10 c/kWh ilman veroa, päivämaksu 3 ja yömaksu 1 -> 13 = päivämaksu, 11 = yömaksu
  const fees = (date, common = {}) => {
    const sim = boot({ start: `${date}T10:00:00`, price: () => 10, common: Object.assign({ vat: 0, day: 3, night: 1 }, common) });
    assertAlive(sim);
    return sim.rows(0).map(r => Math.round(r[1] * 100) / 100);
  };
  const KAUSI = { tt: 1 };

  test('oletus on aikasiirto: päivämaksu joka päivä klo 07-22, myös sunnuntaina', () => {
    const p = fees('2026-11-08');
    assert.deepEqual([p[6], p[7], p[12], p[21], p[22]], [11, 13, 13, 13, 11]);
  });

  test('kausisiirto, talviarkipäivä: päivämaksu klo 07-22', () => {
    const p = fees('2026-11-03', KAUSI);
    assert.deepEqual([p[0], p[6], p[7], p[12], p[21], p[22], p[23]], [11, 11, 13, 13, 13, 11, 11]);
  });

  test('kausisiirto, lauantai on arkipäivä ja sunnuntai yöaikaa', () => {
    assert.equal(fees('2026-11-07', KAUSI)[12], 13, 'lauantai');
    assert.ok(fees('2026-11-08', KAUSI).every(v => v == 11), 'sunnuntai koko päivän yömaksulla');
  });

  test('kausisiirto, kesäkausi: yömaksu koko päivän', () => {
    assert.ok(fees('2026-10-06', KAUSI).every(v => v == 11));
    assert.ok(fees('2026-07-07', KAUSI).every(v => v == 11));
  });

  test('kausisiirto, kauden rajat 1.11. ja 31.3. kuuluvat kauteen, ja kausi jatkuu vuodenvaihteen yli', () => {
    const noon = (d) => fees(d, KAUSI)[12];
    assert.equal(noon('2026-10-31'), 11, '31.10. (la) ennen kautta');
    assert.equal(noon('2026-11-02'), 13, '2.11. (ma)');
    assert.equal(noon('2026-12-31'), 13, '31.12. (to)');
    assert.equal(noon('2027-01-01'), 13, '1.1. (pe) vuodenvaihteen jälkeen');
    assert.equal(noon('2026-03-31'), 13, '31.3. (ti) viimeinen päivä');
    assert.equal(noon('2026-04-01'), 11, '1.4. (ke) kausi päättynyt');
    assert.equal(noon('2026-11-01'), 11, '1.11. on sunnuntai');
    assert.equal(fees('2027-11-01', KAUSI)[12], 13, '1.11.2027 (ma) ensimmäinen päivä');
  });

  test('kausi ja kellonajat ovat asetuksia (etäasetusten skriptillä)', () => {
    //Kesäkausi 1.6.-31.8. (ei vuodenvaihteen yli), päivä klo 06-23
    const summer = { tt: 1, ss: 601, se: 831, ds: 6, de: 23 };
    const p = fees('2026-07-07', summer);
    assert.deepEqual([p[5], p[6], p[22], p[23]], [11, 13, 13, 11]);
    assert.ok(fees('2026-11-03', summer).every(v => v == 11), 'marraskuu ei ole kautta');

    //Aikasiirto omilla kellonajoilla
    const q = fees('2026-10-06', { ds: 8, de: 20 });
    assert.deepEqual([q[7], q[8], q[19], q[20]], [11, 13, 13, 11]);
  });

  //Muita kausia ja kellonaikoja kuin oletus. Viikonpäivät: 10.10.2026 la, 11.10.2026 su, 15.2.2027 ma,
  //10.8.2026 ma, 26.2.2027 pe, 28.2.2027 su, 1.3.2027 ma, 29.2.2028 ti (karkauspäivä), 1.3.2028 ke
  const dayHours = (p) => p.map((v, h) => v == 13 ? h : -1).filter(h => h >= 0);

  test('kausisiirto 10.10.-15.2. klo 09-14: rajapäivät, vuodenvaihde, sunnuntai ja tunnit', () => {
    const kausi = { tt: 1, ss: 1010, se: 215, ds: 9, de: 14 };
    const at = (d) => dayHours(fees(d, kausi));
    const HOURS = [9, 10, 11, 12, 13];
    assert.deepEqual(at('2026-10-09'), [], '9.10. (pe) ennen kautta');
    assert.deepEqual(at('2026-10-10'), HOURS, '10.10. (la) ensimmäinen päivä, päivämaksu klo 09-14');
    assert.deepEqual(at('2026-10-11'), [], '11.10. sunnuntai');
    assert.deepEqual(at('2026-12-31'), HOURS, '31.12. (to)');
    assert.deepEqual(at('2027-01-04'), HOURS, '4.1. (ma) vuodenvaihteen jälkeen');
    assert.deepEqual(at('2027-02-15'), HOURS, '15.2. (ma) viimeinen päivä');
    assert.deepEqual(at('2027-02-16'), [], '16.2. (ti) kausi päättynyt');
    assert.deepEqual(at('2026-07-07'), [], 'kesä');
  });

  test('kausisiirto 10.8.-29.2. klo 06-18: karkauspäivä ja tavallinen vuosi', () => {
    const kausi = { tt: 1, ss: 810, se: 229, ds: 6, de: 18 };
    const at = (d) => dayHours(fees(d, kausi));
    const HOURS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
    assert.deepEqual(at('2026-08-07'), [], '7.8. (pe) ennen kautta');
    assert.deepEqual(at('2026-08-10'), HOURS, '10.8. (ma) ensimmäinen päivä, päivämaksu klo 06-18');
    assert.deepEqual(at('2027-02-26'), HOURS, '26.2.2027 (pe)');
    assert.deepEqual(at('2027-02-28'), [], '28.2.2027 sunnuntai');
    assert.deepEqual(at('2027-03-01'), [], '1.3.2027 (ma): tavallisena vuonna kausi päättyy 28.2.');
    assert.deepEqual(at('2028-02-29'), HOURS, '29.2.2028 (ti) karkauspäivä on kauden viimeinen päivä');
    assert.deepEqual(at('2028-03-01'), [], '1.3.2028 (ke) kausi päättynyt');
  });

  test('aikasiirto omilla kellonajoilla: päivämaksu joka päivä, myös kauden ulkopuolella ja sunnuntaina', () => {
    const at = (d) => dayHours(fees(d, { tt: 0, ss: 1010, se: 215, ds: 9, de: 14 }));
    for (const d of ['2026-07-07', '2026-10-11', '2027-02-16']) {
      assert.deepEqual(at(d), [9, 10, 11, 12, 13], d);
    }
  });

  test('virheelliset arvot korvataan oletuksilla ja korjatut asetukset tallennetaan', () => {
    const sim = boot({ start: '2026-11-03T10:00:00', price: () => 10, common: { vat: 0, day: 3, night: 1, tt: 5, ss: 1340, se: 0, ds: 22, de: 7 } });
    assertAlive(sim);
    const c = sim.cfg(-1);
    assert.deepEqual([c.tt, c.ss, c.se, c.ds, c.de], [0, 1101, 331, 7, 22]);
    assert.equal(sim.rows(0)[12][1], 13);
  });

  test('aiemmin tallennetuista asetuksista puuttuvat arvot saavat oletukset (sama toiminta kuin ennen)', () => {
    const sim = boot({ start: '2026-11-08T10:00:00', price: () => 10, kvs: { porssisahko: "[1,'fi',0,3,1,['-'],1,24]" } });
    assertAlive(sim);
    const c = sim.status(0).c;
    assert.deepEqual([c.tt, c.ss, c.se, c.ds, c.de], [0, 1101, 331, 7, 22]);
    const p = sim.rows(0);
    assert.deepEqual([p[6][1], p[7][1], p[22][1]], [11, 13, 11], 'sunnuntaina päivämaksu kuten ennen');
    assert.equal(sim.kvs.get('porssisahko'), "[1,'fi',0,3,1,['-'],1,24,0,1101,331,7,22]", 'täydennetty lista tallennettu');
  });

  test('kausisiirto vaikuttaa ohjaukseen: hintaraja talven arkipäivänä ja sunnuntaina', () => {
    //Raja 12: arkipäivänä klo 12 hinta 13 (pois), sunnuntaina 11 (päällä)
    const at = (date) => {
      const sim = boot({ start: `${date}T12:05:00`, price: () => 10, common: { vat: 0, day: 3, night: 1, tt: 1 }, inst: { mode: 1, m1: { l: 12 } } });
      assertAlive(sim);
      return sim.relays[0];
    };
    assert.equal(at('2026-11-03'), false, 'tiistai');
    assert.equal(at('2026-11-08'), true, 'sunnuntai');
  });
});

describe('kellonsiirtopäivän hintahaku (v10)', () => {
  const urls = (sim, day) => sim.httpLog.filter(h => h.url.includes(`start=${day}`)).map(h => ({ t: new Date(h.t), q: h.url.split('?')[1] }));

  test('tavallisen päivän pyyntö on ennallaan', () => {
    const sim = boot({ start: '2026-10-06T10:00:00' });
    assert.equal(sim.httpLog[0].url, 'https://dashboard.elering.ee/api/nps/price/csv?fields=fi&start=2026-10-06T00:00:00%2b03:00&end=2026-10-06T23:59:59%2b03:00');
    //Lokakuun sunnuntai, joka ei ole viimeinen (18.10.)
    const sun = boot({ start: '2026-10-18T10:00:00' });
    assert.match(sun.httpLog[0].url, /start=2026-10-18T00:00:00%2b03:00&end=2026-10-18T23:59:59%2b03:00$/);
  });

  test('talviaikaan siirtyminen: pyyntö tunnin pidempi, koko päivä (25 tuntia) muistissa jo ennen siirtoa, ei uutta hakua siirron hetkellä', () => {
    const sim = boot({ start: '2026-10-24T16:00:00', resolution: 60 });
    //Huomisen hinnat klo 15 jälkeen: pyyntö kellonsiirtopäivälle on laajennettu
    assert.match(urls(sim, '2026-10-25')[0].q, /start=2026-10-25T00:00:00%2b04:00&end=2026-10-25T23:59:59%2b02:00$/);
    assert.equal(sim.rows(1).length, 25, 'huomisen hinnoissa kaikki 25 tuntia');

    sim.advanceTo('2026-10-25T02:30:00');
    assert.equal(sim.rows(0).length, 25);
    const before = urls(sim, '2026-10-25').length;
    const ts = sim.status(0).s.p[0].ts;

    sim.advanceTo('2026-10-25T05:00:00');
    assertAlive(sim);
    assert.equal(urls(sim, '2026-10-25').length, before, 'kellonsiirto ei hae hintoja uudelleen');
    assert.equal(sim.status(0).s.p[0].ts, ts, 'hinnat samat kuin ennen siirtoa');
    assert.equal(sim.rows(0).length, 25);
    assert.equal(sim.status(0).s.tz, '+02:00');

    //Seuraavan päivän pyyntö on taas tavallinen
    sim.advanceTo('2026-10-25T16:00:00');
    assert.match(urls(sim, '2026-10-26')[0].q, /start=2026-10-26T00:00:00%2b02:00&end=2026-10-26T23:59:59%2b02:00$/);
    assert.equal(sim.status(0).s.errTot, 0);
  });

  test('kesäaikaan siirtyminen: 23 tuntia, ei uutta hakua siirron hetkellä', () => {
    const sim = boot({ start: '2027-03-27T16:00:00', resolution: 60 });
    assert.match(urls(sim, '2027-03-28')[0].q, /start=2027-03-28T00:00:00%2b03:00&end=2027-03-28T23:59:59%2b01:00$/);
    sim.advanceTo('2027-03-28T02:30:00');
    assert.equal(sim.rows(0).length, 23);
    const before = urls(sim, '2027-03-28').length;

    sim.advanceTo('2027-03-28T05:00:00');
    assertAlive(sim);
    assert.equal(urls(sim, '2027-03-28').length, before, 'kellonsiirto ei hae hintoja uudelleen');
    assert.equal(sim.rows(0).length, 23);
    assert.equal(sim.status(0).s.tz, '+03:00');
    assert.equal(sim.status(0).s.errTot, 0);
  });

  test('hintakatko kellonsiirtopäivänä: uusintayritykset jatkuvat siirron yli, ja hinnat haetaan, kun yhteys palaa', () => {
    const sim = boot({ start: '2026-10-25T00:30:00', settle: false });
    sim.net.mode = 'error';
    sim.advanceTo('2026-10-25T05:00:00');
    assertAlive(sim);
    const tries = sim.httpLog.length;
    assert.ok(tries > 5, `yrityksiä ${tries}`);
    assert.equal(sim.status(0).p[0].length, 0);

    sim.net.mode = 'ok';
    sim.advanceTo('2026-10-25T05:15:00');
    assert.equal(sim.rows(0).length, 25, 'koko päivä haettu kellonsiirron jälkeen (pyyntö laajennettu)');
    assert.equal(sim.status(0).s.errCnt, 0);
  });

  test('muu aikavyöhykkeen muutos hakee hinnat uudelleen kuten ennen', () => {
    const sim = boot({ start: '2026-10-06T10:00:00' });
    const reset = (tz, tzh) => {
      return sim.evaluate(`(_.s.p[0].ts = 123, _.s.tz = "${tz}", _.s.tzh = ${tzh}, updateTz(new Date()), _.s.p[0].ts)`);
    };
    assert.equal(reset('+05:00', 5), 0, 'tavallinen päivä');

    //Kellonsiirtopäivä klo 04.30 talviaikaa (+02:00): ehto täyttyy vain, kun muutos on tunti ja hinnat ovat muistissa
    const dst = boot({ start: '2026-10-25T04:30:00' });
    assert.equal(dst.evaluate('_.s.tz'), '+02:00');
    const at = (tz, tzh, empty) => {
      return dst.evaluate(`(_.s.p[0].ts = 123, ${empty ? '_.p[0] = "",' : ''} _.s.tz = "${tz}", _.s.tzh = ${tzh}, updateTz(new Date()), _.s.p[0].ts)`);
    };
    assert.equal(at('+03:00', 3, false), 123, 'kellonsiirto tunnilla: ei uutta hakua');
    assert.equal(at('+04:00', 4, false), 0, 'kahden tunnin muutos');
    assert.equal(at('+03:00', 3, true), 0, 'ei hintoja muistissa');
  });
});

describe('hintahaun vastauksen koko ja muistihuippu (v10)', () => {
  //Otsakkeet lasketaan riveinä "nimi: arvo" (+ rivinvaihto): Content-Type: text/csv = 12 + 8 + 4
  const CT = 24;
  const CF = { 'Report-To': 'x'.repeat(400), 'Reporting-Endpoints': 'y'.repeat(300) };
  const CF_LEN = CT + 9 + 400 + 4 + 19 + 300 + 4;
  const script = (peak) => ({ id: 1, running: true, mem_used: 7900, mem_peak: peak, mem_free: 17286 });

  test('viimeisimmän haun bodyn (base64) ja otsakkeiden pituus', () => {
    const sim = boot({ start: '2026-10-05T10:00:00' });
    const s = sim.status(0).s;
    assert.equal(s.fB, sim.httpLog[0].b64);
    assert.equal(s.fH, CT);
  });

  test('ylimääräiset otsakkeet näkyvät pituudessa', () => {
    const sim = boot({ start: '2026-10-05T10:00:00', settle: false });
    sim.net.headers = CF;
    sim.settle();
    assert.equal(sim.status(0).s.fH, CF_LEN);
  });

  test('haku, jonka aikana muistihuippu nousi, kirjataan otsakkeiden pituuden kanssa', () => {
    const sim = boot({ start: '2026-10-05T14:00:00', settle: false, components: { 'script:1': script(18000) } });
    //Ensimmäinen haku (tänään) nostaa huippua ja sen vastauksessa on lisäotsakkeet
    sim.net.headers = CF;
    sim.net.body = () => { sim.components['script:1'].mem_peak = 19500; return null; };
    sim.settle();
    let s = sim.status(0).s;
    const ts = s.fPkTs;
    assert.equal(s.fPk, 19500);
    assert.equal(s.fPkH, CF_LEN);
    assert.ok(Math.abs(ts - sim.now().getTime() / 1000) < 60, 'haun aika');

    //Huomisen haku kello 15 ei nosta huippua: kirjattu huippu pysyy, viimeisimmän haun pituudet päivittyvät
    sim.net.headers = null;
    sim.net.body = null;
    sim.advanceTo('2026-10-05T15:05:00');
    s = sim.status(0).s;
    assert.ok(sim.status(0).s.p[1].ts > 0, 'huomisen hinnat haettu');
    assert.deepEqual([s.fPk, s.fPkTs, s.fPkH, s.fH], [19500, ts, CF_LEN, CT]);
  });

  test('virhevastauksen pituus kirjataan, huippua ei kirjata, jos se ei noussut', () => {
    const sim = boot({ start: '2026-10-05T10:00:00', settle: false });
    const body = '{"status":"BAD_REQUEST"}';
    sim.net.res = { code: 400, body };
    sim.advance(3e3);
    assertAlive(sim);
    const s = sim.status(0).s;
    assert.ok(s.errTot >= 1);
    assert.equal(s.fB, body.length);
    assert.equal(s.fPk, 0);
  });
});
