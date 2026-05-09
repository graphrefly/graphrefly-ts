/**
 * Tests for 5.2d storage & sink adapters (src/extra/adapters.ts).
 */
import { describe, expect, it } from "vitest";
import { COMPLETE, DATA, DIRTY, ERROR } from "../../core/messages.js";
import type { Node } from "../../core/node.js";
import { node } from "../../core/node.js";
import {
	type ClickHouseInsertClientLike,
	checkpointToRedis,
	checkpointToS3,
	type DrizzleQueryLike,
	type FileWriterLike,
	fromDrizzle,
	fromKysely,
	fromPrisma,
	fromSqlite,
	type KyselyQueryLike,
	type LokiClientLike,
	type MongoCollectionLike,
	type PostgresClientLike,
	type PrismaModelLike,
	type S3ClientLike,
	type SqliteDbLike,
	type TempoClientLike,
	toClickHouse,
	toCSV,
	toFile,
	toLoki,
	toMongo,
	toPostgres,
	toS3,
	toSqlite,
	toTempo,
} from "../../extra/adapters.js";
import { fromIter } from "../../extra/sources.js";
import { collectFlat } from "../test-helpers.js";

function tick(ms = 0): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

/**
 * Creates a source node with no cached value (SENTINEL), so push-on-subscribe
 * does not replay any value. Call `send(v)` to push DATA, `complete()` to push
 * COMPLETE, `error(e)` to push ERROR.
 */
function manualSource<T>(): {
	src: Node<T>;
	send: (v: T) => void;
	complete: () => void;
	error: (e: unknown) => void;
} {
	const src = node<T>();
	return {
		src,
		send: (v: T) => src.down([[DATA, v]]),
		complete: () => src.down([[COMPLETE]]),
		error: (e: unknown) => src.down([[ERROR, e]]),
	};
}

// ——————————————————————————————————————————————————————————————
//  toFile
// ——————————————————————————————————————————————————————————————

describe("toFile", () => {
	it("writes each DATA value immediately in write-through mode", () => {
		const chunks: string[] = [];
		const writer: FileWriterLike = {
			write: (d) => {
				chunks.push(d as string);
			},
			end: () => {},
		};
		const { src, send, complete } = manualSource<number>();
		const handle = toFile(src, writer);
		send(1);
		send(2);
		send(3);
		complete();
		expect(chunks).toEqual(["1\n", "2\n", "3\n"]);
		handle.dispose();
	});

	it("uses custom serialize", () => {
		const chunks: string[] = [];
		const writer: FileWriterLike = {
			write: (d) => {
				chunks.push(d as string);
			},
			end: () => {},
		};
		const { src, send, complete } = manualSource<string>();
		const handle = toFile(src, writer, { serialize: (v) => `LINE:${v}\n` });
		send("a");
		send("b");
		complete();
		expect(chunks).toEqual(["LINE:a\n", "LINE:b\n"]);
		handle.dispose();
	});

	it("buffers with batchSize and flushes on COMPLETE", () => {
		const chunks: string[] = [];
		const writer: FileWriterLike = {
			write: (d) => {
				chunks.push(d as string);
			},
			end: () => {},
		};
		const src = fromIter([1, 2, 3]);
		const handle = toFile(src, writer, { batchSize: 5 });
		// COMPLETE from fromIter triggers flush of buffered items
		expect(chunks).toEqual(["1\n2\n3\n"]);
		handle.dispose();
	});

	it("auto-flushes when batchSize reached and on COMPLETE", () => {
		const chunks: string[] = [];
		const writer: FileWriterLike = {
			write: (d) => {
				chunks.push(d as string);
			},
			end: () => {},
		};
		const src = fromIter([1, 2, 3, 4, 5]);
		const handle = toFile(src, writer, { batchSize: 2 });
		// 2 full batches auto-flushed (1,2) and (3,4), remainder (5) flushed on COMPLETE
		expect(chunks).toEqual(["1\n2\n", "3\n4\n", "5\n"]);
		handle.dispose();
	});

	it("calls onTransportError on serialize failure", () => {
		const errors: unknown[] = [];
		const writer: FileWriterLike = {
			write: () => {},
			end: () => {},
		};
		const { src, send } = manualSource<number>();
		const handle = toFile(src, writer, {
			serialize: () => {
				throw new Error("bad");
			},
			onTransportError: (e) => errors.push(e),
		});
		send(1);
		expect(errors).toHaveLength(1);
		expect((errors[0] as { stage: string }).stage).toBe("serialize");
		handle.dispose();
	});

	it("calls onTransportError on write failure", () => {
		const errors: unknown[] = [];
		const writer: FileWriterLike = {
			write: () => {
				throw new Error("disk full");
			},
			end: () => {},
		};
		const { src, send } = manualSource<number>();
		const handle = toFile(src, writer, {
			onTransportError: (e) => errors.push(e),
		});
		send(1);
		expect(errors).toHaveLength(1);
		expect((errors[0] as { stage: string }).stage).toBe("send");
		handle.dispose();
	});
});

// ——————————————————————————————————————————————————————————————
//  toCSV
// ——————————————————————————————————————————————————————————————

describe("toCSV", () => {
	it("writes header + rows", () => {
		const chunks: string[] = [];
		const writer: FileWriterLike = {
			write: (d) => {
				chunks.push(d as string);
			},
			end: () => {},
		};
		const { src, send, complete } = manualSource<Record<string, string>>();
		const handle = toCSV(src, writer, { columns: ["name", "age"] });
		send({ name: "Alice", age: "30" });
		send({ name: "Bob", age: "25" });
		complete();
		expect(chunks).toEqual(["name,age\nAlice,30\n", "Bob,25\n"]);
		handle.dispose();
	});

	it("escapes fields with delimiters and quotes", () => {
		const chunks: string[] = [];
		const writer: FileWriterLike = {
			write: (d) => {
				chunks.push(d as string);
			},
			end: () => {},
		};
		const { src, send, complete } = manualSource<Record<string, string>>();
		const handle = toCSV(src, writer, {
			columns: ["val"],
			writeHeader: false,
		});
		send({ val: "has,comma" });
		send({ val: 'has"quote' });
		complete();
		expect(chunks).toEqual(['"has,comma"\n', '"has""quote"\n']);
		handle.dispose();
	});

	it("supports custom delimiter", () => {
		const chunks: string[] = [];
		const writer: FileWriterLike = {
			write: (d) => {
				chunks.push(d as string);
			},
			end: () => {},
		};
		const { src, send, complete } = manualSource<Record<string, string>>();
		const handle = toCSV(src, writer, {
			columns: ["a", "b"],
			delimiter: "\t",
		});
		send({ a: "1", b: "2" });
		complete();
		expect(chunks).toEqual(["a\tb\n1\t2\n"]);
		handle.dispose();
	});
});

// ——————————————————————————————————————————————————————————————
//  toClickHouse
// ——————————————————————————————————————————————————————————————

describe("toClickHouse", () => {
	it("buffers and flushes on batchSize", () => {
		const inserted: unknown[][] = [];
		const client: ClickHouseInsertClientLike = {
			insert: async (params) => {
				inserted.push(params.values);
			},
		};
		const src = fromIter([1, 2, 3]);
		const handle = toClickHouse(src, client, "events", { batchSize: 2 });
		// 1 batch of [1,2] auto-flushed, remaining [3] flushed on COMPLETE
		expect(inserted).toEqual([[1, 2], [3]]);
		handle.dispose();
	});

	it("uses custom transform", () => {
		const inserted: unknown[][] = [];
		const client: ClickHouseInsertClientLike = {
			insert: async (params) => {
				inserted.push(params.values);
			},
		};
		const { src, send, complete } = manualSource<number>();
		const handle = toClickHouse(src, client, "t", {
			batchSize: 10,
			transform: (v) => ({ val: v * 10 }),
		});
		send(1);
		send(2);
		complete();
		handle.dispose();
		expect(inserted).toEqual([[{ val: 10 }, { val: 20 }]]);
	});

	it("reports transform errors via onTransportError", () => {
		const errors: unknown[] = [];
		const client: ClickHouseInsertClientLike = {
			insert: async () => {},
		};
		const { src, send } = manualSource<number>();
		const handle = toClickHouse(src, client, "t", {
			batchSize: 10,
			transform: () => {
				throw new Error("transform fail");
			},
			onTransportError: (e) => errors.push(e),
		});
		send(1);
		expect(errors).toHaveLength(1);
		expect((errors[0] as { stage: string }).stage).toBe("serialize");
		handle.dispose();
	});
});

// ——————————————————————————————————————————————————————————————
//  toS3
// ——————————————————————————————————————————————————————————————

describe("toS3", () => {
	it("buffers and flushes NDJSON on dispose", () => {
		const uploads: { key: string; body: string }[] = [];
		const client: S3ClientLike = {
			putObject: async (params) => {
				uploads.push({ key: params.Key, body: params.Body as string });
			},
		};
		const { src, send, complete } = manualSource<Record<string, number>>();
		const handle = toS3(src, client, "my-bucket", {
			batchSize: 10,
			keyGenerator: (seq) => `batch-${seq}.ndjson`,
		});
		send({ a: 1 });
		send({ b: 2 });
		complete();
		handle.dispose();
		expect(uploads).toHaveLength(1);
		expect(uploads[0].key).toBe("batch-1.ndjson");
		expect(uploads[0].body).toBe('{"a":1}\n{"b":2}\n');
	});

	it("supports JSON format", () => {
		const uploads: { body: string }[] = [];
		const client: S3ClientLike = {
			putObject: async (params) => {
				uploads.push({ body: params.Body as string });
			},
		};
		const src = fromIter([1, 2]);
		const handle = toS3(src, client, "b", {
			format: "json",
			batchSize: 10,
			keyGenerator: (seq) => `batch-${seq}.json`,
		});
		handle.dispose();
		expect(uploads[0].body).toBe("[1,2]");
	});
});

// ——————————————————————————————————————————————————————————————
//  toPostgres
// ——————————————————————————————————————————————————————————————

describe("toPostgres", () => {
	it("inserts each value as a row", async () => {
		const queries: { sql: string; params: unknown[] }[] = [];
		const client: PostgresClientLike = {
			query: async (sql, params) => {
				queries.push({ sql, params: params ?? [] });
			},
		};
		const { src, send, complete } = manualSource<Record<string, number>>();
		const { dispose: unsub } = toPostgres(src, client, "events");
		send({ x: 1 });
		send({ x: 2 });
		complete();
		await tick();
		expect(queries).toHaveLength(2);
		expect(queries[0].sql).toContain('INSERT INTO "events"');
		unsub();
	});

	it("reports toSQL errors via onTransportError", () => {
		const errors: unknown[] = [];
		const client: PostgresClientLike = {
			query: async () => {},
		};
		const { src, send } = manualSource<number>();
		const { dispose: unsub } = toPostgres(src, client, "t", {
			toSQL: () => {
				throw new Error("bad sql");
			},
			onTransportError: (e) => errors.push(e),
		});
		send(1);
		expect(errors).toHaveLength(1);
		expect((errors[0] as { stage: string }).stage).toBe("serialize");
		unsub();
	});

	it("errors node receives errors without callback", async () => {
		const client: PostgresClientLike = {
			query: async () => {
				throw new Error("connection lost");
			},
		};
		const src = fromIter([1]);
		const handle = toPostgres(src, client, "t");
		await tick();
		expect(handle.errors.cache).not.toBeNull();
		expect((handle.errors.cache as { stage: string }).stage).toBe("send");
		handle.dispose();
	});
});

// ——————————————————————————————————————————————————————————————
//  toMongo
// ——————————————————————————————————————————————————————————————

describe("toMongo", () => {
	it("inserts each value as a document", async () => {
		const docs: unknown[] = [];
		const collection: MongoCollectionLike = {
			insertOne: async (doc) => {
				docs.push(doc);
			},
		};
		const { src, send, complete } = manualSource<Record<string, number>>();
		const { dispose: unsub } = toMongo(src, collection);
		send({ a: 1 });
		send({ b: 2 });
		complete();
		await tick();
		expect(docs).toEqual([{ a: 1 }, { b: 2 }]);
		unsub();
	});

	it("uses custom toDocument", async () => {
		const docs: unknown[] = [];
		const collection: MongoCollectionLike = {
			insertOne: async (doc) => {
				docs.push(doc);
			},
		};
		const { src, send, complete } = manualSource<number>();
		const { dispose: unsub } = toMongo(src, collection, {
			toDocument: (v) => ({ value: v, ts: "now" }),
		});
		send(1);
		send(2);
		complete();
		await tick();
		expect(docs).toEqual([
			{ value: 1, ts: "now" },
			{ value: 2, ts: "now" },
		]);
		unsub();
	});
});

// ——————————————————————————————————————————————————————————————
//  toLoki
// ——————————————————————————————————————————————————————————————

describe("toLoki", () => {
	it("pushes log entries with labels", async () => {
		const pushes: unknown[] = [];
		const client: LokiClientLike = {
			push: async (payload) => {
				pushes.push(payload);
			},
		};
		const { src, send, complete } = manualSource<string>();
		const { dispose: unsub } = toLoki(src, client, {
			labels: { job: "test" },
			toLine: (v) => v,
		});
		send("log line 1");
		complete();
		await tick();
		expect(pushes).toHaveLength(1);
		const first = pushes[0] as {
			streams: Array<{ stream: Record<string, string>; values: string[][] }>;
		};
		expect(first.streams[0].stream).toEqual({ job: "test" });
		expect(first.streams[0].values[0][1]).toBe("log line 1");
		unsub();
	});

	it("merges dynamic labels", async () => {
		const pushes: unknown[] = [];
		const client: LokiClientLike = {
			push: async (payload) => {
				pushes.push(payload);
			},
		};
		const src = fromIter([{ level: "error", msg: "fail" }]);
		const { dispose: unsub } = toLoki(src, client, {
			labels: { job: "app" },
			toLine: (v) => v.msg,
			toLabels: (v) => ({ level: v.level }),
		});
		await tick();
		const first = pushes[0] as { streams: Array<{ stream: Record<string, string> }> };
		expect(first.streams[0].stream).toEqual({ job: "app", level: "error" });
		unsub();
	});
});

// ——————————————————————————————————————————————————————————————
//  toTempo
// ——————————————————————————————————————————————————————————————

describe("toTempo", () => {
	it("pushes trace spans", async () => {
		const pushes: unknown[] = [];
		const client: TempoClientLike = {
			push: async (payload) => {
				pushes.push(payload);
			},
		};
		const span = { traceId: "abc", spans: [{ name: "op1" }] };
		const { src, send, complete } = manualSource<typeof span>();
		const { dispose: unsub } = toTempo(src, client);
		send(span);
		complete();
		await tick();
		expect(pushes).toHaveLength(1);
		expect((pushes[0] as { resourceSpans: unknown[] }).resourceSpans).toEqual([span]);
		unsub();
	});
});

// ——————————————————————————————————————————————————————————————
//  checkpointToS3
// ——————————————————————————————————————————————————————————————

describe("checkpointToS3", () => {
	it("attaches a storage tier that saves to S3", () => {
		const saved: unknown[] = [];
		const s3: S3ClientLike = {
			putObject: async (params) => {
				saved.push(params);
			},
		};
		type Tier = { save(data: unknown): void | Promise<void> };
		let capturedTier: Tier | undefined;
		const mockGraph = {
			name: "test-graph",
			attachSnapshotStorage: (pairs: readonly { snapshot: Tier }[], _opts?: unknown) => {
				capturedTier = pairs[0]?.snapshot;
				return { dispose: () => {} };
			},
		};
		const handle = checkpointToS3(mockGraph, s3, "my-bucket", { prefix: "cp/" });
		expect(handle.dispose).toBeTypeOf("function");
		capturedTier!.save({ name: "test-graph", snapshot: true });
		expect(saved).toHaveLength(1);
		const params = saved[0] as { Bucket: string; Key: string };
		expect(params.Bucket).toBe("my-bucket");
		expect(params.Key).toMatch(/^cp\/test-graph\/checkpoint-/);
	});
});

// ——————————————————————————————————————————————————————————————
//  checkpointToRedis
// ——————————————————————————————————————————————————————————————

describe("checkpointToRedis", () => {
	it("attaches a storage tier that saves to Redis", () => {
		const saved: { key: string; value: string }[] = [];
		const redis = {
			set: async (key: string, value: string) => {
				saved.push({ key, value });
			},
			get: async () => null,
		};
		type Tier = { save(data: unknown): void | Promise<void> };
		let capturedTier: Tier | undefined;
		const mockGraph = {
			name: "my-graph",
			attachSnapshotStorage: (pairs: readonly { snapshot: Tier }[], _opts?: unknown) => {
				capturedTier = pairs[0]?.snapshot;
				return { dispose: () => {} };
			},
		};
		const handle = checkpointToRedis(mockGraph, redis);
		expect(handle.dispose).toBeTypeOf("function");
		capturedTier!.save({ name: "my-graph", snapshot: true });
		expect(saved).toHaveLength(1);
		expect(saved[0].key).toBe("graphrefly:checkpoint:my-graph");
		expect(JSON.parse(saved[0].value)).toEqual({ name: "my-graph", snapshot: true });
	});
});

// ——————————————————————————————————————————————————————————————
//  fromSqlite
// ——————————————————————————————————————————————————————————————

describe("fromSqlite", () => {
	it("emits a single DATA with the rows array then COMPLETE", () => {
		const rows = [
			{ id: 1, name: "Alice" },
			{ id: 2, name: "Bob" },
		];
		const db: SqliteDbLike = { query: () => rows };
		const { msgs } = collectFlat(fromSqlite(db, "SELECT * FROM users"));
		expect(msgs).toEqual([[DIRTY], [DATA, rows], [COMPLETE]]);
	});

	it("passes params to db.query", () => {
		let captured: unknown[] | undefined;
		const db: SqliteDbLike = {
			query: (_sql, params) => {
				captured = params;
				return [{ x: 1 }];
			},
		};
		fromSqlite(db, "SELECT * FROM t WHERE id = ?", { params: [42] }).subscribe(() => {});
		expect(captured).toEqual([42]);
	});

	it("applies mapRow to each row (array-emit)", () => {
		const db: SqliteDbLike = { query: () => [{ v: 10 }, { v: 20 }] };
		let received: number[] | undefined;
		fromSqlite<number>(db, "SELECT v FROM t", {
			mapRow: (r) => (r as { v: number }).v * 2,
		}).subscribe((m) => {
			for (const msg of m) if (msg[0] === DATA) received = msg[1] as number[];
		});
		expect(received).toEqual([20, 40]);
	});

	it("emits ERROR when db.query throws", () => {
		const db: SqliteDbLike = {
			query: () => {
				throw new Error("no such table");
			},
		};
		const { msgs } = collectFlat(fromSqlite(db, "SELECT * FROM missing"));
		expect(msgs).toHaveLength(1);
		expect(msgs[0][0]).toBe(ERROR);
		expect((msgs[0][1] as Error).message).toBe("no such table");
	});

	it("emits empty array DATA + COMPLETE with zero rows", () => {
		const db: SqliteDbLike = { query: () => [] };
		const { msgs } = collectFlat(fromSqlite(db, "SELECT * FROM empty"));
		expect(msgs).toEqual([[DIRTY], [DATA, []], [COMPLETE]]);
	});

	it("emits ERROR with no partial DATA when mapRow throws", () => {
		let callCount = 0;
		const db: SqliteDbLike = { query: () => [{ v: 1 }, { v: 2 }, { v: 3 }] };
		const { msgs } = collectFlat(
			fromSqlite(db, "SELECT v FROM t", {
				mapRow: (r) => {
					callCount++;
					if (callCount === 2) throw new Error("bad row");
					return r;
				},
			}),
		);
		expect(msgs).toHaveLength(1);
		expect(msgs[0][0]).toBe(ERROR);
		expect((msgs[0][1] as Error).message).toBe("bad row");
	});
});

// ——————————————————————————————————————————————————————————————
//  toSqlite
// ——————————————————————————————————————————————————————————————

describe("toSqlite", () => {
	it("inserts each value as a row", () => {
		const queries: { sql: string; params: unknown[] }[] = [];
		const db: SqliteDbLike = {
			query: (sql, params) => {
				queries.push({ sql, params: params ?? [] });
				return [];
			},
		};
		const { src, send, complete } = manualSource<Record<string, number>>();
		const { dispose: unsub } = toSqlite(src, db, "events");
		send({ x: 1 });
		send({ x: 2 });
		complete();
		expect(queries).toHaveLength(2);
		expect(queries[0].sql).toContain('INSERT INTO "events"');
		expect(queries[0].params[0]).toBe(JSON.stringify({ x: 1 }));
		unsub();
	});

	it("uses custom toSQL", () => {
		const queries: { sql: string; params: unknown[] }[] = [];
		const db: SqliteDbLike = {
			query: (sql, params) => {
				queries.push({ sql, params: params ?? [] });
				return [];
			},
		};
		const src = fromIter([42]);
		const { dispose: unsub } = toSqlite(src, db, "nums", {
			toSQL: (v, t) => ({ sql: `INSERT INTO "${t}" (n) VALUES (?)`, params: [v] }),
		});
		expect(queries[0].params).toEqual([42]);
		unsub();
	});

	it("reports toSQL errors via onTransportError (serialize stage)", () => {
		const errors: unknown[] = [];
		const db: SqliteDbLike = { query: () => [] };
		const { src, send } = manualSource<number>();
		const { dispose: unsub } = toSqlite(src, db, "t", {
			toSQL: () => {
				throw new Error("bad sql");
			},
			onTransportError: (e) => errors.push(e),
		});
		send(1);
		expect(errors).toHaveLength(1);
		expect((errors[0] as { stage: string }).stage).toBe("serialize");
		unsub();
	});

	it("reports db.query errors via onTransportError (send stage)", () => {
		const errors: unknown[] = [];
		const db: SqliteDbLike = {
			query: () => {
				throw new Error("disk full");
			},
		};
		const { src, send } = manualSource<number>();
		const { dispose: unsub } = toSqlite(src, db, "t", {
			onTransportError: (e) => errors.push(e),
		});
		send(1);
		expect(errors).toHaveLength(1);
		expect((errors[0] as { stage: string }).stage).toBe("send");
		expect((errors[0] as { error: Error }).error.message).toBe("disk full");
		unsub();
	});

	it("errors node receives errors without callback", () => {
		const db: SqliteDbLike = {
			query: () => {
				throw new Error("disk full");
			},
		};
		const src = fromIter([1]);
		const handle = toSqlite(src, db, "t");
		expect(handle.errors.cache).not.toBeNull();
		expect((handle.errors.cache as { stage: string }).stage).toBe("send");
		handle.dispose();
	});

	it("rejects empty table name", () => {
		const db: SqliteDbLike = { query: () => [] };
		const src = fromIter([1]);
		expect(() => toSqlite(src, db, "")).toThrow("invalid table name");
	});

	it("rejects table name with null byte", () => {
		const db: SqliteDbLike = { query: () => [] };
		const src = fromIter([1]);
		expect(() => toSqlite(src, db, "foo\x00bar")).toThrow("invalid table name");
	});

	it("batchInsert wraps inserts in a transaction", () => {
		const queries: string[] = [];
		const db: SqliteDbLike = {
			query: (sql, _params) => {
				queries.push(sql);
				return [];
			},
		};
		const src = fromIter([{ x: 1 }, { x: 2 }, { x: 3 }]);
		const { dispose: unsub } = toSqlite(src, db, "events", { batchInsert: true });
		// Should see: BEGIN, 3 inserts, COMMIT
		expect(queries[0]).toBe("BEGIN");
		expect(queries.filter((q) => q.includes("INSERT"))).toHaveLength(3);
		expect(queries[queries.length - 1]).toBe("COMMIT");
		unsub();
	});

	it("batchInsert rolls back on first error and stops remaining inserts (EC4)", () => {
		const queries: string[] = [];
		const errors: unknown[] = [];
		let callCount = 0;
		const db: SqliteDbLike = {
			query: (sql, _params) => {
				queries.push(sql);
				if (sql.includes("INSERT")) {
					callCount++;
					if (callCount === 2) throw new Error("constraint violation");
				}
				return [];
			},
		};
		const src = fromIter([1, 2, 3]);
		const { dispose: unsub } = toSqlite(src, db, "t", {
			batchInsert: true,
			onTransportError: (e) => errors.push(e),
		});
		expect(queries).toContain("BEGIN");
		expect(queries).toContain("ROLLBACK");
		expect(queries).not.toContain("COMMIT");
		// EC4: only 2 INSERTs attempted (stops on first error, 3rd not attempted)
		expect(queries.filter((q) => q.includes("INSERT"))).toHaveLength(2);
		expect(errors).toHaveLength(1);
		expect((errors[0] as { stage: string }).stage).toBe("send");
		unsub();
	});

	it("batchInsert with no DATA does not emit transaction statements", () => {
		const queries: string[] = [];
		const db: SqliteDbLike = {
			query: (sql) => {
				queries.push(sql);
				return [];
			},
		};
		const src = fromIter<number>([]);
		const { dispose: unsub } = toSqlite(src, db, "t", { batchInsert: true });
		expect(queries.filter((q) => q === "BEGIN")).toHaveLength(0);
		unsub();
	});

	it("batchInsert reports BEGIN failure without losing pending data (P1)", () => {
		const errors: unknown[] = [];
		let beginFails = true;
		const queries: string[] = [];
		const db: SqliteDbLike = {
			query: (sql) => {
				queries.push(sql);
				if (sql === "BEGIN" && beginFails) throw new Error("locked");
				return [];
			},
		};
		const { src, send, complete } = manualSource<number>();
		const handle = toSqlite(src, db, "t", {
			batchInsert: true,
			onTransportError: (e) => errors.push(e),
		});
		send(1);
		complete();
		// COMPLETE triggered flush, BEGIN failed — error reported
		expect(errors).toHaveLength(1);
		expect((errors[0] as { error: Error }).error.message).toBe("locked");
		// No INSERTs attempted since BEGIN failed
		expect(queries.filter((q) => q.includes("INSERT"))).toHaveLength(0);
		// Manual flush after fixing the db succeeds — data was preserved
		beginFails = false;
		handle.flush!();
		expect(queries).toContain("BEGIN");
		expect(queries.filter((q) => q.includes("INSERT"))).toHaveLength(1);
		expect(queries[queries.length - 1]).toBe("COMMIT");
		handle.dispose();
	});

	it("batchInsert auto-flushes at maxBatchSize (BH10)", () => {
		const queries: string[] = [];
		const db: SqliteDbLike = {
			query: (sql) => {
				queries.push(sql);
				return [];
			},
		};
		const src = fromIter([1, 2, 3, 4, 5]);
		const { dispose: unsub } = toSqlite(src, db, "t", {
			batchInsert: true,
			maxBatchSize: 2,
		});
		// 2 transactions: [1,2] auto-flushed at maxBatchSize, [3,4] auto-flushed, [5] flushed on COMPLETE
		const begins = queries.filter((q) => q === "BEGIN");
		const commits = queries.filter((q) => q === "COMMIT");
		expect(begins.length).toBe(3);
		expect(commits.length).toBe(3);
		expect(queries.filter((q) => q.includes("INSERT"))).toHaveLength(5);
		unsub();
	});

	it("batchInsert flushes remaining on dispose (P3)", () => {
		const queries: string[] = [];
		const db: SqliteDbLike = {
			query: (sql) => {
				queries.push(sql);
				return [];
			},
		};
		// Use a node with no initial value so push-on-subscribe does not fire
		const s = node<number>();
		const handle = toSqlite(s, db, "t", { batchInsert: true });
		s.down([[DATA, 1]]);
		s.down([[DATA, 2]]);
		// 2 pending inserts, no terminal message → no flush yet
		expect(queries.filter((q) => q === "BEGIN")).toHaveLength(0);
		handle.dispose();
		// dispose triggers final flush
		expect(queries).toContain("BEGIN");
		expect(queries).toContain("COMMIT");
		expect(queries.filter((q) => q.includes("INSERT"))).toHaveLength(2);
	});

	it("batchInsert dispose is idempotent (BH6)", () => {
		const queries: string[] = [];
		const db: SqliteDbLike = {
			query: (sql) => {
				queries.push(sql);
				return [];
			},
		};
		const { src, send, complete } = manualSource<number>();
		const handle = toSqlite(src, db, "t", { batchInsert: true });
		send(1);
		complete();
		const countBefore = queries.length;
		handle.dispose();
		handle.dispose(); // second call should be no-op
		expect(queries.length).toBe(countBefore);
	});
});

// ——————————————————————————————————————————————————————————————
//  fromPrisma
// ——————————————————————————————————————————————————————————————

describe("fromPrisma", () => {
	it("emits a single DATA with the rows array then COMPLETE", async () => {
		const rows = [
			{ id: 1, name: "Alice" },
			{ id: 2, name: "Bob" },
		];
		const model: PrismaModelLike = { findMany: () => Promise.resolve(rows) };
		const { msgs } = collectFlat(fromPrisma(model));
		await tick();
		expect(msgs).toEqual([[DIRTY], [DATA, rows], [COMPLETE]]);
	});

	it("forwards findMany args", async () => {
		let captured: unknown;
		const model: PrismaModelLike = {
			findMany: (args) => {
				captured = args;
				return Promise.resolve([]);
			},
		};
		fromPrisma(model, { args: { where: { active: true } } }).subscribe(() => {});
		await tick();
		expect(captured).toEqual({ where: { active: true } });
	});

	it("applies mapRow across array elements", async () => {
		const model: PrismaModelLike<{ v: number }> = {
			findMany: () => Promise.resolve([{ v: 10 }, { v: 20 }]),
		};
		let received: number[] | undefined;
		fromPrisma<{ v: number }, number>(model, {
			mapRow: (r) => r.v * 2,
		}).subscribe((m) => {
			for (const msg of m) if (msg[0] === DATA) received = msg[1] as number[];
		});
		await tick();
		expect(received).toEqual([20, 40]);
	});

	it("emits ERROR on query failure", async () => {
		const model: PrismaModelLike = {
			findMany: () => Promise.reject(new Error("connection lost")),
		};
		const { msgs } = collectFlat(fromPrisma(model));
		await tick();
		expect(msgs).toHaveLength(1);
		expect(msgs[0][0]).toBe(ERROR);
		expect((msgs[0][1] as Error).message).toBe("connection lost");
	});

	it("emits empty array DATA + COMPLETE for empty result", async () => {
		const model: PrismaModelLike = { findMany: () => Promise.resolve([]) };
		const { msgs } = collectFlat(fromPrisma(model));
		await tick();
		expect(msgs).toEqual([[DIRTY], [DATA, []], [COMPLETE]]);
	});

	it("cleanup prevents late emission", async () => {
		let resolveFn!: (v: unknown[]) => void;
		const model: PrismaModelLike = {
			findMany: () =>
				new Promise((r) => {
					resolveFn = r;
				}),
		};
		const { msgs, unsub } = collectFlat(fromPrisma(model));
		unsub();
		resolveFn([{ id: 1 }]);
		await tick();
		expect(msgs).toEqual([]);
	});

	it("emits ERROR when mapRow throws", async () => {
		const model: PrismaModelLike = {
			findMany: () => Promise.resolve([{ id: 1 }]),
		};
		const { msgs } = collectFlat(
			fromPrisma(model, {
				mapRow: () => {
					throw new Error("bad map");
				},
			}),
		);
		await tick();
		expect(msgs).toHaveLength(1);
		expect(msgs[0][0]).toBe(ERROR);
		expect((msgs[0][1] as Error).message).toBe("bad map");
	});
});

// ——————————————————————————————————————————————————————————————
//  fromDrizzle
// ——————————————————————————————————————————————————————————————

describe("fromDrizzle", () => {
	it("emits a single DATA with the rows array then COMPLETE", async () => {
		const rows = [{ id: 1 }, { id: 2 }];
		const query: DrizzleQueryLike = { execute: () => Promise.resolve(rows) };
		const { msgs } = collectFlat(fromDrizzle(query));
		await tick();
		expect(msgs).toEqual([[DIRTY], [DATA, rows], [COMPLETE]]);
	});

	it("applies mapRow across array elements", async () => {
		const query: DrizzleQueryLike<{ v: number }> = {
			execute: () => Promise.resolve([{ v: 5 }]),
		};
		let received: number[] | undefined;
		fromDrizzle<{ v: number }, number>(query, {
			mapRow: (r) => r.v + 1,
		}).subscribe((m) => {
			for (const msg of m) if (msg[0] === DATA) received = msg[1] as number[];
		});
		await tick();
		expect(received).toEqual([6]);
	});

	it("emits ERROR on query failure", async () => {
		const query: DrizzleQueryLike = {
			execute: () => Promise.reject(new Error("timeout")),
		};
		const { msgs } = collectFlat(fromDrizzle(query));
		await tick();
		expect(msgs).toHaveLength(1);
		expect(msgs[0][0]).toBe(ERROR);
		expect((msgs[0][1] as Error).message).toBe("timeout");
	});

	it("emits empty array DATA + COMPLETE for empty result", async () => {
		const query: DrizzleQueryLike = { execute: () => Promise.resolve([]) };
		const { msgs } = collectFlat(fromDrizzle(query));
		await tick();
		expect(msgs).toEqual([[DIRTY], [DATA, []], [COMPLETE]]);
	});

	it("cleanup prevents late emission", async () => {
		let resolveFn!: (v: unknown[]) => void;
		const query: DrizzleQueryLike = {
			execute: () =>
				new Promise((r) => {
					resolveFn = r;
				}),
		};
		const { msgs, unsub } = collectFlat(fromDrizzle(query));
		unsub();
		resolveFn([{ id: 1 }]);
		await tick();
		expect(msgs).toEqual([]);
	});

	it("emits ERROR when mapRow throws", async () => {
		const query: DrizzleQueryLike = {
			execute: () => Promise.resolve([{ id: 1 }]),
		};
		const { msgs } = collectFlat(
			fromDrizzle(query, {
				mapRow: () => {
					throw new Error("bad map");
				},
			}),
		);
		await tick();
		expect(msgs).toHaveLength(1);
		expect(msgs[0][0]).toBe(ERROR);
		expect((msgs[0][1] as Error).message).toBe("bad map");
	});
});

// ——————————————————————————————————————————————————————————————
//  fromKysely
// ——————————————————————————————————————————————————————————————

describe("fromKysely", () => {
	it("emits a single DATA with the rows array then COMPLETE", async () => {
		const rows = [{ name: "Alice" }, { name: "Bob" }];
		const query: KyselyQueryLike = { execute: () => Promise.resolve(rows) };
		const { msgs } = collectFlat(fromKysely(query));
		await tick();
		expect(msgs).toEqual([[DIRTY], [DATA, rows], [COMPLETE]]);
	});

	it("applies mapRow across array elements", async () => {
		const query: KyselyQueryLike<{ score: number }> = {
			execute: () => Promise.resolve([{ score: 100 }]),
		};
		let received: string[] | undefined;
		fromKysely<{ score: number }, string>(query, {
			mapRow: (r) => `score:${r.score}`,
		}).subscribe((m) => {
			for (const msg of m) if (msg[0] === DATA) received = msg[1] as string[];
		});
		await tick();
		expect(received).toEqual(["score:100"]);
	});

	it("emits ERROR on query failure", async () => {
		const query: KyselyQueryLike = {
			execute: () => Promise.reject(new Error("syntax error")),
		};
		const { msgs } = collectFlat(fromKysely(query));
		await tick();
		expect(msgs).toHaveLength(1);
		expect(msgs[0][0]).toBe(ERROR);
		expect((msgs[0][1] as Error).message).toBe("syntax error");
	});

	it("emits empty array DATA + COMPLETE for empty result", async () => {
		const query: KyselyQueryLike = { execute: () => Promise.resolve([]) };
		const { msgs } = collectFlat(fromKysely(query));
		await tick();
		expect(msgs).toEqual([[DIRTY], [DATA, []], [COMPLETE]]);
	});

	it("cleanup prevents late emission", async () => {
		let resolveFn!: (v: unknown[]) => void;
		const query: KyselyQueryLike = {
			execute: () =>
				new Promise((r) => {
					resolveFn = r;
				}),
		};
		const { msgs, unsub } = collectFlat(fromKysely(query));
		unsub();
		resolveFn([{ id: 1 }]);
		await tick();
		expect(msgs).toEqual([]);
	});

	it("emits ERROR when mapRow throws", async () => {
		const query: KyselyQueryLike = {
			execute: () => Promise.resolve([{ id: 1 }]),
		};
		const { msgs } = collectFlat(
			fromKysely(query, {
				mapRow: () => {
					throw new Error("bad map");
				},
			}),
		);
		await tick();
		expect(msgs).toHaveLength(1);
		expect(msgs[0][0]).toBe(ERROR);
		expect((msgs[0][1] as Error).message).toBe("bad map");
	});
});
