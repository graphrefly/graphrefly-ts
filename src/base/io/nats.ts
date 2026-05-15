/**
 * NATS IO — `fromNATS` (subject-subscription consumer source) and `toNATS`
 * (publish sink). Compatible with `nats.js`-style clients.
 */

import { wallClockNs } from "@graphrefly/pure-ts/core";
import { COMPLETE, ERROR } from "@graphrefly/pure-ts/core";
import { type Node, node } from "@graphrefly/pure-ts/core";
import { type ExtraOpts, sourceOpts } from "./_internal.js";
import { type ReactiveSinkHandle, reactiveSink, type SinkTransportError } from "./_sink.js";

/** Duck-typed NATS subscription (compatible with nats.js). */
export type NATSSubscriptionLike = AsyncIterable<{
	subject: string;
	data: Uint8Array;
	headers?: { get(key: string): string; keys(): string[] };
	reply?: string;
	sid: number;
}>;

/** Duck-typed NATS client (compatible with nats.js). */
export type NATSClientLike = {
	subscribe(subject: string, opts?: { queue?: string }): NATSSubscriptionLike;
	publish(subject: string, data?: Uint8Array, opts?: { headers?: unknown; reply?: string }): void;
	drain(): Promise<void>;
};

/** Structured NATS message. */
export type NATSMessage<T = unknown> = {
	subject: string;
	data: T;
	headers: Record<string, string>;
	reply: string | undefined;
	sid: number;
	timestampNs: number;
};

/** Options for {@link fromNATS}. */
export type FromNATSOptions = ExtraOpts & {
	/** Queue group name for load balancing. */
	queue?: string;
	/** Deserialize message data. Default: `JSON.parse(textDecoder.decode(data))`. */
	deserialize?: (data: Uint8Array) => unknown;
};

/**
 * NATS consumer as a reactive source.
 *
 * Wraps a `nats.js`-compatible client subscription. Each message becomes a `DATA` emission.
 *
 * @param client - NATS client instance (caller owns connect/drain lifecycle).
 * @param subject - Subject to subscribe to (supports wildcards).
 * @param opts - Queue group, deserialization, and source options.
 * @returns `Node<NATSMessage<T>>` — one `DATA` per NATS message.
 *
 * @remarks
 * Teardown sets an internal flag but cannot break the async iterator. The loop
 * exits on the next message or when the subscription is drained/unsubscribed
 * externally. Call `client.drain()` after unsubscribing for prompt cleanup.
 *
 * @example
 * ```ts
 * import { connect } from "nats";
 * import { fromNATS } from "@graphrefly/graphrefly-ts";
 *
 * const nc = await connect({ servers: "localhost:4222" });
 * const events$ = fromNATS(nc, "events.>");
 * ```
 *
 * @category extra
 */
export function fromNATS<T = unknown>(
	client: NATSClientLike,
	subject: string,
	opts?: FromNATSOptions,
): Node<NATSMessage<T>> {
	const decoder = new TextDecoder();
	const {
		queue,
		deserialize = (data: Uint8Array) => {
			const text = decoder.decode(data);
			try {
				return JSON.parse(text);
			} catch {
				return text;
			}
		},
		...rest
	} = opts ?? {};

	return node<NATSMessage<T>>(
		[],
		(_data, a) => {
			let active = true;
			const sub = client.subscribe(subject, queue ? { queue } : undefined);

			const loop = async () => {
				try {
					for await (const msg of sub) {
						if (!active) return;
						const headers: Record<string, string> = {};
						if (msg.headers) {
							for (const k of msg.headers.keys()) {
								headers[k] = msg.headers.get(k);
							}
						}
						a.emit({
							subject: msg.subject,
							data: deserialize(msg.data) as T,
							headers,
							reply: msg.reply,
							sid: msg.sid,
							timestampNs: wallClockNs(),
						});
					}
					// Subscription closed (drain or unsubscribe) — complete.
					if (active) a.down([[COMPLETE]]);
				} catch (err) {
					if (active) a.down([[ERROR, err]]);
				}
			};

			void loop();

			return () => {
				active = false;
			};
		},
		sourceOpts(rest),
	);
}

/** Options for {@link toNATS}. */
export type ToNATSOptions<T> = ExtraOpts & {
	/** Serialize value for NATS. Default: `JSON.stringify` → Uint8Array. */
	serialize?: (value: T) => Uint8Array;
	/** Called on serialization failures. */
	onTransportError?: (err: SinkTransportError) => void;
};

/**
 * NATS publisher sink — forwards upstream `DATA` to a NATS subject.
 *
 * @param source - Upstream node to forward.
 * @param client - NATS client instance.
 * @param subject - Target subject.
 * @param opts - Serialization options.
 * @returns Unsubscribe function.
 *
 * @category extra
 */
export function toNATS<T>(
	source: Node<T>,
	client: NATSClientLike,
	subject: string,
	opts?: ToNATSOptions<T>,
): ReactiveSinkHandle<T> {
	const encoder = new TextEncoder();
	const { serialize = (v: T) => encoder.encode(JSON.stringify(v)), onTransportError } = opts ?? {};
	return reactiveSink<T>(source, {
		onTransportError,
		send: (value) => {
			// NATS publish is synchronous; wrap in a resolved Promise for the
			// reactiveSink transport boundary.
			client.publish(subject, serialize(value));
		},
	});
}
