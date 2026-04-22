import type { GraphSpecCatalog, LLMAdapter, LLMResponse } from "@graphrefly/graphrefly";
import { derived } from "@graphrefly/graphrefly";
import { describe, expect, it } from "vitest";
import {
	createSession,
	graphreflyCompose,
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

	it("compose returns validated GraphSpec via wired adapter", async () => {
		const validSpec = {
			name: "composed",
			nodes: {
				input: {
					type: "state",
					initial: 0,
					meta: { description: "user-supplied input" },
				},
				output: {
					type: "derived",
					deps: ["input"],
					fn: "double",
					meta: { description: "doubles the input" },
				},
			},
		};
		const mockAdapter: LLMAdapter = {
			provider: "mock",
			model: "mock-m",
			invoke(): Promise<LLMResponse> {
				return Promise.resolve({
					content: JSON.stringify(validSpec),
					usage: { input: { regular: 10 }, output: { regular: 20 } },
				});
			},
			// biome-ignore lint/correctness/useYield: throws intentionally; compose uses invoke.
			async *stream() {
				throw new Error("stream not used by compose");
			},
		};
		const result = await graphreflyCompose({ problem: "double the input" }, catalog, {
			adapter: mockAdapter,
		});
		expect(result.validated).toBe(true);
		expect(result.spec).toMatchObject({ name: "composed" });
	});

	it("compose surfaces compose-not-configured when no adapter wired", async () => {
		await expect(
			graphreflyCompose({ problem: "x" }, catalog, { adapter: undefined }),
		).rejects.toMatchObject({ code: "compose-not-configured" });
	});

	it("compose maps llmCompose failures to compose-failed with a sanitized message", async () => {
		const secretEcho = "SYSTEM-PROMPT-ECHO: you are a graph architect; the internal catalog is …";
		const brokenAdapter: LLMAdapter = {
			provider: "mock",
			model: "mock-m",
			invoke(): Promise<LLMResponse> {
				return Promise.resolve({
					// Non-JSON content containing something that LOOKS like a
					// system-prompt echo. The handler must NOT surface this as
					// the user-facing message — only in details.excerpt.
					content: secretEcho,
					usage: { input: { regular: 0 }, output: { regular: 0 } },
				});
			},
			stream: async function* () {
				yield* [] as never[];
			},
		};
		try {
			await graphreflyCompose({ problem: "x" }, catalog, { adapter: brokenAdapter });
			throw new Error("expected throw");
		} catch (err) {
			const payload = (err as { toJSON?: () => Record<string, unknown> }).toJSON?.();
			expect(payload).toMatchObject({ code: "compose-failed" });
			expect(payload?.message).not.toContain("SYSTEM-PROMPT-ECHO");
			expect((payload?.details as { excerpt?: string } | undefined)?.excerpt).toBeDefined();
		}
	});

	it("compose rejects models outside composeModelAllowlist before calling the adapter", async () => {
		let called = false;
		const guardedAdapter: LLMAdapter = {
			provider: "mock",
			model: "cheap-m",
			invoke(): Promise<LLMResponse> {
				called = true;
				return Promise.resolve({
					content: "{}",
					usage: { input: { regular: 0 }, output: { regular: 0 } },
				});
			},
			stream: async function* () {
				yield* [] as never[];
			},
		};
		await expect(
			graphreflyCompose({ problem: "x", model: "claude-opus-4-7" }, catalog, {
				adapter: guardedAdapter,
				modelAllowlist: ["cheap-m"],
			}),
		).rejects.toMatchObject({ code: "compose-failed" });
		expect(called).toBe(false);
	});
});
