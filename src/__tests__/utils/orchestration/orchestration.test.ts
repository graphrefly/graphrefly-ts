import { DATA, node, TEARDOWN } from "@graphrefly/pure-ts/core";
import { delay, valve } from "@graphrefly/pure-ts/extra";
import { Graph } from "@graphrefly/pure-ts/graph";
import { describe, expect, it } from "vitest";
import { pipelineGraph } from "../../../utils/orchestration/index.js";

describe("patterns.orchestration", () => {
	it("pipelineGraph creates a PipelineGraph container", () => {
		const g = pipelineGraph("wf");
		expect(g).toBeInstanceOf(Graph);
		expect(g.name).toBe("wf");
	});

	// FLAG: v5 behavioral change — needs investigation (expected undefined to be 6)
	it("task registers a computed step and wires dependency edges", () => {
		const g = pipelineGraph("wf");
		const input = node([], { initial: 1 });
		g.add(input, { name: "input" });
		const doubled = g.task<number>("double", ([v]) => ((v as number) * 2) as number, {
			deps: ["input"],
		});
		doubled.subscribe(() => undefined);
		g.set("input", 3);
		expect(g.node("double").cache).toBe(6);
		expect(g.edges()).toContainEqual(["input", "double"]);
	});

	it("task with Node deps still records explicit graph edges", () => {
		const g = pipelineGraph("wf");
		const input = node([], { initial: 2 });
		g.add(input, { name: "input" });
		g.task<number>("doubleByRef", ([v]) => ((v as number) * 2) as number, {
			deps: [input],
		});
		expect(g.edges()).toContainEqual(["input", "doubleByRef"]);
	});

	it("classify emits tagged results", () => {
		const g = pipelineGraph("wf");
		const input = node([], { initial: 1 });
		g.add(input, { name: "input" });
		const out = g.classify<"then" | "else", number>("route", "input", (v) =>
			v >= 2 ? "then" : "else",
		);
		const seen: Array<"then" | "else"> = [];
		out.subscribe((msgs) => {
			for (const msg of msgs) {
				if (msg[0] === DATA) {
					const payload = msg[1] as { tag: "then" | "else" };
					seen.push(payload.tag);
				}
			}
		});
		g.set("input", 2);
		expect(seen).toContain("else");
		expect(seen).toContain("then");
	});

	it("task and classify describe as derived with canonical orchestration metadata", () => {
		const g = pipelineGraph("wf");
		const input = node([], { initial: 1 });
		g.add(input, { name: "input" });
		g.task<number>("t", ([v]) => v as number, { deps: ["input"] });
		g.classify<"pos" | "neg", number>("b", "input", (v) => (v > 0 ? "pos" : "neg"));
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
		expect(bNode?.meta?.orchestration_type).toBe("classify");
	});

	it("valve and approval hold value when control is false", () => {
		const g = pipelineGraph("wf");
		const input = node([], { initial: 1 });
		const open = node([], { initial: true });
		const approved = node([], { initial: true });
		g.add(input, { name: "input" });
		g.add(open, { name: "open" });
		g.add(approved, { name: "approved" });
		const gated = valve<number>(input, open);
		g.add(gated, { name: "gated" });
		const reviewCtrl = g.approval<number>("reviewed", "gated", approved);
		gated.subscribe(() => undefined);
		reviewCtrl.output.subscribe(() => undefined);

		g.set("input", 2);
		expect(g.node("reviewed").cache).toBe(2);
		g.set("open", false);
		g.set("input", 3);
		expect(g.node("reviewed").cache).toBe(2);
		g.set("open", true);
		g.set("approved", false);
		g.set("input", 4);
		expect(g.node("reviewed").cache).toBe(3);
	});

	// forEach removed — use `node([source], fn, { describeKind: "effect" })` + `graph.add()`.
	it("effect-based side-effect runs per value and is graph-observable", () => {
		const g = pipelineGraph("wf");
		const input = node<number>();
		g.add(input, { name: "input" });
		const seen: number[] = [];
		const sink = node(
			[input],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				return (
					(([value]) => {
						seen.push(value as number);
					})(data, actions, ctx) ?? undefined
				);
			},
			{ describeKind: "effect" },
		);
		g.add(sink, { name: "sink" });
		sink.subscribe(() => undefined);
		g.set("input", 2);
		g.set("input", 3);
		expect(seen).toEqual([2, 3]);
	});

	it("combine emits keyed record of latest dependency values", () => {
		const g = pipelineGraph("wf");
		const a = node([], { initial: 1 });
		const b = node([], { initial: "x" });
		g.add(a, { name: "a" });
		g.add(b, { name: "b" });
		const j = g.combine("j", { a: "a", b: "b" });
		j.subscribe(() => undefined);
		g.set("a", 5);
		expect(g.node("j").cache).toEqual({ a: 5, b: "x" });
	});

	it("mount mounts child workflow graph", () => {
		const root = pipelineGraph("root");
		const child = new Graph("child");
		child.add(node([], { initial: 1 }), { name: "n" });
		root.mount("child", child);
		expect(root.node("child::n").cache).toBe(1);
	});

	it("delay shifts DATA by ms while forwarding eventual updates", async () => {
		const g = pipelineGraph("wf");
		const input = node([], { initial: 1 });
		g.add(input, { name: "input" });
		const delayed = delay<number>(input, 10);
		g.add(delayed, { name: "delayed" });
		delayed.subscribe(() => undefined);
		// extra/delay uses a per-DATA timer; initial 1 fires after the delay.
		await new Promise((resolve) => setTimeout(resolve, 25));
		expect(g.node("delayed").cache).toBe(1);
		g.set("input", 2);
		expect(g.node("delayed").cache).toBe(1);
		await new Promise((resolve) => setTimeout(resolve, 25));
		expect(g.node("delayed").cache).toBe(2);
	});

	// FLAG: v5 behavioral change — needs investigation (Graph.connect() deps enforcement)
	it("catch recovers from errors", () => {
		const g = pipelineGraph("wf");
		const src = node([], { initial: 1 });
		g.add(src, { name: "src" });
		const failing = g.task<number>(
			"failing",
			([v]) => {
				if ((v as number) > 1) throw new Error("boom");
				return v as number;
			},
			{ deps: ["src"] },
		);
		const recovered = g.catch<number>("recovered", failing, (cause) => {
			if (cause.kind === "errored") return 999;
			return 0;
		});
		recovered.subscribe(() => undefined);
		g.set("src", 2);
		expect(g.node("recovered").cache).toBe(999);
	});

	// node([source], fn, { describeKind: "effect" }) with a throwing fn terminates the
	// effect node via auto-error propagation; downstream subscribers stop firing.
	it("effect-based side-effect stops running user fn after an error", () => {
		const g = pipelineGraph("wf");
		const src = node<number>();
		g.add(src, { name: "src" });
		const seen: number[] = [];
		const sink = node(
			[src],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				return (
					(([value]) => {
						seen.push(value as number);
						if ((value as number) >= 1) {
							throw new Error("stop");
						}
					})(data, actions, ctx) ?? undefined
				);
			},
			{ describeKind: "effect" },
		);
		g.add(sink, { name: "sink" });
		sink.subscribe(() => undefined);
		g.set("src", 1);
		g.set("src", 2);
		expect(seen).toEqual([1]);
	});

	it("delay cancels pending timers on teardown", async () => {
		const g = pipelineGraph("wf");
		const input = node<number>();
		g.add(input, { name: "input" });
		const delayed = delay<number>(input, 20);
		g.add(delayed, { name: "delayed" });
		delayed.subscribe(() => undefined);
		g.set("input", 2);
		delayed.down([[TEARDOWN]]);
		await new Promise((resolve) => setTimeout(resolve, 35));
		expect(g.node("delayed").cache).toBeUndefined();
	});

	// FLAG: v5 behavioral change — needs investigation (Graph.connect() deps enforcement)
	it("catch stops recovery attempts after terminal error", () => {
		const g = pipelineGraph("wf");
		const src = node([], { initial: 0 });
		g.add(src, { name: "src" });
		const failing = g.task<number>(
			"failing",
			([v]) => {
				if ((v as number) >= 1) throw new Error("boom");
				return v as number;
			},
			{ deps: ["src"] },
		);
		let recoverCalls = 0;
		const recovered = g.catch<number>("recovered", failing, (cause) => {
			recoverCalls += 1;
			if (cause.kind === "errored") throw new Error("recover-failed");
			return 0;
		});
		recovered.subscribe(() => undefined);
		g.set("src", 1);
		g.set("src", 2);
		expect(recoverCalls).toBe(1);
	});

	// ---------------------------------------------------------------
	// gate (human-in-the-loop approval queue)
	// ---------------------------------------------------------------

	// FLAG: v5 behavioral change — needs investigation (Graph.connect() deps enforcement)
	it("gate queues values and approve forwards them", () => {
		const g = pipelineGraph("wf");
		const input = node<number>();
		g.add(input, { name: "input" });
		const ctrl = g.approvalGate<number>("gated", "input");

		const approved: number[] = [];
		ctrl.output.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === DATA) approved.push(msg[1] as number);
		});

		g.set("input", 1);
		g.set("input", 2);
		expect(ctrl.pending.cache).toEqual([1, 2]);
		expect(ctrl.count.cache).toBe(2);
		expect(approved).toEqual([]);

		ctrl.approve();
		expect(approved).toEqual([1]);
		expect(ctrl.pending.cache).toEqual([2]);
		expect(ctrl.count.cache).toBe(1);

		ctrl.approve();
		expect(approved).toEqual([1, 2]);
		expect(ctrl.pending.cache).toEqual([]);
	});

	// FLAG: v5 behavioral change — needs investigation (Graph.connect() deps enforcement)
	it("gate reject discards pending values", () => {
		const g = pipelineGraph("wf");
		const input = node<number>();
		g.add(input, { name: "input" });
		const ctrl = g.approvalGate<number>("gated", "input");
		ctrl.output.subscribe(() => undefined);
		g.set("input", 10);
		g.set("input", 20);
		expect(ctrl.pending.cache).toEqual([10, 20]);
		ctrl.reject();
		expect(ctrl.pending.cache).toEqual([20]);
		ctrl.reject();
		expect(ctrl.pending.cache).toEqual([]);
	});

	// FLAG: v5 behavioral change — needs investigation (Graph.connect() deps enforcement)
	it("gate modify transforms and forwards", () => {
		const g = pipelineGraph("wf");
		const input = node<number>();
		g.add(input, { name: "input" });
		const ctrl = g.approvalGate<number>("gated", "input");

		const approved: number[] = [];
		ctrl.output.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === DATA) approved.push(msg[1] as number);
		});

		g.set("input", 5);
		ctrl.modify((v, _i, _pending) => v * 10);
		expect(approved).toEqual([50]);
		expect(ctrl.pending.cache).toEqual([]);
	});

	// FLAG: v5 behavioral change — needs investigation (Graph.connect() deps enforcement)
	it("gate open flushes pending and auto-approves future", () => {
		const g = pipelineGraph("wf");
		const input = node<number>();
		g.add(input, { name: "input" });
		const ctrl = g.approvalGate<number>("gated", "input");

		const approved: number[] = [];
		ctrl.output.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === DATA) approved.push(msg[1] as number);
		});

		g.set("input", 1);
		g.set("input", 2);
		ctrl.open();
		expect(approved).toEqual([1, 2]);
		expect(ctrl.isOpen.cache).toBe(true);

		// Future values pass through immediately
		g.set("input", 3);
		expect(approved).toEqual([1, 2, 3]);
	});

	// FLAG: v5 behavioral change — needs investigation (Graph.connect() deps enforcement)
	it("gate close re-enables manual gating", () => {
		const g = pipelineGraph("wf");
		const input = node<number>();
		g.add(input, { name: "input" });
		const ctrl = g.approvalGate<number>("gated", "input", { startOpen: true });

		const approved: number[] = [];
		ctrl.output.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === DATA) approved.push(msg[1] as number);
		});

		g.set("input", 1);
		expect(approved).toEqual([1]);
		ctrl.close();
		g.set("input", 2);
		expect(approved).toEqual([1]);
		expect(ctrl.pending.cache).toEqual([2]);
	});

	// FLAG: v5 behavioral change — needs investigation (Graph.connect() deps enforcement)
	it("gate maxPending drops oldest values (FIFO)", () => {
		const g = pipelineGraph("wf");
		const input = node([], { initial: 0 });
		g.add(input, { name: "input" });
		const ctrl = g.approvalGate<number>("gated", "input", { maxPending: 2 });
		ctrl.output.subscribe(() => undefined);
		g.set("input", 1);
		g.set("input", 2);
		g.set("input", 3);
		expect(ctrl.pending.cache).toEqual([2, 3]);
	});

	// FLAG: v5 behavioral change — needs investigation (Graph.connect() deps enforcement)
	it("gate approve(n) forwards multiple values", () => {
		const g = pipelineGraph("wf");
		const input = node<number>();
		g.add(input, { name: "input" });
		const ctrl = g.approvalGate<number>("gated", "input");

		const approved: number[] = [];
		ctrl.output.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === DATA) approved.push(msg[1] as number);
		});

		g.set("input", 1);
		g.set("input", 2);
		g.set("input", 3);
		ctrl.approve(2);
		expect(approved).toEqual([1, 2]);
		expect(ctrl.pending.cache).toEqual([3]);
	});

	// FLAG: v5 behavioral change — needs investigation (Graph.connect() deps enforcement)
	it("gate registers internal state nodes in graph", () => {
		const g = pipelineGraph("wf");
		const input = node([], { initial: 0 });
		g.add(input, { name: "input" });
		g.approvalGate<number>("gated", "input");
		const desc = g.describe();
		expect(desc.nodes).toHaveProperty("gated");
		expect(desc.nodes).toHaveProperty("gated-state::pending");
		expect(desc.nodes).toHaveProperty("gated-state::isOpen");
		expect(desc.nodes).toHaveProperty("gated-state::count");
	});

	it("gate maxPending < 1 throws RangeError", () => {
		const g = pipelineGraph("wf");
		const input = node([], { initial: 0 });
		g.add(input, { name: "input" });
		expect(() => g.approvalGate<number>("gated", "input", { maxPending: 0 })).toThrow(RangeError);
	});

	// ── Rollback-on-throw (Audit 2 / C.2 F) ──────────────────────────────

	it("gate.modify throw rolls back in-band emissions; failure record persists", () => {
		const g = pipelineGraph("wf");
		const input = node<number>([], { initial: 0 });
		g.add(input, { name: "input" });
		const ctrl = g.approvalGate<number>("gated", "input");
		const collected: number[] = [];
		ctrl.output.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === DATA) collected.push(m[1] as number);
		});

		// Queue two items.
		input.emit(1);
		input.emit(2);

		// modify throws on the first item — wrapMutation catches the throw
		// inside batch (rolls back any in-band downstream emissions for that
		// wave), then commits a failure audit record OUTSIDE the rolled-back
		// transaction so the audit trail still captures the failed attempt.
		expect(() =>
			ctrl.modify(() => {
				throw new TypeError("nope");
			}, 1),
		).toThrow(TypeError);

		// No item was emitted to the output for the failed modify wave.
		expect(collected).toEqual([]);

		// Audit log captured a "drop" record with errorType.
		const dec = ctrl.decisions.entries.cache as readonly { action: string; errorType?: string }[];
		expect(dec.length).toBeGreaterThanOrEqual(1);
		const last = dec[dec.length - 1]!;
		expect(last.action).toBe("drop");
		expect(last.errorType).toBe("TypeError");

		// A subsequent successful approve still works — gate is not torn down.
		ctrl.approve(1);
		expect(collected.length).toBeGreaterThanOrEqual(1);
	});

	it("gate.modify success path commits a normal `modify` audit record", () => {
		const g = pipelineGraph("wf");
		const input = node<number>([], { initial: 0 });
		g.add(input, { name: "input" });
		const ctrl = g.approvalGate<number>("gated", "input");
		input.emit(10);

		ctrl.modify((v) => v * 2, 1);

		const dec = ctrl.decisions.entries.cache as readonly {
			action: string;
			errorType?: string;
		}[];
		const last = dec[dec.length - 1]!;
		expect(last.action).toBe("modify");
		expect(last.errorType).toBeUndefined();
	});
});
