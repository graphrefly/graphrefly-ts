/**
 * Apache Pulsar IO — `fromPulsar` (native-client consumer source with optional
 * manual ack via {@link AckableMessage} envelopes) and `toPulsar` (producer
 * sink). For Kafka-on-Pulsar (KoP), use the Kafka adapter instead.
 */

import { wallClockNs } from "@graphrefly/pure-ts/core/clock.js";
import { ERROR } from "@graphrefly/pure-ts/core/messages.js";
import { type Node, node } from "@graphrefly/pure-ts/core/node.js";
import { type AckableMessage, type ExtraOpts, sourceOpts } from "./_internal.js";
import { type ReactiveSinkHandle, reactiveSink, type SinkTransportError } from "./_sink.js";

/** Duck-typed Pulsar consumer (compatible with pulsar-client). */
export type PulsarConsumerLike = {
	receive(): Promise<{
		getData(): Buffer;
		getMessageId(): { toString(): string };
		getPartitionKey(): string;
		getProperties(): Record<string, string>;
		getPublishTimestamp(): number;
		getEventTimestamp(): number;
		getTopicName(): string;
	}>;
	acknowledge(msg: unknown): Promise<void>;
	close(): Promise<void>;
};

/** Duck-typed Pulsar producer. */
export type PulsarProducerLike = {
	send(msg: {
		data: Buffer;
		partitionKey?: string;
		properties?: Record<string, string>;
	}): Promise<void>;
	close(): Promise<void>;
};

/** Structured Pulsar message. */
export type PulsarMessage<T = unknown> = {
	topic: string;
	messageId: string;
	key: string;
	value: T;
	properties: Record<string, string>;
	publishTime: number;
	eventTime: number;
	timestampNs: number;
};

/** Options for {@link fromPulsar}. */
export type FromPulsarOptions = ExtraOpts & {
	/** Deserialize message data. Default: `JSON.parse(buffer.toString())`. */
	deserialize?: (data: Buffer) => unknown;
	/** Acknowledge messages automatically. Default: `true`. */
	autoAck?: boolean;
	/**
	 * Routes ack/nack transport failures to the caller. Covers:
	 * - `autoAck: true` — post-emit `acknowledge()` promise rejections.
	 * - `autoAck: false` — envelope `ack()` / `nack()` promise rejections.
	 * Default: swallow (SDK handles redelivery on its own).
	 */
	onAckError?: (err: Error) => void;
};

/**
 * Apache Pulsar consumer as a reactive source (native client).
 *
 * Wraps a `pulsar-client`-compatible consumer. Each message becomes a `DATA` emission.
 * For Kafka-on-Pulsar (KoP), use {@link fromKafka} instead.
 *
 * @param consumer - Pulsar consumer instance (caller owns create/close lifecycle).
 * @param opts - Deserialization and source options.
 * @returns `Node<PulsarMessage<T>>` — one `DATA` per Pulsar message.
 *
 * @remarks
 * Teardown sets an internal flag but cannot interrupt a pending `consumer.receive()`.
 * The loop exits on the next message or when the consumer is closed externally.
 * Callers should call `consumer.close()` after unsubscribing for prompt cleanup.
 *
 * @example
 * ```ts
 * import Pulsar from "pulsar-client";
 * import { fromPulsar } from "@graphrefly/graphrefly-ts";
 *
 * const client = new Pulsar.Client({ serviceUrl: "pulsar://localhost:6650" });
 * const consumer = await client.subscribe({ topic: "events", subscription: "my-sub" });
 * const events$ = fromPulsar(consumer);
 * ```
 *
 * @category extra
 */
export function fromPulsar<T = unknown>(
	consumer: PulsarConsumerLike,
	opts?: FromPulsarOptions & { autoAck?: true },
): Node<PulsarMessage<T>>;
export function fromPulsar<T = unknown>(
	consumer: PulsarConsumerLike,
	opts: FromPulsarOptions & { autoAck: false },
): Node<AckableMessage<PulsarMessage<T>>>;
export function fromPulsar<T = unknown>(
	consumer: PulsarConsumerLike,
	opts?: FromPulsarOptions,
): Node<PulsarMessage<T> | AckableMessage<PulsarMessage<T>>> {
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

	return node<PulsarMessage<T> | AckableMessage<PulsarMessage<T>>>(
		[],
		(_data, a) => {
			let active = true;

			const loop = async () => {
				while (active) {
					try {
						const rawMsg = await consumer.receive();
						if (!active) return;
						const structured: PulsarMessage<T> = {
							topic: rawMsg.getTopicName(),
							messageId: rawMsg.getMessageId().toString(),
							key: rawMsg.getPartitionKey(),
							value: deserialize(rawMsg.getData()) as T,
							properties: rawMsg.getProperties(),
							publishTime: rawMsg.getPublishTimestamp(),
							eventTime: rawMsg.getEventTimestamp(),
							timestampNs: wallClockNs(),
						};
						if (autoAck) {
							a.emit(structured);
							void consumer.acknowledge(rawMsg).catch(reportAckError);
						} else {
							// Manual ack — wrap in AckableMessage. Pulsar's SDK has no
							// per-message nack(requeue=false) — a plain `nack` re-delivers
							// after the subscription's negativeAckRedeliveryDelay. `requeue`
							// is honored as "always redeliver" (SDK default).
							let settled = false;
							const envelope: AckableMessage<PulsarMessage<T>> = {
								value: structured,
								ack() {
									if (settled) return;
									settled = true;
									void consumer.acknowledge(rawMsg).catch(reportAckError);
								},
								nack(_opts) {
									if (settled) return;
									settled = true;
									const anyConsumer = consumer as unknown as {
										negativeAcknowledge?: (m: unknown) => Promise<void> | void;
									};
									try {
										const result = anyConsumer.negativeAcknowledge?.(rawMsg);
										// nack may return Promise (some SDKs) — route rejection.
										if (result && typeof (result as Promise<void>).then === "function") {
											void (result as Promise<void>).catch(reportAckError);
										}
									} catch (err) {
										reportAckError(err);
									}
								},
							};
							a.emit(envelope);
						}
					} catch (err) {
						if (active) a.down([[ERROR, err]]);
						return;
					}
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

/** Options for {@link toPulsar}. */
export type ToPulsarOptions<T> = ExtraOpts & {
	/** Serialize value for Pulsar. Default: `JSON.stringify` → Buffer. */
	serialize?: (value: T) => Buffer;
	/** Extract partition key from value. Default: none. */
	keyExtractor?: (value: T) => string | undefined;
	/** Extract properties from value. */
	propertiesExtractor?: (value: T) => Record<string, string> | undefined;
	/** Called on serialization or send failures. */
	onTransportError?: (err: SinkTransportError) => void;
};

/**
 * Pulsar producer sink — forwards upstream `DATA` to a Pulsar topic.
 *
 * @param source - Upstream node to forward.
 * @param pulsarProducer - Pulsar producer instance (caller owns lifecycle).
 * @param opts - Serialization options.
 * @returns Unsubscribe function.
 *
 * @category extra
 */
export function toPulsar<T>(
	source: Node<T>,
	pulsarProducer: PulsarProducerLike,
	opts?: ToPulsarOptions<T>,
): ReactiveSinkHandle<T> {
	const {
		serialize = (v: T) => Buffer.from(JSON.stringify(v)),
		keyExtractor,
		propertiesExtractor,
		onTransportError,
	} = opts ?? {};
	return reactiveSink<T>(source, {
		onTransportError,
		send: async (value) => {
			await pulsarProducer.send({
				data: serialize(value),
				partitionKey: keyExtractor?.(value),
				properties: propertiesExtractor?.(value),
			});
		},
	});
}
