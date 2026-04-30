import { type Node, node } from "../../../core/node.js";

import { type ReactiveLogBundle, reactiveLog } from "../../../extra/reactive-log.js";
import { keepalive } from "../../../extra/sources.js";
import { Graph, type GraphOptions } from "../../../graph/graph.js";
import { aiMeta } from "../_internal.js";
import type { ChatMessage } from "../adapters/core/types.js";

// ---------------------------------------------------------------------------
// chatStream
// ---------------------------------------------------------------------------

export type ChatStreamOptions = {
	graph?: GraphOptions;
	maxMessages?: number;
};

export class ChatStreamGraph extends Graph {
	private readonly _log: ReactiveLogBundle<ChatMessage>;
	readonly messages: Node<readonly ChatMessage[]>;
	readonly latest: Node<ChatMessage | null>;
	readonly messageCount: Node<number>;

	constructor(name: string, opts: ChatStreamOptions = {}) {
		super(name, opts.graph);

		this._log = reactiveLog<ChatMessage>([], {
			name: "messages",
			maxSize: opts.maxMessages,
		});
		this.messages = this._log.entries;
		this.add(this.messages, { name: "messages" });

		this.latest = node<ChatMessage | null>(
			[this.messages],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				const entries = data[0] as readonly ChatMessage[];
				actions.emit(entries.length === 0 ? null : (entries[entries.length - 1] as ChatMessage));
			},
			{
				name: "latest",
				describeKind: "derived",
				meta: aiMeta("chat_latest"),
			},
		);
		this.add(this.latest, { name: "latest" });
		this.addDisposer(keepalive(this.latest));

		this.messageCount = node<number>(
			[this.messages],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				actions.emit((data[0] as readonly ChatMessage[]).length);
			},
			{
				name: "messageCount",
				describeKind: "derived",
				meta: aiMeta("chat_message_count"),
				initial: 0,
			},
		);
		this.add(this.messageCount, { name: "messageCount" });
		this.addDisposer(keepalive(this.messageCount));
	}

	append(role: ChatMessage["role"], content: string, extra?: Partial<ChatMessage>): void {
		this._log.append({ role, content, ...extra });
	}

	appendToolResult(callId: string, content: string): void {
		this._log.append({ role: "tool", content, toolCallId: callId });
	}

	clear(): void {
		this._log.clear();
	}

	allMessages(): readonly ChatMessage[] {
		return this.messages.cache as readonly ChatMessage[];
	}
}

export function chatStream(name: string, opts?: ChatStreamOptions): ChatStreamGraph {
	return new ChatStreamGraph(name, opts);
}
