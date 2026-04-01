/**
 * workerSelf — worker-side reactive node bridge.
 *
 * Mirror of workerBridge() for the worker side. Creates proxy nodes for
 * imports from main thread, exposes local nodes via the same wire protocol.
 * Uses derived() + effect() for batch coalescing.
 *
 * Wire filtering: messages with {@link messageTier} >= 2 cross the wire.
 * DATA values go through the coalescing path; RESOLVED, COMPLETE, ERROR,
 * TEARDOWN, and unknown {@link Symbol.for} types go through the signal
 * subscription. Tier 0–1 (DIRTY, INVALIDATE, PAUSE, RESUME) stay local.
 *
 * Handshake (worker perspective):
 *   1. workerSelf() called — creates proxy nodes for imports
 *   2. Runs expose factory with proxy nodes -> gets nodes to expose
 *   3. Sends { t: 'r', stores: { name: initialValue, ... } } to main
 *   4. Receives { t: 'i', stores: { name: value, ... } } from main
 *   5. Updates proxy nodes -> triggers local effects
 */

import { batch } from "../../core/batch.js";
import {
	DATA,
	ERROR,
	knownMessageTypes,
	type Messages,
	messageTier,
	TEARDOWN,
} from "../../core/messages.js";
import type { Node, NodeSink } from "../../core/node.js";
import { derived, effect, state } from "../../core/sugar.js";
import type { BatchMessage, BridgeMessage } from "./protocol.js";
import { deserializeError, nameToSignal, serializeError, signalToName } from "./protocol.js";
import type { WorkerTransport } from "./transport.js";
import { createTransport } from "./transport.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkerSelfOptions<TImport extends readonly string[]> {
	/** Node names that the main thread will provide. */
	import?: TImport;
	/** Factory that receives imported proxy nodes and returns nodes to expose. */
	expose: (imported: WorkerImported<TImport>) => Record<string, Node<any>>;
	/** Per-node transferable extractors for zero-copy ArrayBuffer passing. */
	transfer?: Record<string, (value: any) => Transferable[]>;
}

/** Proxy nodes available inside the worker from main-thread exposed nodes. */
type WorkerImported<T extends readonly string[]> = {
	readonly [K in T[number]]: Node<any>;
};

export interface WorkerSelfHandle {
	/** Dispose all subscriptions and stop the bridge. */
	destroy(): void;
}

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

export function workerSelf<TImport extends readonly string[]>(
	target: unknown | WorkerTransport,
	opts: WorkerSelfOptions<TImport>,
): WorkerSelfHandle {
	const transport = isTransport(target) ? target : createTransport(target);
	const importNames = (opts.import ?? []) as readonly string[];
	const transferFns = opts.transfer ?? {};

	// -- Proxy nodes for imports (main -> worker) ------------------------------
	const proxyNodes = new Map<string, Node<any>>();
	const lastSeenImportVersions = new Map<string, number>();
	const importedObj: any = {};
	for (const name of importNames) {
		const s = state(undefined, { name: `worker::${name}` });
		proxyNodes.set(name, s);
		importedObj[name] = s;
	}

	// -- Run expose factory ----------------------------------------------------
	const exposedNodes = opts.expose(importedObj as WorkerImported<TImport>);
	const exposeEntries = Object.entries(exposedNodes);

	// -- Send coalescing via derived + effect ----------------------------------
	const lastSent = new Map<string, unknown>();
	let effectUnsub: (() => void) | undefined;
	let destroyed = false;

	if (exposeEntries.length > 0) {
		const nodes = exposeEntries.map(([, n]) => n);

		const aggregated = derived(
			nodes,
			() => {
				const updates: Record<string, unknown> = {};
				for (const [name, n] of exposeEntries) {
					const v = n.get();
					if (v !== lastSent.get(name)) {
						updates[name] = v;
						lastSent.set(name, v);
					}
				}
				return updates;
			},
			{ equals: () => false, name: "workerSelf::aggregated" },
		);

		const effectNode = effect([aggregated], () => {
			if (destroyed) return;
			const updates = aggregated.get() as Record<string, unknown>;
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
			} catch (_err) {
				// Transport failure — bridge is likely destroyed; swallow
			}
		});
		// Effect nodes are lazy — subscribe to activate the chain
		effectUnsub = effectNode.subscribe(() => {});
	}

	// -- Subscribe to exposed nodes: forward tier >= 2 messages -----------------
	const exposeUnsubs: Array<() => void> = [];
	for (const [name, n] of exposeEntries) {
		const unsub = n.subscribe(((msgs: Messages) => {
			if (destroyed) return;
			for (const m of msgs) {
				const type = m[0] as symbol;
				// DATA goes through the coalescing path — skip here
				if (type === DATA) continue;
				// Block known tier 0/1 (DIRTY, INVALIDATE, PAUSE, RESUME) — local only.
				// Unknown types (not in knownMessageTypes) always forward (spec §1.3.6).
				if (knownMessageTypes.includes(type) && messageTier(type) < 2) continue;
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

	// -- Receive handler -------------------------------------------------------
	const unlisten = transport.listen((data) => {
		if (destroyed) return;
		const msg = data as BridgeMessage;

		switch (msg.t) {
			// Init from main — set proxy node values
			case "i": {
				batch(() => {
					for (const [name, value] of Object.entries(msg.stores)) {
						const proxy = proxyNodes.get(name);
						if (proxy) proxy.down([[DATA, value]]);
					}
				});
				break;
			}

			// Single value update from main
			case "v": {
				const proxy = proxyNodes.get(msg.s);
				if (proxy) proxy.down([[DATA, msg.d]]);
				break;
			}

			// Batch value update from main
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

			// Error from main node
			case "e": {
				const proxy = proxyNodes.get(msg.s);
				if (proxy) proxy.down([[ERROR, deserializeError(msg.err)]]);
				break;
			}

			// Lifecycle signal from main
			case "s": {
				const sig = nameToSignal(msg.sig);
				if (!sig) break;

				if (sig === TEARDOWN && msg.s === "*") {
					destroy();
					return;
				}

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

	// -- Send ready message ----------------------------------------------------
	const readyValues: Record<string, unknown> = {};
	for (const [name, n] of exposeEntries) {
		readyValues[name] = n.get();
		lastSent.set(name, readyValues[name]);
	}
	transport.post({ t: "r", stores: readyValues } satisfies BridgeMessage);

	// -- Destroy ---------------------------------------------------------------
	function destroy() {
		if (destroyed) return;
		destroyed = true;

		// Cleanup: unsub effect first (stops sending), then expose listeners,
		// then unlisten on transport
		if (effectUnsub) effectUnsub();
		for (const unsub of exposeUnsubs) unsub();
		exposeUnsubs.length = 0;
		unlisten();
		transport.terminate?.();

		lastSent.clear();
		lastSeenImportVersions.clear();
		proxyNodes.clear();
	}

	return { destroy };
}
