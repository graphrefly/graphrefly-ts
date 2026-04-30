/**
 * WebSocket IO — `fromWebSocket` (DOM-style `WebSocketLike` source / register
 * variant), `toWebSocket` (sink with optional ack-tracking + retry),
 * `fromWebSocketReconnect` (`fromWebSocket` wrapped in retry-on-disconnect with
 * exponential backoff).
 *
 * Re-exports from `./index.js` (the consolidated io source); physical body
 * split deferred — see `archive/docs/SESSION-patterns-extras-consolidation-plan.md`
 * §2 for status.
 */

export {
	type FromWebSocketReconnectOptions,
	fromWebSocket,
	fromWebSocketReconnect,
	type ToWebSocketOptions,
	toWebSocket,
	type WebSocketLike,
	type WebSocketMessageEventLike,
	type WebSocketRegister,
} from "./index.js";
