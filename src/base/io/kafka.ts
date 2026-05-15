/**
 * Kafka IO — `fromKafka` (KafkaJS-compatible consumer source) and
 * `toKafka` (producer sink). Compatible with Pulsar via KoP (Kafka-on-Pulsar).
 */

import { wallClockNs } from "@graphrefly/pure-ts/core/clock.js";
import { ERROR } from "@graphrefly/pure-ts/core/messages.js";
import { type Node, node } from "@graphrefly/pure-ts/core/node.js";
import {
	type ReactiveSinkHandle,
	reactiveSink,
	type SinkTransportError,
} from "../reactive-sink.js";
import { type ExtraOpts, sourceOpts } from "./_internal.js";

/** Duck-typed Kafka consumer (compatible with kafkajs, confluent-kafka, Pulsar KoP). */
export type KafkaConsumerLike = {
	subscribe(opts: { topic: string; fromBeginning?: boolean }): Promise<void>;
	run(opts: {
		eachMessage: (payload: {
			topic: string;
			partition: number;
			message: {
				key: Buffer | null;
				value: Buffer | null;
				headers?: Record<string, Buffer | string | undefined>;
				offset: string;
				timestamp: string;
			};
		}) => Promise<void>;
	}): Promise<void>;
	disconnect(): Promise<void>;
};

/** Duck-typed Kafka producer. */
export type KafkaProducerLike = {
	send(record: {
		topic: string;
		messages: Array<{
			key?: string | Buffer | null;
			value: string | Buffer | null;
			headers?: Record<string, string | Buffer>;
		}>;
	}): Promise<void>;
	disconnect(): Promise<void>;
};

/** Structured Kafka message. */
export type KafkaMessage<T = unknown> = {
	topic: string;
	partition: number;
	key: string | null;
	value: T;
	headers: Record<string, string>;
	offset: string;
	timestamp: string;
	timestampNs: number;
};

/** Options for {@link fromKafka}. */
export type FromKafkaOptions = ExtraOpts & {
	/** Start from beginning of topic. Default: `false`. */
	fromBeginning?: boolean;
	/** Deserialize message value. Default: `JSON.parse(buffer.toString())`. */
	deserialize?: (value: Buffer | null) => unknown;
};

/**
 * Kafka consumer as a reactive source.
 *
 * Wraps a KafkaJS-compatible consumer. Each message becomes a `DATA` emission.
 * Compatible with Pulsar via KoP (Kafka-on-Pulsar).
 *
 * @param consumer - KafkaJS-compatible consumer instance (caller owns connect/disconnect lifecycle).
 * @param topic - Topic to consume from.
 * @param opts - Deserialization and source options.
 * @returns `Node<KafkaMessage<T>>` — one `DATA` per Kafka message.
 *
 * @example
 * ```ts
 * import { Kafka } from "kafkajs";
 * import { fromKafka } from "@graphrefly/graphrefly-ts";
 *
 * const kafka = new Kafka({ brokers: ["localhost:9092"] });
 * const consumer = kafka.consumer({ groupId: "my-group" });
 * await consumer.connect();
 *
 * const events$ = fromKafka(consumer, "events", { deserialize: (buf) => JSON.parse(buf!.toString()) });
 * ```
 *
 * @category extra
 */
export function fromKafka<T = unknown>(
	consumer: KafkaConsumerLike,
	topic: string,
	opts?: FromKafkaOptions,
): Node<KafkaMessage<T>> {
	const {
		fromBeginning = false,
		deserialize = (buf: Buffer | null) => {
			if (buf === null) return null;
			try {
				return JSON.parse(buf.toString());
			} catch {
				return buf.toString();
			}
		},
		...rest
	} = opts ?? {};

	return node<KafkaMessage<T>>(
		[],
		(_data, a) => {
			let active = true;

			const start = async () => {
				try {
					await consumer.subscribe({ topic, fromBeginning });
					await consumer.run({
						eachMessage: async ({ topic: t, partition, message: msg }) => {
							if (!active) return;
							const headers: Record<string, string> = {};
							if (msg.headers) {
								for (const [k, v] of Object.entries(msg.headers)) {
									if (v !== undefined) headers[k] = typeof v === "string" ? v : v.toString();
								}
							}
							a.emit({
								topic: t,
								partition,
								key: msg.key?.toString() ?? null,
								value: deserialize(msg.value) as T,
								headers,
								offset: msg.offset,
								timestamp: msg.timestamp,
								timestampNs: wallClockNs(),
							});
						},
					});
				} catch (err) {
					if (active) a.down([[ERROR, err]]);
				}
			};

			void start();

			return () => {
				active = false;
			};
		},
		sourceOpts(rest),
	);
}

/** Options for {@link toKafka}. */
export type ToKafkaOptions<T> = ExtraOpts & {
	/** Serialize value for Kafka. Default: `JSON.stringify`. */
	serialize?: (value: T) => string | Buffer;
	/** Extract message key from value. Default: `null` (no key). */
	keyExtractor?: (value: T) => string | null;
	/** Called on serialization or send failures. */
	onTransportError?: (err: SinkTransportError) => void;
};

/**
 * Kafka producer sink — forwards upstream `DATA` to a Kafka topic.
 *
 * @param source - Upstream node to forward.
 * @param kafkaProducer - KafkaJS-compatible producer instance.
 * @param topic - Target topic.
 * @param opts - Serialization and key extraction options.
 * @returns Unsubscribe function.
 *
 * @category extra
 */
export function toKafka<T>(
	source: Node<T>,
	kafkaProducer: KafkaProducerLike,
	topic: string,
	opts?: ToKafkaOptions<T>,
): ReactiveSinkHandle<T> {
	const { serialize = (v: T) => JSON.stringify(v), keyExtractor, onTransportError } = opts ?? {};
	return reactiveSink<T>(source, {
		onTransportError,
		send: async (value) => {
			const key = keyExtractor?.(value) ?? null;
			const serialized = serialize(value);
			await kafkaProducer.send({
				topic,
				messages: [{ key, value: Buffer.from(serialized as string) }],
			});
		},
	});
}
