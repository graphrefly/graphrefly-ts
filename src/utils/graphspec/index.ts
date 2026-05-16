/**
 * LLM graph composition (roadmap §8.3).
 *
 * Declarative GraphSpec schema + compiler/decompiler for graph topology.
 * The LLM designs graphs as JSON; `compileSpec` instantiates them;
 * `decompileSpec` extracts them back. Templates support reusable subgraph
 * patterns. Feedback edges express bounded cycles via §8.1 feedback().
 *
 * **Tier 1.5.3 Phase 3 (2026-04-27):** `GraphSpec` is a structural alias of
 * {@link GraphDescribeOutput} with two LLM-author-friendly extras
 * (`templates?` / `feedback?`). Per-node factory references are encoded in
 * `meta.factory` + `meta.factoryArgs` (no more `fn` / `source` / `config` /
 * `initial` fields). State node initial values live in
 * `meta.factoryArgs.initial` (state self-tags with
 * `factoryTag("state", { initial })`).
 *
 * @module
 */

import type { DescribeNodeOutput } from "@graphrefly/pure-ts/core";
import { type Node, node } from "@graphrefly/pure-ts/core";
import { GRAPH_META_SEGMENT, Graph, type GraphDescribeOutput } from "@graphrefly/pure-ts/graph";
import type { ChatMessage, LLMAdapter, LLMResponse } from "../ai/index.js";
import { feedback as feedbackPrimitive } from "../reduction/index.js";

// ---------------------------------------------------------------------------
// GraphSpec types — structural alias of GraphDescribeOutput
// ---------------------------------------------------------------------------

/**
 * A single node declaration in a GraphSpec — structural alias of
 * {@link DescribeNodeOutput}.
 *
 * Per-node factory provenance lives in `meta.factory` + `meta.factoryArgs`
 * (use {@link factoryTag} to stamp them at construction time). State node
 * initial values come through `meta.factoryArgs.initial` for tagged states,
 * with fallback to `value` (since spec projection retains state values).
 */
export type GraphSpecNode = DescribeNodeOutput;

/** Template instantiation node — expanded at compile time. */
export type GraphSpecTemplateRef = {
	type: "template";
	/** Name of the template to instantiate. */
	template: string;
	/** Parameter bindings: template param name → node name. */
	bind: Record<string, string>;
};

/** A reusable subgraph pattern with parameter substitution. */
export type GraphSpecTemplate = {
	/** Parameter names (prefixed with $ in node refs). */
	params: string[];
	/** Node declarations within the template. */
	nodes: Record<string, GraphSpecNode>;
	/** Which node's output is the template's output. */
	output: string;
};

/** A feedback edge: bounded cycle from condition to reentry. */
export type GraphSpecFeedbackEdge = {
	/** Node whose DATA triggers the feedback. */
	from: string;
	/** State node that receives the feedback value. */
	to: string;
	/** Max iterations before stopping (default: 10). */
	maxIterations?: number;
};

/**
 * Declarative graph topology for LLM composition (§8.3).
 *
 * Tier 1.5.3 Phase 3 (2026-04-27): structural alias of
 * {@link GraphDescribeOutput} extended with optional `templates` /
 * `feedback` fields for LLM-author convenience. Top-level `factory` /
 * `factoryArgs` (Phase 2.5 carry) ride along on every describe output.
 *
 * Round-trip property: `decompileSpec(g) === g.describe({ detail: "spec" })`
 * (modulo the small feedback-edge extraction sugar).
 */
export type GraphSpec = Omit<GraphDescribeOutput, "nodes" | "expand"> & {
	/** Node declarations (keyed by node name). Either a structural describe entry or a template ref. */
	nodes: Record<string, GraphSpecNode | GraphSpecTemplateRef>;
	/** Reusable subgraph templates (LLM-author extra; not present in `describe()` output). */
	templates?: Record<string, GraphSpecTemplate>;
	/** Feedback edges (bounded cycles, LLM-author extra). */
	feedback?: GraphSpecFeedbackEdge[];
};

/**
 * Extract `meta.factory` from a node, if any. Pure read — no normalization.
 */
function readFactory(node: GraphSpecNode): string | undefined {
	const f = (node.meta as Record<string, unknown> | undefined)?.factory;
	return typeof f === "string" ? f : undefined;
}

/**
 * Extract `meta.factoryArgs` from a node as a plain Record. Pure read.
 */
function readFactoryArgs(node: GraphSpecNode): Record<string, unknown> {
	const a = (node.meta as Record<string, unknown> | undefined)?.factoryArgs;
	return a != null && typeof a === "object" ? (a as Record<string, unknown>) : {};
}

/**
 * Resolve the initial value for a state node. Prefers
 * `meta.factoryArgs.initial` (the path the `state()` factory itself stamps)
 * and falls back to `value` (in case the spec carries the resolved value
 * without a factory tag, e.g. from a hand-written spec).
 */
function readStateInitial(node: GraphSpecNode): unknown {
	const args = readFactoryArgs(node);
	if ("initial" in args) return args.initial;
	return node.value;
}

// ---------------------------------------------------------------------------
// Catalog types
// ---------------------------------------------------------------------------

/**
 * Factory for creating a derived/effect/operator node from catalog.
 * Receives resolved dep nodes and the config from the spec.
 */
export type FnFactory = (deps: Node<unknown>[], config: Record<string, unknown>) => Node<unknown>;

/**
 * Factory for creating a producer node from catalog.
 * Receives the config from the spec.
 */
export type SourceFactory = (config: Record<string, unknown>) => Node<unknown>;

// ---------------------------------------------------------------------------
// Rich catalog entries (§9.1b — auto-prompt, catalog-aware validation)
// ---------------------------------------------------------------------------

/** Simple config field descriptor for LLM prompt generation and validation. */
export type ConfigFieldSchema = {
	/** Human-readable type: "string", "number", "boolean", "string[]", etc. */
	type: string;
	/** Whether this field is required (default: true). */
	required?: boolean;
	/** Allowed values (enum constraint). */
	enum?: readonly (string | number | boolean)[];
	/** Human-readable description for LLM context. */
	description?: string;
	/** Default value if omitted. */
	default?: unknown;
};

/**
 * Rich catalog entry: bundles a runtime factory with LLM-facing metadata.
 *
 * The metadata is used to:
 * 1. Auto-generate prompt text for {@link llmCompose} (replaces manual `catalogDescription`)
 * 2. Validate LLM output in {@link validateSpec} (catch wrong fn names, invalid config)
 * 3. Provide actionable error messages for {@link llmRefine} feedback loops
 *
 * Developers register ONE object; the library handles prompt generation and validation.
 */
export type CatalogFnEntry = {
	/** Runtime factory. */
	factory: FnFactory;
	/** One-line description for LLM prompt (what it does, not how). */
	description: string;
	/** Config field schemas. Keys are config field names. */
	configSchema?: Record<string, ConfigFieldSchema>;
	/** Example config objects (shown in prompt for complex fns). */
	examples?: Record<string, unknown>[];
	/** Category tags for grouping in prompt (e.g., "resilience", "reduction", "ai"). */
	tags?: string[];
};

/** Rich catalog entry for producer sources. */
export type CatalogSourceEntry = {
	/** Runtime factory. */
	factory: SourceFactory;
	/** One-line description for LLM prompt. */
	description: string;
	/** Config field schemas. */
	configSchema?: Record<string, ConfigFieldSchema>;
	/** Example config objects. */
	examples?: Record<string, unknown>[];
	/** Category tags. */
	tags?: string[];
};

/**
 * Top-level Graph factory — used when a spec was produced from a graph that
 * called `Graph.prototype.tagFactory(name, args)`. The catalog supplies a
 * function that takes the recorded `factoryArgs` (JSON-serializable subset)
 * and returns a fully-wired Graph. Runtime context (LLMAdapter instances,
 * callbacks, embedders) is captured by the closure — the args themselves are
 * a documentation fragment, not a complete construction recipe.
 *
 * Tier 1.5.3 Phase 2.5 (DG1=B, 2026-04-27).
 */
export type GraphSpecFactory = (factoryArgs: unknown) => Graph;

/**
 * Fn/source lookup table passed to compileSpec and llmCompose.
 *
 * Accepts both bare factories (backward-compatible) and rich {@link CatalogFnEntry}
 * / {@link CatalogSourceEntry} objects. When rich entries are provided, the library
 * auto-generates LLM prompts and validates LLM output against the catalog.
 *
 * `graphFactories` (Tier 1.5.3 Phase 2.5) handles top-level Graph-returning
 * factories — when `spec.factory` matches a key, `compileSpec` delegates the
 * entire reconstruction to that factory.
 */
export type GraphSpecCatalog = {
	fns?: Record<string, FnFactory | CatalogFnEntry>;
	sources?: Record<string, SourceFactory | CatalogSourceEntry>;
	graphFactories?: Record<string, GraphSpecFactory>;
};

// ---------------------------------------------------------------------------
// Catalog helpers
// ---------------------------------------------------------------------------

/** Type guard: is this a rich catalog fn entry (vs bare factory)? */
export function isRichFnEntry(entry: FnFactory | CatalogFnEntry): entry is CatalogFnEntry {
	return typeof entry === "object" && entry !== null && "factory" in entry;
}

/** Type guard: is this a rich catalog source entry (vs bare factory)? */
export function isRichSourceEntry(
	entry: SourceFactory | CatalogSourceEntry,
): entry is CatalogSourceEntry {
	return typeof entry === "object" && entry !== null && "factory" in entry;
}

/** Extract the runtime factory from a catalog entry (rich or bare). */
export function extractFnFactory(entry: FnFactory | CatalogFnEntry): FnFactory {
	return isRichFnEntry(entry) ? entry.factory : entry;
}

/** Extract the runtime factory from a catalog source entry (rich or bare). */
export function extractSourceFactory(entry: SourceFactory | CatalogSourceEntry): SourceFactory {
	return isRichSourceEntry(entry) ? entry.factory : entry;
}

/**
 * Auto-generate catalog prompt text from rich catalog entries.
 *
 * Groups fns by tag, formats each as `- name: description. Config: { ... }`.
 * Falls back to listing names only for bare factories.
 */
export function generateCatalogPrompt(catalog: GraphSpecCatalog): string {
	const sections: string[] = [];

	if (catalog.fns) {
		// Group by first tag (or "Other")
		const groups = new Map<string, string[]>();
		for (const [name, entry] of Object.entries(catalog.fns)) {
			const tag = isRichFnEntry(entry) ? (entry.tags?.[0] ?? "Other") : "Other";
			if (!groups.has(tag)) groups.set(tag, []);
			groups.get(tag)!.push(formatFnEntry(name, entry));
		}
		for (const [tag, lines] of groups) {
			sections.push(`${tag}:\n${lines.join("\n")}`);
		}
	}

	if (catalog.sources) {
		const lines: string[] = [];
		for (const [name, entry] of Object.entries(catalog.sources)) {
			lines.push(formatSourceEntry(name, entry));
		}
		if (lines.length > 0) {
			sections.push(`Sources:\n${lines.join("\n")}`);
		}
	}

	return sections.join("\n\n");
}

function formatFnEntry(name: string, entry: FnFactory | CatalogFnEntry): string {
	if (!isRichFnEntry(entry)) return `- ${name}`;
	let line = `- ${name}: ${entry.description}`;
	if (entry.configSchema) {
		const fields = Object.entries(entry.configSchema).map(([k, v]) => {
			let desc = `${k}: ${v.type}`;
			if (v.enum) desc += ` (${v.enum.join("|")})`;
			if (v.required === false) desc += "?";
			return desc;
		});
		line += `. Config: { ${fields.join(", ")} }`;
	}
	return line;
}

function formatSourceEntry(name: string, entry: SourceFactory | CatalogSourceEntry): string {
	if (!isRichSourceEntry(entry)) return `- ${name}`;
	let line = `- ${name}: ${entry.description}`;
	if (entry.configSchema) {
		const fields = Object.entries(entry.configSchema).map(([k, v]) => {
			let desc = `${k}: ${v.type}`;
			if (v.required === false) desc += "?";
			return desc;
		});
		line += `. Config: { ${fields.join(", ")} }`;
	}
	return line;
}

/**
 * Validate a GraphSpec against a catalog.
 *
 * Checks that fn/source names reference actual catalog entries, and validates
 * config fields against configSchema when rich entries are available.
 * Returns additional errors beyond structural {@link validateSpec} checks.
 */
export function validateSpecAgainstCatalog(
	spec: GraphSpec,
	catalog: GraphSpecCatalog,
): GraphSpecValidation {
	const errors: string[] = [];
	const fnNames = new Set(Object.keys(catalog.fns ?? {}));
	const sourceNames = new Set(Object.keys(catalog.sources ?? {}));

	for (const [nodeName, nodeRaw] of Object.entries(spec.nodes)) {
		if (nodeRaw.type === "template") continue;
		const node = nodeRaw as GraphSpecNode;
		const factoryName = readFactory(node);
		if (factoryName == null) continue;

		const isProducer = node.type === "producer";
		// State nodes self-tag with `factory: "state"` — never expected to live
		// in the catalog. Skip.
		if (node.type === "state" && factoryName === "state") continue;

		// Producers may resolve via either sources (preferred) or fns; non-
		// producers only resolve via fns. Mismatched-side suggestions (e.g.
		// using a source name on a derived node) match the legacy diagnostic.
		if (isProducer) {
			const inSources = sourceNames.has(factoryName);
			const inFns = fnNames.has(factoryName);
			if (!inSources && !inFns && (sourceNames.size > 0 || fnNames.size > 0)) {
				const suggestion =
					findClosest(factoryName, sourceNames) ?? findClosest(factoryName, fnNames);
				errors.push(
					`Node "${nodeName}": source "${factoryName}" not found in catalog` +
						(suggestion ? `. Did you mean "${suggestion}"?` : ""),
				);
			}
		} else {
			if (fnNames.size > 0 && !fnNames.has(factoryName)) {
				if (sourceNames.has(factoryName)) {
					errors.push(
						`Node "${nodeName}": fn "${factoryName}" is a source, not a function. ` +
							`Use it as a producer source instead, or use a function from: ${[...fnNames].join(", ")}`,
					);
				} else {
					const suggestion = findClosest(factoryName, fnNames);
					errors.push(
						`Node "${nodeName}": fn "${factoryName}" not found in catalog` +
							(suggestion ? `. Did you mean "${suggestion}"?` : ""),
					);
				}
			}
		}

		// Validate config (`meta.factoryArgs`) against schema (if rich entry).
		const factoryArgs = readFactoryArgs(node);
		if (!isProducer && catalog.fns?.[factoryName]) {
			const entry = catalog.fns[factoryName];
			if (isRichFnEntry(entry) && entry.configSchema) {
				for (const [field, schema] of Object.entries(entry.configSchema)) {
					if (schema.required !== false && !(field in factoryArgs)) {
						errors.push(`Node "${nodeName}": config missing required field "${field}"`);
					}
					if (field in factoryArgs && schema.enum) {
						const val = factoryArgs[field];
						if (!schema.enum.includes(val as string | number | boolean)) {
							errors.push(
								`Node "${nodeName}": config.${field} = ${JSON.stringify(val)}, ` +
									`expected one of: ${schema.enum.join(", ")}`,
							);
						}
					}
				}
			}
		}
		if (isProducer && catalog.sources?.[factoryName]) {
			const entry = catalog.sources[factoryName];
			if (isRichSourceEntry(entry) && entry.configSchema) {
				for (const [field, schema] of Object.entries(entry.configSchema)) {
					if (schema.required !== false && !(field in factoryArgs)) {
						errors.push(`Node "${nodeName}": config missing required field "${field}"`);
					}
					if (field in factoryArgs && schema.enum) {
						const val = factoryArgs[field];
						if (!schema.enum.includes(val as string | number | boolean)) {
							errors.push(
								`Node "${nodeName}": config.${field} = ${JSON.stringify(val)}, ` +
									`expected one of: ${schema.enum.join(", ")}`,
							);
						}
					}
				}
			}
		}
	}

	// Also check template inner nodes
	if (spec.templates) {
		for (const [tName, template] of Object.entries(spec.templates)) {
			for (const [nodeName, node] of Object.entries(template.nodes)) {
				const factoryName = readFactory(node);
				if (factoryName == null) continue;
				if (node.type === "state" && factoryName === "state") continue;
				if (node.type === "producer") continue; // template producer/source skipped (parity with legacy)
				if (fnNames.size > 0 && !fnNames.has(factoryName)) {
					const suggestion = findClosest(factoryName, fnNames);
					errors.push(
						`Template "${tName}" node "${nodeName}": fn "${factoryName}" not found in catalog` +
							(suggestion ? `. Did you mean "${suggestion}"?` : ""),
					);
				}
			}
		}
	}

	return { valid: errors.length === 0, errors, warnings: [] };
}

/** Simple Levenshtein-based closest match for "did you mean?" suggestions. */
function findClosest(input: string, candidates: Set<string>): string | null {
	let best: string | null = null;
	let bestDist = Infinity;
	const lower = input.toLowerCase();
	for (const c of candidates) {
		const dist = levenshtein(lower, c.toLowerCase());
		if (dist < bestDist && dist <= Math.max(3, Math.floor(input.length / 2))) {
			bestDist = dist;
			best = c;
		}
	}
	return best;
}

function levenshtein(a: string, b: string): number {
	const m = a.length;
	const n = b.length;
	const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
		Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
	);
	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			dp[i][j] =
				a[i - 1] === b[j - 1]
					? dp[i - 1][j - 1]
					: 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
		}
	}
	return dp[m][n];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Validation result from {@link validateSpec}. */
export type GraphSpecValidation = {
	valid: boolean;
	errors: string[];
	/**
	 * Non-fatal advisories. Currently includes feedback edges whose `from`
	 * refers to an `effect` node (effects produce no DATA — the feedback
	 * counter will never advance). Always present (empty array when nothing
	 * is flagged) — symmetry with `errors` so callers can read
	 * `result.warnings.length` without a null check.
	 */
	warnings: string[];
};

const VALID_NODE_TYPES = new Set([
	"state",
	"producer",
	"derived",
	"effect",
	"operator",
	"template",
]);

const INNER_NODE_TYPES = new Set(["state", "producer", "derived", "effect", "operator"]);

/**
 * Validate a GraphSpec JSON object.
 *
 * Checks structural validity: required fields, node types, dep references,
 * template references, feedback edge targets, self-cycles, and bind completeness.
 *
 * **Effect-node feedback advisory (C24-3).** When a feedback edge's `from`
 * refers to an `effect` node, the validator flags it via `warnings` (not
 * `errors`) — effect nodes produce no DATA emission, so a feedback counter
 * targeting one will never advance. The spec compiles either way; the
 * advisory exists because the misconfiguration is silent at runtime
 * (counter at 0 forever) without it.
 */
export function validateSpec(spec: unknown): GraphSpecValidation {
	const errors: string[] = [];
	const warnings: string[] = [];

	if (spec == null || typeof spec !== "object") {
		return { valid: false, errors: ["GraphSpec must be a non-null object"], warnings };
	}

	const s = spec as Record<string, unknown>;

	if (typeof s.name !== "string" || s.name.length === 0) {
		errors.push("Missing or empty 'name' field");
	}

	if (s.nodes == null || typeof s.nodes !== "object" || Array.isArray(s.nodes)) {
		errors.push("Missing or invalid 'nodes' field (must be an object)");
		return { valid: false, errors, warnings };
	}

	const nodeNames = new Set(Object.keys(s.nodes as object));
	const nodeTypes = new Map<string, string>();
	const templateDefs = new Map<string, { params: string[] }>();

	// Pre-scan template definitions for param validation
	if (s.templates != null && typeof s.templates === "object" && !Array.isArray(s.templates)) {
		for (const [tName, tRaw] of Object.entries(s.templates as Record<string, unknown>)) {
			if (tRaw != null && typeof tRaw === "object") {
				const t = tRaw as Record<string, unknown>;
				templateDefs.set(tName, {
					params: Array.isArray(t.params) ? (t.params as string[]) : [],
				});
			}
		}
	}

	// Validate templates
	if (s.templates != null) {
		if (typeof s.templates !== "object" || Array.isArray(s.templates)) {
			errors.push("'templates' must be an object");
		} else {
			for (const [tName, tRaw] of Object.entries(s.templates as Record<string, unknown>)) {
				if (tRaw == null || typeof tRaw !== "object") {
					errors.push(`Template "${tName}": must be an object`);
					continue;
				}
				const t = tRaw as Record<string, unknown>;
				if (!Array.isArray(t.params)) {
					errors.push(`Template "${tName}": missing 'params' array`);
				}
				if (t.nodes == null || typeof t.nodes !== "object" || Array.isArray(t.nodes)) {
					errors.push(`Template "${tName}": missing or invalid 'nodes' object`);
				} else {
					const paramSet = new Set(Array.isArray(t.params) ? (t.params as string[]) : []);
					const innerNames = new Set(Object.keys(t.nodes as object));
					for (const [nName, nRaw] of Object.entries(t.nodes as Record<string, unknown>)) {
						if (nRaw == null || typeof nRaw !== "object") {
							errors.push(`Template "${tName}" node "${nName}": must be an object`);
							continue;
						}
						const n = nRaw as Record<string, unknown>;
						if (typeof n.type !== "string" || !INNER_NODE_TYPES.has(n.type)) {
							errors.push(`Template "${tName}" node "${nName}": invalid type`);
						}
						if (Array.isArray(n.deps)) {
							for (const dep of n.deps as string[]) {
								if (!innerNames.has(dep) && !paramSet.has(dep)) {
									errors.push(
										`Template "${tName}" node "${nName}": dep "${dep}" is not an inner node or param`,
									);
								}
							}
						}
					}
					if (typeof t.output !== "string") {
						errors.push(`Template "${tName}": missing 'output' string`);
					} else if (!(t.nodes as Record<string, unknown>)[t.output as string]) {
						errors.push(`Template "${tName}": output "${t.output}" is not a declared node`);
					}
				}
			}
		}
	}

	// Validate nodes
	for (const [name, raw] of Object.entries(s.nodes as Record<string, unknown>)) {
		if (raw == null || typeof raw !== "object") {
			errors.push(`Node "${name}": must be an object`);
			continue;
		}
		const n = raw as Record<string, unknown>;
		if (typeof n.type !== "string" || !VALID_NODE_TYPES.has(n.type)) {
			errors.push(
				`Node "${name}": invalid type "${String(n.type)}" (expected: ${[...VALID_NODE_TYPES].join(", ")})`,
			);
			continue;
		}
		nodeTypes.set(name, n.type);

		if (n.type === "template") {
			if (typeof n.template !== "string" || !templateDefs.has(n.template)) {
				errors.push(`Node "${name}": template "${String(n.template)}" not found in templates`);
			} else {
				// Check bind completeness: all template params must be bound
				if (n.bind == null || typeof n.bind !== "object" || Array.isArray(n.bind)) {
					errors.push(`Node "${name}": template ref requires 'bind' object`);
				} else {
					const tmpl = templateDefs.get(n.template as string)!;
					const bind = n.bind as Record<string, string>;
					for (const param of tmpl.params) {
						if (!(param in bind)) {
							errors.push(
								`Node "${name}": template param "${param}" is not bound (template "${n.template}")`,
							);
						}
					}
					for (const [, target] of Object.entries(bind)) {
						if (typeof target === "string" && !nodeNames.has(target)) {
							errors.push(
								`Node "${name}": bind target "${target}" does not reference an existing node`,
							);
						}
					}
				}
			}
		} else {
			if (Array.isArray(n.deps)) {
				for (const dep of n.deps as string[]) {
					// Self-referencing dep
					if (dep === name) {
						errors.push(`Node "${name}": self-referencing dep`);
					} else if (!nodeNames.has(dep)) {
						errors.push(`Node "${name}": dep "${dep}" does not reference an existing node`);
					}
				}
			}
			// Warn: derived/effect/operator without deps
			if (
				(n.type === "derived" || n.type === "effect" || n.type === "operator") &&
				!Array.isArray(n.deps)
			) {
				errors.push(`Node "${name}": ${n.type} node should have a 'deps' array`);
			}
		}
	}

	// Validate feedback edges
	if (s.feedback != null) {
		if (!Array.isArray(s.feedback)) {
			errors.push("'feedback' must be an array");
		} else {
			for (let i = 0; i < (s.feedback as unknown[]).length; i++) {
				const edge = (s.feedback as unknown[])[i];
				if (edge == null || typeof edge !== "object") {
					errors.push(`Feedback [${i}]: must be an object`);
					continue;
				}
				const e = edge as Record<string, unknown>;
				if (typeof e.from !== "string" || !nodeNames.has(e.from)) {
					errors.push(
						`Feedback [${i}]: 'from' "${String(e.from)}" does not reference an existing node`,
					);
				} else if (nodeTypes.get(e.from) === "effect") {
					// Effect nodes produce no DATA — a feedback edge from one will
					// never trigger the counter / re-entry. Almost certainly a
					// modelling mistake (caller probably meant the upstream
					// derived/state node). Warn but don't reject — the spec is
					// structurally valid; some advanced uses might still be ok.
					warnings.push(
						`Feedback [${i}]: 'from' "${e.from}" is an effect node — effects emit no DATA, so the feedback edge will never fire. Did you mean a derived/state node upstream?`,
					);
				}
				if (typeof e.from === "string" && e.from === e.to) {
					errors.push(`Feedback [${i}]: 'from' and 'to' must be different nodes`);
				}
				if (typeof e.to !== "string" || !nodeNames.has(e.to)) {
					errors.push(
						`Feedback [${i}]: 'to' "${String(e.to)}" does not reference an existing node`,
					);
				} else if (typeof e.to === "string" && nodeTypes.get(e.to) !== "state") {
					errors.push(
						`Feedback [${i}]: 'to' node "${e.to}" must be a state node (got "${nodeTypes.get(e.to) ?? "unknown"}")`,
					);
				}
			}
		}
	}

	return {
		valid: errors.length === 0,
		errors,
		warnings,
	};
}

// ---------------------------------------------------------------------------
// validateOwnership — multi-agent subgraph ownership PR lint (DS-14.5.A #5)
// ---------------------------------------------------------------------------

/**
 * Read `meta.owner` from a spec node. Pure read — no normalization.
 * Empty / non-string is treated as "no annotation" (silent, INV-OWNER-2).
 */
function readOwner(node: GraphSpecNode): string | undefined {
	const o = (node.meta as Record<string, unknown> | undefined)?.owner;
	return typeof o === "string" && o.length > 0 ? o : undefined;
}

/**
 * The change-set fed to {@link validateOwnership}. Mirrors the minimal slice
 * of a PR diff the lint needs: the set of factory identifiers whose
 * implementation the diff touches, plus the PR author and (optionally) the
 * raw commit-message text so the `Override-Owner:` trailer can be detected.
 *
 * **Why factory-keyed (not path-keyed) — locked decision (DS-14.5.A Q5
 * sub-flag).** PR-diff → spec-node mapping resolves through `meta.factory`
 * provenance, NOT a `meta.ownerPath` glob. A diff that edits the
 * implementation of factory `"rateLimiter"` maps to *every* spec node whose
 * `meta.factory === "rateLimiter"`. This reuses the existing
 * `factoryTag` / `decompileSpec` round-trip (the same `meta.factory` field
 * `compileSpec` consumes) — no parallel ownership-path indexing scheme.
 */
export type OwnershipPrDiff = {
	/**
	 * Factory identifiers (the `meta.factory` value) whose source the PR
	 * modifies. A spec node is "edited by this PR" iff its `meta.factory` is
	 * in this set. Nodes without `meta.factory` cannot be mapped from a code
	 * diff and are therefore never flagged (silent — consistent with the
	 * un-annotated rule).
	 */
	readonly editedFactories: readonly string[];
	/** PR author's `Actor.id`. Compared against each edited node's `meta.owner`. */
	readonly author: string;
	/**
	 * Raw commit message(s) text. If any line is an `Override-Owner: <reason>`
	 * trailer (case-insensitive key, non-empty reason) the lint hard-fail is
	 * bypassed and recorded as an audit-trail override (Q5 sub-lock i — any
	 * committer may use it; it is recorded, never silently granted).
	 */
	readonly commitMessage?: string;
};

/** One cross-owner violation surfaced by {@link validateOwnership}. */
export type OwnershipViolation = {
	/** Spec node path that carries `meta.owner` and was edited by a non-owner. */
	readonly node: string;
	/** The `meta.owner` value on that node. */
	readonly owner: string;
	/** The PR author who edited it. */
	readonly author: string;
	/** The `meta.factory` that mapped the diff onto this node. */
	readonly factory: string;
};

/** Result of {@link validateOwnership}. */
export type OwnershipValidation = {
	/**
	 * `true` when no hard-fail applies — either no cross-owner edit, or every
	 * cross-owner edit is bypassed by a valid `Override-Owner:` trailer.
	 */
	readonly ok: boolean;
	/** Cross-owner edits that hard-fail (empty when `ok`). */
	readonly violations: readonly OwnershipViolation[];
	/**
	 * Cross-owner edits that WOULD have failed but were bypassed by an
	 * `Override-Owner:` commit trailer. Pure audit trail — CI / reviewers
	 * grep this to surface override abuse. Present (possibly empty) so callers
	 * can read `.overridden.length` without a null check.
	 */
	readonly overridden: readonly OwnershipViolation[];
	/**
	 * The override reason parsed from the `Override-Owner:` trailer, when one
	 * was present and applied. `undefined` when no trailer was used.
	 */
	readonly overrideReason?: string;
};

const OVERRIDE_OWNER_TRAILER = /^\s*override-owner\s*:\s*(.+?)\s*$/im;

/**
 * Detect an `Override-Owner: <reason>` commit trailer (case-insensitive key;
 * reason must be non-empty after trim). Returns the trimmed reason, or
 * `undefined` when absent.
 */
function parseOverrideOwner(commitMessage: string | undefined): string | undefined {
	if (commitMessage == null) return undefined;
	const m = OVERRIDE_OWNER_TRAILER.exec(commitMessage);
	const reason = m?.[1]?.trim();
	return reason != null && reason.length > 0 ? reason : undefined;
}

/**
 * Multi-agent subgraph ownership PR lint (DS-14.5.A delta #5, L0 rung;
 * spec §2.3a INV-OWNER-2).
 *
 * Hard-fails a pull request whose code diff edits a spec node carrying
 * `meta.owner` when the PR author is not that owner. Nodes **without**
 * `meta.owner` are silent (no advisory, no failure) — "shared infrastructure"
 * is exactly the un-annotated case; no separate allow-list is maintained.
 *
 * **Rules (Q5 lock):**
 * - Edited node has no `meta.owner` → silent.
 * - Edited node has `meta.owner` AND `author === meta.owner` → OK.
 * - Edited node has `meta.owner` AND `author !== meta.owner` → **violation**
 *   (hard-fail) unless an `Override-Owner: <reason>` commit trailer is present,
 *   in which case the violation is moved to `overridden` (audit trail) and
 *   `ok` stays `true`.
 *
 * **PR-diff → spec-node mapping (Q5 sub-flag lock):** `meta.factory`
 * resolution. A node is "edited" iff its `meta.factory` appears in
 * `prDiff.editedFactories`. This reuses the `factoryTag` / `decompileSpec`
 * round-trip rather than introducing a `meta.ownerPath` glob. Nodes without
 * `meta.factory` can't be mapped from a code diff and are never flagged.
 *
 * Pure function — no `Node` / `Graph` returned, no side effects. Designed to
 * be called from a `graphrefly check-spec`-adjacent CI step (delta #6, Phase
 * 16) or any host PR gate.
 *
 * @param spec - The committed GraphSpec (or any `describe({ detail: "spec" })`
 *   projection / structural superset).
 * @param prDiff - The factory-keyed diff slice + author + commit text.
 */
export function validateOwnership(spec: unknown, prDiff: OwnershipPrDiff): OwnershipValidation {
	const violations: OwnershipViolation[] = [];
	const overridden: OwnershipViolation[] = [];

	if (spec == null || typeof spec !== "object") {
		return { ok: true, violations, overridden };
	}
	const s = spec as Record<string, unknown>;
	const nodes = s.nodes;
	if (nodes == null || typeof nodes !== "object" || Array.isArray(nodes)) {
		return { ok: true, violations, overridden };
	}

	const edited = new Set(prDiff.editedFactories);
	if (edited.size > 0) {
		for (const [path, nRaw] of Object.entries(nodes as Record<string, unknown>)) {
			if (nRaw == null || typeof nRaw !== "object") continue;
			const n = nRaw as GraphSpecNode;
			const factory = readFactory(n);
			// Unmappable from a code diff (no factory provenance) → silent.
			if (factory == null || !edited.has(factory)) continue;
			const owner = readOwner(n);
			// No annotation → silent (INV-OWNER-2: un-annotated == shared).
			if (owner == null) continue;
			// Author IS the owner → OK.
			if (owner === prDiff.author) continue;
			violations.push({ node: path, owner, author: prDiff.author, factory });
		}
	}

	const overrideReason = parseOverrideOwner(prDiff.commitMessage);
	if (violations.length > 0 && overrideReason != null) {
		// Trailer bypasses ALL cross-owner violations in this PR (the trailer
		// is PR-scoped and a pure audit-trail record per Q5 sub-lock i).
		overridden.push(...violations);
		return { ok: true, violations: [], overridden, overrideReason };
	}

	return {
		ok: violations.length === 0,
		violations,
		overridden,
		...(overrideReason != null ? { overrideReason } : {}),
	};
}

// ---------------------------------------------------------------------------
// compileSpec
// ---------------------------------------------------------------------------

/** Options for {@link compileSpec}. */
export type CompileSpecOptions = {
	/** Fn/source catalog for resolving named factories. */
	catalog?: GraphSpecCatalog;
	/**
	 * How to handle nodes whose `fn` / `source` is missing from the catalog.
	 * - `"placeholder"` (default): silently substitute identity passthroughs
	 *   (`node([], () => {})` / `node(deps, (bd, a, ctx) => a.emit(bd[0]?.at(-1)))`). Backward-
	 *   compatible — preserves the historical "soft compile" behavior.
	 * - `"warn"`: substitute placeholders AND log each missing entry via
	 *   `console.warn`, or via the `onWarn` callback if supplied.
	 * - `"error"`: collect every missing entry across the whole spec, then
	 *   throw an `Error` listing them all (no partial graph returned).
	 */
	onMissing?: "error" | "warn" | "placeholder";
	/** Custom warning sink. Used only when `onMissing === "warn"`. Defaults to `console.warn`. */
	onWarn?: (message: string) => void;
};

interface MissingCatalogEntry {
	/** Node path (template-prefixed where applicable, e.g. `myMount.inner`). */
	path: string;
	/** The catalog kind (`"fn"` or `"source"`) that was looked up. */
	kind: "fn" | "source";
	/** The catalog name string supplied in the spec. */
	name: string;
}

/**
 * Instantiate a Graph from a GraphSpec.
 *
 * Handles template expansion (mounted subgraphs), feedback wiring via §8.1
 * feedback(), node factory lookup from the catalog, and topology validation.
 *
 * @param spec - Declarative graph topology.
 * @param opts - Catalog and compile options.
 * @returns A running Graph.
 * @throws On validation failure, missing catalog entries, or unresolvable deps.
 *
 * @category patterns
 */
export function compileSpec(spec: GraphSpec, opts?: CompileSpecOptions): Graph {
	// QA F4: validate FIRST, even when the early-dispatch path will delegate to
	// a Graph-level factory. The early-dispatch is a *constructor* short-circuit,
	// not a *validation* short-circuit — we still want malformed specs to throw
	// so a catalog-tagged spec with bogus nodes/templates surfaces the error.
	const validation = validateSpec(spec);
	if (!validation.valid) {
		throw new Error(`compileSpec: invalid GraphSpec:\n${validation.errors.join("\n")}`);
	}

	// Tier 1.5.3 Phase 2.5 (DG1=B): if the spec carries a top-level `factory`
	// tag and the catalog has a matching `graphFactories` entry, delegate the
	// full reconstruction. This lets Graph-returning factories
	// (`agentMemory`, `harnessLoop`, etc.) own their own rebuild path with
	// access to user-supplied runtime ctx (LLMAdapter, callbacks).
	const specFactory = spec.factory;
	const specFactoryArgs = spec.factoryArgs;
	if (typeof specFactory === "string") {
		const graphFactory = opts?.catalog?.graphFactories?.[specFactory];
		if (graphFactory) return graphFactory(specFactoryArgs);
		// No catalog entry for the named factory — fall through to per-node
		// compile so the per-node-tagged paths still work.
	}

	const catalog = opts?.catalog ?? {};
	const onMissing = opts?.onMissing ?? "placeholder";
	const g = new Graph(spec.name);
	const templates = spec.templates ?? {};

	// Catalog-aware validation (when rich entries are available)
	const catalogValidation = validateSpecAgainstCatalog(spec, catalog);
	if (!catalogValidation.valid) {
		throw new Error(
			`compileSpec: catalog validation errors:\n${catalogValidation.errors.join("\n")}`,
		);
	}

	// Track missing catalog entries across both top-level and template passes;
	// the chosen `onMissing` policy is applied once after compile so callers see
	// every miss in a single error / warn batch instead of one-at-a-time.
	const missingEntries: MissingCatalogEntry[] = [];

	const recordMissing = (nodePath: string, kind: "fn" | "source", name: string): void => {
		missingEntries.push({ path: nodePath, kind, name });
	};

	// Helper: resolve fn/source factories from catalog (handles rich + bare entries)
	const resolveFn = (fnName: string): FnFactory | undefined => {
		const entry = catalog.fns?.[fnName];
		return entry ? extractFnFactory(entry) : undefined;
	};
	const resolveSource = (sourceName: string): SourceFactory | undefined => {
		const entry = catalog.sources?.[sourceName];
		return entry ? extractSourceFactory(entry) : undefined;
	};

	/**
	 * Strip the `factory` / `factoryArgs` keys from a spec node's `meta`
	 * before forwarding to the construction factory. The factory itself
	 * re-stamps its own `factoryTag(...)` (so the rebuilt node carries the
	 * canonical factoryArgs); leaving the spec's pre-stamped meta in place
	 * would shadow that with stale args (esp. after `placeholderArgs`
	 * scrubbed non-JSON fields).
	 */
	const stripFactoryMeta = (
		meta: Record<string, unknown> | undefined,
	): Record<string, unknown> | undefined => {
		if (!meta) return undefined;
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(meta)) {
			if (k === "factory" || k === "factoryArgs") continue;
			out[k] = v;
		}
		return Object.keys(out).length > 0 ? out : undefined;
	};

	// Phase 1: Create non-template nodes (state/producer first, then derived/effect/operator)
	const created = new Map<string, Node<unknown>>();
	const deferred: [string, GraphSpecNode][] = [];

	for (const [name, raw] of Object.entries(spec.nodes)) {
		if (raw.type === "template") continue; // handled in Phase 2

		const n = raw as GraphSpecNode;
		const factoryName = readFactory(n);
		const factoryArgs = readFactoryArgs(n);

		if (n.type === "state") {
			const initial = readStateInitial(n);
			const nd = node([], {
				name,
				initial,
				meta: stripFactoryMeta(n.meta),
			});
			g.add(nd, { name: name });
			created.set(name, nd);
		} else if (n.type === "producer") {
			// Producer: try sources first (matching the legacy precedence) then fns.
			const sourceFactory = factoryName ? resolveSource(factoryName) : undefined;
			const fnFactory = factoryName ? resolveFn(factoryName) : undefined;
			if (sourceFactory) {
				const nd = sourceFactory(factoryArgs);
				g.add(nd, { name: name });
				created.set(name, nd);
			} else if (fnFactory) {
				const nd = fnFactory([], factoryArgs);
				g.add(nd, { name: name });
				created.set(name, nd);
			} else {
				// No catalog entry — create a bare producer placeholder.
				if (factoryName) recordMissing(name, "source", factoryName);
				const nd = node([], () => {}, {
					name,
					describeKind: "producer",
					meta: { ...stripFactoryMeta(n.meta), _specSource: factoryName },
				});
				g.add(nd, { name: name });
				created.set(name, nd);
			}
		} else {
			deferred.push([name, n]);
		}
	}

	// Resolve deferred nodes (derived/effect/operator) in dependency order
	let progressed = true;
	const pending = new Map(deferred);
	while (pending.size > 0 && progressed) {
		progressed = false;
		for (const [name, n] of [...pending.entries()]) {
			const deps = n.deps ?? [];
			if (!deps.every((dep) => created.has(dep))) continue;

			const resolvedDeps = deps.map((dep) => created.get(dep)!);
			const factoryName = readFactory(n);
			const factoryArgs = readFactoryArgs(n);
			const fnFactory = factoryName ? resolveFn(factoryName) : undefined;

			let nd: Node<unknown>;
			if (fnFactory) {
				nd = fnFactory(resolvedDeps, factoryArgs);
			} else if (n.type === "effect") {
				if (factoryName) recordMissing(name, "fn", factoryName);
				nd = node(resolvedDeps, () => {}, { describeKind: "effect" });
			} else {
				// derived without catalog fn — identity passthrough
				if (factoryName) recordMissing(name, "fn", factoryName);
				nd = node(
					resolvedDeps,
					(batchData, actions, ctx) => {
						const data = batchData.map((batch, i) =>
							batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
						);
						actions.emit(data[0]);
					},
					{ describeKind: "derived" },
				);
			}
			g.add(nd, { name: name });
			created.set(name, nd);
			pending.delete(name);
			progressed = true;
		}
	}
	if (pending.size > 0) {
		const unresolved = [...pending.keys()].sort().join(", ");
		throw new Error(`compileSpec: unresolvable deps for nodes: ${unresolved}`);
	}

	// Phase 2: Expand template instantiations as mounted subgraphs
	for (const [name, raw] of Object.entries(spec.nodes)) {
		if (raw.type !== "template") continue;
		const ref = raw as GraphSpecTemplateRef;
		const tmpl = templates[ref.template]!;

		const sub = new Graph(name);
		const subCreated = new Map<string, Node<unknown>>();
		const subDeferred: [string, GraphSpecNode][] = [];

		// Create inner nodes, resolving $params to bound nodes
		for (const [nName, nSpec] of Object.entries(tmpl.nodes)) {
			const resolvedDeps = (nSpec.deps ?? []).map((dep) => {
				if (dep.startsWith("$") && ref.bind[dep]) {
					return ref.bind[dep];
				}
				return dep;
			});
			const specWithResolvedDeps: GraphSpecNode = { ...nSpec, deps: resolvedDeps };
			const factoryName = readFactory(nSpec);
			const factoryArgs = readFactoryArgs(nSpec);

			if (nSpec.type === "state") {
				const initial = readStateInitial(nSpec);
				const nd = node([], {
					name: nName,
					initial,
					meta: stripFactoryMeta(nSpec.meta),
				});
				sub.add(nd, { name: nName });
				subCreated.set(nName, nd);
			} else if (nSpec.type === "producer") {
				const sourceFactory = factoryName ? resolveSource(factoryName) : undefined;
				const fnFactory = factoryName ? resolveFn(factoryName) : undefined;
				if (sourceFactory) {
					const nd = sourceFactory(factoryArgs);
					sub.add(nd, { name: nName });
					subCreated.set(nName, nd);
				} else if (fnFactory) {
					const nd = fnFactory([], factoryArgs);
					sub.add(nd, { name: nName });
					subCreated.set(nName, nd);
				} else {
					if (factoryName) recordMissing(`${name}.${nName}`, "source", factoryName);
					const nd = node([], () => {}, {
						name: nName,
						describeKind: "producer",
						meta: { ...stripFactoryMeta(nSpec.meta), _specSource: factoryName },
					});
					sub.add(nd, { name: nName });
					subCreated.set(nName, nd);
				}
			} else {
				subDeferred.push([nName, specWithResolvedDeps]);
			}
		}

		// Resolve deferred inner nodes
		let subProgressed = true;
		const subPending = new Map(subDeferred);
		while (subPending.size > 0 && subProgressed) {
			subProgressed = false;
			for (const [nName, nSpec] of [...subPending.entries()]) {
				const deps = nSpec.deps ?? [];
				const allReady = deps.every((dep) => subCreated.has(dep) || created.has(dep));
				if (!allReady) continue;

				const resolvedDeps = deps.map((dep) => subCreated.get(dep) ?? created.get(dep)!);
				const factoryName = readFactory(nSpec);
				const factoryArgs = readFactoryArgs(nSpec);
				const fnFactory = factoryName ? resolveFn(factoryName) : undefined;

				let nd: Node<unknown>;
				if (fnFactory) {
					nd = fnFactory(resolvedDeps, factoryArgs);
				} else if (nSpec.type === "effect") {
					if (factoryName) recordMissing(`${name}.${nName}`, "fn", factoryName);
					nd = node(resolvedDeps, () => {}, { describeKind: "effect" });
				} else {
					if (factoryName) recordMissing(`${name}.${nName}`, "fn", factoryName);
					nd = node(
						resolvedDeps,
						(batchData, actions, ctx) => {
							const data = batchData.map((batch, i) =>
								batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
							);
							actions.emit(data[0]);
						},
						{ describeKind: "derived" },
					);
				}
				sub.add(nd, { name: nName });
				subCreated.set(nName, nd);
				subPending.delete(nName);
				subProgressed = true;
			}
		}
		if (subPending.size > 0) {
			const unresolved = [...subPending.keys()].sort().join(", ");
			throw new Error(
				`compileSpec: template "${ref.template}" has unresolvable deps: ${unresolved}`,
			);
		}

		g.mount(name, sub);
		// Register template output as a reachable node path
		const outputPath = `${name}::${tmpl.output}`;
		created.set(name, g.resolve(outputPath));

		// Store template origin meta on the mounted subgraph's output node
		// so decompile-style introspection can recover the template name.
		try {
			const outputNode = g.resolve(outputPath);
			outputNode.meta._templateName?.emit(ref.template);
			outputNode.meta._templateBind?.emit(ref.bind);
		} catch {
			/* meta nodes may not exist; template origin is best-effort */
		}
	}

	// Edges are derived from node `_deps` (Unit 7) — no explicit edge wiring step.

	// Phase 4: Wire feedback edges via §8.1 feedback()
	for (const fb of spec.feedback ?? []) {
		feedbackPrimitive(g, fb.from, fb.to, {
			maxIterations: fb.maxIterations,
		});
	}

	// Apply onMissing policy. We always finish compilation first (for "warn"
	// + "placeholder") so the caller still gets a usable graph in non-strict
	// modes. In "error" mode we throw before returning.
	if (missingEntries.length > 0) {
		if (onMissing === "error") {
			const lines = missingEntries.map((e) => `  - ${e.path}: missing ${e.kind} "${e.name}"`);
			throw new Error(
				`compileSpec: ${missingEntries.length} catalog entr${
					missingEntries.length === 1 ? "y" : "ies"
				} missing — pass them via opts.catalog or set opts.onMissing to "warn"/"placeholder":\n${lines.join("\n")}`,
			);
		}
		if (onMissing === "warn") {
			const warn = opts?.onWarn ?? ((m: string): void => console.warn(m));
			for (const e of missingEntries) {
				warn(
					`compileSpec: ${e.path} references missing ${e.kind} "${e.name}" — substituted placeholder`,
				);
			}
		}
	}

	return g;
}

// ---------------------------------------------------------------------------
// decompileGraph
// ---------------------------------------------------------------------------

/** Internal meta keys used by compileSpec/feedback — stripped from output. */
const INTERNAL_META_KEYS = new Set([
	"reduction",
	"reduction_type",
	"_specFn",
	"_specSource",
	"_templateName",
	"_templateBind",
	"feedbackFrom",
	"feedbackTo",
	"_internal",
]);

/**
 * Extract a {@link GraphSpec} from a running graph.
 *
 * Tier 1.5.3 Phase 3 (2026-04-27): thin projection over
 * `graph.describe({ detail: "spec" })`. The describe-output already carries
 * structural fields (`type`, `deps`, optional `value`) plus per-node
 * `meta.factory` / `meta.factoryArgs` for tagged factories and top-level
 * `factory` / `factoryArgs` for graph-level tags. The only sugar this helper
 * adds is a feedback-edge recovery scan over `meta.feedbackFrom` /
 * `meta.feedbackTo` companion fields stamped by the §8.1 `feedback()`
 * primitive.
 *
 * **Removed in Phase 3:** template fingerprinting / `_templateName` /
 * `_templateBind` recovery. Mounted subgraphs surface as nested `subname::*`
 * paths in `desc.nodes`; if you need the template-instantiation form, build
 * the spec by hand or read the meta companions directly.
 *
 * @param graph - Running graph to decompile.
 * @returns A GraphSpec representation.
 *
 * @category patterns
 */
export function decompileSpec(graph: Graph): GraphSpec {
	const desc = graph.describe({ detail: "spec" }) as GraphDescribeOutput;
	const metaSegment = `::${GRAPH_META_SEGMENT}::`;
	const feedbackCounterPattern = /^__feedback_(?!effect_)(.+)$/;
	const feedbackEdges: GraphSpecFeedbackEdge[] = [];

	// qa D1 — Pre-pass: collect paths whose own node carries `meta.factory`.
	// These are "factory parents" (e.g. `prompt_node` for the `promptNode`
	// compound factory). Their `::`-prefixed sibling paths (`prompt_node::messages`,
	// `prompt_node::output`, etc.) are factory-internal and SHOULD NOT round-trip
	// as separate spec nodes — `compileSpec` will recreate them when the factory
	// runs against the parent's `meta.factory` / `meta.factoryArgs` tag. Without
	// this filter, every compound-factory internal would be emitted as a top-level
	// spec node, then `compileSpec` would try to re-add them via `g.add(nd, {name})`
	// alongside the factory's own outputs — duplicate-name failures or split topology.
	const compoundFactoryPrefixes = new Set<string>();
	for (const [path, nodeDesc] of Object.entries(desc.nodes)) {
		const meta = nodeDesc.meta as Record<string, unknown> | undefined;
		if (meta?.factory != null && !path.includes("::")) {
			// A12 (QA fix 2026-05-01): skip the `proxy` factoryTag — proxies
			// are local wrappers around foreign-source Nodes (used by
			// `pipelineGraph.approvalGate`, `gatedStream`, `stratify` after
			// the C3 ownership migration). They're regenerated by their
			// parent factory and don't have their own catalog entry; treating
			// them as compound-factory roots would cause `compileSpec` to
			// look up "proxy" as a registered factory name and fail.
			if (meta.factory === "proxy") continue;
			compoundFactoryPrefixes.add(path);
		}
	}

	// 5.6 (b) — DF1 hard-require (Tier 5, 2026-04-29). Locked: any `::`-path
	// whose parent prefix exists in the graph but does NOT carry
	// `meta.factory` is an untagged compound factory. `compileSpec` cannot
	// reconstruct it, so the spec round-trip would silently break. Fail
	// loud at decompile time so the offending factory author tags the
	// parent. Skip well-known internal prefixes that are not factory output
	// (meta companions, feedback / bridge infrastructure).
	const allPaths = new Set(Object.keys(desc.nodes));
	for (const path of allPaths) {
		const sepIdx = path.indexOf("::");
		if (sepIdx <= 0) continue;
		const parent = path.slice(0, sepIdx);
		// Skip internal infrastructure prefixes (handled below in the main loop).
		if (path.includes(metaSegment)) continue;
		if (path.startsWith("__feedback_effect_") || path.startsWith("__bridge_")) continue;
		// Parent is a tagged compound factory → covered by the existing pre-pass.
		if (compoundFactoryPrefixes.has(parent)) continue;
		// Parent doesn't appear in the graph (untagged child path with no
		// matching parent) — treat as a regular `::`-named node, not a
		// compound factory. Allowed.
		if (!allPaths.has(parent)) continue;
		// Parent IS in the graph but lacks `meta.factory` — untagged compound
		// factory. Refuse to round-trip.
		throw new Error(
			`decompileSpec: untagged compound factory at "${parent}" (child: "${path}"). ` +
				"Compound factories that ship `parent::child` topology MUST set `meta.factory` " +
				"on the parent so `compileSpec` can reconstruct the internals via the catalog. " +
				"Either tag the parent (`{ meta: factoryTag('myFactory', args) }`) OR rename the " +
				"child to use `/` instead of `::` if it's not a compound-factory internal " +
				"(see COMPOSITION-GUIDE §38).",
		);
	}

	// Build the spec-shaped node map by walking describe's output. Strip
	// meta-companion paths, bridge / feedback-effect internals, AND compound-
	// factory `::` internals (per pre-pass above); preserve everything else verbatim.
	const nodes: Record<string, GraphSpecNode | GraphSpecTemplateRef> = {};
	for (const [path, nodeDesc] of Object.entries(desc.nodes)) {
		if (path.includes(metaSegment)) continue;

		// qa D1 — skip compound-factory `::` internals (e.g. `prompt_node::messages`)
		// when their parent is a tagged factory. The factory recreates them.
		const sepIdx = path.indexOf("::");
		if (sepIdx > 0 && compoundFactoryPrefixes.has(path.slice(0, sepIdx))) continue;

		const match = feedbackCounterPattern.exec(path);
		if (match) {
			const meta = nodeDesc.meta as Record<string, unknown> | undefined;
			if (meta?.feedbackFrom && meta?.feedbackTo) {
				feedbackEdges.push({
					from: meta.feedbackFrom as string,
					to: meta.feedbackTo as string,
					...(meta.maxIterations ? { maxIterations: meta.maxIterations as number } : {}),
				});
			}
			continue;
		}
		// Skip internal infrastructure nodes (feedback-effect, bridge).
		if (nodeDesc.meta?._internal) continue;
		if (path.startsWith("__feedback_effect_")) continue;
		if (path.startsWith("__bridge_")) continue;

		// QA F5 carry: strip runtime-state sibling keys for known stateful factory
		// tags so the spec doesn't carry transient runtime state into round-trips.
		const meta = nodeDesc.meta as Record<string, unknown> | undefined;
		let cleanedMeta: Record<string, unknown> | undefined = meta;
		if (meta && Object.keys(meta).length > 0) {
			const out: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(meta)) {
				if (INTERNAL_META_KEYS.has(k)) continue;
				out[k] = v;
			}
			if (out.factory === "withStatus") {
				delete out.status;
				delete out.error;
			} else if (out.factory === "withBreaker") {
				delete out.breakerState;
			} else if (out.factory === "verifiable") {
				delete out.sourceVersion;
			}
			cleanedMeta = Object.keys(out).length > 0 ? out : undefined;
		}

		const cleaned: GraphSpecNode = { ...nodeDesc };
		if (cleanedMeta === undefined) delete cleaned.meta;
		else cleaned.meta = cleanedMeta;
		nodes[path] = cleaned;
	}

	const result: GraphSpec = { ...desc, nodes };
	// `expand` (a closure injected onto live describe outputs) is not part of
	// the GraphSpec wire shape — it leaks function refs into JSON-stringified
	// specs. Drop it.
	delete (result as { expand?: unknown }).expand;
	if (feedbackEdges.length > 0) result.feedback = feedbackEdges;
	return result;
}

// ---------------------------------------------------------------------------
// specDiff
// ---------------------------------------------------------------------------

/** A single change in a spec diff. */
export type SpecDiffEntry = {
	type: "added" | "removed" | "changed";
	path: string;
	detail?: string;
};

/** Structural diff between two GraphSpecs. */
export type SpecDiffResult = {
	entries: SpecDiffEntry[];
	summary: string;
};

/**
 * Compute a structural diff between two GraphSpecs.
 *
 * Template-aware: reports "changed template definition" vs "changed
 * instantiation bindings." No runtime needed — pure JSON comparison.
 *
 * @param specA - The "before" spec.
 * @param specB - The "after" spec.
 * @returns Diff entries and a human-readable summary.
 *
 * @category patterns
 */
export function specDiff(specA: GraphSpec, specB: GraphSpec): SpecDiffResult {
	const entries: SpecDiffEntry[] = [];

	// Diff name
	if (specA.name !== specB.name) {
		entries.push({
			type: "changed",
			path: "name",
			detail: `"${specA.name}" → "${specB.name}"`,
		});
	}

	// Diff nodes
	const nodesA = new Set(Object.keys(specA.nodes));
	const nodesB = new Set(Object.keys(specB.nodes));

	for (const name of nodesB) {
		if (!nodesA.has(name)) {
			const n = specB.nodes[name]!;
			entries.push({
				type: "added",
				path: `nodes.${name}`,
				detail: `type: ${n.type}`,
			});
		}
	}
	for (const name of nodesA) {
		if (!nodesB.has(name)) {
			entries.push({ type: "removed", path: `nodes.${name}` });
		}
	}
	for (const name of nodesA) {
		if (!nodesB.has(name)) continue;
		const a = specA.nodes[name]!;
		const b = specB.nodes[name]!;
		if (JSON.stringify(a) !== JSON.stringify(b)) {
			const details: string[] = [];
			if (a.type !== b.type) details.push(`type: ${a.type} → ${b.type}`);
			if (JSON.stringify((a as GraphSpecNode).deps) !== JSON.stringify((b as GraphSpecNode).deps)) {
				details.push("deps changed");
			}
			const aFactory = a.type === "template" ? undefined : readFactory(a as GraphSpecNode);
			const bFactory = b.type === "template" ? undefined : readFactory(b as GraphSpecNode);
			if (aFactory !== bFactory) {
				details.push(`fn: ${aFactory} → ${bFactory}`);
			}
			const aArgs = a.type === "template" ? undefined : readFactoryArgs(a as GraphSpecNode);
			const bArgs = b.type === "template" ? undefined : readFactoryArgs(b as GraphSpecNode);
			if (JSON.stringify(aArgs) !== JSON.stringify(bArgs)) {
				details.push("config changed");
			}
			entries.push({
				type: "changed",
				path: `nodes.${name}`,
				detail: details.join("; ") || "modified",
			});
		}
	}

	// Diff templates
	const tmplA = specA.templates ?? {};
	const tmplB = specB.templates ?? {};
	const tmplNamesA = new Set(Object.keys(tmplA));
	const tmplNamesB = new Set(Object.keys(tmplB));

	for (const name of tmplNamesB) {
		if (!tmplNamesA.has(name)) {
			entries.push({ type: "added", path: `templates.${name}` });
		}
	}
	for (const name of tmplNamesA) {
		if (!tmplNamesB.has(name)) {
			entries.push({ type: "removed", path: `templates.${name}` });
		}
	}
	for (const name of tmplNamesA) {
		if (!tmplNamesB.has(name)) continue;
		if (JSON.stringify(tmplA[name]) !== JSON.stringify(tmplB[name])) {
			entries.push({
				type: "changed",
				path: `templates.${name}`,
				detail: "template definition changed",
			});
		}
	}

	// Diff feedback
	const fbA = specA.feedback ?? [];
	const fbB = specB.feedback ?? [];
	const fbKeyA = new Set(fbA.map((e) => `${e.from}->${e.to}`));
	const fbKeyB = new Set(fbB.map((e) => `${e.from}->${e.to}`));

	for (const fb of fbB) {
		const key = `${fb.from}->${fb.to}`;
		if (!fbKeyA.has(key)) {
			entries.push({
				type: "added",
				path: `feedback.${key}`,
				detail: `maxIterations: ${fb.maxIterations ?? 10}`,
			});
		}
	}
	for (const fb of fbA) {
		const key = `${fb.from}->${fb.to}`;
		if (!fbKeyB.has(key)) {
			entries.push({ type: "removed", path: `feedback.${key}` });
		}
	}
	for (const fb of fbA) {
		const key = `${fb.from}->${fb.to}`;
		const counterpart = fbB.find((b) => b.from === fb.from && b.to === fb.to);
		if (counterpart && JSON.stringify(fb) !== JSON.stringify(counterpart)) {
			entries.push({
				type: "changed",
				path: `feedback.${key}`,
				detail: `maxIterations: ${fb.maxIterations ?? 10} → ${counterpart.maxIterations ?? 10}`,
			});
		}
	}

	// Build summary
	const added = entries.filter((e) => e.type === "added").length;
	const removed = entries.filter((e) => e.type === "removed").length;
	const changed = entries.filter((e) => e.type === "changed").length;
	const parts: string[] = [];
	if (added) parts.push(`${added} added`);
	if (removed) parts.push(`${removed} removed`);
	if (changed) parts.push(`${changed} changed`);
	const summary = parts.length > 0 ? parts.join(", ") : "no changes";

	return { entries, summary };
}

// ---------------------------------------------------------------------------
// llmCompose
// ---------------------------------------------------------------------------

/** Options for {@link llmCompose}. */
export type LLMComposeOptions = {
	model?: string;
	temperature?: number;
	maxTokens?: number;
	/** Extra instructions appended to the system prompt. */
	systemPromptExtra?: string;
	/**
	 * Available fn/source catalog names for the LLM to reference.
	 * When omitted and `catalog` contains rich {@link CatalogFnEntry} entries,
	 * the prompt is auto-generated via {@link generateCatalogPrompt}.
	 */
	catalogDescription?: string;
	/**
	 * Catalog for auto-prompt generation and catalog-aware validation.
	 * When rich entries are provided, the catalog prompt is auto-generated
	 * and LLM output is validated against fn/source names and config schemas.
	 */
	catalog?: GraphSpecCatalog;
	/**
	 * Max auto-refine attempts when the LLM output fails catalog validation.
	 * Each attempt feeds the validation errors back to the LLM via llmRefine.
	 * Default: 0 (no auto-refine). Set to 2-3 for production use.
	 */
	maxAutoRefine?: number;
};

const LLM_COMPOSE_SYSTEM_PROMPT = `You are a graph architect for GraphReFly, a reactive graph protocol.

Given a natural-language description, produce a JSON GraphSpec with this structure:

{
  "name": "<graph_name>",
  "nodes": {
    "<node_name>": {
      "type": "state" | "derived" | "producer" | "effect",
      "deps": ["<dep_node_name>", ...],
      "value": <initial_value>,
      "meta": {
        "factory": "<catalog_factory_name>",
        "factoryArgs": { ... },
        "description": "<purpose>"
      }
    },
    "<template_instance>": {
      "type": "template",
      "template": "<template_name>",
      "bind": { "$param": "node_name" }
    }
  },
  "templates": {
    "<template_name>": {
      "params": ["$param1", "$param2"],
      "nodes": { ... },
      "output": "<output_node>"
    }
  },
  "feedback": [
    { "from": "<condition_node>", "to": "<state_node>", "maxIterations": 10 }
  ]
}

Rules:
- "state" nodes hold user/LLM-writable values (knobs). Stamp the initial value
  in "meta.factoryArgs.initial" (or as the top-level "value" field — both work).
- "derived" nodes compute from deps using a catalog function named in
  "meta.factory"; pass any config via "meta.factoryArgs".
- "effect" nodes produce side effects from deps; same meta.factory shape as derived.
- "producer" nodes generate values from a catalog source named in "meta.factory";
  pass any config via "meta.factoryArgs".
- Use "templates" when the same subgraph pattern repeats (e.g., per-source resilience).
- Use "feedback" for bounded cycles where a derived value writes back to a state node.
- meta.description is required for every node.
- Return ONLY valid JSON, no markdown fences or commentary.`;

/** Strip markdown code fences. */
function stripFences(text: string): string {
	const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```[\s\S]*$/);
	return match ? match[1]! : text;
}

/**
 * Ask an LLM to compose a GraphSpec from a natural-language problem description.
 *
 * The LLM generates a GraphSpec (with templates + feedback), validated before
 * returning. The spec is for human review before compilation via compileSpec().
 *
 * @param problem - Natural language problem description.
 * @param adapter - LLM adapter for the generation call.
 * @param opts - Model options and catalog description.
 * @returns A validated GraphSpec.
 * @throws On invalid LLM output or validation failure.
 *
 * @category patterns
 */
export async function llmCompose(
	problem: string,
	adapter: LLMAdapter,
	opts?: LLMComposeOptions,
): Promise<GraphSpec> {
	let systemPrompt = LLM_COMPOSE_SYSTEM_PROMPT;

	// Auto-generate catalog prompt from rich entries, or use manual description
	const catalogPrompt =
		opts?.catalogDescription ?? (opts?.catalog ? generateCatalogPrompt(opts.catalog) : undefined);
	if (catalogPrompt) {
		systemPrompt += `\n\nAvailable catalog (use ONLY these names):\n${catalogPrompt}`;
	}
	if (opts?.systemPromptExtra) {
		systemPrompt += `\n\n${opts.systemPromptExtra}`;
	}

	const messages: ChatMessage[] = [
		{ role: "system", content: systemPrompt },
		{ role: "user", content: problem },
	];

	const rawResult = adapter.invoke(messages, {
		model: opts?.model,
		temperature: opts?.temperature ?? 0,
		maxTokens: opts?.maxTokens,
	});

	// System boundary: await the adapter's response (Promise, plain value).
	const response = (await rawResult) as LLMResponse;
	let content = response.content.trim();

	if (content.startsWith("```")) {
		content = stripFences(content);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		throw new Error(`llmCompose: LLM response is not valid JSON: ${content.slice(0, 200)}`);
	}

	const validation = validateSpec(parsed);
	if (!validation.valid) {
		throw new Error(`llmCompose: invalid GraphSpec:\n${validation.errors.join("\n")}`);
	}

	let spec = parsed as GraphSpec;

	// Catalog-aware validation + auto-refine loop
	if (opts?.catalog) {
		const maxRefine = opts.maxAutoRefine ?? 0;
		for (let attempt = 0; attempt <= maxRefine; attempt++) {
			const catalogValidation = validateSpecAgainstCatalog(spec, opts.catalog);
			if (catalogValidation.valid) break;

			if (attempt === maxRefine) {
				// Last attempt failed — return with errors attached as meta
				throw new Error(
					`llmCompose: catalog validation failed after ${maxRefine} refine attempts:\n${catalogValidation.errors.join("\n")}`,
				);
			}

			// Auto-refine: feed catalog errors back to LLM
			spec = await llmRefine(
				spec,
				`Fix these catalog errors:\n${catalogValidation.errors.join("\n")}\n\nUse ONLY functions and sources from the catalog.`,
				adapter,
				{ ...opts, catalogDescription: catalogPrompt },
			);
		}
	}

	return spec;
}

// ---------------------------------------------------------------------------
// llmRefine
// ---------------------------------------------------------------------------

/** Options for {@link llmRefine}. */
export type LLMRefineOptions = LLMComposeOptions;

/**
 * Ask an LLM to modify an existing GraphSpec based on feedback or changed requirements.
 *
 * @param currentSpec - The current GraphSpec to modify.
 * @param feedback - Natural language feedback or changed requirements.
 * @param adapter - LLM adapter for the generation call.
 * @param opts - Model options.
 * @returns A new GraphSpec incorporating the feedback.
 * @throws On invalid LLM output or validation failure.
 *
 * @category patterns
 */
export async function llmRefine(
	currentSpec: GraphSpec,
	feedback: string,
	adapter: LLMAdapter,
	opts?: LLMRefineOptions,
): Promise<GraphSpec> {
	let systemPrompt = LLM_COMPOSE_SYSTEM_PROMPT;
	if (opts?.catalogDescription) {
		systemPrompt += `\n\nAvailable catalog:\n${opts.catalogDescription}`;
	}
	if (opts?.systemPromptExtra) {
		systemPrompt += `\n\n${opts.systemPromptExtra}`;
	}

	const messages: ChatMessage[] = [
		{ role: "system", content: systemPrompt },
		{
			role: "user",
			content: `Current GraphSpec:\n${JSON.stringify(currentSpec, null, 2)}\n\nModification request: ${feedback}\n\nReturn the complete modified GraphSpec as JSON.`,
		},
	];

	const rawResult = adapter.invoke(messages, {
		model: opts?.model,
		temperature: opts?.temperature ?? 0,
		maxTokens: opts?.maxTokens,
	});

	// System boundary: await the adapter's response.
	const response = (await rawResult) as LLMResponse;
	let content = response.content.trim();

	if (content.startsWith("```")) {
		content = stripFences(content);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		throw new Error(`llmRefine: LLM response is not valid JSON: ${content.slice(0, 200)}`);
	}

	const validation = validateSpec(parsed);
	if (!validation.valid) {
		throw new Error(`llmRefine: invalid GraphSpec:\n${validation.errors.join("\n")}`);
	}

	return parsed as GraphSpec;
}
