/**
 * Push-notification reactive source (universal — transport-agnostic).
 *
 * `fromPushNotification` turns host-delivered push messages (FCM / APNS /
 * Expo push / Web Push / a NestJS gateway fan-out — any transport) into a
 * reactive `Node<T>`. It is the sanctioned async/external boundary for the
 * two-reactive-island architecture: a mobile/web island and a backend island,
 * each reactive internally, with push as the transport between them (spec
 * §5.10 — async boundaries live in sources, NOT in node fns/operators; this
 * is the same shape as `fromEvent`, not an imperative trigger into the graph).
 *
 * The native/network bridge stays entirely inside the host-supplied
 * `register` callback — this primitive owns only the reactive emission and
 * teardown, so it carries zero `node:*` / DOM / SDK dependency and is
 * Hermes-safe by construction.
 */

import { type Node, type NodeOptions, node } from "@graphrefly/pure-ts/core";

type ExtraOpts = Omit<NodeOptions, "describeKind">;

function sourceOpts<T = unknown>(opts?: ExtraOpts): NodeOptions<T> {
	return { describeKind: "producer", ...opts } as NodeOptions<T>;
}

/** Tears down a push registration (remove listener, close channel, abort). */
export type PushUnsubscribe = () => void;

/**
 * Host registration callback for {@link fromPushNotification}.
 *
 * Called once on node activation with a `deliver` sink. Wire your push
 * transport here and call `deliver(payload)` for **each** incoming message.
 * Return a {@link PushUnsubscribe} (or nothing if there is no teardown).
 *
 * Any async/native setup belongs **inside** this callback (spec §5.10). The
 * returned unsubscribe must be synchronous; if your SDK registration is
 * async, kick it off here and return a function that aborts/detaches it
 * (the async boundary stays in the host, not in the reactive layer).
 */
export type PushRegister<T> = (deliver: (payload: T) => void) => PushUnsubscribe | void;

/**
 * Wraps a host push transport; each delivered message becomes a `DATA`
 * emission. Teardown invokes the registration's unsubscribe.
 *
 * @param register - Called on activation with a `deliver(payload)` sink;
 *   returns an optional unsubscribe.
 * @param opts - Producer node options (`name`, `meta`, …).
 * @returns `Node<T>` — push payloads as a reactive stream.
 *
 * @example
 * ```ts
 * import { fromPushNotification } from "@graphrefly/graphrefly";
 *
 * // memo:Re premium backend — opt-in cloud audit pushed (not polled).
 * const auditPushes = fromPushNotification<AuditEvent>((deliver) => {
 *   const sub = messaging.onMessage((msg) => deliver(msg.data as AuditEvent));
 *   return () => sub.remove();
 * });
 * ```
 *
 * @remarks
 * A synchronous throw inside `register` propagates as an activation failure
 * (it is not caught here) — same shape as `fromEvent`. Push transports are
 * open-ended: this source never emits `COMPLETE`/`ERROR` on its own; the
 * stream ends only via `onDeactivation` (unsubscribe). Surface a terminal
 * yourself (e.g. compose a downstream operator) if the host needs one.
 *
 * @category extra
 */
export function fromPushNotification<T = unknown>(
	register: PushRegister<T>,
	opts?: ExtraOpts,
): Node<T> {
	if (typeof register !== "function") {
		throw new TypeError(
			"fromPushNotification: a (deliver) => unsubscribe registration function is required",
		);
	}
	return node<T>((_data, a) => {
		let done = false;
		const deliver = (payload: T) => {
			if (done) return;
			a.emit(payload);
		};
		const unsubscribe = register(deliver);
		return {
			onDeactivation: () => {
				done = true;
				if (typeof unsubscribe === "function") unsubscribe();
			},
		};
	}, sourceOpts(opts));
}
