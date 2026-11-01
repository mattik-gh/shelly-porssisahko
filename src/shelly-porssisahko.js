/**
 * @license
 * 
 * shelly-porssisahko
 * shelly-porssisahko-en
 * 
 * (c) Jussi isotalo - http://jisotalo.fi
 * https://github.com/jisotalo/shelly-porssisahko
 * https://github.com/jisotalo/shelly-porssisahko-en
 * 
 * License: GNU Affero General Public License v3.0 
 * 
 * NOTE: This is a modified version (10.0.0) by @mattik-gh, based on version 3.4.0 of the original project.
 * It is not published or supported by the original author.
 */

/**
 * Changes in version 10 compared to 3.4.0 - details are in the comments that start with "v10:"
 * 
 * - Prices: raw price of each 15 min slot is kept in a packed string (_.p),
 *   prices with VAT and transfer fees are calculated when needed (calcPrices)
 * - Price resolution is selected for each instance: hour, 30 min or 15 min (cfg.q)
 * - Parsing: base64 is decoded in chunks, data is validated, only rows of the requested day are used
 * - Fallback: old prices are kept if a request fails, tomorrow's prices become today's prices at midnight
 * - Cheapest hours: rank counting instead of sorting, sliding sum for sequential hours, DST offset for periods
 * - Instance count and history length are settings, history is packed
 * - Config: reload requests are queued, invalid values can't stop the script
 * - Outputs: a missing output is not retried, instances are always run in the same order
 */

/**
 * v10: Returns default config for instance settings (a new object every time)
 * Before: an object in CNST.DEF_CFG. It is removed from memory after startup, so an instance that was added later
 * (setting "cnt") got a copy of the settings of instance #1 instead of the defaults
 */
function defInst() {
  return {
    /** Enabled [0/1]*/
    en: 0,
    /**  
     * Active mode
     * 0: manual mode (on/off toggle)
     * 1: price limit
     * 2: cheapest hours 
    */
    mode: 0,
    /** Settings for mode 0 (manual) */
    m0: {
      /** Manual relay output command [0/1] */
      c: 0
    },
    /** Settings for mode 1 (price limit) */
    m1: {
      /** Price limit limit - if price <= relay output command is set on [c/kWh] */
      l: 0
    },
    /** Settings for mode 2 (cheapest hours) */
    m2: {
      /** Period length (-1 = custom range) [h] (example: 24 -> cheapest hours during 24h) */
      p: 24,
      /** How many cheapest hours (can have decimals if price resolution is 30 or 15 minutes, for example 1.5) */
      c: 0,
      /** Always on price limit [c/kWh] */
      l: -999,
      /** Should the hours be sequential / in a row [0/1] */
      s: 0,
      /** Maximum price limit [c/kWh] */
      m: 999,
      /** Custom period start hour */
      ps: 0,
      /** Custom period end hour */
      pe: 23,
      /** Custom period 2 start hour */
      ps2: 0,
      /** Custom period 2 end hour */
      pe2: 23,
      /** How many cheapest hours (custom period 2) */
      c2: 0,
      /** v10: Should the hours be sequential / in a row (custom period 2) [0/1] */
      s2: 0,
    },
    /** Backup hours [binary] (example: 0b111111 = 00, 01, 02, 03, 04, 05) */
    b: 0b0,
    /** Relay output command if clock time is not known [0/1] */
    e: 0,
    /** Outputs IDs to use (array of numbers) */
    o: [0],
    /** Forced hours [binary] (example: 0b110000000000001100001 = 00, 05, 06, 19, 20) */
    f: 0b0,
    /** Forced hours commands [binary] (example: 0b110000000000001100000 = 05, 06, 19, 20 are forced to on, 00 to off (if forced as in above example "fh" setting) */
    fc: 0b0,
    /** Invert output [0/1] */
    i: 0,
    /** How many first minutes of the hour the output should be on [min]*/
    m: 60,
    /** Output config - when to set output (0 = always after running logic, 1 = only when output changes)*/
    oc: 0,
    /** 
     * Price resolution - logic is run and the output can change at this interval
     * 0: average price of the hour
     * 1: price of each slot (15 min)
     * 2: average price of 30 minutes
     */
    //v10: new setting - see logic() and calcPrices()
    q: 0
  };
}

/** Constants etc. */
const CNST = {
  /** Maximum number of instances (if INSTANCE_COUNT is set, use it instead) - active count is selected in settings */
  INST_COUNT: typeof INSTANCE_COUNT === 'undefined' ? 3 : INSTANCE_COUNT,
  /** Default for the total number of history rows (setting "hist") - if HIST_LEN is set, use it instead */
  HIST_LEN: typeof HIST_LEN === 'undefined' ? 24 : HIST_LEN,
  /** Start time for history timestamps [minutes from epoch] (8.6.2019 - history rows have 24 bits for minutes, so it's valid until 2051) */
  HIST_T0: 26000000,
  /** How many errors with getting prices until to have a break */
  ERR_LIMIT: 3,
  /** How long to wait after multiple errors (>= ERR_LIMIT) before trying again (s) */
  ERR_DELAY: 120,
  /** v10: after this many errors in a row the wait is longer (see ERR_DELAY_LONG) */
  ERR_LONG: 6,
  /** v10: the longer wait between requests in a long outage (s) */
  ERR_DELAY_LONG: 600,
  /** v10: the error counter stops here (a counter that doesn't grow tells that the outage has been very long) */
  ERR_MAX: 7999,
  /** v10: wait after a failed request before the next request (ms) - before: 500 ms like after a successful one */
  ERR_RETRY_MS: 5000,
  /** v10: after the device has started, outputs are not written before the clock time is known or this time has passed (s) */
  //Measured: the clock arrives ~15 s after power-on when the network is up; after a power cut a home router takes 1-3 min to start
  WARMUP: 180,

  /** Default status for an instance */
  DEF_INST_ST: {
    /** epoch when last check was done (logic was run) */
    chkTs: 0,
    /** status as number */
    st: 0,
    /** Additional status string (only meant to be used by user override scripts) */
    str: '',
    /** active command (-1 = not yet determined)*/
    cmd: -1,
    /** 1 if config is checked */
    configOK: 0,
    /** If forced manually, then this is the timestamp until the force is removed */
    fCmdTs: 0,
    /** If forced manually, then this is the command */
    fCmd: 0,
    /** ID of an output that doesn't exist in this device (-1 = all OK) */
    //v10: new - see setRelay()
    oe: -1,
  },

  /** Default configs - deleted from memory after checking */
  DEF_CFG: {

    /** Default config for common settings */
    COM: {
      /** Group (country) to get prices from */
      g: 'fi',
      /** VAT added to spot price [%] */
      vat: 25.5,
      /** Day (07...22) transfer price [c/kWh] - with seasonal transfer: winter weekday */
      day: 0,
      /** Night (22...07) transfer price [c/kWh] - with seasonal transfer: other times */
      night: 0,
      /** Instance names */
      names: [],
      /** Maximum total number of history rows (0...96) - divided by enabled instance count (3 enabled instances and 24 rows -> 8 history rows per each) */
      //v10: new setting (before: only the build constant HIST_LEN)
      hist: typeof HIST_LEN === 'undefined' ? 24 : HIST_LEN,
      /** Number of instances in use (1...CNST.INST_COUNT) - instances that are not in use don't take memory */
      //v10: new setting (before: only the build constant INSTANCE_COUNT) - see setInstCount()
      //Default is 1 for a new installation - see cfgRead() for settings saved by an older version
      cnt: 1,
      /** v10: new - transfer product: 0 = time-of-day transfer (day fee every day), 1 = seasonal transfer (day fee only
       *  in the season on Monday...Saturday, other times night fee) */
      tt: 0,
      /** v10: new - first day of the season as month * 100 + day (1101 = 1.11.) - not on the settings page,
       *  can be changed with shelly-porssisahko-config.js */
      ss: 1101,
      /** v10: new - last day of the season as month * 100 + day (331 = 31.3.), see ss */
      se: 331,
      /** v10: new - first hour of the day fee (0...23) (before: fixed 7), see ss */
      ds: 7,
      /** v10: new - hour when the day fee ends (1...24) (before: fixed 22), see ss */
      de: 22
    },

    /** Default config for instance settings - see defInst() */
    INST: defInst()
  }
};

/** Main state of app */
let _ = {
  s: {
    /** version number */
    v: "10.0.0",
    /** Device name */
    dn: '',
    /** 1 if config is checked */
    configOK: 0,
    /** 1 if we have somewhat ok time */
    timeOK: 0,
    /** active error count */
    errCnt: 0,
    /** epoch of last error */
    errTs: 0,
    /** total count of failed price requests since start (max 999999) */
    //v10: new - statistics for the status page (in RAM only)
    errTot: 0,
    /** epoch of the first failed price request since start */
    errT0: 0,
    /** v10: new - epoch of the first error of the latest outage (errors until a successful request) */
    errT1: 0,
    /** v10: new - count of failed price requests in the latest outage (max 999999) */
    errN: 0,
    /** v10: new - the latest price request: length of the response body (base64) and of the headers [chars] */
    fB: 0,
    fH: 0,
    /** v10: new - script memory peak [B] set by a price request (highest so far), epoch and header length of that request */
    //Shows if the memory peak comes from the price data or from long headers (Cloudflare adds them to some responses)
    fPk: 0,
    fPkTs: 0,
    fPkH: 0,
    /** epoch when started (when time was ok for first time) */
    upTs: 0,
    /** Active time zone as string (URL encoded - such as %2b02:00 = +02:00)*/
    tz: "+02:00",
    /** Active time zone hour difference*/
    tzh: 0,
    /** Enabled instance count */
    enCnt: 0,
    /** price info [0] = today, [1] = tomorrow */
    p: [
      {
        /** time when prices were read (0 = prices should be fetched) */
        ts: 0,
        /** epoch of the first price (start of the day) */
        st: 0,
        /** length of one price slot [s] (900 or 3600) */
        sl: 0,
        /** current price */
        now: 0,
        /** lowest price of  the day */
        low: 0,
        /** highest price of the day */
        high: 0,
        /** average price of the day */
        avg: 0
      },
      {
        /** time when prices were read (0 = prices should be fetched) */
        ts: 0,
        /** epoch of the first price (start of the day) */
        st: 0,
        /** length of one price slot [s] (900 or 3600) */
        sl: 0,
        /** current price (not valid for tomorrow) */
        now: 0,
        /** lowest price of  the day */
        low: 0,
        /** highest price of the day */
        high: 0,
        /** average price of the day */
        avg: 0
      }
    ]
  },
  /** status for instances */
  si: [CNST.DEF_INST_ST], //Initialized later - this is just for autocomplete
  /** 
   * price data [0] = today, [1] tomorrow - raw price [0.01 EUR/MWh] of each slot (15 min or 1 h)
   * To save memory, prices are packed to a binary string: 3 bytes for each slot (price + 8388608, big-endian)
   * Empty string = no prices
   */
  //v10: before, this was an array of [epoch, price] rows (hourly prices with VAT and fees, ~85 bytes per row)
  //Now 96 slots take ~460 bytes per day. Start time and slot length are in _.s.p[x].st and .sl
  p: ["", ""],
  /** 
   * command history for each instance
   * To save memory, history is packed to a binary string: 4 bytes for each row
   * - 3 bytes: time as minutes from CNST.HIST_T0 (big-endian)
   * - 1 byte: (cmd << 4) | status
   */
  //v10: before, this was an array of [epoch, cmd, status] rows (~84 bytes per row), now ~6 bytes per row
  h: [], //Initialized later

  /** actice config */
  c: {
    c: CNST.DEF_CFG.COM,
    i: [CNST.DEF_CFG.INST] //Initialized later - this is just for autocomplete
  }
};

/**
 * Common variables to prevent strange stack issues..
 */
let _i = 0;
let _j = 0;
let _k = 0;
let _inc = 0;
let _cnt = 0;
let _start = 0;
let _end = 0;
let cmd = []; // Active commands for each instances (internal)

/**
 * Cache for today's hourly prices [c/kWh] (see calcPrices())
 * 
 * Empty array = not calculated -> calculated from the raw prices when needed
 * Cleared when raw prices, VAT or transfer fees change and during price requests (to save memory)
 */
//v10: new - without the cache, the logic would unpack the hourly prices on every run (~250 ms)
let hourly = [];

/**
 * Previous epoch time
 * Used to see changes in system time
 */
let prevEpoch = 0;

/**
 * Number of instances in use (see setInstCount())
 * Zero until the common config is read
 */
let instCnt = 0;

/**
 * Instance that is checked first when looking for a logic to run
 * 
 * Normally always 0, so instances are run in the same order (#1, #2, #3)
 * If logic of an instance fails, the next ones are run first (so a failing instance can't block the others)
 */
//v10: new - before, an instance that always failed (for example wrong output id) blocked the instances after it
let nextInst = 0;

/**
 * Config reload request from the user interface
 * Bit 0 = instance #1, bit 1 = instance #2 and so on (common config is always reloaded)
 * Handled by the loop when it is not busy (so the request is never lost)
 */
//v10: new - before, a reload request was answered with 503 and lost if the loop was running
let cfgReq = 0;

/**
 * v10: new - true while settings of version 3.x are being read (the new keys were not found) - see cfgRead()
 * They are then always saved to the new keys, also when nothing had to be filled in
 */
let cfgOld = false;

/**
 * v10: new - 1 = the next failed price request starts a new outage in the error statistics (_.s.errT1, _.s.errN).
 * Set by every successful request. Not the same as _.s.errCnt, which is also cleared when the day changes
 */
let errNew = 1;

/**
 * v10: Delay (seconds after the full hour) of the price requests at midnight and at 15:00 - see pricesNeeded()
 * Set at startup from the MAC address of the device (180..300 s, 3...5 min) - see initialize()
 */
let fetchDelay = 180;

/**
 * Request to update price statistics and hourly prices (see updStats())
 * Bit 0 = today, bit 1 = tomorrow
 * 
 * v10: Statistics are calculated only by the loop (timer), never inside callbacks of Shelly.call().
 * There is much less call stack available inside those callbacks, especially in nested ones:
 * KVS callback -> chkConfig -> callback -> updStats -> calcPrices stopped the script
 * with "Too much recursion" on Shelly Pro 2 (Gen 2). The same code worked on Gen 3.
 */
let statsReq = 0;

/**
 * True if a timer is already set to run the loop (see onServerRequest())
 */
let kick = false;

/**
 * v10: memory in use when the script is at rest (bytes) - for the user interface
 * Updated at the start of each loop(), when nothing else is running
 * (memory read during a HTTP request would include the request itself)
 */
let memRest = 0;

/**
 * True if loop is currently running 
 * (new one is not started + HTTP requests are not handled)
 */
let loopRunning = false;

/**
 * Returns KVS key name for settings
 * 
 * @param {*} inst instance number 0..x or -1 = common
 * @returns 
 */
function getKvsKey(inst, old) {
  //v10: settings have their own keys (before: "porssi" and "porssi-1"...) - see pack()
  let key = old ? "porssi" : "porssisahko";

  if (inst >= 0) {
    key = key + "-" + (inst + 1);
  }

  return key;
}

/**
 * v10: new - format of the settings in KVS
 *
 * Settings are saved as a list of values in a fixed order, without the names of the settings. The first value is the version of the format.
 *   instance: [1,en,mode,[m0.c],[m1.l],[m2.p,c,l,s,m,ps,pe,ps2,pe2,c2,s2],b,e,o,f,fc,i,m,oc,q]
 *   common:   [1,g,vat,day,night,names,cnt,hist,tt,ss,se,ds,de]
 * Texts are written with ' instead of " (see swapQ), for example [1,'fi',25.5,0,0,['Boiler','-','-'],1,24]
 *
 * Why: Shelly allows 253 bytes for a value in KVS and counts every " and \ as two (measured with firmware 2.0.1).
 * As JSON with the names, the settings of an instance did not fit in all cases (worst case 303, as a list about 125).
 *
 * Keys are "porssisahko" (common) and "porssisahko-1"... (instances). Settings of version 3.x ("porssi", "porssi-1"...) are read once,
 * if the new ones are missing, and they are never written - so the old version still works with them, if it is taken back into use.
 *
 * A new setting is added to the end of its list. If a value is missing from the end (saved by an older version), it gets the default value.
 *
 * Note: straight code on purpose (no loops or key tables) - it is easy to check and light for the script engine
 * Note: the settings page saves the values in the order of the keys of the settings it gets from here,
 * so settings in memory always have their keys in this order (see chkConfig)
 * Note: only two functions for both kinds of settings - every function takes about 80 bytes of memory,
 * however short it is (measured on the device)
 *
 * @param {number} inst instance number 0..x or -1 = common
 * @param {object} c settings
 * @returns {string} value for KVS
 */
function pack(inst, c) {
  let m = c.m2;

  return swapQ(JSON.stringify(inst < 0
    ? [1, c.g, c.vat, c.day, c.night, c.names, c.cnt, c.hist, c.tt, c.ss, c.se, c.ds, c.de]
    : [1, c.en, c.mode, [c.m0.c], [c.m1.l], [m.p, m.c, m.l, m.s, m.m, m.ps, m.pe, m.ps2, m.pe2, m.c2, m.s2], c.b, c.e, c.o, c.f, c.fc, c.i, c.m, c.oc, c.q]));
}

/**
 * v10: new - returns settings from a value read from KVS (see pack). Throws an error, if the value is not valid
 *
 * @param {number} inst instance number 0..x or -1 = common
 * @param {string} value value from KVS
 * @returns {object} settings
 */
function unpack(inst, value) {
  let a = JSON.parse(swapQ(value));

  if (typeof a !== "object" || a === null || a[0] !== 1) {
    throw new Error("unknown format");
  }

  if (inst < 0) {
    return { g: a[1], vat: a[2], day: a[3], night: a[4], names: a[5], cnt: a[6], hist: a[7], tt: a[8], ss: a[9], se: a[10], ds: a[11], de: a[12] };
  }

  let m = a[5] || [];

  return {
    en: a[1], mode: a[2], m0: { c: (a[3] || [])[0] }, m1: { l: (a[4] || [])[0] },
    m2: { p: m[0], c: m[1], l: m[2], s: m[3], m: m[4], ps: m[5], pe: m[6], ps2: m[7], pe2: m[8], c2: m[9], s2: m[10] },
    b: a[6], e: a[7], o: a[8], f: a[9], fc: a[10], i: a[11], m: a[12], oc: a[13], q: a[14]
  };
}

/**
 * v10: new - returns the text with the characters " and ' swapped (the same function for both directions)
 * Note: only split() and loops, no join() or regular expressions (not all of them work in the Shelly script engine)
 */
function swapQ(str) {
  let a = str.split("\"");
  let res = "";

  for (let i = 0; i < a.length; i++) {
    let b = a[i].split("'");

    for (let j = 0; j < b.length; j++) {
      res += (j ? "\"" : "") + b[j];
    }

    if (i < a.length - 1) {
      res += "'";
    }
  }

  return res;
}

/**
 * Limits the value to min..max range
 * @param {number} min 
 * @param {number} value 
 * @param {number} max 
 */
function limit(min, value, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Returns epoch time (seconds) without decimals
 * 
 * @param {Date?} date Date object (optional) - if not provided, using new Date()
 */
function epoch(date) {
  return Math.floor((date ? date.getTime() : Date.now()) / 1000.0);
}

/**
 * Updates current timezone to state 
 *  - _.s.tz is set to timezone as string 
 *    - If timezone is UTC -> result is "Z"
 *    - Otherwise the result is in format similar to -0200 or +0200
 *  - _.s.tzh is set to timezone hour difference (minutes are not handled)
 * 
 * @param {Date} now Date to use
 */
function updateTz(now) {
  //Get date as string: Fri Nov 10 2023 00:02:29 GMT+0200
  let tz = now.toString();
  let h = 0;

  //Get timezone part: +0200
  tz = tz.substring(tz.indexOf("GMT") + 3);

  //If timezone is UTC, we need to use Z
  if (tz == "+0000") {
    tz = "Z";
    h = 0;

  } else {
    //tz is now similar to -0100 or +0200 -> add : between hours and minutes
    h = Number(tz.substring(0, 3));
    tz = tz.substring(0, 3) + ":" + tz.substring(3);
  }

  if (tz != _.s.tz) {
    //Timezone has changed -> we should get prices
    //v10: not when the clock changes for daylight saving time (DST) and today's prices are in memory: the request of a DST day
    //covers the whole day (see getPrices), and prices are stored by time, so they stay valid. Before, prices were requested
    //again at once on every device at the same second, and the first hour of the day was dropped when DST ended.
    //DST change: last Sunday of March or October (EU, all countries of the price data), at 02...05 and by one hour.
    //Other time zone changes (time zone changed in the device settings) get the prices again as before
    if (!(_.p[0] != "" && now.getDay() == 0 && (now.getMonth() == 2 || now.getMonth() == 9) && now.getDate() > 24
      && now.getHours() >= 2 && now.getHours() < 5 && Math.abs(h - _.s.tzh) == 1)) {
      _.s.p[0].ts = 0;
    }
  }

  _.s.tz = tz;
  _.s.tzh = h;
}

/**
 * console.log() wrapper
 * 
 * @param {string} str String to log
 */
function log(str) {
  console.log("shelly-porssisahko: " + str);
}

/**
 * Adds command to history
 */
function addHistory(inst) {
  //v10: history length is a setting (0 = not in use) and rows are packed - see _.h
  let max = _.c.c.hist;

  if (max <= 0) {
    //History is not in use
    return;
  }

  //Calculate history max length (based on instance count)
  if (_.s.enCnt > 0) {
    max = max / _.s.enCnt;
  }

  while (_.h[inst].length >= max * 4) {
    //Removing the oldest row
    _.h[inst] = _.h[inst].substring(4);
  }

  //Minutes from the start time
  max = ((epoch() / 60) | 0) - CNST.HIST_T0;

  if (!_.s.timeOK) {
    //v10: clock time is not known (device has started and time is not yet synchronized) - the clock can show anything
    //-> saving minutes from the start of the device instead (max 99999), so the rows are kept in order
    //The user interface shows these small values as "time not known" (a real time is always millions of minutes)
    max = Math.min(99999, (Shelly.getComponentStatus("sys").uptime / 60) | 0);
  }
  _.h[inst] += String.fromCharCode(max >> 16 & 255, max >> 8 & 255, max & 255, (cmd[inst] ? 16 : 0) | (_.si[inst].st & 15));
}

/**
 * Request all logics to run
 */
function reqLogic() {
  for (let i = 0; i < instCnt; i++) {
    _.si[i].chkTs = 0;
  }
}

/**
 * Updates state (called intervally)
 * - Checks if time is OK
 * - Some things need to be kept up-to-date here
 */
function updateState() {
  let now = new Date();

  //Using unixtime from sys component to detect if NTP is synced (= time OK)
  //Previously used only Date() but after some firmware update it started to display strange dates at boot
  _.s.timeOK = Shelly.getComponentStatus("sys").unixtime != null && now.getFullYear() > 2000;
  _.s.dn = Shelly.getComponentConfig("sys").device.name;

  //Detecting if time has changed and getting prices again
  let epochNow = epoch(now);

  if (_.s.timeOK && Math.abs(epochNow - prevEpoch) > 300) {
    log("Time changed 5 min+ -> refresh");

    _.s.p[0].ts = 0;
    _.s.p[0].now = 0;
    _.s.p[1].ts = 0;
    _.p[0] = "";
    _.p[1] = "";
    hourly = [];

    //v10: new - error counter is cleared too
    //Error timestamp is no longer valid
    //(if time went backwards, the delay after errors would never end)
    _.s.errCnt = 0;
  }

  //v10: a new day starts a new sequence of price requests (see pricesNeeded) - if there are no prices for the new day
  //after an outage, the first request is made at once instead of waiting for the long delay
  //Note: prevEpoch is 0 at startup (1.1.1970) - the counter is 0 then anyway
  if (_.s.timeOK && new Date(prevEpoch * 1000).getDate() != now.getDate()) {
    _.s.errCnt = 0;
  }
  prevEpoch = epochNow;

  //Instance stuff
  _.s.enCnt = 0;

  for (_i = 0; _i < instCnt; _i++) {
    if (_.c.i[_i].en) {
      _.s.enCnt++; //Enabled instance count
    }
  }

  if (!_.s.upTs && _.s.timeOK) {
    _.s.upTs = epoch(now);
  }
}

/**
 * Sets the number of instances in use
 * Creates new instances or removes the last ones
 * 
 * Note: Called only when the config is read, so no logic is running at the same time
 * 
 * @param {number} count number of instances
 */
function setInstCount(count) {
  //v10: new function - instances are created and removed at runtime by the setting (one instance takes ~700 bytes)
  while (instCnt > count) {
    //Removing the last instance
    _.si.pop();
    _.c.i.pop();
    _.h.pop();
    cmd.pop();
    instCnt--;
  }

  while (instCnt < count) {
    //New instance - status and config are copied from defaults
    //(or from the first instance, if defaults are already removed from memory)
    let st = Object.assign({}, CNST.DEF_INST_ST || _.si[0]);
    st.chkTs = 0;
    st.st = 0;
    st.str = '';
    st.cmd = -1;
    st.configOK = 0;
    st.fCmdTs = 0;
    st.fCmd = 0;
    st.oe = -1;
    _.si.push(st);

    //v10: defaults from defInst() (before: a copy of the default object, or of instance #1 if defaults were already removed)
    //Note: a new object, so instances don't share any objects (like m2)
    _.c.i.push(defInst());

    _.h.push("");
    cmd.push(false);
    instCnt++;
  }

  nextInst = 0;
}

/**
 * Checks configuration
 * If a config key is missings, adds a new one with default value
 * (or with value from the previous config if defaults are already removed)
 */
function chkConfig(inst, prev, callback) {
  let count = 0;

  //Are we checking instance or common config
  let source = inst < 0 ? CNST.DEF_CFG.COM : CNST.DEF_CFG.INST;
  let target = inst < 0 ? _.c.c : _.c.i[inst];

  //v10: new - before, missing values were filled only at startup (defaults are deleted after it)
  //If default config is already removed from memory, missing values are taken from the previous config
  if (!source) {
    source = prev;
  }

  //v10: new setting m2.s2 (sequential hours for custom period 2)
  //If it's missing (settings from an older version), period 2 works as before = same as period 1
  if (inst >= 0 && typeof target.m2 === "object" && target.m2 !== null && typeof target.m2.s2 === "undefined" && typeof target.m2.s !== "undefined") {
    target.m2.s2 = target.m2.s;
    count++;
  }

  //Note: Hard-coded to max 2 levels
  for (let prop in source) {
    //Is the value an object or an array?
    let obj = typeof source[prop] === "object" && source[prop] !== null;

    //v10: type check is new. Arrays are no longer merged item by item (an empty output list stays empty)
    //Value is replaced if it's missing or if it should be an object / an array but it isn't
    //(config can be edited manually - wrong type would crash or lock the script)
    if (typeof target[prop] === "undefined"
      || (obj && (typeof target[prop] !== "object" || target[prop] === null || (target[prop].length === undefined) != (source[prop].length === undefined)))) {
      //v10: before, all instances shared the same m0/m1/m2 objects after a fresh install
      //Note: objects are copied, so they are not shared between instances
      target[prop] = obj ? JSON.parse(JSON.stringify(source[prop])) : source[prop];
      count++;

    } else if (obj && source[prop].length === undefined) {
      //Note: arrays are not checked item by item (for example empty output list is a valid setting)
      for (let innerProp in source[prop]) {
        if (typeof target[prop][innerProp] === "undefined") {
          target[prop][innerProp] = source[prop][innerProp];
          count++;
        }
      }
    }
  }

  if (inst < 0) {
    //v10: new settings cnt and hist are validated here
    //Instance count needs to be 1...max
    let cnt = Math.floor(Number(target.cnt));

    if (!(cnt >= 1 && cnt <= CNST.INST_COUNT)) {
      cnt = CNST.INST_COUNT;
    }

    if (target.cnt !== cnt) {
      target.cnt = cnt;
      count++;
    }

    //Each instance needs to have a name
    if (typeof target.names !== "object") {
      target.names = [];
    }

    while (target.names.length < target.cnt) {
      target.names.push("-");
      count++;
    }

    //Creating or removing instances
    setInstCount(target.cnt);

    //History length needs to be 0...96
    let hist = typeof target.hist === "number" ? Math.floor(target.hist) : -1;

    if (!(hist >= 0 && hist <= 96)) {
      hist = CNST.HIST_LEN;
    }

    if (target.hist !== hist) {
      target.hist = hist;
      count++;
    }

    //v10: new - transfer product, season and day hours (see DEF_CFG.COM). Invalid values get the default
    //Season days: month 1...12 and day 1...31 (month * 100 + day)
    if (target.tt !== 0 && target.tt !== 1) {
      target.tt = 0;
      count++;
    }
    if (!(target.ss % 1 == 0 && target.ss % 100 >= 1 && target.ss % 100 <= 31 && target.ss >= 101 && target.ss <= 1231)) {
      target.ss = 1101;
      count++;
    }
    if (!(target.se % 1 == 0 && target.se % 100 >= 1 && target.se % 100 <= 31 && target.se >= 101 && target.se <= 1231)) {
      target.se = 331;
      count++;
    }
    //Day hours: start 0...23, end start+1...24
    if (!(target.ds % 1 == 0 && target.de % 1 == 0 && target.ds >= 0 && target.ds < target.de && target.de <= 24)) {
      target.ds = 7;
      target.de = 22;
      count++;
    }

    //Removing the oldest history rows if there are too many
    for (let i = 0; i < instCnt; i++) {
      while (_.h[i].length > hist * 4) {
        _.h[i] = _.h[i].substring(4);
      }
    }

  } else {
    //v10: new check
    //Period length needs to be at least 1 hour (or -1 / -2 = custom periods)
    //Note: zero would cause an endless loop when selecting the cheapest hours
    if (!(target.m2.p >= 1 || target.m2.p == -1 || target.m2.p == -2)) {
      target.m2.p = 24;
      count++;
    }
  }

  if (inst >= instCnt - 1 && inst >= 0) {
    //Deleting default config after 1st check to save memory
    CNST.DEF_CFG.COM = null;
    CNST.DEF_CFG.INST = null;
    CNST.DEF_INST_ST = null;
  }

  //v10: new - settings as text for KVS (a list of values)
  //Settings in memory are created again from it, so their keys are always in the same order - see pack()
  let value = pack(inst, target);

  if (inst < 0) {
    _.c.c = unpack(inst, value);
  } else {
    _.c.i[inst] = unpack(inst, value);
  }

  //v10: settings of version 3.x are always saved to the new keys (see cfgOld)
  if (count > 0 || cfgOld) {
    let key = getKvsKey(inst);

    Shelly.call("KVS.Set", { key: key, value: value }, function (res, err, msg, callback) {
      if (err) {
        log("failed to set config: " + err + " - " + msg);
      }
      callback(err == 0);

    }, callback);
    return;
  }

  //All settings OK
  callback(true);
}

/**
 * v10: Settings have been read from KVS (before: a part of getConfig)
 * If there are no settings, the settings of version 3.x are read (once - after that the settings are in the new keys)
 * Note: a named function - the second read is a new call, not a call inside a call
 *
 * @param {*} inst instance number 0..x or -1 = common
 */
function cfgRead(res, err, msg, inst) {
  if (!res && !cfgOld) {
    cfgOld = true;
    Shelly.call('KVS.Get', { key: getKvsKey(inst, true) }, cfgRead, inst);
    return;
  }

  let key = getKvsKey(inst, cfgOld);
  //Active country (to see if it changes)
  let g = _.c.c.g;
  //Previous config (used for missing values)
  let prev = inst < 0 ? _.c.c : _.c.i[inst];

  let cfg = {};

  try {
    if (res) {
      //Settings of version 3.x are JSON with the names of the settings
      cfg = cfgOld ? JSON.parse(res.value) : unpack(inst, res.value);
    }
  } catch (err) {
    //v10: before, invalid JSON stopped the script (exception in a callback)
    //Invalid JSON (for example edited manually) -> active config is kept
    log("invalid config " + key + ": " + err);
    cfg = null;
  }

  //v10: instance count is 1 only for a new installation (no settings at all)
  //If there are settings without it (saved by version 3.x, or they can't be read at startup), all instances are kept in use,
  //so an instance that is in use can't disappear (the user can lower the count in the settings)
  if (inst < 0 && res && (!cfg || typeof cfg.cnt === "undefined") && (cfg || CNST.DEF_CFG.COM)) {
    (cfg || _.c.c).cnt = CNST.INST_COUNT;
  }

  if (cfg && typeof cfg === "object") {
    if (inst < 0) {
      _.c.c = cfg;
    } else {
      _.c.i[inst] = cfg;
    }
  }

  if (typeof USER_CONFIG == 'function') {
    USER_CONFIG(inst, true);
  }

  chkConfig(inst, prev, function (ok) {
    //Common config or instance
    if (inst < 0) {
      _.s.configOK = ok ? 1 : 0;

      //v10: prices are requested again only if the country changes
      //(before: after every save - and if that request failed, the prices were lost)
      if (g != _.c.c.g) {
        //Country has changed -> old prices are no longer valid
        _.p = ["", ""];
        _.s.p[0].ts = 0;
        _.s.p[1].ts = 0;
        //v10: the wait after failed requests is cleared, so the new country is requested at once
        _.s.errCnt = 0;
      }

      //VAT or transfer fees may have changed -> statistics are updated by the loop (see statsReq)
      statsReq = 3;

    } else {
      log("config for #" + (inst + 1) + " read, enabled: " + _.c.i[inst].en);

      _.si[inst].configOK = ok ? 1 : 0;
      _.si[inst].chkTs = 0; //To run the logic again with new settings
      _.si[inst].oe = -1;
    }

    loopRunning = false;
    Timer.set(500, false, loop);
  });
}

/**
 * Background process loop
 */
function loop() {
  try {
    kick = false;

    if (loopRunning) {
      return;
    }
    loopRunning = true;

    //v10: see memRest
    memRest = (Shelly.getComponentStatus("script:" + Shelly.getCurrentScriptId()) || {}).mem_used;

    //v10: reload requests are handled here - see cfgReq
    if (cfgReq) {
      //Config reload is requested
      for (let inst = 0; inst < instCnt; inst++) {
        if (cfgReq & (1 << inst)) {
          _.si[inst].configOK = 0;
        }
      }

      _.s.configOK = 0; //reload settings (prevent getting prices before new settings loaded )
      cfgReq = 0;
      reqLogic();
    }

    updateState();

    if (_.p[1].length > 0 && new Date(_.s.p[1].st * 1000).getDate() === new Date().getDate()) {
      //v10: new - before, tomorrow's prices were discarded at midnight and today's prices were requested again
      //(backup hours were used if that request failed)
      //Date has changed -> tomorrow's prices are now today's prices
      //They are used until new prices are fetched (and also if fetching fails)
      _.p[0] = _.p[1];
      _.p[1] = "";
      _.s.p[0].st = _.s.p[1].st;
      _.s.p[0].sl = _.s.p[1].sl;
      _.s.p[0].ts = 0;
      _.s.p[1].ts = 0;
      statsReq = statsReq | 1;
    }

    if (statsReq) {
      //Price statistics need to be updated - see statsReq
      //Note: done here before anything else, so the logic always has valid values
      if (statsReq & 1) {
        updStats(0);
      }

      if (statsReq & 2) {
        updStats(1);
      }

      statsReq = 0;
    }

    if (!_.s.configOK) {
      //Common config
      //v10: reading starts here (before: function getConfig - every function takes memory) - see cfgRead()
      cfgOld = false;
      Shelly.call('KVS.Get', { key: getKvsKey(-1) }, cfgRead, -1);

    } else if (pricesNeeded(0)) {
      //Prices for today
      getPrices(0);

    } else if (pricesNeeded(1)) {
      //Prices for tomorrow
      getPrices(1);

    } else {
      //Instances
      //Separate loops to make sure configs are read first and in all cases
      for (let inst = 0; inst < instCnt; inst++) {
        if (!_.si[inst].configOK) {
          //We need to update config to this instance
          cfgOld = false;
          Shelly.call('KVS.Get', { key: getKvsKey(inst) }, cfgRead, inst);
          return;
        }
      }

      for (let i = 0; i < instCnt; i++) {
        //v10: see nextInst
        //Starting from the first one (or after the one that failed)
        let inst = (nextInst + i) % instCnt;

        if (logicRunNeeded(inst)) {
          //We need to run logic for this instance
          //Running using a timer to prevent stack issues
          nextInst = inst + 1;
          Timer.set(500, false, logic, inst);
          return;
        }
      }

      //If we are here, there is nothing to
      //Is there a user script?
      if (typeof USER_LOOP == 'function') {
        USER_LOOP();
      } else {
        loopRunning = false;
      }
    }
  } catch (err) {
    //Shouldn't happen
    log("error at main loop:" + err);
    loopRunning = false;
  }
}

/**
 * Returns true if we need to fetch prices for selected day
 * 
 * @param {number} dayIndex 0 = today, 1 = tomorrow
 */
function pricesNeeded(dayIndex) {
  let now = new Date();
  let res = false;

  //v10: seconds after the full hour - requests at midnight and at 15:00 wait for the device-specific delay (see fetchDelay)
  //Devices of the same site don't request at the same moment, and never in the same seconds as version 3.x
  let sec = now.getMinutes() * 60 + now.getSeconds();

  if (dayIndex == 1) {
    /*
    Getting prices for tomorrow if
      - we have a valid time
      - clock is past 15:00 local time (NOTE: Elering seems to have prices after 14.30 LOCAL time, no matter is it DST or not)
        v10: and the delay has passed (also at startup - there is no hurry for tomorrow's prices)
      - we don't have prices
    */
    res = _.s.timeOK && _.s.p[1].ts === 0 && (now.getHours() > 15 || (now.getHours() == 15 && sec >= fetchDelay));

  } else {
    /*
    Getting prices for today if
      - we have a valid time
      - we don't have prices OR prices aren't fetched during this day
    */
    //Note: when date changes, tomorrow's prices are moved to today's prices by the loop
    //v10: the day of the prices is checked from the middle of the price day (before: from the time of the request).
    //A request made at 00...01 before DST ended looked like yesterday's after the clock change, and prices were requested again
    res = _.s.timeOK && (_.s.p[0].ts == 0 || new Date((_.s.p[0].st + 43200) * 1000).getDate() !== now.getDate());

    //v10: at midnight, today's prices are already in use (moved from tomorrow) and this request only checks for changes
    //-> waits for the delay. If there are no prices for today (startup, failed requests), prices are requested at once
    if (res && now.getHours() == 0 && sec < fetchDelay && new Date(_.s.p[0].st * 1000).getDate() == now.getDate()) {
      res = false;
    }
  }

  //If fetching prices has failed too many times -> wait until trying again
  //v10: the wait is 2 min after the first errors and 10 min after ERR_LONG errors in a row (before: always 2 min)
  //The counter is cleared only by a successful request (before: when the wait was over - every wait was followed by
  //ERR_LIMIT new requests). Sequence: 3 requests about 5 s apart (ERR_RETRY_MS), 2 min, 1 request, 2 min, 1 request, 2 min, 1 request, then 10 min...
  //Prices are not urgent: today's prices are already in use, and tomorrow's prices are needed only at midnight
  //Also the first requests are at least ERR_RETRY_MS apart (the 10 s loop could otherwise request right after a failure)
  if (_.s.errCnt > 0 && (epoch(now) - _.s.errTs) < (_.s.errCnt >= CNST.ERR_LONG ? CNST.ERR_DELAY_LONG : (_.s.errCnt >= CNST.ERR_LIMIT ? CNST.ERR_DELAY : CNST.ERR_RETRY_MS / 1000))) {
    res = false;
  }

  return res;
}

/**
 * 
 */
/**
 * Returns true if we should run the logic now
 * for the selected instance
 * 
 * @param {*} inst instance number 0..x
 */
function logicRunNeeded(inst) {
  //Shortcuts
  let st = _.si[inst];
  let cfg = _.c.i[inst];

  //If not enabled, do nothing
  if (cfg.en != 1) {
    //clear history
    _.h[inst] = "";
    return false;
  }

  let now = new Date();
  let chk = new Date(st.chkTs * 1000);

  //for debugging (run every minute)
  /*
  return st.chkTs == 0
    || (chk.getMinutes() !== now.getMinutes()
    || chk.getFullYear() !== now.getFullYear())
    || (st.fCmdTs > 0 && st.fCmdTs - epoch(now) < 0)
    || (st.fCmdTs == 0 && cfg.m < 60 && now.getMinutes() >= cfg.m && (st.cmd + cfg.i) == 1);
  */

  /*
    Logic should be run if
    - never run before
    - hour has changed (checked from epoch, as clock hour doesn't change when DST ends)
      or 15 / 30 minutes has passed, if more accurate price resolution is used
    - year has changed (= time has been received)
    - manually forced command is active and time has passed
    - user wants the output to be commanded only for x first minutes of the hour which has passed (and command is not yet reset)
  */
  //v10: compared by epoch and price resolution (before: by clock hour, which doesn't change when DST ends)
  let unit = cfg.q ? (cfg.q == 2 ? 1800 : 900) : 3600;

  return st.chkTs == 0
    || (Math.floor(st.chkTs / unit) !== Math.floor(epoch(now) / unit)
      || chk.getFullYear() !== now.getFullYear())
    || (st.fCmdTs > 0 && st.fCmdTs - epoch(now) < 0)
    || (!cfg.q && st.fCmdTs == 0 && cfg.m < 60 && now.getMinutes() >= cfg.m && (st.cmd + cfg.i) == 1);
}

/**
 * Returns prices [c/kWh] of selected day for hours start...end-1
 * (index 0 = first hour of the data)
 * 
 * v10: new function. Prices are no longer stored with VAT and fees, they are calculated here from the raw prices
 * 
 * Prices are calculated from the raw prices: VAT and transfer fees are added
 * One price is the average of the slots during the selected time (unit):
 * - 3600: one price for each hour
 * - 1800: two prices for each hour
 * - 900: price of each slot (15 min)
 * 
 * @param {number} dayIndex 0 = today, 1 = tomorrow
 * @param {number} start index of the first hour
 * @param {number} end index of the last hour + 1
 * @param {number} unit length of one price [s] (3600, 1800 or 900)
 */
function calcPrices(dayIndex, start, end, unit) {
  let res = [];
  let raw = _.p[dayIndex];

  if (raw.length == 0) {
    return res;
  }

  //Note: using local variables as this is called often (faster than accessing the state)
  let vat = _.c.c.vat;
  //How many slots in an hour (4 or 1)
  let slots = 3600 / _.s.p[dayIndex].sl;
  //Count of slots (3 bytes each)
  let count = raw.length / 3;
  //How many bytes in one price (3 bytes for each slot)
  let group = Math.max(1, unit / _.s.p[dayIndex].sl) * 3;
  let fee = 0;
  let sum = 0;
  let price = 0;
  let i = 0;
  let j = 0;
  let k = 0;
  let last = 0;

  //Clock hour of the first price (to select the transfer fee)
  let date = new Date(_.s.p[dayIndex].st * 1000);
  let hour = date.getHours();

  //v10: new - is the day fee used at all on this day (see DEF_CFG.COM.tt)
  //Time-of-day transfer: every day. Seasonal transfer: in the season (also over the turn of the year) on Monday...Saturday
  //Note: checked once for the day, as the month and the weekday don't change during it
  //Note: date and weekday from the middle of the day. Date uses the current UTC offset for all dates, so after DST
  //has ended, the first price (00:00 summer time) is at 23:00 of the previous day (Sunday would be Saturday)
  date = new Date((_.s.p[dayIndex].st + 43200) * 1000);
  let c = _.c.c;
  let md = (date.getMonth() + 1) * 100 + date.getDate();
  let dayFee = !c.tt || ((c.ss <= c.se ? md >= c.ss && md <= c.se : md >= c.ss || md <= c.se) && date.getDay() != 0);
  date = null;

  for (i = start; i < end && i * slots < count; i++) {
    //Transfer fee (if any) by the clock hour
    j = (hour + i) % 24;

    //v10: the hours of the day fee are settings (before: fixed 07...22)
    if (dayFee && j >= c.ds && j < c.de) {
      //day
      fee = _.c.c.day;
    } else {
      //night
      fee = _.c.c.night;
    }

    //Slots of this hour (the last hour might be incomplete)
    //Note: j, k and last are byte positions (3 bytes for each slot)
    last = Math.min((i + 1) * slots, count) * 3;

    if (group == 3) {
      for (j = i * slots * 3; j < last; j += 3) {
        //Unpacking the price, converting to c/kWh and adding VAT and transfer fee to price
        price = ((raw.charCodeAt(j) << 16 | raw.charCodeAt(j + 1) << 8 | raw.charCodeAt(j + 2)) - 8388608) / 100;
        res.push(price / 10.0 * (100 + (price > 0 ? vat : 0)) / 100.0 + fee);
      }

    } else {
      for (k = i * slots * 3; k < last; k += group) {
        sum = 0;

        for (j = k; j < k + group && j < last; j += 3) {
          //Unpacking the price, converting to c/kWh and adding VAT and transfer fee to price
          price = ((raw.charCodeAt(j) << 16 | raw.charCodeAt(j + 1) << 8 | raw.charCodeAt(j + 2)) - 8388608) / 100;
          sum += price / 10.0 * (100 + (price > 0 ? vat : 0)) / 100.0 + fee;
        }

        res.push(sum / ((j - k) / 3));
      }
    }
  }

  return res;
}

/**
 * Updates average, lowest and highest price of the day
 * 
 * v10: new function (before: calculated while parsing the response)
 * 
 * @param {number} dayIndex 0 = today, 1 = tomorrow
 */
function updStats(dayIndex) {
  let st = _.s.p[dayIndex];
  let prices = calcPrices(dayIndex, 0, 25, 3600);

  st.avg = 0;
  st.high = -999;
  st.low = 999;

  for (_i = 0; _i < prices.length; _i++) {
    st.avg += prices[_i];

    if (prices[_i] > st.high) {
      st.high = prices[_i];
    }

    if (prices[_i] < st.low) {
      st.low = prices[_i];
    }
  }

  st.avg = prices.length > 0 ? (st.avg / prices.length) : 0;

  if (dayIndex == 0) {
    //Hourly prices are needed by the logic -> saving to the cache
    hourly = prices;
  }
}

/**
 * Gets prices for selected day
 * 
 * @param {number} dayIndex 0 = today, 1 = tomorrow
 */
function getPrices(dayIndex) {
  try {
    log("fetching prices for day " + dayIndex)
    let now = new Date();
    updateTz(now);

    //Cache is not needed during the request -> clearing to save memory
    hourly = [];

    let date = dayIndex == 1
      ? new Date(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() + 24 * 60 * 60 * 1000) //tomorrow at 00:00
      : now;

    let month = (date.getMonth() < 9 ? "0" : "") + (date.getMonth() + 1);
    let day = (date.getDate() < 10 ? "0" : "") + date.getDate();

    let start = date.getFullYear()
      + "-"
      + month
      + "-"
      + day
      + "T00:00:00"
      + _.s.tz.replace("+", "%2b"); //URL encode the + character

    //v10: new - before, hours of the next or the previous day were included when DST changes
    //Date as it is in the price data (dd.mm.yyyy) - used to skip prices of other days
    //The time zone of the request can be wrong when DST changes during the day (Shelly knows only the current time zone)
    let dateStr = day + "." + month + "." + date.getFullYear();

    let end = start.replace("T00:00:00", "T23:59:59");

    //v10: new - DST day (last Sunday of March or October): the request is one hour longer at both ends.
    //The day starts and ends with different time zones, but the request can only use the current one, so the last hour
    //of the day was missing when DST ended. Hours of other days are skipped by the date (see dateStr)
    if (date.getDay() == 0 && (date.getMonth() == 2 || date.getMonth() == 9) && date.getDate() > 24) {
      let mm = _.s.tz.length > 1 ? _.s.tz.substring(3) : ":00";
      let h = _.s.tzh + 1;
      start = start.substring(0, 19) + (h < 0 ? "-" : "%2b") + (h > -10 && h < 10 ? "0" : "") + Math.abs(h) + mm;
      h = h - 2;
      end = end.substring(0, 19) + (h < 0 ? "-" : "%2b") + (h > -10 && h < 10 ? "0" : "") + Math.abs(h) + mm;
    }

    let req = {
      url: "https://dashboard.elering.ee/api/nps/price/csv?fields=" + _.c.c.g + "&start=" + start + "&end=" + end,
      timeout: 5,
      ssl_ca: "*"
    };

    //Clearing variables to save memory
    now = null;
    start = null;
    end = null;

    //v10: new - script memory peak before the request (see _.s.fPk)
    let pk = (Shelly.getComponentStatus("script:" + Shelly.getCurrentScriptId()) || {}).mem_peak;

    Shelly.call("HTTP.GET", req, function (res, err, msg) {
      req = null;

      try {
        //v10: new - lengths of the response (see _.s.fB), headers counted as lines "name: value"
        //Note: done at the memory peak of the request (body and headers in memory) -> no string copies here
        //("" + value made a copy of each value and raised the peak by ~460 B on the device)
        if (res != null) {
          _.s.fB = typeof res.body_b64 === "string" ? res.body_b64.length : (typeof res.body === "string" ? res.body.length : 0);
          _.s.fH = 0;

          for (let k in (res.headers || {})) {
            _.s.fH += k.length + res.headers[k].length + 4;
          }
        }

        if (err === 0 && res != null && res.code === 200 && res.body_b64) {
          //Clearing some fields to save memory
          res.headers = null;
          res.message = null;
          msg = null;

          //Tomorrow's old prices are not needed anymore
          //(today's old prices are kept until new ones are received)
          if (dayIndex == 1) {
            _.p[1] = "";
          }

          //v10: before, the whole response was decoded to one string
          //Decoding base64 in small chunks and parsing lines as they become available
          //This way the whole CSV is never in memory at once (only base64 + one chunk)
          let b64 = res.body_b64;
          res.body_b64 = null;

          //Raw price [0.01 EUR/MWh] of each slot (15 min or 1 h) packed to a string (3 bytes for each)
          let prices = "";
          //Count of prices
          let count = 0;
          let b64Pos = 0;
          let buf = "";
          let header = true;
          let lines = null;
          let row = null;
          let i = 0;
          let index = 0;
          let time = 0;
          let price = 0;
          //Epoch of the first price and length of one slot [s]
          let st = 0;
          let sl = 0;

          while (b64Pos < b64.length) {
            //Next chunk (length needs to be a multiple of 4)
            buf += atob(b64.substring(b64Pos, b64Pos + 256));
            b64Pos += 256;

            //Splitting to lines - the last one may be incomplete and is handled with the next chunk
            lines = buf.split("\n");
            buf = b64Pos < b64.length ? lines.pop() : "";

            for (i = 0; i < lines.length; i++) {
              //"epoch";"date";"price" -> epoch is at index 1 and price at index 5
              row = lines[i].split("\"");

              if (header) {
                //Discarding header
                header = false;

              } else if (row.length > 5 && (row[3].substring(0, 10) == dateStr || row[3].length != 16)) {
                //Note: Second column is the local date and time (dd.mm.yyyy hh:mm)
                //Rows of other days are skipped (if date is not in expected format, all rows are used)
                time = Number(row[1]);
                //Note: 8388608 is added to have always a positive value (0...16777215) for packing
                price = Math.round(Number(row[5].replace(",", ".")) * 100) + 8388608;

                if (count == 0) {
                  st = time;
                } else if (count == 1) {
                  sl = time - st;
                }

                //Index of the row
                index = count == 0 ? 0 : (time - st) / sl;

                //v10: new validation
                //Rows should be in order and with a constant interval and price should fit to 3 bytes
                //Note: comparison x >= 0 is false if x is NaN
                if (index != count || !(price >= 0 && price < 16777216)) {
                  if (!(index > count) || index > 100 || index != Math.floor(index) || !(price >= 0 && price < 16777216)) {
                    throw new Error("invalid data received");
                  }

                  //Rows are missing -> using the previous price for them
                  while (count < index) {
                    prices += prices.substring(prices.length - 3);
                    count++;
                  }
                }

                prices += String.fromCharCode(price >> 16 & 255, price >> 8 & 255, price & 255);
                count++;
              }
            }
          }

          b64 = null;
          buf = null;
          lines = null;
          row = null;

          //Again to save memory..
          res = null;

          if (sl <= 0 || count * sl < 23 * 3600) {
            //Let's assume that if we have data for at least 23 hours everything is OK
            //This should take DST saving changes in account
            //If we get less the prices may not be updated yet to elering API?
            throw new Error("invalid data received");
          }

          //v10: active prices are replaced only here, when the new ones are complete and valid
          //Taking new prices in use and updating timestamp
          _.p[dayIndex] = prices;
          _.s.p[dayIndex].st = st;
          _.s.p[dayIndex].sl = sl;
          _.s.p[dayIndex].ts = epoch();

          //v10: a successful request ends the error sequence (see pricesNeeded)
          _.s.errCnt = 0;
          //...and the outage of the statistics (see errNew)
          errNew = 1;

          //Statistics and hourly prices are updated by the loop (see statsReq)
          statsReq = statsReq | (1 << dayIndex);

          //Run all logic again if prices are for today
          if (dayIndex == 0) {
            reqLogic();
          }
        } else {
          //v10: before, the whole response was written to the log with JSON.stringify(res)
          //- a large error page could use all the memory
          //Response is not valid (error message, error page of a proxy etc.)
          //Note: it's unknown data from outside and it can be large
          //-> only response code and length are written to the log, content is not used at all
          let info = "";

          if (res != null) {
            info = " - code " + res.code + ", length " + (typeof res.body_b64 === "string" ? res.body_b64.length : (typeof res.body === "string" ? res.body.length : 0));
            res = null;
          }

          throw new Error(err + " (" + msg + ")" + info);
        }

      } catch (err) {
        log("getting prices failed, see README");
        log(err);
        if (_.s.errCnt < CNST.ERR_MAX) {
          _.s.errCnt++;
        }
        _.s.errTs = epoch();

        //Statistics (counter is limited to prevent overflow)
        if (_.s.errTot == 0) {
          _.s.errT0 = _.s.errTs;
        }
        if (_.s.errTot < 999999) {
          _.s.errTot++;
        }
        //v10: new - the latest outage: first error and count (see errNew)
        if (errNew) {
          errNew = 0;
          _.s.errT1 = _.s.errTs;
          _.s.errN = 0;
        }
        if (_.s.errN < 999999) {
          _.s.errN++;
        }
        //v10: old prices are kept and used until new ones are received (before: cleared -> backup hours)
        _.s.p[dayIndex].ts = 0;

        //v10: before, all logic was run again after every failed request
        //If there are no prices for today, running all logic again once, when backup hours start (ERR_LIMIT failures)
        //After that the logic is run at the change of the hour as usual - running it after every failure
        //wrote the outputs every few minutes during an outage (original project, issue #37)
        //Note: not needed if old prices are still in use (nothing has changed)
        if (dayIndex == 0 && _.p[0] == "" && _.s.errCnt == CNST.ERR_LIMIT) {
          reqLogic();
        }
      }

      //v10: new - if the script memory peak rose during this request, the request set it (see _.s.fPk)
      res = Shelly.getComponentStatus("script:" + Shelly.getCurrentScriptId());

      if (res && res.mem_peak > pk && res.mem_peak > _.s.fPk) {
        _.s.fPk = res.mem_peak;
        _.s.fPkTs = epoch();
        _.s.fPkH = _.s.fH;
      }
      res = null;

      //Done (success or not)
      //v10: after a failure the next request is made 5 s later, not at once (the counter is 0 after a success)

      loopRunning = false;
      Timer.set(_.s.errCnt > 0 ? CNST.ERR_RETRY_MS : 500, false, loop);
    });

  } catch (err) {
    log("getting prices failed, see README");
    log(err);
    if (_.s.errCnt < CNST.ERR_MAX) {
      _.s.errCnt++;
    }
    _.s.errTs = epoch();

    //Statistics (counter is limited to prevent overflow)
    if (_.s.errTot == 0) {
      _.s.errT0 = _.s.errTs;
    }
    if (_.s.errTot < 999999) {
      _.s.errTot++;
    }
    //v10: new - the latest outage: first error and count (see errNew)
    if (errNew) {
      errNew = 0;
      _.s.errT1 = _.s.errTs;
      _.s.errN = 0;
    }
    if (_.s.errN < 999999) {
      _.s.errN++;
    }

    //v10: old prices are kept and used until new ones are received (before: cleared -> backup hours)
    _.s.p[dayIndex].ts = 0;

    //Done (error)
    //If there are no prices for today, running all logic again once, when backup hours start (see above)
    if (dayIndex == 0 && _.p[0] == "" && _.s.errCnt == CNST.ERR_LIMIT) {
      reqLogic();
    }

    loopRunning = false;
    Timer.set(CNST.ERR_RETRY_MS, false, loop);
  }
}

/**
 * Sets relay output to cmd
 * If callback given, its called with success status, like cb(true)
 * 
 * @param {number} output output number
 * @param {Function} callback callback to call after done
 */
function setRelay(inst, output, callback) {
  let prm = "{id:" + output + ",on:" + (cmd[inst] ? "true" : "false") + "}";

  Shelly.call("Switch.Set", prm, function (res, err, msg, cb) {
    if (err != 0) {
      log("setting output " + output + " failed: " + err + " - " + msg);
    }

    if (err == -105) {
      //v10: new - before, this was retried every 10 s and the instances after this one were never run
      //Output doesn't exist in this device -> no reason to try again (shown as a warning to the user)
      _.si[inst].oe = output;
    }

    callback(err == 0 || err == -105);
  }, callback);
}

/**
 * Runs the main logic
 */
function logic(inst) {
  try {
    //This is a good time to update config if any overrides exist
    if (typeof USER_CONFIG == 'function') {
      USER_CONFIG(inst, false);
    }

    cmd[inst] = false;
    let now = new Date();
    updateTz(now);
    let hasPrice = updateCurrentPrice();

    let st = _.si[inst];
    let cfg = _.c.i[inst];

    //v10: price resolution (cfg.q) - with 15 or 30 min the same logic is run with shorter prices
    //Prices used by this instance and index of the current one
    //Normally hourly prices - or prices of 30 or 15 minutes, if selected (and if price data has them)
    let prices = hourly;
    let unit = 3600;
    let index = Math.floor((epoch(now) - _.s.p[0].st) / unit);
    let price = 0;

    if (cfg.q && hasPrice) {
      unit = Math.max(_.s.p[0].sl, cfg.q == 2 ? 1800 : 900);
    }

    if (unit < 3600 && cfg.mode === 2) {
      //All prices of the day are needed to find the cheapest ones
      prices = calcPrices(0, 0, 25, unit);
      index = Math.floor((epoch(now) - _.s.p[0].st) / unit);

      if (index < prices.length) {
        price = prices[index];
      } else {
        hasPrice = false;
      }

    } else if (unit < 3600 && cfg.mode === 1) {
      //Only the current price is needed -> calculating only the current hour (it's faster)
      let part = calcPrices(0, index, index + 1, unit);
      let slot = Math.floor((epoch(now) - _.s.p[0].st - index * 3600) / unit);

      if (slot < part.length) {
        price = part[slot];
      } else {
        hasPrice = false;
      }

    } else if (hasPrice) {
      price = prices[index];
    }

    if (cfg.mode === 0) {
      //Manual mode
      cmd[inst] = cfg.m0.c === 1;
      st.st = 1;

    } else if (_.s.timeOK && hasPrice) {
      //We have time and we have price data for today

      if (cfg.mode === 1) {
        //Price limit
        cmd[inst] = price <= (cfg.m1.l == "avg" ? _.s.p[0].avg : cfg.m1.l);
        st.st = cmd[inst] ? 2 : 3;

      } else if (cfg.mode === 2) {
        //Cheapest hours
        cmd[inst] = isCheapestHour(inst, prices, index, 3600 / unit);
        st.st = cmd[inst] ? 5 : 4;

        //always on price limit
        if (!cmd[inst] && price <= (cfg.m2.l == "avg" ? _.s.p[0].avg : cfg.m2.l)) {
          cmd[inst] = true;
          st.st = 6;
        }

        //maximum price
        if (cmd[inst] && price > (cfg.m2.m == "avg" ? _.s.p[0].avg : cfg.m2.m)) {
          cmd[inst] = false;
          st.st = 11;
        }
      }

    } else if (_.s.timeOK) {
      //We have time but no data for today
      //v10: new - while the first quick requests are still being retried (see pricesNeeded), the outputs are not written:
      //if the next request succeeds, the output goes directly to the price decision instead of a short backup-hour switch.
      //Backup hours are used after ERR_LIMIT failed requests (about 15 s), and the output keeps its state until then
      if (_.s.errCnt > 0 && _.s.errCnt < CNST.ERR_LIMIT) {
        log("waiting for the prices (#" + (inst + 1) + ")");
        loopRunning = false;
        return;
      }
      st.st = 7;

      let binNow = (1 << now.getHours());
      if ((cfg.b & binNow) == binNow) {
        cmd[inst] = true;
      }

    } else {
      //Time is not known
      //v10: new - the clock time usually arrives a few seconds after the device has started (NTP), so during the first
      //WARMUP seconds the outputs are not written at all: the emergency setting would switch them, and the price decision
      //would switch them back a moment later (measured: a double switch at every power cut). The logic is run again on
      //the next loop. The outputs stay in the state that the device's own power-on setting gives them.
      if (Shelly.getComponentStatus("sys").uptime < CNST.WARMUP) {
        st.st = 0;
        log("waiting for the clock time (#" + (inst + 1) + ")");
        loopRunning = false;
        return;
      }
      cmd[inst] = cfg.e === 1;
      st.st = 8;
    }

    //Forced hours
    if (_.s.timeOK && cfg.f > 0) {
      let binNow = (1 << now.getHours());
      if ((cfg.f & binNow) == binNow) {
        cmd[inst] = (cfg.fc & binNow) == binNow;
        st.st = 10;
      }
    }

    //Final check - if user wants to set command only for first x minutes
    //(not used if logic is run for every 15 or 30 minutes)
    //Manual force is only thing that overrides
    if (cmd[inst] && _.s.timeOK && !cfg.q && now.getMinutes() >= cfg.m) {
      st.st = 13;
      cmd[inst] = false;
    }

    //Manual force
    if (_.s.timeOK && st.fCmdTs > 0) {
      if (st.fCmdTs - epoch(now) > 0) {
        cmd[inst] = st.fCmd == 1;
        st.st = 9;
      } else {
        st.fCmdTs = 0;
      }
    }

    function logicFinalize(finalCmd) {
      if (finalCmd == null) {
        //User script wants to re-run logic
        loopRunning = false;
        return;
      }
      //Normally cmd == finalCmd, but user script could change it
      if (cmd[inst] != finalCmd) {
        st.st = 12;
      }

      cmd[inst] = finalCmd;

      //Invert?
      if (cfg.i) {
        cmd[inst] = !cmd[inst];
      }
      log("logic for #" + (inst + 1) + " done, cmd: " + finalCmd + " -> output: " + cmd[inst]);

      //v10: empty output list is handled here (before: no callback was ever called, so the loop stayed busy forever)
      if ((cfg.oc == 1 && st.cmd == cmd[inst]) || cfg.o.length == 0) {
        //No need to write (or there are no outputs to write)
        log("outputs already set for #" + (inst + 1));
        st.cmd = cmd[inst] ? 1 : 0;
        st.chkTs = epoch();
        nextInst = 0;
        loopRunning = false;
        return;
      }

      let cnt = 0;
      let success = 0;
      st.oe = -1;

      for (let i = 0; i < cfg.o.length; i++) {
        setRelay(inst, cfg.o[i], function (res) {
          cnt++;

          if (res) {
            success++;
          }

          if (cnt == cfg.o.length) {
            //All done
            if (success == cnt) {
              if (st.cmd != cmd[inst]) {
                addHistory(inst);
              }

              st.cmd = cmd[inst] ? 1 : 0;
              st.chkTs = epoch();
              nextInst = 0;

              //We can continue almost immediately as everything went nicely
              Timer.set(500, false, loop);
            }

            loopRunning = false;
          }
        });
      }
    }

    //User script
    if (typeof USER_OVERRIDE == 'function') {
      USER_OVERRIDE(inst, cmd[inst], logicFinalize);
    } else {
      logicFinalize(cmd[inst]);
    }

  } catch (err) {
    log("error running logic: " + JSON.stringify(err));
    loopRunning = false;
  }
}

/**
 * Returns true if current hour (or slot) is one of the cheapest
 * 
 * NOTE: Variables starting with _ are intentionally in global scope
 * to fix memory/stack issues
 * 
 * @param {number} inst instance number 0..x
 * @param {number[]} prices prices of today (hourly prices or prices of each slot)
 * @param {number} now index of the current price
 * @param {number} mult how many prices in an hour (1, 2 or 4)
 */
//v10: renamed from _avg - holds the sum of the cheapest sequence found so far (before: average price)
let _min = 0;
let _startIndex = 0;
let _sum = 0;
let _off = 0;

function isCheapestHour(inst, prices, now, mult) {
  let cfg = _.c.i[inst];

  //Safety checks
  cfg.m2.ps = limit(0, cfg.m2.ps, 23);
  cfg.m2.pe = limit(cfg.m2.ps, cfg.m2.pe, 24);
  cfg.m2.ps2 = limit(0, cfg.m2.ps2, 23);
  cfg.m2.pe2 = limit(cfg.m2.ps2, cfg.m2.pe2, 24);
  cfg.m2.c = limit(0, cfg.m2.c, cfg.m2.p > 0 ? cfg.m2.p : cfg.m2.pe - cfg.m2.ps);
  cfg.m2.c2 = limit(0, cfg.m2.c2, cfg.m2.pe2 - cfg.m2.ps2);

  let res = false;

  if (now < 0 || now >= prices.length) {
    return false;
  }

  //This is (and needs to be) 1:1 in both frontend and backend code
  //Select increment (a little hacky - to support custom periods too)
  //Note: Settings are in hours -> multiplied to get the count of prices (hour = 1 or 4 prices)
  _inc = cfg.m2.p < 0 ? 1 : cfg.m2.p * mult;

  //v10: new
  //Safety check (zero would cause an endless loop)
  if (!(_inc > 0)) {
    return false;
  }

  //v10: new - before, periods were one hour late for the rest of the day when DST starts
  //Periods are set as clock hours but prices are handled by index
  //Normally the first price is from 00:00 so they are the same - but not when daylight saving time (DST) changes:
  //after DST has started, the first price is from 01:00 by the new time (one hour is missing from the day)
  //-> offset = clock hour of the first price by the current time zone (as number of prices)
  _off = new Date(_.s.p[0].st * 1000).getHours();

  if (_off > 12) {
    //First price is from the previous day (DST has ended and prices are not yet updated)
    _off -= 24;
  }

  _off *= mult;

  for (_i = 0; _i - _off < prices.length; _i += _inc) {
    //Hour count can have decimals (for example 1.5 h = 3 x 30 min) -> rounding to full prices
    _cnt = Math.round((cfg.m2.p == -2 && _i >= 1 ? cfg.m2.c2 : cfg.m2.c) * mult);

    //Safety check
    if (_cnt <= 0)
      continue;

    //If custom period -> select hours from that range. Otherwise use this period
    //v10: new - a period from 00 starts from the first price and a period to 24 ends to the last one
    //(when DST ends, the day has 25 hours and the offset alone would leave the first hour out after the change)
    _start = _i == 0 ? 0 : _i - _off;
    _end = _i + _inc >= 24 * mult ? prices.length : _i + _inc - _off;

    if (cfg.m2.p < 0 && _i == 0) {
      //Custom period 1 
      _start = cfg.m2.ps == 0 ? 0 : cfg.m2.ps * mult - _off;
      _end = cfg.m2.pe == 24 ? prices.length : cfg.m2.pe * mult - _off;

    } else if (cfg.m2.p == -2 && _i == 1) {
      //Custom period 2
      _start = cfg.m2.ps2 == 0 ? 0 : cfg.m2.ps2 * mult - _off;
      _end = cfg.m2.pe2 == 24 ? prices.length : cfg.m2.pe2 * mult - _off;
    }

    //Period can't start before the first price
    if (_start < 0) {
      _start = 0;
    }

    //If we have less hours than 24 then skip the rest from the end
    if (_end > prices.length) {
      _end = prices.length;
    }

    //Only the period of the current hour needs to be checked
    if (now >= _start && now < _end) {

      if (_end - _start <= _cnt) {
        //All hours of the period are needed
        res = true;

      } else if (cfg.m2.p == -2 && _i >= 1 ? cfg.m2.s2 : cfg.m2.s) {
        //v10: custom period 2 has its own setting (s2)
        //v10: sliding sum (before: the sum of every window was calculated separately)
        //The result can differ only if two windows have exactly the same sum
        //Find cheapest in a sequence
        //Sum of the first sequence..
        _sum = 0;

        for (_j = _start; _j < _start + _cnt; _j++) {
          _sum += prices[_j];
        }

        //Cheapest sum so far
        _min = _sum;
        _startIndex = _start;

        //..and then moving the sequence one hour at a time (adding the new hour and removing the first one)
        //If sum of these sequential hours is lower -> it's better
        for (_j = _start + 1; _j <= _end - _cnt; _j++) {
          _sum += prices[_j + _cnt - 1] - prices[_j - 1];

          if (_sum < _min) {
            _min = _sum;
            _startIndex = _j;
          }
        }

        if (now >= _startIndex && now < _startIndex + _cnt) {
          res = true;
        }

      } else {
        //v10: rank counting instead of sorting the period - same result, also when prices are equal
        //(on the device, sorting 96 prices took ~2.7 s and this takes ~80 ms)
        //Count how many hours of the period are cheaper than the current hour
        //(if the price is the same, earlier hour is cheaper)
        _k = 0;

        for (_j = _start; _j < _end; _j++) {
          if (prices[_j] < prices[now] || (prices[_j] == prices[now] && _j < now)) {
            _k++;
          }
        }

        //Current hour is one of the cheapest if there are not enough cheaper hours
        if (_k < _cnt) {
          res = true;
        }
      }
    }

    //If custom period, quit when all periods are done (1 or 2 periods)
    if (cfg.m2.p == -1 || (cfg.m2.p == -2 && _i >= 1))
      break;
  }

  return res;
}

/**
 * Update current price to _.s.p[0].now
 * Returns true if OK, false if failed
 */
function updateCurrentPrice() {
  if (!_.s.timeOK || _.p[0] == "") {
    _.s.p[0].now = 0;
    return false;
  }

  if (hourly.length == 0) {
    //Hourly prices are not yet calculated
    hourly = calcPrices(0, 0, 25, 3600);
  }

  //Index of the current hour
  let hour = Math.floor((epoch() - _.s.p[0].st) / 3600);

  if (hour >= 0 && hour < hourly.length) {
    //This hour is active 
    _.s.p[0].now = hourly[hour];
    return true;
  }

  //If we are here the active hour wasn't found
  //This means that Shelly clock is wrong or we have prices for wrong date (Shelly clock _was_ wrong, but no longer)
  //All we can do is clear active prices and try again
  //Let's also increase error counter to prevent flooding Elering if things go terribly wrong
  _.p[0] = "";
  hourly = [];
  _.s.p[0].ts = 0;
  _.s.p[0].now = 0;
  if (_.s.errCnt < CNST.ERR_MAX) {
    _.s.errCnt++;
  }
  _.s.errTs = epoch();
  return false;
}

/**
 * Parses parameters from HTTP GET request query to array of objects
 * For example key=value&key2=value2
 * 
 * @param {string} params 
 */
function parseParams(params) {
  let res = {};
  let splitted = params.split("&");

  for (let i = 0; i < splitted.length; i++) {
    let pair = splitted[i].split("=");

    res[pair[0]] = pair[1];
  }

  return res;
}

/**
 * Handles server HTTP requests
 * @param {*} request 
 * @param {*} response 
 */
/**
 * v10: Settings from a HTTP request (r=w), part 1: saved settings have been read
 * The given settings are changed and the settings are written back (only if something changes)
 * Note: settings in memory are not written as they are - a user script may have changed them
 * Note: named functions, as nested anonymous functions crash the script on the device
 *
 * @param {*} data { i: instance, v: settings to change, for example { "en": 1, "m2.c": 4 } }
 */
function manualRead(res, err, msg, data) {
  let cfg = null;
  let cnt = 0;

  try {
    cfg = unpack(data.i, res.value);
  } catch (e) {
    //No saved settings or they can't be read
  }

  if (!cfg) {
    return;
  }

  for (let key in data.v) {
    //For example "m2.c" is the setting c of m2
    let p = key.split(".");
    let o = p.length > 1 ? cfg[p[0]] : cfg;
    let k = p[p.length - 1];

    if (JSON.stringify(o[k]) !== JSON.stringify(data.v[key])) {
      o[k] = data.v[key];
      cnt++;
    }
  }

  if (cnt == 0) {
    //Nothing to change
    return;
  }

  Shelly.call("KVS.Set", { key: getKvsKey(data.i), value: pack(data.i, cfg) }, manualSaved, data.i);
}

/**
 * v10: Settings from a HTTP request (r=w), part 2: settings have been saved
 * Settings are reloaded by the loop, like after saving them in the user interface
 */
function manualSaved(res, err, msg, inst) {
  if (err) {
    log("failed to set config: " + err + " - " + msg);
    return;
  }

  cfgReq = cfgReq | (1 << inst);

  if (!loopRunning && !kick) {
    kick = true;
    Timer.set(50, false, loop);
  }
}

function onServerRequest(request, response) {
  try {
    //Parsing parameters (key=value&key2=value2) to object
    let params = parseParams(request.query);
    let inst = parseInt(params.i);

    request = null;

    //v10: config reload request is always accepted (handled later if busy)
    if (loopRunning && params.r !== "r") {
      response.code = 503;
      //NOTE: Uncomment the next line for local development or remote API access (allows cors)
      //response.headers = [["Access-Control-Allow-Origin", "*"]];
      response.send();
      return;
    }

    let MIME_TYPE = "application/json"; //default
    response.code = 200; //default
    let GZIP = true; //default

    let MIME_HTML = "text/html";
    let MIME_JS = "text/javascript";
    let MIME_CSS = "text/css";

    if (params.r === "s") {
      //s = get state
      updateState();

      if (inst >= 0 && inst < instCnt) {
        //v10: memory usage of the script for the user interface: [in use at rest, peak, total] (bytes)
        //In use at rest is from the loop (see memRest) - peak and total are read here
        let mem = Shelly.getComponentStatus("script:" + Shelly.getCurrentScriptId()) || {};

        //Building status object for certain instance
        response.body = JSON.stringify({
          s: _.s,
          si: _.si[inst],
          c: _.c.c,
          ci: _.c.i[inst],
          //v10: format changed - raw prices of each slot (before: rows [epoch, price] with VAT and fees)
          //The user interface calculates the prices the same way as calcPrices()
          //Prices as base64 (packed binary strings can't be sent as they are)
          p: [btoa(_.p[0]), btoa(_.p[1])],
          //Current time of the device (so the user interface doesn't need to trust the clock of the browser)
          t: epoch(),
          m: [memRest, mem.mem_peak, mem.mem_used + mem.mem_free]
        });
      } else {
        //v10: new
        //Instance is not in use -> only common status and config (so the user interface can select another instance)
        response.body = JSON.stringify({
          s: _.s,
          c: _.c.c
        });
      }
      GZIP = false;

    } else if (params.r === "c") {
      //c = get config
      updateState();

      if (inst >= 0 && inst < instCnt) {
        response.body = JSON.stringify(_.c.i[inst]);
      } else {
        //common
        response.body = JSON.stringify(_.c.c);
      }

      GZIP = false;

    } else if (params.r === "h") {
      //h = get history
      if (inst >= 0 && inst < instCnt) {
        //v10: format changed
        //History as base64 (packed binary string can't be sent as it is)
        response.body = JSON.stringify(btoa(_.h[inst]));
      }

      GZIP = false;

    } else if (params.r === "r") {
      //r = reload settings
      if (inst >= 0 && inst < instCnt) {
        //Just one instance
        log("config changed for #" + (inst + 1));
        cfgReq = cfgReq | (1 << inst);

      } else {
        //For all
        log("config changed");
        //v10: before, a request without a valid instance number stopped the script
        cfgReq = (1 << CNST.INST_COUNT) - 1;
      }

      //Request is handled by the loop (right away if not busy)
      //v10: loop is started with a timer and not called from here (to keep the call stack short, see statsReq)
      if (!loopRunning && !kick) {
        kick = true;
        Timer.set(50, false, loop);
      }

      response.code = 204;
      GZIP = false;

    } else if (params.r === "f" && (params.ts || params.mi)) {
      //f = force
      //ts = end time (epoch) or 0 = cancel
      //v10: new alternative mi = minutes from now (0 = cancel) - the end time is calculated from the clock of the device
      //If both are given, mi is used. An invalid mi (not a number or negative) is ignored
      if (inst >= 0 && inst < instCnt && (!params.mi || Number(params.mi) >= 0)) {
        _.si[inst].fCmdTs = params.mi ? (Number(params.mi) > 0 ? Math.floor(epoch() + Number(params.mi) * 60) : 0) : Number(params.ts);
        _.si[inst].fCmd = Number(params.c);
        _.si[inst].chkTs = 0;

        //v10: logic is run right away (before: at the next round of the loop, so the output followed up to 10 s later)
        //Loop is started with a timer, like when settings are reloaded (see kick)
        if (!loopRunning && !kick) {
          kick = true;
          Timer.set(50, false, loop);
        }
      }

      response.code = 204;
      GZIP = false;

    } else if (params.r === "w") {
      //v10: new - w = write settings of an instance. Only the settings that are useful to change from outside:
      //  en=1|0 (in use), o=0,1 (outputs), f=24 characters, one for each hour: 1 = forced on, 0 = forced off, - = not forced,
      //  m2.c and m2.c2 (hours of the periods), m1.l, m2.l and m2.m (price limits, a number or avg),
      //  m0.c=1|0 (command of the manual mode - the control mode is not changed, so it has an effect only if the mode is manual)
      //Example: ?r=w&i=0&m2.c=6&en=1
      //If any of the values is not valid, nothing is written and the answer is 400 - see manualRead()
      //Note: there is no URL decoding in the script engine, so values have only characters that are sent as they are
      //(a comma may come as %2C - both are read)
      let v = {};
      let ok = inst >= 0 && inst < instCnt;
      let cnt = 0;

      for (let k in params) {
        let s = params[k];
        let x = Number(s);

        if (k == "r" || k == "i") {
          continue;
        }
        cnt++;

        if (typeof s !== "string") {
          ok = false;

        } else if ((k == "en" || k == "m0.c") && (s === "0" || s === "1")) {
          v[k] = x;

        } else if ((k == "m2.c" || k == "m2.c2") && s !== "" && x >= 0 && x <= 24) {
          v[k] = x;

        } else if ((k == "m1.l" || k == "m2.l" || k == "m2.m") && (s === "avg" || (s !== "" && x > -1000 && x < 1000))) {
          v[k] = s === "avg" ? s : x;

        } else if (k == "o") {
          //Numbers of the outputs, max 4 (an empty value = no outputs)
          let a = s.split(",");
          v.o = [];

          for (let i = 0; i < a.length; i++) {
            //Note: in the Shelly script engine split() returns an empty list, if the text is at least two characters
            //shorter than the separator ("0".split("%2C") -> [], measured on the device) - so short texts are not split
            let b = a[i].length < 3 ? [a[i]] : a[i].split("%2C");

            for (let j = 0; j < b.length; j++) {
              x = Number(b[j]);

              if (b[j] !== "" && x >= 0 && x < 1000 && x == Math.floor(x)) {
                v.o.push(x);
              } else if (b[j] !== "") {
                ok = false;
              }
            }
          }

          if (v.o.length > 4) {
            ok = false;
          }

        } else if (k == "f" && s.length == 24) {
          //Forced hours as bits: f = hour is forced, fc = forced on
          v.f = 0;
          v.fc = 0;

          for (let i = 0; i < 24; i++) {
            x = s.charCodeAt(i);

            if (x == 48 || x == 49) {
              v.f = v.f | (1 << i);
              v.fc = v.fc | ((x - 48) << i);
            } else if (x != 45) {
              ok = false;
            }
          }

        } else {
          ok = false;
        }
      }

      if (ok && cnt > 0) {
        Shelly.call("KVS.Get", { key: getKvsKey(inst) }, manualRead, { i: inst, v: v });
      }

      response.code = ok && cnt > 0 ? 204 : 400;
      GZIP = false;

    } else if (!params.r) {
      response.body = atob('#[index.html]');
      MIME_TYPE = MIME_HTML;

    } else if (params.r === "s.js") {
      response.body = atob('#[s.js]');
      MIME_TYPE = MIME_JS;

    } else if (params.r === "s.css") {
      response.body = atob('#[s.css]');
      MIME_TYPE = MIME_CSS;

    } else if (params.r === "status") {
      response.body = atob('#[tab-status.html]');
      MIME_TYPE = MIME_HTML;

    } else if (params.r === "status.js") {
      response.body = atob('#[tab-status.js]');
      MIME_TYPE = MIME_JS;

    } else if (params.r === "history") {
      response.body = atob('#[tab-history.html]');
      MIME_TYPE = MIME_HTML;

    } else if (params.r === "history.js") {
      response.body = atob('#[tab-history.js]');
      MIME_TYPE = MIME_JS;

    } else if (params.r === "config") {
      response.body = atob('#[tab-config.html]');
      MIME_TYPE = MIME_HTML;

    } else if (params.r === "config.js") {
      response.body = atob('#[tab-config.js]');
      MIME_TYPE = MIME_JS;

    } else if (params.r === "en.js") {
      //v10: translations of the user interface (requested only if the language is not Finnish)
      response.body = atob('#[en.js]');
      MIME_TYPE = MIME_JS;

    } else if (params.r === "en-config.js") {
      //v10: translations of the settings (requested when the settings are opened)
      response.body = atob('#[en-config.js]');
      MIME_TYPE = MIME_JS;

    } else {
      response.code = 404;
    }

    params = null;

    response.headers = [["Content-Type", MIME_TYPE]];

    //NOTE: Uncomment the next line for local development or remote API access (allows cors)
    //response.headers.push(["Access-Control-Allow-Origin", "*"]);

    if (GZIP) {
      response.headers.push(["Content-Encoding", "gzip"]);
    }
  } catch (err) {
    log("server error: " + err);
    response.code = 500;
  }
  response.send();
}

function initialize() {
  //Removing placeholders
  //Instances are created when the common config is read (see setInstCount())
  _.c.i.pop();
  _.si.pop();

  prevEpoch = epoch();

  //v10: address of the Ethernet connection is used if there is one (before: always Wi-Fi, which is wrong for a device connected with a cable)
  //Note: status of "eth" is null if the device doesn't have Ethernet
  //Note: address of a connection that is not in use can be null or "0.0.0.0" (measured: Wi-Fi turned off on Shelly Pro 2)
  //The last one is the default address of the access point mode
  let ip = (Shelly.getComponentStatus("eth") || {}).ip;

  if (!ip || ip == "0.0.0.0") {
    ip = (Shelly.getComponentStatus("wifi") || {}).sta_ip;
  }

  if (!ip || ip == "0.0.0.0") {
    ip = "192.168.33.1";
  }
  log("URL: http://" + ip + "/script/" + Shelly.getCurrentScriptId());

  //v10: new - device-specific delay for the price requests at midnight and at 15:00 (see pricesNeeded)
  //The delay is 3...5 min (180..300 s): away from the full hour, when version 3.x and other clients request prices,
  //and after the short outage of the Elering API seen right after midnight (failures until about 00:02)
  //The last byte of the MAC address (0..255) is multiplied by 173 (mod 256) before scaling to 120 s:
  //devices with consecutive addresses (bought together) get delays far apart from each other
  //Note: calculated here, not in a function of its own - every function takes memory
  //Note: only the address is kept, not the whole device info object (the build inlines this function to the top level,
  //so a local variable here is a global variable on the device and would keep the object in memory - measured 600 B)
  let mac = (Shelly.getDeviceInfo() || {}).mac;

  if (typeof mac === "string" && mac.length >= 2) {
    fetchDelay = 180 + Math.floor((parseInt(mac.substring(mac.length - 2), 16) * 173 % 256) * 120 / 255);
  }
  mac = null;
}

//Startup
log("v." + _.s.v);
initialize();

//Start server and loop
HTTPServer.registerEndpoint('', onServerRequest);
Timer.set(10000, true, loop);
loop();