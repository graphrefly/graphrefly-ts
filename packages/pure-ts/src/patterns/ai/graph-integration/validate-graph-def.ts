// ---------------------------------------------------------------------------
// validateGraphDef
// ---------------------------------------------------------------------------

/** Validation result from {@link validateGraphDef}. */
export type GraphDefValidation = {
	readonly valid: boolean;
	readonly errors: readonly string[];
};

const VALID_NODE_TYPES = new Set(["state", "derived", "producer", "operator", "effect"]);

/**
 * Validate an LLM-generated graph definition before passing to
 * `Graph.fromSnapshot()`.
 *
 * Checks:
 * - Required fields: `name`, `nodes`, `edges`
 * - Node types are valid enum values
 * - Edge `from`/`to` reference existing nodes
 * - No duplicate edge entries
 *
 * @param def - The graph definition to validate (parsed JSON).
 * @returns Validation result with errors array.
 */
export function validateGraphDef(def: unknown): GraphDefValidation {
	const errors: string[] = [];

	if (def == null || typeof def !== "object") {
		return { valid: false, errors: ["Definition must be a non-null object"] };
	}

	const d = def as Record<string, unknown>;

	if (typeof d.name !== "string" || d.name.length === 0) {
		errors.push("Missing or empty 'name' field");
	}

	if (d.nodes == null || typeof d.nodes !== "object" || Array.isArray(d.nodes)) {
		errors.push("Missing or invalid 'nodes' field (must be an object)");
		return { valid: false, errors };
	}

	const nodeNames = new Set(Object.keys(d.nodes as object));

	for (const [name, raw] of Object.entries(d.nodes as Record<string, unknown>)) {
		if (raw == null || typeof raw !== "object") {
			errors.push(`Node "${name}": must be an object`);
			continue;
		}
		const node = raw as Record<string, unknown>;
		if (typeof node.type !== "string" || !VALID_NODE_TYPES.has(node.type)) {
			errors.push(
				`Node "${name}": invalid type "${String(node.type)}" (expected: ${[...VALID_NODE_TYPES].join(", ")})`,
			);
		}
		if (Array.isArray(node.deps)) {
			for (const dep of node.deps) {
				if (typeof dep === "string" && !nodeNames.has(dep)) {
					errors.push(`Node "${name}": dep "${dep}" does not reference an existing node`);
				}
			}
		}
	}

	if (!Array.isArray(d.edges)) {
		if (d.edges !== undefined) {
			errors.push("'edges' must be an array");
		}
		// edges are optional — no error if absent
	} else {
		const seen = new Set<string>();
		for (let i = 0; i < (d.edges as unknown[]).length; i++) {
			const edge = (d.edges as unknown[])[i];
			if (edge == null || typeof edge !== "object") {
				errors.push(`Edge [${i}]: must be an object`);
				continue;
			}
			const e = edge as Record<string, unknown>;
			if (typeof e.from !== "string" || !nodeNames.has(e.from)) {
				errors.push(`Edge [${i}]: 'from' "${String(e.from)}" does not reference an existing node`);
			}
			if (typeof e.to !== "string" || !nodeNames.has(e.to)) {
				errors.push(`Edge [${i}]: 'to' "${String(e.to)}" does not reference an existing node`);
			}
			const key = `${e.from}->${e.to}`;
			if (seen.has(key)) {
				errors.push(`Edge [${i}]: duplicate edge ${key}`);
			}
			seen.add(key);
		}
	}

	return { valid: errors.length === 0, errors };
}
