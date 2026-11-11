import { deferAfterBatchForTarget } from "../batch/batch.js";
import type { NodeFn } from "../ctx/types.js";
import type { Graph } from "../graph/graph.js";
import type { AttachableInput } from "../node/attachable-input.js";
import { eachMessage } from "../node/each-message.js";
import type { Node } from "../node/node.js";
import { validateNodeRewire } from "../node/node-rewire-runtime.js";
import { nodeRuntimeHost } from "../node/node-runtime-host.js";
import type { MessageBusCommand } from "./index.js";

export interface MessageBusInternalState {
	readonly graph: Graph;
	readonly name: string;
	readonly commandBody: NodeFn;
	readonly commandSources: AttachableInput;
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
	const busCommands = (bus as { readonly commands?: Node<MessageBusCommand> }).commands;
	if (busCommands === undefined) throw new Error("messageBus: missing commands node");
	const boundary = commands as Node<MessageBusCommand> & {
		__deferBoundary?: (fn: () => void) => void;
	};
	const unsubscribe = commands.subscribe(
		eachMessage((msg) => {
			if (msg[0] !== "DATA") return;
			const command = msg[1] as MessageBusCommand;
			const send = () => busCommands.down([["DATA", command]]);
			if (boundary.__deferBoundary === undefined) send();
			else boundary.__deferBoundary(send);
		}),
	);
	return unsubscribe;
}
