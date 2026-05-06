import { describe, expect, it } from "vitest";
import { DATA, type Messages } from "../../core/messages.js";
import { factoryTag } from "../../core/meta.js";
import { node } from "../../core/node.js";

import { Graph } from "../../graph/graph.js";
import type { ChatMessage, LLMAdapter, LLMResponse } from "../../patterns/ai/index.js";
import {
	compileSpec,
	decompileSpec,
	type GraphSpec,
	type GraphSpecCatalog,
	llmCompose,
	llmRefine,
	specDiff,
	validateSpec,
} from "../../patterns/graphspec/index.js";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function mockAdapter(responses: LLMResponse[]): LLMAdapter {
	let idx = 0;
	return {
		invoke(_msgs: readonly ChatMessage[], _opts?: unknown) {
			return Promise.resolve(responses[idx++]!);
		},
		stream: (async function* () {})(),
	} as LLMAdapter;
}

/** Catalog with simple fns for testing. */
const testCatalog: GraphSpecCatalog = {
	fns: {
		double: (deps) =>
			node(
				deps,
				(batchData, actions, ctx) => {
					const data = batchData.map((batch, i) =>
						batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
					);
					actions.emit((data[0] as number) * 2);
				},
				{ describeKind: "derived" },
			),
		sum: (deps) =>
			node(
				deps,
				(batchData, actions, ctx) => {
					const data = batchData.map((batch, i) =>
						batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
					);
					actions.emit((data as number[]).reduce((a, b) => a + b, 0));
				},
				{ describeKind: "derived" },
			),
		logEffect: (deps) =>
			node(
				deps,
				(batchData, actions, ctx) => {
					const data = batchData.map((batch, i) =>
						batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
					);
					return (
						(() => {
							/* side effect */
						})(data, actions, ctx) ?? undefined
					);
				},
				{ describeKind: "effect" },
			),
		identity: (deps) =>
			node(
				deps,
				(batchData, actions, ctx) => {
					const data = batchData.map((batch, i) =>
						batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
					);
					actions.emit(data[0]);
				},
				{ describeKind: "derived" },
			),
		timeout: (deps, _config) =>
			node(
				deps,
				(batchData, actions, ctx) => {
					const data = batchData.map((batch, i) =>
						batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
					);
					actions.emit(data[0]);
				},
				{ describeKind: "derived" },
			), // simplified
		retry: (deps, _config) =>
			node(
				deps,
				(batchData, actions, ctx) => {
					const data = batchData.map((batch, i) =>
						batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
					);
					actions.emit(data[0]);
				},
				{ describeKind: "derived" },
			), // simplified
		fallback: (deps, _config) =>
			node(
				deps,
				(batchData, actions, ctx) => {
					const data = batchData.map((batch, i) =>
						batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
					);
					actions.emit(data[0]);
				},
				{ describeKind: "derived" },
			), // simplified
	},
	sources: {
		"rest-api": (config) => node([], { meta: { source: "rest-api", ...config }, initial: null }),
	},
};

// ---------------------------------------------------------------------------
// validateSpec
// ---------------------------------------------------------------------------

describe("graphspec.validateSpec", () => {
	it("validates a minimal valid spec", () => {
		const spec: GraphSpec = {
			name: "test",
			nodes: {
				a: { type: "state", deps: [], value: 1 },
			},
		};
		const result = validateSpec(spec);
		expect(result.valid).toBe(true);
		expect(result.errors).toEqual([]);
	});

	it("rejects null input", () => {
		expect(validateSpec(null).valid).toBe(false);
	});

	it("rejects missing name", () => {
		const result = validateSpec({ nodes: {} });
		expect(result.valid).toBe(false);
		expect(result.errors[0]).toContain("name");
	});

	it("rejects invalid node type", () => {
		const result = validateSpec({
			name: "t",
			nodes: { x: { type: "bogus" } },
		});
		expect(result.valid).toBe(false);
		expect(result.errors[0]).toContain("invalid type");
	});

	it("rejects dep referencing non-existent node", () => {
		const result = validateSpec({
			name: "t",
			nodes: {
				a: { type: "derived", deps: ["missing"] },
			},
		});
		expect(result.valid).toBe(false);
		expect(result.errors[0]).toContain("missing");
	});

	it("validates template refs", () => {
		const spec = {
			name: "t",
			templates: {
				resilient: {
					params: ["$source"],
					nodes: {
						inner: {
							type: "derived",
							deps: ["$source"],
							meta: { ...factoryTag("identity") },
						},
					},
					output: "inner",
				},
			},
			nodes: {
				src: { type: "state", deps: [], value: 0 },
				wrapped: { type: "template", template: "resilient", bind: { $source: "src" } },
			},
		};
		expect(validateSpec(spec).valid).toBe(true);
	});

	it("rejects template ref to non-existent template", () => {
		const result = validateSpec({
			name: "t",
			nodes: {
				wrapped: { type: "template", template: "missing", bind: {} },
			},
		});
		expect(result.valid).toBe(false);
		expect(result.errors[0]).toContain("not found");
	});

	it("validates feedback edges", () => {
		const spec = {
			name: "t",
			nodes: {
				interval: { type: "state", deps: [], value: 10000 },
				compute: {
					type: "derived",
					deps: ["interval"],
					meta: { ...factoryTag("double") },
				},
			},
			feedback: [{ from: "compute", to: "interval", maxIterations: 5 }],
		};
		expect(validateSpec(spec).valid).toBe(true);
	});

	it("rejects feedback edge referencing non-existent node", () => {
		const result = validateSpec({
			name: "t",
			nodes: { a: { type: "state", deps: [] } },
			feedback: [{ from: "a", to: "missing" }],
		});
		expect(result.valid).toBe(false);
		expect(result.errors[0]).toContain("missing");
	});

	it("rejects template with bad output ref", () => {
		const result = validateSpec({
			name: "t",
			templates: {
				bad: { params: [], nodes: { x: { type: "state", deps: [] } }, output: "nonexistent" },
			},
			nodes: {},
		});
		expect(result.valid).toBe(false);
		expect(result.errors[0]).toContain("output");
	});

	it("rejects self-referencing deps", () => {
		const result = validateSpec({
			name: "t",
			nodes: { a: { type: "derived", deps: ["a"] } },
		});
		expect(result.valid).toBe(false);
		expect(result.errors[0]).toContain("self-referencing");
	});

	it("warns when derived/effect has no deps", () => {
		const result = validateSpec({
			name: "t",
			nodes: { a: { type: "derived", meta: { ...factoryTag("identity") } } },
		});
		expect(result.valid).toBe(false);
		expect(result.errors[0]).toContain("should have");
	});

	it("rejects feedback to non-state node", () => {
		const result = validateSpec({
			name: "t",
			nodes: {
				a: { type: "state", deps: [], value: 0 },
				b: { type: "derived", deps: ["a"], meta: { ...factoryTag("double") } },
			},
			feedback: [{ from: "a", to: "b" }],
		});
		expect(result.valid).toBe(false);
		expect(result.errors[0]).toContain("must be a state node");
	});

	it("rejects incomplete template bind", () => {
		const result = validateSpec({
			name: "t",
			templates: {
				tmpl: { params: ["$a", "$b"], nodes: { x: { type: "state", deps: [] } }, output: "x" },
			},
			nodes: {
				src: { type: "state", deps: [] },
				inst: { type: "template", template: "tmpl", bind: { $a: "src" } },
			},
		});
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.includes("$b") && e.includes("not bound"))).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// compileSpec
// ---------------------------------------------------------------------------

describe("graphspec.compileSpec", () => {
	it("compiles a simple state + derived graph", () => {
		const spec: GraphSpec = {
			name: "calc",
			nodes: {
				a: { type: "state", deps: [], value: 5 },
				b: { type: "derived", deps: ["a"], meta: { ...factoryTag("double") } },
			},
		};

		const g = compileSpec(spec, { catalog: testCatalog });
		expect(g).toBeInstanceOf(Graph);
		expect(g.name).toBe("calc");
		expect(g.node("a").cache).toBe(5);

		// Subscribe to activate derived
		const seen: number[] = [];
		g.observe("b").subscribe((msgs: Messages) => {
			for (const msg of msgs) {
				if (msg[0] === DATA) seen.push(msg[1] as number);
			}
		});

		g.set("a", 10);
		expect(seen).toContain(20);
		g.destroy();
	});

	it("compiles producer nodes from source catalog", () => {
		const spec: GraphSpec = {
			name: "api",
			nodes: {
				src: {
					type: "producer",
					deps: [],
					meta: { ...factoryTag("rest-api", { url: "https://example.com" }) },
				},
			},
		};

		const g = compileSpec(spec, { catalog: testCatalog });
		expect(g.node("src")).toBeDefined();
		g.destroy();
	});

	it("compiles multi-dep derived nodes", () => {
		const spec: GraphSpec = {
			name: "multi",
			nodes: {
				x: { type: "state", deps: [], value: 3 },
				y: { type: "state", deps: [], value: 7 },
				total: { type: "derived", deps: ["x", "y"], meta: { ...factoryTag("sum") } },
			},
		};

		const g = compileSpec(spec, { catalog: testCatalog });
		const seen: number[] = [];
		g.observe("total").subscribe((msgs: Messages) => {
			for (const msg of msgs) {
				if (msg[0] === DATA) seen.push(msg[1] as number);
			}
		});
		g.set("x", 10);
		expect(seen).toContain(17);
		g.destroy();
	});

	it("compiles effect nodes", () => {
		const spec: GraphSpec = {
			name: "fx",
			nodes: {
				src: { type: "state", deps: [], value: 0 },
				log: { type: "effect", deps: ["src"], meta: { ...factoryTag("logEffect") } },
			},
		};

		const g = compileSpec(spec, { catalog: testCatalog });
		expect(g.node("log")).toBeDefined();
		g.destroy();
	});

	it("throws on invalid spec", () => {
		expect(() => compileSpec({ name: "", nodes: {} } as GraphSpec)).toThrow("invalid GraphSpec");
	});

	it("throws on unresolvable deps", () => {
		const spec: GraphSpec = {
			name: "bad",
			nodes: {
				a: { type: "derived", deps: ["b"], meta: { ...factoryTag("identity") } },
				b: { type: "derived", deps: ["a"], meta: { ...factoryTag("identity") } },
			},
		};
		// Mutual dependency without a state root — unresolvable
		expect(() => compileSpec(spec, { catalog: testCatalog })).toThrow("unresolvable");
	});

	it("compiles template instantiations as mounted subgraphs", () => {
		const spec: GraphSpec = {
			name: "tmpl-test",
			templates: {
				resilientSource: {
					params: ["$source"],
					nodes: {
						timed: {
							type: "derived",
							deps: ["$source"],
							meta: { ...factoryTag("timeout", { timeoutMs: 2000 }) },
						},
						retried: {
							type: "derived",
							deps: ["timed"],
							meta: { ...factoryTag("retry", { maxAttempts: 2 }) },
						},
					},
					output: "retried",
				},
			},
			nodes: {
				api1Source: { type: "state", deps: [], value: null },
				api1: {
					type: "template",
					template: "resilientSource",
					bind: { $source: "api1Source" },
				},
			},
		};

		const g = compileSpec(spec, { catalog: testCatalog });
		expect(g).toBeInstanceOf(Graph);
		// Template creates a mounted subgraph
		const desc = g.describe({ detail: "standard" });
		expect(desc.subgraphs).toContain("api1");
		g.destroy();
	});

	it("wires feedback edges via reduction.feedback()", () => {
		const spec: GraphSpec = {
			name: "fb-test",
			nodes: {
				interval: { type: "state", deps: [], value: 10000 },
				compute: { type: "derived", deps: ["interval"], meta: { ...factoryTag("double") } },
			},
			feedback: [{ from: "compute", to: "interval", maxIterations: 3 }],
		};

		const g = compileSpec(spec, { catalog: testCatalog });
		// Feedback counter node should exist
		const desc = g.describe({ detail: "standard" });
		const nodeNames = Object.keys(desc.nodes);
		expect(nodeNames.some((n) => n.startsWith("__feedback_"))).toBe(true);
		g.destroy();
	});

	it("creates placeholder for producer without catalog entry", () => {
		const spec: GraphSpec = {
			name: "placeholder",
			nodes: {
				src: { type: "producer", deps: [], meta: { ...factoryTag("unknown-source") } },
			},
		};

		const g = compileSpec(spec);
		expect(g.node("src")).toBeDefined();
		g.destroy();
	});

	it("onMissing: 'error' throws listing every missing catalog entry", () => {
		const spec: GraphSpec = {
			name: "missing",
			nodes: {
				a: { type: "producer", deps: [], meta: { ...factoryTag("missing-source") } },
				b: { type: "derived", deps: ["a"], meta: { ...factoryTag("missing-fn") } },
			},
		};
		expect(() => compileSpec(spec, { onMissing: "error" })).toThrow(
			/missing source "missing-source"/,
		);
		expect(() => compileSpec(spec, { onMissing: "error" })).toThrow(/missing fn "missing-fn"/);
	});

	it("onMissing: 'warn' logs each miss via onWarn callback and still returns a graph", () => {
		const spec: GraphSpec = {
			name: "warn",
			nodes: {
				a: { type: "producer", deps: [], meta: { ...factoryTag("absent") } },
			},
		};
		const warnings: string[] = [];
		const g = compileSpec(spec, {
			onMissing: "warn",
			onWarn: (m) => warnings.push(m),
		});
		expect(g.node("a")).toBeDefined();
		expect(warnings.length).toBe(1);
		expect(warnings[0]).toMatch(/missing source "absent"/);
		g.destroy();
	});

	it("onMissing: 'placeholder' (default) is silent", () => {
		const spec: GraphSpec = {
			name: "placeholder-default",
			nodes: {
				a: { type: "producer", deps: [], meta: { ...factoryTag("absent") } },
			},
		};
		const warnings: string[] = [];
		const g = compileSpec(spec, { onWarn: (m) => warnings.push(m) });
		expect(g.node("a")).toBeDefined();
		expect(warnings.length).toBe(0);
		g.destroy();
	});
});

// ---------------------------------------------------------------------------
// decompileSpec
// ---------------------------------------------------------------------------

describe("graphspec.decompileSpec", () => {
	it("decompiles a simple graph", () => {
		const g = new Graph("simple");
		const a = node([], { name: "a", meta: { description: "input" }, initial: 42 });
		g.add(a, { name: "a" });

		const spec = decompileSpec(g);
		expect(spec.name).toBe("simple");
		expect(spec.nodes.a).toBeDefined();
		expect(spec.nodes.a!.type).toBe("state");
		// State nodes preserve `value` in spec projection (path (b)).
		expect((spec.nodes.a as { value: unknown }).value).toBe(42);
		g.destroy();
	});

	it("decompiles a graph with derived node deps", () => {
		const g = new Graph("deps");
		const a = node([], { name: "a", initial: 1 });
		const b = node(
			[a],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				actions.emit((data[0] as number) + 1);
			},
			{ describeKind: "derived", name: "b" },
		);
		g.add(a, { name: "a" });
		g.add(b, { name: "b" });
		b.subscribe(() => {});

		const spec = decompileSpec(g);
		expect(spec.nodes.a!.type).toBe("state");
		expect(spec.nodes.b!.type).toBe("derived");
		expect((spec.nodes.b as { deps?: string[] }).deps).toEqual(["a"]);
		g.destroy();
	});

	it("decompiles feedback edges from counter meta", () => {
		const spec: GraphSpec = {
			name: "fb-decompile",
			nodes: {
				interval: { type: "state", deps: [], value: 10000 },
				compute: { type: "derived", deps: ["interval"], meta: { ...factoryTag("double") } },
			},
			feedback: [{ from: "compute", to: "interval", maxIterations: 5 }],
		};

		const g = compileSpec(spec, { catalog: testCatalog });
		// Activate the derived node
		g.observe("compute").subscribe(() => {});

		const decompiled = decompileSpec(g);
		expect(decompiled.feedback).toBeDefined();
		expect(decompiled.feedback!.length).toBe(1);
		expect(decompiled.feedback![0]!.from).toBe("compute");
		expect(decompiled.feedback![0]!.to).toBe("interval");
		expect(decompiled.feedback![0]!.maxIterations).toBe(5);
		g.destroy();
	});

	it("skips meta segment nodes", () => {
		const g = new Graph("meta-skip");
		const a = node([], { name: "a", meta: { label: "test" }, initial: 1 });
		g.add(a, { name: "a" });

		const spec = decompileSpec(g);
		const paths = Object.keys(spec.nodes);
		expect(paths.every((p) => !p.includes("__meta__"))).toBe(true);
		g.destroy();
	});
});

// ---------------------------------------------------------------------------
// specDiff
// ---------------------------------------------------------------------------

describe("graphspec.specDiff", () => {
	it("reports no changes for identical specs", () => {
		const spec: GraphSpec = {
			name: "same",
			nodes: { a: { type: "state", deps: [], value: 1 } },
		};
		const result = specDiff(spec, spec);
		expect(result.entries).toEqual([]);
		expect(result.summary).toBe("no changes");
	});

	it("reports added nodes", () => {
		const a: GraphSpec = { name: "g", nodes: { x: { type: "state", deps: [] } } };
		const b: GraphSpec = {
			name: "g",
			nodes: { x: { type: "state", deps: [] }, y: { type: "derived", deps: ["x"] } },
		};
		const result = specDiff(a, b);
		expect(result.entries.some((e) => e.type === "added" && e.path === "nodes.y")).toBe(true);
	});

	it("reports removed nodes", () => {
		const a: GraphSpec = {
			name: "g",
			nodes: { x: { type: "state", deps: [] }, y: { type: "derived", deps: ["x"] } },
		};
		const b: GraphSpec = { name: "g", nodes: { x: { type: "state", deps: [] } } };
		const result = specDiff(a, b);
		expect(result.entries.some((e) => e.type === "removed" && e.path === "nodes.y")).toBe(true);
	});

	it("reports changed node config (meta.factory + meta.factoryArgs)", () => {
		const a: GraphSpec = {
			name: "g",
			nodes: {
				x: {
					type: "derived",
					deps: [],
					meta: { ...factoryTag("a", { k: 1 }) },
				},
			},
		};
		const b: GraphSpec = {
			name: "g",
			nodes: {
				x: {
					type: "derived",
					deps: [],
					meta: { ...factoryTag("b", { k: 2 }) },
				},
			},
		};
		const result = specDiff(a, b);
		expect(result.entries.some((e) => e.type === "changed" && e.path === "nodes.x")).toBe(true);
		expect(result.entries[0]!.detail).toContain("fn");
	});

	it("reports name change", () => {
		const a: GraphSpec = { name: "old", nodes: {} };
		const b: GraphSpec = { name: "new", nodes: {} };
		const result = specDiff(a, b);
		expect(result.entries[0]!.path).toBe("name");
	});

	it("reports template changes", () => {
		const a: GraphSpec = {
			name: "g",
			nodes: {},
			templates: {
				tmpl: { params: ["$x"], nodes: { inner: { type: "state", deps: [] } }, output: "inner" },
			},
		};
		const b: GraphSpec = { name: "g", nodes: {} };
		const result = specDiff(a, b);
		expect(result.entries.some((e) => e.type === "removed" && e.path === "templates.tmpl")).toBe(
			true,
		);
	});

	it("reports feedback edge changes", () => {
		const a: GraphSpec = {
			name: "g",
			nodes: { x: { type: "state", deps: [] }, y: { type: "derived", deps: ["x"] } },
			feedback: [{ from: "y", to: "x", maxIterations: 5 }],
		};
		const b: GraphSpec = {
			name: "g",
			nodes: { x: { type: "state", deps: [] }, y: { type: "derived", deps: ["x"] } },
			feedback: [{ from: "y", to: "x", maxIterations: 10 }],
		};
		const result = specDiff(a, b);
		expect(result.entries.some((e) => e.type === "changed" && e.path.includes("feedback"))).toBe(
			true,
		);
	});

	it("generates human-readable summary", () => {
		const a: GraphSpec = { name: "g", nodes: { x: { type: "state", deps: [] } } };
		const b: GraphSpec = {
			name: "g",
			nodes: { x: { type: "state", deps: [] }, y: { type: "state", deps: [] } },
		};
		const result = specDiff(a, b);
		expect(result.summary).toContain("1 added");
	});
});

// ---------------------------------------------------------------------------
// llmCompose
// ---------------------------------------------------------------------------

describe("graphspec.llmCompose", () => {
	it("generates GraphSpec from LLM response", async () => {
		const spec: GraphSpec = {
			name: "email_triage",
			nodes: {
				inbox: {
					type: "producer",
					deps: [],
					meta: { ...factoryTag("email"), description: "Email inbox source" },
				},
				classify: {
					type: "derived",
					deps: ["inbox"],
					meta: { ...factoryTag("llmClassify"), description: "Classify emails" },
				},
			},
		};

		const adapter = mockAdapter([{ content: JSON.stringify(spec), finishReason: "end_turn" }]);

		const result = await llmCompose("Build an email triage system", adapter);
		expect(result.name).toBe("email_triage");
		expect(result.nodes.inbox!.type).toBe("producer");
		expect(result.nodes.classify!.type).toBe("derived");
	});

	it("strips markdown fences from LLM output", async () => {
		const spec: GraphSpec = {
			name: "test",
			nodes: { a: { type: "state", deps: [], value: 1, meta: { description: "a" } } },
		};

		const adapter = mockAdapter([
			{ content: `\`\`\`json\n${JSON.stringify(spec)}\n\`\`\``, finishReason: "end_turn" },
		]);

		const result = await llmCompose("test", adapter);
		expect(result.name).toBe("test");
	});

	it("throws on invalid JSON", async () => {
		const adapter = mockAdapter([{ content: "not json!", finishReason: "end_turn" }]);
		await expect(llmCompose("bad", adapter)).rejects.toThrow("not valid JSON");
	});

	it("throws on invalid GraphSpec", async () => {
		const adapter = mockAdapter([
			{ content: JSON.stringify({ nodes: {} }), finishReason: "end_turn" },
		]);
		await expect(llmCompose("bad", adapter)).rejects.toThrow("invalid GraphSpec");
	});
});

// ---------------------------------------------------------------------------
// llmRefine
// ---------------------------------------------------------------------------

describe("graphspec.llmRefine", () => {
	it("modifies existing spec based on feedback", async () => {
		const original: GraphSpec = {
			name: "v1",
			nodes: { a: { type: "state", deps: [], value: 1, meta: { description: "src" } } },
		};
		const refined: GraphSpec = {
			name: "v2",
			nodes: {
				a: { type: "state", deps: [], value: 1, meta: { description: "src" } },
				b: {
					type: "derived",
					deps: ["a"],
					meta: { ...factoryTag("double"), description: "doubled" },
				},
			},
		};

		const adapter = mockAdapter([{ content: JSON.stringify(refined), finishReason: "end_turn" }]);

		const result = await llmRefine(original, "Add a doubling derived node", adapter);
		expect(result.name).toBe("v2");
		expect(result.nodes.b).toBeDefined();
	});
});
