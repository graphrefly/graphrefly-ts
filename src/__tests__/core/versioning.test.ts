import { describe, expect, it } from "vitest";
import { batch } from "../../core/batch.js";
import { registerBuiltins } from "../../core/config.js";
import { DATA, DIRTY, RESOLVED } from "../../core/messages.js";
import { describeNode } from "../../core/meta.js";
import { GraphReFlyConfig, type NodeImpl, node } from "../../core/node.js";
import { derived, state } from "../../core/sugar.js";
import {
	advanceVersion,
	createVersioning,
	defaultHash,
	isV1,
	type V1,
} from "../../core/versioning.js";
import { Graph } from "../../graph/graph.js";

// ---------------------------------------------------------------------------
// Unit: versioning module
// ---------------------------------------------------------------------------

describe("createVersioning", () => {
	it("V0: returns id + version 0", () => {
		const v = createVersioning(0, undefined);
		expect(v.id).toBeTypeOf("string");
		expect(v.id.length).toBeGreaterThan(0);
		expect(v.version).toBe(0);
		expect("cid" in v).toBe(false);
	});

	it("V0: accepts custom id", () => {
		const v = createVersioning(0, undefined, { id: "custom-id" });
		expect(v.id).toBe("custom-id");
	});

	it("V1: returns id + version 0 + cid + prev null", () => {
		const v = createVersioning(1, 42);
		expect(v.id).toBeTypeOf("string");
		expect(v.version).toBe(0);
		expect(isV1(v)).toBe(true);
		const v1 = v as V1;
		expect(v1.cid).toBeTypeOf("string");
		expect(v1.cid.length).toBe(16);
		expect(v1.prev).toBeNull();
	});

	it("V1: cid is deterministic for same value", () => {
		const a = createVersioning(1, { x: 1, y: 2 });
		const b = createVersioning(1, { y: 2, x: 1 }); // different key order
		expect((a as V1).cid).toBe((b as V1).cid);
	});

	it("V1: cid differs for different values", () => {
		const a = createVersioning(1, 42);
		const b = createVersioning(1, 43);
		expect((a as V1).cid).not.toBe((b as V1).cid);
	});
});

describe("advanceVersion", () => {
	it("V0: increments version", () => {
		const v = createVersioning(0, undefined);
		advanceVersion(v, 1, defaultHash);
		expect(v.version).toBe(1);
		advanceVersion(v, 2, defaultHash);
		expect(v.version).toBe(2);
	});

	it("V1: increments version and rotates cid → prev", () => {
		const v = createVersioning(1, "hello") as V1;
		const firstCid = v.cid;
		advanceVersion(v, "world", defaultHash);
		expect(v.version).toBe(1);
		expect(v.prev).toBe(firstCid);
		expect(v.cid).not.toBe(firstCid);
	});
});

describe("defaultHash", () => {
	it("produces 16 hex chars", () => {
		expect(defaultHash(42)).toMatch(/^[0-9a-f]{16}$/);
	});

	it("is deterministic", () => {
		expect(defaultHash([1, 2, 3])).toBe(defaultHash([1, 2, 3]));
	});

	it("sorts object keys", () => {
		expect(defaultHash({ b: 2, a: 1 })).toBe(defaultHash({ a: 1, b: 2 }));
	});
});

// ---------------------------------------------------------------------------
// Integration: node with versioning
// ---------------------------------------------------------------------------

describe("node V0 versioning", () => {
	it("state node has v with id and version 0", () => {
		const s = state(42, { versioning: 0 });
		expect(s.v).toBeDefined();
		expect(s.v!.id).toBeTypeOf("string");
		expect(s.v!.version).toBe(0);
	});

	it("version increments on DATA", () => {
		const s = state(0, { versioning: 0 });
		const unsub = s.subscribe(() => {});
		s.down([[DATA, 1]]);
		expect(s.v!.version).toBe(1);
		s.down([[DATA, 2]]);
		expect(s.v!.version).toBe(2);
		unsub();
	});

	it("version does NOT increment on RESOLVED", () => {
		const s = state(0, { versioning: 0 });
		const unsub = s.subscribe(() => {});
		s.down([[DIRTY], [RESOLVED]]);
		expect(s.v!.version).toBe(0);
		unsub();
	});

	it("version increments in derived node on recompute", () => {
		const a = state(1, { name: "a" });
		const b = derived([a], (deps) => (deps[0] as number) * 2, {
			name: "b",
			versioning: 0,
		});
		const unsub = b.subscribe(() => {});
		// Initial compute on subscribe: version is already 1
		expect(b.v!.version).toBe(1);
		a.down([[DIRTY], [DATA, 5]]);
		expect(b.v!.version).toBe(2);
		expect(b.cache).toBe(10);
		unsub();
	});

	it("version does NOT increment when derived value unchanged (RESOLVED)", () => {
		const a = state(1, { name: "a" });
		// derived always returns constant — emits RESOLVED after first DATA
		const b = derived([a], () => 42, { name: "b", versioning: 0 });
		const unsub = b.subscribe(() => {});
		// Initial compute: version 0 → 1 (first DATA)
		expect(b.v!.version).toBe(1);
		a.down([[DIRTY], [DATA, 2]]);
		// Value unchanged (still 42) → RESOLVED, no version bump
		expect(b.v!.version).toBe(1);
		unsub();
	});

	it("v is undefined when versioning not enabled", () => {
		const s = state(0);
		expect(s.v).toBeUndefined();
	});

	it("custom id is preserved", () => {
		const s = state(0, { versioning: 0, versioningId: "my-node-001" });
		expect(s.v!.id).toBe("my-node-001");
	});
});

describe("node V1 versioning", () => {
	it("state node has cid and prev", () => {
		const s = state(42, { versioning: 1 });
		expect(s.v).toBeDefined();
		expect(isV1(s.v!)).toBe(true);
		const v = s.v as V1;
		expect(v.cid).toBeTypeOf("string");
		expect(v.cid.length).toBe(16);
		expect(v.prev).toBeNull();
	});

	it("cid changes and prev links on DATA", () => {
		const s = state("a", { versioning: 1 });
		const initialCid = (s.v as V1).cid;

		const unsub = s.subscribe(() => {});
		s.down([[DATA, "b"]]);
		const v = s.v as V1;
		expect(v.version).toBe(1);
		expect(v.cid).not.toBe(initialCid);
		expect(v.prev).toBe(initialCid);
		unsub();
	});

	it("linked history across multiple updates", () => {
		const s = state(0, { versioning: 1 });
		const unsub = s.subscribe(() => {});
		const cids: string[] = [(s.v as V1).cid];
		for (let i = 1; i <= 3; i++) {
			s.down([[DATA, i]]);
			cids.push((s.v as V1).cid);
			expect((s.v as V1).prev).toBe(cids[i - 1]);
		}
		// All cids should be unique
		expect(new Set(cids).size).toBe(4);
		unsub();
	});

	it("custom hash function", () => {
		const customHash = (v: unknown) => `custom-${String(v)}`;
		const s = state(42, { versioning: 1, versioningHash: customHash });
		expect((s.v as V1).cid).toBe("custom-42");

		const unsub = s.subscribe(() => {});
		s.down([[DATA, 99]]);
		expect((s.v as V1).cid).toBe("custom-99");
		expect((s.v as V1).prev).toBe("custom-42");
		unsub();
	});
});

describe("versioning in batch", () => {
	it("version advances once per DATA in batch", () => {
		const s = state(0, { versioning: 0 });
		const unsub = s.subscribe(() => {});
		batch(() => {
			s.down([[DATA, 1]]);
			s.down([[DATA, 2]]);
		});
		expect(s.v!.version).toBe(2);
		expect(s.cache).toBe(2);
		unsub();
	});
});

describe("versioning in describeNode", () => {
	it("V0 appears in describe output", () => {
		const s = state(0, { versioning: 0, name: "x" });
		const d = describeNode(s);
		expect(d.v).toBeDefined();
		expect(d.v!.id).toBe(s.v!.id);
		expect(d.v!.version).toBe(0);
		expect(d.v!.cid).toBeUndefined();
	});

	it("V1 appears in describe output with cid and prev", () => {
		const s = state(42, { versioning: 1, name: "x" });
		const d = describeNode(s);
		expect(d.v).toBeDefined();
		expect(d.v!.cid).toBeTypeOf("string");
		expect(d.v!.prev).toBeNull();
	});

	it("no v field when versioning disabled", () => {
		const s = state(0, { name: "x" });
		const d = describeNode(s);
		expect(d.v).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// Retroactive _applyVersioning + config-level defaults
// ---------------------------------------------------------------------------

describe("_applyVersioning — retroactive + monotonic upgrade", () => {
	it("attaches V0 to a node that had no versioning", () => {
		const s = state(42) as unknown as NodeImpl<number>;
		expect(s.v).toBeUndefined();
		s._applyVersioning(0);
		expect(s.v).toBeDefined();
		expect(s.v!.version).toBe(0);
	});

	it("upgrades V0 → V1, preserving id and version counter", () => {
		const s = state(42, { versioning: 0 }) as unknown as NodeImpl<number>;
		const unsub = s.subscribe(() => {});
		s.down([[DATA, 99]]);
		const originalId = s.v!.id;
		const originalVersion = s.v!.version;
		expect(originalVersion).toBe(1);

		s._applyVersioning(1);
		expect(s.v!.id).toBe(originalId);
		expect(s.v!.version).toBe(originalVersion);
		expect(isV1(s.v!)).toBe(true);
		expect((s.v as V1).cid).toBeTypeOf("string");
		unsub();
	});

	it("is monotonic — V1 → V0 is a no-op (levels only go up)", () => {
		const s = state(42, { versioning: 1 }) as unknown as NodeImpl<number>;
		const cidBefore = (s.v as V1).cid;
		s._applyVersioning(0);
		expect(isV1(s.v!)).toBe(true);
		expect((s.v as V1).cid).toBe(cidBefore);
	});
});

describe("config-level defaults — defaultVersioning + defaultHashFn", () => {
	it("nodes inherit config.defaultVersioning when opts.versioning is omitted", () => {
		const cfg = new GraphReFlyConfig({
			onMessage: () => undefined,
			onSubscribe: () => undefined,
			defaultVersioning: 0,
		});
		registerBuiltins(cfg);
		const s = state(1, { config: cfg });
		expect(s.v).toBeDefined();
		expect(s.v!.version).toBe(0);
	});

	it("nodes use config.defaultHashFn when opts.versioningHash is omitted", () => {
		let customHashCalls = 0;
		const customHash = (v: unknown): string => {
			customHashCalls += 1;
			return `cust-${String(v)}`;
		};
		const cfg = new GraphReFlyConfig({
			onMessage: () => undefined,
			onSubscribe: () => undefined,
			defaultVersioning: 1,
			defaultHashFn: customHash,
		});
		registerBuiltins(cfg);
		const s = state(42, { config: cfg });
		expect(customHashCalls).toBeGreaterThanOrEqual(1);
		expect((s.v as V1).cid).toBe("cust-42");
	});

	it("per-node opts.versioning overrides config.defaultVersioning", () => {
		const cfg = new GraphReFlyConfig({
			onMessage: () => undefined,
			onSubscribe: () => undefined,
			defaultVersioning: 1,
		});
		registerBuiltins(cfg);
		// Per-node opt-out at v0.
		const s = state(1, { config: cfg, versioning: 0 });
		expect(s.v).toBeDefined();
		expect(isV1(s.v!)).toBe(false);
	});
});

describe("versioning with effect nodes", () => {
	it("effect nodes can have V0 versioning (no auto-emit, so version stays 0)", () => {
		const a = state(1);
		let called = 0;
		// Use node() directly since effect() sugar doesn't accept extra opts
		const e = node(
			[a],
			() => {
				called++;
			},
			{ describeKind: "effect", versioning: 0 },
		);
		const unsub = e.subscribe(() => {});
		// Effect runs once on initial connect
		a.down([[DIRTY], [DATA, 2]]);
		// Effect runs again on dep change
		expect(called).toBe(2);
		// Effects don't emit DATA, so version doesn't advance
		expect(e.v!.version).toBe(0);
		unsub();
	});
});

// ---------------------------------------------------------------------------
// 6.0: Graph.diff version-aware
// ---------------------------------------------------------------------------

describe("Graph.diff V0 optimization", () => {
	it("skips value comparison when versions match", () => {
		const nodeA = {
			type: "state",
			status: "settled",
			value: { big: "object" },
			deps: [],
			meta: {},
			v: { id: "x", version: 5 },
		};
		const a = { name: "g", nodes: { n: nodeA }, edges: [], subgraphs: [] };
		const b = { name: "g", nodes: { n: { ...nodeA } }, edges: [], subgraphs: [] };
		const result = Graph.diff(a, b);
		expect(result.nodesChanged).toEqual([]);
	});

	it("detects value change when versions differ", () => {
		const a = {
			name: "g",
			nodes: {
				n: {
					type: "state",
					status: "settled",
					value: 1,
					deps: [],
					meta: {},
					v: { id: "x", version: 1 },
				},
			},
			edges: [],
			subgraphs: [],
		};
		const b = {
			name: "g",
			nodes: {
				n: {
					type: "state",
					status: "settled",
					value: 2,
					deps: [],
					meta: {},
					v: { id: "x", version: 2 },
				},
			},
			edges: [],
			subgraphs: [],
		};
		const result = Graph.diff(a, b);
		expect(result.nodesChanged).toHaveLength(1);
		expect(result.nodesChanged[0].field).toBe("value");
	});
});
