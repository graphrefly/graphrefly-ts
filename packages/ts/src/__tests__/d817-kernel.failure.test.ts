/**
 * D817 kernel report (graphrefly-ts:D817-KERNEL-REPORT-TS): failures and refused payloads.
 *
 * TS harness for the root scenarios C-56 (1)-(5), C-42's payload clauses (graphrefly:D814) and
 * C-60 (1) in ~/src/graphrefly/spec/conformance.jsonl, against R-failure@5 (graphrefly:D824),
 * R-messages@1, R-terminals@2, R-invalidation@2, R-request-order@7 and R-wave@4 (graphrefly:D830).
 * A throw's ERROR payload is the thrown error's message, or the thrown value itself when it is not
 * an Error; a throw of undefined or a boolean gives "".
 */

import { describe, expect, it } from "vitest";
import type { Ctx } from "../ctx/types.js";
import { graph } from "../graph/graph.js";
import type { Message, Wave } from "../protocol/messages.js";

type Graph = ReturnType<typeof graph>;

const none = <T>() => undefined as unknown as T;
const pending = (...msgs: Wave): Wave => [["PENDING"], ...msgs];

/** Subscribe a sink and record its arrays; the first array (START) is kept in `log`. */
const sinkOf = (node: { subscribe(s: (m: Wave) => void): () => void }) => {
	const log: Wave[] = [];
	node.subscribe((msgs) => log.push(msgs));
	return log;
};

/** Forward every DATA array of every input. */
const forward = (ctx: Ctx) => {
	for (const d of ctx.deps)
		for (const w of d.waves) if (w.length > 0) ctx.down(w.map((v) => ["DATA", v]) as Wave);
};

/** N over [a] with a sink; the sink's START array is dropped. */
function over(fn: (ctx: Ctx) => void, opts: { invalidate?: "auto" | "manual" } = {}) {
	const g = graph();
	const a = g.state<unknown>(1, { name: "a" });
	const n = g.node<unknown>([a], fn, { name: "n", ...opts });
	const log = sinkOf(n);
	log.length = 0;
	return { g, a, n, log };
}

describe("C-56 (1) (R-failure@5): a throw drops everything its function sent in that run", () => {
	for (const invalidate of ["auto", "manual"] as const)
		it(`the sink receives the ERROR alone; a late sink gets the run before's value with it (${invalidate} INVALIDATE)`, () => {
			const f = over(
				(ctx) => {
					const v = ctx.deps[0].value;
					ctx.down([["DATA", v]]);
					if (v === 2) {
						ctx.down([["DATA", "second"]]);
						throw new Error("boom");
					}
				},
				{ invalidate },
			);
			f.a.set(2);
			expect(f.log).toEqual([pending(["ERROR", "boom"])]);
			expect(sinkOf(f.n)).toEqual([[["START"], ["DATA", 1], ["ERROR", "boom"]]]);
		});

	it("under the manual INVALIDATE policy an INVALIDATE sent before the throw is dropped too", () => {
		const f = over(
			(ctx) => {
				if (ctx.deps[0].invalidated) {
					ctx.down([["INVALIDATE"]]);
					throw new Error("boom");
				}
				ctx.down([["DATA", ctx.deps[0].value]]);
			},
			{ invalidate: "manual" },
		);
		f.a.invalidate();
		expect(f.log).toEqual([pending(["ERROR", "boom"])]);
		expect(sinkOf(f.n)).toEqual([[["START"], ["DATA", 1], ["ERROR", "boom"]]]);
	});
});

describe("C-56 (2) (R-terminals@2): the kernel's COMPLETE is an array of its own after the run's arrays", () => {
	it("a write and a COMPLETE in one batch: N's DATA, then the kernel's COMPLETE", () => {
		const f = over(forward);
		f.g.batch(() => {
			f.a.set(2);
			f.a.complete();
		});
		expect(f.log).toEqual([pending(["DATA", 2]), pending(["COMPLETE"])]);
	});

	it("a COMPLETE alone is one array", () => {
		const f = over(forward);
		f.a.complete();
		expect(f.log).toEqual([pending(["COMPLETE"])]);
	});

	it("where the function ended its own output the kernel adds none", () => {
		const f = over((ctx) => {
			forward(ctx);
			if (ctx.deps[0].terminal !== undefined) ctx.down([["DATA", "last"], ["COMPLETE"]]);
		});
		f.a.complete();
		expect(f.log).toEqual([pending(["DATA", "last"], ["COMPLETE"])]);
	});
});

describe("C-56 (3) (R-failure@5): a throw's ERROR payload", () => {
	const endedWith = (thrown: unknown) => {
		const f = over((ctx) => {
			if (ctx.deps[0].value === 2) throw thrown;
		});
		f.a.set(2);
		return f.log;
	};

	it.each([
		["an Error", new Error("boom"), "boom"],
		["a TypeError with a cause", new TypeError("bad", { cause: "why" }), "bad"],
		["a string", "text", "text"],
		["a number", 7, 7],
		["a record", { code: 1 }, { code: 1 }],
		["null", null, null],
		["undefined, which cannot be a payload", undefined, ""],
		["true, which cannot be a payload", true, ""],
		["false, which cannot be a payload", false, ""],
	])("thrown %s gives %j", (_, thrown, payload) => {
		expect(endedWith(thrown)).toEqual([pending(["ERROR", payload])]);
	});
});

describe("C-56 (4) (R-terminals@2, R-invalidation@2): an INVALIDATE in the wave of a dependency's ERROR takes effect first", () => {
	for (const invalidate of ["auto", "manual"] as const)
		for (const errorFirst of [true, false]) {
			const order = errorFirst ? "ERROR first" : "INVALIDATE first";
			const run = (g: Graph, a: { error(e: unknown): void }, b: { invalidate(): void }) =>
				g.batch(() => {
					if (errorFirst) a.error("bad");
					b.invalidate();
					if (!errorFirst) a.error("bad");
				});

			it(`holding a value, N sends INVALIDATE and then the ERROR (${invalidate} INVALIDATE, ${order})`, () => {
				const g = graph();
				const a = g.state(1, { name: "a" });
				const b = g.state(2, { name: "b" });
				const n = g.node<unknown>([a, b], forward, { name: "n", invalidate });
				const log = sinkOf(n);
				log.length = 0;
				run(g, a, b);
				expect(log).toEqual([pending(["INVALIDATE"]), pending(["ERROR", "bad"])]);
			});

			it(`holding no value, N sends the ERROR alone (${invalidate} INVALIDATE, ${order})`, () => {
				const g = graph();
				const a = g.state(1, { name: "a" });
				const b = g.state(2, { name: "b" });
				const n = g.node<unknown>([a, b], () => {}, { name: "n", invalidate });
				const log = sinkOf(n);
				log.length = 0;
				run(g, a, b);
				expect(log).toEqual([pending(["ERROR", "bad"])]);
			});
		}
});

describe("C-56 (5) (R-invalidation@2): an INVALIDATE and another input's DATA in one wave", () => {
	const held = (ctx: Ctx) =>
		ctx.down([
			["DATA", ctx.deps.map((d) => `${d.has ? d.value : "-"}${d.invalidated ? "!" : ""}`).join()],
		]);
	const setup = (invalidate: "auto" | "manual") => {
		const g = graph();
		const a = g.state(1, { name: "a" });
		const b = g.state(2, { name: "b" });
		let runs = 0;
		const n = g.node<unknown>(
			[a, b],
			(ctx) => {
				runs++;
				held(ctx);
			},
			{ name: "n", invalidate },
		);
		const log = sinkOf(n);
		log.length = 0;
		runs = 0;
		return { g, a, b, log, runs: () => runs };
	};

	for (const setFirst of [true, false])
		it(`under auto, N sends INVALIDATE first and then what its function sends (${setFirst ? "write first" : "INVALIDATE first"})`, () => {
			const f = setup("auto");
			f.g.batch(() => {
				if (setFirst) f.a.set(9);
				f.b.invalidate();
				if (!setFirst) f.a.set(9);
			});
			expect(f.log).toEqual([pending(["INVALIDATE"]), pending(["DATA", "9,-"])]);
		});

	for (const setFirst of [true, false])
		it(`under manual, the function runs once with the INVALIDATE as input, and the kernel sends none (${setFirst ? "write first" : "INVALIDATE first"})`, () => {
			const f = setup("manual");
			f.g.batch(() => {
				if (setFirst) f.a.set(9);
				f.b.invalidate();
				if (!setFirst) f.a.set(9);
			});
			expect(f.log).toEqual([pending(["DATA", "9,-!"])]);
			expect(f.runs()).toBe(1);
		});
});

/** N runs `attempt` on a's value 2: each attempt caught, then a DATA; or, with `uncaught`, one alone. */
function refusing(attempts: readonly Wave[], uncaught?: Wave) {
	const caught: unknown[] = [];
	const f = over((ctx) => {
		if (ctx.deps[0].value !== 2) return ctx.down([["DATA", "before"]]);
		for (const attempt of attempts) {
			try {
				ctx.down(attempt);
				caught.push(null);
			} catch (e) {
				caught.push(e);
			}
		}
		if (uncaught !== undefined) ctx.down(uncaught);
		ctx.down([["DATA", "after"]]);
	});
	f.a.set(2);
	return { ...f, caught };
}

const withoutPayload = [
	[["ERROR", true]],
	[["ERROR", false]],
	[["ERROR"]],
	[["DATA"]],
] as unknown as Wave[];
const extraFields = [
	[["COMPLETE", "x"]],
	[["INVALIDATE", "x"]],
	[["DATA", 1, 2]],
	[["ERROR", "e", "f"]],
] as unknown as Wave[];

describe("C-42 (R-messages@1, R-failure@5): ctx.down refuses a DATA or ERROR without its payload", () => {
	it("each is refused before anything is applied; N's retained value is the DATA sent afterwards", () => {
		const f = refusing(withoutPayload);
		expect(f.caught).toHaveLength(withoutPayload.length);
		for (const e of f.caught) expect(e).toBeInstanceOf(Error);
		expect(f.log).toEqual([pending(["DATA", "after"])]);
		expect(f.n.cache).toBe("after");
	});

	it.each(
		withoutPayload.map((w) => [JSON.stringify(w), w] as const),
	)("uncaught, %s is N's ERROR, with the refusal's message as its payload", (_, w) => {
		const f = refusing([], w);
		expect(f.log).toEqual([pending(["ERROR", expect.any(String)])]);
		expect(f.n.status.output).toBe("errored");
	});
});

describe("C-42 (R-messages@1, R-failure@5): ctx.down refuses a message with more than its type and payload", () => {
	it("each is refused before anything is applied; N's retained value is the DATA sent afterwards", () => {
		const f = refusing(extraFields);
		expect(f.caught).toHaveLength(extraFields.length);
		for (const e of f.caught) expect(e).toBeInstanceOf(Error);
		expect(f.log).toEqual([pending(["DATA", "after"])]);
		expect(f.n.cache).toBe("after");
	});

	it.each(
		extraFields.map((w) => [JSON.stringify(w), w] as const),
	)("uncaught, %s is N's ERROR, with the refusal's message as its payload", (_, w) => {
		const f = refusing([], w);
		expect(f.log).toEqual([pending(["ERROR", expect.any(String)])]);
		expect(f.n.status.output).toBe("errored");
	});
});

describe("C-42 (R-failure@5): the host's writes of a DATA or ERROR without its payload are refused", () => {
	const setup = () => {
		const g = graph();
		const a = g.state(1, { name: "a" });
		const other = g.state(0, { name: "other" });
		const log = sinkOf(a);
		log.length = 0;
		return { g, a, other, log };
	};
	const unchanged = (f: ReturnType<typeof setup>) => {
		expect(f.log).toEqual([]);
		expect(f.a.cache).toBe(1);
		expect(f.a.status.output).toBe("open");
	};

	it.each([
		["ERROR true", true],
		["ERROR false", false],
	])("ending a state with %s is refused; the state keeps its value and stays open", (_, payload) => {
		const f = setup();
		expect(() => f.a.error(payload)).toThrow();
		unchanged(f);
	});

	it("ending a state with no payload is refused", () => {
		const f = setup();
		expect(() => (f.a as unknown as { error(): void }).error()).toThrow();
		unchanged(f);
	});

	it("writing a state no value is refused, alone and after another write in a batch", () => {
		const f = setup();
		expect(() => f.a.set(none())).toThrow();
		unchanged(f);
		expect(() =>
			f.g.batch(() => {
				f.other.set(9);
				f.a.set(none());
			}),
		).toThrow();
		unchanged(f);
		expect(f.other.cache).toBe(0);
	});

	it("an updater given a value that returns none fails as one whose updater throws, alone and in a batch", () => {
		const f = setup();
		expect(() => f.a.set(() => none())).toThrow();
		unchanged(f);
		expect(() =>
			f.g.batch(() => {
				f.other.set(9);
				f.a.set(() => none());
			}),
		).toThrow();
		unchanged(f);
		expect(f.other.cache).toBe(0); // the other write of the commit is not made either
	});
});

describe("R-request-order@7: an updater given no value that returns none writes nothing", () => {
	it("alone, and after an INVALIDATE in a batch", () => {
		const g = graph();
		const empty = g.state<number>(none(), { name: "empty" });
		const full = g.state(1, { name: "full" });
		const es = sinkOf(empty);
		const fs = sinkOf(full);
		es.length = 0;
		fs.length = 0;
		empty.set(() => none());
		expect(es).toEqual([]);
		g.batch(() => {
			full.set(2);
			full.invalidate();
			full.set(() => none());
		});
		expect(fs).toEqual([pending(["INVALIDATE"])]);
		expect(full.status.cache).toBe("empty");
	});
});

describe('C-42 (R-failure@5): a function that throws undefined or a boolean ends its node with the payload ""', () => {
	it.each([
		["undefined", undefined, ""],
		["true", true, ""],
		["false", false, ""],
		["0", 0, 0],
		["null", null, null],
	])("a throw of %s at activation gives %j", (_, thrown, payload) => {
		const g = graph();
		const a = g.state(1, { name: "a" });
		const n = g.node<unknown>(
			[a],
			() => {
				throw thrown;
			},
			{ name: "n" },
		);
		expect(sinkOf(n)).toEqual([[["START"], ["ERROR", payload]]]);
		expect(n.status.output).toBe("errored");
	});
});

describe('C-42 (R-messages@1): an ERROR whose payload is null, 0 or "" is accepted', () => {
	it.each([
		["null", null],
		["0", 0],
		['""', ""],
	])("a node's function sends ERROR %s and ends with that payload", (_, payload) => {
		const f = over((ctx) => {
			if (ctx.deps[0].value === 2) ctx.down([["ERROR", payload] as Message]);
			else ctx.down([["DATA", ctx.deps[0].value]]);
		});
		f.a.set(2);
		expect(f.log).toEqual([pending(["ERROR", payload])]);
		expect(f.n.status.output).toBe("errored");
	});

	it.each([
		["null", null],
		["0", 0],
		['""', ""],
	])("the host ends a state with ERROR %s", (_, payload) => {
		const g = graph();
		const e = g.state(1, { name: "e" });
		const log = sinkOf(e);
		log.length = 0;
		e.error(payload);
		expect(log).toEqual([pending(["ERROR", payload])]);
		expect(e.status.output).toBe("errored");
	});
});

describe("C-60 (1) (R-wave@4): an empty array passed to ctx.down is no output", () => {
	it("alone in a run, the sink receives PENDING and RESOLVED and N keeps its value", () => {
		const f = over((ctx) => {
			if (ctx.deps[0].value === 2) ctx.down([]);
			else ctx.down([["DATA", ctx.deps[0].value]]);
		});
		f.a.set(2);
		expect(f.log).toEqual([pending(["RESOLVED"])]);
		expect(sinkOf(f.n)).toEqual([[["START"], ["DATA", 1]]]);
	});

	it("between two arrays that carry DATA, nothing stands for the empty one", () => {
		const f = over((ctx) => {
			ctx.down([["DATA", "x"]]);
			ctx.down([]);
			ctx.down([["DATA", ctx.deps[0].value]]);
			ctx.down([]);
		});
		f.a.set(2);
		expect(f.log).toEqual([pending(["DATA", "x"]), pending(["DATA", 2])]);
	});

	it("after the function returned it starts no wave; a call that carries DATA does", () => {
		let late: Ctx | undefined;
		const f = over((ctx) => {
			late = ctx;
			ctx.down([["DATA", ctx.deps[0].value]]);
		});
		late?.down([]);
		expect(f.log).toEqual([]);
		late?.down([["DATA", "late"]]);
		expect(f.log).toEqual([pending(["DATA", "late"])]);
	});
});
