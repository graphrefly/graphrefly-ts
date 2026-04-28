/**
 * WebSocket IO — `fromWebSocket` / `toWebSocket` and reconnect variant.
 *
 * Re-exports from `./index.js` (the consolidated io source). Sub-file exists
 * for category-level discoverability per the consolidation plan §2;
 * physical code split deferred.
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
