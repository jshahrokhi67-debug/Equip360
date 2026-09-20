const { app, BrowserWindow, protocol, net, Menu, dialog, shell, session } = require("electron");
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
