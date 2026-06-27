import { strictCanonicalJsonBytes, strictJsonCodecFor } from "../json/codec.js";
import type { ChangeLifecycle, StorageTimestampNs } from "./change.js";
import { nowNs } from "./change.js";
import type { Codec } from "./codec.js";
import {
	assertNonNegativeDecimalIntegerString,
	type NonNegativeDecimalIntegerString,
} from "./scalar.js";

/** Storage key segment for passive WAL frame facts. */
export const WAL_KEY_SEGMENT = "wal";

/** Decimal sequence padding for lexicographically ordered WAL frame keys. */
export const WAL_FRAME_SEQ_PAD = 20;

/** First passive WAL frame format version. */
export const WAL_FORMAT_VERSION = 1;

/** Passive WAL frame body; this is a storage fact, not graph restore input. */
export interface WalFrameBody<T = unknown> {
	readonly t: "c";
	readonly lifecycle: ChangeLifecycle;
	readonly path: string;
	readonly change: T;
	readonly frame_seq: number;
	readonly frame_t_ns: StorageTimestampNs;
	readonly format_version: typeof WAL_FORMAT_VERSION;
}

/** Checksummed passive WAL frame. */
export interface WalFrame<T = unknown> extends WalFrameBody<T> {
	readonly checksum: string;
}

/** Options for constructing a passive WAL frame. */
export interface WalFrameOptions<T = unknown> {
	readonly path: string;
	readonly change: T;
	readonly frame_seq: number;
	readonly lifecycle?: ChangeLifecycle;
	readonly frame_t_ns?: StorageTimestampNs;
}

const SHA_256 = "SHA-256";
const HEX_TABLE = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
const CHECKSUM_RE = /^[0-9a-f]{64}$/;
const WAL_BODY_KEYS = new Set([
	"t",
	"lifecycle",
	"path",
	"change",
	"frame_seq",
	"frame_t_ns",
	"format_version",
]);
const WAL_FRAME_KEYS = new Set([...WAL_BODY_KEYS, "checksum"]);

function bytesToHex(bytes: Uint8Array): string {
	let out = "";
	for (const byte of bytes) out += HEX_TABLE[byte];
	return out;
}

function sha256Hex(data: Uint8Array): Promise<string> {
	const digestInput = Uint8Array.from(data);
	return globalThis.crypto.subtle
		.digest(SHA_256, digestInput)
		.then((buf) => bytesToHex(new Uint8Array(buf)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isLifecycle(value: unknown): value is ChangeLifecycle {
	return value === "spec" || value === "data" || value === "ownership";
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): void {
	for (const key of Object.keys(value)) {
		if (!allowed.has(key)) throw new TypeError(`walFrameCodec: unknown field ${key}`);
	}
}

function assertFrameSeq(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) {
		throw new TypeError(`${label} must be a non-negative safe integer`);
	}
	return value as number;
}

function assertWalFrameBody<T = unknown>(
	value: unknown,
	allowedKeys: ReadonlySet<string> = WAL_BODY_KEYS,
): WalFrameBody<T> {
	if (!isRecord(value)) throw new TypeError("walFrameCodec: frame must be an object");
	assertOnlyKeys(value, allowedKeys);
	if (value.t !== "c") throw new TypeError("walFrameCodec: t must be c");
	if (!isLifecycle(value.lifecycle)) {
		throw new TypeError("walFrameCodec: lifecycle must be spec, data, or ownership");
	}
	if (typeof value.path !== "string" || value.path.length === 0) {
		throw new TypeError("walFrameCodec: path must be a non-empty string");
	}
	if (!Object.hasOwn(value, "change")) {
		throw new TypeError("walFrameCodec: change payload is required");
	}
	const frameSeq = assertFrameSeq(value.frame_seq, "walFrameCodec: frame_seq");
	const frameTimestamp = assertNonNegativeDecimalIntegerString(
		value.frame_t_ns,
		"walFrameCodec: frame_t_ns",
	);
	if (value.format_version !== WAL_FORMAT_VERSION) {
		throw new TypeError(`walFrameCodec: format_version must be ${WAL_FORMAT_VERSION}`);
	}
	return {
		t: "c",
		lifecycle: value.lifecycle,
		path: value.path,
		change: value.change as T,
		frame_seq: frameSeq,
		frame_t_ns: frameTimestamp,
		format_version: WAL_FORMAT_VERSION,
	};
}

/** Build the namespace prefix for passive WAL frame keys. */
export function walFramePrefix(namespace: string): string {
	if (namespace.length === 0) return WAL_KEY_SEGMENT;
	return `${namespace}/${WAL_KEY_SEGMENT}`;
}

/** Build the deterministic storage key for a WAL frame sequence number. */
export function walFrameKey(prefix: string, frameSeq: number): string {
	if (!Number.isSafeInteger(frameSeq) || frameSeq < 0) {
		throw new RangeError(
			`walFrameKey: frameSeq must be a non-negative safe integer, got ${frameSeq}`,
		);
	}
	return `${prefix}/${frameSeq.toString().padStart(WAL_FRAME_SEQ_PAD, "0")}`;
}

/** Hash the canonical WAL frame body, excluding the checksum field itself. */
export function walFrameChecksum<T = unknown>(body: WalFrameBody<T>): Promise<string> {
	let bytes: Uint8Array;
	try {
		bytes = strictCanonicalJsonBytes(assertWalFrameBody<T>(body));
	} catch (err) {
		return Promise.resolve().then(() => {
			throw err;
		});
	}
	return sha256Hex(bytes);
}

/** Construct a passive WAL frame with a canonical checksum. */
export function walFrame<T = unknown>(opts: WalFrameOptions<T>): Promise<WalFrame<T>> {
	const body: WalFrameBody<T> = {
		t: "c",
		lifecycle: opts.lifecycle ?? "data",
		path: opts.path,
		change: opts.change,
		frame_seq: opts.frame_seq,
		frame_t_ns: opts.frame_t_ns ?? nowNs(),
		format_version: WAL_FORMAT_VERSION,
	};
	return walFrameChecksum(body).then((checksum) => ({ ...body, checksum }));
}

/** Validate a decoded passive WAL frame without verifying its checksum bytes. */
export function assertWalFrame<T = unknown>(value: unknown): WalFrame<T> {
	if (!isRecord(value)) throw new TypeError("walFrameCodec: frame must be an object");
	assertOnlyKeys(value, WAL_FRAME_KEYS);
	const body = assertWalFrameBody<T>(value, WAL_FRAME_KEYS);
	const checksum = (value as Record<string, unknown>).checksum;
	if (typeof checksum !== "string" || !CHECKSUM_RE.test(checksum)) {
		throw new TypeError("walFrameCodec: checksum must be a lowercase sha256 hex string");
	}
	return { ...body, checksum } as WalFrame<T>;
}

/** Verify that a passive WAL frame checksum matches its body. */
export function verifyWalFrameChecksum<T = unknown>(frame: WalFrame<T>): Promise<boolean> {
	let checked: WalFrame<T>;
	try {
		checked = assertWalFrame<T>(frame);
	} catch (err) {
		return Promise.resolve().then(() => {
			throw err;
		});
	}
	const { checksum, ...body } = checked;
	return walFrameChecksum(body).then((expected) => expected === checksum);
}

/** Strict canonical JSON codec for passive WAL frames; this is not a restore codec. */
export function walFrameCodec<T = unknown>(): Codec<WalFrame<T>> {
	const codec = strictJsonCodecFor<unknown>();
	return {
		encode(value) {
			return codec.encode(assertWalFrame(value));
		},
		decode(bytes) {
			return assertWalFrame<T>(codec.decode(bytes));
		},
	};
}

export type WalFrameTimestampNs = NonNegativeDecimalIntegerString;
