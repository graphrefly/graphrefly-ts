import { describe, expect, it } from "vitest";
import {
	portableCatalog,
	portableFns,
	portableSources,
} from "../../../evals/lib/portable-catalog.js";
import {
	adaptivePollerTemplate,
	portableTemplates,
	resilientFetchTemplate,
} from "../../../evals/lib/portable-templates.js";
import {
	type GraphSpec,
	generateCatalogPrompt,
	validateSpec,
	validateSpecAgainstCatalog,
} from "../../patterns/graphspec/index.js";

// ---------------------------------------------------------------------------
// Catalog shape
// ---------------------------------------------------------------------------

describe("portableCatalog — shape", () => {
	it("exposes fns and sources", () => {
		expect(Object.keys(portableFns).length).toBeGreaterThan(40);
		expect(Object.keys(portableSources).length).toBeGreaterThan(15);
		expect(portableCatalog.fns).toBe(portableFns);
		expect(portableCatalog.sources).toBe(portableSources);
	});

	it("every fn has a description and a single tag", () => {
		for (const [name, entry] of Object.entries(portableFns)) {
			expect(entry.description, `${name} description`).toBeTruthy();
			expect(entry.tags?.length ?? 0, `${name} tags`).toBeGreaterThanOrEqual(1);
		}
	});

	it("every source has a description", () => {
		for (const [name, entry] of Object.entries(portableSources)) {
			expect(entry.description, `${name} description`).toBeTruthy();
		}
	});

	it("Treatment-D additions are present", () => {
		// `conditionalMap` fn (T6 interval-computation gap)
		expect(portableFns.conditionalMap).toBeDefined();

		// `median` op added to `aggregate` (T8a "avg ≠ median" gap)
		const aggregate = portableFns.aggregate;
		expect(aggregate?.configSchema?.op?.enum).toContain("median");

		// `llmScore` description carries DB-comparison guidance (T11 gap)
		expect(portableFns.llmScore?.description).toMatch(/database/i);
	});
});

// ---------------------------------------------------------------------------
// generateCatalogPrompt
// ---------------------------------------------------------------------------

describe("portableCatalog — generateCatalogPrompt", () => {
	const prompt = generateCatalogPrompt(portableCatalog);

	it("includes every fn name", () => {
		for (const name of Object.keys(portableFns)) {
			expect(prompt, `fn ${name} should appear in prompt`).toContain(`- ${name}:`);
		}
	});

	it("includes every source name", () => {
		for (const name of Object.keys(portableSources)) {
			expect(prompt, `source ${name} should appear in prompt`).toContain(`- ${name}:`);
		}
	});

	it("groups by section header (matching the manual prompt)", () => {
		expect(prompt).toContain("Transforms & filters:");
		expect(prompt).toContain("AI / LLM:");
		expect(prompt).toContain("Resilience:");
		expect(prompt).toContain("Effects (sinks):");
		expect(prompt).toContain("Sources:");
	});

	it("encodes config field schemas as `Config: { ... }`", () => {
		// filterBy's three required fields are in the prompt
		expect(prompt).toMatch(/filterBy:.*Config:.*field.*op.*\(eq\|gt\|lt\|contains\).*value/s);
	});
});

// ---------------------------------------------------------------------------
// validateSpecAgainstCatalog
// ---------------------------------------------------------------------------

describe("portableCatalog — validateSpecAgainstCatalog", () => {
	it("accepts a hand-coded spec using catalog names", () => {
		const spec: GraphSpec = {
			name: "rss-to-slack",
			nodes: {
				rss: {
					type: "producer",
					source: "rss",
					config: { url: "https://example.com/feed" },
				},
				filter: {
					type: "derived",
					deps: ["rss"],
					fn: "filterBy",
					config: { field: "title", op: "contains", value: "AI" },
				},
				notify: {
					type: "effect",
					deps: ["filter"],
					fn: "sendSlack",
					config: { channel: "#ai-news" },
				},
			},
		};
		expect(validateSpec(spec).valid).toBe(true);
		const result = validateSpecAgainstCatalog(spec, portableCatalog);
		expect(result.valid, result.errors.join("; ")).toBe(true);
	});

	it("rejects a typo'd fn name with a 'did you mean?' suggestion", () => {
		const spec: GraphSpec = {
			name: "typo",
			nodes: {
				a: { type: "state", initial: 1 },
				b: { type: "derived", deps: ["a"], fn: "filterBys" }, // typo
			},
		};
		const result = validateSpecAgainstCatalog(spec, portableCatalog);
		expect(result.valid).toBe(false);
		expect(result.errors[0]).toMatch(/filterBys.*not found/);
		expect(result.errors[0]).toMatch(/Did you mean.*filterBy/);
	});

	it("rejects an aggregate with an unsupported op (Treatment D added 'median')", () => {
		const spec: GraphSpec = {
			name: "agg",
			nodes: {
				items: { type: "state", initial: [] },
				avg: {
					type: "derived",
					deps: ["items"],
					fn: "aggregate",
					config: { op: "stddev", field: "x" },
				},
			},
		};
		const result = validateSpecAgainstCatalog(spec, portableCatalog);
		expect(result.valid).toBe(false);
		expect(result.errors[0]).toMatch(/op.*expected one of.*median/);
	});

	it("accepts aggregate with op=median (Treatment D fix)", () => {
		const spec: GraphSpec = {
			name: "agg-median",
			nodes: {
				items: { type: "state", initial: [] },
				med: {
					type: "derived",
					deps: ["items"],
					fn: "aggregate",
					config: { op: "median", field: "price" },
				},
			},
		};
		expect(validateSpecAgainstCatalog(spec, portableCatalog).valid).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Treatment D templates
// ---------------------------------------------------------------------------

describe("portableTemplates", () => {
	it("ships resilientFetch and adaptivePoller", () => {
		expect(portableTemplates.resilientFetch).toBe(resilientFetchTemplate);
		expect(portableTemplates.adaptivePoller).toBe(adaptivePollerTemplate);
	});

	it("resilientFetch has the canonical resilience nesting (rateLimiter → breaker → retry → timeout → fallback)", () => {
		const t = resilientFetchTemplate;
		expect(t.params).toEqual(["$source"]);
		expect(t.output).toBe("status");
		expect(t.nodes.rateLimited?.deps).toEqual(["$source"]);
		expect(t.nodes.breaker?.deps).toEqual(["rateLimited"]);
		expect(t.nodes.retried?.deps).toEqual(["breaker"]);
		expect(t.nodes.timed?.deps).toEqual(["retried"]);
		expect(t.nodes.withFallback?.deps).toEqual(["timed"]);
		// fallback uses the cache state (closes T8a cache-bug gap)
		expect(t.nodes.withFallback?.config?.fallbackSource).toBe("cache");
		expect(t.nodes.cache?.type).toBe("state");
	});

	it("adaptivePoller has the dynamic-interval pattern", () => {
		const t = adaptivePollerTemplate;
		expect(t.params).toEqual(["$rateComputer"]);
		expect(t.nodes.interval?.type).toBe("state");
		expect(t.nodes.timer?.type).toBe("producer");
		expect(t.nodes.fetch?.fn).toBe("conditionalMap");
		expect(t.nodes.rateComputed?.deps).toEqual(["$rateComputer"]);
	});

	it("template inner-node fn names all resolve in the catalog", () => {
		for (const [tName, template] of Object.entries(portableTemplates)) {
			for (const [nName, node] of Object.entries(template.nodes)) {
				if (node.fn) {
					expect(
						portableFns[node.fn],
						`${tName}.${nName} fn=${node.fn} must be in catalog`,
					).toBeDefined();
				}
				if (node.source) {
					expect(
						portableSources[node.source],
						`${tName}.${nName} source=${node.source} must be in catalog`,
					).toBeDefined();
				}
			}
		}
	});
});
