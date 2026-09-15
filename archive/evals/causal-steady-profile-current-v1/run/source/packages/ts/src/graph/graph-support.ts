import { checkpointStateOfNode, type Node } from "../node/node.js";
import { type GraphCheckpointFactory, toCheckpointJson } from "./checkpoint.js";
import type { DescribeSnapshot } from "./describe.js";
import type { TopologyEvent } from "./inspect.js";

export function isNonAuthoritativeCollectionHelperMeta(
	meta: Record<string, unknown> | undefined,
): boolean {
	return (
		meta?.kind === "collection_delta" ||
		meta?.kind === "collection_intent" ||
		meta?.kind === "collection_policy_apply" ||
		meta?.kind === "collection_snapshot" ||
		meta?.kind === "collection_snapshot_prep"
	);
}

export function assertCheckpointQuiescentStatus(status: string, id: string, op: string): void {
	if (status === "pending" || status === "dirty") {
		throw new Error(
			`${op}: node '${id}' has non-quiescent status '${status}' that cannot be checkpoint-restored yet`,
		);
	}
}

export function topologyPathMatches(eventPath: string, path: string): boolean {
	return eventPath === path || eventPath.startsWith(`${path}::`);
}

export function prefixTopologyPath(prefix: string, path: string): string {
	return `${prefix}::${path}`;
}

export function cloneTopologyEvent(event: TopologyEvent): TopologyEvent {
	const deps = Object.freeze([...event.deps]);
	const prevDeps = event.prevDeps === undefined ? undefined : Object.freeze([...event.prevDeps]);
	return Object.freeze({
		kind: event.kind,
		path: event.path,
		deps,
		...(prevDeps !== undefined ? { prevDeps } : {}),
		...(event.factory !== undefined ? { factory: event.factory } : {}),
		seq: event.seq,
	});
}

export function checkpointFactory(
	name: string,
	node: Node<unknown>,
	unregistered: boolean,
	restore?: { ref: string; config?: unknown; configVersion?: unknown },
	meta?: Record<string, unknown>,
): GraphCheckpointFactory {
	const state = checkpointStateOfNode(node);
	if (unregistered) {
		return {
			kind: "local-only",
			name,
			reason: "node is an unregistered live dependency auto-discovered from topology",
		};
	}
	if (
		restore === undefined &&
		typeof meta?.kind === "string" &&
		meta.kind.startsWith("collection_")
	) {
		return {
			kind: "local-only",
			name,
			reason: "collection helper node has no backend checkpoint restore metadata",
		};
	}
	if (restore !== undefined) {
		const out: GraphCheckpointFactory = {
			kind: "registry-ref",
			ref: toCheckpointJson(restore.ref, `${name}.factory.ref`) as string,
		};
		if (restore.config !== undefined)
			out.config = toCheckpointJson(restore.config, `${name}.factory.config`);
		if (restore.configVersion !== undefined)
			out.configVersion = toCheckpointJson(restore.configVersion, `${name}.factory.configVersion`);
		return out;
	}
	if (state.handle !== null) {
		return {
			kind: "local-only",
			name,
			reason: "node uses a function body; first-cut checkpoints do not serialize local functions",
		};
	}
	return { kind: "registry-ref", ref: name };
}

/** Filter a snapshot to the causal chain from→to (forward-reachable(from) ∩ back-reachable(to)). */
export function explainSubset(
	snap: DescribeSnapshot,
	chain: { from: string; to: string },
): DescribeSnapshot {
	const fwd = new Map<string, string[]>();
	const rev = new Map<string, string[]>();
	const push = (map: Map<string, string[]>, k: string, v: string): void => {
		const a = map.get(k);
		if (a) a.push(v);
		else map.set(k, [v]);
	};
	for (const e of snap.edges) {
		push(fwd, e.from, e.to);
		push(rev, e.to, e.from);
	}
	const reach = (start: string, adj: Map<string, string[]>): Set<string> => {
		const seen = new Set<string>([start]);
		const stack = [start];
		while (stack.length > 0) {
			const cur = stack.pop() as string;
			for (const nxt of adj.get(cur) ?? []) {
				if (!seen.has(nxt)) {
					seen.add(nxt);
					stack.push(nxt);
				}
			}
		}
		return seen;
	};
	const onPath = new Set([...reach(chain.from, fwd)].filter((id) => reach(chain.to, rev).has(id)));
	return {
		...(snap.name !== undefined ? { name: snap.name } : {}),
		nodes: snap.nodes.filter((n) => onPath.has(n.id)),
		edges: snap.edges.filter((e) => onPath.has(e.from) && onPath.has(e.to)),
	};
}
