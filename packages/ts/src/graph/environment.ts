/**
 * Graph-owned environment driver bag (D130/D131).
 *
 * Drivers host process/network/messaging/runtime boundary work outside the synchronous wave core.
 * The bag is graph-local and is read from ctx by source/adapter bodies.
 */

export type DriverCancel = () => void;

export type DriverResult<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly error: unknown };

export interface ProcessCommand {
	readonly program: string;
	readonly args: readonly string[];
	readonly cwd?: string;
	readonly env?: readonly (readonly [string, string])[];
}

export interface ProcessResult {
	readonly stdout: string;
	readonly stderr: string;
	readonly exitCode: number | null;
	readonly signal: string | null;
}

export interface HttpRequest {
	readonly method: string;
	readonly url: string;
	readonly headers?: readonly (readonly [string, string])[];
	readonly body?: Uint8Array | string;
}

export interface HttpResponse {
	readonly status: number;
	readonly headers: readonly (readonly [string, string])[];
	readonly body: Uint8Array;
}

export interface SseRequest {
	readonly url: string;
	readonly headers?: readonly (readonly [string, string])[];
}

export interface SseEvent {
	readonly event?: string;
	readonly data: string;
	readonly id?: string;
	readonly retryMs?: number;
}

export type SseDriverEvent =
	| { readonly kind: "event"; readonly event: SseEvent }
	| { readonly kind: "error"; readonly error: unknown }
	| { readonly kind: "complete" };

export interface WebSocketRequest {
	readonly url: string;
	readonly headers?: readonly (readonly [string, string])[];
}

export type WebSocketEvent =
	| { readonly kind: "open" }
	| { readonly kind: "text"; readonly data: string }
	| { readonly kind: "binary"; readonly data: Uint8Array }
	| { readonly kind: "close"; readonly code?: number; readonly reason?: string };

export interface WebSocketSend {
	readonly data: string | Uint8Array;
}

export interface WebSocketSendResult {
	readonly sent: true;
}

/** Live WebSocket session handle for D133 SessionBundle adapters. */
export interface WebSocketSessionHandle {
	send(
		message: WebSocketSend,
		callback: (result: DriverResult<WebSocketSendResult>) => void,
	): DriverCancel;
	close(code?: number, reason?: string): void;
	cancel(): void;
}

export type WebSocketDriverEvent =
	| { readonly kind: "event"; readonly event: WebSocketEvent }
	| { readonly kind: "error"; readonly error: unknown }
	| { readonly kind: "complete" };

export interface WebhookRegistration {
	readonly id: string;
	readonly method?: string;
	readonly path?: string;
}

export interface WebhookEvent {
	readonly registrationId: string;
	readonly method: string;
	readonly path: string;
	readonly headers: readonly (readonly [string, string])[];
	readonly query: readonly (readonly [string, string])[];
	readonly body: Uint8Array;
}

export type WebhookDriverEvent =
	| { readonly kind: "event"; readonly event: WebhookEvent }
	| { readonly kind: "error"; readonly error: unknown }
	| { readonly kind: "complete" };

export interface LocalProcessDriver {
	run(
		command: ProcessCommand,
		callback: (result: DriverResult<ProcessResult>) => void,
	): DriverCancel;
}

export interface LocalHttpDriver {
	request(
		request: HttpRequest,
		callback: (result: DriverResult<HttpResponse>) => void,
	): DriverCancel;
}

export interface LocalSseDriver {
	connect(request: SseRequest, callback: (event: SseDriverEvent) => void): DriverCancel;
}

export interface LocalWebSocketDriver {
	connect(request: WebSocketRequest, callback: (event: WebSocketDriverEvent) => void): DriverCancel;
	send?(
		request: WebSocketRequest,
		message: WebSocketSend,
		callback: (result: DriverResult<WebSocketSendResult>) => void,
	): DriverCancel;
	/** Open a live bidirectional session; unlike send(), outbound messages use this same connection. */
	connectSession?(
		request: WebSocketRequest,
		callback: (event: WebSocketDriverEvent) => void,
	): WebSocketSessionHandle;
}

export interface LocalWebhookDriver {
	register(
		registration: WebhookRegistration,
		callback: (event: WebhookDriverEvent) => void,
	): DriverCancel;
}

export interface FetchResponseLike {
	readonly status: number;
	readonly headers?: { forEach?(fn: (value: string, key: string) => void): void };
	arrayBuffer(): PromiseLike<ArrayBuffer>;
}

export type FetchLike = (
	url: string,
	init?: {
		readonly method?: string;
		readonly headers?: readonly (readonly [string, string])[];
		readonly body?: Uint8Array | string;
		readonly signal?: AbortSignal;
	},
) => PromiseLike<FetchResponseLike>;

export interface WebSocketLike {
	send(data: string | Uint8Array): void;
	close(code?: number, reason?: string): void;
	addEventListener(
		type: "open" | "message" | "error" | "close",
		listener: (event: unknown) => void,
	): void;
	removeEventListener(
		type: "open" | "message" | "error" | "close",
		listener: (event: unknown) => void,
	): void;
}

export type WebSocketConstructorLike = new (url: string) => WebSocketLike;

export interface EnvironmentDriversInit {
	readonly process?: LocalProcessDriver;
	readonly http?: LocalHttpDriver;
	readonly sse?: LocalSseDriver;
	readonly websocket?: LocalWebSocketDriver;
	readonly webhook?: LocalWebhookDriver;
}

export class EnvironmentDrivers {
	readonly process?: LocalProcessDriver;
	readonly http?: LocalHttpDriver;
	readonly sse?: LocalSseDriver;
	readonly websocket?: LocalWebSocketDriver;
	readonly webhook?: LocalWebhookDriver;

	constructor(init: EnvironmentDriversInit = {}) {
		this.process = init.process;
		this.http = init.http;
		this.sse = init.sse;
		this.websocket = init.websocket;
		this.webhook = init.webhook;
		Object.freeze(this);
	}

	static empty(): EnvironmentDrivers {
		return EMPTY_ENVIRONMENT;
	}

	withProcess(driver: LocalProcessDriver): EnvironmentDrivers {
		return new EnvironmentDrivers({ ...this, process: driver });
	}

	withHttp(driver: LocalHttpDriver): EnvironmentDrivers {
		return new EnvironmentDrivers({ ...this, http: driver });
	}

	withSse(driver: LocalSseDriver): EnvironmentDrivers {
		return new EnvironmentDrivers({ ...this, sse: driver });
	}

	withWebSocket(driver: LocalWebSocketDriver): EnvironmentDrivers {
		return new EnvironmentDrivers({ ...this, websocket: driver });
	}

	withWebhook(driver: LocalWebhookDriver): EnvironmentDrivers {
		return new EnvironmentDrivers({ ...this, webhook: driver });
	}

	processDriver(): LocalProcessDriver | undefined {
		return this.process;
	}

	httpDriver(): LocalHttpDriver | undefined {
		return this.http;
	}

	sseDriver(): LocalSseDriver | undefined {
		return this.sse;
	}

	webSocketDriver(): LocalWebSocketDriver | undefined {
		return this.websocket;
	}

	webhookDriver(): LocalWebhookDriver | undefined {
		return this.webhook;
	}
}

const EMPTY_ENVIRONMENT = new EnvironmentDrivers();

export function fetchHttpDriver(fetchFn: FetchLike = requireGlobalFetch()): LocalHttpDriver {
	return {
		request(request, callback) {
			const controller = new AbortController();
			void Promise.resolve(
				fetchFn(request.url, {
					method: request.method,
					headers: request.headers,
					body: request.body,
					signal: controller.signal,
				}),
			).then(
				async (response) => {
					const headers: Array<readonly [string, string]> = [];
					response.headers?.forEach?.((value, key) => {
						headers.push([key, value]);
					});
					const body = new Uint8Array(await response.arrayBuffer());
					callback({ ok: true, value: { status: response.status, headers, body } });
				},
				(error) => callback({ ok: false, error }),
			);
			return () => controller.abort();
		},
	};
}

export function domWebSocketDriver(
	WebSocketCtor: WebSocketConstructorLike = requireGlobalWebSocket(),
): LocalWebSocketDriver {
	return {
		connect(request, callback) {
			const socket = new WebSocketCtor(request.url);
			const onOpen = () => callback({ kind: "event", event: { kind: "open" } });
			const onMessage = (event: unknown) => {
				const data = (event as { data?: unknown }).data;
				if (typeof data === "string") callback({ kind: "event", event: { kind: "text", data } });
				else if (data instanceof Uint8Array) {
					callback({ kind: "event", event: { kind: "binary", data } });
				} else {
					callback({ kind: "event", event: { kind: "text", data: String(data ?? "") } });
				}
			};
			const onError = (event: unknown) => callback({ kind: "error", error: event });
			const onClose = (event: unknown) => {
				const close = event as { code?: number; reason?: string };
				callback({
					kind: "event",
					event: { kind: "close", code: close.code, reason: close.reason },
				});
				callback({ kind: "complete" });
			};
			socket.addEventListener("open", onOpen);
			socket.addEventListener("message", onMessage);
			socket.addEventListener("error", onError);
			socket.addEventListener("close", onClose);
			return () => {
				socket.removeEventListener("open", onOpen);
				socket.removeEventListener("message", onMessage);
				socket.removeEventListener("error", onError);
				socket.removeEventListener("close", onClose);
				socket.close();
			};
		},
		send(request, message, callback) {
			const socket = new WebSocketCtor(request.url);
			let settled = false;
			const finish = (result: DriverResult<WebSocketSendResult>) => {
				if (settled) return;
				settled = true;
				callback(result);
				socket.close();
			};
			const onOpen = () => {
				try {
					socket.send(message.data);
					finish({ ok: true, value: { sent: true } });
				} catch (error) {
					finish({ ok: false, error });
				}
			};
			const onError = (event: unknown) => finish({ ok: false, error: event });
			socket.addEventListener("open", onOpen);
			socket.addEventListener("error", onError);
			return () => {
				settled = true;
				socket.removeEventListener("open", onOpen);
				socket.removeEventListener("error", onError);
				socket.close();
			};
		},
		connectSession(request, callback) {
			const socket = new WebSocketCtor(request.url);
			let active = true;
			const onOpen = () => callback({ kind: "event", event: { kind: "open" } });
			const onMessage = (event: unknown) => {
				const data = (event as { data?: unknown }).data;
				if (typeof data === "string") callback({ kind: "event", event: { kind: "text", data } });
				else if (data instanceof Uint8Array) {
					callback({ kind: "event", event: { kind: "binary", data } });
				} else {
					callback({ kind: "event", event: { kind: "text", data: String(data ?? "") } });
				}
			};
			const onError = (event: unknown) => callback({ kind: "error", error: event });
			const onClose = (event: unknown) => {
				const close = event as { code?: number; reason?: string };
				callback({
					kind: "event",
					event: { kind: "close", code: close.code, reason: close.reason },
				});
				callback({ kind: "complete" });
			};
			const removeListeners = () => {
				socket.removeEventListener("open", onOpen);
				socket.removeEventListener("message", onMessage);
				socket.removeEventListener("error", onError);
				socket.removeEventListener("close", onClose);
			};
			socket.addEventListener("open", onOpen);
			socket.addEventListener("message", onMessage);
			socket.addEventListener("error", onError);
			socket.addEventListener("close", onClose);
			return {
				send(message, sendCallback) {
					let canceled = false;
					try {
						socket.send(message.data);
						if (!canceled) sendCallback({ ok: true, value: { sent: true } });
					} catch (error) {
						if (!canceled) sendCallback({ ok: false, error });
					}
					return () => {
						canceled = true;
					};
				},
				close(code, reason) {
					if (!active) return;
					socket.close(code, reason);
				},
				cancel() {
					if (!active) return;
					active = false;
					removeListeners();
					socket.close();
				},
			};
		},
	};
}

function requireGlobalFetch(): FetchLike {
	const fetchFn = (globalThis as { fetch?: FetchLike }).fetch;
	if (fetchFn === undefined) throw new Error("fetchHttpDriver: global fetch is not available");
	return fetchFn;
}

function requireGlobalWebSocket(): WebSocketConstructorLike {
	const ctor = (globalThis as { WebSocket?: WebSocketConstructorLike }).WebSocket;
	if (ctor === undefined) throw new Error("domWebSocketDriver: global WebSocket is not available");
	return ctor;
}
