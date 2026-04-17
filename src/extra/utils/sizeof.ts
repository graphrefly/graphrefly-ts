/**
 * Approximate in-memory size estimation for arbitrary JS values.
 *
 * Iterative walk with cycle detection via `WeakSet`. V8-tuned overhead
 * heuristics. Not exact — approximate enough for profiling and hotspot
 * detection.
 *
 * Use cases: `graphProfile` (per-node value size), reactive data structure
 * memory audits, heuristic cache admission.
 *
 * @module
 */

/** Approximate per-type overhead in bytes (V8 heuristics). */
export const OVERHEAD = {
	object: 56,
	array: 64,
	string: 40, // header; content added separately
	number: 8,
	boolean: 4,
	null: 0,
	undefined: 0,
	symbol: 40,
	bigint: 16, // base; scales with digit count (see `_bigintSize`)
	function: 120,
	map: 72,
	set: 72,
	mapEntry: 40,
	setEntry: 24,
	date: 24,
	regexp: 48,
	error: 64,
	url: 80,
	promise: 48,
	weakmap: 40,
	weakset: 40,
} as const;

/**
 * Optional user hook. Declare a `sizeof` symbol key on any object to return
 * a precomputed size (in bytes); the walker will honor it and skip recursion.
 *
 * @example
 * ```ts
 * const SIZEOF = Symbol.for("sizeof");
 * class MyCache { [SIZEOF]() { return this.bytes; } }
 * ```
 */
export const SIZEOF_SYMBOL = Symbol.for("sizeof");

/**
 * Estimate the approximate retained memory (in bytes) of a JS value.
 *
 * Handles primitives, plain objects, arrays, Maps, Sets, ArrayBuffers +
 * TypedArrays (shared-buffer dedup), Date, RegExp, Error, URL, Promise,
 * WeakMap, WeakSet, nested combinations. Cyclic refs are counted once.
 *
 * @param value - The value to measure.
 * @returns Approximate size in bytes.
 */
export function sizeof(value: unknown): number {
	const seen = new WeakSet<object>();
	const seenBuffers = new WeakSet<ArrayBufferLike>();
	// Iterative walk via explicit stack — avoids blowing the call stack on
	// deeply nested values (linked lists, AST nodes, deep JSON).
	const stack: unknown[] = [value];
	let total = 0;
	while (stack.length > 0) {
		const v = stack.pop();
		total += _shallowSize(v, seen, seenBuffers, stack);
	}
	return total;
}

/** Shallow size of `v`; pushes children onto `stack` for iterative traversal. */
function _shallowSize(
	value: unknown,
	seen: WeakSet<object>,
	seenBuffers: WeakSet<ArrayBufferLike>,
	stack: unknown[],
): number {
	if (value === null || value === undefined) return 0;

	const t = typeof value;
	switch (t) {
		case "number":
			return OVERHEAD.number;
		case "boolean":
			return OVERHEAD.boolean;
		case "string":
			return OVERHEAD.string + (value as string).length * 2;
		case "bigint":
			return OVERHEAD.bigint + _bigintSize(value as bigint);
		case "symbol":
			return OVERHEAD.symbol;
		case "function":
			if (seen.has(value as object)) return 0;
			seen.add(value as object);
			return OVERHEAD.function;
		case "undefined":
			return 0;
	}

	const obj = value as object;
	if (seen.has(obj)) return 0;
	seen.add(obj);

	// User-supplied size hook wins — `Symbol.for("sizeof")` method on the
	// object returns an exact byte count and we skip recursion.
	const hook = (obj as Record<symbol, unknown>)[SIZEOF_SYMBOL];
	if (typeof hook === "function") {
		try {
			const reported = (hook as () => unknown).call(obj);
			if (typeof reported === "number" && Number.isFinite(reported)) return reported;
		} catch {
			/* ignore — fall through to default estimator */
		}
	}

	if (obj instanceof Date) return OVERHEAD.date;
	if (obj instanceof RegExp) return OVERHEAD.regexp + obj.source.length * 2;
	if (obj instanceof Error) {
		const m = obj.message ? obj.message.length * 2 : 0;
		const s = obj.stack ? obj.stack.length * 2 : 0;
		return OVERHEAD.error + m + s;
	}
	if (typeof URL !== "undefined" && obj instanceof URL) {
		return OVERHEAD.url + obj.href.length * 2;
	}
	if (typeof Promise !== "undefined" && obj instanceof Promise) {
		return OVERHEAD.promise;
	}
	if (obj instanceof WeakMap) return OVERHEAD.weakmap;
	if (obj instanceof WeakSet) return OVERHEAD.weakset;

	if (obj instanceof Map) {
		let size = OVERHEAD.map;
		for (const [k, v] of obj) {
			size += OVERHEAD.mapEntry;
			stack.push(k);
			stack.push(v);
		}
		return size;
	}

	if (obj instanceof Set) {
		let size = OVERHEAD.set;
		for (const v of obj) {
			size += OVERHEAD.setEntry;
			stack.push(v);
		}
		return size;
	}

	if (Array.isArray(obj)) {
		const size = OVERHEAD.array + obj.length * 8;
		for (const item of obj) stack.push(item);
		return size;
	}

	// ArrayBuffer — count once per buffer (multi-view dedup via `seenBuffers`).
	if (obj instanceof ArrayBuffer) {
		if (seenBuffers.has(obj)) return 0;
		seenBuffers.add(obj);
		return obj.byteLength;
	}
	if (ArrayBuffer.isView(obj)) {
		const view = obj as { byteLength: number; buffer: ArrayBufferLike };
		if (seenBuffers.has(view.buffer)) return 48; // view header only
		seenBuffers.add(view.buffer);
		// Charge the full underlying buffer — a small view over a large
		// buffer still retains all of it. Add the view header on top.
		return view.buffer.byteLength + 48;
	}

	// Plain object — sum key overhead + recurse into values.
	let size = OVERHEAD.object;
	const keys = Object.keys(obj);
	for (const key of keys) {
		size += OVERHEAD.string + key.length * 2;
		try {
			stack.push((obj as Record<string, unknown>)[key]);
		} catch {
			/* getter throw — skip this key */
		}
	}
	return size;
}

/** BigInt digit-count-based sizing: each ~32-bit limb ≈ 8 bytes. */
function _bigintSize(n: bigint): number {
	const abs = n < 0n ? -n : n;
	if (abs === 0n) return 0;
	const bits = abs.toString(2).length;
	return Math.ceil(bits / 32) * 8;
}
