/**
 * External-register helpers — the common `register({emit, error, complete})`
 * contract shared by webhook, MCP, syslog, StatsD, OTel and other callback-
 * based integrations. Absorbs the `active` flag that every such adapter needs
 * to guard against emits after teardown (§5.10 boundary pattern).
 *
 * Two shapes:
 *
 * - {@link externalProducer} — single channel. Lazy activation: the register
 *   fn runs when the node gains its first subscriber; its returned cleanup
 *   runs on deactivation.
 *
 * - {@link externalBundle} — multiple named channels. Eager activation: the
 *   register fn runs at bundle construction time so externally-owned servers
 *   (HTTP endpoints, UDP sockets) start accepting traffic immediately. A
 *   shared refcount fires the returned cleanup once every channel has fully
 *   torn down.
 */

import { batch } from "@graphrefly/pure-ts/core";
import { COMPLETE, DATA, ERROR } from "@graphrefly/pure-ts/core";
import { type Node, type NodeOptions, node } from "@graphrefly/pure-ts/core";

type ExtraOpts = Omit<NodeOptions<unknown>, "describeKind">;

function sourceOpts<T>(opts?: ExtraOpts): NodeOptions<T> {
	return { describeKind: "producer", ...opts } as NodeOptions<T>;
}

/**
 * Standard emit-triad passed to a single-channel external registrar.
 *
 * Post-teardown calls on any of these are automatically no-ops — the
 * registrar does not need its own guard flag.
 *
 * @category extra
 */
export type EmitTriad<T> = {
	/** Emit a value as `DATA`. */
	emit: (value: T) => void;
	/** Terminate with `ERROR`. Subsequent `emit` / `error` / `complete` are ignored. */
	error: (err: unknown) => void;
	/** Terminate with `COMPLETE`. Subsequent `emit` / `error` / `complete` are ignored. */
	complete: () => void;
};

/**
 * Multi-channel emit bundle. Each declared channel name maps to an emit fn;
 * `error` and `complete` terminate every channel atomically.
 *
 * @category extra
 */
export type BundleTriad<TChannels extends Record<string, unknown>> = {
	[K in keyof TChannels]: (value: TChannels[K]) => void;
} & {
	/** Terminate every channel with `ERROR`. */
	error: (err: unknown) => void;
	/** Terminate every channel with `COMPLETE`. */
	complete: () => void;
};

/**
 * Generic external registrator contract. The caller installs handlers into a
 * third-party library / framework / server and optionally returns a cleanup
 * callback. Returning `undefined` / `void` is equivalent to a no-op cleanup.
 *
 * @category extra
 */
export type ExternalRegister<H> = (handlers: H) => (() => void) | undefined;

/**
 * Wraps a callback-style external integration as a reactive source.
 *
 * The registrar installs the supplied `emit` / `error` / `complete` handlers
 * into the external SDK; post-teardown calls are silently dropped. Synchronous
 * exceptions thrown by the registrar surface as terminal `ERROR`.
 *
 * @param register - Installs handlers. Optionally returns a cleanup fn.
 * @param opts - Node options (name, equals, resubscribable, ...).
 *
 * @example
 * ```ts
 * import { externalProducer } from "@graphrefly/graphrefly-ts";
 *
 * const hook$ = externalProducer<Payload>(({ emit, error }) => {
 *   const id = transport.onMessage((raw) => {
 *     try { emit(parse(raw)); } catch (e) { error(e); }
 *   });
 *   return () => transport.off(id);
 * });
 * ```
 *
 * @category extra
 */
export function externalProducer<T = unknown>(
	register: ExternalRegister<EmitTriad<T>>,
	opts?: ExtraOpts,
): Node<T> {
	return node<T>((_data, a) => {
		let active = true;
		const triad: EmitTriad<T> = {
			emit(value) {
				if (!active) return;
				a.emit(value);
			},
			error(err) {
				if (!active) return;
				active = false;
				a.down([[ERROR, err]]);
			},
			complete() {
				if (!active) return;
				active = false;
				a.down([[COMPLETE]]);
			},
		};
		let cleanup: (() => void) | undefined;
		try {
			const ret = register(triad);
			cleanup = typeof ret === "function" ? ret : undefined;
		} catch (err) {
			triad.error(err);
			return () => {
				active = false;
			};
		}
		return () => {
			active = false;
			try {
				cleanup?.();
			} catch {
				/* registrar cleanup failure is not a reactive signal */
			}
		};
	}, sourceOpts(opts));
}

/**
 * Options for {@link externalBundle}.
 *
 * @category extra
 */
export type ExternalBundleOptions<TChannels extends Record<string, unknown>> = {
	/** Base name prefix for channel nodes; each node is named `${name}::${channel}`. */
	name?: string;
	/** Per-channel node options (equals, resubscribable, ...). */
	channelOpts?: { [K in keyof TChannels]?: ExtraOpts };
};

/**
 * Multi-channel variant — one `Node<T>` per named channel, sharing a single
 * registrar. Activation is eager: the registrar runs at construction time so
 * externally-owned servers (HTTP, UDP, queue consumers) can start accepting
 * traffic immediately. The returned cleanup fires once every channel has been
 * subscribed and then fully deactivated (refcount-on-teardown).
 *
 * Any call to `error` or `complete` propagates to every channel atomically.
 *
 * @param register - Installs handlers for each channel plus shared error/complete.
 * @param channels - Ordered channel names; determines the returned object shape.
 * @param opts - Optional name prefix and per-channel node options.
 *
 * @example
 * ```ts
 * import { externalBundle } from "@graphrefly/graphrefly-ts";
 *
 * type OTelChannels = { traces: Span; metrics: Metric; logs: LogRec };
 * const otel = externalBundle<OTelChannels>(
 *   ({ traces, metrics, logs, error }) => {
 *     app.post("/v1/traces",  (req, res) => { traces(req.body);  res.sendStatus(200); });
 *     app.post("/v1/metrics", (req, res) => { metrics(req.body); res.sendStatus(200); });
 *     app.post("/v1/logs",    (req, res) => { logs(req.body);    res.sendStatus(200); });
 *     server.on("error", error);
 *     return () => server.close();
 *   },
 *   ["traces", "metrics", "logs"],
 * );
 * otel.traces.subscribe(...);
 * ```
 *
 * @category extra
 */
export function externalBundle<TChannels extends Record<string, unknown>>(
	register: ExternalRegister<BundleTriad<TChannels>>,
	channels: readonly (keyof TChannels & string)[],
	opts?: ExternalBundleOptions<TChannels>,
): { [K in keyof TChannels]: Node<TChannels[K]> } & { dispose(): void } {
	let active = true;
	let cleanup: (() => void) | undefined;
	let activatedCount = 0;
	let teardownCount = 0;

	const nodes = {} as { [K in keyof TChannels]: Node<TChannels[K]> };
	const channelNodes: Array<Node<unknown>> = [];

	const finishCleanup = () => {
		const fn = cleanup;
		cleanup = undefined;
		try {
			fn?.();
		} catch {
			/* registrar cleanup failure is not a reactive signal */
		}
	};

	for (const ch of channels) {
		const name = opts?.name ? `${opts.name}::${ch}` : ch;
		const chOpts = opts?.channelOpts?.[ch];
		const n = node<TChannels[typeof ch]>(
			(_data, _a) => {
				activatedCount++;
				return () => {
					teardownCount++;
					// Cleanup fires once every channel has activated at least once
					// and then deactivated. Channels that never subscribe do not
					// gate cleanup — use the explicit `.dispose()` method for
					// unconditional teardown.
					if (
						activatedCount > 0 &&
						teardownCount >= activatedCount &&
						teardownCount >= channels.length
					) {
						finishCleanup();
					}
				};
			},
			sourceOpts({ ...chOpts, name }),
		);
		nodes[ch as keyof TChannels] = n as Node<TChannels[typeof ch]>;
		channelNodes.push(n as Node<unknown>);
	}

	const bundle = {} as BundleTriad<TChannels>;
	for (const ch of channels) {
		(bundle as Record<string, unknown>)[ch] = (value: unknown) => {
			if (!active) return;
			(nodes[ch as keyof TChannels] as Node<unknown>).down([[DATA, value]]);
		};
	}
	bundle.error = (err: unknown) => {
		if (!active) return;
		active = false;
		batch(() => {
			for (const n of channelNodes) n.down([[ERROR, err]]);
		});
		finishCleanup();
	};
	bundle.complete = () => {
		if (!active) return;
		active = false;
		batch(() => {
			for (const n of channelNodes) n.down([[COMPLETE]]);
		});
		finishCleanup();
	};

	// Eager activation — register fires at construction time so externally-
	// owned servers can start accepting traffic immediately. Synchronous throws
	// propagate to the caller (no subscribers exist yet, so there is no
	// reactive ERROR path to deliver to). This matches the existing `fromOTel`
	// contract.
	const ret = register(bundle);
	cleanup = typeof ret === "function" ? ret : undefined;

	const dispose = () => {
		if (!active) return;
		active = false;
		// Fire COMPLETE on every channel so downstream sees a clean terminal.
		batch(() => {
			for (const n of channelNodes) {
				try {
					n.down([[COMPLETE]]);
				} catch {
					/* terminal filter / re-entrance — swallow */
				}
			}
		});
		finishCleanup();
	};

	return Object.assign(nodes, { dispose });
}
