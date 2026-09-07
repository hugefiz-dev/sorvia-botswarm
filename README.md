<div align="center">

<img src="assets/icon.png" width="120" alt="Sorvia BotSwarm" />

# Sorvia BotSwarm

**Minecraft server bot load-tester & optimization advisor**

*Sorvia Development Solutions by HugeFiz*

</div>

---

Sorvia BotSwarm connects a configurable swarm of bots to a Minecraft server **you own**,
runs scripted scenarios (walk, chat, jump, look, roam), and helps you measure and improve
your server's performance. It also reads your **Spark** output and generates prioritized
optimization advice.

> ⚠️ **For your own servers only.**
> This tool has **no protection-bypass logic**. It performs honest client connections; you
> disable your *own* server's anti-bot / per-IP limits for the test. The app requires an
> ownership confirmation before every run, caps the swarm at **100 bots**, and hard-limits
> any test to **60 minutes**.

---

## 📸 Screenshots

| First-run language picker | Test tab |
|---|---|
| ![language](screenshots/01-language.png) | ![test](screenshots/02-test.png) |

| Analysis tab |
|---|
| ![analysis](screenshots/03-analysis.png) |

| Spark profiler link → full report analysis |
|---|
| ![profiler](screenshots/04-profiler.png) |

---

## ✨ Features

### Test tab
- Connect bots by **IP / port / version** — up to **100** (hard cap).
- **Join interval** in seconds (`0` = all at once).
- **Chunk / render distance** per bot.
- **Duration** up to **60 min** (fixed ceiling to prevent misuse).
- **Ownership confirmation** gate — the test won't start until you confirm.
- **AI** — bots avoid obstacles while roaming (via `mineflayer-pathfinder`).
- **Resilience** — bots auto-respawn on death (restarting their scenario) and reconnect
  with exponential backoff if a connection drops.
- **Scenario tree** — add steps in order and drag to reorder: **Wait, Chat (command),
  Roam (radius + time), Jump, Look around**. Loop the whole list to sustain load.
- **Built-in console** — logs are batched for smooth UI even with 100 bots.

### Analysis tab
- **Get Info** — pings the server and shows version, detected type
  (Paper / Purpur / Spigot / Fabric / …), player count, latency and MOTD.
- **Spark — paste a profiler link OR text:**
  - Paste a **`/spark profiler` report link** (e.g. `https://spark.lucko.me/xxxxx`) and the app
    **downloads and decodes the report** (gzip protobuf), then extracts:
    - a **Profiler Summary** (server + MC version, TPS, MSPT median/95%/max, CPU, heap RAM,
      players, live entity counts, online-mode),
    - the **Most Resource-Using Tasks** — the hottest methods by self-time, with % bars,
    - the server's **exported config** (view-distance / simulation-distance) — which it
      auto-fills into the inputs.
  - Or paste the **text** of `/spark tps` + `/spark health` and it reads TPS/MSPT/CPU/memory.
- **Generate Advice** — compares server type + resources + Spark data (including the hottest
  method and entity counts) and produces **severity-ranked** (CRITICAL → TIP) optimization
  suggestions, each with a copyable config/JVM snippet.

> Reading a profiler link fetches `https://spark-usercontent.lucko.me/<code>` — the app needs
> internet access for that step (everything else is local).

### General
- **First-run language picker** (English screen), remembered afterward. **TR / EN** UI.
- Modern animated interface, custom bot icon.
- Version list refreshes from **Mojang** on each launch (intersected with the engine's
  supported versions — new releases appear without an app update).
- Settings are saved to a hidden per-user folder (see below).

---

## 🧩 How it works

- **[Electron](https://www.electronjs.org/)** — desktop shell + UI (renderer).
- **[mineflayer](https://github.com/PrismarineJS/mineflayer)** — the bot client engine
  (runs in the main process).
- **[mineflayer-pathfinder](https://github.com/PrismarineJS/mineflayer-pathfinder)** — the
  "AI" obstacle-avoiding movement.
- **[minecraft-protocol](https://github.com/PrismarineJS/node-minecraft-protocol)** — server
  ping for the Analysis tab.

---

## ✅ Requirements

- **[Node.js](https://nodejs.org) LTS** (v18+; v20/22 recommended) and npm.

---

## ▶️ Run from source

```bash
npm install
npm start
```

---

## 📦 Build a standalone app (no install for end users)

First install dependencies once: `npm install`.

### Windows — portable `.exe`
```bash
npm run dist:win
```
Output: `dist/Sorvia-BotSwarm-1.1.0-portable.exe` — double-click, no install, no admin prompt.

> **Startup speed:** a portable exe unpacks itself before the window can appear. This build
> unpacks to a **fixed folder** (`%TEMP%\SorviaBotSwarm`) and reuses it, so only the **first**
> launch takes a few seconds — later launches are fast. For the fastest possible startup on
> every launch, use the installer below.

### Windows — installer (`setup.exe`, fastest launches)
```bash
npm run dist:win-setup
```
Output: `dist/Sorvia-BotSwarm-1.1.0-setup.exe` — installs once (per-user, no admin), then the app
opens instantly every time (nothing to unpack at launch).

> **Windows build note:** electron-builder unpacks a signing archive that contains symlinks.
> If the build fails with *"cannot create symbolic link"*, either run the terminal / `build-win.bat`
> **as Administrator**, or enable **Windows Developer Mode**
> (*Settings → Privacy & security → For developers → Developer Mode: On*). A one-click
> `build-win.bat` is included.

### Linux — `AppImage`
```bash
npm run dist:linux
```
Output: `dist/Sorvia-BotSwarm-1.1.0.AppImage`
```bash
chmod +x Sorvia-BotSwarm-1.1.0.AppImage
./Sorvia-BotSwarm-1.1.0.AppImage
```

### macOS — `.dmg`
```bash
npm run dist:mac
```

> Cross-building (e.g. making the Windows `.exe` on Linux) requires **Wine** and is not
> recommended. Build each OS's package on that OS (or via CI).

---

## 🛠️ Before you test (on your OWN server)

- `online-mode=false` in `server.properties` (bots use offline auth).
- Remove any **per-IP account limit** (all bots come from one IP).
- Disable **anti-bot** protection for the duration of the test.
- Install **[Spark](https://spark.lucko.me)** to use the Analysis advisor
  (`/spark tps`, `/spark health`, `/spark profiler`).

---

## 🚀 Usage

**Load test:** fill server IP/port/version → set bot count, join interval, chunks, duration,
AI, resilience → build your scenario tree → tick the ownership confirmation → **Start**.
Watch the live console and stats; the run stops itself at the duration limit.

**Analyze:** open the **Analysis** tab → **Get Info** to ping the server → run `/spark tps`
and `/spark health` in-game and paste the output → **Read** → **Generate Advice**.

---

## 📁 Settings location

Settings (language + form values + scenarios) are stored per-user, outside your desktop:

| OS | Path |
|---|---|
| Windows | `%APPDATA%\Sorvia BotSwarm\settings.json` |
| Linux | `~/.config/Sorvia BotSwarm/settings.json` |
| macOS | `~/Library/Application Support/Sorvia BotSwarm/settings.json` |

---

## 🗂️ Project structure

```
sorvia-botswarm/
├─ src/
│  ├─ main.js          # Electron main process, IPC, window, settings, ping/advisor IPC
│  ├─ preload.js       # secure contextBridge API
│  ├─ bot-manager.js   # bot swarm engine: spawn, scenarios, respawn, reconnect, caps
│  ├─ versions.js      # Mojang manifest ∩ engine-supported versions
│  ├─ advisor.js       # Spark text parsing + rules-based optimization advice
│  ├─ spark-fetch.js   # download + decode /spark profiler reports (protobuf)
│  └─ smoke.js         # headless sanity test (npm run smoke)
├─ renderer/
│  ├─ index.html       # UI markup (tabs, splash, scenario tree, analysis)
│  ├─ styles.css       # theme + animations
│  ├─ app.js           # UI logic, IPC calls, i18n, console
│  └─ i18n.js          # TR / EN strings
├─ assets/             # icon.svg / icon.png / icon.ico
├─ screenshots/        # images used in this README
├─ build-win.bat       # one-click Windows build helper
├─ package.json
├─ LICENSE
└─ README.md
```

---

## ⚠️ Notes & limitations

- Advice **text** is in English (config keys are universal); the UI is TR/EN.
- The advisor reads either a **`/spark profiler` report link** (downloaded & decoded) or the
  **text** of `/spark tps` + `/spark health`. Health-only and heap report links aren't used for
  advice.
- mineflayer can lag a few weeks behind the newest Minecraft release; `npm update` pulls
  support as it lands.
- AI pathfinding with many bots + large radius is CPU-heavy — lower the bot count/radius or
  turn AI off for heavy load.

---

## 📄 License

MIT © Sorvia Development Solutions by HugeFiz — see [LICENSE](LICENSE).
