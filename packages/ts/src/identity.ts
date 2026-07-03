/**
 * D574 canonical tuple encoding for generated compound fact ids/keys.
 *
 * Graph topology and mount paths keep their dedicated `::` path syntax. Use this
 * helper for library-derived compound ids/keys whose coordinates are open strings.
 */
export function canonicalTupleKey(parts: readonly string[]): string {
	return JSON.stringify(parts);
}

export function compoundTupleKey(prefix: string, parts: readonly string[]): string {
	return `${prefix}:${canonicalTupleKey(parts)}`;
}

export function parseCanonicalTupleKey(value: string): readonly string[] | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		return undefined;
	}
	if (!Array.isArray(parsed) || !parsed.every((part) => typeof part === "string")) {
		return undefined;
	}
	return Object.freeze([...parsed]);
}
