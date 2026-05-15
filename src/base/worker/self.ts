/**
 * workerSelf — worker-side reactive node bridge.
 *
 * Mirror of workerBridge() for the worker side. Creates proxy nodes for
 * imports from main thread, exposes local nodes via the same wire protocol.
 * Uses derived() + effect() for batch coalescing.
 *
 * Wire filtering: graph-local signals ({@link isLocalOnly}) stay local;
 * DATA values go through the coalescing path; RESOLVED, COMPLETE, ERROR,
 * TEARDOWN, and unknown {@link Symbol.for} types go through the signal
 * subscription.
 *
 * Handshake (worker perspective):
 *   1. workerSelf() called — creates proxy nodes for imports
 *   2. Runs expose factory with proxy nodes -> gets nodes to expose
 *   3. Sends { t: 'r', stores: { name: initialValue, ... } } to main
 *   4. Receives { t: 'i', stores: { name: value, ... } } from main
 *   5. Updates proxy nodes -> triggers local effects
 */

import { batch } from "@graphrefly/pure-ts/core/batch.js";
import { DATA, ERROR, type Messages, TEARDOWN } from "@graphrefly/pure-ts/core/messages.js";
import { defaultConfig, type Node, type NodeSink, node } from "@graphrefly/pure-ts/core/node.js";
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
		const s = node([], { initial: undefined, name: `worker::${name}` });
		proxyNodes.set(name, s);
		importedObj[name] = s;
	}

	// -- Run expose factory ----------------------------------------------------
	const exposedNodes = opts.expose(importedObj as WorkerImported<TImport>);
	const exposeEntries = Object.entries(exposedNodes);

	// -- Send coalescing via raw `node` + `effect` ----------------------------
	// See bridge.ts for the Option B rationale — raw `node([deps], fn)` with
	// wave-form `data[]` replaces the prior `lastSent` diff + `.cache` reads.
	let effectUnsub: (() => void) | undefined;
	let destroyed = false;

	if (exposeEntries.length > 0) {
		const nodes = exposeEntries.map(([, n]) => n) as Node[];

		const aggregated = node<Record<string, unknown>>(
			nodes,
			(data, a) => {
				const updates: Record<string, unknown> = {};
				for (let i = 0; i < exposeEntries.length; i++) {
					const [name] = exposeEntries[i];
					const batch0 = data[i];
					if (batch0 != null && batch0.length > 0) {
						updates[name] = batch0.at(-1);
					}
				}
				if (Object.keys(updates).length === 0) return;
				a.emit(updates);
			},
			// Fresh `updates` object per wave → default reference equality is
			// correct; no `equals: () => false` override needed. `partial: true`
			// opts out of the §2.7 first-run gate so the aggregator can fire on
			// any-dep-settles waves (deps deliver asynchronously).
			{ name: "workerSelf::aggregated", partial: true },
		);

		const effectNode = node(
			[aggregated],
			(batchData, _actions, ctx) => {
				const batch0 = batchData[0];
				const data0 = batch0 != null && batch0.length > 0 ? batch0.at(-1) : ctx.prevData[0];
				if (destroyed) return undefined;
				const updates = data0 as Record<string, unknown> | undefined;
				if (updates == null || Object.keys(updates).length === 0) return undefined;

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
				return undefined;
			},
			{ describeKind: "effect" },
		);
		// Effect nodes are lazy — subscribe to activate the chain
		effectUnsub = effectNode.subscribe(() => {});
	}

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
	// `.cache` is a documented transport-boundary snapshot read here — not a
	// reactive access (§5.10 boundary).
	const readyValues: Record<string, unknown> = {};
	for (const [name, n] of exposeEntries) {
		readyValues[name] = n.cache;
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

		lastSeenImportVersions.clear();
		proxyNodes.clear();
	}

	return { destroy };
}
