/* Runs before the page. Supplies a STABLE machine identifier so the licence
   stays tied to this computer and does NOT change across reboots.
   Priority: Windows MachineGuid (stable per Windows install) -> a persisted
   random id -> a non-volatile hardware fallback. Network MACs are NOT used
   (they drift between boots with VPN/Bluetooth/virtual/Wi-Fi-random adapters). */
const { contextBridge, ipcRenderer } = require("electron");
const os = require("os");
const crypto = require("crypto");

function sha(s){ return crypto.createHash("sha256").update("eq::"+String(s)).digest("hex"); }

function machineId() {
  // 1) Windows MachineGuid — stable across reboots and even data wipes.
  try {
    if (process.platform === "win32") {
      const out = require("child_process")
        .execSync('reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid', { timeout: 4000, windowsHide: true })
        .toString();
      const m = out.match(/MachineGuid\s+REG_SZ\s+([0-9A-Fa-f-]{10,})/);
      if (m && m[1]) return sha("winguid:" + m[1].trim());
    }
  } catch (e) {}

  // 2) Persisted random id — written once, read forever (stable thereafter).
  try {
    const fs = require("fs"), path = require("path");
    const base = process.env.LOCALAPPDATA || process.env.APPDATA || os.homedir();
    const file = path.join(base, ".equip360_machine_id");
    let id = "";
    try { if (fs.existsSync(file)) id = fs.readFileSync(file, "utf8").trim(); } catch (e) {}
    if (!id || id.length < 16) {
      id = crypto.randomBytes(16).toString("hex");
      try { fs.writeFileSync(file, id); } catch (e) {}
    }
    if (id) return sha("persist:" + id);
  } catch (e) {}

  // 3) Last-resort non-volatile hardware fallback (no network MACs).
  return sha("hw:" + [os.platform(), os.arch(), os.hostname()].join("|"));
}

contextBridge.exposeInMainWorld("ttMachine", machineId());
contextBridge.exposeInMainWorld("ttDesktop", { version: process.env.npm_package_version || "1.0.0" });

// Auto-backup bridge (renderer <-> main). File writes happen in the main process.
contextBridge.exposeInMainWorld("equip360", {
  pickFolder: () => ipcRenderer.invoke("eq-pick-folder"),
  saveBackup: (json) => ipcRenderer.invoke("eq-save-backup", json),
  getCfg: () => ipcRenderer.invoke("eq-get-cfg"),
  setCfg: (cfg) => ipcRenderer.invoke("eq-set-cfg", cfg),
  onDoBackup: (fn) => ipcRenderer.on("eq-do-backup", () => fn()),
  backupDone: (ok) => ipcRenderer.send("eq-backup-done", ok)
});
