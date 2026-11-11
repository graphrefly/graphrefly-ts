import { deferAfterBatchForTarget } from "../batch/batch.js";
import type { NodeFn } from "../ctx/types.js";
import type { Graph } from "../graph/graph.js";
import type { AttachableInput } from "../node/attachable-input.js";
import type { Node, StateNode } from "../node/node.js";
import { validateNodeRewire } from "../node/node-rewire-runtime.js";
import { nodeRuntimeHost } from "../node/node-runtime-host.js";
import type { MessageBusCommand } from "./index.js";

export interface MessageBusInternalState {
	readonly graph: Graph;
	readonly name: string;
	readonly commandBody: NodeFn;
	readonly commandSources: AttachableInput;
	readonly publish: StateNode<MessageBusCommand>;
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
	// The bus command node rewires itself to its attached sources (no graph-level rewire). A
	// duplicate attach adds no second binding, and only the attach that added it detaches it.
	return state.commandSources.attach(commands as Node<unknown>);
}

export function attachMessageBusDeferredCommandSink(
	graph: Graph,
	bus: object,
	commands: Node<MessageBusCommand>,
): () => void {
	const state = getMessageBusState(bus);
	if (state === undefined) throw new Error("messageBus: unknown implementation");
	if (state.graph !== graph) throw new Error("messageBus: command sink graph must match");
	// A command reaches the bus as a write to its publish input, a request that runs after the wave
	// that delivered it (R-request-order).
	const unsubscribe = commands.subscribe((incoming) => {
		for (const msg of incoming)
			if (msg[0] === "DATA") state.publish.set(msg[1] as MessageBusCommand);
	});
	return unsubscribe;
}
