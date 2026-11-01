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
 * 
 * v10: English translations of the user interface (texts that are used only in the settings)
 * Loaded when the settings are opened (see openTab() in s.js) - one file with all texts would be too large
 * for the memory of the device (see test/memory.test.js)
 * Key = Finnish text as it is in the code (see t() and tr() in s.js)
 * - "text|context" = translation for one place only
 * - %s = place of a value
 */
Object.assign(TR, {
  //Settings
  "YLEISET ASETUKSET": "COMMON SETTINGS",
  "Maa": "Country",
  "Suomi": "Finland",
  "Viro": "Estonia",
  "Liettua": "Lithuania",
  "Ohjausten määrä": "Number of controls",
  "Ohjaus on sääntö, joka kytkee yhtä tai useampaa lähtöä sähkön hinnan mukaan. Jokainen ohjaus vie muistia, joten valitse vain tarvittava määrä.": "A control is a rule that switches one or more outputs by the electricity price. Each control uses memory, so select only as many as needed.",
  "Historian pituus": "History length",
  "0 (ei historiaa)": "0 (no history)",
  "24 riviä": "24 rows",
  "48 riviä": "48 rows",
  "72 riviä": "72 rows",
  "96 riviä": "96 rows",
  "Jaetaan käytössä olevien ohjausten kesken.": "Shared between the enabled controls.",
  "Sähkön ALV": "VAT",
  "Siirtomaksut": "Transfer fees",
  "Aikasiirrossa päivä- ja yömaksu ovat voimassa joka päivä kellonajan mukaan. Kausisiirrossa päivämaksu on voimassa vain talvikauden arkipäivinä (ma-la), muina aikoina \"muu aika\" -maksu. Päivät ja kellonajat näkyvät maksujen perässä. Niitä voi tarvittaessa muuttaa etäasetusten skriptillä.": "Time-of-day transfer: the day and night fees apply every day by the time of day. Seasonal transfer: the day fee applies only on winter weekdays (Mon-Sat), at other times the \"other times\" fee. The days and hours are shown after the fees. They can be changed with the remote settings script if needed.",
  "Aikasiirto": "Time-of-day transfer",
  "Kausisiirto": "Seasonal transfer",
  "ma-la": "Mon-Sat",
  "muu aika": "other times",
  "joka päivä": "every day",
  "OHJAUS #": "CONTROL #",
  "Käytössä": "Enabled",
  "Nimi": "Name",
  "Ohjaustapa": "Mode",
  "Ohjattavat lähdöt": "Shelly outputs",
  "0 = Ensimmäinen lähtö, useampi pilkulla erotettuna (0,1)": "0 = First output, several separated by commas (0,1)",
  "Lähtöä ei ole määritetty. Anna lähdön numero (yleensä 0) ja tallenna.": "No output defined. Enter the output number (usually 0) and save.",
  "Lähdön ohjaus": "Write outputs",
  "Aina tarkistaessa: lähtö asetetaan uudelleen tunnin, 30 min tai 15 min välein (hinnan tarkkuuden mukaan). Vain muuttuessa: lähtö asetetaan vain, kun ohjauksen tila vaihtuu, joten lähtöä voi välillä ohjata myös muualta.": "Always: output is set again every hour, 30 min or 15 min (by the price resolution). On-change: output is set only when the control state changes, so it can also be switched from elsewhere in between.",
  "Aina tarkistaessa": "Always",
  "Vain muuttuessa": "On-change",
  "Hinnan tarkkuus": "Price resolution",
  "Tunnin keskiarvo": "Hourly average",
  "30 min keskiarvo": "30 min average",
  "15 min hinta": "15 min price",
  "Lähtö voi kytkeytyä kerran tunnissa.": "Output can switch once an hour.",
  "Lähtö voi kytkeytyä kahdesti tunnissa.": "Output can switch twice an hour.",
  "Lähtö voi kytkeytyä jopa neljästi tunnissa.": "Output can switch up to four times an hour.",
  "Ohjausminuutit": "Control minutes",
  "Lähtö on päällä vain tunnin ensimmäiset minuutit (60 = koko tunnin).": "Output is on only for the first minutes of the hour (60 = whole hour).",
  "Käänteinen ohjaus": "Inverted",
  "Lähtö on pois, kun ohjaus on päällä, ja päinvastoin.": "Output is off when the control is on, and vice versa.",
  "Varmuustunnit": "Backup hours",
  "Tunnit, joina lähtö on päällä, jos hintoja ei ole saatu.": "Hours when output is on if there are no prices.",
  "Hätätilaohjaus": "Emergency",
  "Lähdön tila, jos kellonaikaa ei ole saatu (esim. verkkohäiriö käynnistyksen jälkeen).": "Output state if time is not known (e.g. network failure after start).",
  "Pakko-ohjatut tunnit": "Override hours",
  "Näytä/piilota": "Show/hide",
  "Tunti": "Hour",
  "KÄSIOHJAUS": "MANUAL MODE",
  "HINTARAJA": "PRICE LIMIT",
  "Lähtö on päällä, kun hinta on enintään raja. Avg = enintään päivän keskihinta.": "Output is on when price is at most the limit. Avg = day's average price.",
  "JAKSON HALVIMMAT TUNNIT": "CHEAPEST HOURS",
  "Ajanjakso": "Time period",
  "oma valinta (1 jakso)": "custom (1 period)",
  "oma valinta (2 jaksoa)": "custom (2 periods)",
  "Jakso, josta valitaan alla oleva tuntimäärä halvimpia aikoja.": "Cheapest times are picked from this period (count below).",
  "aikaväli (klo):": "time range:",
  "Oma ajanjakso": "Custom",
  "Oma ajanjakso 2": "Custom 2",
  "Tuntimäärä": "Hour count",
  "Tuntimäärä 2": "Hour count 2",
  "Kokonaiset tunnit.": "Full hours.",
  "0.5 h välein (esim. 1.5).": "In steps of 0.5 h (e.g. 1.5).",
  "0.25 h välein (esim. 1.25).": "In steps of 0.25 h (e.g. 1.25).",
  "Peräkkäiset": "Sequential",
  "Valitaan halvimmat peräkkäiset ajat.": "The cheapest consecutive times are picked.",
  "Aina päällä -raja": "Always on limit",
  "Lähtö on aina päällä, kun hinta on enintään raja. Avg = enintään päivän keskihinta.": "Always on when price is at most the limit. Avg = day's average price.",
  "Maksimihinta": "Max. price limit",
  "Lähtö ei ole päällä, kun hinta on yli rajan. Ohittaa myös aina päällä -rajan. Avg = yli päivän keskihinnan.": "Never on when price is over the limit. Overrides the always-on limit. Avg = day's average price.",
  "Tallenna": "Save",
  "TILAPÄINEN PAKKO-OHJAUS": "MANUAL OVERRIDE",
  "Pidä lähtö": "Keep the output",
  "tuntia": "hours",
  "Kyllä": "Yes",
  "Ei": "No",
  "Päällä": "On",
  "Pois": "Off",
  "hinnasta riippumatta.": "regardless of the price.",
  "Peru": "Cancel",
  "Lähtö nyt": "Output now",
  "Pakotettu tila": "Forced state",
  "pakko-ohjaus %s asti": "manual override until %s",
  "ei pakko-ohjausta": "no manual override",
  "Shellyn hallinta": "Shelly WebUI",
  "Ohjattavat lähdöt: anna lähtöjen numerot pilkulla erotettuna (esim. 0 tai 0,1)": "Shelly outputs: enter the output numbers separated by commas (e.g. 0 or 0,1)",
  "Ohjattavat lähdöt: enintään 4 lähtöä": "Shelly outputs: at most 4 outputs",
  "Tallennettu": "Saved",
  "Asetukset eivät mahdu laitteen muistiin. Lyhennä nimeä tai lähtöjen listaa.": "Settings do not fit in the device memory. Shorten the name or the output list.",
  "Virhe: %s": "Error: %s"
});
