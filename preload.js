/* Runs before the page. Supplies a hardware-derived machine identifier so the
   licence stays tied to this computer even if application data is cleared. */
const { contextBridge, ipcRenderer } = require("electron");
const os = require("os");
const crypto = require("crypto");

function machineId() {
  const parts = [os.hostname(), os.platform(), os.arch(), String(os.totalmem())];
  const nets = os.networkInterfaces();
  const macs = [];
  Object.keys(nets).sort().forEach(name => {
    (nets[name] || []).forEach(n => {
      if (n.mac && n.mac !== "00:00:00:00:00:00" && !n.internal) macs.push(n.mac);
    });
  });
  macs.sort();
  parts.push(macs.slice(0, 2).join("|"));          // first two physical adapters
  return crypto.createHash("sha256").update(parts.join("::")).digest("hex");
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
