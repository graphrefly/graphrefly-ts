import type { NodeFn } from "../ctx/types.js";
import type { Graph } from "../graph/graph.js";
import type { Node } from "../node/node.js";
import type { MessageBusCommand } from "./index.js";

export interface MessageBusInternalState {
	readonly graph: Graph;
	readonly name: string;
	readonly commandSources: Node<MessageBusCommand>[];
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
	state.commandSources.push(commands);
	const busCommands = (bus as { readonly commands?: Node<MessageBusCommand> }).commands;
	if (busCommands === undefined) throw new Error("messageBus: missing commands node");
	busCommands.replaceDeps([...state.commandSources], state.commandBody);
	let released = false;
	return () => {
		if (released) return;
		released = true;
		const index = state.commandSources.indexOf(commands);
		if (index >= 0) state.commandSources.splice(index, 1);
		busCommands.replaceDeps([...state.commandSources], state.commandBody);
	};
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
