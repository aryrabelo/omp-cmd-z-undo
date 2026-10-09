// cmd-z-undo — route Ctrl+Z and Cmd+Z back through the editor's native undo stack.
//
// OMP's app-level Ctrl+Z binding normally suspends the process. This extension
// changes that routing only in the active TUI editor, and only in memory: the
// user's keybindings file is never written. The editor still receives the key
// through its normal cursor-aware undo implementation; it never snapshots text
// or calls a text-replacement API.
//
// Kitty and other terminals may not report a Super/Command key sequence at all,
// so super+z is best-effort. Ctrl+Z remains the portable binding. While this
// extension is enabled, losing Ctrl+Z for app.suspend is intentional.
//
// The Ctrl+Z ADDITION to tui.editor.undo only takes effect in the composer —
// that binding is only ever checked there. The Ctrl+Z REMOVAL is session-
// global, though: the keybindings manager keys actions by name, not by
// (action, component) pair, so an action name shared by more than one UI
// surface loses Ctrl+Z everywhere it is checked, not just in the composer.
// Three of the actions this extension strips Ctrl+Z from are shared this
// way: app.tools.expand (also extension-selector.js), app.editor.external
// (also extension-editor.js), and app.message.copy (also tree-selector.js's
// "copy" binding). If a user had Ctrl+Z bound to one of those three, it
// stops working in that other surface too. This is inherent to the
// runtime's global action-ID keybinding model — there is no narrower scope
// available — so it is accepted as intentional chord reassignment rather
// than a defect in this extension.
//
// setEditorComponent is a single-slot seam: this extension preserves
// whatever factory was registered before it runs, but it cannot make a
// LATER-loading extension preserve this one in turn. An extension installed
// after this one that calls setEditorComponent without first reading
// ctx.ui.getEditorComponent() silently replaces this wrapper and the
// Ctrl+Z/Cmd+Z remap stops applying. This is a platform-wide limitation of
// the single-slot API, not something this extension can fix on its own.

type KeyId = string;
type KeybindingValue = KeyId | KeyId[] | undefined;
type KeybindingsConfig = Record<string, KeybindingValue>;

export interface KeybindingsManager {
	getUserBindings(): KeybindingsConfig;
	getResolvedBindings(): KeybindingsConfig;
	setUserBindings(bindings: KeybindingsConfig): void;
}

export interface EditorFactory {
	(tui: unknown, theme: unknown, keybindings: KeybindingsManager): unknown;
}

interface EditorComponentApi {
	setEditorComponent(factory: EditorFactory | undefined): void;
	getEditorComponent?: () => EditorFactory | undefined;
}

interface TuiSessionContext {
	mode?: string;
	ui: EditorComponentApi;
}

interface ExtensionApi {
	pi: {
		CustomEditor: new (
			tui: unknown,
			theme: unknown,
			keybindings: KeybindingsManager,
		) => unknown;
	};
	on(
		event: "session_start",
		handler: (_event: unknown, ctx: TuiSessionContext) => void,
	): void;
}

function asKeys(value: KeybindingValue): KeyId[] {
	if (value === undefined) return [];
	return Array.isArray(value) ? [...value] : [value];
}

/** OMP-family `matchesKey` normalizes key ids case-insensitively, so a user
 *  config with `"Ctrl+Z"` must be treated as the same chord as `"ctrl+z"`.
 *  Compare and append on the lowercased form; keep the caller's original
 *  casing for entries that survive unchanged. */
function appendUnique(keys: KeyId[], additions: readonly KeyId[]): KeyId[] {
	const seen = new Set(keys.map(key => key.toLowerCase()));
	for (const key of additions) {
		if (seen.has(key.toLowerCase())) continue;
		seen.add(key.toLowerCase());
		keys.push(key);
	}
	return keys;
}

/**
 * Action names the composer's `CustomEditor` can actually intercept via its
 * `handleInput` dispatch, before falling through to the native editor: the
 * two special-cased branches (`app.interrupt`, `app.exit`), the always-on
 * `app.clipboard.pasteImage` check, and every action the interactive mode
 * registers on it with `.onAction(...)` (`interactive-mode.js:2302-2320`).
 *
 * This MUST stay a finite, explicit list rather than every key starting
 * with `app.` — the wider `app.*` namespace also holds actions dispatched
 * by unrelated components (tree selector `app.tree.*`, session selector
 * `app.session.togglePath`/`toggleSort`/`rename`/`delete*`, model selector
 * `app.models.*`; see `core/keybindings.js:81-169`). None of those ever
 * reach the composer, so stripping Ctrl+Z from them would silently break a
 * user's chosen keybinding in a different part of the UI for zero undo
 * benefit.
 */
const COMPOSER_APP_ACTIONS: readonly string[] = [
	"app.interrupt",
	"app.exit",
	"app.clipboard.pasteImage",
	"app.clear",
	"app.suspend",
	"app.thinking.cycle",
	"app.model.cycleForward",
	"app.model.cycleBackward",
	"app.model.select",
	"app.tools.expand", // also dispatched by extension-selector.js — see header note
	"app.thinking.toggle",
	"app.editor.external", // also dispatched by extension-editor.js — see header note
	"app.message.copy", // also dispatched by tree-selector.js — see header note
	"app.message.followUp",
	"app.message.dequeue",
	"app.session.new",
	"app.session.tree",
	"app.session.fork",
	"app.session.resume",
];

export function withComposerUndoBindings(
	userBindings: KeybindingsConfig,
	resolvedBindings: KeybindingsConfig = userBindings,
): KeybindingsConfig {
	const next: KeybindingsConfig = { ...userBindings };

	const undo = appendUnique(
		asKeys(userBindings["tui.editor.undo"] ?? resolvedBindings["tui.editor.undo"]),
		["ctrl+z", "super+z"],
	);
	next["tui.editor.undo"] = undo;

	for (const action of COMPOSER_APP_ACTIONS) {
		const keys = asKeys(userBindings[action] ?? resolvedBindings[action]);
		if (!keys.some(key => key.toLowerCase() === "ctrl+z")) continue;
		next[action] = keys.filter(key => key.toLowerCase() !== "ctrl+z");
	}

	return next;
}

function installComposerUndo(keybindings: KeybindingsManager): void {
	const userBindings = keybindings.getUserBindings();
	const resolvedBindings = keybindings.getResolvedBindings();
	keybindings.setUserBindings(withComposerUndoBindings(userBindings, resolvedBindings));
}

export default function cmdZUndo(pi: ExtensionApi): void {
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;

		// Capture before setEditorComponent: asking from inside the wrapper would
		// retrieve the wrapper itself once the runtime has installed it.
		const existingFactory = ctx.ui.getEditorComponent?.();
		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			installComposerUndo(keybindings);
			return existingFactory
				? existingFactory(tui, theme, keybindings)
				: new pi.pi.CustomEditor(tui, theme, keybindings);
		});
	});
}
