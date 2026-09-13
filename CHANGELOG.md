# Changelog — Sorvia BotSwarm

This file documents **the current release only**. It is rewritten from scratch
on every version bump, so what you read here always matches the app you're running.

_Sorvia Development Solutions by HugeFiz_

---

## v1.2.5

### Added

- **New scenario steps**
  - **Go to coords** — pathfind to a specific `X / Y / Z`.
  - **Click chest/menu** — wait for a container/GUI to open, then click a given slot.
  - **Reconnect** — the bot leaves the server and rejoins after a set delay, then runs its
    scenario from the top. For testing join churn, login queues and per-join plugin work.
    It works whether or not Resilience is on, because adding the step is an explicit choice.
- **`{coordinates}` in chat steps** — `{coordinates}` (or `{coords}`) posts the bot's position
  at the moment the line is sent; `{x}`, `{y}`, `{z}` work as single axes.
- **Live Update button** — apply scenario/setting changes to a running test **without
  disconnecting** the bots: scenario loops restart with the new steps, the duration timer is
  rescheduled, and the bot count scales up or down in place.
- **Theme panel** (◐ in the title bar) — accent colour (presets or custom), background colour,
  **panel transparency**, **window transparency** and an animated-background toggle, all saved
  with your settings.
  - **Window transparency** turns the app's background into **frosted glass**: the desktop behind
    shows through, blurred by Windows, while panels, buttons and text stay readable — the look a
    translucent terminal has. Slide for more glass; it never goes fully clear. The window keeps a
    native frame with its title bar hidden (the app still draws its own), because Windows can only
    paint a frosted backdrop into a framed window. Needs Windows 11 22H2+; elsewhere the window
    stays solid and the console says so.
- **Animated theme switching** — theme colours are registered CSS `@property` colours, so a
  change **fades** across panels, gradients, borders, glows, shadows and the page background
  instead of snapping. Hover/focus feedback stays instant.
- **Proxy toggle (placeholder)** — under Resilience, disabled, marked *soon*.
- **Resource packs are confirmed without downloading** — bots answer the pack request with the
  real client status sequence (**accepted → downloaded → successfully loaded**) without fetching
  the file, so servers that hold every joining player on a loading screen until the pack is
  confirmed let the swarm in, and no bot burns bandwidth or RAM on a file it will never render.
- **Folia** is a first-class server type in the Analysis tab, with regionised-threading advice.
- **Chunk-load verification** — after joining, the first bot reports how many chunk columns the
  server actually sent for the requested render distance.
- **Complete removal option in the uninstaller** — the first uninstall page offers
  *"Complete removal (also delete settings and all app data)"*. Left unticked (the default, and
  what a silent uninstall does) your settings survive a reinstall; ticked, the settings folder,
  cached data, registry entries and leftover shortcuts all go.

### Changed / Fixed

- **A chat-only scenario no longer freezes the app.** Steps like chat finish instantly, so a
  loop made only of them spun the event loop with no breathing room — the whole app stopped
  responding. Every scenario lap now takes at least a second, which also stops the bots from
  spamming themselves into a kick.
- **Starting a big swarm no longer freezes the app either.** With the join interval at `0`, all
  the bots were created in one synchronous burst — hundreds of sockets and version lookups back
  to back, with the UI locked up until it finished. The swarm still lands within a moment, but
  the loop now gets a breath every few bots (live scale-ups too).
- **Closing the app really closes it.** The process could linger with no window after the window
  was closed — invisible, holding its files, and then the installer couldn't replace them
  ("Sorvia BotSwarm cannot be closed"), so an update silently kept the old version. Shutdown now
  gives teardown a moment and then exits for certain.
- **Roam and Go-to-coords actually get around obstacles now.** Three real causes, all fixed:
  - Goals no longer pin an exact height. A random roam target (or a far waypoint) was given the
    bot's *current* Y, so any hill, tree or staircase made the goal unreachable and the bot just
    stood there. Legs now use an XZ goal; only the final Go-to target keeps its exact Y, and it
    falls back to looser goals before giving up.
  - Parkour and sprinting are back on — they're what lets a bot hop a 1-block ledge or cross a
    gap. The path shortcut (which is known to strand bots on obstacles) is off.
  - The search budget is no longer starved: `thinkTimeout` is wall-clock, so tiny per-tick slices
    made bots time out halfway around a tree. Slices and timeouts now scale together.
- **Movement is smooth at scale, and the panel stays responsive.** Pathfinding is CPU-bound and
  shares one thread with every bot's physics tick, so a swarm searching at once stalled the event
  loop — bots stuttered and teleported, pings spiked. Now the CPU budget scales with the swarm:
  up to 25 bots get the library's full budget (full obstacle avoidance), and larger runs cap how
  many bots may search at once and how long each slice runs. Bots also walk in short legs inside
  the chunks the server actually sent, so they never path into unloaded terrain and get yanked
  back, and a bot that ends a leg where it started gets a nudge (turn, jump, walk) to free itself.
- **The console keeps up with a big swarm** — above 10 bots only a few slots narrate their
  movement steps, and the UI drops (and counts) log lines it can't render in time.
- **Every accent colour follows the theme.** Button glows, focus rings, chip hovers, badges and
  panel tints were hard-coded orange and stayed orange after a theme change; 56 of them are now
  derived from the accent, along with a readable text colour picked for light or dark accents.
- **Max bots raised to 1000**; **max duration raised to 1440 minutes (24 h)**.
- **Join interval:** `0` = all bots at once, `> 0` = one-by-one spaced by that many seconds.
- **The AI toggle is gone** — roam always avoids obstacles, water/lava and big cliffs.
- **Single instance** — launching again focuses the open window.
- Stopping a test no longer crashes the physics tick (`bot.quit()` instead of nulling live bot
  internals); per-bot data is released and GC'd on stop.
- The version dropdown lists only versions the engine can actually connect with, plus
  **Auto (detect)**.

### Known requirements

- **Window transparency** needs Windows 11 22H2 or newer — Windows itself paints the frosted
  backdrop. On anything older the window stays solid and the console explains why.
- Close the app before installing an update. If an installer ever reports that the app "cannot be
  closed", end any leftover *Sorvia BotSwarm* process first, or the update will keep the old files.

### Safety

Unchanged, and staying that way: **no protection-bypass logic**, an ownership confirmation is
required before a run, the 1000-bot / 1440-minute caps are hard, and bots log in with honest
offline-auth sessions under an identifying name prefix. This is a load tester for a server
**you own**.
