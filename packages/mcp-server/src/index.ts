/**
 * @graphrefly/mcp-server — Model Context Protocol server exposing
 * GraphReFly operations as tools (§9.3).
 *
 * @module
 */

export type { BuildMcpServerOptions } from "./server.js";
export { buildMcpServer } from "./server.js";
export type { Session, SessionOptions } from "./session.js";
export { createSession } from "./session.js";
export type { StartStdioOptions } from "./stdio.js";
export { startStdioServer } from "./stdio.js";
export * from "./tools.js";
