/**
 * LLM graph composition (roadmap §8.3).
 *
 * Declarative GraphSpec schema + compiler/decompiler for graph topology.
 * The LLM designs graphs as JSON; compileSpec instantiates them; decompileGraph
 * extracts them back. Templates support reusable subgraph patterns. Feedback
 * edges express bounded cycles via §8.1 feedback().
 *
 * @module
 */

import type { Node } from "../core/node.js";
import { derived, effect, producer, state } from "../core/sugar.js";
import { GRAPH_META_SEGMENT, Graph } from "../graph/graph.js";
import type { ChatMessage, LLMAdapter, LLMResponse } from "./ai.js";
import { feedback as feedbackPrimitive } from "./reduction.js";

// ---------------------------------------------------------------------------
// GraphSpec types
// ---------------------------------------------------------------------------

/** A single node declaration in a GraphSpec. */
export type GraphSpecNode = {
	/** Node kind: state, producer, derived, effect, operator. */
	type: "state" | "producer" | "derived" | "effect" | "operator";
	/** Dependency node names (for derived/effect/operator). */
	deps?: string[];
	/** Named function from the catalog (for derived/effect/operator/producer). */
	fn?: string;
	/** Named source from the catalog (for producer). */
	source?: string;
	/** Freeform config passed to the catalog fn/source factory. */
	config?: Record<string, unknown>;
	/** Initial value (for state nodes). */
	initial?: unknown;
	/** Human/LLM-readable metadata. */
	meta?: Record<string, unknown>;
};

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

/** Declarative graph topology for LLM composition (§8.3). */
export type GraphSpec = {
	/** Graph name. */
	name: string;
	/** Node declarations (keyed by node name). */
	nodes: Record<string, GraphSpecNode | GraphSpecTemplateRef>;
	/** Reusable subgraph templates. */
	templates?: Record<string, GraphSpecTemplate>;
	/** Feedback edges (bounded cycles). */
	feedback?: GraphSpecFeedbackEdge[];
};

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
 * Fn/source lookup table passed to compileSpec and llmCompose.
 *
 * Accepts both bare factories (backward-compatible) and rich {@link CatalogFnEntry}
 * / {@link CatalogSourceEntry} objects. When rich entries are provided, the library
 * auto-generates LLM prompts and validates LLM output against the catalog.
 */
export type GraphSpecCatalog = {
	fns?: Record<string, FnFactory | CatalogFnEntry>;
	sources?: Record<string, SourceFactory | CatalogSourceEntry>;
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

		// Check fn name exists in catalog
		if (node.fn && fnNames.size > 0 && !fnNames.has(node.fn)) {
			// Check if they used a source name as fn
			if (sourceNames.has(node.fn)) {
				errors.push(
					`Node "${nodeName}": fn "${node.fn}" is a source, not a function. ` +
						`Use it as a producer source instead, or use a function from: ${[...fnNames].join(", ")}`,
				);
			} else {
				const suggestion = findClosest(node.fn, fnNames);
				errors.push(
					`Node "${nodeName}": fn "${node.fn}" not found in catalog` +
						(suggestion ? `. Did you mean "${suggestion}"?` : ""),
				);
			}
		}

		// Check source name exists in catalog
		if (node.source && sourceNames.size > 0 && !sourceNames.has(node.source)) {
			if (fnNames.has(node.source)) {
				errors.push(
					`Node "${nodeName}": source "${node.source}" is a function, not a source. ` +
						`Use it as fn instead, or use a source from: ${[...sourceNames].join(", ")}`,
				);
			} else {
				const suggestion = findClosest(node.source, sourceNames);
				errors.push(
					`Node "${nodeName}": source "${node.source}" not found in catalog` +
						(suggestion ? `. Did you mean "${suggestion}"?` : ""),
				);
			}
		}

		// Validate config against schema (if rich entry)
		if (node.fn && node.config && catalog.fns?.[node.fn]) {
			const entry = catalog.fns[node.fn];
			if (isRichFnEntry(entry) && entry.configSchema) {
				for (const [field, schema] of Object.entries(entry.configSchema)) {
					if (schema.required !== false && !(field in node.config)) {
						errors.push(`Node "${nodeName}": config missing required field "${field}"`);
					}
					if (field in node.config && schema.enum) {
						const val = node.config[field];
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
				if (node.fn && fnNames.size > 0 && !fnNames.has(node.fn)) {
					const suggestion = findClosest(node.fn, fnNames);
					errors.push(
						`Template "${tName}" node "${nodeName}": fn "${node.fn}" not found in catalog` +
							(suggestion ? `. Did you mean "${suggestion}"?` : ""),
					);
				}
			}
		}
	}

	return { valid: errors.length === 0, errors };
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
 */
export function validateSpec(spec: unknown): GraphSpecValidation {
	const errors: string[] = [];

	if (spec == null || typeof spec !== "object") {
		return { valid: false, errors: ["GraphSpec must be a non-null object"] };
	}

	const s = spec as Record<string, unknown>;

	if (typeof s.name !== "string" || s.name.length === 0) {
		errors.push("Missing or empty 'name' field");
	}

	if (s.nodes == null || typeof s.nodes !== "object" || Array.isArray(s.nodes)) {
		errors.push("Missing or invalid 'nodes' field (must be an object)");
		return { valid: false, errors };
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

	return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// compileSpec
// ---------------------------------------------------------------------------

/** Options for {@link compileSpec}. */
export type CompileSpecOptions = {
	/** Fn/source catalog for resolving named factories. */
	catalog?: GraphSpecCatalog;
};

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
	const validation = validateSpec(spec);
	if (!validation.valid) {
		throw new Error(`compileSpec: invalid GraphSpec:\n${validation.errors.join("\n")}`);
	}

	const catalog = opts?.catalog ?? {};
	const g = new Graph(spec.name);
	const templates = spec.templates ?? {};

	// Catalog-aware validation (when rich entries are available)
	const catalogValidation = validateSpecAgainstCatalog(spec, catalog);
	if (!catalogValidation.valid) {
		throw new Error(
			`compileSpec: catalog validation errors:\n${catalogValidation.errors.join("\n")}`,
		);
	}

	// Helper: resolve fn/source factories from catalog (handles rich + bare entries)
	const resolveFn = (fnName: string): FnFactory | undefined => {
		const entry = catalog.fns?.[fnName];
		return entry ? extractFnFactory(entry) : undefined;
	};
	const resolveSource = (sourceName: string): SourceFactory | undefined => {
		const entry = catalog.sources?.[sourceName];
		return entry ? extractSourceFactory(entry) : undefined;
	};

	// Phase 1: Create non-template nodes (state/producer first, then derived/effect/operator)
	const created = new Map<string, Node<unknown>>();
	const deferred: [string, GraphSpecNode][] = [];

	for (const [name, raw] of Object.entries(spec.nodes)) {
		if (raw.type === "template") continue; // handled in Phase 2

		const n = raw as GraphSpecNode;
		if (n.type === "state") {
			const nd = state(n.initial, {
				name,
				meta: n.meta ? { ...n.meta } : undefined,
			});
			g.add(nd, { name: name });
			created.set(name, nd);
		} else if (n.type === "producer") {
			const sourceFactory = n.source ? resolveSource(n.source) : undefined;
			const fnFactory = n.fn ? resolveFn(n.fn) : undefined;
			if (sourceFactory) {
				const nd = sourceFactory(n.config ?? {});
				g.add(nd, { name: name });
				created.set(name, nd);
			} else if (fnFactory) {
				const nd = fnFactory([], n.config ?? {});
				g.add(nd, { name: name });
				created.set(name, nd);
			} else {
				// No catalog entry — create a bare producer placeholder
				const nd = producer(() => {}, {
					name,
					meta: { ...n.meta, _specFn: n.fn, _specSource: n.source },
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
			const fnFactory = n.fn ? resolveFn(n.fn) : undefined;

			let nd: Node<unknown>;
			if (fnFactory) {
				nd = fnFactory(resolvedDeps, n.config ?? {});
			} else if (n.type === "effect") {
				nd = effect(resolvedDeps, () => {});
			} else {
				// derived/operator without catalog fn — identity passthrough
				nd = derived(resolvedDeps, (vals: readonly unknown[]) => vals[0]);
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
			const specWithResolvedDeps = { ...nSpec, deps: resolvedDeps };

			if (nSpec.type === "state") {
				const nd = state(nSpec.initial, {
					name: nName,
					meta: nSpec.meta ? { ...nSpec.meta } : undefined,
				});
				sub.add(nd, { name: nName });
				subCreated.set(nName, nd);
			} else if (nSpec.type === "producer") {
				// Handle producer nodes inside templates
				const sourceFactory = nSpec.source ? resolveSource(nSpec.source) : undefined;
				const fnFactory = nSpec.fn ? resolveFn(nSpec.fn) : undefined;
				if (sourceFactory) {
					const nd = sourceFactory(nSpec.config ?? {});
					sub.add(nd, { name: nName });
					subCreated.set(nName, nd);
				} else if (fnFactory) {
					const nd = fnFactory([], nSpec.config ?? {});
					sub.add(nd, { name: nName });
					subCreated.set(nName, nd);
				} else {
					const nd = producer(() => {}, {
						name: nName,
						meta: { ...nSpec.meta, _specFn: nSpec.fn, _specSource: nSpec.source },
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
				const fnFactory = nSpec.fn ? resolveFn(nSpec.fn) : undefined;

				let nd: Node<unknown>;
				if (fnFactory) {
					nd = fnFactory(resolvedDeps, nSpec.config ?? {});
				} else if (nSpec.type === "effect") {
					nd = effect(resolvedDeps, () => {});
				} else {
					nd = derived(resolvedDeps, (vals: readonly unknown[]) => vals[0]);
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

		// Store template origin meta on the mounted subgraph's first node
		// so decompileGraph can recover it without structural fingerprinting.
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
 * Extract a GraphSpec from a running graph.
 *
 * Uses `describe({ detail: "standard" })` as a starting point, then enriches:
 * - Feedback edges recovered from counter node meta (`feedbackFrom`/`feedbackTo`)
 * - Template refs recovered from output node meta (`_templateName`/`_templateBind`)
 * - Structural fingerprinting as fallback for 2+ identical mounted subgraphs
 *
 * @param graph - Running graph to decompile.
 * @returns A GraphSpec representation.
 *
 * @category patterns
 */
export function decompileGraph(graph: Graph): GraphSpec {
	const desc = graph.describe({ detail: "standard" });
	const nodes: Record<string, GraphSpecNode> = {};
	const feedbackEdges: GraphSpecFeedbackEdge[] = [];
	const metaSegment = `::${GRAPH_META_SEGMENT}::`;

	// Detect feedback counter nodes and extract feedback edges from meta
	const feedbackCounterPattern = /^__feedback_(?!effect_)(.+)$/;
	const feedbackConditions = new Set<string>();

	for (const path of Object.keys(desc.nodes)) {
		if (path.includes(metaSegment)) continue;
		const match = feedbackCounterPattern.exec(path);
		if (match) {
			feedbackConditions.add(match[1]!);
			const meta = desc.nodes[path]?.meta as Record<string, unknown> | undefined;
			if (meta?.feedbackFrom && meta?.feedbackTo) {
				feedbackEdges.push({
					from: meta.feedbackFrom as string,
					to: meta.feedbackTo as string,
					...(meta.maxIterations ? { maxIterations: meta.maxIterations as number } : {}),
				});
			}
		}
	}

	// Build nodes map, skipping meta, feedback internals, and bridge nodes
	for (const [path, nodeDesc] of Object.entries(desc.nodes)) {
		if (path.includes(metaSegment)) continue;
		if (feedbackCounterPattern.test(path)) continue;
		// Skip internal infrastructure nodes (bridge, feedback effect) via meta tag
		if (nodeDesc.meta?._internal) continue;
		// Legacy fallback: skip by naming convention
		if (path.startsWith("__feedback_effect_")) continue;
		if (path.startsWith("__bridge_")) continue;
		// Skip subgraph-internal nodes (they belong to templates)
		if (path.includes("::")) continue;

		const specNode: GraphSpecNode = {
			type: nodeDesc.type as GraphSpecNode["type"],
		};

		if (nodeDesc.deps.length > 0) {
			specNode.deps = nodeDesc.deps.filter((d) => !d.includes("::"));
		}

		if (nodeDesc.type === "state" && nodeDesc.value !== undefined) {
			specNode.initial = nodeDesc.value;
		}

		if (nodeDesc.meta && Object.keys(nodeDesc.meta).length > 0) {
			const meta: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(nodeDesc.meta as Record<string, unknown>)) {
				if (!INTERNAL_META_KEYS.has(k)) meta[k] = v;
			}
			if (Object.keys(meta).length > 0) {
				specNode.meta = meta;
			}
		}

		nodes[path] = specNode;
	}

	// Detect templates: first from compile-time meta (option B), then structural fallback
	const templates: Record<string, GraphSpecTemplate> = {};
	const templateRefs: Record<string, GraphSpecTemplateRef> = {};
	const metaDetectedSubgraphs = new Set<string>();

	// Option B: recover template origin from meta stored by compileSpec
	for (const subName of desc.subgraphs) {
		const prefix = `${subName}::`;
		for (const [path, nodeDesc] of Object.entries(desc.nodes)) {
			if (!path.startsWith(prefix)) continue;
			if (path.includes(metaSegment)) continue;
			const meta = nodeDesc.meta as Record<string, unknown> | undefined;
			if (meta?._templateName && meta?._templateBind) {
				const templateName = meta._templateName as string;
				const bind = meta._templateBind as Record<string, string>;

				// Reconstruct template definition from the subgraph's nodes
				if (!templates[templateName]) {
					const tmplNodes: Record<string, GraphSpecNode> = {};
					const tmplInnerNames = new Set<string>();
					const tmplPrefix = `${subName}::`;
					for (const [p, nd] of Object.entries(desc.nodes)) {
						if (!p.startsWith(tmplPrefix) || p.includes(metaSegment)) continue;
						const localName = p.slice(tmplPrefix.length);
						if (localName.includes("::")) continue;
						tmplInnerNames.add(localName);
						tmplNodes[localName] = {
							type: nd.type as GraphSpecNode["type"],
							...(nd.deps.length > 0
								? {
										deps: nd.deps.map((d) =>
											d.startsWith(tmplPrefix) ? d.slice(tmplPrefix.length) : d,
										),
									}
								: {}),
						};
					}
					// Detect params (external deps) and output
					const tmplParams: string[] = [];
					const tmplParamMap = new Map<string, string>();
					for (const n of Object.values(tmplNodes)) {
						for (const dep of n.deps ?? []) {
							if (!tmplInnerNames.has(dep) && !tmplParamMap.has(dep)) {
								const param = `$${dep}`;
								tmplParams.push(param);
								tmplParamMap.set(dep, param);
							}
						}
					}
					// Substitute external deps with $params
					for (const n of Object.values(tmplNodes)) {
						if (n.deps) n.deps = n.deps.map((d) => tmplParamMap.get(d) ?? d);
					}
					// Find output
					const depended = new Set<string>();
					for (const n of Object.values(tmplNodes)) {
						for (const dep of n.deps ?? []) {
							if (tmplInnerNames.has(dep)) depended.add(dep);
						}
					}
					const outputCandidates = [...tmplInnerNames].filter((n) => !depended.has(n));
					const tmplOutput = outputCandidates[0] ?? [...tmplInnerNames].pop()!;

					templates[templateName] = { params: tmplParams, nodes: tmplNodes, output: tmplOutput };
				}

				delete nodes[subName];
				templateRefs[subName] = { type: "template", template: templateName, bind };
				metaDetectedSubgraphs.add(subName);
				break;
			}
		}
	}

	// Structural fallback: group remaining mounted subgraphs by fingerprint
	const structureMap = new Map<string, { name: string; nodes: Record<string, GraphSpecNode> }[]>();
	for (const subName of desc.subgraphs) {
		if (metaDetectedSubgraphs.has(subName)) continue;
		const subNodes: Record<string, GraphSpecNode> = {};
		const prefix = `${subName}::`;
		for (const [path, nodeDesc] of Object.entries(desc.nodes)) {
			if (path.includes(metaSegment)) continue;
			if (!path.startsWith(prefix)) continue;
			const localName = path.slice(prefix.length);
			if (localName.includes("::")) continue;
			subNodes[localName] = {
				type: nodeDesc.type as GraphSpecNode["type"],
				...(nodeDesc.deps.length > 0
					? {
							deps: nodeDesc.deps.map((d) => (d.startsWith(prefix) ? d.slice(prefix.length) : d)),
						}
					: {}),
			};
		}
		const fingerprint = JSON.stringify(
			Object.fromEntries(
				Object.entries(subNodes)
					.sort(([a], [b]) => a.localeCompare(b))
					.map(([k, v]) => [k, { type: v.type, deps: v.deps ?? [] }]),
			),
		);
		if (!structureMap.has(fingerprint)) {
			structureMap.set(fingerprint, []);
		}
		structureMap.get(fingerprint)!.push({ name: subName, nodes: subNodes });
	}

	// Subgraphs with identical structure (2+ instances) → templates
	for (const [, group] of structureMap) {
		if (group.length < 2) continue;
		const templateName = `${group[0]!.name}_template`;
		const refNodes = group[0]!.nodes;
		const innerNames = new Set(Object.keys(refNodes));

		// Detect external deps as params (from first member)
		const params: string[] = [];
		const baseParamMap = new Map<string, string>();
		for (const n of Object.values(refNodes)) {
			for (const dep of n.deps ?? []) {
				if (!innerNames.has(dep) && !baseParamMap.has(dep)) {
					const param = `$${dep}`;
					params.push(param);
					baseParamMap.set(dep, param);
				}
			}
		}

		// Find output node
		const depended = new Set<string>();
		for (const n of Object.values(refNodes)) {
			for (const dep of n.deps ?? []) {
				if (innerNames.has(dep)) depended.add(dep);
			}
		}
		const outputCandidates = [...innerNames].filter((n) => !depended.has(n));
		const output = outputCandidates[0] ?? [...innerNames].pop()!;

		// Build template nodes with param-substituted deps
		const tmplNodes: Record<string, GraphSpecNode> = {};
		for (const [nName, nSpec] of Object.entries(refNodes)) {
			tmplNodes[nName] = {
				...nSpec,
				deps: nSpec.deps?.map((d) => baseParamMap.get(d) ?? d),
			};
		}

		templates[templateName] = { params, nodes: tmplNodes, output };

		// Build per-member bind maps (each member may bind to different external nodes)
		for (const member of group) {
			delete nodes[member.name];
			// Build this member's own bind map by scanning its external deps
			const memberBind: Record<string, string> = {};
			const memberInnerNames = new Set(Object.keys(member.nodes));
			for (const n of Object.values(member.nodes)) {
				for (const dep of n.deps ?? []) {
					if (!memberInnerNames.has(dep)) {
						// Find which param this external dep maps to
						const param = baseParamMap.get(dep) ?? `$${dep}`;
						memberBind[param] = dep;
					}
				}
			}
			templateRefs[member.name] = {
				type: "template",
				template: templateName,
				bind: memberBind,
			};
		}
	}

	const allNodes: Record<string, GraphSpecNode | GraphSpecTemplateRef> = {
		...nodes,
		...templateRefs,
	};

	const result: GraphSpec = { name: desc.name, nodes: allNodes };
	if (Object.keys(templates).length > 0) result.templates = templates;
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
			if ((a as GraphSpecNode).fn !== (b as GraphSpecNode).fn) {
				details.push(`fn: ${(a as GraphSpecNode).fn} → ${(b as GraphSpecNode).fn}`);
			}
			if (
				JSON.stringify((a as GraphSpecNode).config) !== JSON.stringify((b as GraphSpecNode).config)
			) {
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
      "type": "state" | "derived" | "producer" | "effect" | "operator",
      "deps": ["<dep_node_name>", ...],
      "fn": "<catalog_function_name>",
      "source": "<catalog_source_name>",
      "config": { ... },
      "initial": <value>,
      "meta": { "description": "<purpose>" }
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
- "state" nodes hold user/LLM-writable values (knobs). Use "initial" for default values.
- "derived" nodes compute from deps using a named "fn".
- "effect" nodes produce side effects from deps.
- "producer" nodes generate values from a named "source".
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
