/** D171 consumer-private resource origins. Preparation is explicit; imports perform no I/O. */
import { isAbsolute, resolve } from "node:path";
import { type SpendingBinding, validateBinding } from "./causal-inputs.js";

export type ResourceMode =
	| "offline-simulation"
	| "in-memory-local-file"
	| "prepared-local-file"
	| "in-memory-local-file-proof"
	| "prepared-local-file-proof";
export interface SpendingFileHandle {
	write(payload: string): Promise<{ readonly bytesWritten: number }>;
	close(): Promise<void>;
}
export interface SpendingFileIO {
	open(path: string, flags: "wx+", mode: number): Promise<SpendingFileHandle>;
}
const origin = Symbol("spending-resource-origin");
export class SpendingResource {
	readonly binding: SpendingBinding;
	#mode: ResourceMode;
	#claimed = false;
	#busy = false;
	#closed = false;
	#closing?: Promise<void>;
	#write: SpendingFileHandle["write"];
	#close: SpendingFileHandle["close"];
	constructor(
		token: symbol,
		binding: SpendingBinding,
		mode: ResourceMode,
		write: SpendingFileHandle["write"],
		close: SpendingFileHandle["close"],
	) {
		if (token !== origin) throw new TypeError("unprepared spending resource");
		this.binding = validateBinding(binding);
		this.#mode = mode;
		this.#write = write;
		this.#close = close;
		Object.defineProperties(this, {
			mode: { value: mode, enumerable: true },
			kind: {
				value: mode === "offline-simulation" ? "offline-alert-resource" : "prepared-alert-resource",
				enumerable: true,
			},
			claim: { value: SpendingResource.prototype.claim.bind(this) },
			close: { value: SpendingResource.prototype.close.bind(this) },
		});
		Object.freeze(this);
	}
	static is(value: unknown): value is SpendingResource {
		return typeof value === "object" && value !== null && #mode in value;
	}
	get mode(): ResourceMode {
		return this.#mode;
	}
	get kind() {
		return this.#mode === "offline-simulation"
			? "offline-alert-resource"
			: "prepared-alert-resource";
	}
	async close() {
		if (this.#busy) throw new TypeError("spending resource busy");
		if (this.#closing) return this.#closing;
		this.#closed = true;
		this.#closing = Promise.resolve().then(() => this.#close());
		return this.#closing;
	}
	claim() {
		if (this.#claimed || this.#closed)
			throw new TypeError("spending host epoch already claimed or closed");
		this.#claimed = true;
		let phase: "cold" | "transferred" | "aborted" = "cold";
		return Object.freeze({
			mode: this.#mode,
			write: (payload: string) => {
				if (phase !== "transferred" || this.#closed || this.#busy)
					throw new TypeError("spending lease unavailable or not transferred");
				this.#busy = true;
				try {
					return Promise.resolve(this.#write(payload)).finally(() => {
						this.#busy = false;
					});
				} catch (error) {
					this.#busy = false;
					throw error;
				}
			},
			abort: () => {
				if (phase === "cold") {
					phase = "aborted";
					this.#claimed = false;
				}
			},
			transfer: () => {
				if (phase !== "cold" || this.#closed) throw new TypeError("spending lease is not cold");
				phase = "transferred";
			},
		});
	}
}
/** Callback bytes always remain simulation evidence, regardless of callback implementation. */
export class OfflineAlertResource extends SpendingResource {
	constructor(binding: SpendingBinding, write: SpendingFileHandle["write"]) {
		super(origin, binding, "offline-simulation", write, async () => {});
	}
}
async function prepare(
	path: string,
	binding: SpendingBinding,
	io: SpendingFileIO,
	mode: ResourceMode,
) {
	const checked = validateBinding(binding);
	if (typeof path !== "string" || path.length === 0)
		throw new TypeError("spending destination path");
	const handle = await io.open(path, "wx+", 0o600);
	try {
		return new SpendingResource(
			origin,
			checked,
			mode,
			(payload) => handle.write(payload),
			() => handle.close(),
		);
	} catch (error) {
		await handle.close();
		throw error;
	}
}
/** Injected transport is explicitly unqualified simulation, even if supplied code performs I/O. */
export function prepareSpendingResourceWithIO(
	path: string,
	binding: SpendingBinding,
	io: SpendingFileIO,
) {
	return prepare(path, binding, io, "in-memory-local-file");
}
/** Only this origin opens an exclusive fresh real handle. Calling it requires execution authority. */
export async function prepareLocalSpendingResource(path: string, binding: SpendingBinding) {
	validateLocalDestination(path, binding);
	const { open } = await import("node:fs/promises");
	return prepare(path, binding, { open }, "prepared-local-file");
}

function validateLocalDestination(path: string, binding: SpendingBinding) {
	const checked = validateBinding(binding);
	if (
		typeof path !== "string" ||
		!isAbsolute(path) ||
		resolve(path) !== path ||
		checked.destinationRef.kind !== "local-inbox" ||
		checked.destinationRef.id !== path
	)
		throw new TypeError("local inbox destination must equal canonical absolute path");
	return checked;
}

export interface SpendingProofFileIO {
	open(
		path: string,
		flags: "wx+",
		mode: number,
	): Promise<{
		writeBytes(payload: Uint8Array): Promise<{ readonly bytesWritten: number }>;
		close(): Promise<void>;
	}>;
}
export type ProofSettlement = "full" | "short1" | "reject-before-write" | "pending";
async function prepareProof(
	path: string,
	binding: SpendingBinding,
	io: SpendingProofFileIO,
	mode: ResourceMode,
) {
	const checked = validateBinding(binding);
	if (typeof path !== "string" || path.length === 0)
		throw new TypeError("spending destination path");
	const handle = await io.open(path, "wx+", 0o600);
	const calls: {
		payload: string;
		resolve: (v: { readonly bytesWritten: number }) => void;
		reject: (reason: unknown) => void;
		settled: boolean;
	}[] = [];
	const transports: { call: number; bytes: number }[] = [];
	try {
		const resource = new SpendingResource(
			origin,
			checked,
			mode,
			(payload) => {
				if (calls.length >= 64 || Buffer.byteLength(payload) > 4096)
					throw new TypeError("proof transport capacity");
				return new Promise((resolve, reject) => {
					calls.push({ payload, resolve, reject, settled: false });
				});
			},
			() => handle.close(),
		);
		return Object.freeze({
			resource,
			get attemptedPayloads(): readonly string[] {
				return Object.freeze(calls.map((c) => c.payload));
			},
			get transportAttempts(): readonly Readonly<{ call: number; bytes: number }>[] {
				return Object.freeze(transports.map((t) => Object.freeze({ ...t })));
			},
			async settle(callIndex: number, result: ProofSettlement) {
				if (
					!Number.isSafeInteger(callIndex) ||
					callIndex < 0 ||
					!["full", "short1", "reject-before-write", "pending"].includes(result)
				)
					throw new TypeError("invalid proof settlement");
				const call = calls[callIndex];
				if (!call || call.settled) throw new TypeError("proof call missing or already settled");
				call.settled = true;
				if (result === "pending") return;
				if (result === "reject-before-write") {
					call.reject(new Error("proof reject before write"));
					return;
				}
				const full = Buffer.from(call.payload);
				const bytes = result === "short1" ? full.subarray(0, 1) : full;
				transports.push({ call: callIndex, bytes: bytes.length });
				try {
					call.resolve(await handle.writeBytes(bytes));
				} catch (error) {
					call.reject(error);
				}
			},
		});
	} catch (error) {
		await handle.close();
		throw error;
	}
}
/** Held fault-injection transport; injected bytes never attest a physical file. */
export function prepareSpendingProofResourceWithIO(
	path: string,
	binding: SpendingBinding,
	io: SpendingProofFileIO,
) {
	return prepareProof(path, binding, io, "in-memory-local-file-proof");
}
/** Explicit proof-only local resource. No file is opened until this function is called. */
export async function prepareLocalSpendingProofResource(path: string, binding: SpendingBinding) {
	validateLocalDestination(path, binding);
	const { open } = await import("node:fs/promises");
	return prepareProof(
		path,
		binding,
		{
			async open(path, flags, mode) {
				const handle = await open(path, flags, mode);
				return { writeBytes: (bytes) => handle.write(bytes), close: () => handle.close() };
			},
		},
		"prepared-local-file-proof",
	);
}
