/**
 * Phase 13.C — `selector` + `materialize` regression tests.
 */

import { COMPLETE, DATA } from "@graphrefly/pure-ts/core/messages.js";
import { node } from "@graphrefly/pure-ts/core/node.js";
import { Graph } from "@graphrefly/pure-ts/graph/graph.js";
import { describe, expect, it } from "vitest";
import { type GraphFactory, materialize, selector } from "../../extra/composition/materialize.js";
import { collect } from "../test-helpers.js";

// ---------------------------------------------------------------------------
// selector
// ---------------------------------------------------------------------------

describe("selector (Phase 13.C / G2 lock C)", () => {
	it("projects each upstream value to a routing key", () => {
		const src = node<{ kind: string; n: number }>([], {
			initial: { kind: "research", n: 1 },
			equals: () => false,
		});
		const key = selector(src, (req) => req.kind);
		const { messages, unsub } = collect(key, { flat: true });

		src.emit({ kind: "summarize", n: 2 });
		src.emit({ kind: "code", n: 3 });

		const keys = messages.filter((m) => m[0] === DATA).map((m) => m[1]);
		expect(keys).toEqual(["research", "summarize", "code"]);
		unsub();
	});

	it("dedupes when the projected key does NOT change", () => {
		const src = node<{ kind: string; n: number }>([], {
			initial: { kind: "research", n: 1 },
			equals: () => false,
		});
		const key = selector(src, (req) => req.kind);
		const { messages, unsub } = collect(key, { flat: true });

		// Multiple input emissions, same projected key — emits once.
		src.emit({ kind: "research", n: 2 });
		src.emit({ kind: "research", n: 3 });
		// Now real change.
		src.emit({ kind: "code", n: 4 });

		const keys = messages.filter((m) => m[0] === DATA).map((m) => m[1]);
		expect(keys).toEqual(["research", "code"]);
		unsub();
	});

	it("custom `equals` controls when the key is considered changed", () => {
		const src = node<{ tag: string; rev: number }>([], {
			initial: { tag: "v", rev: 1 },
			equals: () => false,
		});
		const key = selector(src, (req) => ({ tag: req.tag, rev: req.rev }), {
			// Only `tag` matters — `rev` changes don't count as a key change.
			equals: (a, b) => a.tag === b.tag,
		});
		const { messages, unsub } = collect(key, { flat: true });

		src.emit({ tag: "v", rev: 2 });
		src.emit({ tag: "v", rev: 3 });
		src.emit({ tag: "w", rev: 4 });

		const keys = messages.filter((m) => m[0] === DATA).map((m) => m[1]) as Array<{
			tag: string;
			rev: number;
		}>;
		expect(keys.map((k) => k.tag)).toEqual(["v", "w"]);
		unsub();
	});
});

// ---------------------------------------------------------------------------
// materialize
// ---------------------------------------------------------------------------

class FakeAgentGraph extends Graph {
	readonly id: string;
	constructor(id: string) {
		super(`agent-${id}`);
		this.id = id;
		// Add a state node so we can verify the slot's internals are mounted.
		this.state("kind", id);
	}
}

describe("materialize (Phase 13.C / G2 lock C)", () => {
	it("mounts the factory output for the active key under parent", () => {
		const parent = new Graph("parent");
		const key = node<string>([], { initial: "research" });
		const factories = node<ReadonlyMap<string, GraphFactory<FakeAgentGraph>>>([], {
			initial: new Map([
				["research", () => new FakeAgentGraph("research")],
				["coder", () => new FakeAgentGraph("coder")],
			]),
		});
		const slot = materialize(key, factories, parent, { slotName: "agent" });
		const { unsub } = collect(slot);

		// Mount happened: parent has an `agent::kind` resolvable path.
		expect(parent.node("agent::kind").cache).toBe("research");
		expect((slot.cache as FakeAgentGraph).id).toBe("research");

		unsub();
		parent.destroy();
	});

	it("re-mounts the slot when the key changes", () => {
		const parent = new Graph("parent");
		const key = node<string>([], { initial: "research" });
		const factories = node<ReadonlyMap<string, GraphFactory<FakeAgentGraph>>>([], {
			initial: new Map([
				["research", () => new FakeAgentGraph("research")],
				["coder", () => new FakeAgentGraph("coder")],
			]),
		});
		const slot = materialize(key, factories, parent, { slotName: "agent" });
		const { unsub } = collect(slot);

		expect(parent.node("agent::kind").cache).toBe("research");

		key.emit("coder");
		expect(parent.node("agent::kind").cache).toBe("coder");
		expect((slot.cache as FakeAgentGraph).id).toBe("coder");

		unsub();
		parent.destroy();
	});

	it("emits a fresh Graph reference on each key change", () => {
		const parent = new Graph("parent");
		const key = node<string>([], { initial: "a" });
		const factories = node<ReadonlyMap<string, GraphFactory<FakeAgentGraph>>>([], {
			initial: new Map([
				["a", () => new FakeAgentGraph("a")],
				["b", () => new FakeAgentGraph("b")],
			]),
		});
		const slot = materialize(key, factories, parent, { slotName: "agent" });
		const { messages, unsub } = collect(slot, { flat: true });

		key.emit("b");
		key.emit("a");

		const graphs = messages.filter((m) => m[0] === DATA).map((m) => m[1]) as FakeAgentGraph[];
		// Three distinct mounts: a, b, a. Each is a fresh instance.
		expect(graphs.map((g) => g.id)).toEqual(["a", "b", "a"]);
		expect(graphs[0]).not.toBe(graphs[2]); // fresh instance, not cached
		unsub();
		parent.destroy();
	});

	it("does NOT re-mount when factories change but key stays (G10 deferred)", () => {
		const parent = new Graph("parent");
		const key = node<string>([], { initial: "a" });
		let factoryACalls = 0;
		const initialFactories: ReadonlyMap<string, GraphFactory<FakeAgentGraph>> = new Map([
			[
				"a",
				() => {
					factoryACalls += 1;
					return new FakeAgentGraph(`a-v${factoryACalls}`);
				},
			],
		]);
		const factories = node<ReadonlyMap<string, GraphFactory<FakeAgentGraph>>>([], {
			initial: initialFactories,
			equals: () => false,
		});
		const slot = materialize(key, factories, parent, { slotName: "agent" });
		const { unsub } = collect(slot);

		expect(factoryACalls).toBe(1);
		expect(parent.node("agent::kind").cache).toBe("a-v1");

		// Update factories with a new "a" implementation. Per G10 deferral, the
		// active slot is NOT re-instantiated — the original factory output
		// continues running.
		const updatedFactories: ReadonlyMap<string, GraphFactory<FakeAgentGraph>> = new Map([
			[
				"a",
				() => {
					factoryACalls += 1;
					return new FakeAgentGraph(`a-v${factoryACalls}`);
				},
			],
		]);
		factories.emit(updatedFactories);

		expect(factoryACalls).toBe(1);
		expect(parent.node("agent::kind").cache).toBe("a-v1");

		// But on the next key transition, the new factory IS used.
		key.emit("a"); // same value but with non-dedup factories — won't re-mount
		expect(factoryACalls).toBe(1);

		unsub();
		parent.destroy();
	});

	it("unmounts the active slot when the materialize node tears down", () => {
		const parent = new Graph("parent");
		const key = node<string>([], { initial: "a" });
		const factories = node<ReadonlyMap<string, GraphFactory<FakeAgentGraph>>>([], {
			initial: new Map([["a", () => new FakeAgentGraph("a")]]),
		});
		const slot = materialize(key, factories, parent, { slotName: "agent" });
		const { unsub } = collect(slot);

		expect(parent.node("agent::kind").cache).toBe("a");

		// Dispose the consumer — materialize's cleanup unmounts the slot.
		unsub();

		expect(() => parent.node("agent::kind")).toThrow();

		parent.destroy();
	});

	it("emits no DATA when key has no matching factory; still allows later key matches", () => {
		const parent = new Graph("parent");
		const key = node<string>([], { initial: "missing" });
		const factories = node<ReadonlyMap<string, GraphFactory<FakeAgentGraph>>>([], {
			initial: new Map([["a", () => new FakeAgentGraph("a")]]),
		});
		const slot = materialize(key, factories, parent, { slotName: "agent" });
		const { messages, unsub } = collect(slot, { flat: true });

		// Initial wave: no factory for "missing" → no mount.
		expect(slot.cache).toBeUndefined();
		expect(messages.filter((m) => m[0] === DATA)).toHaveLength(0);

		// Switch to a key that DOES have a factory.
		key.emit("a");
		expect(parent.node("agent::kind").cache).toBe("a");
		expect((slot.cache as FakeAgentGraph).id).toBe("a");

		unsub();
		parent.destroy();
	});

	it("propagates COMPLETE from the key node", () => {
		const parent = new Graph("parent");
		const key = node<string>([], { initial: "a" });
		const factories = node<ReadonlyMap<string, GraphFactory<FakeAgentGraph>>>([], {
			initial: new Map([["a", () => new FakeAgentGraph("a")]]),
		});
		const slot = materialize(key, factories, parent, { slotName: "agent" });
		const { messages, unsub } = collect(slot, { flat: true });

		key.down([[COMPLETE]]);

		expect(messages.filter((m) => m[0] === COMPLETE)).toHaveLength(1);
		unsub();
		parent.destroy();
	});

	it("composes with selector — projection key drives mount", () => {
		const parent = new Graph("parent");
		type Request = { kind: "a" | "b"; n: number };
		const requests = node<Request>([], {
			initial: { kind: "a", n: 1 },
			equals: () => false,
		});
		const key = selector(requests, (r) => r.kind);
		const factories = node<ReadonlyMap<"a" | "b", GraphFactory<FakeAgentGraph>>>([], {
			initial: new Map<"a" | "b", GraphFactory<FakeAgentGraph>>([
				["a", () => new FakeAgentGraph("a")],
				["b", () => new FakeAgentGraph("b")],
			]),
		});
		const slot = materialize(key, factories, parent, { slotName: "agent" });
		const { unsub } = collect(slot);

		expect((slot.cache as FakeAgentGraph).id).toBe("a");

		// Same kind, different `n` — selector dedupes, no re-mount.
		const beforeRef = slot.cache;
		requests.emit({ kind: "a", n: 2 });
		expect(slot.cache).toBe(beforeRef);

		// Real kind change — re-mount.
		requests.emit({ kind: "b", n: 3 });
		expect((slot.cache as FakeAgentGraph).id).toBe("b");

		unsub();
		parent.destroy();
	});
});
