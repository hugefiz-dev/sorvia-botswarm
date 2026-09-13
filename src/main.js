'use strict';

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const BotManager = require('./bot-manager');
const versions = require('./versions');
const advisor = require('./advisor');

// Heavy modules are required lazily (on first use) to keep idle memory low.
// Allow manual GC so memory is reclaimed after a test is stopped.
try { app.commandLine.appendSwitch('js-flags', '--expose-gc'); } catch (_) {}

// Single instance: if the app is already open, focus that window instead of
// starting a second copy.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

let mcPing = null;
let sparkFetch = null;
function getPing() {
  if (mcPing === null) { try { mcPing = require('minecraft-protocol').ping; } catch (_) { mcPing = false; } }
  return mcPing || null;
}
function getSparkFetch() {
  if (!sparkFetch) sparkFetch = require('./spark-fetch');
  return sparkFetch;
}

let mainWindow = null;
let botManager = null;

const BRAND = 'Sorvia Development Solutions by HugeFiz';
const OPAQUE_BG = '#14100e';

// Frosted (acrylic) window backdrops are a Windows 11 22H2+ feature. Anywhere
// else the window stays solid and the UI is told so, instead of leaving the
// user with a black or half-drawn background.
function supportsAcrylic() {
  if (process.platform !== 'win32') return false;
  const build = parseInt(String(require('os').release()).split('.')[2], 10);
  return isFinite(build) && build >= 22621;
}

function createWindow() {
  // Windows only accepts the acrylic backdrop while a window is being created —
  // switching it on later leaves the window black (verified on Windows 11). So
  // the window is ALWAYS created glass-capable, and the page decides how much
  // shows through: while the theme's transparency is 0 the page paints itself
  // fully opaque and the app looks exactly like a solid window.
  const glass = supportsAcrylic();

  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 940,
    minHeight: 640,
    // Transparent window background + acrylic = the desktop behind shows
    // through, blurred by Windows. Opaque colour when the feature is off.
    backgroundColor: glass ? '#00000000' : OPAQUE_BG,
    ...(glass ? { backgroundMaterial: 'acrylic' } : {}),
    title: 'Sorvia BotSwarm',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    // The window keeps its native frame (resize borders, rounded corners, drop
    // shadow) with the title bar hidden, so the app draws its own title bar as
    // before. This is NOT cosmetic: Windows paints the acrylic backdrop into a
    // window's frame, so a fully frameless window can never be frosted — it
    // just renders black behind the page. Verified both ways on Windows 11.
    frame: true,
    titleBarStyle: 'hidden',
    show: false, // shown on ready-to-show to avoid a white flash
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  // Safety: show anyway if ready-to-show is slow for any reason.
  setTimeout(() => { if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) mainWindow.show(); }, 1500);

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Headless boot self-check (CI / dev): SMOKE_BOOT=1 loads the UI, reports
  // any renderer errors, then exits. Has no effect in normal use.
  if (process.env.SMOKE_BOOT) {
    let hadError = false;
    mainWindow.webContents.on('console-message', (_e, level, message) => {
      if (level >= 2) { hadError = true; console.error('[renderer]', message); }
    });
    mainWindow.webContents.on('render-process-gone', (_e, d) => {
      hadError = true; console.error('[render-process-gone]', d.reason);
    });
    mainWindow.webContents.on('did-finish-load', () => {
      console.log('USERDATA', app.getPath('userData'));
      setTimeout(async () => {
        if (process.env.SMOKE_CLICK) {
          try { await mainWindow.webContents.executeJavaScript(process.env.SMOKE_CLICK); } catch (e) {}
          await new Promise((r) => setTimeout(r, 600));
        }
        if (process.env.SMOKE_SHOT) {
          try {
            const img = await mainWindow.webContents.capturePage();
            require('fs').writeFileSync(process.env.SMOKE_SHOT, img.toPNG());
            console.log('SHOT SAVED');
          } catch (e) { console.error('shot fail', e.message); }
        }
        console.log(hadError ? 'BOOT FAILED' : 'BOOT OK');
        app.exit(hadError ? 1 : 0);
      }, 2800);
    });
  }

  // Open external links in the OS browser, never in-app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  botManager = new BotManager((event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('bot-event', event);
    }
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (botManager) botManager.stopAll('app-quit');
  if (process.platform !== 'darwin') app.quit();
});

// Shutting down a big swarm means telling up to 1000 bots to quit and letting
// their sockets close. An installer or updater that asks us to close gives the
// process a few seconds before it gives up and tells the user the app "cannot
// be closed", so teardown never gets to hold the process open: whatever is
// still finishing, the process exits.
let quitting = false;
app.on('before-quit', () => {
  if (quitting) return;
  quitting = true;
  if (botManager) botManager.stopAll('app-quit');
  const bail = setTimeout(() => {
    try { app.exit(0); } catch (_) { process.exit(0); }
  }, 1500);
  if (bail.unref) bail.unref(); // a clean exit still happens immediately
});

/* ------------------------- IPC: window controls ------------------------- */
ipcMain.handle('win:minimize', () => mainWindow && mainWindow.minimize());
ipcMain.handle('win:maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.handle('win:close', () => mainWindow && mainWindow.close());

// Window transparency (theme panel): 0 = solid, 60 = as see-through as it gets.
// The window itself is never faded — that would wash out the panels and the
// text with it. Instead the page paints a see-through background (the renderer
// lowers --page-alpha) and the window is told to frost whatever is behind it,
// so the desktop shows through blurred. Windows 11 does the blur natively via
// the acrylic backdrop material; elsewhere the call is a no-op and the page
// simply looks darker, which is why the slider is capped well short of 100.
ipcMain.handle('win:setTransparency', (_e, value) => {
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false };
  let v = Number(value);
  if (!isFinite(v)) v = 0;
  v = Math.max(0, Math.min(90, v));
  try { mainWindow.setOpacity(1); } catch (_) {} // undo the old whole-window fade
  // Nothing to switch here: the backdrop was decided when the window was
  // created. This only tells the renderer whether it may go see-through, so a
  // machine without the frosting keeps a solid page instead of a black hole.
  return { ok: true, transparency: supportsAcrylic() ? v : 0, material: supportsAcrylic() ? 'acrylic' : 'unsupported' };
});

/* ------------------------- IPC: meta ------------------------- */
ipcMain.handle('app:meta', () => ({
  brand: BRAND,
  version: app.getVersion(),
  node: process.versions.node,
  electron: process.versions.electron
}));

ipcMain.handle('app:openExternal', (_e, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) shell.openExternal(url);
});

/* ------------------------- IPC: versions ------------------------- */
ipcMain.handle('versions:list', async () => {
  return versions.getVersions();
});

/* ------------------------- settings (hidden userData folder) ------------- */
function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}
function loadSettings() {
  try { return JSON.parse(fs.readFileSync(settingsPath(), 'utf8')); } catch (_) { return {}; }
}
function saveSettings(obj) {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    const merged = { ...loadSettings(), ...(obj || {}) };
    fs.writeFileSync(settingsPath(), JSON.stringify(merged, null, 2), 'utf8');
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}
ipcMain.handle('settings:get', () => loadSettings());
ipcMain.handle('settings:set', (_e, obj) => saveSettings(obj));

/* ------------------------- analysis: ping + advisor ---------------------- */
function flattenDesc(d) {
  if (!d) return '';
  if (typeof d === 'string') return d;
  let out = d.text || '';
  if (Array.isArray(d.extra)) out += d.extra.map(flattenDesc).join('');
  return out.replace(/§[0-9a-fk-or]/gi, '').trim();
}
ipcMain.handle('server:ping', (_e, { host, port, version }) => {
  return new Promise((resolve) => {
    const ping = getPing();
    if (!ping) return resolve({ error: 'ping-unavailable' });
    try {
      ping({ host: String(host || '').trim(), port: parseInt(port, 10) || 25565, version: version || false }, (err, res) => {
        if (err) return resolve({ error: err.message });
        const name = res && res.version && res.version.name;
        resolve({
          ok: true,
          versionName: name || '?',
          serverType: advisor.detectServerType(name),
          players: res.players || null,
          motd: flattenDesc(res.description),
          latency: res.latency != null ? res.latency : null
        });
      });
    } catch (e) { resolve({ error: e.message }); }
  });
});
ipcMain.handle('analyze:parseSpark', (_e, text) => advisor.parseSparkText(text));
ipcMain.handle('analyze:advise', (_e, input) => advisor.advise(input));
ipcMain.handle('analyze:fetchSpark', (_e, url) => getSparkFetch().fetchSparkReport(url));

/* ------------------------- IPC: test control ------------------------- */
ipcMain.handle('test:update', async (_e, config) => {
  if (!botManager) return { ok: false, error: 'not-ready' };
  return botManager.update(config);
});

ipcMain.handle('test:start', async (_e, config) => {
  if (!botManager) return { ok: false, error: 'not-ready' };
  return botManager.start(config);
});

ipcMain.handle('test:stop', async () => {
  if (!botManager) return { ok: false };
  botManager.stopAll('user-stop');
  return { ok: true };
});

ipcMain.handle('test:status', async () => {
  if (!botManager) return { running: false };
  return botManager.status();
});
