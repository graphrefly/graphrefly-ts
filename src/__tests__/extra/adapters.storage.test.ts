/**
 * Tests for 5.2d storage & sink adapters (src/extra/adapters.ts).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { COMPLETE, DATA, ERROR } from "../../core/messages.js";
import {
	type BufferedSinkHandle,
	type ClickHouseInsertClientLike,
	checkpointToRedis,
	checkpointToS3,
	type FileWriterLike,
	fromSqlite,
	type LokiClientLike,
	type MongoCollectionLike,
	type PostgresClientLike,
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

function tick(ms = 0): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
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
		const src = fromIter([1, 2, 3]);
		const handle = toFile(src, writer);
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
		const src = fromIter(["a", "b"]);
		const handle = toFile(src, writer, { serialize: (v) => `LINE:${v}\n` });
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
		const src = fromIter([1]);
		const handle = toFile(src, writer, {
			serialize: () => {
				throw new Error("bad");
			},
			onTransportError: (e) => errors.push(e),
		});
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
		const src = fromIter([1]);
		const handle = toFile(src, writer, {
			onTransportError: (e) => errors.push(e),
		});
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
		const src = fromIter([
			{ name: "Alice", age: "30" },
			{ name: "Bob", age: "25" },
		]);
		const handle = toCSV(src, writer, { columns: ["name", "age"] });
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
		const src = fromIter([{ val: "has,comma" }, { val: 'has"quote' }]);
		const handle = toCSV(src, writer, {
			columns: ["val"],
			writeHeader: false,
		});
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
		const src = fromIter([{ a: "1", b: "2" }]);
		const handle = toCSV(src, writer, {
			columns: ["a", "b"],
			delimiter: "\t",
		});
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
		const src = fromIter([1, 2]);
		const handle = toClickHouse(src, client, "t", {
			batchSize: 10,
			transform: (v) => ({ val: v * 10 }),
		});
		handle.dispose();
		expect(inserted).toEqual([[{ val: 10 }, { val: 20 }]]);
	});

	it("reports transform errors via onTransportError", () => {
		const errors: unknown[] = [];
		const client: ClickHouseInsertClientLike = {
			insert: async () => {},
		};
		const src = fromIter([1]);
		const handle = toClickHouse(src, client, "t", {
			batchSize: 10,
			transform: () => {
				throw new Error("transform fail");
			},
			onTransportError: (e) => errors.push(e),
		});
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
		const src = fromIter([{ a: 1 }, { b: 2 }]);
		const handle = toS3(src, client, "my-bucket", {
			batchSize: 10,
			keyGenerator: (seq) => `batch-${seq}.ndjson`,
		});
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
		const src = fromIter([{ x: 1 }, { x: 2 }]);
		const unsub = toPostgres(src, client, "events");
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
		const src = fromIter([1]);
		const unsub = toPostgres(src, client, "t", {
			toSQL: () => {
				throw new Error("bad sql");
			},
			onTransportError: (e) => errors.push(e),
		});
		expect(errors).toHaveLength(1);
		expect((errors[0] as { stage: string }).stage).toBe("serialize");
		unsub();
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
		const src = fromIter([{ a: 1 }, { b: 2 }]);
		const unsub = toMongo(src, collection);
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
		const src = fromIter([1, 2]);
		const unsub = toMongo(src, collection, {
			toDocument: (v) => ({ value: v, ts: "now" }),
		});
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
		const src = fromIter(["log line 1"]);
		const unsub = toLoki(src, client, {
			labels: { job: "test" },
			toLine: (v) => v,
		});
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
		const unsub = toLoki(src, client, {
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
		const src = fromIter([span]);
		const unsub = toTempo(src, client);
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
	it("creates an autoCheckpoint adapter that saves to S3", () => {
		const saved: unknown[] = [];
		const s3: S3ClientLike = {
			putObject: async (params) => {
				saved.push(params);
			},
		};
		let savedAdapter: { save(data: unknown): void } | undefined;
		const mockGraph = {
			name: "test-graph",
			autoCheckpoint: (adapter: { save(data: unknown): void }, _opts?: unknown) => {
				savedAdapter = adapter;
				return { dispose: () => {} };
			},
		};
		const handle = checkpointToS3(mockGraph, s3, "my-bucket", { prefix: "cp/" });
		expect(handle.dispose).toBeTypeOf("function");
		// Simulate the adapter being called
		savedAdapter!.save({ snapshot: true });
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
	it("creates an autoCheckpoint adapter that saves to Redis", () => {
		const saved: { key: string; value: string }[] = [];
		const redis = {
			set: async (key: string, value: string) => {
				saved.push({ key, value });
			},
			get: async () => null,
		};
		let savedAdapter: { save(data: unknown): void } | undefined;
		const mockGraph = {
			name: "my-graph",
			autoCheckpoint: (adapter: { save(data: unknown): void }, _opts?: unknown) => {
				savedAdapter = adapter;
				return { dispose: () => {} };
			},
		};
		const handle = checkpointToRedis(mockGraph, redis);
		expect(handle.dispose).toBeTypeOf("function");
		savedAdapter!.save({ snapshot: true });
		expect(saved).toHaveLength(1);
		expect(saved[0].key).toBe("graphrefly:checkpoint:my-graph");
		expect(JSON.parse(saved[0].value)).toEqual({ snapshot: true });
	});
});

// ——————————————————————————————————————————————————————————————
//  fromSqlite
// ——————————————————————————————————————————————————————————————

describe("fromSqlite", () => {
	it("emits one DATA per row then COMPLETE", () => {
		const rows = [
			{ id: 1, name: "Alice" },
			{ id: 2, name: "Bob" },
		];
		const db: SqliteDbLike = { query: () => rows };
		const msgs: [symbol, unknown?][] = [];
		fromSqlite(db, "SELECT * FROM users").subscribe((m) => {
			for (const msg of m) msgs.push(msg);
		});
		expect(msgs).toEqual([
			[DATA, { id: 1, name: "Alice" }],
			[DATA, { id: 2, name: "Bob" }],
			[COMPLETE],
		]);
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

	it("applies mapRow to each row", () => {
		const db: SqliteDbLike = { query: () => [{ v: 10 }, { v: 20 }] };
		const values: number[] = [];
		fromSqlite<number>(db, "SELECT v FROM t", {
			mapRow: (r) => (r as { v: number }).v * 2,
		}).subscribe((m) => {
			for (const msg of m) if (msg[0] === DATA) values.push(msg[1] as number);
		});
		expect(values).toEqual([20, 40]);
	});

	it("emits ERROR when db.query throws", () => {
		const db: SqliteDbLike = {
			query: () => {
				throw new Error("no such table");
			},
		};
		const msgs: [symbol, unknown?][] = [];
		fromSqlite(db, "SELECT * FROM missing").subscribe((m) => {
			for (const msg of m) msgs.push(msg);
		});
		expect(msgs).toHaveLength(1);
		expect(msgs[0][0]).toBe(ERROR);
		expect((msgs[0][1] as Error).message).toBe("no such table");
	});

	it("emits COMPLETE with zero rows", () => {
		const db: SqliteDbLike = { query: () => [] };
		const msgs: [symbol, unknown?][] = [];
		fromSqlite(db, "SELECT * FROM empty").subscribe((m) => {
			for (const msg of m) msgs.push(msg);
		});
		expect(msgs).toEqual([[COMPLETE]]);
	});

	it("emits ERROR with no partial DATA when mapRow throws", () => {
		let callCount = 0;
		const db: SqliteDbLike = { query: () => [{ v: 1 }, { v: 2 }, { v: 3 }] };
		const msgs: [symbol, unknown?][] = [];
		fromSqlite(db, "SELECT v FROM t", {
			mapRow: (r) => {
				callCount++;
				if (callCount === 2) throw new Error("bad row");
				return r;
			},
		}).subscribe((m) => {
			for (const msg of m) msgs.push(msg);
		});
		// Pre-map: error occurs before batch, so no partial DATA emitted
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
		const src = fromIter([{ x: 1 }, { x: 2 }]);
		const unsub = toSqlite(src, db, "events");
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
		const unsub = toSqlite(src, db, "nums", {
			toSQL: (v, t) => ({ sql: `INSERT INTO "${t}" (n) VALUES (?)`, params: [v] }),
		});
		expect(queries[0].params).toEqual([42]);
		unsub();
	});

	it("reports toSQL errors via onTransportError (serialize stage)", () => {
		const errors: unknown[] = [];
		const db: SqliteDbLike = { query: () => [] };
		const src = fromIter([1]);
		const unsub = toSqlite(src, db, "t", {
			toSQL: () => {
				throw new Error("bad sql");
			},
			onTransportError: (e) => errors.push(e),
		});
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
		const src = fromIter([1]);
		const unsub = toSqlite(src, db, "t", {
			onTransportError: (e) => errors.push(e),
		});
		expect(errors).toHaveLength(1);
		expect((errors[0] as { stage: string }).stage).toBe("send");
		expect((errors[0] as { error: Error }).error.message).toBe("disk full");
		unsub();
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
});
