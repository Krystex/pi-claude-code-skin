# pi → Claude Code skin

A Pi package that restyles the interactive agent to look like the reference screenshot
(`claudecode.png`): pixel-invader header, `|` banner lines, right-aligned hint above the
input, a `❯` prompt between full-width rules, a `▸▸ mode (shift+tab to cycle)` footer, and a
clay/charcoal palette with a gray user-message bar.

```text
██          ██
  ██████████████████    Claude Code  v1.0.3
██████████████████████  Qwen: Qwen3.8 27B · Claude Pro
██████████████████████  ~/Documents/Projects/pi-extension
████    ██████    ████
██████████████████████
  ██████████████████
    ██          ██
  ████          ████

| Claude Code skin for pi
| /claude-code off restores pi's own header, footer, and editor

                                        shift+tab cycles thinking · ctrl+p cycles models · ctrl+c clears
────────────────────────────────────────────────────────────────────────────────────────────────────────
❯
────────────────────────────────────────────────────────────────────────────────────────────────────────
▸▸ medium mode (shift+tab to cycle) · my-model · 12% ctx                                    ↑2.2k ↓22 · $0.001
```

## Layout

```
extensions/claude-code.ts   the skin (header, footer, hint widget, editor prompt, spinner, theme)
themes/claude-code.json     the palette (all colors live here)
package.json                pi package manifest + dev scripts
```

## Run it

**One-off (no install):**

```bash
npm run dev            # pi --theme ./themes/claude-code.json -e ./extensions/claude-code.ts
```

**Everywhere (recommended):**

```bash
pi install .           # or: npm run install-local
```

The skin activates the `claude-code` palette itself on every session start, as an in-memory
theme instance, so your `/settings` → Theme choice is never rewritten. Want it permanent?
Select `claude-code` in `/settings` (or set `"theme": "claude-code"`).

**Without copying anything,** point your user settings at this folder
(`~/.pi/agent/settings.json`):

```json
{
  "extensions": ["~/Documents/Projects/pi-extension/extensions/claude-code.ts"],
  "themes": ["~/Documents/Projects/pi-extension/themes/claude-code.json"],
  "theme": "claude-code"
}
```

**Project only:** put the two resource dirs under `.pi/` (`.pi/extensions/`, `.pi/themes/`)
or install with `pi install . --local`; project resources load after trust is granted.

### "I don't see claude-code in /settings"

The picker only lists themes pi actually loaded. A theme sitting in this folder is invisible
unless one of the options above is in place:

| Situation | Theme in the picker? |
| --- | --- |
| `pi` started normally, nothing installed | no |
| `pi --theme ./themes/claude-code.json ...` | yes, for that run |
| `pi install .` from this folder (what's configured now) | yes, everywhere |
| `extensions`/`themes` paths in `~/.pi/agent/settings.json` | yes, everywhere |
| copied to `~/.pi/agent/themes/` or `.pi/themes/` | yes |

Also note that `/settings` shows the *saved* theme (yours is `system`) even while the skin
paints `claude-code` colors, because the skin applies the palette in memory and never writes
that setting. Pick `claude-code` in the list if you want it even when the skin is off.

## Controls

| Command | Effect |
| --- | --- |
| `/claude-code on` | apply header, footer, hint, editor prompt, spinner, theme |
| `/claude-code off` | restore pi's built-in header, footer, editor, and indicators |
| `/claude-code status` | report the current state |

`enabledByDefault: false` in `CONFIG` starts pi with the normal look instead.

## What maps to what

| Screenshot element | Mechanism |
| --- | --- |
| invader logo, `Claude Code  v…`, `model · plan`, `~/cwd` | `ctx.ui.setHeader()` custom component |
| `| Your voice can help guide AI` | `CONFIG.banner`, rendered by the same header component |
| `Image in clipboard · ctrl+v to paste` | `ctx.ui.setWidget(key, factory, { placement: "aboveEditor" })` |
| `❯ █` between rules | `ctx.ui.setEditorComponent()` + a `CustomEditor` subclass that re-renders the borders at full width and prefixes the first content line |
| `› hi there!` on the gray bar | `pi.registerMarkdownTransformer()` — display-only, the model and session file keep your original text |
| `▸▸ auto mode on (shift+tab to cycle)` | `ctx.ui.setFooter()` + `pi.getThinkingLevel()` (shift+tab is pi's `app.thinking.cycle`) |
| `Churned for 1s · done 22:19` | `ctx.ui.setWorkingMessage("Churning")` + `setWorkingIndicator({ frames })` |
| gray user-message bar, clay accents, dim grays | `themes/claude-code.json` (`userMessageBg`, `accent`, `dim`, `md*`, `syntax*`) |

## Customizing

* **Words/identity** — `CONFIG` at the top of `extensions/claude-code.ts`: `appName`,
  `version`, `planLabel`, `banner`, `hint`, `prompt`, `workingMessage`, `spinnerFrames`,
  `messagePrefix`.
* **Transcript prefixes** — `CONFIG.messagePrefix` maps each message kind (`user`,
  `assistant`, `assistant-thinking`) to a glyph. `user: "›"` is on; set `assistant: "●"` for
  the screenshot's bullet. Messages whose first line is a block construct (code fence, list,
  heading, quote, table, indented code) are left untouched so their markdown stays valid.
* **Colors** — only `themes/claude-code.json`. Everything is a `vars` entry (`clay`,
  `panelHi`, `grayDim`, …), so changing `"clay": "#d97757"` re-skins logo, prompt accents,
  bullets, and borders at once. Hex, `oklch()`, `okhsl()`, 256-color indices, and `""`
  (terminal default) are all accepted.
* **Layout details** — the header/footer/hint components use pi's theme tokens
  (`accent`, `muted`, `dim`, `warning`, `border`) rather than literal colors, so they follow
  whatever palette is active and rebuild correctly on `/reload` and theme switches.

## Development

```bash
npm run check          # tsc --noEmit against the host-provided pi types
```

`pi install .` registers this folder as a *local* package source — pi loads the files in
place, it does not copy them. Edit `extensions/claude-code.ts` or
`themes/claude-code.json`, then `/reload` (or restart pi) to pick the change up.

Stop loading it with `pi remove ~/Documents/Projects/pi-extension`.

Reload the skin inside a running session with `/reload` (or `/claude-code off` then `on`).
The logo header is printed once at startup, so `/reload` is what redraws it after a toggle.
`@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, and `typescript` are
dev-only: pi supplies the host packages to extensions at runtime, and they are declared as
`peerDependencies` so nothing gets bundled.

## Known differences from the screenshot

* The logo header is printed once at startup, so `/claude-code on` mid-session restores
  everything except the header — run `/reload` (or start a session) to redraw it.
* pi pads the user-message bar by one column, so `›` sits at column 2 rather than column 1.
* The footer reports pi's real state (thinking level, branch, model, context %, tokens,
  cost) rather than agent counts, and `shift+tab` genuinely cycles thinking levels.
* The header shows pi's version and your current model/provider, not a fixed product name —
  edit `CONFIG` if you want the literal strings from the screenshot.
