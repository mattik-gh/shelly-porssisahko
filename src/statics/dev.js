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
 * This file is loaded only during local development
 */
/** URL of the shelly - the address of your own device is given in dev.local.js (not in version control), see README */
SRV = "http://192.168.1.50";

/** URL of the logic script (set after dev.local.js has been loaded) */
URLS = "";

/**
 * debug function that is printing to console only when DEV is active
 */
DBG = console.log.bind(window.console);

/**
 * Helper that is used for DBG calls to add caller information
 */
me = () => {
  let s = new Error().stack;
  if (s) {
    s = s.split(String.fromCharCode(10));
  }
  if (s.length > 0) {
    let str = "";
    if (s[4] && s[4].trim().split(" ")[1]) {
      str += `/${s[4].trim().split(" ")[1]}`;
    }
    if (s[3] && s[3].trim().split(" ")[1]) {
      str += `/${s[3].trim().split(" ")[1]}`;
    }
    if (s[2] && s[2].trim().split(" ")[1]) {
      str += `/${s[2].trim().split(" ")[1]}`;
    }
    return `${str}:`;
  }
  return `?:`;
};

/**
 * Adding an event listener so we will catch eval() script errors better
 */
window.addEventListener("error", (e) => console.error("Error at line:", e.lineno), false);

/**
 * Local overrides (dev.local.js, not in version control) - the page is started after it has been loaded (or not found)
 */
let local = reqJs("dev.local.js");
local.onload = local.onerror = () => {
  URLS = `${SRV}/script/1`;
  updateLoop();
};