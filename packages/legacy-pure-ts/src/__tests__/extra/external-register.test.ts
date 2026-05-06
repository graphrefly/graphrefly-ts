/**
 * Tests for externalProducer / externalBundle (src/extra/external-register.ts).
 */
import { describe, expect, it, vi } from "vitest";
import { COMPLETE, DATA, ERROR, type Messages } from "../../core/messages.js";
import {
	type BundleTriad,
	type EmitTriad,
	externalBundle,
	externalProducer,
} from "../../extra/external-register.js";

type Collected<T> = {
	values: T[];
	errors: unknown[];
	readonly completes: number;
	unsub: () => void;
};

function collect<T>(node: { subscribe: (s: (m: Messages) => void) => () => void }): Collected<T> {
	const values: T[] = [];
	const errors: unknown[] = [];
	const state = { completes: 0 };
	const unsub = node.subscribe((msgs) => {
		for (const m of msgs) {
			if (m[0] === DATA) values.push(m[1] as T);
			else if (m[0] === ERROR) errors.push(m[1]);
			else if (m[0] === COMPLETE) state.completes++;
		}
	});
	return {
		values,
		errors,
		get completes() {
			return state.completes;
		},
		unsub,
	};
}

describe("externalProducer", () => {
	it("invokes register on first subscribe and cleanup on last unsubscribe", () => {
		const cleanup = vi.fn();
		let triad!: EmitTriad<number>;
		const register = vi.fn((t: EmitTriad<number>) => {
			triad = t;
			return cleanup;
		});
		const src = externalProducer<number>(register);
		expect(register).toHaveBeenCalledTimes(0);

		const a = collect<number>(src);
		expect(register).toHaveBeenCalledTimes(1);
		expect(cleanup).toHaveBeenCalledTimes(0);

		triad.emit(1);
		triad.emit(2);
		expect(a.values).toEqual([1, 2]);

		a.unsub();
		expect(cleanup).toHaveBeenCalledTimes(1);
	});

	it("drops emits after cleanup (active flag guard)", () => {
		let triad!: EmitTriad<number>;
		const src = externalProducer<number>((t) => {
			triad = t;
			return () => {};
		});
		const a = collect<number>(src);
		triad.emit(1);
		a.unsub();
		triad.emit(2); // post-teardown — must NOT reach a new subscriber

		const b = collect<number>(src);
		expect(b.values).toEqual([]);
	});

	it("error terminates the stream", () => {
		let triad!: EmitTriad<number>;
		const src = externalProducer<number>((t) => {
			triad = t;
			return () => {};
		});
		const a = collect<number>(src);
		triad.emit(1);
		triad.error(new Error("boom"));
		triad.emit(2); // post-error — must be dropped

		expect(a.values).toEqual([1]);
		expect(a.errors).toHaveLength(1);
		expect((a.errors[0] as Error).message).toBe("boom");
	});

	it("complete terminates the stream", () => {
		let triad!: EmitTriad<number>;
		const src = externalProducer<number>((t) => {
			triad = t;
			return () => {};
		});
		const a = collect<number>(src);
		triad.emit(1);
		triad.complete();
		triad.emit(2); // post-complete — must be dropped

		expect(a.values).toEqual([1]);
		expect(a.completes).toBe(1);
	});

	it("synchronous throw from register surfaces as terminal ERROR", () => {
		const src = externalProducer<number>(() => {
			throw new Error("register failed");
		});
		const a = collect<number>(src);
		expect(a.errors).toHaveLength(1);
		expect((a.errors[0] as Error).message).toBe("register failed");
	});

	it("register returning void / undefined is accepted", () => {
		let triad!: EmitTriad<number>;
		const src = externalProducer<number>((t) => {
			triad = t;
			// no return — undefined cleanup
		});
		const a = collect<number>(src);
		triad.emit(42);
		expect(a.values).toEqual([42]);
		expect(() => a.unsub()).not.toThrow();
	});

	it("cleanup throws are swallowed at the boundary", () => {
		let triad!: EmitTriad<number>;
		const src = externalProducer<number>((t) => {
			triad = t;
			return () => {
				throw new Error("cleanup failed");
			};
		});
		const a = collect<number>(src);
		triad.emit(1);
		expect(() => a.unsub()).not.toThrow();
	});
});

describe("externalBundle", () => {
	type Channels = { traces: { id: string }; metrics: { v: number }; logs: { msg: string } };

	it("activates eagerly and cleanup fires after all channels tear down", () => {
		const cleanup = vi.fn();
		let bundle!: BundleTriad<Channels>;
		const register = vi.fn((b: BundleTriad<Channels>) => {
			bundle = b;
			return cleanup;
		});

		const nodes = externalBundle<Channels>(register, ["traces", "metrics", "logs"]);
		// Eager: register already ran
		expect(register).toHaveBeenCalledTimes(1);
		expect(cleanup).toHaveBeenCalledTimes(0);

		const t = collect<{ id: string }>(nodes.traces);
		const m = collect<{ v: number }>(nodes.metrics);
		const l = collect<{ msg: string }>(nodes.logs);

		bundle.traces({ id: "s1" });
		bundle.metrics({ v: 42 });
		bundle.logs({ msg: "hi" });

		expect(t.values).toEqual([{ id: "s1" }]);
		expect(m.values).toEqual([{ v: 42 }]);
		expect(l.values).toEqual([{ msg: "hi" }]);

		t.unsub();
		expect(cleanup).toHaveBeenCalledTimes(0); // still two channels live
		m.unsub();
		expect(cleanup).toHaveBeenCalledTimes(0);
		l.unsub();
		expect(cleanup).toHaveBeenCalledTimes(1);
	});

	it("error propagates ERROR to all subscribed channels and runs cleanup", () => {
		const cleanup = vi.fn();
		let bundle!: BundleTriad<Channels>;
		const nodes = externalBundle<Channels>(
			(b) => {
				bundle = b;
				return cleanup;
			},
			["traces", "metrics", "logs"],
		);

		const t = collect<{ id: string }>(nodes.traces);
		const m = collect<{ v: number }>(nodes.metrics);
		const l = collect<{ msg: string }>(nodes.logs);

		bundle.error(new Error("server down"));

		expect(t.errors).toHaveLength(1);
		expect(m.errors).toHaveLength(1);
		expect(l.errors).toHaveLength(1);
		expect(cleanup).toHaveBeenCalledTimes(1);

		// Post-error emits must be dropped
		bundle.traces({ id: "late" });
		expect(t.values).toEqual([]);
	});

	it("complete propagates COMPLETE to all subscribed channels and runs cleanup", () => {
		const cleanup = vi.fn();
		let bundle!: BundleTriad<Channels>;
		const nodes = externalBundle<Channels>(
			(b) => {
				bundle = b;
				return cleanup;
			},
			["traces", "metrics", "logs"],
		);

		const t = collect<{ id: string }>(nodes.traces);
		const m = collect<{ v: number }>(nodes.metrics);
		const l = collect<{ msg: string }>(nodes.logs);

		bundle.traces({ id: "s1" });
		bundle.complete();

		expect(t.completes).toBe(1);
		expect(m.completes).toBe(1);
		expect(l.completes).toBe(1);
		expect(cleanup).toHaveBeenCalledTimes(1);
	});

	it("synchronous throw from register propagates to caller (eager activation)", () => {
		type C2 = { a: number; b: string };
		expect(() =>
			externalBundle<C2>(() => {
				throw new Error("bad register");
			}, ["a", "b"]),
		).toThrow("bad register");
	});

	it("names channel nodes with optional prefix", () => {
		type C = { x: number };
		const nodes = externalBundle<C>(
			() => {
				return () => {};
			},
			["x"],
			{ name: "myhub" },
		);
		expect(nodes.x.name).toBe("myhub::x");
	});

	it("batches emits to multiple channels inside a single user call", () => {
		type C = { a: number; b: number };
		let bundle!: BundleTriad<C>;
		const nodes = externalBundle<C>(
			(h) => {
				bundle = h;
				return () => {};
			},
			["a", "b"],
		);

		const a = collect<number>(nodes.a);
		const b = collect<number>(nodes.b);

		// Caller can batch fan-out themselves — we don't auto-batch individual
		// per-channel calls because the registrar knows best when to group.
		bundle.a(1);
		bundle.b(2);
		bundle.a(3);

		expect(a.values).toEqual([1, 3]);
		expect(b.values).toEqual([2]);
	});
});
