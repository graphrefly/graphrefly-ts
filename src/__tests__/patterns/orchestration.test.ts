import { describe, expect, it } from "vitest";
import { DATA, TEARDOWN } from "../../core/messages.js";
import { state } from "../../core/sugar.js";
import { Graph } from "../../graph/graph.js";
import {
	approval,
	branch,
	forEach,
	type GateController,
	gate,
	join,
	loop,
	onFailure,
	pipeline,
	sensor,
	subPipeline,
	task,
	valve,
	wait,
} from "../../patterns/orchestration.js";

describe("patterns.orchestration", () => {
	it("pipeline creates a Graph container", () => {
		const g = pipeline("wf");
		expect(g).toBeInstanceOf(Graph);
		expect(g.name).toBe("wf");
	});

	it("task registers a computed step and wires dependency edges", () => {
		const g = pipeline("wf");
		const input = state(1);
		g.add("input", input);
		const doubled = task<number>(g, "double", ([v]) => ((v as number) * 2) as number, {
			deps: ["input"],
		});
		doubled.subscribe(() => undefined);
		g.set("input", 3);
		expect(g.get("double")).toBe(6);
		expect(g.edges()).toContainEqual(["input", "double"]);
	});

	it("task with Node deps still records explicit graph edges", () => {
		const g = pipeline("wf");
		const input = state(2);
		g.add("input", input);
		task<number>(g, "doubleByRef", ([v]) => ((v as number) * 2) as number, {
			deps: [input],
		});
		expect(g.edges()).toContainEqual(["input", "doubleByRef"]);
	});

	it("branch emits tagged branch results", () => {
		const g = pipeline("wf");
		const input = state(1);
		g.add("input", input);
		const out = branch<number>(g, "route", "input", (v) => v >= 2);
		const seen: Array<"then" | "else"> = [];
		out.subscribe((msgs) => {
			for (const msg of msgs) {
				if (msg[0] === DATA) {
					const payload = msg[1] as { branch: "then" | "else" };
					seen.push(payload.branch);
				}
			}
		});
		g.set("input", 2);
		expect(seen).toContain("else");
		expect(seen).toContain("then");
	});

	it("task and branch describe as derived with canonical orchestration metadata", () => {
		const g = pipeline("wf");
		const input = state(1);
		g.add("input", input);
		task<number>(g, "t", ([v]) => v as number, { deps: ["input"] });
		branch<number>(g, "b", "input", (v) => v > 0);
		const desc = g.describe({ detail: "standard" });
		const tKey = Object.keys(desc.nodes).find((k) => k === "t" || k.endsWith("::t"));
		const bKey = Object.keys(desc.nodes).find((k) => k === "b" || k.endsWith("::b"));
		expect(tKey).toBeDefined();
		expect(bKey).toBeDefined();
		const tNode = desc.nodes[tKey as string];
		const bNode = desc.nodes[bKey as string];
		expect(tNode?.type).toBe("derived");
		expect(bNode?.type).toBe("derived");
		expect(tNode?.meta?.orchestration_type).toBe("task");
		expect(bNode?.meta?.orchestration_type).toBe("branch");
	});

	it("valve and approval hold value when control is false", () => {
		const g = pipeline("wf");
		const input = state(1);
		const open = state(true);
		const approved = state(true);
		g.add("input", input);
		g.add("open", open);
		g.add("approved", approved);
		const gated = valve<number>(g, "gated", "input", "open");
		const reviewed = approval<number>(g, "reviewed", gated, "approved");
		gated.subscribe(() => undefined);
		reviewed.subscribe(() => undefined);

		g.set("input", 2);
		expect(g.get("reviewed")).toBe(2);
		g.set("open", false);
		g.set("input", 3);
		expect(g.get("reviewed")).toBe(2);
		g.set("open", true);
		g.set("approved", false);
		g.set("input", 4);
		expect(g.get("reviewed")).toBe(3);
	});

	it("forEach runs side effects and forwards messages", () => {
		const g = pipeline("wf");
		const input = state(1);
		g.add("input", input);
		const seen: number[] = [];
		const sink = forEach<number>(g, "sink", "input", (value) => {
			seen.push(value);
		});
		sink.subscribe(() => undefined);
		g.set("input", 2);
		g.set("input", 3);
		expect(seen).toEqual([2, 3]);
	});

	it("join emits latest tuple of dependencies", () => {
		const g = pipeline("wf");
		const a = state(1);
		const b = state("x");
		g.add("a", a);
		g.add("b", b);
		const j = join<[number, string]>(g, "j", ["a", "b"]);
		j.subscribe(() => undefined);
		g.set("a", 5);
		expect(g.get("j")).toEqual([5, "x"]);
	});

	it("loop applies iterate function fixed times", () => {
		const g = pipeline("wf");
		const input = state(2);
		g.add("input", input);
		const l = loop<number>(g, "pow2x3", "input", (value) => value * 2, { iterations: 3 });
		l.subscribe(() => undefined);
		expect(g.get("pow2x3")).toBe(16);
	});

	it("subPipeline mounts child workflow graph", () => {
		const root = pipeline("root");
		const child = subPipeline(root, "child", (sub) => {
			sub.add("n", state(1));
		});
		expect(child).toBeInstanceOf(Graph);
		expect(root.get("child::n")).toBe(1);
	});

	it("sensor provides imperative push/error/complete controls", () => {
		const g = pipeline("wf");
		const s = sensor<number>(g, "s");
		const values: number[] = [];
		s.node.subscribe((msgs) => {
			for (const msg of msgs) {
				if (msg[0] === DATA) {
					values.push(msg[1] as number);
				}
			}
		});
		s.push(10);
		s.push(20);
		expect(values).toEqual([10, 20]);
	});

	it("wait delays DATA while preserving final value", async () => {
		const g = pipeline("wf");
		const input = state(1);
		g.add("input", input);
		const delayed = wait<number>(g, "delayed", "input", 10);
		delayed.subscribe(() => undefined);
		g.set("input", 2);
		expect(g.get("delayed")).toBe(1);
		await new Promise((resolve) => setTimeout(resolve, 25));
		expect(g.get("delayed")).toBe(2);
	});

	it("onFailure recovers from errors", () => {
		const g = pipeline("wf");
		const src = state(1);
		g.add("src", src);
		const failing = task<number>(
			g,
			"failing",
			([v]) => {
				if ((v as number) > 1) throw new Error("boom");
				return v as number;
			},
			{ deps: ["src"] },
		);
		const recovered = onFailure<number>(g, "recovered", failing, () => 999);
		recovered.subscribe(() => undefined);
		g.set("src", 2);
		expect(g.get("recovered")).toBe(999);
	});

	it("forEach does not run user callback after terminal error", () => {
		const g = pipeline("wf");
		const src = state(0);
		g.add("src", src);
		const seen: number[] = [];
		const sink = forEach<number>(g, "sink", "src", (value) => {
			seen.push(value);
			if (value >= 1) {
				throw new Error("stop");
			}
		});
		sink.subscribe(() => undefined);
		g.set("src", 1);
		g.set("src", 2);
		expect(seen).toEqual([1]);
	});

	it("wait cancels pending timers on teardown", async () => {
		const g = pipeline("wf");
		const input = state(1);
		g.add("input", input);
		const delayed = wait<number>(g, "delayed", "input", 20);
		delayed.subscribe(() => undefined);
		g.set("input", 2);
		delayed.down([[TEARDOWN]]);
		await new Promise((resolve) => setTimeout(resolve, 35));
		expect(g.get("delayed")).toBe(1);
	});

	it("onFailure stops recovery attempts after terminal error", () => {
		const g = pipeline("wf");
		const src = state(0);
		g.add("src", src);
		const failing = task<number>(
			g,
			"failing",
			([v]) => {
				if ((v as number) >= 1) throw new Error("boom");
				return v as number;
			},
			{ deps: ["src"] },
		);
		let recoverCalls = 0;
		const recovered = onFailure<number>(g, "recovered", failing, () => {
			recoverCalls += 1;
			throw new Error("recover-failed");
		});
		recovered.subscribe(() => undefined);
		g.set("src", 1);
		g.set("src", 2);
		expect(recoverCalls).toBe(1);
	});

	it("loop uses permissive parse + truncate for iteration dep values", () => {
		const g = pipeline("wf");
		const input = state(2);
		const iter = state<unknown>("2.9");
		g.add("input", input);
		g.add("iter", iter);
		const l = loop<number>(g, "looped", "input", (value) => value * 2, {
			iterations: "iter",
		});
		l.subscribe(() => undefined);
		expect(g.get("looped")).toBe(8);
		g.set("iter", "bad");
		expect(g.get("looped")).toBe(4);
		g.set("iter", "");
		expect(g.get("looped")).toBe(2);
	});

	// ---------------------------------------------------------------
	// gate (human-in-the-loop approval queue)
	// ---------------------------------------------------------------

	it("gate queues values and approve forwards them", () => {
		const g = pipeline("wf");
		const input = state(0);
		g.add("input", input);
		const ctrl = gate<number>(g, "gated", "input");

		const approved: number[] = [];
		ctrl.node.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === DATA) approved.push(msg[1] as number);
		});

		g.set("input", 1);
		g.set("input", 2);
		expect(ctrl.pending.get()).toEqual([1, 2]);
		expect(ctrl.count.get()).toBe(2);
		expect(approved).toEqual([]);

		ctrl.approve();
		expect(approved).toEqual([1]);
		expect(ctrl.pending.get()).toEqual([2]);
		expect(ctrl.count.get()).toBe(1);

		ctrl.approve();
		expect(approved).toEqual([1, 2]);
		expect(ctrl.pending.get()).toEqual([]);
	});

	it("gate reject discards pending values", () => {
		const g = pipeline("wf");
		const input = state(0);
		g.add("input", input);
		const ctrl = gate<number>(g, "gated", "input");
		ctrl.node.subscribe(() => undefined);
		g.set("input", 10);
		g.set("input", 20);
		expect(ctrl.pending.get()).toEqual([10, 20]);
		ctrl.reject();
		expect(ctrl.pending.get()).toEqual([20]);
		ctrl.reject();
		expect(ctrl.pending.get()).toEqual([]);
	});

	it("gate modify transforms and forwards", () => {
		const g = pipeline("wf");
		const input = state(0);
		g.add("input", input);
		const ctrl = gate<number>(g, "gated", "input");

		const approved: number[] = [];
		ctrl.node.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === DATA) approved.push(msg[1] as number);
		});

		g.set("input", 5);
		ctrl.modify((v, _i, _pending) => v * 10);
		expect(approved).toEqual([50]);
		expect(ctrl.pending.get()).toEqual([]);
	});

	it("gate open flushes pending and auto-approves future", () => {
		const g = pipeline("wf");
		const input = state(0);
		g.add("input", input);
		const ctrl = gate<number>(g, "gated", "input");

		const approved: number[] = [];
		ctrl.node.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === DATA) approved.push(msg[1] as number);
		});

		g.set("input", 1);
		g.set("input", 2);
		ctrl.open();
		expect(approved).toEqual([1, 2]);
		expect(ctrl.isOpen.get()).toBe(true);

		// Future values pass through immediately
		g.set("input", 3);
		expect(approved).toEqual([1, 2, 3]);
	});

	it("gate close re-enables manual gating", () => {
		const g = pipeline("wf");
		const input = state(0);
		g.add("input", input);
		const ctrl = gate<number>(g, "gated", "input", { startOpen: true });

		const approved: number[] = [];
		ctrl.node.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === DATA) approved.push(msg[1] as number);
		});

		g.set("input", 1);
		expect(approved).toEqual([1]);
		ctrl.close();
		g.set("input", 2);
		expect(approved).toEqual([1]);
		expect(ctrl.pending.get()).toEqual([2]);
	});

	it("gate maxPending drops oldest values (FIFO)", () => {
		const g = pipeline("wf");
		const input = state(0);
		g.add("input", input);
		const ctrl = gate<number>(g, "gated", "input", { maxPending: 2 });
		ctrl.node.subscribe(() => undefined);
		g.set("input", 1);
		g.set("input", 2);
		g.set("input", 3);
		expect(ctrl.pending.get()).toEqual([2, 3]);
	});

	it("gate approve(n) forwards multiple values", () => {
		const g = pipeline("wf");
		const input = state(0);
		g.add("input", input);
		const ctrl = gate<number>(g, "gated", "input");

		const approved: number[] = [];
		ctrl.node.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === DATA) approved.push(msg[1] as number);
		});

		g.set("input", 1);
		g.set("input", 2);
		g.set("input", 3);
		ctrl.approve(2);
		expect(approved).toEqual([1, 2]);
		expect(ctrl.pending.get()).toEqual([3]);
	});

	it("gate registers internal state nodes in graph", () => {
		const g = pipeline("wf");
		const input = state(0);
		g.add("input", input);
		gate<number>(g, "gated", "input");
		const desc = g.describe();
		expect(desc.nodes).toHaveProperty("gated");
		expect(desc.nodes).toHaveProperty("gated_state::pending");
		expect(desc.nodes).toHaveProperty("gated_state::isOpen");
		expect(desc.nodes).toHaveProperty("gated_state::count");
	});

	it("gate maxPending < 1 throws RangeError", () => {
		const g = pipeline("wf");
		const input = state(0);
		g.add("input", input);
		expect(() => gate<number>(g, "gated", "input", { maxPending: 0 })).toThrow(RangeError);
	});
});
