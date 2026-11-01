/**
 * Kaksikielinen käyttöliittymä (suomi/englanti)
 *
 * Tekstit ovat koodissa suomeksi ja käännökset tiedostossa src/statics/en.js.
 * Testit varmistavat, että jokaisella tekstillä on käännös eikä käännöstiedostossa ole turhia rivejä.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { collect, fromJs, fromHtml } = require('./sim/i18n-keys.js');
const { uiShared, translations } = require('./sim/ui-shared.js');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { boot } = require('./helpers');

//Tekstit, joita ei käännetä (samat molemmilla kielillä)
const SAME = ['Pörssisähkö', 'Ohjaus #1', 'FI', 'EN', '· © Jussi Isotalo (', 'jisotalo.fi', 'Latvia', 'c/kWh', '(c/kWh)', 'min', 'h'];
const needed = (key) => /[a-zäö]/i.test(key) && !SAME.includes(key) && !/^\d+h$/.test(key);

describe('käännökset (en.js)', () => {
  const TR = translations();
  const keys = collect();

  it('tekstejä löytyy jokaisesta käyttöliittymän tiedostosta', () => {
    const files = [...new Set(keys.map(x => x.file))];
    assert.deepEqual(files, ['index.html', 's.js', 'tab-config.html', 'tab-config.js', 'tab-history.html', 'tab-history.js', 'tab-status.html', 'tab-status.js']);
    assert.ok(keys.length > 150, `tekstejä ${keys.length}`);
  });

  it('jokaisella tekstillä on käännös', () => {
    const missing = keys.filter(x => needed(x.key) && TR[x.key] === undefined).map(x => `${x.file}: ${x.key}`);
    assert.deepEqual(missing, []);
  });

  it('käännöstiedostossa ei ole tekstejä, joita ei käytetä', () => {
    const used = new Set(keys.map(x => x.key));
    assert.deepEqual(Object.keys(TR).filter(key => !used.has(key)), []);
  });

  it('käännöksessä on yhtä monta arvon paikkaa (%s) kuin tekstissä', () => {
    const count = (s) => s.split('%s').length - 1;
    assert.deepEqual(Object.keys(TR).filter(key => count(key) != count(TR[key])), []);
  });

  it('käännös ei ole tyhjä eikä sama kuin suomenkielinen teksti', () => {
    assert.deepEqual(Object.keys(TR).filter(key => !TR[key] || TR[key] == key.split('|')[0]), []);
  });

  it('tekstien keruu tunnistaa kaikki kolme tapaa', () => {
    assert.deepEqual(fromJs('x = t("Yksi"); y = t("Kaksi", "paikka"); z = t`Arvo ${a + `${b}`} ja ${c}`;\n  //t("kommentti")\n/* t("toinen") */ let(t) + at("ei");'),
      ['Yksi', 'Kaksi|paikka', 'Arvo %s ja %s']);
    assert.deepEqual(fromHtml('<!-- pois --><td data-t="rivi">Tila</td><td><input type="text"> min <b>Lihava</b></td><input type="button" value="Nappi"><script>t("ei")</script>'),
      ['Tila|rivi', 'min', 'Lihava', 'Nappi']);
  });
});

describe('käännösten jako kahteen tiedostoon', () => {
  const read = (file) => fs.readFileSync(path.join(__dirname, '..', 'src', 'statics', file), 'utf8');
  const common = new Function(`let TR; ${read('en.js')}; return TR;`)();
  const config = new Function(`let TR = {}; ${read('en-config.js')}; return TR;`)();
  const files = {};
  collect().forEach(x => (files[x.key] = files[x.key] || new Set()).add(x.file));

  it('sama teksti ei ole molemmissa tiedostoissa', () => {
    assert.deepEqual(Object.keys(config).filter(key => key in common), []);
  });

  it('en-config.js:ssä on vain tekstejä, joita käytetään pelkästään asetussivulla', () => {
    assert.deepEqual(Object.keys(config).filter(key => ![...files[key]].every(f => f.startsWith('tab-config'))), []);
  });

  it('muualla käytetyt tekstit ovat tiedostossa en.js (ladataan aina)', () => {
    const elsewhere = Object.keys(files).filter(key => ![...files[key]].every(f => f.startsWith('tab-config')));
    assert.deepEqual(elsewhere.filter(key => key in config), []);
    assert.ok(Object.keys(common).length > 50 && Object.keys(config).length > 50);
  });

  it('asetussivun käännökset haetaan ennen asetussivua', () => {
    const s = read('s.js');
    assert.ok(s.indexOf('reqJs("en-config.js")') > 0);
    assert.ok(s.indexOf('reqJs("en-config.js")') < s.indexOf('await populateDynamicData(`${tab}.html`'));
  });
});

describe('asetussivun ohjeet', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'statics', 'tab-config.html'), 'utf8');

  it('ohjeet ovat rivin nimen takana, eivät näkyvissä kentän vieressä', () => {
    const hints = [...html.matchAll(/<b class="ph" tabindex="0">([^<]+)<span>(.*?)<\/span><\/b>/g)];
    assert.equal(hints.length, 17);
    //Jokaisella ohjeella on teksti
    assert.deepEqual(hints.filter(m => !m[2].replace(/<[^>]*>/g, '').trim()).map(m => m[1]), []);
    //Hinnan tarkkuuden mukaan vaihtuvat ohjeet: kolme vaihtoehtoa, joista tyylisääntö näyttää yhden (ks. data-r)
    assert.deepEqual(hints.filter(m => m[2].includes('<i class="r1">')).map(m => m[1]), ['Hinnan tarkkuus', 'Tuntimäärä', 'Tuntimäärä 2']);
    assert.doesNotMatch(html, /opacity:0\.7/, 'vanhoja näkyviä ohjeita ei ole jäljellä');
  });

  it('lähdön varoitus on edelleen näkyvissä kentän vieressä punaisella', () => {
    assert.match(html, /<span id="outs-h" style="[^"]*color:red"><\/span>/);
  });
});

describe('käännösfunktiot (s.js)', () => {
  it('suomeksi tekstit palautuvat sellaisinaan', () => {
    const { t } = uiShared();
    const nr = 2;
    assert.equal(t('Tallenna'), 'Tallenna');
    assert.equal(t('Tila', 'rivi'), 'Tila');
    assert.equal(t`Lähtöä ${nr} ei löydy`, 'Lähtöä 2 ei löydy');
  });

  it('englanniksi käännös haetaan tekstillä, paikalla ja arvoilla', () => {
    const { t } = uiShared('en');
    const nr = 2;
    assert.equal(t('Tallenna'), 'Save');
    assert.equal(t('Tila'), 'Status');
    assert.equal(t('Tila', 'rivi'), 'State');
    assert.equal(t`Ohjaus #${nr + 1} ei ole käytössä`, "Control #3 isn't enabled");
    assert.equal(t`Viimeisin katko: ${'a'} – ${'b'}`, 'Latest outage: a – b');
    assert.equal(t`${3} virhettä`, '3 errors');
  });

  it('puuttuva käännös ei riko tekstiä', () => {
    const { t } = uiShared('en');
    assert.equal(t('Tuntematon'), 'Tuntematon');
    assert.equal(t('Tuntematon', 'paikka'), 'Tuntematon');
    assert.equal(t`Tuntematon ${1} ja ${2}`, 'Tuntematon 1 ja 2');
  });

  it('pakko-ohjauksen selitteestä saa päättymisajan pois kummallakin kielellä (historiasivu)', () => {
    for (const lang of ['fi', 'en']) {
      const s = uiShared(lang).t('Pakko-ohjaus (%s asti)');
      assert.ok(s.includes('%s'));
      assert.equal(s.replace(/ \(.*%s.*\)/, ''), lang == 'fi' ? 'Pakko-ohjaus' : 'Manual override');
    }
  });

  it('staattisen sivun tekstit käännetään (tr)', () => {
    //Pieni sivun malli: tekstisolmut ja painikkeet
    const nodes = [
      { nodeValue: '\n  Tila ', parentNode: { dataset: {} } },
      { nodeValue: 'Tila', parentNode: { dataset: { t: 'rivi' } } },
      { nodeValue: ' c/kWh\n', parentNode: { dataset: {} } },
      { nodeValue: '\n   ', parentNode: { dataset: {} } }
    ];
    const buttons = [{ value: 'Tallenna' }];
    const root = { querySelectorAll: () => buttons };
    const doc = { createTreeWalker: () => { let i = 0; return { nextNode: () => nodes[i++] }; } };

    uiShared('fi', doc).tr(root);
    assert.equal(nodes[0].nodeValue, '\n  Tila ');
    assert.equal(buttons[0].value, 'Tallenna');

    uiShared('en', doc).tr(root);
    assert.deepEqual(nodes.map(n => n.nodeValue), ['\n  Status ', 'State', ' c/kWh\n', '\n   ']);
    assert.equal(buttons[0].value, 'Save');
  });

  it('asetussivun ilmoitus: onnistuminen häviää 3 sekunnissa, virhe jää näkyviin', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const e = { textContent: '', style: {} };
    const { msg } = uiShared('fi', { querySelector: (sel) => sel == '#msg' ? e : null });

    msg('Tallennettu');
    assert.equal(e.textContent, 'Tallennettu');
    assert.equal(e.style.color, '#16a085');
    t.mock.timers.tick(2900);
    assert.equal(e.textContent, 'Tallennettu');
    t.mock.timers.tick(200);
    assert.equal(e.textContent, '');

    msg('Virhe: x', 1);
    assert.equal(e.style.color, '#c0392b');
    t.mock.timers.tick(60000);
    assert.equal(e.textContent, 'Virhe: x', 'virhe ei häviä itsestään');

    //Uusi ilmoitus korvaa edellisen, eikä edellisen ajastin tyhjennä sitä
    msg('Tallennettu');
    t.mock.timers.tick(2000);
    msg('Virhe: y', 1);
    t.mock.timers.tick(5000);
    assert.equal(e.textContent, 'Virhe: y');
  });

  it('sivun yhteiset muuttujat eivät peitä selaimen omia nimiä', () => {
    //Löytyi testattaessa: muuttuja nimeltä URL peitti selaimen URL-luokan koko sivulta, ja iPhonen Brave,
    //joka lisää sivulle oman skriptinsä, kaatui kutsuun new URL(...) - sivu ei auennut
    const names = new Set();
    for (const file of ['s.js', 'index.html']) {
      const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'statics', file), 'utf8');
      for (const m of source.matchAll(/^\s{0,4}(?:let|const|var)\s+([A-Za-z_$][\w$]*)/gm)) {
        names.add(m[1]);
      }
    }
    assert.ok(names.has('SRV') && names.has('URLS'), 'muuttujat löytyivät');
    //Selaimen ja JavaScriptin omat nimet, joita sivulle lisätty vieras skripti voi käyttää
    const builtin = new Set([...Object.getOwnPropertyNames(globalThis), 'window', 'document', 'location', 'history', 'navigator', 'screen', 'name', 'status', 'top', 'parent', 'self', 'origin', 'event', 'length', 'frames', 'opener', 'closed', 'Image', 'Option', 'Node', 'Element', 'XMLHttpRequest', 'localStorage', 'sessionStorage', 'alert', 'confirm', 'prompt', 'open', 'close', 'stop', 'focus', 'blur', 'print', 'find', 'scroll']);
    assert.deepEqual([...names].filter(x => builtin.has(x)), []);
    assert.ok(builtin.has('URL'), 'tarkistus kattaa alkuperäisen vian');
  });

  it('kesto esitetään tiiviissä muodossa', () => {
    const { dur } = uiShared();
    assert.deepEqual([0, 15, 30, 60, 75, 90, 315, 765, 1440].map(dur), ['0h', '15min', '30min', '1h', '1h 15min', '1h 30min', '5h 15min', '12h 45min', '24h']);
  });

  it('hintakaavion vihjetekstit ovat valitulla kielellä', () => {
    const items = [{ t: '00:00', p: 5, f: 2, c: 1, a: 0 }, { t: '01:00', p: 6, f: 2, c: 0, a: 1 }];
    const fi = uiShared().drawChart(10, items, 3600);
    const en = uiShared('en').drawChart(10, items, 3600);

    assert.ok(fi.includes('title="00:00 - ohjaus päällä&#10;5.00 c/kWh (energia 3.00 + siirto 2.00)"'));
    assert.ok(fi.includes('title="Ohjaus päällä 00:00 - 01:00 (1h)"'));
    assert.ok(en.includes('title="00:00 - output on&#10;5.00 c/kWh (energy 3.00 + transfer 2.00)"'));
    assert.ok(en.includes('title="01:00 - output off&#10;6.00 c/kWh (energy 4.00 + transfer 2.00)"'));
    assert.ok(en.includes('title="Output on 00:00 - 01:00 (1h)"'));
    //Rakenne on sama kielestä riippumatta
    assert.equal(fi.replace(/title="[^"]*"/g, ''), en.replace(/title="[^"]*"/g, ''));
  });
});

describe('tilasivun alatunniste', () => {
  /** Ajaa tilasivun valitulla kielellä ja palauttaa alatunnisteen rivit ilman HTML-merkintöjä */
  function footer(sim, lang, change) {
    const elements = {};
    const state = sim.status(0);
    change?.(state);

    const context = vm.createContext({
      ...uiShared(lang),
      state, inst: 0, CBS: [], console,
      qs: (id) => elements[id] ?? (elements[id] = { innerHTML: '', style: {} }),
      MODE_STR: ['a', 'b', 'c'], STATE_STR: new Array(14).fill('tila'),
      formatTime: () => '00:00', formatDateTime: () => 'AIKA'
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'statics', 'tab-status.js'), 'utf8'), context, { filename: 'tab-status.js' });
    return { html: elements['s-v'].innerHTML, rows: elements['s-v'].innerHTML.split('<br>').map(row => row.replace(/<[^>]*>/g, '')) };
  }

  it('käyntiaika laitteen kellosta, muisti kilotavuina ja versio laitteelta', () => {
    const sim = boot({ start: '2026-10-05T10:00:00', inst: { mode: 0, m0: { c: 1 } } });
    sim.advance(36 * 3600e3);
    const res = footer(sim, 'fi');

    assert.deepEqual(res.rows, [
      'Käynnistetty AIKA, käynnissä 1.5 päivää.',
      'Muistia käytössä 7.9 kt, suurin käyttö 18.5 kt (käytettävissä 25.2 kt).',
      `Versio ${sim.status(0).s.v} (@mattik-gh), perustuu versioon 3.4.0 (jisotalo.fi)`
    ]);
    assert.match(sim.status(0).s.v, /^\d+\.\d+\.\d+$/);
    assert.match(res.html, /href="https:\/\/github.com\/mattik-gh"/);
    assert.match(res.html, /href="https:\/\/jisotalo.fi"/);
    //Kapealla sivulla rivi katkeaa näiden osien edestä
    assert.deepEqual([...res.html.matchAll(/<span>(.*?)<\/span>/g)].map(m => m[1].replace(/<[^>]*>/g, '')), ['käynnissä 1.5 päivää.', '(käytettävissä 25.2 kt).', 'perustuu versioon 3.4.0 (jisotalo.fi)']);
  });

  it('englanniksi', () => {
    const sim = boot({ start: '2026-10-05T10:00:00', inst: { mode: 0, m0: { c: 1 } } });
    const res = footer(sim, 'en');

    assert.deepEqual(res.rows, [
      'Started at AIKA, uptime 0.0 days.',
      'Memory in use 7.9 kB, peak 18.5 kB (available 25.2 kB).',
      `Version ${sim.status(0).s.v} (@mattik-gh), based on version 3.4.0 (jisotalo.fi)`
    ]);
  });

  it('muistirivi jää pois, jos laite ei kerro muistilukuja', () => {
    const sim = boot({ start: '2026-10-05T10:00:00', inst: { mode: 0, m0: { c: 1 } } });
    assert.equal(footer(sim, 'fi', state => delete state.m).rows.length, 2);
    assert.equal(footer(sim, 'fi', state => state.m = [null, null, null]).rows.length, 2);
  });
});
