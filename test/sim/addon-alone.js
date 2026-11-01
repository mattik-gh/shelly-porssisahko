/**
 * Lisäosan ajaminen yksin, ilman pääskriptiä.
 *
 * Lataa src/after-build/ -tiedoston ilman pääkoodia ja antaa sille pelkistetyn version siitä,
 * mitä lisäosa pääskriptiltä käyttää: tilan (_), Shelly-kutsut, HTTP-päätepisteen ja kellon.
 * Testi kutsuu lisäosan funktioita (USER_CONFIG, USER_OVERRIDE) suoraan.
 *
 * Tarkoitus on testata lisäosan omaa logiikkaa nopeasti ja niin, että virheen syy on varmasti
 * lisäosassa. Yhteistoiminta pääskriptin kanssa testataan erikseen simulaattorilla
 * (ks. test/addons/*.test.js, osa "pääskriptin kanssa").
 *
 * HUOM: Pelkistetty tila ei päivity itsestään, jos pääskriptin rakenne muuttuu.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DIR = path.join(__dirname, '..', '..', 'src', 'after-build');
const MAIN_PLACEHOLDER = '//__REPLACED_WITH_MAIN_CODE__';

/** Ohjauksen asetukset siinä muodossa kuin pääskripti ne lisäosalle antaa */
const DEF_INST = { en: 1, mode: 2, m0: { c: 0 }, m1: { l: 0 }, m2: { p: 24, c: 4, l: -999, s: 0, m: 999, ps: 0, pe: 23, ps2: 0, pe2: 23, c2: 0 }, b: 0, e: 0, o: [0], f: 0, fc: 0, i: 0, m: 60, oc: 0, q: 0 };

/**
 * @param {string} name tiedosto src/after-build/ alla
 * @param {object} opts
 * @param {string} opts.now kellonaika alussa (oletus 2026-10-05T10:00:00)
 * @param {object} opts.components Shelly.getComponentStatus-vastaukset, esim. { "temperature:100": { tC: 10 } }
 * @param {object[]} opts.config ohjausten asetusten muutokset oletuksiin, esim. [{ m2: { c: 2 } }]
 */
function loadAddon(name, opts = {}) {
  const source = fs.readFileSync(path.join(DIR, name), 'utf8');
  const code = source.replace(MAIN_PLACEHOLDER, '');

  let now = new Date(opts.now ?? '2026-10-05T10:00:00').getTime();
  const logs = [];
  const calls = [];
  const endpoints = {};

  class SimDate extends Date {
    constructor(...args) {
      if (args.length === 0) { super(now); } else { super(...args); }
    }
    static now() { return now; }
  }

  const state = {
    s: { timeOK: true },
    si: [0, 1, 2].map(() => ({ chkTs: 1000, st: 0, str: '', cmd: 0 })),
    c: {
      c: { g: 'fi', vat: 25.5, day: 0, night: 0, names: ['-', '-', '-'], hist: 24, cnt: 3 },
      i: [0, 1, 2].map(i => {
        const cfg = JSON.parse(JSON.stringify(DEF_INST));
        const patch = (opts.config ?? [])[i] ?? {};
        for (const k in patch) cfg[k] = (typeof patch[k] === 'object' && !Array.isArray(patch[k])) ? Object.assign(cfg[k], patch[k]) : patch[k];
        return cfg;
      })
    }
  };

  const addon = {
    /** Lisäosan lähdekoodi sellaisenaan */
    source,
    /** Pääskriptin tila sellaisena kuin lisäosa sen näkee */
    state,
    /** console.log-rivit */
    logs,
    /** Odottavat Shelly.call-kutsut: { method, params, callback } */
    calls,
    /** Komponenttien tilat (muutettavissa testin aikana) */
    components: Object.assign({}, opts.components),

    /** Onko lisäosassa annettu funktio (esim. "USER_OVERRIDE") */
    has: (fn) => vm.runInContext(`typeof ${fn}`, context) === 'function',

    /** Kutsuu USER_CONFIG(inst, initialized) kuten pääskripti: true = asetukset luettu, false = ennen logiikan ajoa */
    config(inst = 0, initialized = true) {
      context.USER_CONFIG(inst, initialized);
      return state.c.i[inst];
    },

    /**
     * Kutsuu USER_OVERRIDE(inst, cmd, callback) kuten pääskripti logiikan lopuksi.
     * Palauttaa { count, value }: montako kertaa lisäosa vastasi ja millä arvolla (null = aja logiikka uudelleen)
     */
    override(inst, cmd) {
      const res = { count: 0, value: undefined };
      context.USER_OVERRIDE(inst, cmd, (value) => { res.count++; res.value = value; });
      return res;
    },

    /** Vastaa vanhimpaan odottavaan Shelly.call-kutsuun */
    respond(res, err = 0, msg = '') {
      const call = calls.shift();
      if (!call) throw new Error('ei odottavia Shelly.call-kutsuja');
      call.callback(res, err, msg);
    },

    /** HTTP-pyyntö lisäosan rekisteröimään päätepisteeseen. Palauttaa { code, sent } */
    request(query, endpoint) {
      if (!endpoints[endpoint]) throw new Error(`päätepistettä ${endpoint} ei ole rekisteröity`);
      const response = { code: 0, sent: false, send() { this.sent = true; } };
      endpoints[endpoint]({ method: 'GET', query }, response);
      return response;
    },

    /** Rekisteröidyt HTTP-päätepisteet */
    endpoints: () => Object.keys(endpoints),

    /** Siirtää kelloa eteenpäin */
    advance(ms) { now += ms; },

    /** Lisäosan muuttujan tai lausekkeen arvo (esim. "originalConfig.hours") */
    value: (expr) => vm.runInContext(expr, context)
  };

  const context = vm.createContext({
    _: state,
    Date: SimDate,
    console: { log: (...args) => logs.push(args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')) },
    Shelly: {
      getComponentStatus: (n) => addon.components[n] ?? null,
      getCurrentScriptId: () => 1,
      call: (method, params, callback) => { calls.push({ method, params, callback }); }
    },
    HTTPServer: { registerEndpoint: (endpoint, fn) => { endpoints[endpoint] = fn; } },
    Timer: { set: () => 1, clear: () => { } }
  });

  vm.runInContext(code, context, { filename: name });
  return addon;
}

module.exports = { loadAddon, DEF_INST };
