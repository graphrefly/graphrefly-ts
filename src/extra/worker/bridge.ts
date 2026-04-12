/**
 * workerBridge — main-thread reactive node bridge to a worker.
 *
 * Creates proxy nodes for imported worker nodes, subscribes to exposed
 * nodes and sends values across the wire. Uses derived() + effect() for
 * natural batch coalescing via two-phase push + bitmask resolution.
 *
 * Wire filtering: graph-local signals ({@link isLocalOnly}) stay local;
 * DATA values go through the coalescing path; RESOLVED, COMPLETE, ERROR,
 * TEARDOWN, and unknown {@link Symbol.for} types go through the signal
 * subscription.
 *
 * Handshake:
 *   1. Main creates bridge, starts listening
 *   2. Worker sends { t: 'r', stores: { name: initialValue, ... } }
 *   3. Main creates proxy nodes, marks meta.status "connected"
 *   4. Main sends { t: 'i', stores: { name: currentValue, ... } }
 *   5. Bidirectional value flow begins
 */

import { batch } from "../../core/batch.js";
import { DATA, ERROR, type Messages, TEARDOWN } from "../../core/messages.js";
import { type Node, type NodeSink, defaultConfig } from "../../core/node.js";
import { derived, effect, state } from "../../core/sugar.js";
import type { BatchMessage, BridgeMessage } from "./protocol.js";
import { deserializeError, nameToSignal, serializeError, signalToName } from "./protocol.js";
import type { WorkerTransport } from "./transport.js";
import { createTransport } from "./transport.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkerBridgeOptions<
	TExpose extends Record<string, Node<any>>,
	TImport extends readonly string[],
> {
	/** Nodes to send to the worker. */
	expose?: TExpose;
	/** Node names the worker will provide. */
	import?: TImport;
	/** Per-node transferable extractors for zero-copy ArrayBuffer passing. */
	transfer?: Partial<Record<keyof TExpose, (value: any) => Transferable[]>>;
	/** Debug name. */
	name?: string;
	/**
	 * Handshake timeout in milliseconds. If the worker doesn't send READY
	 * within this window, `meta.status` transitions to `"closed"` and
	 * `meta.error` is set. Default: no timeout.
	 */
	timeoutMs?: number;
}

/** Proxy nodes created from imported worker node names. */
type ImportedNodes<T extends readonly string[]> = {
	readonly [K in T[number]]: Node<any>;
};

export type WorkerBridge<
	_TExpose extends Record<string, Node<any>>,
	TImport extends readonly string[],
> = ImportedNodes<TImport> & {
	/** Connection status meta node. */
	meta: {
		status: Node<"connecting" | "connected" | "closed">;
		error: Node<Error | null>;
	};
	/** Destroy the bridge: sends TEARDOWN, disconnects, terminates worker. */
	destroy(): void;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

function isTransport(t: unknown): t is WorkerTransport {
	return (
		typeof t === "object" &&
		t !== null &&
		typeof (t as any).post === "function" &&
		typeof (t as any).listen === "function"
	);
}

export function workerBridge<
	TExpose extends Record<string, Node<any>>,
	TImport extends readonly string[],
>(
	target: unknown | WorkerTransport,
	opts: WorkerBridgeOptions<TExpose, TImport>,
): WorkerBridge<TExpose, TImport> {
	const transport = isTransport(target) ? target : createTransport(target);
	const bridgeName = opts.name ?? "workerBridge";
	const exposeEntries = Object.entries(opts.expose ?? {});
	const importNames = (opts.import ?? []) as readonly string[];
	const transferFns = opts.transfer ?? {};

	// -- Meta: connection status -----------------------------------------------
	const statusNode = state<"connecting" | "connected" | "closed">("connecting", {
		name: `${bridgeName}::meta::status`,
	});
	const errorNode = state<Error | null>(null, {
		name: `${bridgeName}::meta::error`,
	});

	// -- Proxy nodes for imports (worker -> main) ------------------------------
	const proxyNodes = new Map<string, Node<any>>();
	const lastSeenImportVersions = new Map<string, number>();
	for (const name of importNames) {
		const proxy = state(undefined, { name: `${bridgeName}::${name}` });
		proxyNodes.set(name, proxy);
	}

	// -- Send coalescing via derived + effect ----------------------------------
	const lastSent = new Map<string, unknown>();
	let effectUnsub: (() => void) | undefined;

	if (exposeEntries.length > 0) {
		const exposedNodes = exposeEntries.map(([, n]) => n);

		const aggregated = derived(
			exposedNodes,
			() => {
				const updates: Record<string, unknown> = {};
				for (const [name, n] of exposeEntries) {
					const v = n.cache;
					if (v !== lastSent.get(name)) {
						updates[name] = v;
						lastSent.set(name, v);
					}
				}
				return updates;
			},
			{ equals: () => false, name: `${bridgeName}::aggregated` },
		);

		const effectNode = effect([aggregated], (data) => {
			const updates = (data[0] ?? aggregated.cache) as Record<string, unknown>;
			if (Object.keys(updates).length === 0) return;

			const transferList: Transferable[] = [];
			for (const name of Object.keys(updates)) {
				const fn = (transferFns as any)[name];
				if (fn) transferList.push(...fn(updates[name]));
			}

			// V0 delta sync: include version counters when available (§6.0b).
			let versions: Record<string, number> | undefined;
			for (const [name, n] of exposeEntries) {
				if (name in updates && n.v != null) {
					if (versions == null) versions = {};
					versions[name] = n.v.version;
				}
			}
			const msg: BatchMessage = { t: "b", u: updates, ...(versions ? { v: versions } : {}) };
			try {
				transport.post(msg, transferList.length > 0 ? transferList : undefined);
			} catch (err) {
				errorNode.down([[DATA, err instanceof Error ? err : new Error(String(err))]]);
			}
		});
		// Effect nodes are lazy — subscribe to activate the chain
		effectUnsub = effectNode.subscribe(() => {});
	}

	// -- Receive handler -------------------------------------------------------
	let destroyed = false;

	const unlisten = transport.listen((data) => {
		if (destroyed) return;
		const msg = data as BridgeMessage;

		switch (msg.t) {
			// Worker ready — set proxy nodes with initial values
			case "r": {
				if (handshakeTimer !== undefined) clearTimeout(handshakeTimer);
				batch(() => {
					for (const [name, value] of Object.entries(msg.stores)) {
						const proxy = proxyNodes.get(name);
						if (proxy) proxy.down([[DATA, value]]);
					}
				});
				statusNode.down([[DATA, "connected"]]);

				// Send initial values of exposed nodes
				const initValues: Record<string, unknown> = {};
				for (const [name, n] of exposeEntries) {
					initValues[name] = n.cache;
					lastSent.set(name, initValues[name]);
				}
				transport.post({ t: "i", stores: initValues } satisfies BridgeMessage);
				break;
			}

			// Single value update from worker
			case "v": {
				const proxy = proxyNodes.get(msg.s);
				if (proxy) proxy.down([[DATA, msg.d]]);
				break;
			}

			// Batch value update from worker
			case "b": {
				batch(() => {
					for (const [name, value] of Object.entries(msg.u)) {
						const incomingVersion = msg.v?.[name];
						if (incomingVersion != null) {
							const lastSeen = lastSeenImportVersions.get(name);
							if (lastSeen != null && incomingVersion <= lastSeen) continue;
							lastSeenImportVersions.set(name, incomingVersion);
						}
						const proxy = proxyNodes.get(name);
						if (proxy) proxy.down([[DATA, value]]);
					}
				});
				break;
			}

			// Error from worker node
			case "e": {
				const proxy = proxyNodes.get(msg.s);
				if (proxy) proxy.down([[ERROR, deserializeError(msg.err)]]);
				break;
			}

			// Lifecycle signal from worker
			case "s": {
				const sig = nameToSignal(msg.sig);
				if (!sig) break;

				const targets: Node<any>[] =
					msg.s === "*"
						? [...proxyNodes.values()]
						: proxyNodes.has(msg.s)
							? [proxyNodes.get(msg.s)!]
							: [];

				for (const proxy of targets) {
					proxy.down((msg.d === undefined ? [[sig]] : [[sig, msg.d]]) as Messages);
				}
				break;
			}
		}
	});

	// -- Subscribe to exposed nodes: forward tier >= 3 messages -----------------
	const exposeUnsubs: Array<() => void> = [];
	for (const [name, n] of exposeEntries) {
		const unsub = n.subscribe(((msgs: Messages) => {
			if (destroyed) return;
			for (const m of msgs) {
				const type = m[0] as symbol;
				// DATA goes through the coalescing path — skip here
				if (type === DATA) continue;
				// Block graph-local signals (START, DIRTY, INVALIDATE, PAUSE, RESUME).
				// Unknown types forward (spec §1.3.6).
				if (defaultConfig.isLocalOnly(type)) continue;
				// ERROR: serialize payload
				if (type === ERROR) {
					transport.post({
						t: "e",
						s: name,
						err: serializeError(m[1]),
					} satisfies BridgeMessage);
				} else {
					// RESOLVED, COMPLETE, TEARDOWN, and unknown Symbol.for types
					transport.post({
						t: "s",
						s: name,
						sig: signalToName(type),
						d: m.length > 1 ? m[1] : undefined,
					} satisfies BridgeMessage);
				}
			}
		}) as NodeSink);
		exposeUnsubs.push(unsub);
	}

	// -- Handshake timeout -----------------------------------------------------
	let handshakeTimer: ReturnType<typeof setTimeout> | undefined;
	if (opts.timeoutMs != null && opts.timeoutMs > 0) {
		handshakeTimer = setTimeout(() => {
			if (statusNode.cache === "connecting") {
				errorNode.down([[DATA, new Error("Worker bridge handshake timeout")]]);
				destroy();
			}
		}, opts.timeoutMs);
	}

	// -- Build result object ---------------------------------------------------
	function destroy() {
		if (destroyed) return;
		destroyed = true;

		if (handshakeTimer !== undefined) clearTimeout(handshakeTimer);

		// Send bridge-level TEARDOWN to worker
		transport.post({
			t: "s",
			s: "*",
			sig: signalToName(TEARDOWN),
		} satisfies BridgeMessage);

		// Cleanup: unsub effect first (stops sending), then unsub expose
		// listeners, then unlisten on transport
		if (effectUnsub) effectUnsub();
		for (const unsub of exposeUnsubs) unsub();
		exposeUnsubs.length = 0;
		unlisten();

		statusNode.down([[DATA, "closed"]]);

		lastSent.clear();
		lastSeenImportVersions.clear();
		proxyNodes.clear();
	}

	const result: any = {
		meta: { status: statusNode, error: errorNode },
		destroy,
	};

	// Attach proxy nodes as properties
	for (const [name, proxy] of proxyNodes) {
		result[name] = proxy;
	}

	return result as WorkerBridge<TExpose, TImport>;
}
