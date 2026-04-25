/**
 * `catalogOverlay` — reactive overlay layer over the static
 * `portableCatalog` so `actuatorExecutor` can write new fn / source /
 * template entries during the EXECUTE stage and have them read through
 * to `compileSpec` (or any catalog consumer) during VERIFY.
 *
 * Dogfood-only — lives in `evals/lib/` because the catalog overlay is a
 * specific shape for the catalog-automation experiment described in
 * `archive/docs/SESSION-ai-harness-module-review.md` and the harness
 * memory item `project_harness_closed_loop_gap`. The library primitive
 * (`actuatorExecutor` in `src/patterns/harness/`) is generic; this file
 * is the dogfood composer that wires it to our catalog data.
 *
 * **Closed-loop topology** the overlay enables:
 *
 *     intake → triage → queue → gate → EXECUTE (actuator writes overlay)
 *                                       └─ ExecuteOutput.artifact = CatalogPatch
 *                              VERIFY (evalVerifier reads overlay.effective and re-scores)
 *
 * The overlay is reactive so the verifier subscription sees the
 * post-actuation world atomically — no file-system poll, no race
 * between write-and-read.
 *
 * @module
 */

import type { Node } from "../../src/core/node.js";
import { derived } from "../../src/core/sugar.js";
import { type ReactiveMapBundle, reactiveMap } from "../../src/extra/reactive-map.js";
import type {
	CatalogFnEntry,
	CatalogSourceEntry,
	GraphSpecCatalog,
	GraphSpecTemplate,
} from "../../src/patterns/graphspec/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single mutation an actuator may apply to the overlay. The actuator
 * returns this as `ExecuteOutput.artifact` so the verifier can introspect
 * what changed without snapshotting the entire catalog.
 */
export type CatalogPatch =
	| {
			readonly kind: "fn-upsert";
			readonly name: string;
			readonly entry: CatalogFnEntry;
	  }
	| {
			readonly kind: "fn-delete";
			readonly name: string;
	  }
	| {
			readonly kind: "source-upsert";
			readonly name: string;
			readonly entry: CatalogSourceEntry;
	  }
	| {
			readonly kind: "source-delete";
			readonly name: string;
	  }
	| {
			readonly kind: "template-upsert";
			readonly name: string;
			readonly template: GraphSpecTemplate;
	  }
	| {
			readonly kind: "template-delete";
			readonly name: string;
	  };

/** Options for {@link catalogOverlay}. */
export interface CatalogOverlayOptions {
	/**
	 * Read-only base catalog. Overlay entries shadow base entries with
	 * the same name; deletes shadow base entries (i.e. the effective
	 * catalog won't include the base entry while a delete-marker is
	 * present in the overlay).
	 */
	base?: GraphSpecCatalog;
	/**
	 * Base templates. Same shadowing semantics as the catalog.
	 * `compileSpec` looks up templates inside `GraphSpec.templates`, but
	 * we surface a separate overlay so dogfood actuators can mutate the
	 * library template registry independently of any one spec.
	 */
	baseTemplates?: Record<string, GraphSpecTemplate>;
}

/** Reactive overlay bundle returned by {@link catalogOverlay}. */
export interface CatalogOverlayBundle {
	/** Live overlay map for fn entries (overrides + tombstones). */
	readonly fnOverrides: ReactiveMapBundle<string, CatalogFnEntry | TombstoneMarker>;
	/** Live overlay map for source entries. */
	readonly sourceOverrides: ReactiveMapBundle<string, CatalogSourceEntry | TombstoneMarker>;
	/** Live overlay map for templates. */
	readonly templateOverrides: ReactiveMapBundle<string, GraphSpecTemplate | TombstoneMarker>;
	/**
	 * Effective catalog node — `derived` over the three overlay maps
	 * + the immutable base. Re-emits exactly when any overlay layer
	 * structurally changes.
	 */
	readonly effective: Node<GraphSpecCatalog>;
	/**
	 * Effective templates node — same shape as `effective`, separate
	 * because templates are not part of `GraphSpecCatalog`.
	 */
	readonly effectiveTemplates: Node<Record<string, GraphSpecTemplate>>;
	/**
	 * Apply a patch to the overlay. Returns the patch unchanged so an
	 * actuator's `apply` can do `return overlay.applyPatch(patch)` and
	 * have the patch flow through as `ExecuteOutput.artifact`.
	 */
	applyPatch(patch: CatalogPatch): CatalogPatch;
	/** Convenience: write or replace a fn entry. */
	upsertFn(name: string, entry: CatalogFnEntry): CatalogPatch;
	/** Convenience: write or replace a source entry. */
	upsertSource(name: string, entry: CatalogSourceEntry): CatalogPatch;
	/** Convenience: write or replace a template. */
	upsertTemplate(name: string, template: GraphSpecTemplate): CatalogPatch;
	/** Reset all overlay layers (does NOT touch base). */
	reset(): void;
	/** Release any internal subscriptions. */
	dispose(): void;
}

/**
 * Tombstone marker used in overlay maps to express "this base entry is
 * shadowed/deleted". Kept distinct from `undefined` so the overlay can
 * tell "no override registered" (key absent from map) from "explicit
 * delete" (tombstone present).
 */
export interface TombstoneMarker {
	readonly $$tombstone: true;
}

const TOMBSTONE: TombstoneMarker = { $$tombstone: true };

function isTombstone(v: unknown): v is TombstoneMarker {
	return typeof v === "object" && v !== null && (v as TombstoneMarker).$$tombstone === true;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build a {@link CatalogOverlayBundle} layered over an immutable base
 * catalog and template registry. Mutations land in the reactive overlay
 * maps; the `effective` / `effectiveTemplates` nodes recompute on each
 * structural change.
 *
 * @example Wire into the harness as the EXECUTE actuator + VERIFY substrate.
 * ```ts
 * import { portableCatalog, portableTemplates } from "./portable-catalog.js";
 * const overlay = catalogOverlay({
 *   base: portableCatalog,
 *   baseTemplates: portableTemplates,
 * });
 *
 * const harness = harnessLoop("catalog-repair", {
 *   adapter,
 *   executor: actuatorExecutor<CatalogPatch>({
 *     apply: (item) => overlay.applyPatch(patchFromItem(item)),
 *     shouldApply: (item) => item.intervention === "catalog-fn",
 *   }),
 *   verifier: evalVerifier<CatalogPatch>({
 *     evaluator: (cands, ds) => runEvalAgainstOverlay(overlay.effective, cands, ds),
 *     datasetFor,
 *   }),
 * });
 * ```
 */
export function catalogOverlay(options: CatalogOverlayOptions = {}): CatalogOverlayBundle {
	const baseFns = options.base?.fns ?? {};
	const baseSources = options.base?.sources ?? {};
	const baseTemplates = options.baseTemplates ?? {};

	const fnOverrides = reactiveMap<string, CatalogFnEntry | TombstoneMarker>();
	const sourceOverrides = reactiveMap<string, CatalogSourceEntry | TombstoneMarker>();
	const templateOverrides = reactiveMap<string, GraphSpecTemplate | TombstoneMarker>();

	const effective = derived<GraphSpecCatalog>(
		[fnOverrides.entries as Node<unknown>, sourceOverrides.entries as Node<unknown>],
		([fnLive, sourceLive]) => {
			return {
				fns: mergeRecord(baseFns, fnLive as ReadonlyMap<string, CatalogFnEntry | TombstoneMarker>),
				sources: mergeRecord(
					baseSources,
					sourceLive as ReadonlyMap<string, CatalogSourceEntry | TombstoneMarker>,
				),
			};
		},
		{ name: "catalog-overlay/effective" },
	);

	const effectiveTemplates = derived<Record<string, GraphSpecTemplate>>(
		[templateOverrides.entries as Node<unknown>],
		([live]) =>
			mergeRecord(baseTemplates, live as ReadonlyMap<string, GraphSpecTemplate | TombstoneMarker>),
		{ name: "catalog-overlay/effective-templates" },
	);

	const applyPatch = (patch: CatalogPatch): CatalogPatch => {
		switch (patch.kind) {
			case "fn-upsert":
				fnOverrides.set(patch.name, patch.entry);
				return patch;
			case "fn-delete":
				fnOverrides.set(patch.name, TOMBSTONE);
				return patch;
			case "source-upsert":
				sourceOverrides.set(patch.name, patch.entry);
				return patch;
			case "source-delete":
				sourceOverrides.set(patch.name, TOMBSTONE);
				return patch;
			case "template-upsert":
				templateOverrides.set(patch.name, patch.template);
				return patch;
			case "template-delete":
				templateOverrides.set(patch.name, TOMBSTONE);
				return patch;
		}
	};

	return {
		fnOverrides,
		sourceOverrides,
		templateOverrides,
		effective,
		effectiveTemplates,
		applyPatch,
		upsertFn(name, entry) {
			return applyPatch({ kind: "fn-upsert", name, entry });
		},
		upsertSource(name, entry) {
			return applyPatch({ kind: "source-upsert", name, entry });
		},
		upsertTemplate(name, template) {
			return applyPatch({ kind: "template-upsert", name, template });
		},
		reset() {
			fnOverrides.clear();
			sourceOverrides.clear();
			templateOverrides.clear();
		},
		dispose() {
			fnOverrides.dispose();
			sourceOverrides.dispose();
			templateOverrides.dispose();
		},
	};
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Merge a static base record with a reactive override map. Tombstone
 * markers in the overlay shadow base entries with the same key.
 */
function mergeRecord<V>(
	base: Record<string, V>,
	overrides: ReadonlyMap<string, V | TombstoneMarker>,
): Record<string, V> {
	const out: Record<string, V> = { ...base };
	for (const [k, v] of overrides) {
		if (isTombstone(v)) {
			delete out[k];
			continue;
		}
		out[k] = v as V;
	}
	return out;
}
