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
{
  /** 
   * Flag indicating if config is already read
   * If not, inputs are updated
   */
  let configRead = false;

  /**
   * v10: settings that were just saved (as text) and the state they were saved from
   * After a save, the device still returns the old settings for a few seconds (measured: 2-3 s, more if the logic is running)
   * The form is not filled from the device until its state has the saved settings - see onUpdate()
   * (before: the form could be filled with the old values, and saving again would have written them back)
   */
  let saved = null;
  let savedState = null;
  let savedTs = 0;

  /**
   * v10: new - a manual force (override) was just sent and the page waits for the device to show it
   * forceSent = time of the click (0 = not waiting), forceTs = end time of the manual force before the click
   * See checkForce() and force()
   */
  let forceSent = 0;
  let forceTs = 0;
  let forceTimer;

  //v10: general helpers n(), limit() and canon() are in s.js (this file has a size limit - see test/memory.test.js)

  /**
   * v10: new - settings as text for KVS: a list of the values without the names of the settings, texts with ' instead of "
   * For example [1,'fi',25.5,0,0,['Boiler','-','-'],1,24] - the first value is the version of the format
   * Why: Shelly allows 253 bytes for a value and counts every " as two - see pack() in the Shelly script
   * Note: values are saved in the order of the keys. The script always sends the settings with the keys in the right order.
   */
  let kvs = (o) => JSON.stringify([1].concat(kvsList(o))).replace(/["']/g, m => m == '"' ? "'" : '"');
  let kvsList = (o) => Object.values(o).map(v => v && typeof v == "object" && !Array.isArray(v) ? kvsList(v) : v);

  /**
   * Helper to show/hide custom period inputs
   * 
   * @param {*} value 
   */
  let checkCustomPeriodDisplay = (value) => {
    doc.querySelectorAll(".m2-c").forEach(e => e.style.display = n(value) < 0 ? "table-row" : "none");
    doc.querySelectorAll(".m2-c2").forEach(e => e.style.display = n(value) < -1 ? "table-row" : "none");
  }

  /**
   * Helper to set radio button value
   * 
   * @param {*} name 
   * @param {*} value 
   */
  let setRadio = (name, value) => {
    doc.querySelectorAll(`[name=${name}]`).forEach(e => e.checked = e.value == value);
  }

  /**
   * Helper to create a radio button row
   * @param {*} name 
   * @param {*} value 
   * @returns 
   */
  let radioRow = (name, value) => `<td><input type="radio" name="${name}" value="${value}"></td>`;

  /**
   * Helper that converts the value to number unless is "avg"
   * @param {*} e 
   * @returns 
   */
  let avgn = (e) => qs(e).value == "avg" ? "avg" : n(qs(e).value);

  /**
   * v10: new - price resolution (ci.q)
   * Helper that returns how many prices in an hour by the price resolution (1, 2 or 4)
   * Hour counts can be given with this accuracy (hour / 0.5 h / 0.25 h)
   * 
   * @param {*} value price resolution (0 = hour, 1 = 15 min, 2 = 30 min)
   */
  let perHour = (value) => n(value) ? (n(value) == 2 ? 2 : 4) : 1;

  /**
   * Helper that adds input mask to fields
   * 
   * @param {string[]} ids ids of the fields
   * @param {boolean} dec see maskNum()
   * @param {boolean} neg see maskNum()
   * @param {boolean} avg see maskNum()
   * @param {number} digits see maskNum()
   */
  let addMask = (ids, dec, neg, avg, digits) => {
    ids.forEach(id => qs(id).addEventListener("input", (e) => e.target.value = maskNum(e.target.value, dec, neg, avg, digits)));
  }

  /**
   * v10: new - helper that shows the times of the day and night fees by the selected transfer product
   * Days and hours are not edited on this page (see ss, se, ds and de in the Shelly script)
   */
  let checkFees = () => {
    let c = state.c;
    let h = (v) => ("" + v).padStart(2, "0");
    let md = (v) => `${v % 100}.${Math.floor(v / 100)}.`;
    let tt = n(qs("tt").value);
    qs("tt-d").innerHTML = "(" + (tt ? `${md(c.ss)} - ${md(c.se)} ${t("ma-la")} ` : t("joka päivä") + " ") + `${h(c.ds)}-${h(c.de)})`;
    qs("tt-n").innerHTML = "(" + (tt ? t("muu aika") : t("joka päivä") + ` ${h(c.de)}-${h(c.ds)}`) + ")";
  }

  /**
   * v10: Helper that shows only the settings of the selected control mode
   * (before: settings of all modes were visible, but only the ones of the selected mode had any effect)
   * Hidden values are kept and saved as before
   *
   * @param {*} value selected mode (0..2)
   */
  let checkMode = (value) => {
    for (let i = 0; i < 3; i++) {
      qs("mo" + i).style.display = n(value) == i ? "block" : "none";
    }
  }

  /**
   * Helper that rounds the hour count to the accuracy of the price resolution
   * 
   * @param {*} value 
   */
  let roundCnt = (value) => {
    let mult = perHour(qs("q").value);
    return Math.round((n(value) || 0) * mult) / mult;
  }

  /**
   * Helper to show/hide settings by the price resolution
   * "Minutes of the hour" is used only with hourly prices
   * Also updates the hints (what can be entered as hour count)
   * 
   * @param {*} value 
   */
  let checkResolution = (value) => {
    //v10: texts and the row of control minutes are selected by the page style (tab-config.html) - this file has a size limit
    qs("cfg").dataset.r = perHour(value);
  }


  /**
   * v10: new
   * Helper that updates the hint of the outputs field
   * Shows a warning if outputs are not set in the active config (and the field is still empty)
   */
  let checkOuts = () => {
    let warn = !(state.ci.o && state.ci.o.length) && qs("outs").value.trim() == "";

    qs("outs").style.border = warn ? "2px solid red" : "";
    //v10: only the warning is shown next to the field (the hint is behind the name of the row, see .ph in s.css)
    qs("outs-h").innerHTML = warn ? t("Lähtöä ei ole määritetty. Anna lähdön numero (yleensä 0) ja tallenna.") : "";
  }

  /**
   * Callback called by main loop
   * 
   * @param {*} instChanged true = instance has changed (reset data)
   * @returns 
   */
  let onUpdate = async (instChanged) => {
    try {
      if (instChanged || !state) {
        configRead = false;
        saved = null;
        qs("cfg-l").innerHTML = t("Ladataan...");
        qs("cfg").style.display = 'none';
        return;
      }

      //v10: state of the output and of the manual force (updated every time)
      checkForce();

      if (saved) {
        //v10: settings were just saved - waiting until the device has them (or 15 s, if the device has changed some value)
        //After 15 s the form is filled with the settings of the device in any case, so it shows what the device really has
        if (state === savedState || (canon(state.ci) + canon(state.c) != saved && Date.now() - savedTs < 15000)) {
          return;
        }
        saved = null;
        configRead = false;
      }

      if (configRead) {
        return;
      }

      /** common config */
      let c = state.c;
      /** instance config */
      let ci = state.ci;

      qs("cfg-l").innerHTML = '';
      qs("cfg").style.display = 'block';

      qs("g").value = c.g;
      qs("cnt").value = c.cnt;
      qs("hist").value = c.hist;
      qs("vat").value = c.vat;
      qs("day").value = c.day;
      qs("night").value = c.night;
      qs("tt").value = c.tt;
      checkFees();

      qs("ci").innerHTML = (inst + 1);

      qs("en").checked = ci.en ? "checked" : "";
      qs("n").value = c.names[inst];
      qs("mode").innerHTML = MODE_STR.map((m, i) => `<option value="${i}">${m}</option>`)
      qs("mode").value = ci.mode;
      checkMode(ci.mode);
      qs("outs").value = ci.o.join(",");
      checkOuts();
      qs("inv").checked = ci.i ? "checked" : "";

      //building backup hours
      let bk = "";
      for (let i = 0; i < 24; i++) {
        bk += `<label><input type="checkbox" id="b${i}">${("" + i).padStart(2, "0")}</label> `
      }
      qs("bk").innerHTML = bk;

      //building forced hours
      let fh = `<tr><td>${t("Tunti")}</td><td>OFF</td><td>-</td><td>ON</td></tr>`;
      for (let i = 0; i < 24; i++) {
        fh += `<tr><td>${("" + i).padStart(2, "0")}</td>${radioRow(`f${i}`, 0)}${radioRow(`f${i}`, -1)}${radioRow(`f${i}`, 1)}</tr>`;
      }
      qs("fh").innerHTML = fh;

      //set values of backup and forced hours
      for (let i = 0; i < 24; i++) {
        qs(`b${i}`).checked = (ci.b & (1 << i)) == (1 << i);
        setRadio(`f${i}`, (ci.f & (1 << i)) == (1 << i) ? (ci.fc & (1 << i)) == (1 << i) ? 1 : 0 : -1);
      }

      qs("min").value = ci.m;
      qs("q").value = ci.q ? (ci.q == 2 ? 2 : 1) : 0;
      checkResolution(ci.q);
      qs("oc").value = ci.oc;
      qs("err").checked = ci.e ? "checked" : "";
      qs("m0-cmd").checked = ci.m0.c ? "checked" : "";
      qs("m1-lim").value = ci.m1.l;
      qs("m2-per").value = ci.m2.p;
      qs("m2-cnt").value = ci.m2.c;
      qs("m2-sq").checked = ci.m2.s ? "checked" : "";
      qs("m2-sq2").checked = ci.m2.s2 ? "checked" : "";
      qs("m2-m").value = ci.m2.m;
      qs("m2-lim").value = ci.m2.l;
      qs("m2-ps").value = `${ci.m2.ps}`.padStart(2, "0");
      qs("m2-pe").value = `${ci.m2.pe}`.padStart(2, "0");
      qs("m2-ps2").value = `${ci.m2.ps2}`.padStart(2, "0");
      qs("m2-pe2").value = `${ci.m2.pe2}`.padStart(2, "0");
      qs("m2-cnt2").value = ci.m2.c2;
      checkCustomPeriodDisplay(ci.m2.p);

      configRead = true;

    } catch (err) {
      console.error(err);
      qs("cfg-l").innerHTML = err;
    }
  };

  /**
   * Save settings butto click
   */
  let save = async () => {
    try {
      /** common config */
      let c = state.c;
      /** instance config */
      let ci = state.ci;
      c.g = qs("g").value;
      c.cnt = n(qs("cnt").value);
      c.hist = n(qs("hist").value);
      c.vat = n(qs("vat").value);
      c.day = n(qs("day").value);
      c.night = n(qs("night").value);
      c.tt = n(qs("tt").value);

      ci.en = qs("en").checked ? 1 : 0;
      c.names[inst] = qs("n").value;
      ci.mode = n(qs("mode").value);

      //v10: new validation
      //Outputs: only numbers separated by comma are allowed
      //Spaces and commas at the beginning and at the end are removed. Empty -> default output 0
      let outs = qs("outs").value.replace(/\s*,\s*/g, ",").trim().replace(/^,+|,+$/g, "");

      if (outs == "") {
        outs = "0";
      }

      if (!/^\d+(,\d+)*$/.test(outs)) {
        throw new Error(t("Ohjattavat lähdöt: anna lähtöjen numerot pilkulla erotettuna (esim. 0 tai 0,1)"));
      }

      //Removing duplicates
      ci.o = outs.split(",").map(v => n(v)).filter((v, i, a) => a.indexOf(v) == i);

      if (ci.o.length > 4) {
        throw new Error(t("Ohjattavat lähdöt: enintään 4 lähtöä"));
      }

      qs("outs").value = ci.o.join(",");
      ci.i = qs("inv").checked ? 1 : 0;

      ci.b = 0;
      ci.f = 0;
      ci.fc = 0;
      for (let i = 0; i < 24; i++) {
        if (qs(`b${i}`).checked) {
          ci.b = ci.b | (1 << i);
        }

        let val = doc.querySelector(`[name=f${i}]:checked`).value;

        if (val != -1) {
          ci.f = ci.f | (1 << i);
          ci.fc = ci.fc | (val << i);
        }
      }
      ci.e = qs("err").checked ? 1 : 0;
      ci.m = n(qs("min").value);
      ci.m = limit(0, ci.m, 60);
      ci.oc = n(qs("oc").value);
      ci.q = n(qs("q").value) ? (n(qs("q").value) == 2 ? 2 : 1) : 0;

      ci.m0.c = qs("m0-cmd").checked ? 1 : 0;
      ci.m1.l = avgn("m1-lim");
      ci.m2.p = n(qs("m2-per").value);
      ci.m2.c = roundCnt(qs("m2-cnt").value);
      ci.m2.s = qs("m2-sq").checked ? 1 : 0;
      //v10: custom period 2 has its own setting
      ci.m2.s2 = qs("m2-sq2").checked ? 1 : 0;
      ci.m2.m = avgn("m2-m");
      ci.m2.l = avgn("m2-lim");
      ci.m2.ps = limit(0, n(qs("m2-ps").value), 23);
      ci.m2.pe = limit(ci.m2.ps, n(qs("m2-pe").value), 24);
      ci.m2.ps2 = limit(0, n(qs("m2-ps2").value), 23);
      ci.m2.pe2 = limit(ci.m2.ps2, n(qs("m2-pe2").value), 24);
      ci.m2.c2 = roundCnt(qs("m2-cnt2").value);

      //Checking count limits
      ci.m2.c = limit(0, ci.m2.c, ci.m2.p > 0 ? ci.m2.p : ci.m2.pe - ci.m2.ps);
      ci.m2.c2 = limit(0, ci.m2.c2, ci.m2.pe2 - ci.m2.ps2);

      //v10: new - hour counts can have decimals with 15 and 30 min resolution
      //Showing the values that are saved (rounded and limited)
      qs("m2-cnt").value = ci.m2.c;
      qs("m2-cnt2").value = ci.m2.c2;

      DBG(me(), "Settings to save:", c, ci);

      //v10: new - Shelly saves max 253 bytes for one value. Checking before anything is written,
      //so settings can't be saved only partly. Only the common settings can be too long (long names):
      //settings of an instance are max 126 bytes as a list - see kvs() and test/known-issues.test.js
      //The length is counted like Shelly does: bytes, and the characters " and \ as two
      if (encodeURIComponent(kvs(c)).replace(/%(22|5C)/g, "xx").replace(/%[0-9A-F]{2}/g, "x").length > 253) {
        throw new Error(t("Asetukset eivät mahdu laitteen muistiin. Lyhennä nimeä tai lähtöjen listaa."));
      }

      //Saving settings (both common and instance)
      let res = await getData(`${SRV}/rpc/KVS.Set?key="porssisahko-${(inst + 1)}"&value="${encodeURIComponent(kvs(ci))}"`);     
      let res2 = await getData(`${SRV}/rpc/KVS.Set?key="porssisahko"&value="${encodeURIComponent(kvs(c))}"`);

      if (res.code != 200 || res2.code != 200) {
        throw new Error(res.txt + " | " + res2.txt);
      }

      await getData(`${URLS}?r=r&i=${inst}`);

      //v10: the form is filled from the device when it has the new settings (see saved)
      saved = canon(ci) + canon(c);
      savedState = state;
      savedTs = Date.now();

      msg(t("Tallennettu"));
      checkOuts();

      if (inst >= c.cnt) {
        //v10: new - instance count is a setting
        //Selected instance is no longer in use -> selecting the first one
        inst = 0;
        state = undefined;
        CBS.forEach(cb => cb(true));
        openTab(activeTab);
      }

    } catch (err) {
      console.error(err)
      msg(t`Virhe: ${err.message || err}`, 1);
    }
  };

  /**
   * v10: Shows the state of the output and of the manual force (override)
   * Note: with inverted control the output is the opposite of the command - the user is shown the output
   */
  let checkForce = () => {
    let si = state.si;
    let active = si.fCmdTs > state.t;

    //v10: new - after a click, a spinner is shown until the device has the new manual force (max 10 s)
    //(before: the row showed the old state for a few seconds and nothing told that the click was received)
    //While waiting, the state is read once a second instead of every 5 seconds
    let wait = forceSent && si.fCmdTs == forceTs && Date.now() - forceSent < 10000;
    forceSent = wait ? forceSent : 0;
    clearTimeout(forceTimer);

    if (wait) {
      forceTimer = setTimeout(updateLoop, 1000);
    }

    ["fo-1", "fo-0", "fo-c"].forEach(id => qs(id).disabled = wait);

    //State of the output with the same colors as on the status page
    let out = (on) => `<b style="color:${on ? "green" : "red"}">${on ? t("PÄÄLLÄ") : t("POIS")}</b>`;

    //State of the output by the active manual force (with inverted control the opposite of the command)
    let forced = (si.fCmd == 1) != (state.ci.i == 1);

    qs("fo-c").style.display = active ? "" : "none";
    //While a manual force is active, only the same direction can be given again (= new duration)
    //The opposite button is hidden: it could be read as "turn the manual force off" - that is done with the cancel button
    qs("fo-1").style.display = active && !forced ? "none" : "";
    qs("fo-0").style.display = active && forced ? "none" : "";
    qs("fo-s").innerHTML = wait
      ? `<span class="spn"></span>`
      : !state.ci.en
      ? t("Ei käytössä")
      : `${out(active ? forced : si.cmd)} – ${active ? t`pakko-ohjaus ${formatDateTime(new Date(si.fCmdTs * 1000), false)} asti` : t("ei pakko-ohjausta")}`;
  }

  /**
   * Manual force (override): keeps the output on or off for the given time regardless of the price
   * v10: buttons on the page (before: two prompts - hours and 1/0 - without showing the state of the output)
   * v10: duration is sent as minutes and the device calculates the end time (before: end time by the clock of the browser)
   *
   * @param {number} on 1 = output on, 0 = output off, -1 = cancel the active one
   */
  let force = async (on) => {
    let hours = n(qs("fo-h").value);

    if (on >= 0 && !(hours > 0)) {
      //Duration is needed
      qs("fo-h").focus();
      return;
    }

    //Showing right away that the click was received
    forceSent = Date.now();
    forceTs = state.si.fCmdTs;
    checkForce();

    //Command of the control (inverted control: output on = command off)
    //The device answers 503 while it is running the logic -> trying again for a few seconds
    let res;

    for (let i = 0; i < 8; i++) {
      res = await getData(`${URLS}?r=f&i=${inst}&mi=${on >= 0 ? hours * 60 : 0}&c=${on >= 0 && (on == 1) != (state.ci.i == 1) ? 1 : 0}`);

      if (res.code != 503) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    if (res.code != 204) {
      forceSent = 0;
      msg(t`Virhe: ${res.txt}`, 1);
    }

    //New state is shown right away
    updateLoop();
  }

  onUpdate();
  CBS.push(onUpdate);

  qs("save").addEventListener("click", save);
  qs("fo-1").addEventListener("click", () => force(1));
  qs("fo-0").addEventListener("click", () => force(0));
  qs("fo-c").addEventListener("click", () => force(-1));
  qs("m2-per").addEventListener("change", (e) => checkCustomPeriodDisplay(e.target.value));
  qs("q").addEventListener("change", (e) => checkResolution(e.target.value));
  qs("mode").addEventListener("change", (e) => checkMode(e.target.value));
  qs("tt").addEventListener("change", checkFees);
  //Input masks: only expected characters can be entered
  //v10: also the number of digits is limited (before the decimal separator - after it max 2)
  //Hour counts: max 2 digits (and decimal separator if price resolution is 15 or 30 minutes)
  ["m2-cnt", "m2-cnt2"].forEach(id => qs(id).addEventListener("input", (e) => e.target.value = maskNum(e.target.value, perHour(qs("q").value) > 1, false, false, 2)));
  //VAT: decimal number, max 99.99
  addMask(["vat"], true, false, false, 2);
  //Transfer fees: decimal numbers, max 999.99
  addMask(["day", "night"], true, false, false, 3);
  //Price limits: decimal numbers (can be negative), max 999.99, or "avg"
  addMask(["m1-lim", "m2-lim", "m2-m"], true, true, true, 3);
  //Minutes and hours of custom periods: integers, max 2 digits
  addMask(["min", "m2-ps", "m2-pe", "m2-ps2", "m2-pe2"], false, false, false, 2);
  //Duration of the manual force: decimal number, max 99.99 hours
  addMask(["fo-h"], true, false, false, 2);
  //Outputs: allowing only numbers and commas
  qs("outs").addEventListener("input", (e) => {
    e.target.value = e.target.value.replace(/[^\d,]/g, "");
    checkOuts();
  });
}
