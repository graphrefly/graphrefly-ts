/**
 * Status wrapper — surface lifecycle state alongside output.
 *
 * `withStatus` mirrors a source `Node<T>` and produces companion `status` /
 * `error` reactive nodes for UI and meta-snapshot consumers.
 */

import { batch } from "../../core/batch.js";
import { COMPLETE, DATA, DIRTY, ERROR, RESOLVED } from "../../core/messages.js";
import { factoryTag } from "../../core/meta.js";
import { type Node, node } from "../../core/node.js";
import { msgVal, operatorOpts } from "./_internal.js";

export type StatusValue = "pending" | "running" | "completed" | "errored";

export type WithStatusBundle<T> = {
	node: Node<T>;
	status: Node<StatusValue>;
	error: Node<unknown | null>;
};

/**
 * Wraps `src` with `status` and `error` {@link state} companions for UI or meta snapshots.
 *
 * @param src - Upstream node to mirror.
 * @param options - `initialStatus` defaults to `"pending"`.
 * @returns `{ node, status, error }` where `out` is the mirrored stream, `status` is a
 *   reactive `Node<StatusValue>` (`"pending" | "running" | "completed" | "errored"`),
 *   and `error` holds the last `ERROR` payload (cleared to `null` on the next `DATA`
 *   after `errored`).
 *
 * @remarks
 * **Lifecycle:** `pending` (no DATA yet) → `running` (on first DATA) → `completed`
 * (on COMPLETE) or `errored` (on ERROR). After `errored`, the next `DATA` clears
 * `error` and re-enters `running` inside a {@link batch} so subscribers see one
 * consistent transition (matches graphrefly-py).
 *
 * **Producer-pattern visibility:** `out` is built via `node([], fn, …)`, so `src`
 * appears as the source dependency in `describe()` traversal but the `status` /
 * `error` companions are mirrored via subscribe-callback effects — they appear
 * under `out.meta.status` / `out.meta.error` (and as `<name>::__meta__::status`
 * paths in `describe()`) rather than as separate top-level edges. Subscribers
 * to `out` see the throttled DATA stream; `status` / `error` companions may not
 * appear as edges in `describe()` if no consumer subscribes to them (per
 * COMPOSITION-GUIDE §1, push-on-subscribe semantics).
 *
 * **Per-subscribe lifecycle (DF8, 2026-04-29 doc lock).** When the wrapped
 * source is `resubscribable: true` and multiple consumers attach in
 * sequence, each new subscription cycle re-runs the producer fn AND
 * re-emits the initial `pending` + `null` companion DATAs. Downstream
 * subscribers to the `status` / `error` companions see thrash:
 * `pending → running → completed → pending → running …`. This is the
 * intended fresh-cycle semantic (each subscription cycle reports its own
 * lifecycle); consumers that need a "stable" status across cycles should
 * derive a snapshot via a separate `state()` mirror rather than depending
 * on the per-cycle reset.
 *
 * @example
 * ```ts
 * import { withStatus, state } from "@graphrefly/graphrefly-ts";
 *
 * const src = state<number>(0);
 * const { node, status, error } = withStatus(src);
 *
 * status.subscribe((msgs) => console.log("status:", msgs));
 * src.down([[DATA, 42]]); // status → "running"
 * ```
 *
 * @category extra
 */
export function withStatus<T>(
	src: Node<T>,
	options?: { initialStatus?: StatusValue; meta?: Record<string, unknown> },
): WithStatusBundle<T> {
	const initialStatus = options?.initialStatus ?? "pending";
	const callerMeta = options?.meta;

	const out = node<T>(
		[],
		(_deps, a) => {
			let currentStatus: StatusValue = initialStatus;
			out.meta.status.down([[DATA, initialStatus]]);
			out.meta.error.down([[DATA, null]]);

			const unsub = src.subscribe((msgs) => {
				for (const m of msgs) {
					const t = m[0];
					if (t === DIRTY) a.down([[DIRTY]]);
					else if (t === DATA) {
						if (currentStatus === "errored") {
							batch(() => {
								out.meta.error.down([[DATA, null]]);
								out.meta.status.down([[DATA, "running"]]);
								a.emit(m[1] as T);
							});
							currentStatus = "running";
						} else if (currentStatus !== "running") {
							// First DATA after `pending` (or another non-running state):
							// flip status to "running" alongside the DATA emit so external
							// observers see one coherent wave (no torn reads between the
							// status companion and the mirrored stream).
							batch(() => {
								out.meta.status.down([[DATA, "running"]]);
								a.emit(m[1] as T);
							});
							currentStatus = "running";
						} else {
							// A9 (QA fix 2026-05-01): already in "running" — skip the
							// redundant status emit that the previous code did on every
							// DATA. Saves a wave walk per DATA on hot streams (e.g. SSE
							// token streams through withStatus).
							a.emit(m[1] as T);
						}
					} else if (t === RESOLVED) a.down([[RESOLVED]]);
					else if (t === COMPLETE) {
						out.meta.status.down([[DATA, "completed"]]);
						currentStatus = "completed";
						a.down([[COMPLETE]]);
					} else if (t === ERROR) {
						const err = msgVal(m);
						batch(() => {
							out.meta.error.down([[DATA, err]]);
							out.meta.status.down([[DATA, "errored"]]);
						});
						currentStatus = "errored";
						a.down([m]);
					} else a.down([m]);
				}
			});

			return unsub;
		},
		{
			...operatorOpts(),
			meta: {
				...(callerMeta ?? {}),
				status: initialStatus,
				error: null,
				...factoryTag("withStatus", { initialStatus }),
			},
			completeWhenDepsComplete: false,
			resubscribable: true,
			initial: src.cache,
		},
	);

	return {
		node: out,
		status: out.meta.status as Node<StatusValue>,
		error: out.meta.error as Node<unknown | null>,
	};
}
