/**
 * WorkItem authoring, verification, and scheduling facts (D333-D343).
 *
 * This focused solution subpath is data-first glue. It emits graph-visible
 * projections, requests, results, status, issues, and audit facts; it does not
 * run verification, claim queues, dispatch executors, or mutate WorkItems.
 */

export * from "./scheduling-authoring.js";
export * from "./scheduling-constructors.js";
export * from "./scheduling-effect-plan.js";
export * from "./scheduling-effect-plan-validation.js";
export * from "./scheduling-types.js";
export * from "./scheduling-validation.js";
export * from "./scheduling-verification.js";
export * from "./workspace-model.js";
