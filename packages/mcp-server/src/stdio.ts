/**
 * Stdio entry: wire a {@link buildMcpServer} to {@link StdioServerTransport}.
 *
 * @module
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { type BuildMcpServerOptions, buildMcpServer } from "./server.js";
import { createSession, type SessionOptions } from "./session.js";

export interface StartStdioOptions extends BuildMcpServerOptions, SessionOptions {}

/**
 * Start the MCP server on stdio. Resolves only after the transport
 * closes — either the client disconnects (stdio EOF), the server's own
 * `close()` is invoked, or SIGINT/SIGTERM triggers graceful shutdown.
 *
 * Intended for CLI `graphrefly mcp` and `dist/bin.js`. Server operators
 * who want to register a custom catalog should import `buildMcpServer`
 * + `createSession` directly and wire their own entry.
 */
export async function startStdioServer(opts?: StartStdioOptions): Promise<void> {
	const session = createSession({
		...(opts?.tier != null ? { tier: opts.tier } : {}),
		...(opts?.storageDir != null ? { storageDir: opts.storageDir } : {}),
	});
	const server = buildMcpServer(session, {
		...(opts?.catalog != null ? { catalog: opts.catalog } : {}),
		...(opts?.name != null ? { name: opts.name } : {}),
		...(opts?.version != null ? { version: opts.version } : {}),
		...(opts?.instructions != null ? { instructions: opts.instructions } : {}),
	});
	const transport = new StdioServerTransport();

	// Bridge the SDK's fire-and-forget `onclose` callback to a Promise —
	// same pattern as firstValueFrom (one-shot async bridge at the system
	// boundary). Not a raw async primitive inside the reactive layer.
	const closed = new Promise<void>((resolve) => {
		transport.onclose = () => resolve();
	});

	const shutdown = async (): Promise<void> => {
		try {
			await server.close();
		} catch (err) {
			console.error("@graphrefly/mcp-server close error:", err);
		}
		try {
			session.dispose();
		} catch (err) {
			console.error("@graphrefly/mcp-server dispose error:", err);
		}
	};

	let signalled = false;
	const onSignal = (signal: NodeJS.Signals): void => {
		if (signalled) return;
		signalled = true;
		console.error(`@graphrefly/mcp-server received ${signal}, shutting down`);
		// Fire-and-forget — the close() call triggers transport.onclose,
		// which resolves the `closed` promise below and lets the outer
		// await return cleanly.
		void shutdown();
	};
	process.once("SIGINT", onSignal);
	process.once("SIGTERM", onSignal);

	try {
		await server.connect(transport);
		console.error("@graphrefly/mcp-server running on stdio");
		await closed;
	} finally {
		process.removeListener("SIGINT", onSignal);
		process.removeListener("SIGTERM", onSignal);
		// If the transport closed first (client disconnect), tear down
		// session state. Idempotent with the SIGINT path.
		if (!signalled) session.dispose();
	}
}
