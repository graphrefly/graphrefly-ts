/**
 * MCP (Model Context Protocol) IO — `fromMCP` wraps an MCP client's
 * notification surface as a reactive source via `externalProducer`.
 */

import type { Node } from "../../core/node.js";
import { externalProducer } from "../composition/external-register.js";
import type { ExtraOpts } from "./_internal.js";

/**
 * Duck-typed MCP (Model Context Protocol) client — only the notification
 * registration surface is required so callers are not coupled to a specific SDK.
 */
export type MCPClientLike = {
	setNotificationHandler(method: string, handler: (notification: unknown) => void): void;
};

/** Options for {@link fromMCP}. */
export type FromMCPOptions = ExtraOpts & {
	/** MCP notification method to subscribe to. Default `"notifications/message"`. */
	method?: string;
	onDisconnect?: (cb: (err?: unknown) => void) => void;
};

/**
 * Wraps an MCP client's server-push notifications as a reactive source.
 *
 * @category extra
 */
export function fromMCP<T = unknown>(client: MCPClientLike, opts?: FromMCPOptions): Node<T> {
	const { method = "notifications/message", onDisconnect, ...rest } = opts ?? {};
	return externalProducer<T>(({ emit, error }) => {
		client.setNotificationHandler(method, (notification) => emit(notification as T));
		onDisconnect?.((err?: unknown) => error(err ?? new Error("MCP client disconnected")));
		// MCP SDKs do not expose handler deregistration — replace with a no-op
		// on teardown. Caller owns the client lifecycle for full cleanup.
		return () => client.setNotificationHandler(method, () => {});
	}, rest);
}
