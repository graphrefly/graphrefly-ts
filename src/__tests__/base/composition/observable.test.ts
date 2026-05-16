// Base `toObservable` — dependency-free TC39 interop observable.
// Locks the memo:Re P0 fix: the base barrel must NOT depend on rxjs, yet the
// returned value must still be adoptable by rxjs `from()` via Symbol.observable.

import { COMPLETE, DATA, ERROR, node } from "@graphrefly/pure-ts/core";
import { firstValueFrom, from, take, toArray } from "rxjs";
import { describe, expect, it } from "vitest";
import { toObservable } from "../../../base/composition/observable.js";

const OBSERVABLE_KEY: PropertyKey =
	(typeof Symbol === "function" && (Symbol as unknown as { observable?: symbol }).observable) ||
	"@@observable";

describe("base/composition toObservable — Symbol.observable interop (no rxjs dep)", () => {
	it("exposes the well-known interop method returning itself", () => {
		const s = node<number>();
		const obs = toObservable(s) as Record<PropertyKey, unknown>;
		expect(typeof obs.subscribe).toBe("function");
		expect(typeof obs[OBSERVABLE_KEY]).toBe("function");
		expect((obs[OBSERVABLE_KEY] as () => unknown).call(obs)).toBe(obs);
	});

	it("is adoptable by rxjs from() and emits DATA values", async () => {
		const s = node<number>();
		const p = firstValueFrom(from(toObservable<number>(s)).pipe(take(2), toArray()));
		s.down([[DATA, 1]]);
		s.down([[DATA, 2]]);
		expect(await p).toEqual([1, 2]);
	});

	it("maps ERROR to error()", async () => {
		const s = node<number>();
		const err = new Promise<unknown>((res) => {
			toObservable<number>(s).subscribe({ next: () => {}, error: res });
		});
		s.down([[ERROR, new Error("boom")]]);
		expect((await err) as Error).toBeInstanceOf(Error);
	});

	it("maps COMPLETE to complete() and supports a function observer", () => {
		const s = node<number>([], { initial: 7 });
		const seen: number[] = [];
		let done = false;
		// Function-form observer (TC39 shorthand) must be normalized.
		toObservable<number>(s).subscribe((v) => seen.push(v));
		toObservable<number>(s).subscribe({ complete: () => (done = true) });
		s.down([[COMPLETE]]);
		expect(seen).toEqual([7]);
		expect(done).toBe(true);
	});

	it("raw mode emits message batches (incl. framing)", async () => {
		const s = node<number>();
		// Subscribe delivers framing (START, then DIRTY per down) before DATA;
		// assert the extracted DATA payloads, order-preserved.
		const p = firstValueFrom(from(toObservable(s, { raw: true })).pipe(take(5), toArray()));
		s.down([[DATA, 1]]);
		s.down([[DATA, 2]]);
		const dataValues = (await p)
			.flat()
			.filter((m) => m[0] === DATA)
			.map((m) => m[1]);
		expect(dataValues).toEqual([1, 2]);
	});

	it("unsubscribe stops node delivery", () => {
		const s = node<number>();
		const seen: number[] = [];
		const sub = toObservable<number>(s).subscribe((v) => seen.push(v));
		s.down([[DATA, 1]]);
		s.down([[DATA, 2]]);
		sub.unsubscribe();
		s.down([[DATA, 3]]);
		expect(seen).toEqual([1, 2]);
	});

	// QA/D1 regression: direct (non-rxjs) TC39 consumer. The hand-rolled
	// interop must latch on terminal and auto-unsubscribe the node — without
	// this, a post-terminal node wave re-fires next/complete (terminal-once
	// violated) and the node subscription leaks (rxjs `from()` masked both).
	it("COMPLETE latches terminal + auto-unsubscribes the node (no rxjs)", () => {
		const s = node<number>();
		const seen: number[] = [];
		let completes = 0;
		toObservable<number>(s).subscribe({
			next: (v) => seen.push(v),
			complete: () => completes++,
		});
		s.down([[DATA, 1]]);
		s.down([[COMPLETE]]);
		s.down([[DATA, 99]]); // post-terminal — must NOT reach the observer
		s.down([[COMPLETE]]); // must NOT re-fire complete
		expect(seen).toEqual([1]);
		expect(completes).toBe(1);
	});

	it("ERROR latches terminal + auto-unsubscribes the node (no rxjs)", () => {
		const s = node<number>();
		const seen: number[] = [];
		let errors = 0;
		toObservable<number>(s).subscribe({
			next: (v) => seen.push(v),
			error: () => errors++,
		});
		s.down([[DATA, 1]]);
		s.down([[ERROR, new Error("boom")]]);
		s.down([[DATA, 99]]);
		s.down([[ERROR, new Error("again")]]);
		expect(seen).toEqual([1]);
		expect(errors).toBe(1);
	});
});
