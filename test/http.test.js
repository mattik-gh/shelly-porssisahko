/**
 * Skriptin HTTP-rajapinnan (/script/<id>?r=...) ja asetusten käsittelyn testit
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { boot, assertAlive } = require('./helpers');
const { createSim } = require('./sim/shelly-sim');

/** Ajetaanko testejä koontiversiota vastaan (ks. run-dist.js) */
const DIST = !!process.env.SIM_MAIN && path.basename(path.dirname(path.resolve(process.env.SIM_MAIN))) === 'dist';

const header = (res, name) => (res.headers.find(h => h[0] === name) ?? [])[1];

describe('käynnistys', () => {
  test('tyhjään laitteeseen luodaan oletusasetukset', () => {
    const sim = createSim();
    sim.settle();
    assertAlive(sim);

    //Uudessa asennuksessa on yksi ohjaus (lisää saa asetuksista)
    assert.deepEqual([...sim.kvs.keys()].sort(), ['porssisahko', 'porssisahko-1']);

    const common = sim.cfg(-1);
    assert.equal(common.g, 'fi');
    assert.equal(common.vat, 25.5);
    assert.equal(common.cnt, 1);
    assert.deepEqual(common.names, ['-']);

    const inst = sim.cfg(0);
    assert.equal(inst.en, 0);
    assert.equal(inst.mode, 0);
    assert.deepEqual(inst.o, [0]);
    assert.equal(inst.m, 60);
    assert.equal(inst.m2.p, 24);

    assert.equal(sim.switchLog.length, 0, 'lähtöihin ei kosketa');
  });

  test('puuttuvat asetukset täydennetään oletuksilla ja tallennetaan', () => {
    const sim = boot({ inst: { mode: 2 } });
    const inst = sim.cfg(0);

    assert.equal(inst.en, 1, 'annettu arvo säilyy');
    assert.equal(inst.mode, 2, 'annettu arvo säilyy');
    assert.equal(inst.m2.c, 0, 'puuttuva arvo täydennetty');
    assert.equal(inst.oc, 0, 'puuttuva arvo täydennetty');
  });

  test('lokiin kirjoitetaan versio ja osoite', () => {
    const sim = boot();
    assert.match(sim.logLines()[0], /^shelly-porssisahko: v\.\d+\.\d+\.\d+$/);
    assert.equal(sim.logLines()[1], 'shelly-porssisahko: URL: http://192.168.1.50/script/1');
  });
});

describe('käynnistyksen lokirivin osoite', () => {
  const url = (components) => boot({ components }).logLines()[1];

  test('WiFi-yhteys: WiFin osoite', () => {
    assert.equal(url({}), 'shelly-porssisahko: URL: http://192.168.1.50/script/1');
  });

  test('kaapeliyhteys: kaapeliliitännän osoite', () => {
    assert.equal(url({ eth: { ip: '10.0.0.7' }, wifi: { sta_ip: null } }), 'shelly-porssisahko: URL: http://10.0.0.7/script/1');
  });

  test('kaapeli ja WiFi yhtä aikaa: kaapeliliitännän osoite', () => {
    assert.equal(url({ eth: { ip: '10.0.0.7' } }), 'shelly-porssisahko: URL: http://10.0.0.7/script/1');
  });

  test('kaapeliliitäntä on, mutta ei kytketty: WiFin osoite', () => {
    assert.equal(url({ eth: { ip: null } }), 'shelly-porssisahko: URL: http://192.168.1.50/script/1');
  });

  test('ei kumpaakaan yhteyttä: tukiasematilan vakio-osoite', () => {
    assert.equal(url({ wifi: { sta_ip: null } }), 'shelly-porssisahko: URL: http://192.168.33.1/script/1');
    //Shelly ilmoittaa käyttämättömän yhteyden osoitteeksi myös "0.0.0.0" (mitattu Pro 2:lla, kun Wi-Fi on pois päältä)
    assert.equal(url({ wifi: { sta_ip: '0.0.0.0' } }), 'shelly-porssisahko: URL: http://192.168.33.1/script/1');
    assert.equal(url({ eth: { ip: '10.0.0.7' }, wifi: { sta_ip: '0.0.0.0' } }), 'shelly-porssisahko: URL: http://10.0.0.7/script/1');
    assert.equal(url({ eth: { ip: '0.0.0.0' } }), 'shelly-porssisahko: URL: http://192.168.1.50/script/1');
    assert.equal(url({ eth: { ip: '0.0.0.0' }, wifi: { sta_ip: '0.0.0.0' } }), 'shelly-porssisahko: URL: http://192.168.33.1/script/1');
  });
});

describe('rajapinta', () => {
  test('r=s palauttaa tilan', () => {
    const sim = boot({ inst: { mode: 0, m0: { c: 1 } }, common: { names: ['Varaaja', '-', '-'] } });
    const res = sim.get('r=s&i=0');

    assert.equal(res.code, 200);
    assert.equal(header(res, 'Content-Type'), 'application/json');
    assert.equal(header(res, 'Content-Encoding'), undefined);

    assert.deepEqual(Object.keys(res.json).sort(), ['c', 'ci', 'm', 'p', 's', 'si', 't']);
    assert.equal(res.json.t, sim.epoch(), 'laitteen kellonaika');
    assert.deepEqual(res.json.m, [7900, 18500, 25186], 'skriptin muisti: käytössä levossa, huippu, yhteensä');
    assert.equal(res.json.s.dn, 'Simu');
    assert.equal(res.json.s.timeOK, true);
    assert.equal(res.json.c.names[0], 'Varaaja');
    assert.equal(res.json.ci.mode, 0);
    assert.equal(res.json.si.cmd, 1);
    assert.equal(res.json.s.upTs, Math.floor(new Date('2026-10-05T10:00:00').getTime() / 1000));
  });

  test('r=s toisen ohjauksen tiedoilla', () => {
    const sim = boot();
    assert.equal(sim.get('r=s&i=0').json.ci.en, 1);
    assert.equal(sim.get('r=s&i=1').json.ci.en, 0);
  });

  test('r=s olemattomalle ohjaukselle palauttaa vain yleisen tilan', () => {
    //Käyttöliittymä osaa tästä vaihtaa ensimmäiseen ohjaukseen
    const sim = boot();
    for (const i of [3, -1, 'x']) {
      const res = sim.get(`r=s&i=${i}`).json;
      assert.deepEqual(Object.keys(res).sort(), ['c', 's'], `i=${i}`);
      assert.equal(res.c.cnt, 3);
    }
  });

  test('r=c palauttaa asetukset', () => {
    const sim = boot({ inst: { mode: 2 }, common: { day: 4 } });
    assert.equal(sim.get('r=c&i=0').json.mode, 2);
    assert.equal(sim.get('r=c').json.day, 4);
  });

  test('r=h palauttaa historian pakattuna (base64, 4 tavua per rivi)', () => {
    const sim = boot({ start: '2026-10-05T10:00:00', inst: { mode: 0, m0: { c: 1 } } });
    const raw = Buffer.from(sim.get('r=h&i=0').json, 'base64');

    assert.equal(raw.length, 4);

    //3 tavua: minuutit ajasta 26000000 min, 1 tavu: (ohjaus << 4) | tila
    const minutes = (raw[0] << 16 | raw[1] << 8 | raw[2]) + 26000000;
    assert.equal(new Date(minutes * 60000).toISOString(), new Date('2026-10-05T10:00:00').toISOString());
    assert.equal(raw[3] >> 4, 1, 'ohjaus päällä');
    assert.equal(raw[3] & 15, 1, 'tilakoodi 1 = käsiohjaus');

    //Simulaattorin apufunktio purkaa saman
    assert.deepEqual(sim.history(0), [[Math.floor(new Date('2026-10-05T10:00:00').getTime() / 1000), 1, 1]]);

    //Tyhjä historia
    assert.equal(sim.get('r=h&i=1').json, '');
  });

  test('r=s palauttaa hinnat pakattuna (base64, 3 tavua per jakso)', () => {
    const sim = boot({ start: '2026-10-05T10:00:00', price: (e, d) => d.getHours() === 3 ? -2.5 : 31.93 });
    const res = sim.get('r=s&i=0').json;

    assert.equal(typeof res.p[0], 'string');
    assert.equal(res.p[1], '');
    const raw = Buffer.from(res.p[0], 'base64');
    assert.equal(raw.length, 96 * 3);

    //Hinta + 8388608 kolmena tavuna: 31,93 c/kWh = 319,3 EUR/MWh = 31930 sadasosaa
    const value = (i) => (raw[i * 3] << 16 | raw[i * 3 + 1] << 8 | raw[i * 3 + 2]) - 8388608;
    assert.equal(value(0), 31930);
    assert.equal(value(13), -2500, 'negatiivinen hinta klo 03:15');

    //Simulaattorin status() purkaa hinnat taulukoksi
    assert.equal(sim.status(0).p[0][13], -2500);
  });

  test('tuntematon pyyntö palauttaa 404', () => {
    const sim = boot();
    assert.equal(sim.get('r=xyz').code, 404);
  });

  test('pyyntöihin vastataan 503 kun skripti on kiireinen', () => {
    const sim = boot({ settle: false });
    sim.net.delay = 3000;

    //Hintahaku on käynnissä
    sim.advance(1500);
    assert.equal(sim.fetchCount(), 1);
    assert.equal(sim.request('r=s&i=0').code, 503);

    sim.settle();
    assert.equal(sim.request('r=s&i=0').code, 200);
  });
});

describe('staattiset tiedostot', () => {
  const files = {
    '': 'index.html',
    'r=s.js': 's.js',
    'r=s.css': 's.css',
    'r=status': 'tab-status.html',
    'r=status.js': 'tab-status.js',
    'r=history': 'tab-history.html',
    'r=history.js': 'tab-history.js',
    'r=config': 'tab-config.html',
    'r=config.js': 'tab-config.js',
    'r=en.js': 'en.js',
    'r=en-config.js': 'en-config.js'
  };

  const types = { html: 'text/html', js: 'text/javascript', css: 'text/css' };

  for (const query in files) {
    test(`"${query}" palauttaa tiedoston ${files[query]} gzip-pakattuna`, () => {
      const sim = boot();
      const res = sim.get(query);

      assert.equal(res.code, 200);
      assert.equal(header(res, 'Content-Encoding'), 'gzip');
      assert.equal(header(res, 'Content-Type'), types[files[query].split('.').pop()]);

      //Koontiversiossa tiedostot ovat pienennettyinä (dist/statics/*.nozip.*), muuten lähdekoodina
      const content = zlib.gunzipSync(Buffer.from(res.body, 'latin1'));
      const source = fs.readFileSync(DIST
        ? path.join(__dirname, '..', 'dist', 'statics', files[query].replace(/\.(\w+)$/, '.nozip.$1'))
        : path.join(__dirname, '..', 'src', 'statics', files[query]));
      assert.ok(content.equals(source));
    });
  }
});

describe('asetusten tallennus', () => {
  test('r=r lataa ohjauksen asetukset uudelleen', () => {
    const sim = boot({ inst: { mode: 0, m0: { c: 0 } } });
    assert.equal(sim.relays[0], false);

    sim.writeKvs(0, { m0: { c: 1 } });
    sim.settle();
    assert.equal(sim.relays[0], false, 'pelkkä KVS-muutos ei vaikuta');

    assert.equal(sim.get('r=r&i=0').code, 204);
    sim.settle();
    assert.equal(sim.relays[0], true);
  });

  test('r=r lataa myös yleiset asetukset', () => {
    const sim = boot({ price: () => 10 });
    assert.equal(sim.rows(0)[12][1], 10);

    sim.saveConfig(0, {}, { vat: 10, day: 1, names: ['Uusi nimi', '-', '-'] });

    const st = sim.status(0);
    assert.equal(st.c.names[0], 'Uusi nimi');
    assert.equal(sim.rows(0)[12][1], 12);
  });

  test('toisen ohjauksen käyttöönotto', () => {
    const sim = boot({ inst: { mode: 0, m0: { c: 1 } } });
    assert.equal(sim.status(0).s.enCnt, 1);

    sim.saveConfig(1, { en: 1, mode: 0, m0: { c: 1 }, o: [1] });

    assertAlive(sim);
    assert.equal(sim.status(0).s.enCnt, 2);
    assert.deepEqual(sim.relays, { 0: true, 1: true });
  });

  test('ohjauksen poisto käytöstä jättää lähdön viimeiseen tilaan', () => {
    const sim = boot({ inst: { mode: 0, m0: { c: 1 } } });
    sim.saveConfig(0, { en: 0 });

    assert.equal(sim.relays[0], true);

    const writes = sim.switchLog.length;
    sim.advance(3 * 3600e3);
    assert.equal(sim.switchLog.length, writes);
  });
});
