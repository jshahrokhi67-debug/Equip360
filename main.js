const { app, BrowserWindow, protocol, net, Menu, dialog, shell, session, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const APP_HTML = fs.existsSync(path.join(__dirname,"app","app.bundle.html")) ? "app.bundle.html" : "Equip360.html";
const { pathToFileURL } = require("url");

/* A custom scheme gives the page a proper secure origin, so IndexedDB and the
   rest of normal browser storage work exactly as they do on a website. Loading
   the file directly from disk is what Chrome refuses to give storage to. */
protocol.registerSchemesAsPrivileged([
  { scheme: "tooltrace", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
]);

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }

/* =================== Auto-backup (writes to a user-chosen folder) =================== */
function eqCfgPath(){ return path.join(app.getPath("userData"), "eq-backup.json"); }
function eqReadCfg(){ try{ return JSON.parse(fs.readFileSync(eqCfgPath(), "utf8")); }catch(e){ return { enabled:false, folder:"", keep:10 }; } }
function eqWriteCfg(c){ try{ fs.writeFileSync(eqCfgPath(), JSON.stringify(c)); return true; }catch(e){ return false; } }
function eqWriteBackup(json){
  const cfg = eqReadCfg();
  if(!cfg.folder) return { ok:false, err:"no folder" };
  try{
    if(!fs.existsSync(cfg.folder)) fs.mkdirSync(cfg.folder, { recursive:true });
    const stamp = new Date().toISOString().replace(/[:]/g,"-").replace("T","_").slice(0,16);
    const name = "Equip360_backup_" + stamp + ".json";
    fs.writeFileSync(path.join(cfg.folder, name), json);
    const keep = Math.max(1, cfg.keep || 10);
    let files = fs.readdirSync(cfg.folder).filter(f => /^Equip360_backup_.*\.json$/.test(f)).sort();
    while(files.length > keep){ try{ fs.unlinkSync(path.join(cfg.folder, files.shift())); }catch(e){} }
    return { ok:true, file:name };
  }catch(err){ return { ok:false, err:String(err) }; }
}
ipcMain.handle("eq-get-cfg", () => eqReadCfg());
ipcMain.handle("eq-set-cfg", (e, c) => eqWriteCfg(c || {}));
ipcMain.handle("eq-pick-folder", async () => {
  const r = await dialog.showOpenDialog({ properties:["openDirectory","createDirectory"] });
  return (r.canceled || !r.filePaths.length) ? null : r.filePaths[0];
});
ipcMain.handle("eq-save-backup", (e, json) => eqWriteBackup(json));

let eqQuitting = false, eqBackupPending = false, eqBackupTimer = null;
ipcMain.on("eq-backup-done", () => {
  if(eqBackupPending){ eqBackupPending = false; clearTimeout(eqBackupTimer); eqQuitting = true; app.quit(); }
});
app.on("before-quit", (e) => {
  const cfg = eqReadCfg();
  if(eqQuitting || !cfg.enabled || !cfg.folder) return;         // nothing to do
  if(!win || !win.webContents){ return; }
  e.preventDefault();                                            // hold the quit
  eqBackupPending = true;
  try{ win.webContents.send("eq-do-backup"); }catch(err){ eqQuitting = true; app.quit(); return; }
  eqBackupTimer = setTimeout(() => { eqBackupPending = false; eqQuitting = true; app.quit(); }, 8000);
});

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1024, minHeight: 640,
    backgroundColor: "#eceff3",
    title: "Equip360",
    icon: path.join(__dirname, "app", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  });

  win.setMenuBarVisibility(false);
  win.loadURL("tooltrace://app/"+APP_HTML);

  // Reports and printable documents open in their own window.
  win.webContents.setWindowOpenHandler(() => ({
    action: "allow",
    overrideBrowserWindowOptions: {
      width: 1100, height: 850, backgroundColor: "#ffffff",
      autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false }
    }
  }));

  // External links go to the default browser, never inside the app.
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith("tooltrace://")) { e.preventDefault(); shell.openExternal(url); }
  });

  win.on("closed", () => { win = null; });
}

app.whenReady().then(() => {
  protocol.handle("tooltrace", (request) => {
    const url = new URL(request.url);
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "") || APP_HTML;
    const file = path.join(__dirname, "app", path.normalize(rel).replace(/^(\.\.[\/\\])+/, ""));
    if (!file.startsWith(path.join(__dirname, "app"))) return new Response("Forbidden", { status: 403 });
    if (!fs.existsSync(file)) return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });

  // Every export asks where to save, instead of dropping silently into Downloads.
  session.defaultSession.on("will-download", (event, item) => {
    item.setSaveDialogOptions({ defaultPath: item.getFilename() });
  });

  createWindow();

  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });

/* A keyboard shortcut for the data folder, useful when supporting a customer. */
app.on("browser-window-created", (_, w) => {
  w.webContents.on("before-input-event", (e, input) => {
    if (input.control && input.shift && input.key.toLowerCase() === "d") {
      shell.openPath(app.getPath("userData"));
    }
    if (input.key === "F12") w.webContents.toggleDevTools();
  });
});
