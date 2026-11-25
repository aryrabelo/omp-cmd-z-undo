// Test-only omp extension: logs every key press the composer hands to
// extension handlers, with the draft as it stood before that key. It never
// takes a key. The log path comes from CMDZ_OBSERVER_LOG.
import { appendFileSync } from "node:fs";

interface Key {
	id: string;
	kind?: string;
}
interface Ctx {
	ui: {
		getEditorText(): string;
		composer?: { addKeyHandler(handler: (key: Key) => boolean): () => void };
	};
}
interface Api {
	on(event: "session_start", handler: (event: unknown, ctx: Ctx) => void): void;
}

export default function observer(pi: Api): void {
	const log = process.env.CMDZ_OBSERVER_LOG;
	if (!log) return;
	pi.on("session_start", (_event, ctx) => {
		ctx.ui.composer?.addKeyHandler(key => {
			if (key.kind === "press") appendFileSync(log, `${JSON.stringify({ id: key.id, text: ctx.ui.getEditorText() })}\n`);
			return false;
		});
	});
}
