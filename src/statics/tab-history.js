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
  let history = [];

  /**
   * Clears page
   * Used when instance is changed or during error
   */
  const clear = (e) => {
    qs("s-hist").innerHTML = `<tr><td colspan=3>${t("Ei historiaa")}</td></tr>`;
  }

  /**
   * Callback called by main loop
   * 
   * @param {*} instChanged true = instance has changed (reset data)
   * @returns 
   */
  const onUpdate = async (instChanged) => {
    let e = qs("s-hist");

    try {
      if (instChanged || state == undefined) {
        return clear(e);
      }
      if (activeTab != "tab-history") {
        return;
      }

      //v10: new - price request error statistics since start (common for all instances), times with seconds
      let st = state.s;
      //Latest outage: the end time without the date, if the outage started and ended on the same day
      let e1 = new Date(st.errT1 * 1000);
      let e2 = new Date(st.errTs * 1000);
      qs("s-err").innerHTML = t`Hintahaun virheitä käynnistyksen jälkeen: ${st.errTot + (st.errTot >= 999999 ? "+" : "")}`
        + (st.errTot > 0
          ? " " + t`(ensimmäinen ${formatDateTime(new Date(st.errT0 * 1000))})` + "<br>"
          + t`Viimeisin katko: ${formatDateTime(e1)} – ${e1.toDateString() == e2.toDateString() ? formatTime(e2) : formatDateTime(e2)}`
          + ", " + (st.errN == 1 ? t("1 virhe") : t`${st.errN} virhettä`)
          : "");

      let res = await getData(`${URLS}?r=h&i=${inst}`);

      if (res.ok) {
        //v10: history format changed (before: rows [epoch, cmd, status])
        //History is sent as a packed binary string (base64) with 4 bytes for each row:
        //3 bytes for time (minutes from 8.6.2019) and 1 byte for (cmd << 4) | status
        //Unpacking to a format (minutes from epoch << 5) | (cmd << 4) | status
        let raw = atob(res.data);
        history = [];

        for (let i = 0; i < raw.length; i += 4) {
          history.push(((raw.charCodeAt(i) << 16 | raw.charCodeAt(i + 1) << 8 | raw.charCodeAt(i + 2)) + 26000000) * 32 + raw.charCodeAt(i + 3));
        }

        if (!history.length) {
          return clear(e);
        }

        //If status 503 the shelly is just now busy running the logic -> do nothing
      } else if (res.code !== 503) {
        return clear(e);
      }

      //History
      e.innerHTML = "";

      //Newest first
      //v10: rows are shown in the order of the device (before: sorted by value, so rows of the same minute were in wrong order)
      for (let row of history.reverse()) {
        let cmd = (row >> 4) & 1;
        let data = `<tr>`;
        //v10: if clock time was not known, the row has minutes from the start of the device (a small value) instead of time
        //(a real time is always millions of minutes)
        let min = Math.floor(row / 32);
        data += `<td class="fit">${min - 26000000 < 100000 ? "00.00.0000 00:00" : formatDateTime(new Date(min * 60000), false)}</td>`;
        data += `<td style="color:${cmd ? `green` : `red`}">${cmd ? t("Ohjaus päälle") : t("Ohjaus pois")}</td>`;
        data += `<td>${STATE_STR[row & 15]?.replace(/ \(.*%s.*\)/, "")}</td>`;
        data += `</tr>`;

        e.innerHTML += data;
      }

    } catch (err) {
      console.error(err);
      e.innerHTML = err;
    }
  };

  onUpdate();
  CBS.push(onUpdate);
}