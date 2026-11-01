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
   * Table content if data not yet available
   */
  let notYetKnown = `<tr><td colspan="3">${t("Ei vielä tiedossa")}</td></tr>`;

  /**
   * Clears status page
   * Used when instance is changed or during error
   */
  /**
   * Selected day of the price chart and tables (0 = today, 1 = tomorrow)
   * v10: new - only one day is shown at a time, so the chart and the tables can use the full width
   */
  let day = 0;

  const clear = () => {
    let c = (e) => qs(e).innerHTML = "";
    c("s-cmd");
    qs("s-cmd").style.color = "#000";
    c("s-dn");
    c("s-now");
    c("s-mode");
    c("s-pa");
    c("s-pb");
    c("s-pi");
    c("s-g");
    c("s-gt");
    c("s-info");
    c("s-st");
  }

  /**
   * Callback called by main loop
   *
   * @param {*} instChanged true = instance has changed (reset data)
   * @returns
   */
  const onUpdate = async (instChanged) => {
    try {
      if (instChanged || state === undefined) {
        clear();
        qs("s-cmd").innerHTML = "Ladataan...";
        return;
      }

      if (!state) {
        throw new Error("no data");
      }

      /** data (state) */
      let d = state;
      /** status */
      let s = d.s;
      /** common config */
      let c = d.c;
      /** instance status*/
      let si = d.si;
      /** instance config */
      let ci = d.ci;

      //If instance is enabled (otherwise just update price lists)
      if (ci.en) {
        qs("s-cmd").innerHTML = si.cmd ? t("PÄÄLLÄ") : t("POIS");
        qs("s-cmd").style.color = si.cmd ? "green" : "red";

        qs("s-mode").innerHTML = MODE_STR[ci.mode];

        qs("s-now").innerHTML = d.p[0].length > 0
          ? `${s.p[0].now.toFixed(2)} c/kWh`
          : "";

        if (ci.q && d.p[0].length > 0) {
          //v10: new
          //Price of the current 15 or 30 minutes is used instead of the hourly price
          //Note: using time of the device (d.t), not the clock of the browser
          let unit = Math.max(s.p[0].sl, ci.q == 2 ? 1800 : 900);
          let cnt = unit / s.p[0].sl;
          let slot = Math.floor((d.t - s.p[0].st) / unit) * cnt;

          if (unit < 3600 && slot >= 0 && slot < d.p[0].length) {
            let fee = feeAt(c, new Date(d.t * 1000));
            let last = Math.min(slot + cnt, d.p[0].length);
            let sum = 0;

            for (let j = slot; j < last; j++) {
              let price = d.p[0][j] / 100;
              sum += price / 10.0 * (100 + (price > 0 ? c.vat : 0)) / 100.0 + fee;
            }

            qs("s-now").innerHTML = `${(sum / (last - slot)).toFixed(2)} c/kWh (${unit / 60} min)`;
          }
        }

        qs("s-st").innerHTML = si.st === 9
          ? STATE_STR[si.st].replace("%s", formatDateTime(new Date(si.fCmdTs * 1000), false))
          : STATE_STR[si.st] + (ci.i ? " " + t("(käänteinen)") : "");

        //Extended status for instance (by user scripts)
        if (si.str != "") {
          qs("s-st").innerHTML += `<br><br>${si.str}`;
        }

        //v10: new - see setRelay() and si.oe in the Shelly script
        //Warning if an output doesn't exist in the device
        if (si.oe >= 0) {
          qs("s-cmd").innerHTML += " – " + t`lähtöä ${si.oe} ei löydy laitteesta`;
          qs("s-cmd").style.color = "orange";
          qs("s-st").innerHTML += "<br><br>" + t`Lähtöä ${si.oe} ei ole tässä laitteessa. Tarkista ohjattavat lähdöt asetuksista.`;
        }

        //Warning if there are no outputs to control
        if (!(ci.o && ci.o.length)) {
          qs("s-cmd").innerHTML += " – " + t("lähtöä ei ole määritetty");
          qs("s-cmd").style.color = "orange";
          qs("s-st").innerHTML += "<br><br>" + t("Ohjaus ei kytke mitään lähtöä. Määritä lähtö asetuksissa.");
        }

        qs("s-info").innerHTML = si.chkTs > 0
          ? t`Ohjaus tarkistettu ${formatTime(new Date(si.chkTs * 1000))}`
          : t("Tarkistetaan ohjausta...");

      } else {
        //Instance is not enabled, clear almost everything
        clear();
        qs("s-info").innerHTML = t("Ei käytössä");
        qs("s-cmd").innerHTML = t`Ohjaus #${inst + 1} ei ole käytössä`;
        qs("s-cmd").style.color = "000";
      }

      //Device name and instance
      //v10: "Shelly" when the device has no name (before: "Ei asetettu" in italics)
      let dn = s.dn || "Shelly";
      if (c.names[inst]) {
        dn += ` | ${c.names[inst]}`
      }
      dn += ` (${t`ohjaus #${inst + 1}`})`;
      qs("s-dn").innerHTML = dn;

      //Price info
      qs("s-info").innerHTML += ` - ${s.p[0].ts > 0
        ? t`Hinnat päivitetty ${formatTime(new Date(Math.max(s.p[0].ts, s.p[1].ts) * 1000))}`
        : t("Hintoja haetaan...")}`;
      
      //Version info (footer)
      //v10: uptime by the clock of the device, memory usage of the script (in use = at rest) and version from the device
      //<span> = end of the row that is kept together: on a narrow page the row wraps before it
      let link = (url, txt) => `<a href="${url}" target="_blank" style="color:inherit">${txt}</a>`;
      let kb = (bytes) => (bytes / 1000).toFixed(1);
      let m = state.m;

      qs("s-v").innerHTML = t`Käynnistetty ${formatDateTime(new Date(s.upTs * 1000))}, <span>käynnissä ${((state.t - s.upTs) / 86400).toFixed(1)} päivää.</span>`
        + (m && m[0] ? "<br>" + t`Muistia käytössä ${kb(m[0])} kt, suurin käyttö ${kb(m[1])} kt <span>(käytettävissä ${kb(m[2])} kt).</span>` : "")
        + "<br>" + t`Versio ${s.v} (${link("https://github.com/mattik-gh", "@mattik-gh")}), <span>perustuu versioon 3.4.0 (${link("https://jisotalo.fi", "jisotalo.fi")})</span>`;


      /**
       * Length of one price [s] used by this instance: 3600 (hourly prices), 1800 or 900
       * (hourly prices are used if price data doesn't have more accurate prices)
       * 
       * v10: new - price resolution (ci.q)
       */
      const unitOf = (dayIndex) => ci.q ? Math.max(s.p[dayIndex].sl, ci.q == 2 ? 1800 : 900) : 3600;

      /**
       * Helper that calculates prices [c/kWh] from the raw prices (prices of hour, 30 minutes or 15 minutes)
       * VAT and transfer fees are added. One price is the average of the slots during that time
       * This needs match 1:1 the Shelly script side
       * 
       * v10: new - the status has only raw prices, so VAT and fees are added here
       */
      const calcPrices = (dayIndex) => {
        let res = [];
        let raw = d.p[dayIndex];

        if (raw.length == 0) {
          return res;
        }

        let sl = s.p[dayIndex].sl;
        //How many slots in one price (4, 2 or 1)
        let slots = unitOf(dayIndex) / sl;

        for (let i = 0; i * slots < raw.length; i++) {
          //Transfer fee (if any)
          let fee = feeAt(c, new Date((s.p[dayIndex].st + i * slots * sl) * 1000));
          //Slots of this price (the last hour might be incomplete)
          let last = Math.min((i + 1) * slots, raw.length);
          let sum = 0;

          for (let j = i * slots; j < last; j++) {
            //Converting price to c/kWh and adding VAT and transfer fee to price
            let price = raw[j] / 100;
            sum += price / 10.0 * (100 + (price > 0 ? c.vat : 0)) / 100.0 + fee;
          }

          res.push(sum / (last - i * slots));
        }

        return res;
      }

      /**
       * Helper that builds price info table for today or tomorrow
       */
      const buildPriceTable = (dayIndex) => {
        let priceInfo = s.p[dayIndex];
        let header = `<tr><td class="t bg">${t("Keskihinta")}</td><td class="t bg">${t("Halvin")}</td><td class="t bg">${t("Kallein")}</td><td class="t bg">${t("Ohjauksen keskihinta")}</td></tr>`;

        if (d.p[dayIndex].length == 0) {
          //The same row as in the price list, but this table has four columns
          return header + notYetKnown.replace(3, 4);
        }

        let low = priceInfo.low;
        let high = priceInfo.high;

        if (ci.q) {
          //Lowest and highest of the prices used by this instance (15 or 30 min)
          let prices = calcPrices(dayIndex);
          low = Math.min(...prices);
          high = Math.max(...prices);
        }

        //v10: new - last column is the average price of the planned on-time (filled in buildPriceList())
        return `${header}
        <tr>
          <td>${priceInfo.avg.toFixed(2)} c/kWh</td>
          <td>${low.toFixed(2)} c/kWh</td>
          <td>${high.toFixed(2)} c/kWh</td>
          <td id="s-pc"></td>
        </tr>`;
      }

      //Price info for the selected day
      qs("s-pi").innerHTML = buildPriceTable(day);

      //Buttons to select the day (tomorrow is dimmed if prices are not yet known)
      [0, 1].forEach(i => {
        let b = qs(`s-d${i}`);
        b.className = i == day ? "sel" : "";
        b.style.opacity = d.p[i].length > 0 ? 1 : 0.5;
        b.onclick = () => {
          day = i;
          onUpdate();
        };
      });

      /**
       * v10: new - price chart (drawn here with plain HTML and CSS, Shelly only sends the same data as before)
       * Scale of the price charts [c/kWh] - same for today and tomorrow, so they can be compared
       * Highest price (or transfer fee) is rounded up to 1, 2 or 5 x 10^n
       */
      let gmax = Math.max(0.01, c.day, c.night, ...calcPrices(0), ...calcPrices(1));
      let gpow = Math.pow(10, Math.floor(Math.log10(gmax)));
      gmax = [1, 2, 5, 10].find(k => k * gpow >= gmax) * gpow;

      /**
       * Helper that builds price/cmd table for today or tomorrow
       */
      const buildPriceList = (dayIndex) => {
        let header = ` <tr><td class="t bg">${t("Aika")}</td><td class="t bg">${t("Hinta")}</td><td class="t bg">${t("Ohjaus", "sarake")}</td></tr>`;

        //Prices of the day (prices of hour, 30 minutes or 15 minutes)
        let prices = calcPrices(dayIndex);
        //Length of one price [s] and how many prices in an hour (1, 2 or 4) - settings are in hours
        let unit = unitOf(dayIndex);
        let mult = 3600 / unit;

        //Prices of the price chart (see drawChart() in s.js)
        let chart = [];

        if (prices.length == 0) {
          qs("s-pa").innerHTML = `${header}${notYetKnown}`;
          qs("s-pb").innerHTML = "";
          qs("s-g").innerHTML = "";
          qs("s-gt").innerHTML = "";
          qs("s-bn").style.display = "none";
          return;
        }

        //------------------------------
        // Cheapest hours logic
        // This needs match 1:1 the Shelly script side
        //------------------------------
        //v10: new - before, periods were one hour late for the rest of the day when DST starts
        //Periods are set as clock hours but prices are handled by index
        //They differ when daylight saving time (DST) changes -> offset = clock hour of the first price (as number of prices)
        //Note: Shelly uses its current time zone for this. Here the time zone at the middle of the day is used,
        //so the result is how Shelly works after the clock has changed (for the rest of the day)
        let st = s.p[dayIndex].st;
        let off = (new Date(st * 1000).getUTCHours() - new Date((st + 43200) * 1000).getTimezoneOffset() / 60 + 48) % 24;

        if (off > 12) {
          off -= 24;
        }

        off *= mult;

        //v10: new - index of a period boundary (clock hour): 00 is the first price and 24 the end of the data
        //(when DST ends, the day has 25 hours and the offset alone would leave the first hour out) - same as the Shelly script
        let row = (h) => h == 0 ? 0 : (h == 24 ? prices.length : h * mult - off);

        let cheapest = [];
        //v10: new - period of each price for the chart: [start, end, number of the period] (see drawChart() in s.js)
        //If periods overlap, the later one is shown
        let pd = [];
        if (ci.mode === 2) {
          //Select increment (a little hacky - to support custom periods too)
          let inc = ci.m2.p < 0 ? 1 : ci.m2.p * mult;

          //v10: new
          //Note: safety check (zero would cause an endless loop)
          for (let i = 0; inc > 0 && i - off < prices.length; i += inc) {
            //Hour count can have decimals (for example 1.5 h = 3 x 30 min)
            let cnt = Math.round((ci.m2.p == -2 && i >= 1 ? ci.m2.c2 : ci.m2.c) * mult);

            //Safety check
            if (cnt <= 0)
              continue;

            //If custom period -> select hours from that range. Otherwise use this period
            let start = i == 0 ? 0 : i - off;
            let end = i + inc >= 24 * mult ? prices.length : i + inc - off;

            if (ci.m2.p < 0 && i == 0) {
              //Custom period 1
              start = row(ci.m2.ps);
              end = row(ci.m2.pe);

            } else if (ci.m2.p == -2 && i == 1) {
              //Custom period 2
              start = row(ci.m2.ps2);
              end = row(ci.m2.pe2);
            }

            //Period can't start before the first price
            if (start < 0) {
              start = 0;
            }

            //If we have less hours than 24 then skip the rest from the end
            if (end > prices.length) {
              end = prices.length;
            }

            for (let j = start; j < end; j++) {
              pd[j] = [start, end, i / inc];
            }

            if (end - start <= cnt) {
              //All hours of the period are needed
              for (let j = start; j < end; j++) {
                cheapest.push(j);
              }

            } else if (ci.m2.p == -2 && i >= 1 ? ci.m2.s2 : ci.m2.s) {
              //v10: sliding sum - same change as in the Shelly script
              //Find cheapest in a sequence
              //Sum of the first sequence..
              let sum = 0;

              for (let j = start; j < start + cnt; j++) {
                sum += prices[j];
              }

              let best = sum;
              let startIndex = start;

              //..and then moving the sequence one hour at a time (adding the new hour and removing the first one)
              //If sum of these sequential hours is lower -> it's better
              for (let j = start + 1; j <= end - cnt; j++) {
                sum += prices[j + cnt - 1] - prices[j - 1];

                if (sum < best) {
                  best = sum;
                  startIndex = j;
                }
              }

              for (let j = startIndex; j < startIndex + cnt; j++) {
                cheapest.push(j);
              }

            } else {
              //v10: rank counting instead of sorting - same change as in the Shelly script
              //For each hour: count how many hours of the period are cheaper
              //(if the price is the same, earlier hour is cheaper)
              for (let h = start; h < end; h++) {
                let k = 0;

                for (let j = start; j < end; j++) {
                  if (prices[j] < prices[h] || (prices[j] == prices[h] && j < h)) {
                    k++;
                  }
                }

                //Hour is one of the cheapest if there are not enough cheaper hours
                if (k < cnt) {
                  cheapest.push(h);
                }
              }
            }

            //If custom period, quit when all periods are done (1 or 2 periods)
            if (ci.m2.p == -1 || (ci.m2.p == -2 && i >= 1))
              break;
          }
        }

        //------------------------------
        // Building the price list
        //------------------------------
        //Rows are divided into two tables (first and second half of the day)
        let rows = [header, header];

        let per = -off;
        let bg = false;
        //v10: new - is the background of some row different (note below the table tells what it means)
        let shade = false;
        for (let i = 0; i < prices.length; i++) {
          let price = prices[i];
          let date = new Date((s.p[dayIndex].st + i * unit) * 1000);

          //v10: before, by index
          //Forced hours are selected by the clock hour (differs from index when DST changes)
          let bit = (1 << date.getHours());
          //Forced hour on
          let fon = ((ci.f & bit) == bit && (ci.fc & bit) == bit);
          //Forced hour off
          let foff = ((ci.f & bit) == bit && (ci.fc & bit) == 0);

          let mode2MaxPrice = ci.m2.m == "avg" ? s.p[dayIndex].avg : ci.m2.m;

          let cmd =
            ((ci.mode === 0 && ci.m0.c)
              || (ci.mode === 1 && price <= (ci.m1.l == "avg" ? s.p[dayIndex].avg : ci.m1.l))
              || (ci.mode === 2 && cheapest.includes(i) && price <= mode2MaxPrice)
              || (ci.mode === 2 && price <= (ci.m2.l == "avg" ? s.p[dayIndex].avg : ci.m2.l) && price <= mode2MaxPrice)
              || fon)
            && !foff;

          //Invert
          if (ci.i) {
            cmd = !cmd;
          }

          if (!ci.en) {
            cmd = false;
          }

          if (ci.en && ci.mode === 2
            && ((ci.m2.p < 0 && (i == row(ci.m2.ps) || i == row(ci.m2.pe)))
              || (ci.m2.p == -2 && (i == row(ci.m2.ps2) || i == row(ci.m2.pe2)))
              || (ci.m2.p > 0 && i >= per + ci.m2.p * mult))) {

            //Period changed
            per += ci.m2.p * mult;
            bg = !bg;
            shade = true;
          }

          //v10: before, by the clock of the browser
          //Current hour (or slot) is shown in bold - by the time of the device, not by the clock of the browser
          let active = dayIndex == 0 && Math.floor(d.t / unit) == Math.floor(date.getTime() / 1000 / unit);

          //Price chart: price, transfer fee by the clock hour and planned control
          chart.push({ t: formatTime(date, false), p: price, f: feeAt(c, date), c: cmd, a: active, g: pd[i] });

          rows[i < prices.length / 2 ? 0 : 1] +=
          `<tr style="${active ? `font-weight:bold;` : ``}${(bg ? "background:#ededed;" : "")}">
            <td class="fit">${formatTime(date, false)}</td>
            <td>${price.toFixed(2)} c/kWh</td>
            <td><span style="display:inline-block;width:1em">${cmd ? "&#x2714;" : ""}</span>${fon || foff ? `<span style="position:absolute">**</span>` : ""}</td>
          </tr>`;
        }

        qs("s-pa").innerHTML = rows[0];
        qs("s-pb").innerHTML = rows[1];
        qs("s-bn").style.display = shade ? "block" : "none";
        //Average price of the planned on-time
        let on = chart.filter(x => x.c);
        qs("s-pc").innerHTML = on.length ? `${(on.reduce((a, x) => a + x.p, 0) / on.length).toFixed(2)} c/kWh` : "-";
        qs("s-g").innerHTML = drawChart(gmax, chart, unit);
        //Legend of the chart: how long the control is on during the day in total
        qs("s-gt").innerHTML = `(${dur(chart.filter(x => x.c).length * unit / 60)})`;

        return s.p[dayIndex].ts;
      }

      //Creating the price chart and price/cmd tables for the selected day
      buildPriceList(day);

    } catch (err) {
      console.error(err);

      clear();
      qs("s-cmd").innerHTML = t`Tila ei tiedossa (${err.message})`;
      qs("s-cmd").style.color = "red";
    }
  };

  onUpdate();
  CBS.push(onUpdate);
}