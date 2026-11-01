/**
 * shelly-porssisahko
 * 
 * (c) Jussi isotalo - http://jisotalo.fi
 * https://github.com/jisotalo/shelly-porssisahko
 * 
 * License: GNU Affero General Public License v3.0 
 *
 * NOTE: This is a modified version (10.0.0) by @mattik-gh, based on version 3.4.0 of the original project.
 * It is not published or supported by the original author.
 */

/** 
 * URL of the shelly (only if DEV active, otherwise it is same origin) 
 * v10: name was URL - it hid the URL class of the browser from every script on the page.
 * Brave on iPhone adds its own script to the page, and it failed with "new URL(...)", so the page did not open.
 */
let SRV = "";

/** 
 * URL of the logic script 
 */
let URLS = ``;

/**
 * Selected instance from dropdown
 */
let inst = 0;

/** 
 * Active tab name
 */
let activeTab = '';

/**
 * Shortcut for document
 */
let doc = document;

/** 
 * Shortcut for querySelector() call 
 */
let qs = (s) => doc.querySelector("#" + s);

/**
 * debug function that is printing to console only when DEV is active
 */
let DBG = () => { };

/* shared-start (functions without side effects - tests load this part as it is) */

/**
 * v10: Returns the text in the language of the user interface
 * Texts are in Finnish in the code and TR has the translations: { "Finnish text": "translation" }
 * If there is no translation, the Finnish text is used
 *
 * Can be used in two ways:
 * - t("Tallenna") or t("Tila", "rivi"), where the second parameter selects the translation,
 *   if the same text needs a different translation in different places (key is "Tila|rivi")
 * - t`Lähtöä ${nr} ei löydy laitteesta` for texts with values (key is "Lähtöä %s ei löydy laitteesta")
 */
let t = (s, ...v) => {
  if (!s.raw) {
    return TR[v[0] ? `${s}|${v[0]}` : s] ?? s;
  }

  return (TR[s.join("%s")] ?? s.join("%s")).split("%s").map((part, i) => part + (i < v.length ? v[i] : "")).join("");
};

/**
 * v10: Translates the texts of an element and its children (static HTML)
 * A text is translated only if the whole text has a translation
 * Attribute data-t of the parent element selects the translation, if needed (see t())
 */
let tr = (root) => {
  if (LANG == "fi") {
    return;
  }

  let walker = doc.createTreeWalker(root, 4);
  let node;

  while (node = walker.nextNode()) {
    let s = node.nodeValue.trim();

    if (s) {
      node.nodeValue = node.nodeValue.replace(s, t(s, node.parentNode.dataset.t));
    }
  }

  root.querySelectorAll("input[type=button]").forEach(e => e.value = t(e.value));
};

/**
 * v10: Returns a duration as text, for example 90 -> "1h 30min" (0 -> "0h")
 *
 * @param {number} min duration [min]
 */
let dur = (min) => `${min >= 60 || !min ? `${Math.floor(min / 60)}h` : ""}${min >= 60 && min % 60 ? " " : ""}${min % 60 ? `${min % 60}min` : ""}`;

/**
 * v10: Returns HTML of the price chart of the status page
 * Bar = price (light part = transfer fee, dark part = energy), strip below the bars = planned control
 *
 * @param {number} max top of the scale [c/kWh]
 * @param {Array} items prices of the day: { t: start time as text, p: price, f: transfer fee, c: planned control, a: current time,
 *   g: period of the cheapest hours [index of the first price, index after the last price, number of the period] }
 * @param {number} unit length of one price [s]
 */
let drawChart = (max, items, unit) => {
  let bars = "";
  let strip = "";
  //Periods: a thin line between the bars and the control strip (every other period is lighter, nothing = no period)
  //Not shown if the whole day is one period. If there is nothing to show, the row is left out (no empty space)
  let per = "";
  let one = items.every(x => x.g && x.g[2] == items[0].g[2]);

  items.forEach((x, i) => {
    //Note: energy is never below zero in the chart (negative price is not a cost for the user)
    let total = Math.max(x.p, x.f, 0);
    let p = x.p.toFixed(2);
    let e = (x.p - x.f).toFixed(2);
    let f = x.f.toFixed(2);

    //Tooltip of the bar in two rows (&#10; = line break)
    bars += `<i class="${x.a ? "a" : ""}" style="height:${(total / max * 100).toFixed(1)}%;--f:${(total > 0 ? Math.max(x.f, 0) / total * 100 : 0).toFixed(1)}%" title="${x.c
      ? t`${x.t} - ohjaus päällä&#10;${p} c/kWh (energia ${e} + siirto ${f})`
      : t`${x.t} - ohjaus pois&#10;${p} c/kWh (energia ${e} + siirto ${f})`}"></i>`;

    per += x.g && !one
      ? `<i class="${x.g[2] % 2 ? "l" : "d"}" title="${t`Jakso ${items[x.g[0]].t} - ${x.g[1] < items.length ? items[x.g[1]].t : "24:00"}`}"></i>`
      : `<i></i>`;

    if (!x.c) {
      strip += `<i class=""></i>`;
      return;
    }

    //Tooltip of the control strip: start and end time and length of the on period that includes this price
    let a = i;
    let b = i;

    while (a > 0 && items[a - 1].c) {
      a--;
    }

    while (b < items.length - 1 && items[b + 1].c) {
      b++;
    }

    strip += `<i class="on${a == i ? " l" : ""}${b == i ? " r" : ""}" title="${t`Ohjaus päällä ${items[a].t} - ${b + 1 < items.length ? items[b + 1].t : "24:00"} (${dur((b - a + 1) * unit / 60)})`}"></i>`;
  });

  return `<div class="g"><div class="gy"><span>${max}</span><span>${max / 2}</span><span>0</span></div><div class="gb">${bars}</div></div>
    ${per.includes("title=") ? `<div class="gp">${per}</div>` : ""}<div class="gs">${strip}</div>
    <div class="gx"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>`;
};

/**
 * v10: new - number fields of the settings accept only the expected characters
 * (here and not in tab-config.js to keep that file small enough - see test/memory.test.js)
 * Helper that removes invalid characters from a number field (input mask)
 * 
 * @param {string} value value of the field
 * @param {boolean} dec true = one decimal separator is allowed (comma or dot)
 * @param {boolean} neg true = negative values are allowed (minus as the first character)
 * @param {boolean} avg true = text "avg" is allowed instead of a number
 * @param {number} digits how many digits are allowed before the decimal separator (after it: max 2)
 */
let maskNum = (value, dec, neg, avg, digits) => {
  if (avg && value != "" && "avg".indexOf(value.toLowerCase()) == 0) {
    return value.toLowerCase();
  }

  let minus = neg && value.trim().indexOf("-") == 0 ? "-" : "";
  let parts = value.replace(/[^\d,.]/g, "").split(/[,.]/);

  if (!dec || parts.length == 1) {
    return minus + parts.join("").slice(0, digits);
  }

  //Keeping the first separator as it was written
  //Max 2 decimals (prices are saved and shown with that accuracy, and settings have a maximum length - see save())
  return `${minus}${parts[0].slice(0, digits)}${value.match(/[,.]/)[0]}${parts.slice(1).join("").slice(0, 2)}`;
}

/**
 * Helper to convert value to number (decimal comma is accepted)
 * v10: helpers n(), limit() and canon() moved here from tab-config.js (general helpers, and that file has a size limit)
 */
let n = (v) => typeof v === "string" ? Number(v.replace(",", ".")) : Number(v);

/**
 * Helper to limit value between min...max
 */
let limit = (min, value, max) => Math.min(max, Math.max(min, value));

/**
 * v10: new - transfer fee [c/kWh] at the given time (Date) by the common settings c - the same rule as calcPrices() in the Shelly script:
 * day fee during the day hours (c.ds...c.de), with seasonal transfer (c.tt) only in the season (c.ss...c.se, also over the turn of the year)
 * on Monday...Saturday. Other times the night fee
 */
let feeAt = (c, d) => {
  let m = (d.getMonth() + 1) * 100 + d.getDate();
  let h = d.getHours();
  return (!c.tt || ((c.ss <= c.se ? m >= c.ss && m <= c.se : m >= c.ss || m <= c.se) && d.getDay())) && h >= c.ds && h < c.de ? c.day : c.night;
};

/**
 * v10: Helper that returns an object as text for comparing (keys in the same order)
 */
let canon = (o) => JSON.stringify(o, (k, v) => v && typeof v == "object" && !Array.isArray(v)
  ? Object.keys(v).sort().reduce((r, key) => { r[key] = v[key]; return r; }, {})
  : v);

/**
 * v10: new - message below the Save button of the settings page (before: alert dialogs)
 * OK message disappears after 3 seconds, an error stays until the next message
 *
 * @param {string} text message
 * @param {*} err true = error
 */
let msgTimer;
let msg = (text, err) => {
  let e = doc.querySelector("#msg");
  e.textContent = text;
  e.style.color = err ? "#c0392b" : "#16a085";
  clearTimeout(msgTimer);
  msgTimer = err ? 0 : setTimeout(() => e.textContent = "", 3000);
};

/* shared-end */

/**
 * Enumeration of state
 */
let STATE_STR = [
  t("Käynnistetään"), //0
  t("Käsiohjaus", "tila"), //1
  t("Hinta alle rajan"), //2
  t("Hinta yli rajan"), //3
  t("Hinta ei halvimpia tällä ajanjaksolla"), //4
  t("Hinta halvimpia tällä ajanjaksolla"), //5
  t("Hinta alle aina päällä -rajan"), //6
  t("Varmuustuntiohjaus (ei hintoja, aika tiedossa)"), //7
  t("Hätätilaohjaus (aika ei tiedossa)"), //8
  t("Pakko-ohjaus (%s asti)"), //9
  t("Pakko-ohjattu tunti"), //10
  t("Hinta yli maksimirajan"), //11
  t("Käyttäjän skriptiohjaus ylikirjoittaa"), //12
  t("Tunnin ohjausminuutit käytetty") //13
]

/**
 * Enumeration of mode
 */
let MODE_STR = [
  t("Käsiohjaus"),
  t("Hintaraja"),
  t("Jakson halvimmat tunnit")
]

/**
 * Global state
 * 
 * undefined = not yet read
 * null = error
 */
let state = undefined;

/** 
 * Callbacks to call when state is updated 
 */
let CBS = [];

/**
 * Helper that is used for DBG calls to add caller information
 */
let me = () => "";

/** 
 * Timer handle 
 */
let loopTimer = null;

/**
 * fetch() aborter for updateLoop()
 */
let aborter = new AbortController();

/**
 * Opens tab with given name
 * @param {*} tab 
 * @returns 
 */
let openTab = async (tab) => {
  if (tab === undefined || tab === "") {
    tab = "tab-status";
  }

  window.location.hash = `${tab}/${inst + 1}`;
  activeTab = tab;

  let e = qs("" + tab);
  if (e) {
    e.checked = true;
  }

  if (qs(`c-${tab}`).innerHTML === "") {
    try {
      if (LANG == "en" && tab == "tab-config") {
        //v10: translations of the settings are in their own file - loaded before the page, one file at a time
        //(if loading fails, the settings are in Finnish)
        await new Promise(resolve => {
          let e = reqJs("en-config.js");
          e.onload = e.onerror = resolve;
        });
      }
      await populateDynamicData(`${tab}.html`, `c-${tab}`);

    } catch (err) {
      DBG(me(), "error", err);
      console.error(err);
      if (confirm(t`Sivun avaus epäonnistui - kokeile uudelleen? (${err.message})`)) {
        openTab(tab);
      }
    }
  }

  updateLoop(true);
};

/**
 * When page opens, select tab by URL hash
 */
window.onload = async () => {
  //v10: translating the static texts of the page
  tr(doc.body);

  let hash = window.location.hash.split("/");
  inst = (parseInt(hash[1]) || 1) - 1;
  openTab(hash[0].slice(1));

  if (DEV) {
    reqJs("dev.js");
  }
};

/**
 * Tab changing
 */
doc.querySelectorAll(".ts").forEach(e => e.addEventListener("change", (e) => {
  openTab(e.target.id);
}));

/**
 * eval() <script> tag contents
 * @param {*} elementId 
 */
let evalContainerScriptTags = (elementId) => {
  DBG(me(), "eval running for", elementId);

  var scripts = qs(elementId).querySelectorAll("script");
  for (var i = 0; i < scripts.length; i++) {
    if (scripts[i].innerText) {
      /*DBG(scripts[i].innerText);*/
      eval(scripts[i].innerText);
    } else {
      fetch(scripts[i].src).then(function (data) {
        data.text().then(function (r) {
          eval(r);
        })
      });
    }
    scripts[i].parentNode.removeChild(scripts[i]);
  }
}

/**
* Loads dynamic data from URL to the container in DOM
 * @param {*} url 
 * @param {*} containerId 
 */
let populateDynamicData = async (url, containerId) => {
  if (!DEV) {
    url = `${URLS}?r=${url.replace("tab-", "").replace(".html", "")}`
  }
  DBG(me(), "fetching", url, "for", containerId);

  let res = await getData(url, false);

  if (res.ok) {
    qs(containerId).innerHTML = res.data;
    evalContainerScriptTags(containerId);
    //v10: translating the static texts (before the tab fills in its data)
    tr(qs(containerId));

  } else {
    throw new Error(res.txt);
  }

  DBG(me(), "done for", containerId);
}

/**
 * Fetches data as json or plain text
 * @param {*} url 
 * @param {*} isJson 
 * @returns 
 */
let getData = async (url, isJson = true, signal = null) => {
  try {

    let res = await fetch(url, { signal });

    if (res.ok) {
      let data = null;

      if (res.status !== 204) {
        if (isJson) {
          data = await res.json();
        } else {
          data = await res.text();
        }
      }
      DBG(me(), `Fetching ${url} done. Status code: ${res.status}`);

      return {
        ok: true,
        code: res.status,
        txt: res.statusText,
        data
      };

    } else {
      console.error(`${url}: ${res.statusText}`);

      return {
        ok: false,
        code: res.status,
        txt: `${url}: ${res.statusText} (${(await res.text())})`,
        data: null
      };

    }
  } catch (err) {
    console.error(url, err);

    return {
      ok: false,
      code: -1,
      txt: JSON.stringify(err, Object.getOwnPropertyNames(err)) + " :" + url,
      data: null
    };
  }
}

/**
 * Formats Date to string as dd.mm.yyyy
 * @param {*} date 
 * @returns 
 */
let formatDate = (date) => {
  return `${(date.getDate().toString().padStart(2, "0"))}.${(date.getMonth() + 1).toString().padStart(2, "0")}.${date.getFullYear()}`;
}

/**
 * Formats Date to time string as hh:mm[:ss]
 * @param {*} date 
 * @param {*} showSeconds true = add seconds
 * @returns 
 */
let formatTime = (date, showSeconds = true) => {
  return `${(date.getHours().toString().padStart(2, "0"))}:${date.getMinutes().toString().padStart(2, "0")}${(showSeconds ? `:${date.getSeconds().toString().padStart(2, "0")}` : "")}`;
}

/**
 * Formats Date to datetime string
 * @param {*} date 
 * @param {*} showSeconds true = add seconds
 * @returns 
 */
let formatDateTime = (date, showSeconds = true) => {
  return `${formatDate(date)} ${formatTime(date, showSeconds)}`;
}

/**
 * Called by setTimeout every 5 seconds
 * 
 * Can be also called manually when instance has been changed (instChanged)
 * 
 * @param {*} instChanged true if instance has been changed 
 */
let updateLoop = async () => {
  const instance = inst;
  clearTimeout(loopTimer);
  DBG(me(), "Updating");
  qs("spin").style.visibility = "visible";

  try {
    //Clear previous requests
    aborter.abort();

    aborter = new AbortController();
    let res = await getData(`${URLS}?r=s&i=${inst}`, true, aborter.signal);

    if (inst !== instance) {
      //Instance has been changed, do nothing
      return;
    }
    //v10: new - instance count is a setting, so the selected instance may not exist anymore
    if (res.ok && !res.data.si) {
      //Selected instance is not in use (or the script is just starting)
      if (inst > 0) {
        //Instance count has been changed -> selecting the first instance
        inst = 0;
        state = undefined;
        CBS.forEach(cb => cb(true));
        openTab(activeTab);
        return;
      }

    } else if (res.ok) {
      state = res.data;

      //v10: status format changed - raw price of each slot [0.01 EUR/MWh] (before: rows [epoch, price] with VAT and fees)
      //Prices are calculated in tab-status.js (calcPrices), start time and slot length are in state.s.p[x].st and .sl
      //Prices are sent as packed binary strings (base64) with 3 bytes for each price -> unpacking to arrays
      state.p = state.p.map(str => {
        let raw = atob(str);
        let res = [];

        for (let i = 0; i < raw.length; i += 3) {
          res.push((raw.charCodeAt(i) << 16 | raw.charCodeAt(i + 1) << 8 | raw.charCodeAt(i + 2)) - 8388608);
        }
        return res;
      });

      //Updating title
      doc.title = (state.s.dn ? state.s.dn + " - " : "") + "Pörssisähkö";

      //Updating instances to dropdown (only the ones that are in use)
      //v10: only instances that are in use (setting cnt)
      qs("inst").innerHTML = state.c.names.slice(0, state.c.cnt).map((n, i) => `<option value="${i}">${t`Ohjaus #${i + 1}`}: ${n}</option>`)
      qs("inst").value = inst;

      //If status 503 the shelly is just now busy running the logic -> do nothing
    } else if (res.code !== 503) {
      //A real error
      state = null;
    }

    CBS.forEach(cb => cb());

  } catch (err) {
    console.error(err);
    state = null;

  } finally {
    qs("spin").style.visibility = "hidden";
    //Prevent multiple timers
    if (inst === instance) {
      clearTimeout(loopTimer);
      loopTimer = setTimeout(updateLoop, 5000);
    }
  }
}

/**
 * Adding event handler to instance dropdown
 */
qs("inst").addEventListener("change", (e) => {
  //Instance has changed by user
  inst = parseInt(e.target.value);

  //Reset state as it's no longer valid
  state = undefined;

  //Running callbacks so that pages know instance has changed (no new data yet)
  CBS.forEach(cb => cb(true));

  //Run loop immediately
  updateLoop();

  openTab(activeTab);
});