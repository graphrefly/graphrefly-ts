import { describe, expect, it } from "vitest";
import { GraphReFlyConfig, registerBuiltins } from "../../core/config.js";
import { node } from "../../core/node.js";

import {
	decodeEnvelope,
	diffForWAL,
	ENVELOPE_VERSION,
	encodeEnvelope,
	Graph,
	type GraphCodec,
	JsonCodec,
	registerBuiltinCodecs,
	replayWAL,
	type WALEntry,
} from "../../graph/index.js";

function freshConfig(): GraphReFlyConfig {
	const cfg = new GraphReFlyConfig({
		onMessage: () => undefined,
		onSubscribe: () => undefined,
	});
	registerBuiltins(cfg);
	return cfg;
}

describe("GraphCodec — JsonCodec", () => {
	it("exposes name, version, contentType", () => {
		expect(JsonCodec.name).toBe("json");
		expect(JsonCodec.version).toBe(1);
		expect(JsonCodec.contentType).toBe("application/json");
	});

	it("round-trips a graph snapshot", () => {
		const g = new Graph("g");
		g.add(node([], { initial: 42 }), { name: "a" });
		const snap = g.snapshot();
		const bytes = JsonCodec.encode(snap);
		const decoded = JsonCodec.decode(bytes);
		expect(decoded).toEqual(snap);
	});

	it("decode ignores optional codecVersion", () => {
		const snap = new Graph("x").snapshot();
		const bytes = JsonCodec.encode(snap);
		expect(JsonCodec.decode(bytes, 999)).toEqual(snap);
	});
});

describe("envelope v1", () => {
	it("encodeEnvelope / decodeEnvelope round-trip", () => {
		const cfg = freshConfig();
		registerBuiltinCodecs(cfg);
		const payload = new TextEncoder().encode('{"hello":"world"}');
		const bytes = encodeEnvelope(JsonCodec, payload);
		expect(bytes[0]).toBe(ENVELOPE_VERSION);
		const { codec, codecVersion, payload: inner } = decodeEnvelope(bytes, cfg);
		expect(codec.name).toBe("json");
		expect(codecVersion).toBe(1);
		expect(new TextDecoder().decode(inner)).toBe('{"hello":"world"}');
	});

	it("envelope layout: [env_v=1][name_len][name][codec_v u16 BE][payload]", () => {
		const payload = new Uint8Array([0xaa, 0xbb]);
		const bytes = encodeEnvelope(JsonCodec, payload);
		// env_v
		expect(bytes[0]).toBe(1);
		// name_len = 4 ("json")
		expect(bytes[1]).toBe(4);
		// name bytes
		expect(new TextDecoder().decode(bytes.subarray(2, 6))).toBe("json");
		// codec_v u16 BE = 1 → 0x00, 0x01
		expect(bytes[6]).toBe(0);
		expect(bytes[7]).toBe(1);
		// payload
		expect(bytes[8]).toBe(0xaa);
		expect(bytes[9]).toBe(0xbb);
	});

	it("encodeEnvelope rejects oversized name", () => {
		const fake: GraphCodec = {
			name: "x".repeat(256),
			version: 1,
			contentType: "test",
			encode: () => new Uint8Array(),
			decode: () => ({}) as never,
		};
		expect(() => encodeEnvelope(fake, new Uint8Array())).toThrow(/name.*bytes/);
	});

	it("encodeEnvelope rejects empty name", () => {
		const fake: GraphCodec = {
			name: "",
			version: 1,
			contentType: "test",
			encode: () => new Uint8Array(),
			decode: () => ({}) as never,
		};
		expect(() => encodeEnvelope(fake, new Uint8Array())).toThrow(/name.*bytes/);
	});

	it("encodeEnvelope rejects out-of-range codec version", () => {
		const fake: GraphCodec = {
			name: "x",
			version: 70000,
			contentType: "test",
			encode: () => new Uint8Array(),
			decode: () => ({}) as never,
		};
		expect(() => encodeEnvelope(fake, new Uint8Array())).toThrow(/u16 range/);
	});

	it("decodeEnvelope rejects truncated bytes", () => {
		const cfg = freshConfig();
		registerBuiltinCodecs(cfg);
		expect(() => decodeEnvelope(new Uint8Array([1, 10]), cfg)).toThrow(/truncated|too short/);
	});

	it("decodeEnvelope rejects unknown envelope version", () => {
		const cfg = freshConfig();
		registerBuiltinCodecs(cfg);
		const bytes = new Uint8Array([99, 1, 65, 0, 1]); // env_v=99
		expect(() => decodeEnvelope(bytes, cfg)).toThrow(/envelope version/);
	});

	it("decodeEnvelope rejects unknown codec name", () => {
		const cfg = freshConfig();
		// Note: JsonCodec NOT registered on this config.
		const payload = new Uint8Array();
		const bytes = encodeEnvelope(JsonCodec, payload);
		expect(() => decodeEnvelope(bytes, cfg)).toThrow(/codec "json" not registered/);
	});

	it("preserves codec_v=u16 max", () => {
		const cfg = freshConfig();
		const codec: GraphCodec = {
			name: "max",
			version: 0xffff,
			contentType: "test",
			encode: () => new Uint8Array([1, 2, 3]),
			decode: (_b) => ({ nodes: {}, edges: [], subgraphs: [], name: "x", version: 1 }),
		};
		cfg.registerCodec(codec);
		const bytes = encodeEnvelope(codec, new Uint8Array([1, 2, 3]));
		const decoded = decodeEnvelope(bytes, cfg);
		expect(decoded.codecVersion).toBe(0xffff);
	});
});

describe("config codec registry", () => {
	it("defaultConfig has JsonCodec pre-registered", () => {
		const g = new Graph("g");
		expect(g.config.lookupCodec<GraphCodec>("json")).toBe(JsonCodec);
	});

	it("registerCodec / lookupCodec round-trip", () => {
		const cfg = freshConfig();
		const fake: GraphCodec = {
			name: "fake",
			version: 2,
			contentType: "application/fake",
			encode: () => new Uint8Array(),
			decode: () => ({}) as never,
		};
		cfg.registerCodec(fake);
		expect(cfg.lookupCodec<GraphCodec>("fake")).toBe(fake);
		expect(cfg.lookupCodec<GraphCodec>("missing")).toBeUndefined();
	});

	it("registerCodec throws after freeze", () => {
		const cfg = freshConfig();
		registerBuiltinCodecs(cfg);
		// Read a hook to trigger freeze.
		void cfg.onMessage;
		const codec: GraphCodec = {
			name: "late",
			version: 1,
			contentType: "test",
			encode: () => new Uint8Array(),
			decode: () => ({}) as never,
		};
		expect(() => cfg.registerCodec(codec)).toThrow(/frozen/);
	});

	it("overwrites registration before freeze", () => {
		const cfg = freshConfig();
		const a: GraphCodec = {
			name: "same",
			version: 1,
			contentType: "a",
			encode: () => new Uint8Array(),
			decode: () => ({}) as never,
		};
		const b: GraphCodec = {
			name: "same",
			version: 2,
			contentType: "b",
			encode: () => new Uint8Array(),
			decode: () => ({}) as never,
		};
		cfg.registerCodec(a);
		cfg.registerCodec(b);
		expect(cfg.lookupCodec<GraphCodec>("same")).toBe(b);
	});
});

describe("Graph.snapshot({format}) overloads", () => {
	it("no arg → GraphPersistSnapshot object", () => {
		const g = new Graph("g");
		g.add(node([], { initial: 1 }), { name: "a" });
		const snap = g.snapshot();
		expect(typeof snap).toBe("object");
		expect(snap.name).toBe("g");
	});

	it('{format: "json-string"} → deterministic JSON string', () => {
		const g = new Graph("g");
		g.add(node([], { initial: 7 }), { name: "a" });
		const str = g.snapshot({ format: "json-string" });
		expect(typeof str).toBe("string");
		const reparsed = JSON.parse(str);
		expect(reparsed.name).toBe("g");
		expect(reparsed.nodes.a).toBeDefined();
	});

	it('{format: "bytes", codec: "json"} → Uint8Array with envelope', () => {
		const g = new Graph("g");
		g.add(node([], { initial: 42 }), { name: "a" });
		const bytes = g.snapshot({ format: "bytes", codec: "json" });
		expect(bytes).toBeInstanceOf(Uint8Array);
		// Envelope header + "json" + 2 bytes of codec_v = at least 8 bytes
		expect(bytes.length).toBeGreaterThan(8);
		expect(bytes[0]).toBe(ENVELOPE_VERSION);
	});

	it('{format: "bytes"} throws without codec name', () => {
		const g = new Graph("g");
		expect(() => g.snapshot({ format: "bytes" } as never)).toThrow(/requires.*codec/);
	});

	it('{format: "bytes"} throws when codec not registered', () => {
		const g = new Graph("g");
		expect(() => g.snapshot({ format: "bytes", codec: "cbor" })).toThrow(/not registered/);
	});

	it("unknown format throws", () => {
		const g = new Graph("g");
		expect(() => g.snapshot({ format: "xml" as never })).toThrow(/unknown format/);
	});
});

describe("Graph.decode(bytes)", () => {
	it("round-trips snapshot bytes via defaultConfig", () => {
		const g = new Graph("g");
		g.add(node([], { initial: 99 }), { name: "a" });
		const bytes = g.snapshot({ format: "bytes", codec: "json" });
		const snap = Graph.decode(bytes);
		expect(snap.name).toBe("g");
		expect(snap.nodes.a).toBeDefined();
	});

	it("accepts custom config", () => {
		const cfg = freshConfig();
		registerBuiltinCodecs(cfg);
		const g = new Graph("g", { config: cfg });
		g.add(node([], { initial: 1 }), { name: "a" });
		const bytes = g.snapshot({ format: "bytes", codec: "json" });
		const snap = Graph.decode(bytes, { config: cfg });
		expect(snap.name).toBe("g");
	});

	it("rejects bytes encoded with codec not on target config", () => {
		const defaultBytes = new Graph("g").snapshot({ format: "bytes", codec: "json" });
		const isolated = freshConfig(); // no codecs registered
		expect(() => Graph.decode(defaultBytes, { config: isolated })).toThrow(/not registered/);
	});
});

describe("replayWAL (unaffected by codec changes)", () => {
	it("replays full+diff chain", () => {
		const g = new Graph("g");
		g.add(node([], { initial: 1 }), { name: "a" });
		const first = g.snapshot();
		g.set("a", 2);
		const second = g.snapshot();
		const entries: WALEntry[] = [
			{
				mode: "full",
				snapshot: first,
				seq: 1,
				timestamp_ns: 100,
				format_version: 1,
			},
			{
				mode: "diff",
				diff: diffForWAL(first, second),
				seq: 2,
				timestamp_ns: 200,
				format_version: 1,
			},
		];
		const replayed = replayWAL(entries);
		expect(replayed.nodes.a).toBeDefined();
	});

	it("reconstructs nodes added between full anchors via nodesAddedFull", () => {
		// Regression guard for D3: diffs must carry full slices for added
		// nodes, otherwise replay between compacts loses topology.
		const g = new Graph("g");
		g.add(node([], { initial: 1 }), { name: "a" });
		const first = g.snapshot();
		g.add(node([], { initial: 42 }), { name: "b" });
		const second = g.snapshot();
		const entries: WALEntry[] = [
			{ mode: "full", snapshot: first, seq: 1, timestamp_ns: 100, format_version: 1 },
			{
				mode: "diff",
				diff: diffForWAL(first, second),
				seq: 2,
				timestamp_ns: 200,
				format_version: 1,
			},
		];
		const replayed = replayWAL(entries);
		expect(replayed.nodes.a).toBeDefined();
		expect(replayed.nodes.b).toBeDefined();
		expect(replayed.nodes.b.value).toBe(42);
	});
});
