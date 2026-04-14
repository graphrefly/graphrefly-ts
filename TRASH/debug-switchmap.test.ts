import { describe, expect, it } from "vitest";
import { COMPLETE, DATA, DIRTY, ERROR, RESOLVED, START } from "../../core/messages.js";
import { state } from "../../core/sugar.js";
import { switchMap } from "../../extra/operators.js";

describe("debug switchMap B COMPLETE", () => {
	it("outer complete with active inner", () => {
		const outer = state(0);
		const inner = state(10);
		const out = switchMap(outer, () => inner);
		const allMsgs: [symbol, unknown][] = [];
		const unsub = out.subscribe((msgs) => {
			for (const m of msgs) allMsgs.push([m[0] as symbol, m[1]]);
		});
		// Clear initial handshake
		allMsgs.length = 0;

		// Monkey-patch _emit to trace source of COMPLETE
		const origEmit = (out as any)._emit.bind(out);
		(out as any)._emit = (msgs: any) => {
			for (const m of msgs) {
				if (m[0] === COMPLETE) {
					console.log(
						"COMPLETE emitted via _emit! Stack:",
						new Error().stack?.split("\n").slice(1, 15).join("\n"),
					);
				}
			}
			return origEmit(msgs);
		};

		console.log("--- outer.down([[COMPLETE]]) ---");
		console.log("switchMap _autoComplete:", (out as any)._autoComplete);
		console.log("switchMap _autoError:", (out as any)._autoError);
		outer.down([[COMPLETE]]);

		const types = allMsgs.map(([t]) => t);
		const msgName = (t: symbol) => {
			if (t === COMPLETE) return "COMPLETE";
			if (t === DATA) return "DATA";
			if (t === DIRTY) return "DIRTY";
			if (t === RESOLVED) return "RESOLVED";
			if (t === ERROR) return "ERROR";
			return String(t);
		};
		console.log("Messages after outer COMPLETE:", types.map(msgName));

		expect(types).not.toContain(COMPLETE);
		unsub();
	});
});
