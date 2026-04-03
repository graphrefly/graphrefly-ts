/**
 * Tests for 5.2c ingest adapters (src/extra/adapters.ts).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { COMPLETE, DATA, ERROR } from "../../core/messages.js";
import {
	fromClickHouseWatch,
	fromCSV,
	fromKafka,
	fromNDJSON,
	fromOTel,
	fromPrometheus,
	fromRedisStream,
	fromStatsD,
	fromSyslog,
	type KafkaConsumerLike,
	type KafkaProducerLike,
	type OTelLog,
	type OTelMetric,
	type OTelSpan,
	parsePrometheusText,
	parseStatsD,
	parseSyslog,
	type RedisClientLike,
	toKafka,
	toRedisStream,
} from "../../extra/adapters.js";
import { fromIter } from "../../extra/sources.js";

function tick(ms = 0): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

// ——————————————————————————————————————————————————————————————
//  fromOTel
// ——————————————————————————————————————————————————————————————

describe("fromOTel", () => {
	it("emits traces, metrics, and logs to separate nodes", () => {
		const traces: unknown[] = [];
		const metrics: unknown[] = [];
		const logs: unknown[] = [];

		// Capture handlers so we can fire after subscribing.
		let fire!: {
			onTraces: (spans: OTelSpan[]) => void;
			onMetrics: (metrics: OTelMetric[]) => void;
			onLogs: (logs: OTelLog[]) => void;
		};

		const bundle = fromOTel((handlers) => {
			fire = handlers;
			return () => {};
		});

		bundle.traces.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === DATA) traces.push(m[1]);
		});
		bundle.metrics.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === DATA) metrics.push(m[1]);
		});
		bundle.logs.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === DATA) logs.push(m[1]);
		});

		// Fire after subscribing.
		fire.onTraces([
			{
				traceId: "abc",
				spanId: "123",
				operationName: "GET /api",
				serviceName: "web",
				startTimeNs: 0,
				endTimeNs: 1000,
				status: "OK",
				attributes: {},
				events: [],
			},
		]);
		fire.onMetrics([
			{
				name: "http_requests_total",
				type: "sum",
				value: 42,
				attributes: {},
				timestampNs: 0,
			},
		]);
		fire.onLogs([
			{
				timestampNs: 0,
				body: "hello",
				attributes: {},
			},
		]);

		expect(traces).toHaveLength(1);
		expect((traces[0] as OTelSpan).operationName).toBe("GET /api");
		expect(metrics).toHaveLength(1);
		expect((metrics[0] as OTelMetric).name).toBe("http_requests_total");
		expect(logs).toHaveLength(1);
		expect((logs[0] as OTelLog).body).toBe("hello");
	});

	it("propagates errors to all signal nodes", () => {
		const errors: unknown[] = [];
		let fireError!: (err: unknown) => void;

		const bundle = fromOTel(({ onError }) => {
			fireError = onError;
			return () => {};
		});

		bundle.traces.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === ERROR) errors.push(m[1]);
		});

		fireError(new Error("receiver down"));

		expect(errors).toHaveLength(1);
		expect((errors[0] as Error).message).toBe("receiver down");
	});
});

// ——————————————————————————————————————————————————————————————
//  fromSyslog + parseSyslog
// ——————————————————————————————————————————————————————————————

describe("fromSyslog + parseSyslog", () => {
	it("parses RFC 5424 syslog lines", () => {
		const msg = parseSyslog("<134>1 2024-01-01T00:00:00Z myhost myapp 1234 ID47 Hello world");
		expect(msg.facility).toBe(16); // 134 >> 3
		expect(msg.severity).toBe(6); // 134 & 7
		expect(msg.hostname).toBe("myhost");
		expect(msg.appName).toBe("myapp");
		expect(msg.procId).toBe("1234");
		expect(msg.msgId).toBe("ID47");
		expect(msg.message).toBe("Hello world");
	});

	it("handles unparseable lines gracefully", () => {
		const msg = parseSyslog("just some raw text");
		expect(msg.message).toBe("just some raw text");
		expect(msg.hostname).toBe("-");
	});

	it("emits parsed syslog messages via register pattern", () => {
		const received: unknown[] = [];

		const node = fromSyslog(({ emit }) => {
			emit(parseSyslog("<134>1 2024-01-01T00:00:00Z host app 1 - test message"));
			return () => {};
		});

		node.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === DATA) received.push(m[1]);
		});

		expect(received).toHaveLength(1);
		expect((received[0] as any).appName).toBe("app");
	});
});

// ——————————————————————————————————————————————————————————————
//  fromStatsD + parseStatsD
// ——————————————————————————————————————————————————————————————

describe("fromStatsD + parseStatsD", () => {
	it("parses basic counter line", () => {
		const m = parseStatsD("requests.count:1|c");
		expect(m.name).toBe("requests.count");
		expect(m.value).toBe(1);
		expect(m.type).toBe("counter");
	});

	it("parses gauge with sample rate and DogStatsD tags", () => {
		const m = parseStatsD("cpu.usage:72.5|g|@0.5|#region:us-east,env:prod");
		expect(m.name).toBe("cpu.usage");
		expect(m.value).toBe(72.5);
		expect(m.type).toBe("gauge");
		expect(m.sampleRate).toBe(0.5);
		expect(m.tags).toEqual({ region: "us-east", env: "prod" });
	});

	it("parses timer, histogram, set, and distribution types", () => {
		expect(parseStatsD("latency:250|ms").type).toBe("timer");
		expect(parseStatsD("latency:250|h").type).toBe("histogram");
		expect(parseStatsD("users:abc123|s").type).toBe("set");
		expect(parseStatsD("latency:250|d").type).toBe("distribution");
	});

	it("throws on invalid StatsD line", () => {
		expect(() => parseStatsD("")).toThrow("Invalid StatsD line");
		expect(() => parseStatsD("novalue")).toThrow("Invalid StatsD line");
	});

	it("emits parsed metrics via register pattern", () => {
		const received: unknown[] = [];

		const node = fromStatsD(({ emit }) => {
			emit(parseStatsD("hits:1|c"));
			emit(parseStatsD("mem:512|g"));
			return () => {};
		});

		node.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === DATA) received.push(m[1]);
		});

		expect(received).toHaveLength(2);
	});
});

// ——————————————————————————————————————————————————————————————
//  fromPrometheus + parsePrometheusText
// ——————————————————————————————————————————————————————————————

describe("parsePrometheusText", () => {
	it("parses exposition format with types, help, and labels", () => {
		const text = `
# HELP http_requests_total Total HTTP requests
# TYPE http_requests_total counter
http_requests_total{method="GET",code="200"} 1027
http_requests_total{method="POST",code="200"} 42
# TYPE node_cpu_seconds_total gauge
node_cpu_seconds_total 3.14
`;
		const metrics = parsePrometheusText(text);
		expect(metrics).toHaveLength(3);
		expect(metrics[0].name).toBe("http_requests_total");
		expect(metrics[0].value).toBe(1027);
		expect(metrics[0].labels).toEqual({ method: "GET", code: "200" });
		expect(metrics[0].type).toBe("counter");
		expect(metrics[0].help).toBe("Total HTTP requests");
		expect(metrics[2].name).toBe("node_cpu_seconds_total");
		expect(metrics[2].value).toBe(3.14);
		expect(metrics[2].type).toBe("gauge");
	});

	it("handles metrics with timestamps", () => {
		const metrics = parsePrometheusText("up 1 1704067200000\n");
		expect(metrics[0].value).toBe(1);
		expect(metrics[0].timestampMs).toBe(1704067200000);
	});

	it("skips blank lines and comments", () => {
		const metrics = parsePrometheusText("\n# just a comment\n\n");
		expect(metrics).toHaveLength(0);
	});
});

describe("fromPrometheus", () => {
	const originalFetch = global.fetch;

	afterEach(() => {
		global.fetch = originalFetch;
		vi.useRealTimers();
	});

	it("scrapes endpoint and emits parsed metrics", async () => {
		vi.useFakeTimers();
		const text = "up 1\nhttp_requests_total 42\n";
		(global as any).fetch = vi.fn().mockResolvedValue({
			ok: true,
			text: async () => text,
		});

		const received: unknown[] = [];
		const node = fromPrometheus("http://localhost:9090/metrics", { intervalNs: 10_000_000_000 });
		const unsub = node.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === DATA) received.push(m[1]);
		});

		// Wait for initial scrape.
		await vi.advanceTimersByTimeAsync(0);

		expect(received).toHaveLength(2);
		expect((received[0] as any).name).toBe("up");
		expect((received[1] as any).name).toBe("http_requests_total");
		unsub();
	});
});

// ——————————————————————————————————————————————————————————————
//  fromKafka / toKafka
// ——————————————————————————————————————————————————————————————

describe("fromKafka", () => {
	it("emits structured messages from Kafka consumer", async () => {
		let handler: ((payload: any) => Promise<void>) | undefined;

		const consumer: KafkaConsumerLike = {
			subscribe: vi.fn().mockResolvedValue(undefined),
			run: vi.fn().mockImplementation(async (opts) => {
				handler = opts.eachMessage;
			}),
			disconnect: vi.fn().mockResolvedValue(undefined),
		};

		const received: unknown[] = [];
		const node = fromKafka(consumer, "events");
		const unsub = node.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === DATA) received.push(m[1]);
		});

		await tick();

		// Simulate Kafka message.
		await handler!({
			topic: "events",
			partition: 0,
			message: {
				key: Buffer.from("key1"),
				value: Buffer.from(JSON.stringify({ action: "click" })),
				headers: { source: Buffer.from("web") },
				offset: "5",
				timestamp: "1704067200000",
			},
		});

		expect(received).toHaveLength(1);
		const msg = received[0] as any;
		expect(msg.topic).toBe("events");
		expect(msg.key).toBe("key1");
		expect(msg.value).toEqual({ action: "click" });
		expect(msg.headers).toEqual({ source: "web" });
		expect(msg.offset).toBe("5");
		unsub();
	});

	it("handles null key and value", async () => {
		let handler: ((payload: any) => Promise<void>) | undefined;
		const consumer: KafkaConsumerLike = {
			subscribe: vi.fn().mockResolvedValue(undefined),
			run: vi.fn().mockImplementation(async (opts) => {
				handler = opts.eachMessage;
			}),
			disconnect: vi.fn().mockResolvedValue(undefined),
		};

		const received: unknown[] = [];
		const node = fromKafka(consumer, "test");
		const unsub = node.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === DATA) received.push(m[1]);
		});

		await tick();
		await handler!({
			topic: "test",
			partition: 0,
			message: { key: null, value: null, offset: "0", timestamp: "0" },
		});

		expect((received[0] as any).key).toBeNull();
		expect((received[0] as any).value).toBeNull();
		unsub();
	});
});

describe("toKafka", () => {
	it("forwards DATA to Kafka producer", async () => {
		const kafkaProducer: KafkaProducerLike = {
			send: vi.fn().mockResolvedValue(undefined),
			disconnect: vi.fn().mockResolvedValue(undefined),
		};

		const unsub = toKafka(fromIter(["hello"]), kafkaProducer, "output");

		await tick();

		expect(kafkaProducer.send).toHaveBeenCalledWith({
			topic: "output",
			messages: [{ key: null, value: expect.any(Buffer) }],
		});
		unsub();
	});

	it("uses custom keyExtractor and serializer", async () => {
		const kafkaProducer: KafkaProducerLike = {
			send: vi.fn().mockResolvedValue(undefined),
			disconnect: vi.fn().mockResolvedValue(undefined),
		};

		const unsub = toKafka(fromIter([{ id: "abc", data: "xyz" }]), kafkaProducer, "output", {
			keyExtractor: (v) => v.id,
			serialize: (v) => JSON.stringify(v),
		});

		await tick();

		expect(kafkaProducer.send).toHaveBeenCalledWith({
			topic: "output",
			messages: [{ key: "abc", value: expect.any(Buffer) }],
		});
		unsub();
	});
});

// ——————————————————————————————————————————————————————————————
//  fromRedisStream / toRedisStream
// ——————————————————————————————————————————————————————————————

describe("fromRedisStream", () => {
	it("emits entries from Redis stream via XREAD", async () => {
		let callCount = 0;
		const client: RedisClientLike = {
			xadd: vi.fn().mockResolvedValue("1-0"),
			xread: vi.fn().mockImplementation(async () => {
				callCount++;
				if (callCount === 1) {
					return [
						[
							"mystream",
							[
								["1704067200000-0", ["data", '{"event":"click"}']],
								["1704067200001-0", ["data", '{"event":"scroll"}']],
							],
						],
					];
				}
				// Block forever on second call (simulate waiting).
				return new Promise(() => {});
			}),
			disconnect: vi.fn(),
		};

		const received: unknown[] = [];
		const node = fromRedisStream(client, "mystream");
		const unsub = node.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === DATA) received.push(m[1]);
		});

		await tick(10);

		expect(received).toHaveLength(2);
		expect((received[0] as any).id).toBe("1704067200000-0");
		expect((received[0] as any).data).toEqual({ event: "click" });
		expect((received[1] as any).id).toBe("1704067200001-0");
		unsub();
	});

	it("emits ERROR on XREAD failure", async () => {
		const client: RedisClientLike = {
			xadd: vi.fn().mockResolvedValue("1-0"),
			xread: vi.fn().mockRejectedValue(new Error("connection lost")),
			disconnect: vi.fn(),
		};

		const errors: unknown[] = [];
		const node = fromRedisStream(client, "mystream");
		const unsub = node.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === ERROR) errors.push(m[1]);
		});

		await tick(10);

		expect(errors).toHaveLength(1);
		expect((errors[0] as Error).message).toBe("connection lost");
		unsub();
	});
});

describe("toRedisStream", () => {
	it("forwards DATA to Redis stream via XADD", async () => {
		const client: RedisClientLike = {
			xadd: vi.fn().mockResolvedValue("1-0"),
			xread: vi.fn().mockResolvedValue(null),
			disconnect: vi.fn(),
		};

		const unsub = toRedisStream(fromIter([{ event: "click" }]), client, "mystream");

		await tick();

		expect(client.xadd).toHaveBeenCalledWith(
			"mystream",
			"*",
			"data",
			JSON.stringify({ event: "click" }),
		);
		unsub();
	});

	it("uses MAXLEN when specified", async () => {
		const client: RedisClientLike = {
			xadd: vi.fn().mockResolvedValue("1-0"),
			xread: vi.fn().mockResolvedValue(null),
			disconnect: vi.fn(),
		};

		const unsub = toRedisStream(fromIter(["test"]), client, "mystream", { maxLen: 1000 });

		await tick();

		expect(client.xadd).toHaveBeenCalledWith(
			"mystream",
			"MAXLEN",
			"~",
			"1000",
			"*",
			"data",
			'"test"',
		);
		unsub();
	});
});

// ——————————————————————————————————————————————————————————————
//  fromCSV
// ——————————————————————————————————————————————————————————————

describe("fromCSV", () => {
	it("parses CSV with header row", async () => {
		async function* gen() {
			yield "name,age,city\n";
			yield "Alice,30,NYC\n";
			yield "Bob,25,SF\n";
		}

		const received: unknown[] = [];
		let completed = false;
		const node = fromCSV(gen());
		node.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) received.push(m[1]);
				if (m[0] === COMPLETE) completed = true;
			}
		});

		await tick(10);

		expect(received).toEqual([
			{ name: "Alice", age: "30", city: "NYC" },
			{ name: "Bob", age: "25", city: "SF" },
		]);
		expect(completed).toBe(true);
	});

	it("supports custom delimiter and explicit columns", async () => {
		async function* gen() {
			yield "Alice\t30\n";
			yield "Bob\t25\n";
		}

		const received: unknown[] = [];
		const node = fromCSV(gen(), {
			delimiter: "\t",
			hasHeader: false,
			columns: ["name", "age"],
		});
		node.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === DATA) received.push(m[1]);
		});

		await tick(10);

		expect(received).toEqual([
			{ name: "Alice", age: "30" },
			{ name: "Bob", age: "25" },
		]);
	});

	it("handles quoted fields with embedded delimiters and newlines", async () => {
		async function* gen() {
			yield "name,note\n";
			yield '"Smith, John","has ""quotes"""\n';
		}

		const received: unknown[] = [];
		const node = fromCSV(gen());
		node.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === DATA) received.push(m[1]);
		});

		await tick(10);

		expect(received).toEqual([{ name: "Smith, John", note: 'has "quotes"' }]);
	});

	it("auto-generates column names when no header", async () => {
		async function* gen() {
			yield "a,b,c\n";
		}

		const received: unknown[] = [];
		const node = fromCSV(gen(), { hasHeader: false });
		node.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === DATA) received.push(m[1]);
		});

		await tick(10);

		expect(received).toEqual([{ col0: "a", col1: "b", col2: "c" }]);
	});
});

// ——————————————————————————————————————————————————————————————
//  fromNDJSON
// ——————————————————————————————————————————————————————————————

describe("fromNDJSON", () => {
	it("parses NDJSON lines from async iterable", async () => {
		async function* gen() {
			yield '{"level":"info","msg":"start"}\n';
			yield '{"level":"error","msg":"fail"}\n';
		}

		const received: unknown[] = [];
		let completed = false;
		const node = fromNDJSON(gen());
		node.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) received.push(m[1]);
				if (m[0] === COMPLETE) completed = true;
			}
		});

		await tick(10);

		expect(received).toEqual([
			{ level: "info", msg: "start" },
			{ level: "error", msg: "fail" },
		]);
		expect(completed).toBe(true);
	});

	it("handles multi-line chunks", async () => {
		async function* gen() {
			yield '{"a":1}\n{"b":2}\n';
		}

		const received: unknown[] = [];
		const node = fromNDJSON(gen());
		node.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === DATA) received.push(m[1]);
		});

		await tick(10);

		expect(received).toEqual([{ a: 1 }, { b: 2 }]);
	});

	it("emits ERROR on malformed JSON", async () => {
		async function* gen() {
			yield "not json\n";
		}

		const errors: unknown[] = [];
		const node = fromNDJSON(gen());
		node.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === ERROR) errors.push(m[1]);
		});

		await tick(10);

		expect(errors).toHaveLength(1);
	});

	it("handles partial chunks across yields", async () => {
		async function* gen() {
			yield '{"x":';
			yield "1}\n";
		}

		const received: unknown[] = [];
		const node = fromNDJSON(gen());
		node.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === DATA) received.push(m[1]);
		});

		await tick(10);

		expect(received).toEqual([{ x: 1 }]);
	});
});

// ——————————————————————————————————————————————————————————————
//  fromClickHouseWatch
// ——————————————————————————————————————————————————————————————

describe("fromClickHouseWatch", () => {
	it("polls ClickHouse query and emits rows", async () => {
		vi.useFakeTimers();
		let callCount = 0;
		const client = {
			query: vi.fn().mockImplementation(async () => {
				callCount++;
				return {
					json: async () => [
						{ error: "timeout", count: callCount * 10 },
						{ error: "500", count: callCount * 5 },
					],
				};
			}),
		};

		const received: unknown[] = [];
		const node = fromClickHouseWatch(client, "SELECT * FROM errors_mv", {
			intervalNs: 1_000_000_000,
		});
		const unsub = node.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === DATA) received.push(m[1]);
		});

		// Initial scrape.
		await vi.advanceTimersByTimeAsync(0);
		expect(received).toHaveLength(2);

		// Next interval.
		await vi.advanceTimersByTimeAsync(1000);
		expect(received).toHaveLength(4);

		unsub();
		vi.useRealTimers();
	});

	it("emits ERROR on query failure", async () => {
		vi.useFakeTimers();
		const client = {
			query: vi.fn().mockRejectedValue(new Error("connection refused")),
		};

		const errors: unknown[] = [];
		const node = fromClickHouseWatch(client, "SELECT 1", { intervalNs: 1_000_000_000 });
		const unsub = node.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === ERROR) errors.push(m[1]);
		});

		await vi.advanceTimersByTimeAsync(0);

		expect(errors).toHaveLength(1);
		expect((errors[0] as Error).message).toBe("connection refused");
		unsub();
		vi.useRealTimers();
	});
});
