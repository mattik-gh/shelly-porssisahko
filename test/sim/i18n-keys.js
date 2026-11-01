/**
 * Collects the texts of the user interface that need a translation (see t() and tr() in src/statics/s.js)
 * - JavaScript: t("text"), t("text", "context") and t`text ${value}`
 * - HTML: text nodes (context from attribute data-t of the parent) and values of buttons
 */
const fs = require("node:fs");
const path = require("node:path");

const DIR = path.join(__dirname, "../../src/statics");
const VOID = ["input", "br", "meta", "link", "hr", "img"];

/** Reads a template literal that starts at index i (after the backtick). Returns { key, end } */
function template(src, i) {
  let key = "";

  while (src[i] != "`") {
    if (src[i] == "$" && src[i + 1] == "{") {
      let depth = 1;
      i += 2;

      while (depth > 0) {
        if (src[i] == "`") {
          i = template(src, i + 1).end;
          continue;
        }
        depth += src[i] == "{" ? 1 : (src[i] == "}" ? -1 : 0);
        i++;
      }
      key += "%s";
      continue;
    }
    key += src[i++];
  }
  return { key, end: i + 1 };
}

function fromJs(src) {
  const keys = [];
  //Comments are removed first (examples in them are not texts of the user interface)
  src = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  for (const m of src.matchAll(/(?<![\w.$])t\("((?:[^"\\]|\\.)*)"(?:,\s*"([^"]*)")?\)/g)) {
    keys.push(m[2] ? `${m[1]}|${m[2]}` : m[1]);
  }

  for (const m of src.matchAll(/(?<![\w.$])t`/g)) {
    keys.push(template(src, m.index + 2).key);
  }
  return keys;
}

function decode(s) {
  return s.replace(/&nbsp;/g, "\u00a0").replace(/&copy;/g, "©").replace(/&middot;/g, "·").replace(/&amp;/g, "&");
}

function fromHtml(src) {
  const keys = [];
  const stack = [];

  src = src.replace(/<!--[\s\S]*?-->/g, "").replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "").replace(/<!DOCTYPE[^>]*>/, "");

  for (const m of src.matchAll(/<(\/?)([a-z0-9]+)([^>]*)>|([^<]+)/g)) {
    if (m[4] !== undefined) {
      const text = decode(m[4]).trim();
      const ctx = stack.length ? stack[stack.length - 1] : "";

      if (text) {
        keys.push(ctx ? `${text}|${ctx}` : text);
      }
    } else if (m[1]) {
      stack.pop();
    } else {
      if (m[2] == "input" && /type="button"/.test(m[3])) {
        keys.push(/value="([^"]*)"/.exec(m[3])[1]);
      }

      if (!VOID.includes(m[2])) {
        stack.push((/data-t="([^"]*)"/.exec(m[3]) || [])[1] || "");
      }
    }
  }
  return keys;
}

/** Returns all texts as { key, file } */
function collect() {
  const res = [];

  for (const file of fs.readdirSync(DIR).sort()) {
    const src = fs.readFileSync(path.join(DIR, file), "utf8");
    let keys = [];

    if (file == "en.js" || file == "en-config.js" || file == "dev.js") {
      continue;
    } else if (file.endsWith(".js")) {
      keys = fromJs(src);
    } else if (file.endsWith(".html")) {
      keys = fromHtml(src).concat(fromJs((src.match(/<script[\s\S]*?<\/script>/g) || []).join("\n")));
    }
    keys.forEach(key => res.push({ key, file }));
  }
  return res;
}

module.exports = { collect, fromJs, fromHtml };

if (require.main === module) {
  const seen = {};
  collect().forEach(x => { if (!seen[x.key]) { seen[x.key] = 1; console.log(`${x.file}\t${JSON.stringify(x.key)}`); } });
}
