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
}

export interface LocalWebhookDriver {
	register(
		registration: WebhookRegistration,
		callback: (event: WebhookDriverEvent) => void,
	): DriverCancel;
}

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
