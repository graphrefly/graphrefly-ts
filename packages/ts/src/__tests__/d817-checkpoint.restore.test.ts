/**
 * D817 checkpoint re-port, step 1 (graphrefly-ts:D817): what a restored graph holds and does.
 *
 * TS harness for the restore clauses of the root scenario C-38 in
 * ~/src/graphrefly/spec/conformance.jsonl, against R-checkpoint@3 (graphrefly:D819, D812, D825),
 * R-subscription@5 and R-lifetime@2: a restored graph has no subscribers and a restored node
 * receives no waves before its first activation; at that activation its setup runs, its recipe
 * function runs once only if a dependency no longer holds what it had received, with only the
 * changed dependencies as input, and a run that sends nothing keeps the saved value. Also the
 * ended node, the node rewired for its lifetime, the timer source, pending work recorded in private
 * state, a second capture before anything subscribes, and the restored graph's creation order.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "../ctx/types.js";
import type { GraphCheckpoint } from "../graph/checkpoint.js";
import { graph } from "../graph/graph.js";
import { type GraphRestoreRegistry, restoreGraph } from "../graph/restore.js";
import type { Node, StateNode } from "../node/node.js";
import type { Wave } from "../protocol/messages.js";

type Graph = ReturnType<typeof graph>;

afterEach(() => {
	vi.useRealTimers();
});

const pending = (...msgs: Wave): Wave => [["PENDING"], ...msgs];
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const ids = (g: Graph) => g.describe().map((n) => n.id);
const current = (g: Graph, id: string) => g.describe().find((n) => n.id === id)?.deps;
const idOf = (g: Graph, dep: unknown) =>
	typeof dep === "string" ? dep : g.describe().find((n) => g.find(n.id) === dep)?.id;
const declared = (g: Graph, id: string) => g.definition(id).deps.map((d) => idOf(g, d));
const stateOf = <T>(g: Graph, id: string) => g.find(id) as unknown as StateNode<T>;
const nodeOf = (g: Graph, id: string) => {
	const n = g.find(id);
	if (n === undefined) throw new Error(`no node ${id}`);
	return n;
};
const sinkOf = (node: Node<unknown>) => {
	const log: Wave[] = [];
	const stop = node.subscribe((msgs) => log.push(msgs));
	// Not enumerable, so a log still equals the plain array of what it received.
	Object.defineProperty(log, "stop", { value: stop, enumerable: false });
	return log as Wave[] & { readonly stop: () => void };
};
const byId = (cp: GraphCheckpoint) => Object.fromEntries(cp.nodes.map((n) => [n.id, n]));

function refusal(run: () => unknown): string {
	try {
		run();
	} catch (e) {
		return e instanceof Error ? e.message : String(e);
	}
	return "no refusal";
}

/** What one run of a recorded function was given, per dependency, and the private state it found. */
interface Run {
	readonly state: unknown;
	readonly deps: readonly {
		readonly id: string;
		readonly waves: readonly (readonly unknown[])[];
		readonly has: boolean;
		readonly value: unknown;
		readonly terminal: unknown;
	}[];
}
const record = (ctx: Ctx): Run => ({
	state: ctx.state.get(),
	deps: ctx.deps.map((d) => ({
		id: d.id,
		waves: d.waves.map((w) => [...w]),
		has: d.has,
		value: d.value,
		terminal: d.terminal,
	})),
});

/**
 * The C-38 kernel graph: a = 1, b = 5; p over [a] built from a recipe, counting its runs in
 * private state and sending ten times the last value it was given (a 0 sends nothing); q over
 * [a, b], the sum of its dependencies' latest values; the ended node `ended` over [a], which sends
 * a + 100 and COMPLETE; and `rew`, declared over [a], which rewires itself to [a, b] in its first
 * run and sends the sum. Every node is subscribed when the checkpoint is taken.
 */
function c38() {
	const runs: Record<string, Run[]> = { p: [], q: [], ended: [], rew: [] };
	const p = (ctx: Ctx) => {
		runs.p.push(record(ctx));
		ctx.state.set({ runs: (ctx.state.get<{ runs: number }>()?.runs ?? 0) + 1 });
		const v = ctx.deps[0].waves.flat().at(-1);
		if (typeof v === "number" && v !== 0) ctx.down([["DATA", v * 10]]);
	};
	const q = (ctx: Ctx) => {
		runs.q.push(record(ctx));
		ctx.down([["DATA", ctx.deps.reduce((s, d) => s + ((d.value as number | undefined) ?? 0), 0)]]);
	};
	const ended = (ctx: Ctx) => {
		runs.ended.push(record(ctx));
		ctx.state.set({ seen: true });
		ctx.down([["DATA", (ctx.deps[0].value as number) + 100], ["COMPLETE"]]);
	};
	const rew = (g: Graph) => (ctx: Ctx) => {
		runs.rew.push(record(ctx));
		if (ctx.deps.length === 1) ctx.rewire([nodeOf(g, "a"), nodeOf(g, "b")]);
		ctx.down([["DATA", ctx.deps.reduce((s, d) => s + ((d.value as number | undefined) ?? 0), 0)]]);
	};
	const registry: GraphRestoreRegistry = {
		p: { ref: "p", build: () => ({ fn: p }) },
		q: { ref: "q", build: () => ({ fn: q }) },
		ended: { ref: "ended", build: () => ({ fn: ended }) },
		rew: { ref: "rew", build: (_config, ctx) => ({ fn: rew(ctx.graph) }) },
	};
	const g = graph();
	const a = g.state(1, { name: "a" });
	const b = g.state(5, { name: "b" });
	const nodes = [
		g.node([a], p, { name: "p", recipe: { ref: "p" } }),
		g.node([a, b], q, { name: "q", recipe: { ref: "q" } }),
		g.node([a], ended, { name: "ended", recipe: { ref: "ended" } }),
		g.node([a], rew(g), { name: "rew", recipe: { ref: "rew" } }),
	];
	for (const n of nodes) n.subscribe(() => {});
	const cp = roundTrip(g.checkpoint());
	for (const list of Object.values(runs)) list.length = 0;
	const restore = () => restoreGraph(cp, { registry });
	return { g, runs, registry, cp, restore };
}

describe("C-38 (R-checkpoint@3): a restored graph runs nothing and holds no subscribers", () => {
	it("C-38 (R-checkpoint@3): restore runs no function and gives the same description, a rewired node over its declared dependencies", () => {
		const f = c38();
		const r = f.restore();
		expect(f.runs).toEqual({ p: [], q: [], ended: [], rew: [] });
		const live = f.g.describe().map((n) => (n.id === "rew" ? { ...n, deps: ["a"] } : n));
		expect(r.describe()).toEqual(live);
		for (const id of ids(r)) expect(nodeOf(r, id).status.lifecycle, id).toBe("inactive");
	});

	it("C-38 (R-checkpoint@3): the first subscription gets p's saved values and p keeps its private state, without p running", () => {
		const f = c38();
		const r = f.restore();
		const p = sinkOf(nodeOf(r, "p"));
		expect(p).toEqual([[["START"], ["DATA", 10]]]);
		expect(f.runs.p).toEqual([]);
		stateOf<number>(r, "a").set(3);
		expect(p.slice(1)).toEqual([pending(["DATA", 30])]);
		expect(f.runs.p.map((run) => run.state)).toEqual([{ runs: 1 }]);
	});

	it("C-38 (R-checkpoint@3): before its first activation a restored node receives no waves", () => {
		const f = c38();
		const r = f.restore();
		stateOf<number>(r, "a").set(2);
		stateOf<number>(r, "a").set(3);
		expect(f.runs.p).toEqual([]);
		expect(nodeOf(r, "p").status.lifecycle).toBe("inactive");
		expect(sinkOf(nodeOf(r, "p"))).toEqual([[["START"], ["DATA", 30]]]);
		expect(f.runs.p).toHaveLength(1);
	});
});

describe("C-38 (R-checkpoint@3): at its first activation a restored node runs once only on a changed dependency", () => {
	it("C-38 (R-checkpoint@3): a changed a runs p once, with a as its input, on its saved private state", () => {
		const f = c38();
		const r = f.restore();
		stateOf<number>(r, "a").set(2);
		expect(sinkOf(nodeOf(r, "p"))).toEqual([[["START"], ["DATA", 20]]]);
		expect(f.runs.p).toEqual([
			{
				state: { runs: 1 },
				deps: [{ id: "a", waves: [[2]], has: true, value: 2, terminal: undefined }],
			},
		]);
	});

	it("C-38 (R-checkpoint@3): the run gets only the changed dependencies as input", () => {
		const f = c38();
		const r = f.restore();
		stateOf<number>(r, "a").set(2);
		expect(sinkOf(nodeOf(r, "q"))).toEqual([[["START"], ["DATA", 7]]]);
		expect(f.runs.q).toEqual([
			{
				state: undefined,
				deps: [
					{ id: "a", waves: [[2]], has: true, value: 2, terminal: undefined },
					{ id: "b", waves: [], has: true, value: 5, terminal: undefined },
				],
			},
		]);
	});

	it("C-38 (R-checkpoint@3): a run that sends nothing keeps the saved value", () => {
		const f = c38();
		const r = f.restore();
		stateOf<number>(r, "a").set(0);
		expect(sinkOf(nodeOf(r, "p"))).toEqual([[["START"], ["DATA", 10]]]);
		expect(f.runs.p).toHaveLength(1);
		expect(nodeOf(r, "p").cache).toBe(10);
	});

	it("C-38 (R-checkpoint@3): an INVALIDATE followed by a set of another value is seen as the set alone", () => {
		const f = c38();
		const r = f.restore();
		stateOf<number>(r, "a").invalidate();
		stateOf<number>(r, "a").set(3);
		expect(sinkOf(nodeOf(r, "p"))).toEqual([[["START"], ["DATA", 30]]]);
		expect(f.runs.p.map((run) => run.deps)).toEqual([
			[{ id: "a", waves: [[3]], has: true, value: 3, terminal: undefined }],
		]);
	});

	it("C-38 (R-checkpoint@3): an INVALIDATE followed by a set of the value p had received is not seen: p does not run", () => {
		const f = c38();
		const r = f.restore();
		stateOf<number>(r, "a").invalidate();
		stateOf<number>(r, "a").set(1);
		expect(sinkOf(nodeOf(r, "p"))).toEqual([[["START"], ["DATA", 10]]]);
		expect(f.runs.p).toEqual([]);
	});

	it("C-38 (R-checkpoint@3): an INVALIDATE alone is seen as a dependency that holds no value, and p keeps its value", () => {
		const f = c38();
		const r = f.restore();
		stateOf<number>(r, "a").invalidate();
		expect(sinkOf(nodeOf(r, "p"))).toEqual([[["START"], ["DATA", 10]]]);
		expect(f.runs.p.map((run) => run.deps)).toEqual([
			[{ id: "a", waves: [], has: false, value: undefined, terminal: undefined }],
		]);
		expect(nodeOf(r, "p").cache).toBe(10);
	});

	it("C-38 (R-checkpoint@3): a dependency that only completed brings its COMPLETE without its values again", () => {
		const f = c38();
		const r = f.restore();
		stateOf<number>(r, "a").complete();
		expect(sinkOf(nodeOf(r, "p"))).toEqual([[["START"], ["DATA", 10], ["COMPLETE"]]]);
		expect(f.runs.p.map((run) => run.deps)).toEqual([
			[{ id: "a", waves: [], has: true, value: 1, terminal: { kind: "complete" } }],
		]);
	});
});

describe("C-38 (R-checkpoint@3): ended and rewired nodes", () => {
	it("C-38 (R-checkpoint@3): the ended node comes back ended with its dependencies, and a subscriber gets its terminal snapshot", () => {
		const f = c38();
		const r = f.restore();
		expect(current(r, "ended")).toEqual(["a"]);
		expect(nodeOf(r, "ended").status.output).toBe("completed");
		expect(sinkOf(nodeOf(r, "ended"))).toEqual([[["START"], ["DATA", 101], ["COMPLETE"]]]);
		stateOf<number>(r, "a").set(2);
		expect(f.runs.ended).toEqual([]);
		// Captured again, its record is the same: values and terminal, no private state.
		expect(byId(roundTrip(r.checkpoint())).ended).toEqual(byId(f.cp).ended);
	});

	it("C-38 (R-checkpoint@3): the rewired node is restored onto its lifetime's dependencies, and closing it puts back the declared ones", () => {
		const f = c38();
		const r = f.restore();
		expect(current(r, "rew")).toEqual(["a"]);
		const rew = sinkOf(nodeOf(r, "rew"));
		expect(rew).toEqual([[["START"], ["DATA", 6]]]);
		expect(f.runs.rew).toEqual([]);
		expect(current(r, "rew")).toEqual(["a", "b"]);
		expect(declared(r, "rew")).toEqual(["a"]);
		stateOf<number>(r, "b").set(7);
		expect(rew.slice(1)).toEqual([pending(["DATA", 8])]);
		rew.stop();
		expect(current(r, "rew")).toEqual(["a"]);
	});
});

describe("C-38 (R-checkpoint@3): a second capture and the restored creation order", () => {
	it("C-38 (R-checkpoint@3): a restored graph captured again before anything subscribes saves the same checkpoint", () => {
		const f = c38();
		const r = f.restore();
		expect(byId(roundTrip(r.checkpoint()))).toEqual(byId(f.cp));
	});

	it("C-38 (R-checkpoint@3): captured again after an unseen change, it restores to the same state", () => {
		const f = c38();
		const once = f.restore();
		stateOf<number>(once, "a").set(4);
		const twice = restoreGraph(roundTrip(once.checkpoint()), { registry: f.registry });
		expect(sinkOf(nodeOf(twice, "p"))).toEqual([[["START"], ["DATA", 40]]]);
		expect(f.runs.p.map((run) => run.state)).toEqual([{ runs: 1 }]);
	});

	it("C-38 (R-checkpoint@3): no checkpoint carries revision or version evidence", () => {
		const f = c38();
		const keys: string[] = [];
		const walk = (x: unknown) => {
			if (x === null || typeof x !== "object") return;
			for (const [k, v] of Object.entries(x)) {
				keys.push(k);
				walk(v);
			}
		};
		walk(f.cp);
		expect(keys.filter((k) => /revision|version/i.test(k))).toEqual([]);
	});

	/** A graph made in the order a, n, x, late, y, where n was replaced onto late. */
	function lateOrder(lateOverX: boolean) {
		// Sends how many dependencies it has, so a value that is not JSON passes through it unread.
		const sum = (ctx: Ctx) => ctx.down([["DATA", ctx.deps.length]]);
		const registry: GraphRestoreRegistry = { sum: { ref: "sum", build: () => ({ fn: sum }) } };
		const R = { recipe: { ref: "sum" } };
		const g = graph();
		const a = g.state(1, { name: "a" });
		const n = g.node([a], sum, { name: "n", ...R });
		const x = g.state<unknown>(1, { name: "x" });
		const late = lateOverX
			? g.node<unknown>([x], sum, { name: "late", ...R })
			: g.state<unknown>(4, { name: "late" });
		g.node([a], sum, { name: "y", ...R });
		g.replace(n, [late], sum, R);
		return { g, registry, r: restoreGraph(roundTrip(g.checkpoint()), { registry }) };
	}

	it("C-38 (R-checkpoint@3): a dependency made after a node replaced onto it is built before that node; the others keep their order", () => {
		const plain = lateOrder(false);
		expect([ids(plain.g), ids(plain.r)]).toEqual([
			["a", "n", "x", "late", "y"],
			["a", "late", "n", "x", "y"],
		]);
		const overX = lateOrder(true);
		expect([ids(overX.g), ids(overX.r)]).toEqual([
			["a", "n", "x", "late", "y"],
			["a", "x", "late", "n", "y"],
		]);
	});

	it("C-38 (R-checkpoint@3): a node's unbuilt dependencies are built in their declared order", () => {
		const sum = (ctx: Ctx) => ctx.down([["DATA", ctx.deps.length]]);
		const registry: GraphRestoreRegistry = { sum: { ref: "sum", build: () => ({ fn: sum }) } };
		const g = graph();
		const a = g.state(1, { name: "a" });
		const n = g.node([a], sum, { name: "n", recipe: { ref: "sum" } });
		const first = g.state(1, { name: "first" });
		const second = g.state(2, { name: "second" });
		g.replace(n, [second, first], sum, { recipe: { ref: "sum" } });
		const r = restoreGraph(roundTrip(g.checkpoint()), { registry });
		expect(ids(r)).toEqual(["a", "second", "first", "n"]);
	});

	it("C-38 (R-checkpoint@3): each capture names the first node in its own graph's order", () => {
		// Subscribed, n holds what it received from late: the original meets n first, the restore late.
		const subscribed = lateOrder(false);
		for (const x of [subscribed.g, subscribed.r]) {
			nodeOf(x, "n").subscribe(() => {});
			stateOf<unknown>(x, "late").set(1n);
		}
		expect(refusal(() => subscribed.g.checkpoint())).toBe(
			"not restorable: n: its received values are not JSON",
		);
		expect(refusal(() => subscribed.r.checkpoint())).toBe(
			"not restorable: late: its retained values are not JSON",
		);
		// Not subscribed, n holds nothing: with x between, the original meets x first, the restore late.
		const between = lateOrder(false);
		for (const x of [between.g, between.r]) {
			stateOf<unknown>(x, "x").set(1n);
			stateOf<unknown>(x, "late").set(1n);
		}
		expect(refusal(() => between.g.checkpoint())).toBe(
			"not restorable: x: its retained values are not JSON",
		);
		expect(refusal(() => between.r.checkpoint())).toBe(
			"not restorable: late: its retained values are not JSON",
		);
	});

	it("C-38 (R-checkpoint@3): a recipe node made before its dependency that ended itself is saved with its values and terminal alone", () => {
		const once = (ctx: Ctx) => ctx.down([["DATA", 1], ["COMPLETE"]]);
		const registry: GraphRestoreRegistry = { once: { ref: "once", build: () => ({ fn: once }) } };
		const R = { recipe: { ref: "once" } };
		const built = () => {
			const g = graph();
			const n = g.node([], () => {}, { name: "n", ...R });
			const late = g.state<unknown>(1, { name: "late" });
			g.replace(n, [late], once, R);
			n.subscribe(() => {});
			return { g, n, late };
		};
		const f = built();
		expect(f.n.status.output).toBe("completed");
		f.late.set(3);
		const cp = roundTrip(f.g.checkpoint());
		const r = restoreGraph(cp, { registry });
		expect(sinkOf(nodeOf(r, "n"))).toEqual([[["START"], ["DATA", 1], ["COMPLETE"]]]);
		expect(byId(roundTrip(r.checkpoint()))).toEqual(byId(cp));

		const bad = built();
		bad.late.set(1n);
		expect(refusal(() => bad.g.checkpoint())).toBe(
			"not restorable: late: its retained values are not JSON",
		);
	});
});

describe("C-38 (R-checkpoint@3): a setup runs again at the restored first activation", () => {
	it("C-38 (R-checkpoint@3): the timer source's setup starts one timer, its function does not run, and it counts on from its saved state", () => {
		const timers = new Set<() => void>();
		const counts = { setups: 0, runs: 0 };
		const tick = () => {
			for (const t of [...timers]) t();
		};
		const fn = () => {
			counts.runs += 1;
		};
		const setup = (ctx: Ctx) => {
			counts.setups += 1;
			const t = () => {
				const n = (ctx.state.get<number>() ?? 0) + 1;
				ctx.state.set(n);
				ctx.down([["DATA", n]]);
			};
			timers.add(t);
			return () => {
				timers.delete(t);
			};
		};
		const registry: GraphRestoreRegistry = {
			interval: { ref: "interval", build: () => ({ fn, setup }) },
		};
		const g = graph();
		const i = g.node<number>([], fn, { name: "i", setup, recipe: { ref: "interval" } });
		const live = sinkOf(i);
		tick();
		tick();
		const cp = roundTrip(g.checkpoint());
		live.stop();
		expect(timers.size).toBe(0);
		counts.setups = 0;
		counts.runs = 0;

		const r = restoreGraph(cp, { registry });
		expect(counts).toEqual({ setups: 0, runs: 0 });
		const log = sinkOf(nodeOf(r, "i"));
		expect(log).toEqual([[["START"], ["DATA", 2]]]);
		expect([counts.setups, counts.runs, timers.size]).toEqual([1, 0, 1]);
		tick();
		expect(log.slice(1)).toEqual([pending(["DATA", 3])]);
	});

	it("C-38 (R-checkpoint@3): a node replaced with a recipe and another setup is restored as that recipe, with that instance's setup", () => {
		const setups: string[] = [];
		const named = (name: string) => ({
			fn: (ctx: Ctx) => ctx.down([["DATA", name]]),
			setup: () => {
				setups.push(name);
			},
		});
		const registry: GraphRestoreRegistry = {
			A: { ref: "A", build: () => named("A") },
			B: { ref: "B", build: () => named("B") },
		};
		const g = graph();
		const first = named("A");
		const n = g.node<string>([], first.fn, { name: "n", setup: first.setup, recipe: { ref: "A" } });
		const live = sinkOf(n);
		const second = named("B");
		g.replace(n, [], second.fn, { setup: second.setup, recipe: { ref: "B" } });
		expect(live).toEqual([
			[["START"], ["DATA", "A"]],
			[["START"], ["DATA", "B"]],
		]);
		expect(setups.splice(0)).toEqual(["A", "B"]);
		const r = restoreGraph(roundTrip(g.checkpoint()), { registry });
		expect(r.definition("n").recipe).toEqual({ ref: "B" });
		expect(sinkOf(nodeOf(r, "n"))).toEqual([[["START"], ["DATA", "B"]]]);
		expect(setups).toEqual(["B"]);
	});

	it("C-38 (R-checkpoint@3): pending work recorded in private state is opened again by the setup and runs its full duration; work kept outside it is lost", () => {
		vi.useFakeTimers();
		const DURATION = 100;
		/**
		 * On a new input, starts work that finishes after DURATION with twice the input. `kept` records
		 * the work in its private state, as JSON; `lost` keeps it in a variable of its own. The timer
		 * is stopped when the lifetime's signal aborts.
		 */
		const worker = (recordsWork: boolean) => {
			let outside: number | undefined;
			const start = (ctx: Ctx, v: number) => {
				const id = setTimeout(() => {
					if (recordsWork) ctx.state.set({ pending: null });
					else outside = undefined;
					ctx.down([["DATA", v * 2]]);
				}, DURATION);
				ctx.signal.addEventListener("abort", () => clearTimeout(id));
			};
			const fn = (ctx: Ctx) => {
				const v = ctx.deps[0].waves.flat().at(-1);
				if (typeof v !== "number") return;
				if (recordsWork) ctx.state.set({ pending: v });
				else outside = v;
				start(ctx, v);
			};
			const setup = (ctx: Ctx) => {
				const work = recordsWork ? ctx.state.get<{ pending: number | null }>()?.pending : outside;
				if (typeof work === "number") start(ctx, work);
			};
			return { fn, setup };
		};
		const registry: GraphRestoreRegistry = {
			kept: { ref: "kept", build: () => worker(true) },
			lost: { ref: "lost", build: () => worker(false) },
		};
		const g = graph();
		const a = g.state(1, { name: "a" });
		const live = { kept: worker(true), lost: worker(false) };
		const stops = (["kept", "lost"] as const).map((id) =>
			sinkOf(
				g.node<number>([a], live[id].fn, { name: id, setup: live[id].setup, recipe: { ref: id } }),
			),
		);
		vi.advanceTimersByTime(40);
		const cp = roundTrip(g.checkpoint());
		for (const s of stops) s.stop();

		const r = restoreGraph(cp, { registry });
		const kept = sinkOf(nodeOf(r, "kept"));
		const lost = sinkOf(nodeOf(r, "lost"));
		expect([kept, lost]).toEqual([[[["START"]]], [[["START"]]]]);
		vi.advanceTimersByTime(DURATION - 1);
		expect(kept.slice(1)).toEqual([]);
		vi.advanceTimersByTime(1);
		expect(kept.slice(1)).toEqual([pending(["DATA", 2])]);
		vi.advanceTimersByTime(DURATION * 2);
		expect(lost.slice(1)).toEqual([]);
	});
});

describe("C-38 (R-checkpoint@3): saved policies and refused records", () => {
	it("C-38 (R-checkpoint@3): a node's policies come back from its record, whatever its factory gives", () => {
		const fn = (ctx: Ctx) => ctx.down([["DATA", ctx.deps.length]]);
		const registry: GraphRestoreRegistry = { n: { ref: "n", build: () => ({ fn }) } };
		const g = graph();
		const a = g.state(1, { name: "a" });
		g.node([a], fn, {
			name: "n",
			recipe: { ref: "n" },
			complete: "manual",
			error: "manual",
			invalidate: "manual",
			quiet: true,
		});
		const r = restoreGraph(roundTrip(g.checkpoint()), { registry });
		const policies = (x: Graph) => {
			const { complete, error, invalidate, quiet } = x.definition("n");
			return { complete, error, invalidate, quiet };
		};
		expect(policies(r)).toEqual({
			complete: "manual",
			error: "manual",
			invalidate: "manual",
			quiet: true,
		});
	});

	it("C-38 (R-checkpoint@3): a duplicate id or a dependency cycle is refused before any factory runs", () => {
		const f = c38();
		let calls = 0;
		const counting: GraphRestoreRegistry = Object.fromEntries(
			Object.entries(
				f.registry as Record<string, { ref: string; build: (...xs: never[]) => unknown }>,
			).map(([ref, entry]) => [
				ref,
				{
					ref,
					build: (...xs: never[]) => {
						calls += 1;
						return entry.build(...xs);
					},
				},
			]),
		) as GraphRestoreRegistry;
		const duplicate = roundTrip(f.cp);
		duplicate.nodes.push({ ...roundTrip(byId(f.cp).p), id: "p" });
		expect(() => restoreGraph(duplicate, { registry: counting })).toThrow();
		const cycle = roundTrip(f.cp);
		byId(cycle).p.deps = ["q"];
		byId(cycle).q.deps = ["p", "b"];
		expect(() => restoreGraph(cycle, { registry: counting })).toThrow();
		expect(calls).toBe(0);
	});
});
