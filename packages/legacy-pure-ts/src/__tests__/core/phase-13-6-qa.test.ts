/**
 * Phase 13.6.B QA pass — regression tests for the patches landed during
 * the /qa adversarial review of B6–B10.
 *
 * - P1 — `firstWhere` settle helpers gate on `!settled`.
 * - P2 — `wrapMutation` `compensate` gates on `captureSet`.
 * - D1 — `onResubscribableReset` hook fires from `_resetForFreshLifecycle`.
 * - D5 — `assertDirtyPrecedesTerminalData` admits the push-on-subscribe
 *        handshake window (START + replay-buffer DATAs + optional DIRTY).
 *
 * D2 (BudgetGateBundle.dispose) and D3 (abort-capable warning) live in
 * the existing budget-gate test surface.
 */

import { describe, expect, it, vi } from "vitest";
import {
	COMPLETE,
	DATA,
	DIRTY,
	INVALIDATE,
	type Messages,
	RESOLVED,
	START,
} from "../../core/messages.js";
import { node } from "../../core/node.js";
import { mutate } from "../../extra/mutation/index.js";
import { firstWhere } from "../../extra/sources/settled.js";
import { assertDirtyPrecedesTerminalData } from "../../testing/index.js";

describe("Phase 13.6.B QA P1 — firstWhere settle helpers gate on !settled", () => {
	it("kick fires matching DATA then throws — Promise resolves with the DATA, not the kick error", async () => {
		const src = node<number>([], { initial: null });
		const result = await firstWhere(src, (v) => typeof v === "number" && v > 0, {
			skipCurrent: true,
			kick: () => {
				src.emit(42);
				// The settler ran inside the synchronous emit above; the
				// throw below MUST NOT mask the resolved value.
				throw new Error("kick boom");
			},
		});
		expect(result).toBe(42);
	});

	it("source delivers [DATA matched, ERROR] in same wave — Promise resolves with DATA", async () => {
		const src = node<number>([], { initial: null });
		// Subscribe-and-fire-wave pattern: kick emits a multi-message wave
		// where the first DATA matches and a follow-up ERROR would have
		// overwritten `pending` pre-P1.
		const result = await firstWhere(src, (v) => typeof v === "number" && v > 0, {
			skipCurrent: true,
			kick: () => {
				src.down([
					[DATA, 7],
					[Symbol.for("graphrefly/ERROR"), new Error("late ERROR")],
				]);
			},
		});
		expect(result).toBe(7);
	});
});

describe("Phase 13.6.B QA P2 — mutate down gates on captureSet", () => {
	it("down does NOT fire when the action body never ran (framework-level batch error)", () => {
		const downCalls: string[] = [];
		// Force a pre-action throw: pass an invalid `seq` cursor whose
		// `down([DIRTY, DATA])` rejects synchronously. The thrown error
		// bubbles out of `bumpCursor` BEFORE `action()` runs → captureSet
		// stays false → down must NOT fire (P2 contract).
		const seq = node<number>([], { initial: 0 });
		const downSpy = vi.spyOn(seq, "down").mockImplementation(() => {
			throw new Error("cursor down threw");
		});
		const action = mutate(
			{
				up: () => {
					downCalls.push("action ran");
					return "ok";
				},
				down: () => downCalls.push("down fired"),
			},
			{ frame: "transactional", seq },
		);
		expect(() => action()).toThrow(/cursor down threw/);
		expect(downCalls).toEqual([]);
		downSpy.mockRestore();
	});

	it("down DOES fire when the action body throws", () => {
		const out: string[] = [];
		const action = mutate(
			{
				up: () => {
					out.push("action partial");
					throw new Error("action threw");
				},
				down: () => out.push("down fired"),
			},
			{ frame: "transactional" },
		);
		expect(() => action()).toThrow(/action threw/);
		expect(out).toEqual(["action partial", "down fired"]);
	});
});

describe("Phase 13.6.B QA D1 — onResubscribableReset hook", () => {
	it("fires on multi-sub-stayed terminal-resubscribable reset (the case _deactivate doesn't fire)", () => {
		// The exact case D1 was designed for: a sibling sink keeps the
		// node alive across terminal, so _deactivate never runs and the
		// `onDeactivation` hook never fires. When a NEW subscriber
		// arrives, `_resetForFreshLifecycle` runs and must fire
		// `onResubscribableReset` to clear store-flag state.
		const src = node<number>([], { initial: 0, resubscribable: true });
		const flagWipes: number[] = [];
		const computed = node<number>(
			[src],
			(data, a, ctx) => {
				if (ctx.store.emitted) {
					a.down([[RESOLVED]]);
					return;
				}
				const batch = data[0];
				if (batch != null && batch.length > 0) a.emit(batch.at(-1) as number);
				else a.emit(ctx.prevData[0] as number);
				ctx.store.emitted = true;
				const store = ctx.store;
				return {
					onResubscribableReset: () => {
						flagWipes.push(1);
						delete store.emitted;
					},
				};
			},
			{ resubscribable: true },
		);

		// TWO sinks subscribe — `sinkKeep` will outlive the terminal so
		// _deactivate doesn't fire when sinkA unsubs.
		const sinkKeep = computed.subscribe(() => {});
		const sinkA = computed.subscribe(() => {});
		src.emit(1);
		expect(flagWipes).toEqual([]);

		// Drive computed terminal via src COMPLETE (autoComplete cascade).
		src.down([[COMPLETE]]);

		// Drop sinkA — but sinkKeep is still attached, so _sinkCount > 0,
		// _deactivate does NOT run, store flag stays `emitted: true`.
		sinkA();
		expect(flagWipes).toEqual([]);

		// New sinkC subscribes — wasTerminal && _resubscribable →
		// `_resetForFreshLifecycle` runs → `onResubscribableReset` fires
		// → flag cleared.
		const sinkC = computed.subscribe(() => {});
		expect(flagWipes).toEqual([1]);

		sinkKeep();
		sinkC();
	});

	it("does NOT fire on the regular _deactivate path (only that's onDeactivation)", () => {
		const src = node<number>([], { initial: 0, resubscribable: true });
		let resetFires = 0;
		let deactivateFires = 0;
		const computed = node<number>(
			[src],
			(data, a, ctx) => {
				const batch = data[0];
				if (batch != null && batch.length > 0) a.emit(batch.at(-1) as number);
				else a.emit(ctx.prevData[0] as number);
				return {
					onDeactivation: () => {
						deactivateFires += 1;
					},
					onResubscribableReset: () => {
						resetFires += 1;
					},
				};
			},
			{ resubscribable: true },
		);

		const u1 = computed.subscribe(() => {});
		src.emit(1);
		u1(); // last-sink-detach → _deactivate fires → onDeactivation only
		expect(deactivateFires).toBe(1);
		expect(resetFires).toBe(0);
	});
});

describe("Phase 13.6.B QA D5 — assertDirtyPrecedesTerminalData handshake carve-out", () => {
	it("admits the Lock 6.G replayBuffer handshake [START, DATA, DATA, DATA]", () => {
		const messages: Messages = [[START], [DATA, 1], [DATA, 2], [DATA, 3]];
		expect(() => assertDirtyPrecedesTerminalData(messages)).not.toThrow();
	});

	it("admits handshake followed by post-handshake wave [START, DATA, DIRTY, DATA]", () => {
		const messages: Messages = [[START], [DATA, 1], [DIRTY], [DATA, 2]];
		expect(() => assertDirtyPrecedesTerminalData(messages)).not.toThrow();
	});

	it("rejects post-handshake DATA with no preceding DIRTY", () => {
		const messages: Messages = [
			[START],
			[DATA, 1],
			[DIRTY],
			[DATA, 2],
			[DATA, 3], // unbalanced — no second DIRTY
		];
		expect(() => assertDirtyPrecedesTerminalData(messages)).toThrow(/P\.25/);
	});

	it("rejects post-INVALIDATE RESOLVED without preceding DIRTY (P3 case)", () => {
		const messages: Messages = [[INVALIDATE], [RESOLVED]];
		expect(() => assertDirtyPrecedesTerminalData(messages)).toThrow(/P\.25/);
	});

	it("legacy P.25 [RESOLVED] without START still admitted (back-compat)", () => {
		const messages: Messages = [[RESOLVED], [DIRTY], [DATA, 1]];
		expect(() => assertDirtyPrecedesTerminalData(messages)).not.toThrow();
	});
});
