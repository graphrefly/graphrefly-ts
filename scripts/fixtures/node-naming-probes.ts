import {
	wireBridge,
	wireBridgeAckDriver,
	wireEdgeGroupIn,
} from "../../packages/ts/src/adapters/index.js";
import type { Graph } from "../../packages/ts/src/graph/graph.js";
import { graph, memoryKv, reactiveCascadingCache } from "../../packages/ts/src/index.js";
import type { Node } from "../../packages/ts/src/node/node.js";
import { workItemSeedProjector } from "../../packages/ts/src/solutions/work-item/execution.js";

function inventory(g: Graph, before: Set<string>, roles: Record<string, Node<unknown>>) {
	const nodes = g.describe();
	const id = (node: Node<unknown>) => {
		const entry = nodes.find((entry) => g.find(entry.id) === node);
		if (!entry) throw new Error("naming probe: role node missing from describe");
		return entry.id;
	};
	return {
		ids: nodes
			.map((node) => node.id)
			.filter((id) => !before.has(id))
			.sort(),
		roles: Object.fromEntries(Object.entries(roles).map(([role, node]) => [role, id(node)])),
	};
}

export function runNodeNamingProbes() {
	const bridgeGraph = graph();
	const bridge = wireBridge(bridgeGraph, { sessionId: "s1" });
	const bridgeRoles = Object.fromEntries(
		[
			"acks",
			"attempts",
			"command",
			"cursor",
			"errors",
			"events",
			"inbound",
			"nacks",
			"outbound",
			"status",
		].map((role) => [role, bridge[role as keyof typeof bridge] as Node<unknown>]),
	);
	// The status projection declares its persistent ledger as its dependency.
	bridgeRoles.statusLedger = bridge.status.deps[1]!;
	bridgeRoles.inbound = bridge.events.deps[1]!;
	const wire = inventory(bridgeGraph, new Set(), bridgeRoles);
	const clock = bridgeGraph.state(0, { name: "clock" });
	const priorBridge = new Set(bridgeGraph.describe().map((node) => node.id));
	const driver = wireBridgeAckDriver(bridgeGraph, bridge, { timeoutMs: 100, clock });
	const ack = inventory(bridgeGraph, priorBridge, {
		commands: driver.commands,
		issues: driver.issues,
		status: driver.status,
		events: driver.commands.deps[0]!,
	});
	driver.release();

	const edgeGraph = graph();
	const frames = edgeGraph.node<Uint8Array>([], null, { name: "input" });
	const edges = wireEdgeGroupIn(edgeGraph, {
		name: "bridge",
		group: "g",
		frames,
		edges: ["x", "issues"],
	});
	const edge = inventory(edgeGraph, new Set(["input"]), {
		gate: edges.gate,
		edgeX: edges.inbound.get("x")!,
		edgeIssues: edges.inbound.get("issues")!,
		issues: edges.issues,
	});

	const workGraph = graph();
	const workItems = workGraph.node([], null, { name: "input" });
	const seeds = workItemSeedProjector(workGraph, { workItems });
	const work = inventory(workGraph, new Set(["input"]), { seeds });

	const cacheGraph = graph();
	const request = cacheGraph.node<string>([], null, { name: "input" });
	const cache = reactiveCascadingCache({ graph: cacheGraph, request, tiers: [memoryKv<number>()] });
	return {
		wireBridge: wire,
		edgeGroupIn: edge,
		ackDriver: ack,
		workItemSeeds: work,
		cascadingCache: inventory(cacheGraph, new Set(["input"]), {
			events: cache.events,
			status: cache.status,
			value: cache.value,
		}),
	};
}
