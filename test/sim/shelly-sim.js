/**
 * Shelly-simulaattori shelly-porssisahko-skriptin testaamiseen ilman laitetta.
 *
 * Lataa skriptin sellaisenaan (src/shelly-porssisahko.js tai jokin
 * src/after-build/ -versio) Noden vm-kontekstiin ja tarjoaa sille
 * simuloidut Shelly-rajapinnat:
 *
 *  - Shelly.call: KVS.Get / KVS.Set / Switch.Set / HTTP.GET
 *  - Shelly.getComponentStatus / getComponentConfig / getCurrentScriptId
 *  - Timer.set / Timer.clear
 *  - HTTPServer.registerEndpoint
 *  - Date (ohjattava kello), atob, btoa, console
 *
 * Kello ei etene itsestään: aikaa siirretään kutsumalla advance().
 * Kaikki ajastimet ja RPC-vastaukset ajetaan silloin aikajärjestyksessä,
 * joten testit ovat deterministisiä ja nopeita.
 *
 * HUOM: Tämä ei simuloi laitteen muistirajoja eikä Espruino-tulkin eroja.
 */

//Skripti käyttää paikallista aikaa -> kiinnitetään aikavyöhyke
process.env.TZ = process.env.SIM_TZ || 'Europe/Helsinki';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');
const { eleringCsv, defaultPrice } = require('./elering');

const ROOT = path.join(__dirname, '..', '..');
const MAIN_SCRIPT = path.join(ROOT, 'src', 'shelly-porssisahko.js');
const STATICS_DIR = path.join(ROOT, 'src', 'statics');
const MAIN_PLACEHOLDER = '//__REPLACED_WITH_MAIN_CODE__';

/** Eleringin hakuosoitteen alku skriptissä (vaihdetaan vain testeissä, ks. opts.priceUrl) */
const ELERING_URL = '"https://dashboard.elering.ee/api/nps/price/csv?fields="';

/** Laitteen rajat (Shelly Gen2+ skriptit) */
const MAX_TIMERS = 5;
const MAX_CALLS = 5;

/**
 * Lukee skriptin lähdekoodin samaan tapaan kuin build tekee:
 *  - after-build -versioissa pääkoodi liitetään paikalleen
 *  - #[tiedosto] korvataan gzip + base64 -muotoisella staattisella tiedostolla
 *    (ilman minifiointia)
 *
 * @param {string?} script tiedostonimi src/after-build/ alla tai polku. Tyhjä = pääskripti
 * @param {string?} main vaihtoehtoinen pääskripti (esim. vanha versio vertailua varten)
 */
function loadSource(script, main) {
  let code = fs.readFileSync(main ?? process.env.SIM_MAIN ?? MAIN_SCRIPT, 'utf8');

  code = code.replace(/#\[(.*?)\]/g, (m, file) =>
    zlib.gzipSync(fs.readFileSync(path.join(STATICS_DIR, file))).toString('base64'));

  if (script) {
    let file = fs.existsSync(script) ? script : path.join(ROOT, 'src', 'after-build', script);
    let wrapper = fs.readFileSync(file, 'utf8');

    if (!wrapper.includes(MAIN_PLACEHOLDER)) {
      throw new Error(`${file}: ${MAIN_PLACEHOLDER} puuttuu`);
    }
    code = wrapper.replace(MAIN_PLACEHOLDER, () => code);
  }

  return code;
}

/**
 * Yhdistää b:n arvot a:han (sisäkkäiset oliot yhdistetään, taulukot korvataan)
 */
function merge(a, b) {
  for (let key in b) {
    if (b[key] && typeof b[key] === 'object' && !Array.isArray(b[key])
      && a[key] && typeof a[key] === 'object') {
      merge(a[key], b[key]);
    } else {
      a[key] = b[key];
    }
  }
  return a;
}

/**
 * Luo simulaattorin ja käynnistää skriptin.
 *
 * @param {object} opts
 * @param {string|number|Date} opts.start kellonaika käynnistyessä (paikallista aikaa, esim. "2026-10-05T10:00:00")
 * @param {object} opts.kvs KVS:n alkusisältö, esim. { porssi: {...}, "porssi-1": {...} } (oliot tai merkkijonot)
 * @param {string} opts.script after-build -skripti (esim. "shelly-porssisahko-addon-temp.js")
 * @param {string} opts.main vaihtoehtoinen pääskriptin polku (oletus src/shelly-porssisahko.js)
 * @param {string} opts.prelude koodi, joka ajetaan ennen skriptiä (esim. "let INSTANCE_COUNT = 1;")
 * @param {string} opts.user koodi, joka liitetään skriptin perään (esim. USER_OVERRIDE-funktio)
 * @param {string} opts.priceUrl hakuosoitteen alku Eleringin osoitteen tilalle (lainausmerkkeineen), esim. '"http://localhost/script/2/prices?fields="'
 * @param {Function} opts.price (epoch, Date) => hinta c/kWh ilman veroja
 * @param {number} opts.resolution hintadatan resoluutio minuutteina (15 tai 60)
 * @param {boolean} opts.timeSynced false = kellonaika ei tiedossa käynnistyessä
 * @param {number} opts.uptime laitteen käyntiaika sekunteina simulaattorin käynnistyessä (oletus 300 = käynnistyksen lämmittelyaika on jo ohi)
 * @param {number[]} opts.switches olemassa olevat lähdöt
 * @param {object} opts.components Shelly.getComponentStatus-vastaukset, esim. { "temperature:100": { tC: 10 } }
 * @param {string} opts.mac laitteen MAC-osoite (oletus päättyy 00 -> hintahaun viive 180 s, ks. fetchDelay skriptissä)
 */
function createSim(opts = {}) {
  let now = new Date(opts.start ?? '2026-10-05T10:00:00').getTime();
  //Simuloidun laitteen käynnistyshetki (uptime lasketaan tästä)
  const startMs = now;
  let seq = 0;
  let events = [];
  let timerId = 0;
  let callsInProgress = 0;
  let endpoints = {};

  const sim = {
    /** KVS-muisti (avain -> merkkijono) */
    kvs: new Map(),
    /** Script.Stop-kutsut (skriptin id) */
    stoppedScripts: [],
    /** Lähtöjen tila (id -> true/false/undefined jos ei vielä ohjattu) */
    relays: {},
    /** Kaikki Switch.Set-kutsut [{ t, id, on, ok }] */
    switchLog: [],
    /** Kaikki Elering-hintahaut [{ t, url, bytes, b64 }] */
    httpLog: [],
    /** Muut HTTP.GET-kutsut [{ t, url }] */
    otherHttpLog: [],
    /** Skriptin atob-kutsut [{ t, in, out }] (muistiarvioita varten) */
    atobLog: [],
    /** Skriptin console.log-rivit [{ t, msg }] */
    logs: [],
    /** Käsittelemätön virhe (laitteessa skripti pysähtyisi) tai null */
    crashed: null,
    /** false = kellonaikaa ei ole synkronoitu (sys.unixtime == null) */
    timeSynced: opts.timeSynced ?? true,
    /** Laitteen nimi */
    deviceName: opts.deviceName ?? 'Simu',
    /** Komponenttien tilat getComponentStatus-kutsuille */
    components: Object.assign({}, opts.components),
    /** Olemassa olevat lähdöt */
    switches: opts.switches ?? [0, 1, 2],
    /** true = Switch.Set epäonnistuu (muu virhe kuin olematon lähtö) */
    switchFail: false,
    /** lähdöt, joiden Switch.Set epäonnistuu (muu virhe kuin olematon lähtö) */
    switchFailIds: [],
    /** RPC-kutsujen viive (ms) */
    rpcDelay: 20,
    /** Elering-simulaation asetukset */
    net: {
      /** "ok" | "timeout" | "error" | HTTP-statuskoodi (esim. 500) */
      mode: 'ok',
      /** vastausviive (ms) */
      delay: 300,
      /** hinta c/kWh ilman veroja */
      price: opts.price ?? defaultPrice,
      /** resoluutio minuutteina */
      resolution: opts.resolution ?? 15,
      /** jos asetettu, vain näin monta ensimmäistä tuntia palautetaan (vajaa data) */
      maxHours: null,
      /** false = viimeisen rivin perässä ei ole rivinvaihtoa */
      trailingNewline: true,
      /** lisäotsakkeet onnistuneeseen vastaukseen (esim. Cloudflaren raportointiotsakkeet) */
      headers: null,
      /** jos asetettu, tämä palautetaan sellaisenaan: (url) => csv-merkkijono (null = oletusvastaus) */
      body: null,
      /** muiden kuin Elering-pyyntöjen käsittelijä: (url) => { code, body } */
      other: null
    }
  };

  //---------------------------------------------------------------------
  // Kello ja tapahtumajono
  //---------------------------------------------------------------------
  /**
   * Shellyn Date-olio ei tunne kesä- ja talviajan sääntöjä: se käyttää KAIKILLE päivämäärille
   * sitä UTC-poikkeamaa, joka on voimassa juuri nyt (mitattu laitteella:
   * new Date(2026, 2, 29) ja new Date(2026, 9, 25, 23, 59, 59) antoivat molemmat GMT+0300).
   * Laite päivittää poikkeaman kellonsiirron hetkellä.
   *
   * SimDate matkii tätä: paikallinen aika = UTC + nykyhetken poikkeama.
   */
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad2 = (n) => String(n).padStart(2, '0');

  /** Nykyhetken UTC-poikkeama minuutteina (oikeilla aikavyöhykesäännöillä) */
  const offsetNow = () => -new Date(now).getTimezoneOffset();

  class SimDate extends Date {
    constructor(...args) {
      if (args.length === 0) {
        super(now);
      } else if (args.length > 1) {
        //new Date(vuosi, kuukausi, päivä, ...) -> paikallinen aika nykyhetken poikkeamalla
        super(Date.UTC(args[0], args[1], args[2] ?? 1, args[3] ?? 0, args[4] ?? 0, args[5] ?? 0, args[6] ?? 0) - offsetNow() * 60000);
      } else {
        super(args[0]);
      }
    }

    static now() {
      return now;
    }

    /** Aika siirrettynä niin, että UTC-kentät vastaavat laitteen paikallista aikaa */
    shifted() {
      return new Date(this.getTime() + offsetNow() * 60000);
    }

    getFullYear() { return this.shifted().getUTCFullYear(); }
    getMonth() { return this.shifted().getUTCMonth(); }
    getDate() { return this.shifted().getUTCDate(); }
    getDay() { return this.shifted().getUTCDay(); }
    getHours() { return this.shifted().getUTCHours(); }
    getMinutes() { return this.shifted().getUTCMinutes(); }
    getSeconds() { return this.shifted().getUTCSeconds(); }
    getTimezoneOffset() { return -offsetNow(); }

    //Shelly: "Fri Nov 10 2023 00:02:29 GMT+0200" (ei aikavyöhykkeen nimeä)
    toString() {
      let d = this.shifted();
      let off = offsetNow();
      return `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} ${d.getUTCFullYear()} `
        + `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())} `
        + `GMT${off < 0 ? '-' : '+'}${pad2(Math.floor(Math.abs(off) / 60))}${pad2(Math.abs(off) % 60)}`;
    }
  }

  function schedule(delay, fn, repeat) {
    let ev = { t: now + delay, seq: seq++, fn, period: repeat ? delay : 0, id: 0 };
    events.push(ev);
    return ev;
  }

  function crash(err) {
    sim.crashed = err;
    events = [];
    log('*** SKRIPTI PYSÄHTYI: ' + (err && err.stack ? err.stack : err));
  }

  function log(msg) {
    sim.logs.push({ t: now, msg });

    if (process.env.SIM_LOG) {
      console.log(`[${new Date(now).toLocaleString('sv-SE')}] ${msg}`);
    }
  }

  /**
   * Siirtää kelloa eteenpäin ja ajaa kaikki sinä aikana erääntyvät tapahtumat
   */
  sim.advance = (ms) => {
    let target = now + ms;

    while (!sim.crashed) {
      let next = null;

      for (let ev of events) {
        if (ev.t <= target && (!next || ev.t < next.t || (ev.t === next.t && ev.seq < next.seq))) {
          next = ev;
        }
      }

      if (!next) {
        break;
      }

      now = Math.max(now, next.t);

      if (next.period > 0) {
        next.t += next.period;
        next.seq = seq++;
      } else {
        events.splice(events.indexOf(next), 1);
      }

      try {
        next.fn();
      } catch (err) {
        crash(err);
      }
    }

    now = target;
    return sim;
  };

  /** Siirtää kelloa eteenpäin annettuun paikalliseen aikaan asti */
  sim.advanceTo = (date) => {
    let target = new Date(date).getTime();

    if (target < now) {
      throw new Error(`advanceTo: ${date} on menneisyydessä`);
    }
    return sim.advance(target - now);
  };

  /** Antaa skriptin asettua (käynnistys, asetusten luku, hintahaku, logiikat) */
  sim.settle = (ms = 30000) => sim.advance(ms);

  /**
   * Hyppäyttää kellon (esim. NTP korjaa ajan). Ajastimet säilyttävät jäljellä olevan viiveensä.
   */
  sim.setTime = (date) => {
    let target = new Date(date).getTime();
    let diff = target - now;

    events.forEach(ev => ev.t += diff);
    now = target;
    return sim;
  };

  /** Nykyinen simuloitu aika */
  sim.now = () => new SimDate();
  sim.epoch = () => Math.floor(now / 1000);

  //---------------------------------------------------------------------
  // Shelly-rajapinnat
  //---------------------------------------------------------------------
  function httpGet(params) {
    let url = params.url;
    let net = sim.net;

    //Pyyntö laitteen omalle skriptille (esim. asetusskripti pyytää asetusten latausta, tai kellotestien
    //testirajapinta test/device/fake-elering.js). Polku /script/<numero>/<nimi> -> skriptin rekisteröimä nimi
    //Laite palauttaa tekstin kentässä body (esim. application/json) ja muun sisällön kentässä body_b64
    //(mitattu laitteella: JSON-vastaus tuli kentässä body)
    if (url.indexOf('http://localhost/script/') === 0) {
      let path = url.split('?')[0].substring('http://localhost/script/'.length).split('/');
      let r = sim.request(url.includes('?') ? url.substring(url.indexOf('?') + 1) : '', path[1] ?? '');
      let type = (r.headers.find(h => h[0] === 'Content-Type') || [])[1] || '';
      let res = { code: r.code, message: '', headers: {} };

      if (type === 'application/octet-stream') {
        res.body_b64 = Buffer.from(r.body ?? '', 'utf8').toString('base64');
      } else {
        res.body = r.body ?? '';
      }
      return { delay: net.delay, res };
    }

    //Muut kuin Elering-pyynnöt (esim. Open-Meteo) ohjataan net.other-käsittelijälle
    if (!url.includes('elering.ee')) {
      sim.otherHttpLog.push({ t: now, url });
      let other = net.other ? net.other(url) : null;

      if (!other) {
        return { delay: net.delay, res: { code: 404, message: 'Not Found', headers: {}, body: '' } };
      }
      return {
        delay: net.delay,
        res: {
          code: other.code ?? 200,
          message: 'OK',
          headers: {},
          body: typeof other.body === 'string' ? other.body : JSON.stringify(other.body)
        }
      };
    }

    let entry = { t: now, url, bytes: 0, b64: 0 };
    sim.httpLog.push(entry);

    if (net.mode === 'timeout') {
      return { delay: (params.timeout || 10) * 1000, err: -114, msg: 'Timed out' };
    }
    if (net.mode === 'error') {
      return { delay: net.delay, err: -1, msg: 'Connection error: -1' };
    }
    //net.res: vastaus sellaisenaan (esim. virhesivu), { code, body tai body_b64, headers }
    if (net.res) {
      return { delay: net.delay, res: Object.assign({ message: 'Error', headers: {} }, net.res) };
    }
    if (typeof net.mode === 'number') {
      return { delay: net.delay, res: { code: net.mode, message: 'Error', headers: {}, body_b64: '' } };
    }

    //net.body voi palauttaa null, jolloin vastaus muodostetaan kuten ilman sitä
    let body = net.body ? net.body(url) : null;

    if (body == null) {
      body = eleringCsv(url, net);
    }

    //Vastauksen koko muistiarvioita varten (ks. memory.test.js)
    entry.bytes = body.length;
    entry.b64 = Math.ceil(body.length / 3) * 4;

    return {
      delay: net.delay,
      res: {
        code: 200,
        message: 'OK',
        headers: Object.assign({ 'Content-Type': 'text/csv' }, net.headers),
        body_b64: Buffer.from(body, 'latin1').toString('base64')
      }
    };
  }

  function rpc(method, params) {
    //Skripti antaa Switch.Set-parametrit merkkijonona "{id:0,on:true}"
    if (typeof params === 'string') {
      params = vm.runInNewContext('(' + params + ')');
    }

    switch (method) {
      case 'KVS.Get':
        if (!sim.kvs.has(params.key)) {
          return { err: -105, msg: `Argument 'key', value '${params.key}' not found !` };
        }
        return { res: { etag: 'sim', value: sim.kvs.get(params.key) } };

      case 'KVS.Set':
        //Laite: arvon raja on 253 tavua, ja jokainen " ja \\ lasketaan kahtena (mitattu laiteohjelmistolla 2.0.1)
        if (typeof params.value === 'string' && kvsLength(params.value) > 253) {
          return { err: -103, msg: `Invalid argument 'value': length should be less than 255!` };
        }
        sim.kvs.set(params.key, params.value);
        return { res: { etag: 'sim', rev: 1 } };

      case 'Switch.Set': {
        //Laite: olematon lähtö -> -105 "Argument 'id', value 5 not found!" (mitattu laitteella)
        let exists = sim.switches.includes(params.id);
        let ok = exists && !sim.switchFail && !sim.switchFailIds.includes(params.id);
        sim.switchLog.push({ t: now, id: params.id, on: !!params.on, ok });

        if (!exists) {
          return { err: -105, msg: `Argument 'id', value ${params.id} not found!` };
        }
        if (!ok) {
          return { err: -1, msg: 'Switch failed (simulated)' };
        }
        let was_on = !!sim.relays[params.id];
        sim.relays[params.id] = !!params.on;
        return { res: { was_on } };
      }

      case 'HTTP.GET':
        return httpGet(params);

      case 'Script.Stop':
        //Erillinen apuskripti pysäyttää itsensä (ks. sim.runScript)
        sim.stoppedScripts.push(params.id);
        return { res: {} };

      default:
        return { err: -114, msg: `No handler for ${method}` };
    }
  }

  const Shelly = {
    call(method, params, callback, userdata) {
      if (callsInProgress >= MAX_CALLS) {
        throw new Error('Uncaught Error: Too many calls in progress');
      }
      callsInProgress++;

      let r = rpc(method, params);

      schedule(r.delay ?? sim.rpcDelay, () => {
        callsInProgress--;

        if (callback) {
          callback(r.err ? null : r.res, r.err ?? 0, r.err ? r.msg : '', userdata);
        }
      });
    },

    getComponentStatus(name) {
      if (name === 'sys') {
        return { unixtime: sim.timeSynced ? Math.floor(now / 1000) : null, uptime: (opts.uptime ?? 300) + Math.floor((now - startMs) / 1000) };
      }
      if (name === 'wifi') {
        //opts.components.wifi korvaa oletuksen (esim. { sta_ip: null } = ei WiFi-yhteyttä)
        return sim.components.wifi ?? { sta_ip: '192.168.1.50', status: 'got ip' };
      }
      if (name.startsWith('switch:')) {
        return { id: Number(name.split(':')[1]), output: !!sim.relays[Number(name.split(':')[1])] };
      }
      if (name === 'script:1' && !sim.components[name]) {
        //Skriptin muistiluvut (kiinteät arvot - simulaattori ei mittaa muistia)
        return { id: 1, running: true, mem_used: 7900, mem_peak: 18500, mem_free: 17286 };
      }
      return sim.components[name] ?? null;
    },

    getComponentConfig(name) {
      if (name === 'sys') {
        return { device: { name: sim.deviceName } };
      }
      return null;
    },

    getCurrentScriptId() {
      return 1;
    },

    getDeviceInfo() {
      return { id: 'shellysimu-' + (opts.mac ?? 'AABBCCDDEE00').toLowerCase(), mac: opts.mac ?? 'AABBCCDDEE00', model: 'SIM', gen: 2, fw_id: 'sim', ver: 'sim', app: 'Simu' };
    }
  };

  const Timer = {
    set(ms, repeat, callback, userdata) {
      if (events.filter(e => e.id > 0).length >= MAX_TIMERS) {
        throw new Error('Uncaught Error: Too many timers');
      }
      let ev = schedule(ms, () => callback(userdata), repeat);
      ev.id = ++timerId;
      return ev.id;
    },

    clear(id) {
      events = events.filter(e => e.id !== id);
    }
  };

  const HTTPServer = {
    registerEndpoint(name, callback) {
      endpoints[name] = callback;
      return '/script/1/' + name;
    }
  };

  //---------------------------------------------------------------------
  // HTTP-pyynnöt skriptin omaan rajapintaan
  //---------------------------------------------------------------------
  /**
   * Tekee pyynnön skriptin HTTP-rajapintaan, esim. request("r=s&i=0")
   *
   * @param {string} query kyselyosa ilman ?-merkkiä
   * @param {string} name endpointin nimi (tyhjä = pääskriptin rajapinta)
   * @returns {{ code: number, body: string, headers: Array }}
   */
  sim.request = (query = '', name = '') => {
    let result = { code: 0, body: '', headers: [], sent: false };
    let endpoint = endpoints[name];

    if (sim.crashed || !endpoint) {
      result.code = 0;
      return result;
    }

    let response = {
      code: 200,
      body: '',
      headers: [],
      send() {
        result.code = this.code;
        result.body = this.body ?? '';
        result.headers = this.headers ?? [];
        result.sent = true;
        return true;
      }
    };

    try {
      endpoint({ method: 'GET', query, headers: [], body: '' }, response);
    } catch (err) {
      crash(err);
    }

    return result;
  };

  /**
   * Kuten request(), mutta odottaa jos skripti on kiireinen (503) ja jäsentää JSON-vastauksen
   */
  sim.get = (query) => {
    for (let i = 0; i < 100; i++) {
      let res = sim.request(query);

      if (res.code !== 503) {
        let isJson = res.headers.some(h => h[1] === 'application/json')
          && !res.headers.some(h => h[0] === 'Content-Encoding');

        if (res.code === 200 && res.body && isJson) {
          res.json = JSON.parse(res.body);
        }
        return res;
      }
      sim.advance(250);
    }
    throw new Error(`get(${query}): skripti on jatkuvasti kiireinen (503)`);
  };

  /** Purkaa pakatut hinnat (3 tavua per hinta, arvo + 8388608) taulukoksi [0,01 EUR/MWh] */
  const unpackPrices = (str) => {
    let res = [];
    for (let i = 0; i < str.length; i += 3) {
      res.push((str.charCodeAt(i) << 16 | str.charCodeAt(i + 1) << 8 | str.charCodeAt(i + 2)) - 8388608);
    }
    return res;
  };

  /**
   * Skriptin tila (r=s) ohjaukselle
   * Hinnat (p) puretaan taulukoiksi kuten käyttöliittymä tekee - skripti lähettää ne pakattuina (base64)
   */
  sim.status = (inst = 0) => {
    let st = sim.get(`r=s&i=${inst}`).json;

    if (st && st.p) {
      st.p = st.p.map(str => unpackPrices(Buffer.from(str, 'base64').toString('latin1')));
    }
    return st;
  };

  /** Skriptin muistissa olevat raakahinnat [0,01 EUR/MWh] päivälle (0 = tänään, 1 = huomenna) */
  sim.prices = (dayIndex = 0) => unpackPrices(sim.evaluate(`_.p[${dayIndex}]`));

  /**
   * Päivän tuntihinnat riveinä [aikaleima, hinta c/kWh] laskettuna skriptin omalla calcPrices-funktiolla
   * (ALV ja siirtohinnat mukana)
   *
   * @param {number} dayIndex 0 = tänään, 1 = huomenna
   */
  sim.rows = (dayIndex = 0) => {
    let st = sim.status(0).s.p[dayIndex];
    return sim.evaluate(`calcPrices(${dayIndex}, 0, 25, 3600)`).map((price, i) => [st.st + i * 3600, price]);
  };

  /** Kuten rows(), mutta jokaiselle hintajaksolle (15 min) */
  sim.slotRows = (dayIndex = 0) => {
    let st = sim.status(0).s.p[dayIndex];
    return sim.evaluate(`calcPrices(${dayIndex}, 0, 25, 900)`).map((price, i) => [st.st + i * st.sl, price]);
  };

  /** Kuten rows(), mutta 30 minuutin keskiarvot */
  sim.halfRows = (dayIndex = 0) => {
    let st = sim.status(0).s.p[dayIndex];
    return sim.evaluate(`calcPrices(${dayIndex}, 0, 25, 1800)`).map((price, i) => [st.st + i * 1800, price]);
  };

  /**
   * Skriptin historia (r=h) ohjaukselle purettuna riveiksi [aikaleima (s, minuutin tarkkuus), ohjaus, tilakoodi]
   * Skripti tallentaa historian pakattuna merkkijonoon: 4 tavua per rivi
   * (3 tavua minuutteja ajasta 26000000 min, 1 tavu (ohjaus << 4) | tila)
   */
  sim.history = (inst = 0) => {
    let raw = Buffer.from(sim.historyRaw(inst), 'base64');
    let res = [];
    for (let i = 0; i < raw.length; i += 4) {
      res.push([((raw[i] << 16 | raw[i + 1] << 8 | raw[i + 2]) + 26000000) * 60, (raw[i + 3] >> 4) & 1, raw[i + 3] & 15]);
    }
    return res;
  };

  /** Skriptin historia (r=h) sellaisenaan (base64) */
  sim.historyRaw = (inst = 0) => sim.get(`r=h&i=${inst}`).json;

  /**
   * Tallentaa asetukset kuten käyttöliittymä: kirjoittaa KVS:ään ja pyytää skriptiä lataamaan ne.
   *
   * @param {number} inst ohjaus 0..2, tai -1 = vain yleiset asetukset
   * @param {object} cfg muutettavat ohjauksen asetukset (yhdistetään nykyisiin)
   * @param {object} common muutettavat yleiset asetukset (yhdistetään nykyisiin)
   */
  sim.saveConfig = (inst, cfg = {}, common = {}) => {
    sim.writeKvs(inst, cfg, common);
    sim.get(`r=r&i=${inst}`);
    return sim.settle();
  };

  /** Kirjoittaa asetukset KVS:ään ilman uudelleenlatauspyyntöä (uusiin avaimiin listamuodossa, kuten asetussivu) */
  sim.writeKvs = (inst, cfg = {}, common = {}) => {
    if (inst >= 0) {
      sim.setCfg(inst, merge(sim.cfg(inst), cfg));
    }
    sim.setCfg(-1, merge(sim.cfg(-1), common));
  };

  /**
   * KVS:ään tallennetut asetukset oliona (uudet avaimet, listamuoto)
   *
   * @param {number} inst ohjaus 0..2, tai -1 = yleiset asetukset
   */
  sim.cfg = (inst) => sim.kvs.has(kvsKey(inst)) ? kvsUnpack(inst, sim.kvs.get(kvsKey(inst))) : undefined;

  /** Kirjoittaa asetukset KVS:ään listamuodossa (kaikki kentät pitää olla annettu) */
  sim.setCfg = (inst, cfg) => sim.kvs.set(kvsKey(inst), kvsPack(inst, cfg));

  /** Pakko-ohjaus kuten käyttöliittymästä */
  sim.force = (inst, hours, cmd) => {
    let ts = hours > 0 ? Math.floor(now / 1000 + hours * 3600) : 0;
    return sim.get(`r=f&i=${inst}&ts=${ts}&c=${cmd ? 1 : 0}`);
  };

  /**
   * Ajaa lauseen skriptin kontekstissa (pääsy sisäiseen tilaan, esim. evaluate("_.s.errCnt")).
   * Tulos kopioidaan JSON:n kautta, jotta sitä voi verrata assertilla.
   */
  sim.evaluate = (expr) => {
    let res = vm.runInContext(`JSON.stringify(${expr})`, context);
    return res === undefined ? undefined : JSON.parse(res);
  };

  /** Skriptin lokirivit merkkijonoina */
  sim.logLines = () => sim.logs.map(l => l.msg);

  /** Hintahaut päivittäin: montako HTTP.GET-kutsua on tehty annetun ajan jälkeen */
  sim.fetchCount = (sinceMs = 0) => sim.httpLog.filter(h => h.t >= sinceMs).length;

  //---------------------------------------------------------------------
  // Käynnistys
  //---------------------------------------------------------------------
  for (let key in (opts.kvs ?? {})) {
    let value = opts.kvs[key];
    sim.kvs.set(key, typeof value === 'string' ? value : JSON.stringify(value));
  }

  const context = vm.createContext({
    Shelly,
    Timer,
    HTTPServer,
    Date: SimDate,
    atob: (s) => {
      let res = Buffer.from(s, 'base64').toString('latin1');
      sim.atobLog.push({ t: now, in: s.length, out: res.length });
      return res;
    },
    btoa: (s) => Buffer.from(s, 'latin1').toString('base64'),
    console: {
      log: (...args) => log(args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' '))
    }
  });

  sim.context = context;

  /**
   * Ajaa toisen, erillisen skriptin samassa laitteessa (omat muuttujat, yhteinen KVS, ajastimet ja RPC)
   * Esim. src/after-build/shelly-porssisahko-config.js
   *
   * @param {string} code skriptin lähdekoodi
   */
  sim.runScript = (code, filename = 'script2.js') => {
    const other = vm.createContext({
      Shelly, Timer, HTTPServer, Date: SimDate,
      console: { log: (...args) => log(args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')) }
    });
    vm.runInContext(ENGINE_QUIRKS, other);
    vm.runInContext(code, other, { filename });
    return other;
  };

  let code = (opts.prelude ? opts.prelude + '\n' : '')
    + loadSource(opts.script, opts.main)
    + (opts.user ? '\n' + opts.user : '');

  //Hakuosoite vaihdettuna (kellotestien testirajapinta, ks. test/device/fake-elering.js) - vain testissä, kuten laitetestissä
  if (opts.priceUrl) {
    if (code.split(ELERING_URL).length !== 2) {
      throw new Error('Eleringin osoite ei löydy skriptistä yhden kerran');
    }
    code = code.replace(ELERING_URL, opts.priceUrl);
  }

  vm.runInContext(ENGINE_QUIRKS, context);
  vm.runInContext(code, context, { filename: opts.script ?? 'shelly-porssisahko.js' });

  return sim;
}

/**
 * Shellyn skriptitulkin poikkeamat tavallisesta JavaScriptistä, jotka on mitattu laitteelta (Gen 3, laiteohjelmisto 2.0.1).
 * Ajetaan skriptin ympäristössä ennen skriptiä, jotta simulaattori käyttäytyy näissä kohdissa kuten laite.
 *
 * - split(): jos teksti on vähintään kaksi merkkiä erotinta lyhyempi, tulos on tyhjä lista
 *   ("0".split("%2C") -> [], "".split("ab") -> [], mutta "00".split("abc") -> ["00"]). Mitattu laitteella:
 *   lähtölista "0" purettiin erottimella "%2C" tyhjäksi listaksi, ja asetuksiin tallentui tyhjä lähtölista.
 */
const ENGINE_QUIRKS = `
String.prototype.split = (function (split) {
  return function (separator, limit) {
    if (typeof separator === "string" && this.length + 1 < separator.length) {
      return [];
    }
    return split.call(this, separator, limit);
  };
})(String.prototype.split);
`;

/** Pituus, jonka Shelly laskee KVS-arvolle: tavut, ja merkit " ja \ kahtena */
function kvsLength(value) {
  return Buffer.byteLength(value) + (value.match(/["\\]/g) || []).length;
}

/** Vaihtaa merkit " ja ' keskenään (tekstit tallennetaan näin, ks. swapQ() skriptissä) */
function kvsSwap(value) {
  return value.replace(/["']/g, (m) => m == '"' ? "'" : '"');
}

/** KVS-avain: -1 = yleiset asetukset, 0..2 = ohjaukset. old = version 3.x avain */
function kvsKey(inst, old) {
  return (old ? 'porssi' : 'porssisahko') + (inst >= 0 ? `-${inst + 1}` : '');
}

//Asetusten järjestys listamuodossa (ks. pack() skriptissä). Testien oma toteutus, jotta skriptin toteutus tulee verrattua siihen.
const KVS_M2 = ['p', 'c', 'l', 's', 'm', 'ps', 'pe', 'ps2', 'pe2', 'c2', 's2'];
const KVS_INST = ['en', 'mode', 'm0', 'm1', 'm2', 'b', 'e', 'o', 'f', 'fc', 'i', 'm', 'oc', 'q'];
const KVS_COMMON = ['g', 'vat', 'day', 'night', 'names', 'cnt', 'hist', 'tt', 'ss', 'se', 'ds', 'de'];

/** Asetukset oliosta KVS:n listamuotoon (tekstinä) */
function kvsPack(inst, cfg) {
  const list = inst < 0
    ? KVS_COMMON.map(k => cfg[k])
    : KVS_INST.map(k => k == 'm0' ? [cfg.m0.c] : k == 'm1' ? [cfg.m1.l] : k == 'm2' ? KVS_M2.map(m => cfg.m2[m]) : cfg[k]);
  return kvsSwap(JSON.stringify([1].concat(list)));
}

/** Asetukset KVS:n listamuodosta olioksi */
function kvsUnpack(inst, value) {
  const a = JSON.parse(kvsSwap(value));
  if (!Array.isArray(a) || a[0] !== 1) {
    throw new Error('tuntematon muoto: ' + value);
  }
  const res = {};
  (inst < 0 ? KVS_COMMON : KVS_INST).forEach((k, i) => {
    const v = a[i + 1];
    res[k] = k == 'm0' ? { c: v[0] } : k == 'm1' ? { l: v[0] } : k == 'm2' ? Object.fromEntries(KVS_M2.map((m, j) => [m, v[j]])) : v;
  });
  return res;
}

module.exports = { createSim, loadSource, merge, kvsLength, kvsSwap, kvsKey, kvsPack, kvsUnpack, ELERING_URL };
