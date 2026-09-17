'use strict';

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

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
let glassMode = null;       // what THIS window can do: acrylic | vibrancy | transparent
let kdeBlurOn = false;      // KWin has been asked to frost behind this window

const BRAND = 'Sorvia Development Solutions by HugeFiz';
const OPAQUE_BG = '#14100e';

// What kind of see-through window this OS can give us. Every platform needs a
// different mechanism and none of them can be switched on after the window
// exists, so this is decided once, before the window is created.
//
//   'acrylic'     Windows 11 22H2+ — the OS frosts the desktop behind the
//                 window for us (DWM backdrop material).
//   'vibrancy'    macOS — AppKit does the same through an NSVisualEffectView.
//   'transparent' Linux — the window really is see-through. Blurring what is
//                 behind it is the compositor's call, so the app asks KWin for
//                 it directly (setKdeBlur); other compositors either do it on
//                 their own terms (picom's blur-background) or not at all.
//                 With no compositing window manager there is no ARGB visual
//                 and a see-through page would paint over black instead of the
//                 desktop — which is what --opaque is for.
//   null          nothing available; the UI is told, and the page stays solid.
function glassKind() {
  // Escape hatch for a Linux session whose compositor cannot do ARGB: start
  // the app once with --opaque (or SORVIA_OPAQUE=1) and it comes up solid.
  // Quit the running copy first — a second launch only focuses the first one.
  if (process.argv.includes('--opaque') || process.env.SORVIA_OPAQUE === '1') return null;
  if (process.platform === 'win32') {
    const build = parseInt(String(require('os').release()).split('.')[2], 10);
    return isFinite(build) && build >= 22621 ? 'acrylic' : null;
  }
  if (process.platform === 'darwin') return 'vibrancy';
  if (process.platform === 'linux') return 'transparent';
  return null;
}

/* ------------------------- KDE / KWin frosting --------------------------
 * Windows and macOS frost what is behind a translucent window by themselves.
 * On Linux that is the compositor's call, and KWin takes it from a window
 * property: set _KDE_NET_WM_BLUR_BEHIND_REGION and it blurs the desktop behind
 * the window, clear it and it stops. Asking for that is a single xprop call —
 * no native module and no extra dependency for a feature most users of this
 * app will never switch on.
 *
 * Everything here fails quietly by design: a compositor that is not KWin
 * ignores the property, a Wayland-native session has no X11 window to set it
 * on, and a machine without xprop installed just never gets the blur. In all
 * three cases the window is still see-through, only sharp instead of frosted,
 * and the UI says so.
 */
const KDE_BLUR_PROP = '_KDE_NET_WM_BLUR_BEHIND_REGION';
function x11WindowId() {
  try {
    const buf = mainWindow.getNativeWindowHandle();
    if (!buf || buf.length < 4) return null;
    const id = buf.readUInt32LE(0); // an X11 window id is 32 bits wide
    return id ? '0x' + id.toString(16) : null;
  } catch (_) { return null; }
}
function setKdeBlur(on) {
  if (process.platform !== 'linux' || !mainWindow || mainWindow.isDestroyed()) return;
  if (kdeBlurOn === !!on) return;
  const id = x11WindowId();
  if (!id) return;
  // A region of zero rectangles means "all of it" to KWin.
  const args = on
    ? ['-id', id, '-f', KDE_BLUR_PROP, '32c', '-set', KDE_BLUR_PROP, '0']
    : ['-id', id, '-remove', KDE_BLUR_PROP];
  try {
    // Synchronous on purpose: this runs at most twice in a session (the slider
    // leaving 0 and coming back to it), and the answer decides what the UI
    // tells the user, so it is worth the few milliseconds.
    execFileSync('xprop', args, { timeout: 2000, stdio: 'ignore' });
    kdeBlurOn = !!on;
  } catch (_) {
    kdeBlurOn = false; // no xprop, no X11 window, or KWin refused it
  }
}

function createWindow() {
  // None of the see-through window modes can be switched on after the window
  // exists — Windows accepts the acrylic backdrop only while the window is
  // being created (switching it on later just leaves the window black,
  // verified on Windows 11), and an ARGB visual has to be asked for the same
  // way. So the mode is chosen here, once, and the page decides how much of it
  // to use: while the theme's transparency is 0 the page paints itself fully
  // opaque and the app looks exactly like a solid window.
  glassMode = glassKind();

  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 940,
    minHeight: 640,
    // A see-through page needs a window with nothing of its own painted behind
    // it. macOS is the exception: Electron only gives the vibrancy view its
    // transparent background when backgroundColor is left unset entirely.
    ...(glassMode === 'vibrancy' ? {} : { backgroundColor: glassMode ? '#00000000' : OPAQUE_BG }),
    ...(glassMode === 'acrylic' ? { backgroundMaterial: 'acrylic' } : {}),
    ...(glassMode === 'vibrancy' ? { vibrancy: 'under-window', visualEffectState: 'followWindow' } : {}),
    ...(glassMode === 'transparent' ? { transparent: true } : {}),
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
    // Electron 36 replaced the (event, level, message) arguments with a single
    // event object carrying named fields; accept either shape.
    mainWindow.webContents.on('console-message', (e, level, message) => {
      const lvl = typeof level === 'number' ? level : ({ error: 3, warning: 2 }[e && e.level] || 0);
      const msg = message != null ? message : (e && e.message);
      if (lvl >= 2) { hadError = true; console.error('[renderer]', msg); }
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

// Window transparency (theme panel): 0 = solid, 90 = as see-through as it gets.
// The window itself is never faded — that would wash out the panels and the
// text with it. Instead the page paints a see-through background (the renderer
// lowers --page-alpha) and the OS shows what is behind the window: Windows 11
// frosts it with the acrylic backdrop, macOS with vibrancy, and Linux simply
// lets it through, blurred only if the user's compositor does that. All this
// handler does is report which of those the renderer may count on.
ipcMain.handle('win:setTransparency', (_e, value) => {
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false };
  let v = Number(value);
  if (!isFinite(v)) v = 0;
  v = Math.max(0, Math.min(90, v));
  try { mainWindow.setOpacity(1); } catch (_) {} // undo the old whole-window fade
  // The mode itself was decided when the window was created; this only tells
  // the renderer how far it may go see-through, so a machine without the
  // effect keeps a solid page instead of a black hole.
  if (!glassMode) return { ok: true, transparency: 0, material: 'unsupported' };
  // Windows and macOS frost the desktop themselves; on Linux we have to ask.
  if (glassMode === 'transparent') setKdeBlur(v > 0);
  const blurred = glassMode === 'transparent' ? kdeBlurOn : true;
  return { ok: true, transparency: v, material: glassMode, blurred };
});

/* ------------------------- IPC: meta ------------------------- */
ipcMain.handle('app:meta', () => ({
  brand: BRAND,
  version: app.getVersion(),
  platform: process.platform,
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
