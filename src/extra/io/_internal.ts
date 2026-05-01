/**
 * Internal helpers shared by IO sub-files.
 *
 * - `ExtraOpts` / `sourceOpts` — common opts + the `describeKind: "producer"`
 *   wrapper used by every producer-shaped IO source.
 * - `SinkHandle` / `BufferedSinkHandle` — public sink handle shapes shared by
 *   per-record and buffered sinks across multiple protocols.
 * - `AdapterHandlers` / `AckableMessage` — alias of `EmitTriad` and the
 *   manual-ack envelope used by Pulsar / RabbitMQ ingest sub-files.
 * - `AttachStorageGraphLike` — duck-typed graph shape used by
 *   `checkpointToS3` / `checkpointToRedis`.
 */

import type { Node, NodeOptions } from "../../core/node.js";
import type { GraphCheckpointRecord } from "../../graph/graph.js";
import type { EmitTriad } from "../composition/external-register.js";
import type { SinkTransportError } from "../reactive-sink.js";
import type { SnapshotStorageTier } from "../storage/tiers.js";

export type ExtraOpts = Omit<NodeOptions, "describeKind">;

export function sourceOpts<T>(opts?: ExtraOpts): NodeOptions<T> {
	return { describeKind: "producer", ...opts } as NodeOptions<T>;
}

/** Handle returned by per-record and buffered sinks. */
export type SinkHandle = {
	/** Stop the sink (unsubscribe from source). */
	dispose: () => void;
	/** Reactive node that emits the latest transport error (or `null`). */
	errors: Node<SinkTransportError | null>;
	/** Manually drain the internal buffer (buffered sinks only). */
	flush?: () => Promise<void>;
};

/** Handle returned by buffered sinks. `flush()` drains remaining buffer. */
export type BufferedSinkHandle = SinkHandle & {
	/** Manually drain the internal buffer. */
	flush: () => Promise<void>;
};

/** Standard handler triple for adapters that accept injected registrations. Alias of {@link EmitTriad}. */
export type AdapterHandlers<T> = EmitTriad<T>;

/**
 * Message envelope emitted by queue consumers when `autoAck: false`. The
 * caller is responsible for calling `ack()` after successful processing or
 * `nack()` to re-queue / dead-letter. Pairs cleanly with reactive pipelines:
 *
 * ```ts
 * const messages$ = fromPulsar(consumer, { autoAck: false });
 * effect([messages$], ([m]) => {
 *   try {
 *     process(m.value);
 *     m.ack();
 *   } catch (err) {
 *     m.nack({ requeue: true });
 *   }
 * });
 * ```
 *
 * Ack/nack are imperative callbacks (§5.10 boundary) because the underlying
 * SDKs expose them as such. Reactive-all-the-way ack flows can be built by
 * piping `msg.ack` calls into a `reactiveSink` if desired.
 *
 * **Caller contract — must settle every emitted message.** The envelope holds
 * a closure reference to the raw SDK message; unsettled envelopes keep the
 * broker's in-flight window full and leak memory proportional to consumer
 * throughput. Patterns that drop messages (filter, take-first, switchMap
 * discard) must explicitly `nack({ requeue: true })` the discarded ones, or
 * wrap the source to force-settle on teardown.
 *
 * **Ack/nack transport failures.** Both methods route exceptions through
 * the source's `onAckError` option (when provided) — SDK rejections from
 * `acknowledge()`/`negativeAcknowledge()` don't escape as unhandled
 * rejections. Default (no `onAckError`): swallow. The broker handles
 * redelivery on its own timeline.
 *
 * @category extra
 */
export type AckableMessage<T> = {
	/** The wrapped message body. */
	value: T;
	/** Acknowledge successful processing. Safe to call more than once — idempotent. */
	ack(): void;
	/**
	 * Negative-acknowledge — signals the broker the message was not processed
	 * successfully. `requeue: true` asks the broker to redeliver; `requeue: false`
	 * may route to a dead-letter queue (SDK-specific). Omit `requeue` to
	 * defer to the SDK's own default.
	 */
	nack(opts?: { requeue?: boolean }): void;
};

/** Duck-typed graph shape consumed by `checkpointToS3` / `checkpointToRedis`. */
export type AttachStorageGraphLike = {
	attachSnapshotStorage: (
		tiers: readonly SnapshotStorageTier<GraphCheckpointRecord>[],
		opts?: unknown,
	) => { dispose(): void };
	name: string;
};
