import { deferAfterBatchForTarget } from "../batch/batch.js";
import type { NodeFn } from "../ctx/types.js";
import type { Graph } from "../graph/graph.js";
import type { Node } from "../node/node.js";
import { validateNodeRewire } from "../node/node-rewire-runtime.js";
import { nodeRuntimeHost } from "../node/node-runtime-host.js";
import type { MessageBusCommand } from "./index.js";

export interface MessageBusInternalState {
	readonly graph: Graph;
	readonly name: string;
	readonly commandBody: NodeFn;
}

const busStates = new WeakMap<object, MessageBusInternalState>();

export function registerMessageBusState(bus: object, state: MessageBusInternalState): void {
	busStates.set(bus, state);
}

export function getMessageBusState(bus: object): MessageBusInternalState | undefined {
	return busStates.get(bus);
}

export function attachMessageBusCommandSource(
	graph: Graph,
	bus: object,
	commands: Node<MessageBusCommand>,
): () => void {
	const state = getMessageBusState(bus);
	if (state === undefined) throw new Error("messageBus: unknown implementation");
	if (state.graph !== graph) throw new Error("messageBus: command source graph must match");
	const busCommands = (bus as { readonly commands?: Node<MessageBusCommand> }).commands;
	if (busCommands === undefined) throw new Error("messageBus: missing commands node");
	const host = nodeRuntimeHost(busCommands);
	// Each helper invocation can acquire this binding only when its add actually commits.
	// A duplicate add creates no second lease, including two queued adds of the same identity.
	let ownsBinding = false;
	const nextDeps = (add: boolean): Node<unknown>[] =>
		add
			? busCommands.deps.includes(commands)
				? [...busCommands.deps]
				: [...busCommands.deps, commands]
			: busCommands.deps.filter((dep) => dep !== commands);
	const apply = (add: boolean, deferred: boolean) => {
		const present = busCommands.deps.includes(commands);
		if (add ? present : !ownsBinding || !present) return;
		host._assertNotReleased("replaceDeps");
		const next = nextDeps(add);
		validateNodeRewire(host, next, { allowTerminalOwner: deferred });
		try {
			host._rewire(next, state.commandBody, { allowTerminalOwner: deferred });
		} finally {
			// Rewire may commit deps before dependency activation throws. Retain actual ownership.
			ownsBinding = busCommands.deps.includes(commands);
		}
	};
	const request = (add: boolean) => {
		if (!add && (!ownsBinding || !busCommands.deps.includes(commands))) {
			// A pending add may still acquire this lease at the same existing boundary.
			// Otherwise this is already absent; no mutation checks or second lease are needed.
			deferAfterBatchForTarget(busCommands, () => apply(false, true));
			return;
		}
		host._assertNotReleased("replaceDeps");
		validateNodeRewire(host, nextDeps(add));
		if (!deferAfterBatchForTarget(busCommands, () => apply(add, true))) apply(add, false);
	};
	request(true);
	return () => request(false);
}

export function attachMessageBusDeferredCommandSink(
	graph: Graph,
	bus: object,
	commands: Node<MessageBusCommand>,
): () => void {
	const state = getMessageBusState(bus);
	if (state === undefined) throw new Error("messageBus: unknown implementation");
	if (state.graph !== graph) throw new Error("messageBus: command sink graph must match");
	const busCommands = (bus as { readonly commands?: Node<MessageBusCommand> }).commands;
	if (busCommands === undefined) throw new Error("messageBus: missing commands node");
	const boundary = commands as Node<MessageBusCommand> & {
		__deferBoundary?: (fn: () => void) => void;
	};
	const unsubscribe = commands.subscribe((msg) => {
		if (msg[0] !== "DATA") return;
		const command = msg[1] as MessageBusCommand;
		const send = () => busCommands.down([["DATA", command]]);
		if (boundary.__deferBoundary === undefined) send();
		else boundary.__deferBoundary(send);
	});
	return unsubscribe;
}
