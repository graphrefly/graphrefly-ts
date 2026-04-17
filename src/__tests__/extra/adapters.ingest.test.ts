/**
 * Tests for 5.2c ingest adapters (src/extra/adapters.ts).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { COMPLETE, DATA, ERROR } from "../../core/messages.js";
import {
	fromClickHouseWatch,
	fromCSV,
	fromKafka,
	fromNATS,
	fromNDJSON,
	fromOTel,
	fromPrometheus,
	fromPulsar,
	fromRabbitMQ,
	fromRedisStream,
	fromStatsD,
	fromSyslog,
	type KafkaConsumerLike,
	type KafkaProducerLike,
	type NATSClientLike,
	type OTelLog,
	type OTelMetric,
	type OTelSpan,
	type PulsarConsumerLike,
	type PulsarProducerLike,
	parsePrometheusText,
	parseStatsD,
	parseSyslog,
	type RabbitMQChannelLike,
	type RedisClientLike,
	toKafka,
	toNATS,
	toPulsar,
	toRabbitMQ,
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

		// Producer emits once during _startProducer — single delivery.
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

		// Two emits during _startProducer — single delivery per emit.
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

		const { dispose: unsub } = toKafka(fromIter(["hello"]), kafkaProducer, "output");

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

		const { dispose: unsub } = toKafka(
			fromIter([{ id: "abc", data: "xyz" }]),
			kafkaProducer,
			"output",
			{
				keyExtractor: (v) => v.id,
				serialize: (v) => JSON.stringify(v),
			},
		);

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

		const { dispose: unsub } = toRedisStream(fromIter([{ event: "click" }]), client, "mystream");

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

		const { dispose: unsub } = toRedisStream(fromIter(["test"]), client, "mystream", {
			maxLen: 1000,
		});

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

// ————————————————��—————————————————————————————————————————————
//  fromPulsar / toPulsar
// ——————————————————————————————————————————————————————————————

describe("fromPulsar", () => {
	it("emits structured messages from Pulsar consumer", async () => {
		let callCount = 0;
		const mockMsg = {
			getData: () => Buffer.from(JSON.stringify({ action: "click" })),
			getMessageId: () => ({ toString: () => "msg-1" }),
			getPartitionKey: () => "key1",
			getProperties: () => ({ source: "web" }),
			getPublishTimestamp: () => 1704067200000,
			getEventTimestamp: () => 1704067200001,
			getTopicName: () => "persistent://public/default/events",
		};

		const consumer: PulsarConsumerLike = {
			receive: vi.fn().mockImplementation(async () => {
				callCount++;
				if (callCount === 1) return mockMsg;
				return new Promise(() => {}); // Block on second call.
			}),
			acknowledge: vi.fn().mockResolvedValue(undefined),
			close: vi.fn().mockResolvedValue(undefined),
		};

		const received: unknown[] = [];
		const node = fromPulsar(consumer);
		const unsub = node.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === DATA) received.push(m[1]);
		});

		await tick(10);

		expect(received).toHaveLength(1);
		const msg = received[0] as any;
		expect(msg.topic).toBe("persistent://public/default/events");
		expect(msg.messageId).toBe("msg-1");
		expect(msg.key).toBe("key1");
		expect(msg.value).toEqual({ action: "click" });
		expect(msg.properties).toEqual({ source: "web" });
		expect(msg.publishTime).toBe(1704067200000);
		expect(msg.eventTime).toBe(1704067200001);
		expect(consumer.acknowledge).toHaveBeenCalledTimes(1);
		unsub();
	});

	it("emits ERROR on receive failure", async () => {
		const consumer: PulsarConsumerLike = {
			receive: vi.fn().mockRejectedValue(new Error("broker down")),
			acknowledge: vi.fn().mockResolvedValue(undefined),
			close: vi.fn().mockResolvedValue(undefined),
		};

		const errors: unknown[] = [];
		const node = fromPulsar(consumer);
		const unsub = node.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === ERROR) errors.push(m[1]);
		});

		await tick(10);

		expect(errors).toHaveLength(1);
		expect((errors[0] as Error).message).toBe("broker down");
		unsub();
	});

	it("skips ack when autoAck is false", async () => {
		let callCount = 0;
		const mockMsg = {
			getData: () => Buffer.from('"hello"'),
			getMessageId: () => ({ toString: () => "msg-1" }),
			getPartitionKey: () => "",
			getProperties: () => ({}),
			getPublishTimestamp: () => 0,
			getEventTimestamp: () => 0,
			getTopicName: () => "topic",
		};

		const consumer: PulsarConsumerLike = {
			receive: vi.fn().mockImplementation(async () => {
				callCount++;
				if (callCount === 1) return mockMsg;
				return new Promise(() => {});
			}),
			acknowledge: vi.fn().mockResolvedValue(undefined),
			close: vi.fn().mockResolvedValue(undefined),
		};

		const node = fromPulsar(consumer, { autoAck: false });
		const unsub = node.subscribe(() => {});
		await tick(10);

		expect(consumer.acknowledge).not.toHaveBeenCalled();
		unsub();
	});

	it("emits AckableMessage envelope when autoAck is false", async () => {
		let callCount = 0;
		const mockMsg = {
			getData: () => Buffer.from('"hello"'),
			getMessageId: () => ({ toString: () => "msg-1" }),
			getPartitionKey: () => "",
			getProperties: () => ({}),
			getPublishTimestamp: () => 0,
			getEventTimestamp: () => 0,
			getTopicName: () => "topic",
		};

		const consumer: PulsarConsumerLike & {
			negativeAcknowledge?: (m: unknown) => Promise<void>;
		} = {
			receive: vi.fn().mockImplementation(async () => {
				callCount++;
				if (callCount === 1) return mockMsg;
				return new Promise(() => {});
			}),
			acknowledge: vi.fn().mockResolvedValue(undefined),
			close: vi.fn().mockResolvedValue(undefined),
			negativeAcknowledge: vi.fn(),
		};

		const received: Array<{ value: unknown; ack: () => void; nack: () => void }> = [];
		const node = fromPulsar(consumer, { autoAck: false });
		const unsub = node.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) {
					received.push(m[1] as { value: unknown; ack: () => void; nack: () => void });
				}
			}
		});
		await tick(10);

		expect(received).toHaveLength(1);
		expect((received[0].value as { value: unknown }).value).toBe("hello");
		expect(consumer.acknowledge).not.toHaveBeenCalled();
		// Caller invokes ack
		received[0].ack();
		await tick(0);
		expect(consumer.acknowledge).toHaveBeenCalledTimes(1);
		// Idempotent: second ack is a no-op
		received[0].ack();
		expect(consumer.acknowledge).toHaveBeenCalledTimes(1);
		unsub();
	});

	it("envelope nack calls consumer.negativeAcknowledge", async () => {
		let callCount = 0;
		const mockMsg = {
			getData: () => Buffer.from('"hello"'),
			getMessageId: () => ({ toString: () => "msg-1" }),
			getPartitionKey: () => "",
			getProperties: () => ({}),
			getPublishTimestamp: () => 0,
			getEventTimestamp: () => 0,
			getTopicName: () => "topic",
		};

		const consumer: PulsarConsumerLike & {
			negativeAcknowledge?: (m: unknown) => void;
		} = {
			receive: vi.fn().mockImplementation(async () => {
				callCount++;
				if (callCount === 1) return mockMsg;
				return new Promise(() => {});
			}),
			acknowledge: vi.fn().mockResolvedValue(undefined),
			close: vi.fn().mockResolvedValue(undefined),
			negativeAcknowledge: vi.fn(),
		};

		const received: Array<{ ack: () => void; nack: () => void }> = [];
		const node = fromPulsar(consumer, { autoAck: false });
		const unsub = node.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) received.push(m[1] as { ack: () => void; nack: () => void });
			}
		});
		await tick(10);

		received[0].nack();
		expect(consumer.negativeAcknowledge).toHaveBeenCalledTimes(1);
		expect(consumer.acknowledge).not.toHaveBeenCalled();
		unsub();
	});
});

describe("toPulsar", () => {
	it("forwards DATA to Pulsar producer", async () => {
		const pulsarProducer: PulsarProducerLike = {
			send: vi.fn().mockResolvedValue(undefined),
			close: vi.fn().mockResolvedValue(undefined),
		};

		const { dispose: unsub } = toPulsar(fromIter(["hello"]), pulsarProducer);

		await tick();

		expect(pulsarProducer.send).toHaveBeenCalledWith({
			data: expect.any(Buffer),
			partitionKey: undefined,
			properties: undefined,
		});
		const sentData = (pulsarProducer.send as any).mock.calls[0][0].data;
		expect(JSON.parse(sentData.toString())).toBe("hello");
		unsub();
	});

	it("uses custom keyExtractor and propertiesExtractor", async () => {
		const pulsarProducer: PulsarProducerLike = {
			send: vi.fn().mockResolvedValue(undefined),
			close: vi.fn().mockResolvedValue(undefined),
		};

		const { dispose: unsub } = toPulsar(fromIter([{ id: "abc", data: "xyz" }]), pulsarProducer, {
			keyExtractor: (v) => v.id,
			propertiesExtractor: (v) => ({ type: typeof v.data }),
		});

		await tick();

		expect(pulsarProducer.send).toHaveBeenCalledWith({
			data: expect.any(Buffer),
			partitionKey: "abc",
			properties: { type: "string" },
		});
		unsub();
	});
});

// ————��———————————————————————————————————————————————��—————————
//  fromNATS / toNATS
// ——————————���——————————————————————————————————————���————————————

describe("fromNATS", () => {
	it("emits structured messages from NATS subscription", async () => {
		const encoder = new TextEncoder();
		const messages = [
			{
				subject: "events.click",
				data: encoder.encode(JSON.stringify({ action: "click" })),
				headers: {
					get: (k: string) => (k === "source" ? "web" : ""),
					keys: () => ["source"],
				},
				reply: "reply.1",
				sid: 1,
			},
		];

		let resolveIter: (() => void) | undefined;
		const blockPromise = new Promise<void>((r) => {
			resolveIter = r;
		});

		const client: NATSClientLike = {
			subscribe: vi.fn().mockReturnValue({
				[Symbol.asyncIterator]: () => {
					let idx = 0;
					return {
						async next() {
							if (idx < messages.length) return { value: messages[idx++], done: false };
							await blockPromise;
							return { value: undefined, done: true };
						},
					};
				},
			}),
			publish: vi.fn(),
			drain: vi.fn().mockResolvedValue(undefined),
		};

		const received: unknown[] = [];
		const node = fromNATS(client, "events.>");
		const unsub = node.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === DATA) received.push(m[1]);
		});

		await tick(10);

		expect(received).toHaveLength(1);
		const msg = received[0] as any;
		expect(msg.subject).toBe("events.click");
		expect(msg.data).toEqual({ action: "click" });
		expect(msg.headers).toEqual({ source: "web" });
		expect(msg.reply).toBe("reply.1");
		expect(msg.sid).toBe(1);

		resolveIter!();
		unsub();
	});

	it("emits COMPLETE when subscription ends", async () => {
		const client: NATSClientLike = {
			subscribe: vi.fn().mockReturnValue({
				[Symbol.asyncIterator]: () => ({
					async next() {
						return { value: undefined, done: true };
					},
				}),
			}),
			publish: vi.fn(),
			drain: vi.fn().mockResolvedValue(undefined),
		};

		const completed: boolean[] = [];
		const node = fromNATS(client, "test");
		const unsub = node.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === COMPLETE) completed.push(true);
		});

		await tick(10);

		expect(completed).toHaveLength(1);
		unsub();
	});

	it("emits ERROR on iteration failure", async () => {
		const client: NATSClientLike = {
			subscribe: vi.fn().mockReturnValue({
				[Symbol.asyncIterator]: () => ({
					async next() {
						throw new Error("connection lost");
					},
				}),
			}),
			publish: vi.fn(),
			drain: vi.fn().mockResolvedValue(undefined),
		};

		const errors: unknown[] = [];
		const node = fromNATS(client, "test");
		const unsub = node.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === ERROR) errors.push(m[1]);
		});

		await tick(10);

		expect(errors).toHaveLength(1);
		expect((errors[0] as Error).message).toBe("connection lost");
		unsub();
	});
});

describe("toNATS", () => {
	it("forwards DATA to NATS subject", async () => {
		const client: NATSClientLike = {
			subscribe: vi.fn().mockReturnValue({
				[Symbol.asyncIterator]: () => ({ next: async () => ({ done: true, value: undefined }) }),
			}),
			publish: vi.fn(),
			drain: vi.fn().mockResolvedValue(undefined),
		};

		const { dispose: unsub } = toNATS(fromIter(["hello"]), client, "events.out");

		await tick();

		expect(client.publish).toHaveBeenCalledWith("events.out", expect.any(Uint8Array));
		const sentData = (client.publish as any).mock.calls[0][1];
		expect(JSON.parse(new TextDecoder().decode(sentData))).toBe("hello");
		unsub();
	});
});

// ———————���——————————————————————————————————————————————————————
//  fromRabbitMQ / toRabbitMQ
// ——————————————————————————————————————————————————————————————

describe("fromRabbitMQ", () => {
	it("emits structured messages from RabbitMQ channel", async () => {
		let handler: ((msg: any) => void) | undefined;

		const channel: RabbitMQChannelLike = {
			consume: vi.fn().mockImplementation(async (_queue: string, cb: any) => {
				handler = cb;
				return { consumerTag: "ctag-1" };
			}),
			cancel: vi.fn().mockResolvedValue(undefined),
			ack: vi.fn(),
			publish: vi.fn().mockReturnValue(true),
			sendToQueue: vi.fn().mockReturnValue(true),
		};

		const received: unknown[] = [];
		const node = fromRabbitMQ(channel, "events");
		const unsub = node.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === DATA) received.push(m[1]);
		});

		await tick();

		handler!({
			content: Buffer.from(JSON.stringify({ action: "click" })),
			fields: {
				routingKey: "events",
				exchange: "",
				deliveryTag: 1,
				redelivered: false,
			},
			properties: { contentType: "application/json" },
		});

		expect(received).toHaveLength(1);
		const msg = received[0] as any;
		expect(msg.queue).toBe("events");
		expect(msg.routingKey).toBe("events");
		expect(msg.content).toEqual({ action: "click" });
		expect(msg.deliveryTag).toBe(1);
		expect(msg.redelivered).toBe(false);
		expect(channel.ack).toHaveBeenCalledTimes(1);
		unsub();
	});

	it("emits ERROR on consume failure", async () => {
		const channel: RabbitMQChannelLike = {
			consume: vi.fn().mockRejectedValue(new Error("channel closed")),
			cancel: vi.fn().mockResolvedValue(undefined),
			ack: vi.fn(),
			publish: vi.fn().mockReturnValue(true),
			sendToQueue: vi.fn().mockReturnValue(true),
		};

		const errors: unknown[] = [];
		const node = fromRabbitMQ(channel, "events");
		const unsub = node.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === ERROR) errors.push(m[1]);
		});

		await tick(10);

		expect(errors).toHaveLength(1);
		expect((errors[0] as Error).message).toBe("channel closed");
		unsub();
	});

	it("emits ERROR on broker-cancelled consumer (null message)", async () => {
		let handler: ((msg: any) => void) | undefined;

		const channel: RabbitMQChannelLike = {
			consume: vi.fn().mockImplementation(async (_queue: string, cb: any) => {
				handler = cb;
				return { consumerTag: "ctag-1" };
			}),
			cancel: vi.fn().mockResolvedValue(undefined),
			ack: vi.fn(),
			publish: vi.fn().mockReturnValue(true),
			sendToQueue: vi.fn().mockReturnValue(true),
		};

		const received: unknown[] = [];
		const errors: unknown[] = [];
		const node = fromRabbitMQ(channel, "events");
		const unsub = node.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) received.push(m[1]);
				if (m[0] === ERROR) errors.push(m[1]);
			}
		});

		await tick();

		handler!(null);
		expect(received).toHaveLength(0);
		expect(errors).toHaveLength(1);
		expect((errors[0] as Error).message).toBe("Consumer cancelled by broker");
		unsub();
	});

	it("emits AckableMessage envelope when autoAck is false; ack/nack call channel methods", async () => {
		let handler!: (msg: unknown) => void;
		const channel: RabbitMQChannelLike & { nack?: (m: unknown, a: boolean, r: boolean) => void } = {
			consume: vi.fn().mockImplementation(async (_q, h) => {
				handler = h;
				return { consumerTag: "ctag" };
			}),
			cancel: vi.fn().mockResolvedValue(undefined),
			ack: vi.fn(),
			nack: vi.fn(),
			publish: vi.fn(),
			sendToQueue: vi.fn(),
		};

		const received: Array<{
			value: unknown;
			ack: () => void;
			nack: (o?: { requeue?: boolean }) => void;
		}> = [];
		const node = fromRabbitMQ(channel, "events", { autoAck: false });
		const unsub = node.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) {
					received.push(
						m[1] as {
							value: unknown;
							ack: () => void;
							nack: (o?: { requeue?: boolean }) => void;
						},
					);
				}
			}
		});
		await tick();

		const mockMsg = {
			content: Buffer.from('{"v":1}'),
			fields: { routingKey: "", exchange: "", deliveryTag: 1, redelivered: false },
			properties: {},
		};
		handler(mockMsg);

		expect(received).toHaveLength(1);
		expect((received[0].value as { content: unknown }).content).toEqual({ v: 1 });
		expect(channel.ack).not.toHaveBeenCalled();

		received[0].ack();
		expect(channel.ack).toHaveBeenCalledWith(mockMsg);

		// Second message, nack with requeue
		const mockMsg2 = {
			content: Buffer.from('{"v":2}'),
			fields: { routingKey: "", exchange: "", deliveryTag: 2, redelivered: false },
			properties: {},
		};
		handler(mockMsg2);
		received[1].nack({ requeue: false });
		expect(channel.nack).toHaveBeenCalledWith(mockMsg2, false, false);
		unsub();
	});
});

describe("toRabbitMQ", () => {
	it("forwards DATA to RabbitMQ exchange", async () => {
		const channel: RabbitMQChannelLike = {
			consume: vi.fn().mockResolvedValue({ consumerTag: "ctag" }),
			cancel: vi.fn().mockResolvedValue(undefined),
			ack: vi.fn(),
			publish: vi.fn().mockReturnValue(true),
			sendToQueue: vi.fn().mockReturnValue(true),
		};

		const { dispose: unsub } = toRabbitMQ(fromIter(["hello"]), channel, "my-exchange");

		await tick();

		expect(channel.publish).toHaveBeenCalledWith("my-exchange", "", expect.any(Buffer));
		const sentContent = (channel.publish as any).mock.calls[0][2];
		expect(JSON.parse(sentContent.toString())).toBe("hello");
		unsub();
	});

	it("uses custom routingKeyExtractor", async () => {
		const channel: RabbitMQChannelLike = {
			consume: vi.fn().mockResolvedValue({ consumerTag: "ctag" }),
			cancel: vi.fn().mockResolvedValue(undefined),
			ack: vi.fn(),
			publish: vi.fn().mockReturnValue(true),
			sendToQueue: vi.fn().mockReturnValue(true),
		};

		const { dispose: unsub } = toRabbitMQ(
			fromIter([{ id: "abc", type: "click" }]),
			channel,
			"events",
			{
				routingKeyExtractor: (v) => v.type,
			},
		);

		await tick();

		expect(channel.publish).toHaveBeenCalledWith("events", "click", expect.any(Buffer));
		unsub();
	});
});
