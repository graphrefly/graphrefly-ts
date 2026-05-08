/**
 * `catalogAwareEvaluator` — adapt a `runEvalSuite(catalog, candidate,
 * dataset)` callable into a reactive `Evaluator<T>` that subscribes to
 * a {@link CatalogOverlayBundle.effective} so the eval runs against the
 * post-actuation catalog state every time.
 *
 * Dogfood-only — lives in `evals/lib/` because it bridges
 * `actuatorExecutor` + `catalogOverlay` to `evalVerifier` for the
 * catalog-automation experiment. Library users with simpler scoring
 * (no overlay involvement) can pass an `Evaluator<T>` to `evalVerifier`
 * directly.
 *
 * **Why a composer.** `evalVerifier` accepts an `Evaluator<T>` whose
 * shape is `(candidates, dataset) => Node<EvalResult[]>`. For the
 * dogfood, the eval suite ALSO needs the catalog (to compile a spec
 * against). This composer reads the catalog reactively from the
 * overlay so a fresh upsert in EXECUTE flows through to a re-run
 * in VERIFY without any imperative re-binding.
 *
 * @module
 */

import { COMPLETE, DATA, ERROR, type Messages } from "../../packages/pure-ts/src/core/messages.js";
import { type Node, node } from "../../packages/pure-ts/src/core/node.js";
import type { GraphSpecCatalog } from "../../packages/pure-ts/src/patterns/graphspec/index.js";
import type {
	DatasetItem,
	EvalResult,
	Evaluator,
} from "../../packages/pure-ts/src/patterns/refine-loop/index.js";
import type { CatalogOverlayBundle } from "./catalog-overlay.js";

/**
 * The hand-rolled scoring callable a catalog-aware evaluator wraps.
 * `runEvalSuite` is whatever produces per-task scores given the live
 * catalog state, the candidate batch, and the dataset rows. Async
 * because eval suites typically `compileSpec(spec, catalog)` and run
 * async work (LLM judges, structural checks, IO).
 */
export type RunEvalSuite<T> = (input: {
	readonly catalog: GraphSpecCatalog;
	readonly candidates: readonly T[];
	readonly dataset: readonly DatasetItem[];
	readonly signal: AbortSignal;
}) => Promise<readonly EvalResult[]>;

/** Configuration for {@link catalogAwareEvaluator}. */
export interface CatalogAwareEvaluatorConfig<T> {
	overlay: CatalogOverlayBundle;
	runEvalSuite: RunEvalSuite<T>;
	/** Node name prefix for `describe()`. Default `"catalog-aware-evaluator"`. */
	name?: string;
}

/**
 * Build an `Evaluator<T>` whose returned node re-runs `runEvalSuite`
 * each time `candidates` or `dataset` settles. **The overlay is read
 * via snapshot, not subscribed reactively.** This is intentional: when
 * paired with `autoSolidify` (which writes to the same overlay on
 * `verified: true`), a reactive subscription would create a feedback
 * cycle — solidify writes → overlay settles → re-eval → re-verify
 * → solidify writes again. The snapshot-on-settle shape captures the
 * post-actuation overlay state at the moment scoring fires (the
 * actuator has already committed by then) and ignores subsequent
 * solidify-driven mutations until the next executeContext wave.
 *
 * `overlay.effective.cache` is the snapshot read. The overlay's
 * derived is eager (no subscriber needed to keep it warm here because
 * the producer node activates with at least one upstream subscriber
 * via the harness's verifyNode), and the snapshot is taken at the
 * moment of `recompute`.
 *
 * **Caller invariant: overlay must be settled before activation.** The
 * `recompute` early-returns when `overlay.effective.cache == null` and
 * does NOT subscribe for retry — it relies on the next `candidates` /
 * `dataset` wave to retry. The dogfood `actuatorExecutor` path
 * guarantees this because the actuator commits to the overlay
 * synchronously inside `apply` BEFORE the verifier mounts its inner
 * subgraph, so by the time this evaluator activates the overlay's
 * `effective` derived has already settled. Callers whose overlay
 * populates asynchronously (e.g. `fileStorage`-backed init) must
 * await overlay settlement before publishing the first item, OR
 * rebuild this evaluator after the overlay's first settle.
 *
 * The producer mints a per-call `AbortController` so a superseding
 * wave cancels in-flight scoring before a new run starts.
 *
 * @example Wire as the verifier's evaluator inside the dogfood harness.
 * ```ts
 * const overlay = catalogOverlay({ base: portableCatalog });
 * const evaluator = catalogAwareEvaluator<CatalogPatch>({
 *   overlay,
 *   async runEvalSuite({ catalog, candidates, dataset, signal }) {
 *     return scoreCatalog(catalog, candidates, dataset, signal);
 *   },
 * });
 * harnessLoop("catalog-repair", {
 *   adapter,
 *   executor: actuatorExecutor<CatalogPatch>({
 *     apply: (item) => overlay.applyPatch(patchFromItem(item)),
 *   }),
 *   verifier: evalVerifier<CatalogPatch>({
 *     evaluator,
 *     datasetFor,
 *   }),
 * });
 * ```
 */
export function catalogAwareEvaluator<T>(config: CatalogAwareEvaluatorConfig<T>): Evaluator<T> {
	const name = config.name ?? "catalog-aware-evaluator";
	return (
		candidates: Node<readonly T[]>,
		dataset: Node<readonly DatasetItem[]>,
	): Node<readonly EvalResult[]> => {
		return node<readonly EvalResult[]>(
			(_data, actions) => {
				let latestCandidates: readonly T[] | null = null;
				let latestDataset: readonly DatasetItem[] | null = null;
				let pending: AbortController | null = null;
				// Keep the overlay's effective node "warm" without driving
				// recompute on overlay settles — pulled via `.cache` per scoring
				// wave. Without an active subscriber the overlay's derived
				// would never settle. Empty-callback subscribe is the lightest
				// keepalive that doesn't close the feedback loop.
				const overlayKeepalive = config.overlay.effective.subscribe(() => {});

				const recompute = (): void => {
					if (latestCandidates == null || latestDataset == null) {
						return;
					}
					const catalog = config.overlay.effective.cache;
					if (catalog == null) {
						// Effective catalog hasn't settled yet — wait for the
						// next dep wave.
						return;
					}
					pending?.abort();
					const ac = new AbortController();
					pending = ac;
					const cap = {
						catalog,
						candidates: latestCandidates,
						dataset: latestDataset,
					};
					config
						.runEvalSuite({
							catalog: cap.catalog as GraphSpecCatalog,
							candidates: cap.candidates,
							dataset: cap.dataset,
							signal: ac.signal,
						})
						.then((scores) => {
							if (ac.signal.aborted) return;
							actions.down([[DATA, scores]] satisfies Messages);
						})
						.catch((err) => {
							if (ac.signal.aborted) return;
							actions.down([[ERROR, err]] satisfies Messages);
						});
				};

				let teardownCalled = false;
				const tearDown = (): void => {
					if (teardownCalled) return;
					teardownCalled = true;
					pending?.abort();
					overlayKeepalive();
					unsubCands();
					unsubDs();
				};
				const unsubCands = candidates.subscribe((batch) => {
					if (teardownCalled) return;
					for (const m of batch) {
						if (m[0] === DATA && m[1] != null) {
							latestCandidates = m[1] as readonly T[];
							recompute();
						}
						if (m[0] === COMPLETE) {
							// Forward COMPLETE and tear down upstream subscriptions
							// proactively — relying on downstream unsub leaves the
							// overlay keepalive + dataset subscription pinned.
							actions.down([[COMPLETE]] satisfies Messages);
							tearDown();
							return;
						}
					}
				});
				const unsubDs = dataset.subscribe((batch) => {
					if (teardownCalled) return;
					for (const m of batch) {
						if (m[0] === DATA && m[1] != null) {
							latestDataset = m[1] as readonly DatasetItem[];
							recompute();
						}
					}
				});

				return () => {
					tearDown();
				};
			},
			{ describeKind: "producer", name },
		);
	};
}
