# Changelog — Sorvia BotSwarm

This file documents **the current release only**. It is rewritten from scratch
on every version bump, so what you read here always matches the app you're running.

_Sorvia Development Solutions by HugeFiz_

---

## v1.2.6

### Fixed

- **Window transparency no longer disappears after maximising.** Maximising the window and then
  restoring it down left the app flat and solid, with no glass, until it was restarted. The cause
  was not the app's own settings: while a window with a hidden title bar is maximised, the browser
  engine collapses the strip of "glass" that Windows paints its frosted backdrop into, and on the
  way back down it never restored it — so the backdrop was still switched on, it just had nowhere
  left to show. Nothing could repair it from inside a running window; every obvious remedy was
  tried and measured, and none of them did anything.

  The real fix was upstream, so **the app now runs on a much newer engine version** (see below).
  Maximising, restoring, double-clicking the title bar, Win+Up, snapping and full screen all work
  exactly the way Windows intends them to — animations included — and the frosting survives all of
  them. The window is now frosted *while* maximised too, which it never was before.

### Changed

- **Runs on a current engine.** The app moved from Electron 31 to Electron 44 — four years of
  browser-engine and Node updates in one step. This is what fixes the transparency-after-maximise
  problem above, and it brings the usual security and performance work with it. Your settings,
  scenarios and saved theme carry over untouched; the installer is a little larger.

  **One thing to check before updating:** the newer engine needs **Windows 10 or newer**, or
  **macOS Ventura (13) or newer**. On Linux, a current distribution. If you are on an older
  system, stay on v1.2.5 — everything else in this release is cosmetic by comparison.

  The bot engine itself was not touched, but it now runs on the newer bundled Node. Connecting,
  running scenarios and stopping a swarm were re-checked against the packaged build before this
  release; if you do hit anything odd during a test run, that change is the first suspect.

### Added

- **Window transparency now works on Linux and macOS**, not only on Windows 11.
  - **macOS** gets a genuinely frosted window through the system's own vibrancy effect, the same
    way Windows gets one through acrylic. The app also stops adding its own blur on top of it
    (which made the frost render twice and ghost), leaves room in its title bar for the traffic
    lights and hides its own window buttons there, since macOS already provides them.
  - **Linux** gets a truly see-through window, and the slider works straight away — no restart,
    no message telling you to reopen the app. On **KDE Plasma** it is properly frosted: the app
    asks KWin to blur what is behind the window, so it looks the same as it does on Windows.
    On other desktops the window is still see-through but sharp, because blurring behind a window
    is the compositor's decision and not something an app can do for itself; the console says so
    once rather than leaving you guessing. If you are on a session with no desktop effects at all
    and the background ends up unreadable, quit the app and start it once with `--opaque` (or
    `SORVIA_OPAQUE=1`) and it comes up solid.
  - Where the effect genuinely isn't available, the console now says which of the three it would
    need, instead of naming Windows only.
- **Undo / redo for scenarios** — **↶ / ↷** next to *Repeat in a loop*, or **Ctrl+Z** and
  **Ctrl+Y** (**Ctrl+Shift+Z** works too). Everything you do to the scenario list is covered:
  adding a step, deleting one, reordering it by drag or by button, and editing any of its fields.
  Typing counts as one change, not one per keystroke, so a chat message takes a single undo to
  walk back. Inside a text box Ctrl+Z still does what it always did — undo your typing — and the
  scenario history follows along. The buttons grey out when there is nothing left to undo or redo.
  Up to 100 changes are remembered, and the scenarios you had when the app opened are the floor:
  you can't undo your way past them.
- **Move buttons on scenario steps.** Every step's grip column now has a small **▴ / ▾** pair above
  and below the drag dots — click (or tab to them and press Enter) to move a step one place up or
  down. Drag & drop still works exactly as before; this is the same thing without the dragging.
  The buttons sit quietly at low contrast until you hover a step, the first and last step have the
  direction that would do nothing greyed out, and the step you just moved pulses so you can follow
  where it went.
- The delete button and the new move buttons now have proper tooltips in your language.

### Housekeeping

- Version bumped to **1.2.6** everywhere (app, installer output names, documentation).
- No behaviour changes to the bot engine, the scenarios, the Analysis tab or the caps
  (**1000 bots**, **1440 minutes**) — apart from the engine bump above, this release is window
  behaviour and UI only.
