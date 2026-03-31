/**
 * WorkerTransport — normalized message channel for all worker types.
 *
 * Abstracts Worker, SharedWorker, ServiceWorker, BroadcastChannel, and
 * MessagePort behind a uniform post/listen/terminate interface.
 */

/** Normalized bidirectional message channel. */
export interface WorkerTransport {
	/** Send data to the other side. Optional transferables for zero-copy. */
	post(data: unknown, transfer?: Transferable[]): void;
	/** Listen for incoming messages. Returns unsubscribe function. */
	listen(handler: (data: unknown) => void): () => void;
	/** Terminate the connection (if supported by the underlying transport). */
	terminate?(): void;
}

/**
 * Auto-detect transport type and create a normalized WorkerTransport.
 *
 * Supports:
 * - `Worker` — direct postMessage/onmessage
 * - `SharedWorker` — port-based postMessage/onmessage
 * - `ServiceWorker` — postMessage via controller, listen via navigator.serviceWorker
 * - `BroadcastChannel` — postMessage/onmessage (no Transferable support)
 * - `MessagePort` — direct postMessage/onmessage (worker-side SharedWorker port)
 */
export function createTransport(target: unknown): WorkerTransport {
	// MessagePort (SharedWorker port from inside the worker, or raw MessagePort)
	if (typeof MessagePort !== "undefined" && target instanceof MessagePort) {
		return {
			post(data, transfer) {
				target.postMessage(data, transfer ?? []);
			},
			listen(handler) {
				const h = (e: MessageEvent) => handler(e.data);
				target.addEventListener("message", h);
				target.start();
				return () => target.removeEventListener("message", h);
			},
			terminate() {
				target.close();
			},
		};
	}

	// SharedWorker — use its port
	if (typeof SharedWorker !== "undefined" && target instanceof SharedWorker) {
		return createTransport(target.port);
	}

	// Web Worker
	if (typeof Worker !== "undefined" && target instanceof Worker) {
		return {
			post(data, transfer) {
				target.postMessage(data, transfer ?? []);
			},
			listen(handler) {
				const h = (e: MessageEvent) => handler(e.data);
				target.addEventListener("message", h);
				return () => target.removeEventListener("message", h);
			},
			terminate() {
				target.terminate();
			},
		};
	}

	// BroadcastChannel — no Transferable support
	if (typeof BroadcastChannel !== "undefined" && target instanceof BroadcastChannel) {
		return {
			post(data, transfer?) {
				if (transfer && transfer.length > 0) {
					console.warn(
						"[graphrefly] WorkerTransport: BroadcastChannel does not support Transferable objects. The transfer argument is ignored and objects will be cloned instead.",
					);
				}
				target.postMessage(data);
			},
			listen(handler) {
				const h = (e: MessageEvent) => handler(e.data);
				target.addEventListener("message", h);
				return () => target.removeEventListener("message", h);
			},
			terminate() {
				target.close();
			},
		};
	}

	// ServiceWorker
	if (typeof ServiceWorker !== "undefined" && target instanceof ServiceWorker) {
		return {
			post(data, transfer) {
				target.postMessage(data, transfer ?? []);
			},
			listen(handler) {
				const h = (e: MessageEvent) => {
					if (e.source === target) handler(e.data);
				};
				navigator.serviceWorker.addEventListener("message", h);
				return () => navigator.serviceWorker.removeEventListener("message", h);
			},
		};
	}

	throw new Error(
		"createTransport: unsupported target type. Expected Worker, SharedWorker, ServiceWorker, BroadcastChannel, or MessagePort.",
	);
}
