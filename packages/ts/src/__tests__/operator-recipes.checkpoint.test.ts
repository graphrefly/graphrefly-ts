/**
 * R-checkpoint@1 (graphrefly:D802), TS layout (graphrefly-ts:D178): the built-in operators,
 * combinators and sources build their nodes with their recipes, so a graph built with them can be
 * restored. Each case drives a node until its values and private state are not trivial, captures,
 * restores through a JSON round trip, and checks the restored node continues as the original does
 * for the same next inputs.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { operatorRestoreRegistry } from "../graph/operator-restore.js";
import type { Message } from "../index.js";
import {
	buffer,
	bufferCount,
	combine,
	concat,
	defaultRestoreRegistry,
	elementAt,
	empty,
	fromTimer,
	type Graph,
	graph,
	interval,
	merge,
	type Node,
	never,
	of,
	pairwise,
	restoreGraph,
	type StateNode,
	skip,
	takeUntil,
	withLatestFrom,
	zip,
} from "../index.js";
import { checkpointStateOfNode } from "../node/runtime-accessors.js";

afterEach(() => {
	vi.useRealTimers();
});

const registry = { ...defaultRestoreRegistry, ...operatorRestoreRegistry };

function collect(n: Node<unknown> | undefined): Message[] {
	if (n === undefined) throw new Error("collect: missing node");
	const msgs: Message[] = [];
	n.subscribe((incoming) => {
		for (const m of incoming) msgs.push(m);
	});
	return msgs;
}
const st = <T>(g: Graph, id: string) => g.find(id) as unknown as StateNode<T>;
const privateStateOf = (n: Node<unknown> | undefined) =>
	checkpointStateOfNode(n as Node<unknown>).privateState;
const noPending = (msgs: readonly Message[]) => msgs.filter((m) => m[0] !== "PENDING");
/** Values and terminals only, without the kernel's PENDING and RESOLVED. */
const outputs = (msgs: readonly Message[]) =>
	msgs.filter((m) => m[0] === "DATA" || m[0] === "COMPLETE" || m[0] === "ERROR");
/** A value-less state: `undefined` is the sentinel (R-sentinel). */
const unset = <T>(g: Graph, name: string) => g.state<T>(undefined as unknown as T, { name });

function roundTrip(g: Graph): Graph {
	return restoreGraph(JSON.parse(JSON.stringify(g.checkpoint())), { registry });
}

/**
 * Build and drive the original, capture and restore it, then send the same next inputs to both and
 * return what node `op` sent after them in each.
 */
function continuesLike(
	build: (g: Graph) => void,
	drive: (g: Graph) => void,
	next: (g: Graph) => void,
) {
	const o = graph({ name: "original" });
	build(o);
	const oMsgs = collect(o.find("op"));
	drive(o);
	const checkpoint = o.checkpoint();
	const r = roundTrip(o);
	const rMsgs = collect(r.find("op"));
	const firstSeen = { original: noPending(oMsgs), restored: noPending(rMsgs) };
	const oStart = oMsgs.length;
	const rStart = rMsgs.length;
	next(o);
	next(r);
	const original = oMsgs.slice(oStart);
	const restored = rMsgs.slice(rStart);
	expect(restored).toEqual(original);
	expect(privateStateOf(r.find("op"))).toEqual(privateStateOf(o.find("op")));
	return { o, r, checkpoint, firstSeen, original: outputs(original) };
}

describe("operators carry recipes and restore (R-checkpoint@1)", () => {
	it("skip keeps how many it has skipped", () => {
		const { checkpoint, original } = continuesLike(
			(g) => g.initNode(skip<number>(3), [g.state(1, { name: "src" })], { name: "op" }),
			(g) => st<number>(g, "src").set(2),
			(g) => {
				st<number>(g, "src").set(3);
				st<number>(g, "src").set(4);
			},
		);
		const node = checkpoint.nodes.find((n) => n.id === "op");
		expect(node?.recipe).toEqual({ ref: "skip", config: { n: 3 } });
		expect(node?.lifetime?.state).toBe(2);
		expect(original).toEqual([["DATA", 4]]);
	});

	it("elementAt keeps its count", () => {
		const { checkpoint, original } = continuesLike(
			(g) => g.initNode(elementAt<number>(2), [g.state(10, { name: "src" })], { name: "op" }),
			(g) => st<number>(g, "src").set(11),
			(g) => st<number>(g, "src").set(12),
		);
		expect(checkpoint.nodes.find((n) => n.id === "op")?.recipe).toEqual({
			ref: "elementAt",
			config: { index: 2 },
		});
		expect(original).toEqual([["DATA", 12], ["COMPLETE"]]);
	});

	it("merge does not resend its first-run snapshot after restore", () => {
		const { firstSeen, original } = continuesLike(
			(g) =>
				g.initNode(merge<number>(), [g.state(1, { name: "a" }), g.state(2, { name: "b" })], {
					name: "op",
				}),
			(g) => st<number>(g, "a").set(3),
			(g) => {
				st<number>(g, "b").set(4);
				st<number>(g, "a").set(5);
			},
		);
		expect(firstSeen.restored).toEqual([["START"], ["DATA", 3]]);
		expect(original).toEqual([
			["DATA", 4],
			["DATA", 5],
		]);
	});

	it("pairwise keeps the previous value", () => {
		const { original } = continuesLike(
			(g) => g.initNode(pairwise<number>(), [g.state(1, { name: "src" })], { name: "op" }),
			(g) => st<number>(g, "src").set(2),
			(g) => st<number>(g, "src").set(3),
		);
		expect(original).toEqual([["DATA", [2, 3]]]);
	});
});

describe("combinators carry recipes and restore (R-checkpoint@1)", () => {
	it("combine restores with the latest tuple", () => {
		for (const make of [combine]) {
			const { checkpoint, original } = continuesLike(
				(g) =>
					g.initNode(make<[number, number]>(), [g.state(1, { name: "a" }), unset(g, "b")], {
						name: "op",
					}),
				(g) => st<number>(g, "b").set(2),
				(g) => st<number>(g, "a").set(3),
			);
			expect(checkpoint.nodes.find((n) => n.id === "op")?.recipe).toEqual({ ref: "combine" });
			expect(original).toEqual([["DATA", [3, 2]]]);
		}
	});

	it("withLatestFrom keeps the primary values it holds for the secondary", () => {
		const { checkpoint, original } = continuesLike(
			(g) =>
				g.initNode(withLatestFrom<number, string>(), [g.state(1, { name: "p" }), unset(g, "s")], {
					name: "op",
				}),
			(g) => st<number>(g, "p").set(2),
			(g) => {
				st<string>(g, "s").set("x");
				st<number>(g, "p").set(3);
			},
		);
		expect(checkpoint.nodes.find((n) => n.id === "op")?.lifetime?.state).toEqual([1, 2]);
		expect(original).toEqual([
			["DATA", [1, "x"]],
			["DATA", [2, "x"]],
			["DATA", [3, "x"]],
		]);
	});

	it("takeUntil forwards until its notifier fires", () => {
		const { original } = continuesLike(
			(g) =>
				g.initNode(takeUntil<number>(), [g.state(1, { name: "src" }), unset(g, "stop")], {
					name: "op",
				}),
			(g) => st<number>(g, "src").set(2),
			(g) => {
				st<number>(g, "src").set(3);
				st<boolean>(g, "stop").set(true);
			},
		);
		expect(original).toEqual([["DATA", 3], ["COMPLETE"]]);
	});

	it("zip keeps its queued values", () => {
		const { checkpoint, original } = continuesLike(
			(g) =>
				g.initNode(zip<[number, number]>(), [g.state(1, { name: "a" }), unset(g, "b")], {
					name: "op",
				}),
			(g) => {
				st<number>(g, "a").set(2);
				st<number>(g, "a").set(3);
			},
			(g) => {
				st<number>(g, "b").set(10);
				st<number>(g, "b").set(20);
			},
		);
		expect(checkpoint.nodes.find((n) => n.id === "op")?.lifetime?.state).toEqual({
			queues: [[1, 2, 3], []],
			terminal: [false, false],
		});
		expect(original).toEqual([
			["DATA", [1, 10]],
			["DATA", [2, 20]],
		]);
	});

	it("concat keeps the second source's values buffered in phase 0", () => {
		const { checkpoint, original } = continuesLike(
			(g) =>
				g.initNode(concat<number>(), [g.state(1, { name: "a" }), unset(g, "b")], { name: "op" }),
			(g) => {
				st<number>(g, "b").set(5);
				st<number>(g, "b").set(6);
			},
			(g) => {
				st<number>(g, "a").complete();
				st<number>(g, "b").set(7);
				st<number>(g, "b").complete();
			},
		);
		expect(checkpoint.nodes.find((n) => n.id === "op")?.lifetime?.state).toEqual({
			phase: 0,
			pending: [5, 6],
			secondDone: false,
		});
		expect(original).toEqual([["DATA", 5], ["DATA", 6], ["DATA", 7], ["COMPLETE"]]);
	});

	it("buffer keeps a partial buffer", () => {
		const { checkpoint, original } = continuesLike(
			(g) =>
				g.initNode(buffer<number>(), [g.state(1, { name: "src" }), unset(g, "flush")], {
					name: "op",
				}),
			(g) => st<number>(g, "src").set(2),
			(g) => {
				st<number>(g, "src").set(3);
				st<boolean>(g, "flush").set(true);
			},
		);
		expect(checkpoint.nodes.find((n) => n.id === "op")?.lifetime?.state).toEqual([1, 2]);
		expect(original).toEqual([["DATA", [1, 2, 3]]]);
	});

	it("bufferCount keeps a partial buffer", () => {
		const { checkpoint, original } = continuesLike(
			(g) => g.initNode(bufferCount<number>(3), [g.state(1, { name: "src" })], { name: "op" }),
			(g) => st<number>(g, "src").set(2),
			(g) => {
				for (const v of [3, 4, 5, 6]) st<number>(g, "src").set(v);
			},
		);
		expect(checkpoint.nodes.find((n) => n.id === "op")?.recipe).toEqual({
			ref: "bufferCount",
			config: { count: 3 },
		});
		expect(original).toEqual([
			["DATA", [1, 2, 3]],
			["DATA", [4, 5, 6]],
		]);
	});
});

describe("sources carry recipes and restore (R-checkpoint@1)", () => {
	it("interval counts on from its saved tick count", () => {
		vi.useFakeTimers();
		const { checkpoint, original } = continuesLike(
			(g) => g.initNode(interval(10), [], { name: "op" }),
			() => vi.advanceTimersByTime(30),
			() => {},
		);
		const node = checkpoint.nodes.find((n) => n.id === "op");
		expect(node?.recipe).toEqual({ ref: "interval", config: { ms: 10 } });
		expect(node?.lifetime?.state).toBe(3);
		expect(original).toEqual([]);
		// Both graphs share the clock: the original and the restored node tick on together.
		const o = graph();
		o.initNode(interval(10), [], { name: "op" });
		const oMsgs = collect(o.find("op"));
		vi.advanceTimersByTime(30);
		const r = roundTrip(o);
		const rMsgs = collect(r.find("op"));
		const [oStart, rStart] = [oMsgs.length, rMsgs.length];
		vi.advanceTimersByTime(20);
		expect(noPending(rMsgs.slice(rStart))).toEqual([
			["DATA", 3],
			["DATA", 4],
		]);
		expect(rMsgs.slice(rStart)).toEqual(oMsgs.slice(oStart));
	});

	it("fromTimer with a period counts on; a one-shot fromTimer runs fresh", () => {
		vi.useFakeTimers();
		const o = graph();
		o.initNode(fromTimer(10, { period: 10 }), [], { name: "op" });
		o.initNode(fromTimer(7), [], { name: "once" });
		const oMsgs = collect(o.find("op"));
		vi.advanceTimersByTime(20);
		const checkpoint = o.checkpoint();
		expect(checkpoint.nodes.map((n) => n.recipe)).toEqual([
			{ ref: "fromTimer", config: { ms: 10, period: 10 } },
			{ ref: "fromTimer", config: { ms: 7 } },
		]);
		const r = roundTrip(o);
		const rMsgs = collect(r.find("op"));
		const once = collect(r.find("once"));
		const [oStart, rStart] = [oMsgs.length, rMsgs.length];
		vi.advanceTimersByTime(10);
		expect(noPending(rMsgs.slice(rStart))).toEqual([["DATA", 2]]);
		expect(rMsgs.slice(rStart)).toEqual(oMsgs.slice(oStart));
		expect(noPending(once)).toEqual([["START"], ["DATA", 0], ["COMPLETE"]]);
	});

	it("of, empty and never restore before and after they ran", () => {
		const o = graph();
		o.initNode(of<unknown>(1, { a: 2 }), [], { name: "fresh" });
		o.initNode(of(3, 4), [], { name: "ran" });
		o.initNode(empty(), [], { name: "none" });
		o.initNode(never(), [], { name: "quiet" });
		const ran = collect(o.find("ran"));
		const checkpoint = o.checkpoint();
		expect(Object.fromEntries(checkpoint.nodes.map((n) => [n.id, n.recipe]))).toEqual({
			fresh: { ref: "of", config: { values: [1, { a: 2 }] } },
			ran: { ref: "of", config: { values: [3, 4] } },
			none: { ref: "empty" },
			quiet: { ref: "never" },
		});
		const r = roundTrip(o);
		expect(collect(r.find("fresh"))).toEqual([
			["START"],
			["DATA", 1],
			["DATA", { a: 2 }],
			["COMPLETE"],
		]);
		expect(collect(r.find("ran"))).toEqual(ran);
		expect(r.find("ran")?.status.output).toBe("completed");
		expect(collect(r.find("none"))).toEqual([["START"], ["COMPLETE"]]);
		expect(collect(r.find("quiet"))).toEqual([["START"]]);
	});

	it("a source whose parameters are not JSON stays local-only", () => {
		const g = graph();
		g.initNode(
			of(() => 1),
			[],
			{ name: "fnValue" },
		);
		g.initNode(fromTimer(5, { signal: new AbortController().signal }), [], { name: "signalled" });
		expect(g.checkpoint().nodes.map((n) => n.recipe)).toEqual([undefined, undefined]);
	});
});
