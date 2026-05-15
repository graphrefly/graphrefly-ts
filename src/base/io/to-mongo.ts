/**
 * MongoDB insert sink IO — `toMongo` inserts each upstream `DATA` value via
 * the duck-typed {@link MongoCollectionLike} `insertOne()`.
 */

import type { Node } from "@graphrefly/pure-ts/core/node.js";
import type { ExtraOpts } from "./_internal.js";
import { type ReactiveSinkHandle, reactiveSink, type SinkTransportError } from "./_sink.js";

/** Duck-typed MongoDB collection (compatible with `mongodb` driver). */
export type MongoCollectionLike = {
	insertOne(doc: unknown): Promise<unknown>;
};

/** Options for {@link toMongo}. */
export type ToMongoOptions<T> = ExtraOpts & {
	/** Transform value to a MongoDB document. Default: identity. */
	toDocument?: (value: T) => unknown;
	onTransportError?: (err: SinkTransportError) => void;
};

/**
 * MongoDB sink — inserts each upstream `DATA` value as a document.
 *
 * @param source - Upstream node.
 * @param collection - MongoDB collection with `insertOne()`.
 * @param opts - Document transform and error options.
 * @returns Unsubscribe function.
 *
 * @category extra
 */
export function toMongo<T>(
	source: Node<T>,
	collection: MongoCollectionLike,
	opts?: ToMongoOptions<T>,
): ReactiveSinkHandle<T> {
	const { toDocument = (v: T) => v, onTransportError } = opts ?? {};
	return reactiveSink<T>(source, {
		onTransportError,
		serialize: toDocument,
		send: async (doc) => {
			await collection.insertOne(doc);
		},
	});
}
