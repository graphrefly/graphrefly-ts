/**
 * DS-14.6.A U-B — actorPool.
 */
import { node } from "@graphrefly/pure-ts/core";
import { Graph } from "@graphrefly/pure-ts/graph";
import { describe, expect, it } from "vitest";
import type { ContextView } from "../../../presets/ai/context/index.js";
import { actorPool, type Todo } from "../../../presets/harness/actor-pool.js";

function mkView(): ContextView<string> {
	return {
		filter: () => true,
		pressure: node<number>([], { initial: 0 }),
		budgetTokens: 10_000,
		rules: [],
	};
}
function snapshot<T>(n: {
	subscribe: (cb: (m: readonly [symbol, T?][]) => void) => () => void;
}): T | undefined {
	let out: T | undefined;
	const unsub = n.subscribe((msgs) => {
		for (const m of msgs) if (m[1] !== undefined) out = m[1];
	});
	unsub();
	return out;
}

describe("DS-14.6.A U-B — actorPool", () => {
	it("attachActor adds to the single reactive `active` map (no per-actor subgraph)", () => {
		const g = new Graph("g");
		const pool = actorPool<string>(g, { name: "ap" });
		const a = pool.attachActor({ id: "a1", view: mkView() });
		const active = snapshot<ReadonlyMap<string, unknown>>(pool.active);
		expect([...(active?.keys() ?? [])]).toEqual(["a1"]);
		// D-B1: actor is NOT a subgraph — pool graph has the ctx pool mount only,
		// not a mount per actor.
		const before = pool.graph.describe?.() ? JSON.stringify(pool.graph.describe()).length : 0;
		pool.attachActor({ id: "a2", view: mkView() });
		const after = pool.graph.describe?.() ? JSON.stringify(pool.graph.describe()).length : 0;
		expect(after).toBe(before); // topology unchanged by adding an actor
		a.release();
		pool.dispose();
	});

	it("depthCap: attach beyond cap throws (D-B2)", () => {
		const g = new Graph("g");
		const pool = actorPool<string>(g, { depthCap: 2 });
		expect(() => pool.attachActor({ depth: 3, view: mkView() })).toThrow(/depthCap/);
		expect(() => pool.attachActor({ depth: 2, view: mkView() })).not.toThrow();
		pool.dispose();
	});

	it("publish writes to the shared pool with an actor tag; context view sees it", () => {
		const g = new Graph("g");
		const pool = actorPool<string>(g);
		const a = pool.attachActor({ id: "writer", view: mkView() });
		a.publish({
			payload: "hello",
			tags: ["doc"],
			importance: 0.5,
			compressible: true,
			topic: "context",
		});
		const entries = pool.contextPool.entries.cache ?? [];
		expect(entries[0]?.payload).toBe("hello");
		expect(entries[0]?.tags).toContain("actor:writer");
		a.release();
		pool.dispose();
	});

	it("todoCursor surfaces assigned + unassigned todos only", () => {
		const g = new Graph("g");
		const pool = actorPool<string>(g);
		const a = pool.attachActor({ id: "me", view: mkView() });
		pool.attachActor({ id: "other", view: mkView() });
		const mine: Todo = { id: "t1", assignee: "me", payload: 1 };
		const shared: Todo = { id: "t2", payload: 2 };
		const theirs: Todo = { id: "t3", assignee: "other", payload: 3 };
		a.enqueueTodo(mine);
		a.enqueueTodo(shared);
		a.enqueueTodo(theirs);
		const cur = snapshot<readonly Todo[]>(a.todoCursor) ?? [];
		expect(cur.map((t) => t.id).sort()).toEqual(["t1", "t2"]);
		a.release();
		pool.dispose();
	});

	it("setStatus updates the active map; release is idempotent + cascades", () => {
		const g = new Graph("g");
		const pool = actorPool<string>(g);
		const a = pool.attachActor({ id: "s1", view: mkView() });
		a.setStatus("running");
		expect(snapshot<ReadonlyMap<string, { status: string }>>(pool.active)?.get("s1")?.status).toBe(
			"running",
		);
		a.release();
		a.release(); // idempotent
		expect(snapshot<ReadonlyMap<string, unknown>>(pool.active)?.has("s1")).toBe(false);
		pool.dispose();
	});
});
