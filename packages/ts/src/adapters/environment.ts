/**
 * Graph-visible outbound environment adapters (D130/D132).
 *
 * Async transport work is confined to graph-local EnvironmentDrivers. Each
 * helper returns declared nodes for events/status/attempts/errors instead of a
 * hidden sink side channel.
 */

export { toHttp, toProcess, toWebSocket } from "./environment-outbound.js";
export type {
	HttpRequestOf,
	OutboundAdapterOptions,
	OutboundBundle,
	OutboundEvent,
	OutboundStatus,
	ProcessCommandOf,
	WebSocketSendOf,
	WebSocketSessionBundle,
	WebSocketSessionCommand,
	WebSocketSessionInbound,
	WebSocketSessionLifecycle,
	WebSocketSessionOptions,
	WebSocketSessionOutbound,
	WebSocketSessionSendPolicy,
	WebSocketSessionStatus,
} from "./environment-types.js";
export { webSocketSession } from "./environment-websocket-session.js";
