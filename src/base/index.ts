/**
 * Base layer — domain-agnostic infrastructure.
 *
 * Exports: io, composition, mutation, worker, render, meta, sources, utils.
 *
 * Node-only subpath: @graphrefly/graphrefly/base/sources/node
 * Browser-only subpath: @graphrefly/graphrefly/base/sources/browser
 *
 * @module
 */

export * from "./composition/index.js";
export * from "./io/index.js";
export * from "./meta/index.js";
export * from "./mutation/index.js";
export * from "./render/index.js";
export * from "./sources/index.js";
export * from "./utils/index.js";
export * from "./worker/index.js";
