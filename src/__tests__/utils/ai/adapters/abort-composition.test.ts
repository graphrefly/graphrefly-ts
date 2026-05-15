/**
 * DS-14.5 / AB-3 (D-AB5) — composition-level abort test.
 *
 * `abort-propagation.test.ts` locks the *leaf* (every provider threads
 * `opts.signal` into `fetch` / SDK). This locks the *composition*: closing a
 * `valve` or superseding a `switchMap` actually fires the `AbortController`
 * the caller threaded into an in-flight `adapter.invoke({ signal })`, so the
 * call stops instead of burning tokens past the reactive cut. Without this,
 * the §6 gap #1 "panic button stops cost, not just propagation" claim is
 * aspirational end-to-end.
 */
import { node } from "@graphrefly/pure-ts/core";
import { switchMap, valve } from "@graphrefly/pure-ts/extra";
import { describe, expect, it } from "vitest";
import type {
	ChatMessage,
	LLMAdapter,
	LLMResponse,
} from "../../../../utils/ai/adapters/core/types.js";

/** Adapter whose invoke hangs until its `opts.signal` aborts, recording the reason. */
function hangingAdapter(): LLMAdapter & { lastSignal?: AbortSignal } {
	const a: LLMAdapter & { lastSignal?: AbortSignal } = {
		provider: "hang",
		model: "hang-m",
		invoke(_messages: readonly ChatMessage[], opts): Promise<LLMResponse> {
			a.lastSignal = opts?.signal;
			return new Promise<LLMResponse>((_resolve, reject) => {
				if (opts?.signal) {
					if (opts.signal.aborted) return reject(opts.signal.reason);
					opts.signal.addEventListener("abort", () => reject((opts.signal as AbortSignal).reason), {
						once: true,
					});
				}
			});
		},
		// biome-ignore lint/correctness/useYield: never streams in this test
		async *stream() {
			throw new Error("unused");
		},
	};
	return a;
}

describe("AB-3 — operator → adapter abort composition", () => {
	it("valve close fires abortInFlight → in-flight adapter call aborts", async () => {
		const adapter = hangingAdapter();
		const ctrl = new AbortController();
		const pending = Promise.resolve(
			adapter.invoke([{ role: "user", content: "hi" }], { signal: ctrl.signal }),
		).then(
			() => "resolved",
			(e) => `aborted:${(e as Error)?.name ?? e}`,
		);

		const src = node<number>([], { initial: 1 });
		const open = node<boolean>([], { initial: true });
		const gated = valve(src, open, { abortInFlight: ctrl });
		const unsub = gated.subscribe(() => {});

		expect(adapter.lastSignal?.aborted).toBe(false);
		open.emit(false); // panic — truthy→falsy edge
		expect(adapter.lastSignal?.aborted).toBe(true);
		await expect(pending).resolves.toMatch(/^aborted:/);
		unsub();
	});

	it("valve factory form mints fresh controller per panic-toggle cycle", () => {
		// Caller owns the live controller; factory hands valve whichever is
		// in flight at each close edge. Re-mint per cycle, no valve rebuild.
		let live: AbortController | undefined;
		const mint = (): AbortController => {
			live = new AbortController();
			return live;
		};
		const src = node<number>([], { initial: 1 });
		const open = node<boolean>([], { initial: true });
		const unsub = valve(src, open, { abortInFlight: () => live }).subscribe(() => {});

		const c1 = mint();
		open.emit(false); // close → abort c1
		expect(c1.signal.aborted).toBe(true);

		open.emit(true); // reopen
		const c2 = mint(); // caller mints + rewires for the new in-flight call
		expect(c2.signal.aborted).toBe(false);
		open.emit(false); // close again → abort c2 (not the spent c1)
		expect(c2.signal.aborted).toBe(true);
		unsub();
	});

	it("switchMap supersede fires abortInFlight → prior inner's call aborts", async () => {
		const adapter = hangingAdapter();
		// Caller mints per outer value and threads the signal into the call;
		// switchMap aborts the prior controller on supersede.
		let current: AbortController | undefined;
		const prompts = node<string>([], { initial: "p1" });
		const out = switchMap(
			prompts,
			(p) => {
				current = new AbortController();
				const sig = current.signal;
				return Promise.resolve(
					adapter.invoke([{ role: "user", content: p as string }], { signal: sig }),
				).catch((e) => ({ content: `aborted:${(e as Error)?.name ?? e}` }) as LLMResponse);
			},
			{ abortInFlight: () => current },
		);
		const unsub = out.subscribe(() => {});

		const firstSignal = adapter.lastSignal;
		expect(firstSignal?.aborted).toBe(false);
		prompts.emit("p2"); // supersede → abort p1's controller
		expect(firstSignal?.aborted).toBe(true);
		unsub();
	});
});
