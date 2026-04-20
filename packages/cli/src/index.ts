/**
 * @graphrefly/cli — stateless command-line shell over the §9.3-core
 * surface layer.
 *
 * @module
 */

export type { Argv, DispatchOptions } from "./dispatch.js";
export { dispatch, parseArgv } from "./dispatch.js";
export type { OutputFormat } from "./io.js";
export { readJson, writeOutput } from "./io.js";
