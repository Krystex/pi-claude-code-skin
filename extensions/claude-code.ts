/**
 * Claude Code skin for pi.
 *
 * Reshapes pi's interactive UI to match the reference screenshot:
 *   - header: pixel-invader logo + app name, model · plan, cwd, and `|` banner lines
 *   - right-aligned dim hint above the editor
 *   - editor: full-width rules with a `❯` prompt and a block cursor
 *   - footer: `▸▸ <mode> (shift+tab to cycle) · branch · model · ctx%` + token stats
 *   - user messages: `› ` prefix on the gray panel (display-only markdown transform)
 *   - theme: the `claude-code` palette (clay accent, gray user-message bar, warm syntax)
 *
 * Try it from this folder:
 *   pi --theme ./themes/claude-code.json -e ./extensions/claude-code.ts
 *
 * Install it (conventional `extensions/` + `themes/` are auto-discovered):
 *   pi install .
 *
 * Toggle at runtime: /claude-code [on|off|status]
 */

import { homedir } from "node:os";
import {
	CustomEditor,
	VERSION,
	type ExtensionAPI,
	type ExtensionContext,
	type MarkdownTransformContext,
	type ReadonlyFooterDataProvider,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { stripTerminalSequences, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

// --- Configuration -----------------------------------------------------------

const CONFIG = {
	/** Identity shown in the header and terminal title. */
	appName: "π agent",
	/** Version shown next to the name. `${VERSION}` is pi's own version. */
	version: `v${VERSION}`,
	/** Trailing label after the model, like a subscription plan. "" to hide. */
	planLabel: "",
	/**
	 * Theme activated by this skin (pi must be able to discover it). "" to keep the user's.
	 * Applied as an in-memory instance, so your `/settings` theme choice is never overwritten.
	 */
	themeName: "claude-code",
	/** `|` banner lines under the logo. */
	banner: [
		{ color: "accent" as const, text: "Claude Code skin for pi" },
		{ color: "text" as const, text: "/claude-code off restores pi's own header, footer, and editor" },
	],
	/** Dim hint right-aligned above the editor's top rule. "" to hide. */
	hint: "shift+tab cycles thinking · ctrl+p cycles models · ctrl+c clears",
	/** Editor prompt. */
	prompt: "❯",
	/**
	 * Transcript prefixes, drawn on the message panel (`› hi there!`).
	 * Display-only: the model and the session file keep your original text.
	 * Set assistant to "●" for the exact screenshot look; "" disables it.
	 * Messages that start with a block construct (fence, list, heading, quote,
	 * table, indented code) are left alone so their markdown stays valid.
	 */
	messagePrefix: {
		user: "›",
		assistant: "",
		"assistant-thinking": "",
	} as Record<MarkdownTransformContext["messageType"], string>,
	/** Streaming wording, in the spirit of "Churned for 1s". */
	workingMessage: "Churning",
	/**
	 * Pulse frames. Every frame must render exactly one cell wide: Loader builds the
	 * status line as `frame + " "`, so a zero-width frame (e.g. "") shifts "Churning"
	 * one column left and the whole line jitters on every tick. A single-space frame
	 * is fine too when you want the icon to blink away.
	 */
	spinnerFrames: ["·", "✢", "✦", "❇", "✦", "✢"],
	spinnerIntervalMs: 200,
	/** Label for collapsed thinking blocks. */
	thinkingLabel: "Thinking",
	/** Apply the skin as soon as a session starts. */
	enabledByDefault: true,
};

/** Pixel art: `#` is a filled block, drawn 2 cells wide so it reads square. */
const LOGO = [
	"..#.....#..",
	".#########.",
	"###########",
	"###########",
	"##..###..##",
	"###########",
	".#########.",
	"..#.....#..",
	".##.....##.",
];

const LOGO_WIDTH = LOGO[0]!.length * 2;
const TEXT_COLUMN = LOGO_WIDTH + 2;

// --- Helpers -----------------------------------------------------------------

const PROMPT_PREFIX = `${CONFIG.prompt} `;
const PROMPT_WIDTH = visibleWidth(PROMPT_PREFIX);

function padTo(text: string, columns: number): string {
	return text + " ".repeat(Math.max(0, columns - visibleWidth(text)));
}

function isPlainRule(line: string | undefined): boolean {
	return line !== undefined && /^─*$/.test(stripTerminalSequences(line));
}

function shortPath(path: string): string {
	const home = homedir();
	return home && path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

function formatTokens(count: number): string {
	if (count < 1000) return `${count}`;
	if (count < 1_000_000) return `${(count / 1000).toFixed(count < 10_000 ? 1 : 0)}k`;
	return `${(count / 1_000_000).toFixed(1)}m`;
}

function modelLabel(ctx: ExtensionContext | undefined): string {
	const model = ctx?.model;
	if (!model) return "no model";
	const name = model.name || model.id;
	return CONFIG.planLabel ? `${name} · ${CONFIG.planLabel}` : name;
}

function thinkingModeLabel(level: string): string {
	return level === "off" ? "auto mode off" : `${level} mode`;
}

/** Would prefixing this first line break markdown block structure? */
function canPrefixFirstLine(line: string): boolean {
	if (line.trim() === "") return false;
	if (/^ {4}|^\t/.test(line)) return false; // indented code block
	// heading, blockquote, fence, list marker, ordered list, table, raw HTML
	if (/^ {0,3}(#{1,6}\s|>|```|~~~|[-*+]\s|\d{1,3}[.)]\s|\||<)/.test(line)) return false;
	return true;
}

function addMessagePrefix(markdown: string, prefix: string): string {
	if (!prefix) return markdown;
	const newline = markdown.indexOf("\n");
	const firstLine = newline === -1 ? markdown : markdown.slice(0, newline);
	if (!canPrefixFirstLine(firstLine)) return markdown;
	const rest = newline === -1 ? "" : markdown.slice(newline);
	return `${prefix} ${firstLine}${rest}`;
}

// --- Editor: `❯` prompt between full-width rules -----------------------------

class ClaudeCodeEditor extends CustomEditor {
	override render(width: number): string[] {
		const inner = Math.max(4, width - PROMPT_WIDTH);
		const lines = super.render(inner);
		if (lines.length === 0) return lines;

		// The base editor returns [topBorder, ...content, bottomBorder, ...autocomplete].
		// Content count is private but present at runtime; fall back to "everything between borders".
		const cache = this as unknown as { renderedVisibleLineCount?: number };
		const contentCount =
			typeof cache.renderedVisibleLineCount === "number"
				? cache.renderedVisibleLineCount
				: Math.max(0, lines.length - 2);
		const top = lines[0] ?? "";
		const content = lines.slice(1, 1 + contentCount);
		const bottom = lines[1 + contentCount] ?? "";
		const autocomplete = lines.slice(2 + contentCount);

		// Rules are rebuilt at full width; scroll markers ("↑ n more") are kept as rendered.
		const fullTop = isPlainRule(top) ? this.borderColor("─".repeat(width)) : truncateToWidth(top, width, "");
		const fullBottom = isPlainRule(bottom)
			? this.borderColor("─".repeat(width))
			: truncateToWidth(bottom, width, "");

		const out: string[] = [fullTop];
		content.forEach((line, index) => {
			const prefix = index === 0 ? PROMPT_PREFIX : " ".repeat(PROMPT_WIDTH);
			out.push(truncateToWidth(prefix + line, width, ""));
		});
		out.push(fullBottom);
		for (const line of autocomplete) out.push(truncateToWidth(line, width, ""));
		return out;
	}
}

// --- Skin --------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
	let ctxRef: ExtensionContext | undefined;
	let tuiRef: TUI | undefined;
	let enabled = CONFIG.enabledByDefault;
	/** Theme instance to hand back when the skin is switched off. */
	let previousTheme: Theme | undefined;

	const createHeader = (tui: TUI, theme: Theme): Component => {
		tuiRef = tui;
		return {
			invalidate() {},
			render(width: number): string[] {
				const name =
					theme.style(CONFIG.appName, { fg: "text", bold: true }) +
					theme.style(`  ${CONFIG.version}`, { fg: "dim" });
				const textRows: Record<number, string> = {
					1: name,
					2: theme.style(modelLabel(ctxRef), { fg: "muted" }),
					3: theme.style(shortPath(ctxRef?.cwd ?? process.cwd()), { fg: "dim" }),
				};

				const lines: string[] = [""];
				LOGO.forEach((row, index) => {
					const blocks = [...row]
						.map((cell) => (cell === "#" ? "██" : "  "))
						.join("");
					lines.push(truncateToWidth(padTo(theme.fg("accent", blocks), TEXT_COLUMN) + (textRows[index] ?? ""), width));
				});

				lines.push("");
				for (const part of CONFIG.banner) {
					lines.push(truncateToWidth(`${theme.fg("accent", "|")} ${theme.style(part.text, { fg: part.color })}`, width));
				}
				lines.push("");
				return lines;
			},
		};
	};

	const createHintWidget = (tui: TUI, theme: Theme): Component => {
		tuiRef = tui;
		return {
			invalidate() {},
			render(width: number): string[] {
				if (!CONFIG.hint) return [];
				const hint = theme.style(CONFIG.hint, { fg: "dim" });
				return [truncateToWidth(" ".repeat(Math.max(0, width - visibleWidth(hint))) + hint, width)];
			},
		};
	};

	const createFooter = (
		tui: TUI,
		theme: Theme,
		footerData: ReadonlyFooterDataProvider,
	): Component & { dispose(): void } => {
		tuiRef = tui;
		const unsubscribe = footerData.onBranchChange(() => tui.requestRender());
		return {
			dispose() {
				unsubscribe();
			},
			invalidate() {},
			render(width: number): string[] {
				const separator = theme.style(" · ", { fg: "dim" });
				const mode =
					theme.style("▸▸ ", { fg: "warning", bold: true }) +
					theme.style(thinkingModeLabel(pi.getThinkingLevel()), { fg: "warning", bold: true }) +
					theme.style(" (shift+tab to cycle)", { fg: "dim" });

				const middle: string[] = [];
				const branch = footerData.getGitBranch();
				if (branch) middle.push(theme.style(branch, { fg: "muted" }));
				if (ctxRef?.model) middle.push(theme.style(ctxRef.model.id, { fg: "dim" }));
				const usage = ctxRef?.getContextUsage();
				if (usage?.percent != null) middle.push(theme.style(`${Math.round(usage.percent)}% ctx`, { fg: "dim" }));
				for (const status of footerData.getExtensionStatuses().values()) {
					middle.push(status);
				}

				let input = 0;
				let output = 0;
				let cost = 0;
				if (ctxRef) {
					for (const entry of ctxRef.sessionManager.getBranch()) {
						if (entry.type !== "message" || entry.message.role !== "assistant") continue;
						const stats = (entry.message as unknown as { usage?: any }).usage;
						if (!stats) continue;
						input += stats.input ?? 0;
						output += stats.output ?? 0;
						cost += stats.cost?.total ?? 0;
					}
				}
				const right = theme.style(
					`↑${formatTokens(input)} ↓${formatTokens(output)} · $${cost.toFixed(cost < 1 ? 3 : 2)}`,
					{ fg: "dim" },
				);

				const head = middle.length > 0 ? `${mode}${separator}${middle.join(separator)}` : mode;
				const gap = Math.max(1, width - visibleWidth(head) - visibleWidth(right));
				return [truncateToWidth(`${head}${" ".repeat(gap)}${right}`, width)];
			},
		};
	};

	function apply(ctx: ExtensionContext) {
		ctxRef = ctx;

		// Activate the palette as an in-memory instance instead of by name: pi then does not
		// overwrite the user's `theme` setting, and the theme-change callback clears the
		// transcript's cached lines so the `›` prefix shows up (and goes away) immediately.
		if (CONFIG.themeName) {
			const target = ctx.ui.getTheme(CONFIG.themeName);
			if (target) {
				previousTheme ??= ctx.ui.theme;
				ctx.ui.setTheme(target);
			} else {
				ctx.ui.notify(`Theme "${CONFIG.themeName}" is not loaded; keeping the current colors`, "warning");
			}
		}
		if (ctx.mode !== "tui") return;

		const accent = ctx.ui.theme;
		ctx.ui.setHeader(createHeader);
		ctx.ui.setFooter(createFooter);
		ctx.ui.setWidget("claude-code-hint", createHintWidget, { placement: "aboveEditor" });
		ctx.ui.setEditorComponent((tui, theme, keybindings) => new ClaudeCodeEditor(tui, theme, keybindings));
		ctx.ui.setWorkingMessage(CONFIG.workingMessage);
		ctx.ui.setWorkingIndicator({
			frames: CONFIG.spinnerFrames.map((frame) => accent.fg("accent", frame)),
			intervalMs: CONFIG.spinnerIntervalMs,
		});
		ctx.ui.setHiddenThinkingLabel(CONFIG.thinkingLabel);
		ctx.ui.setTitle(`${shortPath(ctx.cwd)} · ${CONFIG.appName}`);
	}

	function restore(ctx: ExtensionContext) {
		ctx.ui.setEditorComponent(undefined);
		ctx.ui.setFooter(undefined);
		ctx.ui.setHeader(undefined);
		ctx.ui.setWidget("claude-code-hint", undefined);
		ctx.ui.setWorkingMessage();
		ctx.ui.setWorkingIndicator();
		ctx.ui.setHiddenThinkingLabel();
		if (previousTheme) {
			// Re-setting an instance also refreshes cached transcript lines (drops the `›` prefix).
			ctx.ui.setTheme(previousTheme);
			previousTheme = undefined;
		}
		ctx.ui.notify("pi's default look restored", "info");
	}

	// Transcript prefixes. Registered once at load; the `enabled` flag gates it so
	// `/claude-code off` removes them. Display-only: context and session file are untouched.
	pi.registerMarkdownTransformer((markdown, context) => {
		if (!enabled) return markdown;
		return addMessagePrefix(markdown, CONFIG.messagePrefix[context.messageType] ?? "");
	});

	pi.on("session_start", async (_event, ctx) => {
		ctxRef = ctx;
		if (enabled) apply(ctx);
	});

	// Keep header/footer fresh when the model or thinking level changes.
	pi.on("model_select", async () => tuiRef?.requestRender());
	pi.on("thinking_level_select", async () => tuiRef?.requestRender());

	pi.on("session_shutdown", async () => {
		ctxRef = undefined;
		tuiRef = undefined;
	});

	pi.registerCommand("claude-code", {
		description: "Toggle the Claude Code skin: /claude-code [on|off|status] (logo header redraws on /reload)",
		handler: async (args, ctx) => {
			const arg = args.trim().toLowerCase();
			if (arg === "" || arg === "status") {
				ctx.ui.notify(`Claude Code skin is ${enabled ? "on" : "off"}`, "info");
				return;
			}
			if (arg !== "on" && arg !== "off") {
				ctx.ui.notify("Usage: /claude-code [on|off|status]", "error");
				return;
			}
			enabled = arg === "on";
			if (enabled) {
				apply(ctx);
				ctx.ui.notify("Claude Code skin applied (the logo header redraws on /reload)", "info");
			} else {
				restore(ctx);
			}
			// Rebuild cached transcript lines so the prefix appears/disappears immediately.
			tuiRef?.requestRender();
		},
	});
}
