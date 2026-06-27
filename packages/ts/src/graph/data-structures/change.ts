/**
 * Delta-event payloads for the reactive data structures (CSP-2.8, D54/D60).
 *
 * Each reactive structure has a DELTA port (an always-on push stream, D60) that emits ONE of
 * these change payloads per mutation (O(1)/mutation). The SNAPSHOT port (a lazy pull-mode node)
 * carries the materialized state instead — see {@link collectionCore}. These are the structure-
 * specific verbs; the delta stream emits the raw payload (no envelope — version/timestamp/audit
 * framing is a storage concern, D57, layered separately if needed).
 *
 * Per-language (D6/D24, never in parity, no conformance). Canonical authority:
 * ~/src/graphrefly/decisions/decisions.jsonl D54/D60.
 */

/** List structure delta events. */
export type ListChange<T> =
	| { readonly kind: "append"; readonly value: T }
	| { readonly kind: "appendMany"; readonly values: readonly T[] }
	| { readonly kind: "insert"; readonly index: number; readonly value: T }
	| { readonly kind: "insertMany"; readonly index: number; readonly values: readonly T[] }
	| { readonly kind: "pop"; readonly index: number; readonly value: T }
	| { readonly kind: "trimHead"; readonly n: number }
	| { readonly kind: "clear"; readonly count: number };

/**
 * Map structure delta events. `delete.reason` distinguishes the four delete sources (D60 #3c):
 * an explicit `.delete`, a TTL `expired` read-prune, an `lru-evict` under `maxSize`, or an
 * `archived` retention sweep.
 */
export type MapChange<K, V> =
	| { readonly kind: "set"; readonly key: K; readonly value: V }
	| {
			readonly kind: "delete";
			readonly key: K;
			readonly previous: V;
			readonly reason: "expired" | "lru-evict" | "archived" | "explicit";
	  }
	| { readonly kind: "clear"; readonly count: number };

/** Dual-key index structure delta events. */
export type IndexChange<K, V> =
	| { readonly kind: "upsert"; readonly primary: K; readonly secondary: unknown; readonly value: V }
	| { readonly kind: "delete"; readonly primary: K }
	| { readonly kind: "deleteMany"; readonly primaries: readonly K[] }
	| { readonly kind: "clear"; readonly count: number };

/** Append-only log structure delta events. */
export type LogChange<T> =
	| { readonly kind: "append"; readonly value: T }
	| { readonly kind: "appendMany"; readonly values: readonly T[] }
	| { readonly kind: "clear"; readonly count: number }
	| { readonly kind: "trimHead"; readonly n: number };
