<div align="center">

<img src="assets/icon.png" width="128" alt="Sorvia BotSwarm" />

# Sorvia BotSwarm

### Push your Minecraft server to its limit — then find out exactly what to fix.

Connect up to **1000 bots**, run them through scripted scenarios, watch the server bend.
Then paste your **Spark** report and get a ranked list of what is actually slowing you down.

<br />

![version](https://img.shields.io/badge/version-1.2.6-ff7a18?style=for-the-badge)
![license](https://img.shields.io/badge/license-MIT-46d18a?style=for-the-badge)
![platform](https://img.shields.io/badge/Windows%20%C2%B7%20macOS%20%C2%B7%20Linux-3d8bff?style=for-the-badge)

![electron](https://img.shields.io/badge/Electron-44-47848F?style=flat-square&logo=electron&logoColor=white)
![mineflayer](https://img.shields.io/badge/mineflayer-4-ffb300?style=flat-square)
![minecraft](https://img.shields.io/badge/Minecraft-up%20to%2026.1-62B47A?style=flat-square)
![i18n](https://img.shields.io/badge/UI-T%C3%BCrk%C3%A7e%20%C2%B7%20English-b46bff?style=flat-square)

<br />

<img src="screenshots/02-test.png" width="900" alt="Sorvia BotSwarm — Test tab" />

<sub>*Sorvia Development Solutions by HugeFiz*</sub>

</div>

---

> ## ⚠️ For your own servers only
>
> This tool has **no protection-bypass logic** of any kind. It makes honest client connections
> with identifiable bot names; **you** are the one who turns off your *own* server's anti-bot and
> per-IP limits for the duration of a test.
>
> The app asks you to confirm ownership before **every** run, caps the swarm at **1000 bots**, and
> hard-limits any test to **1440 minutes (24 h)**. Those limits are not configurable.

---

## 🎯 What you get

<table>
<tr>
<td width="50%" valign="top">

### 🧪 Test tab

Build a swarm, give it a script, press start.

- Up to **1000 bots**, joining one at a time so nothing freezes
- **Scenario tree** you assemble by hand — drag, or use the ▴ ▾ buttons
- **Undo / redo** with <kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Y</kbd>
- **Live Update** — change the script mid-test without dropping a single bot
- Real pathfinding: bots hop ledges, cross gaps, route around trees
- Live console, batched so 1000 bots can't drown the UI

</td>
<td width="50%" valign="top">

### 📊 Analysis tab

Stop guessing which plugin is eating your TPS.

- **Ping** your server: version, type, players, latency, MOTD
- Paste a **`/spark profiler` link** — the app downloads and decodes the whole report
- See the **hottest methods** by self-time, with bars
- **Severity-ranked advice** (CRITICAL → TIP), each with a copy-paste config snippet
- Reads live **entity counts** and your exported `view-distance` / `simulation-distance`

</td>
</tr>
</table>

---

## 🧱 Scenario steps

Stack these in any order and loop the list to sustain load.

| | Step | What the bot does |
|:--:|---|---|
| ⏱ | **Wait** | Stand still for N seconds. |
| 💬 | **Chat** | Send a message or command. `{coordinates}` (or `{coords}`, `{x}`, `{y}`, `{z}`) is replaced with the bot's live position. |
| 🧭 | **Roam** | Wander inside a radius, routing around obstacles and avoiding water, lava and long drops. |
| ⤴ | **Jump** | Jump repeatedly for N seconds. |
| 👁 | **Look around** | Sweep the camera around for N seconds. |
| 🎯 | **Go to coords** | Pathfind to an exact `X / Y / Z`. |
| 📦 | **Click chest/menu** | Wait for a container or GUI to open, then click a given slot. |
| 🔌 | **Reconnect** | Leave the server and rejoin after a delay — for testing join churn, login queues and per-join plugin work. |

---

## 🚀 Quick start

```bash
npm install
npm start
```

That's it for a dev run. For a real install, build a package:

| Target | Command | You get |
|---|---|---|
| 🪟 **Windows installer** | `npm run dist:win` | `dist/Sorvia-BotSwarm-1.2.6-setup.exe` |
| 🪟 **Windows portable** | `npm run dist:win-portable` | `dist/Sorvia-BotSwarm-1.2.6-portable.exe` |
| 🐧 **Linux** | `npm run dist:linux` | `dist/Sorvia-BotSwarm-1.2.6.AppImage` |
| 🍎 **macOS** | `npm run dist:mac` | `dist/Sorvia-BotSwarm-1.2.6.dmg` |

On Windows there is a one-click helper too: run **`build-win.bat`**.

### Requirements

| | |
|---|---|
| **To run** | Windows 10+, macOS Ventura (13)+, or a current Linux distribution.<br /><sub>Electron 44's minimums. On an older system, the last release that supports it is **v1.2.5**.</sub> |
| **To build** | [Node.js](https://nodejs.org) LTS — v20+ recommended — and npm. |

<details>
<summary><b>Build notes & gotchas</b></summary>

<br />

**Windows — installer**

A clean English setup wizard that shows a **license / terms** page you must accept, installs
**per-user** (no admin prompt), adds a **Start-menu** entry, and on the final page lets you
*choose* — via checkboxes, nothing forced — whether to **launch the app** and **create a desktop
shortcut**. Once installed it opens instantly on every launch.

> If the build fails with **"cannot create symbolic link"**: electron-builder unpacks a signing
> archive containing symlinks. Either run the terminal / `build-win.bat` **as Administrator**, or
> enable **Windows Developer Mode** (*Settings → Privacy & security → For developers*).

**Windows — portable**

Double-click, no install, no admin. The first launch unpacks to a fixed folder
(`%TEMP%\SorviaBotSwarm`) and reuses it, so only that first launch takes a few seconds. The
installer above is still faster.

**Linux — AppImage**

```bash
chmod +x dist/Sorvia-BotSwarm-1.2.6.AppImage
./dist/Sorvia-BotSwarm-1.2.6.AppImage
```

Hitting a FUSE error on a newer distro? Run with `--appimage-extract-and-run`, install
`libfuse2`, or just use `npm start`.

**Cross-building** (e.g. a Windows `.exe` from Linux) needs Wine and isn't recommended — build
each OS's package on that OS, or in CI.

</details>

---

## 🛠️ Before your first test

On the server **you own**:

- [ ] `online-mode=false` in `server.properties` — bots use offline auth
- [ ] Remove any **per-IP account limit** — every bot arrives from one IP
- [ ] Disable **anti-bot** protection for the duration of the test
- [ ] Install **[Spark](https://spark.lucko.me)** if you want the advisor (`/spark tps`, `/spark health`, `/spark profiler`)

Then, in the app:

**Load test** → server IP / port / version (or leave it on **Auto**) → bot count, join interval,
chunks, duration → build your scenario tree → tick the ownership confirmation → **Start**.
Watch the live console; the run stops itself at the duration limit.

**Analyze** → **Analysis** tab → **Get Info** to ping → paste a `/spark profiler` link *or* the
text of `/spark tps` + `/spark health` → **Read** → **Generate Advice**.

---

## 📸 More screenshots

<table>
<tr>
<td width="50%"><img src="screenshots/03-analysis.png" alt="Analysis tab" /><br /><sub><b>Analysis tab</b> — ping, inputs, ranked advice</sub></td>
<td width="50%"><img src="screenshots/04-profiler.png" alt="Spark profiler report" /><br /><sub><b>Spark profiler</b> — a link in, a full report out</sub></td>
</tr>
<tr>
<td colspan="2" align="center"><img src="screenshots/01-language.png" width="70%" alt="First-run language picker" /><br /><sub><b>First run</b> — pick your language once</sub></td>
</tr>
</table>

---

## ✨ Everything else

<details>
<summary><b>🎨 Themes & the frosted-glass window</b></summary>

<br />

A theme panel (the ◐ in the title bar) gives you an **accent colour** (presets or a custom
picker), a **background colour**, **panel transparency**, **window transparency** and an
animated-background toggle. Changing a theme **fades** across the entire UI — panels, gradients,
borders, glows, button shadows — instead of snapping.

**Window transparency** turns the app's background into frosted glass: what is behind the window
shows through while panels, buttons and text stay perfectly readable, the way a translucent
terminal looks. Slide for more glass; it never goes fully clear.

| Platform | How it frosts |
|---|---|
| 🪟 **Windows 11 22H2+** | The OS acrylic backdrop |
| 🍎 **macOS** | Native vibrancy |
| 🐧 **KDE Plasma** | The app asks KWin to blur behind the window |
| 🐧 **Other Linux** | Genuinely see-through, but *not* blurred — that call belongs to your compositor (e.g. picom's `blur-background`). The console says so once. |

Where none of it is available the window simply stays solid and the console explains why.

</details>

<details>
<summary><b>⚙️ Swarm behaviour — joins, movement, resilience</b></summary>

<br />

- **Sequential join** — bots connect one at a time, each waiting until the previous one is in, so
  the load spreads and the UI never locks up. The **join interval** adds extra spacing on top;
  set it to `0` and they all pile in at once.
- **Resilience** — bots auto-respawn on death (restarting their scenario from the top) and
  reconnect with exponential backoff when a connection drops.
- **Movement that scales.** Pathfinding is CPU-bound and shares a thread with every bot's physics,
  so the budget scales with the swarm: up to 25 bots search with the full budget and behave like a
  single well-behaved client; bigger runs cap how many bots search at once and how long each
  search slice runs, so the shared loop never stalls. Bots walk in short legs **inside the chunks
  the server actually sent** — never into unloaded terrain — and nudge themselves free when a leg
  leaves them stuck.
- **Resource packs are confirmed without downloading.** Bots report the pack as
  *accepted → downloaded → loaded*, so servers that hold every player on a loading screen until
  the pack is confirmed let the swarm through — without 1000 bots fetching a file none of them
  will ever render.
- **Chunk-load verification** — after joining, the first bot reports how many chunk columns the
  server actually sent for the render distance you asked for.

</details>

<details>
<summary><b>🖥️ App conveniences</b></summary>

<br />

- **First-run language picker** (shown in English), remembered afterwards. Full **TR / EN** UI.
- **Version list refreshes from Mojang** on every launch, intersected with the versions the bot
  engine can genuinely connect to — so new releases show up without an app update, and the
  dropdown never offers you something that will fail.
- **Single instance** — launching again focuses the window you already have open.
- **Animated loading screen**, animated background, embedded icon.
- **Proxy** — a placeholder toggle under Resilience, marked *soon*.
- **Uninstaller** offers a **Complete removal** option that also wipes settings and app data.
  Left unticked (the default), a reinstall picks your theme, scenarios and server back up.

</details>

<details>
<summary><b>🧩 What it's built on</b></summary>

<br />

| Library | Job |
|---|---|
| **[Electron](https://www.electronjs.org/) 44** | Desktop shell + UI |
| **[mineflayer](https://github.com/PrismarineJS/mineflayer)** | The bot client engine — loaded lazily on first test, runs in the main process |
| **[mineflayer-pathfinder](https://github.com/PrismarineJS/mineflayer-pathfinder)** | Obstacle-avoiding movement behind **Roam** and **Go to coords** (always on) |
| **[minecraft-protocol](https://github.com/PrismarineJS/node-minecraft-protocol)** | Server ping, and the authoritative list of connectable versions |
| **[protobufjs](https://github.com/protobufjs/protobuf.js)** | Decodes Spark profiler reports |

The UI is plain HTML / CSS / JS — no framework.

</details>

<details>
<summary><b>📁 Where settings live</b></summary>

<br />

Language, form values, scenarios and your theme are stored per-user, well away from your desktop:

| OS | Path |
|---|---|
| 🪟 Windows | `%APPDATA%\Sorvia BotSwarm\settings.json` |
| 🐧 Linux | `~/.config/Sorvia BotSwarm/settings.json` |
| 🍎 macOS | `~/Library/Application Support/Sorvia BotSwarm/settings.json` |

</details>

<details>
<summary><b>🗂️ Project structure</b></summary>

<br />

```
sorvia-botswarm/
├─ src/                  # Electron main process (Node, privileged)
│  ├─ main.js            # window, IPC, settings, per-platform glass setup
│  ├─ preload.js         # the secure contextBridge API — the only renderer↔main channel
│  ├─ bot-manager.js     # the swarm engine: joins, scenarios, respawn, reconnect, caps
│  ├─ versions.js        # connectable versions ∩ Mojang manifest
│  ├─ advisor.js         # Spark text parsing + rules-based advice
│  ├─ spark-fetch.js     # downloads + decodes /spark profiler reports
│  └─ smoke.js           # headless sanity test (npm run smoke)
├─ renderer/             # UI (browser context, no Node access)
│  ├─ index.html         # loader, splash, tabs, scenario tree, analysis
│  ├─ styles.css         # theme tokens, glass, animations, layout
│  ├─ app.js             # UI logic, IPC calls, i18n, console, undo/redo
│  └─ i18n.js            # TR / EN strings
├─ assets/               # icon.svg / icon.png / icon.ico
├─ build/                # installer resources (eula, NSIS script, bitmaps)
├─ screenshots/          # the images in this README
├─ build-win.bat         # one-click Windows build helper
├─ CHANGELOG.md          # what changed in the current release
├─ LICENSE
└─ README.md
```

</details>

---

## ⚠️ Notes & limitations

- **Minecraft versions** — the engine connects up to the newest version its libraries support
  (currently **26.1**). For a newer server (e.g. **26.2**), either install **ViaVersion +
  ViaBackwards** and pick 26.1 in the app, or run `npm update` once PrismarineJS ships support —
  new versions then appear in the dropdown by themselves.
- **Reading a profiler link needs internet.** The app fetches
  `https://spark-usercontent.lucko.me/<code>`; everything else runs locally. Heap-only and
  health-only links can't be used for advice.
- **Advice text is English** (config keys are universal anyway); the UI is TR / EN.
- **Movement feels heavy?** Lower the roam radius or the bot count — pathfinding shares a thread
  with every bot's physics.
- **Linux without desktop effects** — if a see-through window ends up unreadable, quit the app and
  start it once with `--opaque` (or set `SORVIA_OPAQUE=1`) and it comes up solid. Quit the running
  copy first: a second launch only focuses the open window.
- **Uninstalling while the app is running** can leave old files behind — close it first (the
  installer will ask too).

---

<div align="center">

**MIT** © Sorvia Development Solutions by HugeFiz — see [LICENSE](LICENSE)

Changes in this release: [CHANGELOG.md](CHANGELOG.md)

<sub>Built for people who own their servers.</sub>

</div>
