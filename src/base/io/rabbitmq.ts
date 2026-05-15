/**
 * RabbitMQ IO — `fromRabbitMQ` (queue-consumer source with optional manual
 * ack via {@link AckableMessage} envelopes) and `toRabbitMQ` (publisher
 * sink). Compatible with `amqplib`-style channels.
 */

import { wallClockNs } from "@graphrefly/pure-ts/core";
import { ERROR } from "@graphrefly/pure-ts/core";
import { type Node, node } from "@graphrefly/pure-ts/core";
import { type AckableMessage, type ExtraOpts, sourceOpts } from "./_internal.js";
import { type ReactiveSinkHandle, reactiveSink, type SinkTransportError } from "./_sink.js";

/** Duck-typed RabbitMQ channel (compatible with amqplib). */
export type RabbitMQChannelLike = {
	consume(
		queue: string,
		onMessage: (
			msg: {
				content: Buffer;
				fields: {
					routingKey: string;
					exchange: string;
					deliveryTag: number;
					redelivered: boolean;
				};
				properties: Record<string, unknown>;
			} | null,
		) => void,
		opts?: { noAck?: boolean },
	): Promise<{ consumerTag: string }>;
	cancel(consumerTag: string): Promise<void>;
	ack(msg: unknown): void;
	publish(
		exchange: string,
		routingKey: string,
		content: Buffer,
		opts?: Record<string, unknown>,
	): boolean;
	sendToQueue(queue: string, content: Buffer, opts?: Record<string, unknown>): boolean;
};

/** Structured RabbitMQ message. */
export type RabbitMQMessage<T = unknown> = {
	queue: string;
	routingKey: string;
	exchange: string;
	content: T;
	properties: Record<string, unknown>;
	deliveryTag: number;
	redelivered: boolean;
	timestampNs: number;
};

/** Options for {@link fromRabbitMQ}. */
export type FromRabbitMQOptions = ExtraOpts & {
	/** Deserialize message content. Default: `JSON.parse(buffer.toString())`. */
	deserialize?: (content: Buffer) => unknown;
	/** Auto-acknowledge messages. Default: `true`. */
	autoAck?: boolean;
	/**
	 * Routes envelope ack/nack transport failures (including "SDK exposes no
	 * `nack` method") to the caller. Default: swallow.
	 */
	onAckError?: (err: Error) => void;
};

/**
 * RabbitMQ consumer as a reactive source.
 *
 * Wraps an `amqplib`-compatible channel. Each message becomes a `DATA` emission.
 *
 * @param channel - AMQP channel instance (caller owns connection/channel lifecycle).
 * @param queue - Queue to consume from.
 * @param opts - Deserialization and acknowledgment options.
 * @returns `Node<RabbitMQMessage<T>>` — one `DATA` per RabbitMQ message.
 *
 * @remarks
 * When `autoAck` is `false`, the adapter opens the channel with `noAck: false`
 * (broker requires acks) but does not call `channel.ack()`. The caller must ack
 * messages externally using the `deliveryTag` from the emitted {@link RabbitMQMessage}:
 * ```ts
 * channel.ack({ fields: { deliveryTag: msg.deliveryTag } } as any);
 * ```
 *
 * @example
 * ```ts
 * import amqplib from "amqplib";
 * import { fromRabbitMQ } from "@graphrefly/graphrefly-ts";
 *
 * const conn = await amqplib.connect("amqp://localhost");
 * const ch = await conn.createChannel();
 * await ch.assertQueue("events");
 * const events$ = fromRabbitMQ(ch, "events");
 * ```
 *
 * @category extra
 */
export function fromRabbitMQ<T = unknown>(
	channel: RabbitMQChannelLike,
	queue: string,
	opts?: FromRabbitMQOptions & { autoAck?: true },
): Node<RabbitMQMessage<T>>;
export function fromRabbitMQ<T = unknown>(
	channel: RabbitMQChannelLike,
	queue: string,
	opts: FromRabbitMQOptions & { autoAck: false },
): Node<AckableMessage<RabbitMQMessage<T>>>;
export function fromRabbitMQ<T = unknown>(
	channel: RabbitMQChannelLike,
	queue: string,
	opts?: FromRabbitMQOptions,
): Node<RabbitMQMessage<T> | AckableMessage<RabbitMQMessage<T>>> {
	const {
		autoAck = true,
		deserialize = (buf: Buffer) => {
			try {
				return JSON.parse(buf.toString());
			} catch {
				return buf.toString();
			}
		},
		onAckError,
		...rest
	} = opts ?? {};

	const reportAckError = (err: unknown) => {
		if (!onAckError) return;
		try {
			onAckError(err instanceof Error ? err : new Error(String(err)));
		} catch {
			/* user hook must not escape */
		}
	};

	return node<RabbitMQMessage<T> | AckableMessage<RabbitMQMessage<T>>>(
		[],
		(_data, a) => {
			let active = true;
			let consumerTag: string | undefined;

			const start = async () => {
				try {
					const result = await channel.consume(
						queue,
						(rawMsg) => {
							if (!active) return;
							if (rawMsg === null) {
								// Broker cancelled the consumer (queue deleted, etc.).
								if (active) a.down([[ERROR, new Error("Consumer cancelled by broker")]]);
								return;
							}
							const structured: RabbitMQMessage<T> = {
								queue,
								routingKey: rawMsg.fields.routingKey,
								exchange: rawMsg.fields.exchange,
								content: deserialize(rawMsg.content) as T,
								properties: rawMsg.properties,
								deliveryTag: rawMsg.fields.deliveryTag,
								redelivered: rawMsg.fields.redelivered,
								timestampNs: wallClockNs(),
							};
							if (autoAck) {
								a.emit(structured);
								try {
									channel.ack(rawMsg);
								} catch (err) {
									reportAckError(err);
								}
							} else {
								let settled = false;
								const channelWithNack = channel as unknown as {
									nack?: (msg: unknown, allUpTo?: boolean, requeue?: boolean) => void;
								};
								const envelope: AckableMessage<RabbitMQMessage<T>> = {
									value: structured,
									ack() {
										if (settled) return;
										settled = true;
										try {
											channel.ack(rawMsg);
										} catch (err) {
											reportAckError(err);
										}
									},
									nack(nackOpts) {
										if (settled) return;
										settled = true;
										// `requeue` passes through to SDK — `undefined` lets the
										// SDK apply its own default (amqplib: true). Explicit
										// `false` routes to DLX if configured.
										const requeue = nackOpts?.requeue;
										if (!channelWithNack.nack) {
											reportAckError(
												new Error("RabbitMQ channel does not expose `nack`; cannot negative-ack"),
											);
											return;
										}
										try {
											channelWithNack.nack(rawMsg, false, requeue);
										} catch (err) {
											reportAckError(err);
										}
									},
								};
								a.emit(envelope);
							}
						},
						{ noAck: false },
					);
					consumerTag = result.consumerTag;
				} catch (err) {
					if (active) a.down([[ERROR, err]]);
				}
			};

			void start();

			return () => {
				active = false;
				if (consumerTag !== undefined) {
					void channel.cancel(consumerTag);
				}
			};
		},
		sourceOpts(rest),
	);
}

/** Options for {@link toRabbitMQ}. */
export type ToRabbitMQOptions<T> = ExtraOpts & {
	/** Serialize value for RabbitMQ. Default: `Buffer.from(JSON.stringify(value))`. */
	serialize?: (value: T) => Buffer;
	/** Extract routing key from value. Default: `""`. */
	routingKeyExtractor?: (value: T) => string;
	/** Called on serialization or send failures. */
	onTransportError?: (err: SinkTransportError) => void;
};

/**
 * RabbitMQ producer sink — forwards upstream `DATA` to a RabbitMQ exchange/queue.
 *
 * @param source - Upstream node to forward.
 * @param channel - AMQP channel instance.
 * @param exchange - Target exchange (use `""` for default exchange + queue routing).
 * @param opts - Serialization and routing options.
 * @returns Unsubscribe function.
 *
 * @category extra
 */
export function toRabbitMQ<T>(
	source: Node<T>,
	channel: RabbitMQChannelLike,
	exchange: string,
	opts?: ToRabbitMQOptions<T>,
): ReactiveSinkHandle<T> {
	const {
		serialize = (v: T) => Buffer.from(JSON.stringify(v)),
		routingKeyExtractor = () => "",
		onTransportError,
	} = opts ?? {};
	return reactiveSink<T>(source, {
		onTransportError,
		send: (value) => {
			const routingKey = routingKeyExtractor(value);
			const content = serialize(value);
			channel.publish(exchange, routingKey, content);
		},
	});
}
