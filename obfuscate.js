/* Build step: produce app/app.bundle.html — the app with its own JavaScript
   obfuscated so the shipped .exe cannot be casually read or edited.
   The readable source stays at app/ToolTrace.html and is never modified.

   All of the app's own script blocks are obfuscated together as ONE unit, so
   there is a single shared string table and the globals that blocks share stay
   consistent. The public-domain QR library block is left verbatim. */
const fs = require("fs");
const path = require("path");
const JO = require("javascript-obfuscator");

const SRC = path.join(__dirname, "app", "Equip360.html");
const OUT = path.join(__dirname, "app", "app.bundle.html");
const html = fs.readFileSync(SRC, "utf8");

const isLibrary = code => /QR Code Generator for JavaScript/.test(code);
const isInjected = code => /__TT_VIEWER__/.test(code);

// pull out every <script> block, remembering its place
const parts = [];            // pieces of html between/around scripts
const scripts = [];          // {code, lib}
let last = 0;
const re = /<script>([\s\S]*?)<\/script>/g, m0 = [];
let m;
while ((m = re.exec(html))) {
  parts.push(html.slice(last, m.index));
  scripts.push({ code: m[1], lib: isLibrary(m[1]) || isInjected(m[1]) });
  last = m.index;
  m0.push(m);
}
const tail = html.slice(last + (m0.length ? m0[m0.length - 1][0].length : 0));
// rebuild parts so each script sits between the correct html fragments
const frags = [];
last = 0;
m0.forEach(mm => { frags.push(html.slice(last, mm.index)); last = mm.index + mm[0].length; });
frags.push(html.slice(last));

// combine all app code into one program, keep library blocks separate & in place
const appCode = scripts.filter(s => !s.lib).map(s => s.code).join("\n;\n");

const OPTS = {
  compact: true,
  renameGlobals: false,            // the combined program still exposes globals the HTML/inline handlers rely on
  identifierNamesGenerator: "mangled",
  transformObjectKeys: false,      // keep D.assets, settings keys, spec keys intact
  stringArray: true,
  stringArrayThreshold: 0.8,
  stringArrayEncoding: ["rc4"],          // plain array — base64 decoder mishandles Persian text
  splitStrings: false,
  numbersToExpressions: false,
  simplify: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  selfDefending: false,
  unicodeEscapeSequence: false
};

const obf = JO.obfuscate(appCode, OPTS).getObfuscatedCode();

// re-emit: library scripts verbatim in their original slots; all app code as a
// single obfuscated block placed where the first app block was.
let firstAppDone = false;
let out = "";
for (let i = 0; i < frags.length; i++) {
  out += frags[i];
  if (i < scripts.length) {
    const s = scripts[i];
    if (s.lib) out += "<script>" + s.code + "</script>";
    else if (!firstAppDone) { out += "<script>" + obf + "</script>"; firstAppDone = true; }
    // subsequent app blocks are folded into the combined one → emit nothing
  }
}
fs.writeFileSync(OUT, out);
console.log(`combined ${scripts.filter(s=>!s.lib).length} app block(s) into one obfuscated script; ${(out.length/1024|0)} KB → app/app.bundle.html`);
