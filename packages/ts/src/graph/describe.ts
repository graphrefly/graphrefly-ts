/**
 * describe() snapshot shape (R-describe / D39).
 *
 * Static, JSON-serializable structure snapshot. Renderers (pretty/mermaid/d2) are
 * pure functions over this shape — NOT methods. Per-language (D24, never in parity);
 * this documents the cross-lang contract.
 */

import type { Status } from "../node/node.js";
import type { NodeVersion } from "../node/versioning.js";

export interface DescribeNode {
	/** Stable mount-aware `::` path (auto-numbered when unnamed). Edge key. */
	id: string;
	/** Optional debug name. */
	name?: string;
	/** Operator/verb real name (D6/L1.5 — "map"/"state", not "derived"). */
	factory: string;
	/** R-status-enum (7). */
	status: Status;
	/** Cache snapshot at call time; field ABSENT = SENTINEL / never-emitted. */
	value?: unknown;
	/** D109 node runtime version metadata; absent when versioning:false. */
	version?: NodeVersion;
	/** Dep ids (R-edges-derived: edges are a pure fn of deps). */
	deps: string[];
	/** Static annotations attached via g.* opts (R-meta-presentation). */
	meta?: Record<string, unknown>;
}

export interface DescribeEdge {
	from: string;
	to: string;
}

export interface DescribeSnapshot {
	name?: string;
	nodes: DescribeNode[];
	edges: DescribeEdge[];
	subgraphs?: DescribeSnapshot[];
}

export interface DescribeOpts {
	/** Causal-chain mode: filter to nodes on a path from→to (R-describe). */
	explain?: { from: string; to: string };
}
