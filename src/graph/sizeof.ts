/**
 * Approximate in-memory size estimation for arbitrary JS values.
 *
 * Uses a recursive walk with cycle detection. Not exact — provides a
 * reasonable approximation for profiling and hotspot detection.
 *
 * @module
 * @internal
 */

/** Approximate per-type overhead in bytes (V8 heuristics). */
const OVERHEAD = {
	object: 56,
	array: 64,
	string: 40, // header; content added separately
	number: 8,
	boolean: 4,
	null: 0,
	undefined: 0,
	symbol: 40,
	bigint: 16,
	function: 120,
	map: 72,
	set: 72,
	mapEntry: 40,
	setEntry: 24,
} as const;

/**
 * Estimate the approximate retained memory (in bytes) of a JS value.
 *
 * Handles primitives, plain objects, arrays, Maps, Sets, and nested
 * combinations. Uses a `WeakSet` for cycle detection — cyclic refs
 * are counted once.
 *
 * @param value - The value to measure.
 * @returns Approximate size in bytes.
 */
export function sizeof(value: unknown): number {
	const seen = new WeakSet();
	return _sizeof(value, seen);
}

function _sizeof(value: unknown, seen: WeakSet<WeakKey>): number {
	if (value == null) return 0;

	const t = typeof value;

	switch (t) {
		case "number":
			return OVERHEAD.number;
		case "boolean":
			return OVERHEAD.boolean;
		case "string":
			return OVERHEAD.string + (value as string).length * 2; // UTF-16
		case "bigint":
			return OVERHEAD.bigint;
		case "symbol":
			return OVERHEAD.symbol;
		case "function":
			if (seen.has(value as object)) return 0;
			seen.add(value as object);
			return OVERHEAD.function;
		case "undefined":
			return 0;
	}

	// Object types — cycle detection
	const obj = value as object;
	if (seen.has(obj)) return 0;
	seen.add(obj);

	if (obj instanceof Map) {
		let size = OVERHEAD.map;
		for (const [k, v] of obj) {
			size += OVERHEAD.mapEntry + _sizeof(k, seen) + _sizeof(v, seen);
		}
		return size;
	}

	if (obj instanceof Set) {
		let size = OVERHEAD.set;
		for (const v of obj) {
			size += OVERHEAD.setEntry + _sizeof(v, seen);
		}
		return size;
	}

	if (Array.isArray(obj)) {
		let size = OVERHEAD.array + obj.length * 8; // pointer slots
		for (const item of obj) {
			size += _sizeof(item, seen);
		}
		return size;
	}

	// ArrayBuffer / TypedArray
	if (obj instanceof ArrayBuffer) return obj.byteLength;
	if (ArrayBuffer.isView(obj)) return (obj as { byteLength: number }).byteLength;

	// Plain object
	let size = OVERHEAD.object;
	const keys = Object.keys(obj);
	for (const key of keys) {
		size += OVERHEAD.string + key.length * 2; // key
		size += _sizeof((obj as Record<string, unknown>)[key], seen);
	}
	return size;
}
