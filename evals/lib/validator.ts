/**
 * Runtime validator — uses graphrefly-ts APIs to validate and execute specs.
 *
 * Placeholder: actual implementation depends on graphFromSpec() and
 * validateSpec() being implemented (Phase A items A1-A3).
 */

export interface ValidationResult {
	valid: boolean;
	errors: string[];
}

export interface ExecutionResult {
	runnable: boolean;
	error?: string;
}

/**
 * Validate a GraphSpec JSON object against the schema.
 * TODO: Wire to actual validateSpec() once implemented.
 */
export function validateSpec(spec: unknown): ValidationResult {
	if (typeof spec !== "object" || spec === null) {
		return { valid: false, errors: ["Output is not a JSON object"] };
	}

	const obj = spec as Record<string, unknown>;

	if (!obj.nodes || typeof obj.nodes !== "object") {
		return { valid: false, errors: ["Missing or invalid 'nodes' object"] };
	}

	const errors: string[] = [];
	const nodes = obj.nodes as Record<string, Record<string, unknown>>;
	const nodeNames = new Set(Object.keys(nodes));

	for (const [name, node] of Object.entries(nodes)) {
		const type = node.type;
		if (!type || !["producer", "state", "derived", "effect", "operator"].includes(type as string)) {
			errors.push(`Node '${name}': invalid type '${type}'`);
		}

		if (type === "derived" || type === "effect") {
			if (!Array.isArray(node.deps)) {
				errors.push(`Node '${name}': ${type} must have 'deps' array`);
			} else {
				for (const dep of node.deps as string[]) {
					if (!nodeNames.has(dep)) {
						errors.push(`Node '${name}': dep '${dep}' does not exist in spec`);
					}
				}
			}
			if (typeof node.fn !== "string") {
				errors.push(`Node '${name}': ${type} must have 'fn' string`);
			}
		}

		if (type === "producer" && typeof node.source !== "string") {
			errors.push(`Node '${name}': producer must have 'source' string`);
		}
	}

	return { valid: errors.length === 0, errors };
}

/**
 * Attempt to execute a GraphSpec.
 * TODO: Wire to actual graphFromSpec() once implemented.
 */
export async function executeSpec(spec: unknown): Promise<ExecutionResult> {
	// Placeholder: for now, pass-through validation result
	const validation = validateSpec(spec);
	if (!validation.valid) {
		return {
			runnable: false,
			error: validation.errors.join("; "),
		};
	}
	// TODO: graphFromSpec(spec) → graph.start() → check for runtime errors
	return { runnable: true };
}
