// Check for cmd-z-undo.ts: the extension only changes the active TUI editor,
// keeps the native editor undo path, and never persists keybinding settings.
// Run: bun tests/cmd-z-undo-check.ts
import cmdZUndo, { type EditorFactory, type KeybindingsManager } from "../src/cmd-z-undo.ts";

type SessionStartHandler = (event: unknown, ctx: { mode?: string; ui: Ui }) => void;
interface Ui {
	setEditorComponent(factory: EditorFactory | undefined): void;
	getEditorComponent?: () => EditorFactory | undefined;
}

let failures = 0;

function ck(name: string, ok: boolean): void {
	if (!ok) failures++;
	console.log(`${ok ? "  ok  " : "  FALHA"} ${name}`);
}

class FakeCustomEditor {
	static calls: unknown[][] = [];

	constructor(...args: unknown[]) {
		FakeCustomEditor.calls.push(args);
	}
}

function wire(
	mode: string,
	userBindings: Record<string, string | string[] | undefined>,
	resolvedBindings: Record<string, string | string[] | undefined>,
	existingFactory?: EditorFactory,
): {
	factory: EditorFactory | undefined;
	setCalls: number;
	keybindings: KeybindingsManager;
	ui: Ui;
} {
	let factory: EditorFactory | undefined;
	let setCalls = 0;
	let start: SessionStartHandler | undefined;
	const keybindings: KeybindingsManager = {
		getUserBindings: () => userBindings,
		getResolvedBindings: () => resolvedBindings,
		setUserBindings: bindings => {
			userBindings = bindings;
		},
	};
	const ui: Ui = {
		setEditorComponent(next) {
			setCalls++;
			factory = next;
		},
		getEditorComponent: existingFactory ? () => existingFactory : undefined,
	};

	cmdZUndo({
		pi: { CustomEditor: FakeCustomEditor },
		on(event, handler) {
			if (event === "session_start") start = handler;
		},
	});
	if (!start) throw new Error("extension did not register session_start");
	start({}, { mode, ui });

	return {
		factory,
		setCalls,
		keybindings,
		ui,
	};
}

// A headless session must not install an editor factory.
const headless = wire("rpc", {}, {});
ck("non-TUI does not register an editor factory", headless.setCalls === 0);
ck("non-TUI leaves the captured factory absent", headless.factory === undefined);

// With no custom factory, the runtime's public constructor is the fallback.
FakeCustomEditor.calls = [];
const defaults = wire(
	"tui",
	{},
	{
		"tui.editor.undo": ["ctrl+-", "ctrl+_"],
		"app.suspend": "ctrl+z",
	},
);
ck("TUI registers one editor factory", defaults.setCalls === 1);
ck("TUI factory was installed", typeof defaults.factory === "function");
const tui = {};
const theme = {};
const manager = defaults.keybindings;
const firstEditor = defaults.factory?.(tui, theme, manager);
ck("default fake CustomEditor is constructed", firstEditor instanceof FakeCustomEditor);
ck("CustomEditor receives tui, theme, and keybindings", FakeCustomEditor.calls[0]?.length === 3);
ck("undo user bindings contain both requested keys", JSON.stringify(manager.getUserBindings()["tui.editor.undo"]) === JSON.stringify(["ctrl+-", "ctrl+_", "ctrl+z", "super+z"]));
ck("Ctrl+Z is removed from app suspend", JSON.stringify(manager.getUserBindings()["app.suspend"]) === JSON.stringify([]));

// Creating the runtime factory again must not duplicate either undo binding.
defaults.factory?.(tui, theme, manager);
ck("repeated factory creation is idempotent", JSON.stringify(manager.getUserBindings()["tui.editor.undo"]) === JSON.stringify(["ctrl+-", "ctrl+_", "ctrl+z", "super+z"]));

// A pre-existing custom editor remains the component that gets constructed.
const customEditor: EditorFactory = (receivedTui, receivedTheme, receivedKeybindings) => {
	return {
		receivedTui,
		receivedTheme,
		receivedKeybindings,
	};
};
const custom = wire(
	"tui",
	{
		"tui.editor.undo": ["alt+u"],
		"app.suspend": ["ctrl+z", "ctrl+q"],
		"tui.editor.cursorLeft": "alt+h",
	},
	{
		"tui.editor.undo": ["alt+u"],
		"app.suspend": ["ctrl+z", "ctrl+q"],
		"tui.editor.cursorLeft": "alt+h",
	},
	customEditor,
);
const customResult = custom.factory?.(tui, theme, custom.keybindings) as {
	receivedTui: unknown;
	receivedTheme: unknown;
	receivedKeybindings: KeybindingsManager;
};
ck("existing custom factory is preserved", customResult?.receivedTui === tui && customResult.receivedTheme === theme);
ck("existing custom factory receives the same keybindings manager", customResult?.receivedKeybindings === custom.keybindings);
ck("custom undo retains its normal user key and adds Ctrl+Z", JSON.stringify(custom.keybindings.getUserBindings()["tui.editor.undo"]) === JSON.stringify(["alt+u", "ctrl+z", "super+z"]));
ck("custom suspend retains other keys while removing only Ctrl+Z", JSON.stringify(custom.keybindings.getUserBindings()["app.suspend"]) === JSON.stringify(["ctrl+q"]));
ck("unrelated user binding remains intact", custom.keybindings.getUserBindings()["tui.editor.cursorLeft"] === "alt+h");

// A user-config chord that differs only in case from OMP's own "ctrl+z"
// must still be treated as the same chord: matchesKey compares
// case-insensitively, so leaving an uppercase copy in app.suspend or
// duplicating it in tui.editor.undo would both be bugs.
const casedSuspend = wire(
	"tui",
	{
		"tui.editor.undo": ["Ctrl+Z"],
		"app.suspend": ["Ctrl+Z", "ctrl+q"],
	},
	{
		"tui.editor.undo": ["Ctrl+Z"],
		"app.suspend": ["Ctrl+Z", "ctrl+q"],
	},
);
casedSuspend.factory?.(tui, theme, casedSuspend.keybindings);
ck(
	"differently-cased Ctrl+Z is removed from app suspend",
	JSON.stringify(casedSuspend.keybindings.getUserBindings()["app.suspend"]) === JSON.stringify(["ctrl+q"]),
);
ck(
	"differently-cased Ctrl+Z in undo is not duplicated",
	JSON.stringify(casedSuspend.keybindings.getUserBindings()["tui.editor.undo"]) === JSON.stringify(["Ctrl+Z", "super+z"]),
);

// A user may have remapped Ctrl+Z away from app.suspend onto a different
// composer app action entirely (e.g. app.clear). CustomEditor.handleInput
// walks every registered action handler before falling through to the
// parent editor, so that action would still intercept Ctrl+Z before undo
// runs unless this extension strips it from every composer-dispatched
// app action, not just app.suspend.
const remapped = wire(
	"tui",
	{
		"tui.editor.undo": ["ctrl+-"],
		"app.clear": ["ctrl+z"],
		"app.suspend": ["ctrl+t"],
	},
	{
		"tui.editor.undo": ["ctrl+-"],
		"app.clear": ["ctrl+z"],
		"app.suspend": ["ctrl+t"],
	},
);
remapped.factory?.(tui, theme, remapped.keybindings);
ck(
	"Ctrl+Z remapped onto a non-suspend app action is still removed",
	JSON.stringify(remapped.keybindings.getUserBindings()["app.clear"]) === JSON.stringify([]),
);
ck(
	"app.suspend without Ctrl+Z is left untouched by the general strip",
	JSON.stringify(remapped.keybindings.getUserBindings()["app.suspend"]) === JSON.stringify(["ctrl+t"]),
);
ck(
	"undo still gains Ctrl+Z when the conflict was on a different action",
	JSON.stringify(remapped.keybindings.getUserBindings()["tui.editor.undo"]) === JSON.stringify(["ctrl+-", "ctrl+z", "super+z"]),
);

// Ctrl+Z bound to an app.* action OUTSIDE the composer (e.g. the session
// selector's app.session.rename, which CustomEditor never dispatches) must
// be left alone: the composer never sees it, so removing it there breaks
// an unrelated keybinding for zero undo benefit.
const outOfScope = wire(
	"tui",
	{
		"tui.editor.undo": ["ctrl+-"],
		"app.session.rename": ["ctrl+z"],
	},
	{
		"tui.editor.undo": ["ctrl+-"],
		"app.session.rename": ["ctrl+z"],
	},
);
outOfScope.factory?.(tui, theme, outOfScope.keybindings);
ck(
	"Ctrl+Z bound to a non-composer app action (session selector) is left alone",
	JSON.stringify(outOfScope.keybindings.getUserBindings()["app.session.rename"]) === JSON.stringify(["ctrl+z"]),
);
ck(
	"undo still gains Ctrl+Z even when a non-composer action also claims it",
	JSON.stringify(outOfScope.keybindings.getUserBindings()["tui.editor.undo"]) === JSON.stringify(["ctrl+-", "ctrl+z", "super+z"]),
);

console.log(failures === 0 ? "TUDO OK" : `${failures} FALHA(S)`);
process.exit(failures === 0 ? 0 : 1);
