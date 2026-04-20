import type { GraphSpecCatalog } from "@graphrefly/graphrefly";
import { derived } from "@graphrefly/graphrefly";
import { describe, expect, it } from "vitest";
import {
	createSession,
	graphreflyCreate,
	graphreflyDelete,
	graphreflyDescribe,
	graphreflyExplain,
	graphreflyList,
	graphreflyObserve,
	graphreflyReduce,
	graphreflySnapshotDelete,
	graphreflySnapshotList,
	graphreflySnapshotRestore,
	graphreflySnapshotSave,
} from "../src/index.js";

const catalog: GraphSpecCatalog = {
	fns: {
		double: (deps) => derived(deps, ([v]) => (v as number) * 2),
		addOne: (deps) => derived(deps, ([v]) => (v as number) + 1),
	},
};

const basicSpec = {
	name: "basic",
	nodes: {
		input: { type: "state", initial: 0 },
		doubled: { type: "derived", deps: ["input"], fn: "double" },
		output: { type: "derived", deps: ["doubled"], fn: "addOne" },
	},
};

// State-only spec for snapshot round-trip tests — non-state nodes need
// factories during fromSnapshot, which is out of the MCP tool surface
// (would require server-operator wiring). Snapshot tests here use pure
// state graphs so the default auto-hydration path works.
const stateOnlySpec = {
	name: "state-only",
	nodes: {
		input: { type: "state", initial: 0 },
		note: { type: "state", initial: "hello" },
	},
};

describe("mcp-server tools", () => {
	it("create → list → describe round-trip", () => {
		const session = createSession();
		const result = graphreflyCreate(session, { graphId: "g1", spec: basicSpec }, catalog);
		expect(result.graphId).toBe("g1");
		expect(result.name).toBe("basic");

		const listed = graphreflyList(session);
		expect(listed.graphs).toEqual(["g1"]);

		const described = graphreflyDescribe(session, { graphId: "g1", detail: "minimal" });
		expect(typeof described).toBe("object");
		session.dispose();
	});

	it("create rejects duplicate graphId", () => {
		const session = createSession();
		graphreflyCreate(session, { graphId: "dup", spec: basicSpec }, catalog);
		expect(() =>
			graphreflyCreate(session, { graphId: "dup", spec: basicSpec }, catalog),
		).toThrowError(/already exists/);
		session.dispose();
	});

	it("observe returns a single node slice when path is set", () => {
		const session = createSession();
		graphreflyCreate(session, { graphId: "g1", spec: basicSpec }, catalog);
		const observed = graphreflyObserve(session, {
			graphId: "g1",
			path: "input",
			detail: "standard",
		});
		expect(observed.path).toBe("input");
		session.dispose();
	});

	it("observe surfaces node-not-found for unknown path", () => {
		const session = createSession();
		graphreflyCreate(session, { graphId: "g1", spec: basicSpec }, catalog);
		expect(() => graphreflyObserve(session, { graphId: "g1", path: "ghost" })).toThrowError(
			/node "ghost"/,
		);
		session.dispose();
	});

	it("explain returns a CausalChain JSON payload", () => {
		const session = createSession();
		graphreflyCreate(session, { graphId: "g1", spec: basicSpec }, catalog);
		const chain = graphreflyExplain(session, {
			graphId: "g1",
			from: "input",
			to: "output",
		}) as { from: string; to: string; found: boolean; steps: unknown[] };
		expect(chain.from).toBe("input");
		expect(chain.to).toBe("output");
		expect(chain.found).toBe(true);
		expect(chain.steps.length).toBeGreaterThan(0);
		session.dispose();
	});

	it("reduce runs a spec end-to-end", async () => {
		const result = await graphreflyReduce({ spec: basicSpec, input: 5 }, catalog);
		expect(result).toBe(11);
	});

	it("snapshot save/list/restore/delete round-trip", async () => {
		const session = createSession();
		graphreflyCreate(session, { graphId: "g1", spec: stateOnlySpec }, catalog);

		const saved = await graphreflySnapshotSave(session, { graphId: "g1", snapshotId: "s1" });
		expect(saved.snapshotId).toBe("s1");

		const listed = await graphreflySnapshotList(session);
		expect([...listed]).toEqual(["s1"]);

		// Remove live graph so restore can re-register under the same id.
		graphreflyDelete(session, { graphId: "g1" });
		const restored = await graphreflySnapshotRestore(session, {
			snapshotId: "s1",
			graphId: "g1",
		});
		expect(restored.graphId).toBe("g1");

		await graphreflySnapshotDelete(session, { snapshotId: "s1" });
		const after = await graphreflySnapshotList(session);
		expect([...after]).toEqual([]);
		session.dispose();
	});

	it("requireGraph surfaces graph-not-found", () => {
		const session = createSession();
		expect(() => graphreflyDescribe(session, { graphId: "missing" })).toThrowError(
			/graph "missing"/,
		);
		session.dispose();
	});
});
