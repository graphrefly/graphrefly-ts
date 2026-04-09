import { describe, expect, it } from "vitest";
import { batch } from "../../core/batch.js";
import { type DynamicNodeImpl, dynamicNode } from "../../core/dynamic-node.js";
import { policy } from "../../core/guard.js";
import {
	COMPLETE,
	DATA,
	DIRTY,
	ERROR,
	type Message,
	type Messages,
	RESOLVED,
	TEARDOWN,
} from "../../core/messages.js";
import { describeNode } from "../../core/meta.js";
import { type Node, node } from "../../core/node.js";
import { state } from "../../core/sugar.js";
import { collect } from "../test-helpers.js";

function dataValues(batches: Messages[]): unknown[] {
	return batches.flatMap((b) => b.filter((m) => m[0] === DATA).map((m) => m[1]));
}

describe("dynamicNode", () => {
	it("tracks deps via get() proxy", () => {
		const a = state(1);
		const b = state(2);

		const d = dynamicNode((get) => {
			return (get(a) as number) + (get(b) as number);
		});

		const { batches, unsub } = collect(d);
		const vals = dataValues(batches);
		expect(vals).toContain(3);
		unsub();
	});

	it("conditional deps — switches deps based on runtime value", () => {
		const cond = state(true);
		const a = state(10);
		const b = state(20);

		const d = dynamicNode((get) => {
			return get(cond) ? get(a) : get(b);
		});

		const { batches, unsub } = collect(d);
		expect(dataValues(batches)).toContain(10);

		// Switch condition
		batch(() => {
			cond.down([[DIRTY]]);
			cond.down([[DATA, false]]);
		});

		const vals = dataValues(batches);
		expect(vals).toContain(20);
		unsub();
	});

	it("dep set changes — adds new deps", () => {
		const a = state(1);
		const b = state(2);
		const c = state(3);
		const useC = state(false);

		const d = dynamicNode((get) => {
			const sum = (get(a) as number) + (get(b) as number);
			if (get(useC)) return sum + (get(c) as number);
			return sum;
		});

		const { batches, unsub } = collect(d);
		expect(dataValues(batches)).toContain(3); // 1 + 2

		// Enable c
		batch(() => {
			useC.down([[DIRTY]]);
			useC.down([[DATA, true]]);
		});

		expect(dataValues(batches)).toContain(6); // 1 + 2 + 3
		unsub();
	});

	it("emits RESOLVED when value unchanged", () => {
		const a = state(1);
		const d = dynamicNode((get) => {
			const v = get(a) as number;
			return v > 0 ? "positive" : "non-positive";
		});

		const { batches, unsub } = collect(d);
		expect(dataValues(batches)).toContain("positive");

		// Change a to 2 — result is still "positive"
		batch(() => {
			a.down([[DIRTY]]);
			a.down([[DATA, 2]]);
		});

		// Should have RESOLVED, not a second DATA with "positive"
		const lastBatch = batches[batches.length - 1];
		expect(lastBatch.some((m) => m[0] === RESOLVED)).toBe(true);
		unsub();
	});

	it("diamond resolution — recomputes once when shared ancestor changes", () => {
		const root = state(1);
		const left = node([root], ([v]) => (v as number) * 2);
		const right = node([root], ([v]) => (v as number) + 10);

		let computeCount = 0;
		const d = dynamicNode((get) => {
			computeCount++;
			return [get(left) as number, get(right) as number];
		});

		const { batches, unsub } = collect(d);
		computeCount = 0; // reset after initial

		// Change root — both left and right fire DIRTY then settle
		batch(() => {
			root.down([[DIRTY]]);
			root.down([[DATA, 5]]);
		});

		// Should recompute once (not twice — once for left, once for right)
		expect(computeCount).toBe(1);
		expect(dataValues(batches).pop()).toEqual([10, 15]);
		unsub();
	});

	it("cleanup on disconnect", () => {
		const a = state(1);
		const d = dynamicNode((get) => get(a));
		const { unsub } = collect(d);
		expect(d.status).not.toBe("disconnected");
		unsub();
		expect(d.status).toBe("disconnected");
	});

	it("get() returns current cached value", () => {
		const a = state(42);
		const d = dynamicNode((get) => get(a));
		collect(d);
		expect(d.get()).toBe(42);
	});

	describe("meta (companion stores)", () => {
		it("builds subscribable meta nodes from opts.meta", () => {
			const a = state(1);
			const d = dynamicNode((get) => get(a), {
				meta: { tag: "hello", count: 0 },
			});

			expect(d.meta.tag).toBeDefined();
			expect(d.meta.count).toBeDefined();
			expect(d.meta.tag.get()).toBe("hello");
			expect(d.meta.count.get()).toBe(0);
		});

		it("meta nodes are independently subscribable", () => {
			const a = state(1);
			const d = dynamicNode((get) => get(a), {
				meta: { status: "idle" },
			});

			const msgs: Messages[] = [];
			const unsub = d.meta.status.subscribe((m) => msgs.push(m));

			d.meta.status.down([[DATA, "loading"]]);
			expect(d.meta.status.get()).toBe("loading");
			expect(msgs.length).toBeGreaterThan(0);

			unsub();
		});

		it("TEARDOWN propagates to meta nodes", () => {
			const a = state(1);
			const d = dynamicNode((get) => get(a), {
				name: "dyn",
				meta: { tag: "x" },
			});

			collect(d);

			const metaMsgs: Messages[] = [];
			d.meta.tag.subscribe((m) => metaMsgs.push(m));

			d.down([[TEARDOWN]]);

			const hasTeardown = metaMsgs.some((batch) => batch.some((m) => m[0] === TEARDOWN));
			expect(hasTeardown).toBe(true);
		});

		it("meta is empty object when opts.meta not provided", () => {
			const a = state(1);
			const d = dynamicNode((get) => get(a));
			expect(Object.keys(d.meta)).toHaveLength(0);
		});

		it("meta node names include parent name", () => {
			const a = state(1);
			const d = dynamicNode((get) => get(a), {
				name: "myDyn",
				meta: { label: "test" },
			});
			expect(d.meta.label.name).toBe("myDyn:meta:label");
		});
	});

	describe("onMessage handler", () => {
		it("intercepts dep messages before default dispatch", () => {
			const a = state(1);
			const intercepted: Message[] = [];
			const d = dynamicNode((get) => get(a), {
				onMessage(msg, _depIndex, _actions) {
					intercepted.push(msg);
					return false; // don't consume
				},
			});
			collect(d);
			batch(() => {
				a.down([[DIRTY]]);
				a.down([[DATA, 2]]);
			});
			expect(intercepted.length).toBeGreaterThan(0);
			expect(d.get()).toBe(2);
		});

		it("consuming a message prevents settlement", () => {
			const a = state(1);
			let computeCount = 0;
			const d = dynamicNode(
				(get) => {
					computeCount++;
					return get(a);
				},
				{
					onMessage(msg) {
						// Consume DATA — settlement never happens
						return msg[0] === DATA;
					},
				},
			);
			collect(d);
			computeCount = 0;
			batch(() => {
				a.down([[DIRTY]]);
				a.down([[DATA, 99]]);
			});
			// DATA was consumed, so dep never settled, so fn never recomputed
			expect(computeCount).toBe(0);
		});

		it("error in onMessage emits ERROR downstream", () => {
			const a = state(1);
			const d = dynamicNode((get) => get(a), {
				onMessage() {
					throw new Error("handler boom");
				},
			});
			const { batches } = collect(d);
			batch(() => {
				a.down([[DIRTY]]);
				a.down([[DATA, 2]]);
			});
			const hasError = batches.some((b) => b.some((m) => m[0] === ERROR));
			expect(hasError).toBe(true);
		});
	});

	describe("onResubscribe", () => {
		it("calls callback when transitioning from terminal to active", () => {
			const a = state(1);
			let resubCount = 0;
			const d = dynamicNode((get) => get(a), {
				resubscribable: true,
				onResubscribe: () => {
					resubCount++;
				},
			});
			const unsub1 = d.subscribe(() => {});
			d.down([[COMPLETE]]);
			unsub1();
			// Resubscribe — should trigger callback
			const unsub2 = d.subscribe(() => {});
			expect(resubCount).toBe(1);
			unsub2();
		});
	});

	describe("completeWhenDepsComplete", () => {
		it("emits COMPLETE when all deps complete (default)", () => {
			const a = state(1);
			const d = dynamicNode((get) => get(a));
			const { batches } = collect(d);
			a.down([[COMPLETE]]);
			const hasComplete = batches.some((b) => b.some((m) => m[0] === COMPLETE));
			expect(hasComplete).toBe(true);
		});

		it("suppresses auto-COMPLETE when set to false", () => {
			const a = state(1);
			const d = dynamicNode((get) => get(a), {
				completeWhenDepsComplete: false,
			});
			const { batches } = collect(d);
			a.down([[COMPLETE]]);
			const hasComplete = batches.some((b) => b.some((m) => m[0] === COMPLETE));
			expect(hasComplete).toBe(false);
		});
	});

	describe("describeKind", () => {
		it("overrides describe type", () => {
			const a = state(1);
			const d = dynamicNode((get) => get(a), {
				describeKind: "operator",
			}) as unknown as DynamicNodeImpl;
			expect(d._describeKind).toBe("operator");
		});

		it("describeNode uses describeKind when set", () => {
			const a = state(1);
			const d = dynamicNode((get) => get(a), {
				name: "dyn",
				describeKind: "effect",
			});
			const desc = describeNode(d);
			expect(desc.type).toBe("effect");
		});

		it("describeNode defaults to derived", () => {
			const a = state(1);
			const d = dynamicNode((get) => get(a), { name: "dyn" });
			const desc = describeNode(d);
			expect(desc.type).toBe("derived");
		});
	});

	describe("inspector hook", () => {
		it("emits dep_message events", () => {
			const a = state(1);
			const d = dynamicNode((get) => get(a)) as unknown as DynamicNodeImpl;
			const events: unknown[] = [];
			const dispose = d._setInspectorHook((e) => events.push(e));
			collect(d as unknown as Node);
			batch(() => {
				a.down([[DIRTY]]);
				a.down([[DATA, 2]]);
			});
			expect(events.some((e: any) => e.kind === "dep_message")).toBe(true);
			dispose();
		});

		it("emits run events with depValues", () => {
			const a = state(10);
			const d = dynamicNode((get) => get(a)) as unknown as DynamicNodeImpl;
			const runs: unknown[] = [];
			const dispose = d._setInspectorHook((e) => {
				if ((e as any).kind === "run") runs.push(e);
			});
			collect(d as unknown as Node);
			batch(() => {
				a.down([[DIRTY]]);
				a.down([[DATA, 20]]);
			});
			expect(runs.length).toBeGreaterThan(0);
			expect((runs[0] as any).depValues).toBeDefined();
			dispose();
		});

		it("dispose restores previous hook", () => {
			const a = state(1);
			const d = dynamicNode((get) => get(a)) as unknown as DynamicNodeImpl;
			const events1: unknown[] = [];
			const events2: unknown[] = [];
			const dispose1 = d._setInspectorHook((e) => events1.push(e));
			const dispose2 = d._setInspectorHook((e) => events2.push(e));
			dispose2(); // should restore hook 1
			collect(d as unknown as Node);
			batch(() => {
				a.down([[DIRTY]]);
				a.down([[DATA, 2]]);
			});
			expect(events1.length).toBeGreaterThan(0);
			expect(events2.length).toBe(0);
			dispose1();
		});
	});

	describe("guard", () => {
		it("denies write when guard rejects", () => {
			const a = state(1);
			const guard = policy((allow) => {
				allow("observe");
			});
			const d = dynamicNode((get) => get(a), { guard });
			expect(() => d.down([[DATA, 42]])).toThrow();
		});

		it("denies observe on subscribe when guard rejects", () => {
			const a = state(1);
			const guard = policy((_allow, deny) => {
				deny("observe");
			});
			const d = dynamicNode((get) => get(a), { guard });
			expect(() => d.subscribe(() => {}, { actor: { type: "human", id: "u1" } })).toThrow();
		});

		it("meta inherits guard from parent", () => {
			const a = state(1);
			const guard = policy((allow) => {
				allow("observe");
			});
			const d = dynamicNode((get) => get(a), {
				guard,
				meta: { tag: "x" },
			});
			expect(d.meta.tag.hasGuard()).toBe(true);
		});
	});

	describe("resubscribable", () => {
		it("allows fresh subscription after COMPLETE", () => {
			const a = state(1);
			const d = dynamicNode((get) => get(a), { resubscribable: true });
			const unsub1 = d.subscribe(() => {});
			d.down([[COMPLETE]]);
			expect(d.status).toBe("completed");
			unsub1();
			const unsub2 = d.subscribe(() => {});
			expect(d.status).not.toBe("completed");
			unsub2();
		});
	});

	describe("up() forwarding", () => {
		it("forwards PAUSE upstream to tracked deps", () => {
			const a = state(1);
			const upMsgs: Messages[] = [];
			// Wrap a to intercept up() calls
			const orig = a.up;
			a.up = (msgs) => {
				upMsgs.push(msgs);
				orig?.call(a, msgs);
			};
			const d = dynamicNode((get) => get(a));
			collect(d);
			d.up?.([[DIRTY]]); // use DIRTY as a test signal
			expect(upMsgs.length).toBeGreaterThan(0);
		});
	});
});
