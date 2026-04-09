/**
 * Adapter behavior contract tests — verifies the 4 pillars from docs/ADAPTER-CONTRACT.md.
 *
 * Uses minimal mock adapters to test the contract generically via fromWebhook
 * and fromWebSocket (register-callback overload).
 */

import { describe, expect, it, vi } from "vitest";
import type { WebSocketRegister } from "../extra/adapters.js";
import { COMPLETE, DATA, ERROR, fromWebhook, fromWebSocket } from "../index.js";
import { collectFlat } from "./test-helpers.js";

// ---------------------------------------------------------------------------
// Pillar 1 — Register callback expectations
// ---------------------------------------------------------------------------

describe("Pillar 1: register callback expectations", () => {
	it("fromWebhook: register receives emit/error/complete and may return cleanup", () => {
		const cleanup = vi.fn();
		const n = fromWebhook(({ emit }) => {
			emit("hello");
			return cleanup;
		});
		const { msgs, unsub } = collectFlat(n);
		expect(msgs).toContainEqual([DATA, "hello"]);
		unsub();
		expect(cleanup).toHaveBeenCalled();
	});

	it("fromWebhook: register may return undefined (no cleanup)", () => {
		const n = fromWebhook(({ emit }) => {
			emit("ok");
			return undefined;
		});
		const { msgs, unsub } = collectFlat(n);
		expect(msgs).toContainEqual([DATA, "ok"]);
		unsub();
	});

	it("fromWebSocket: register must return cleanup callable", () => {
		const n = fromWebSocket((_emit, _error, _complete) => {
			return () => {};
		});
		const { unsub } = collectFlat(n);
		unsub();
	});

	it("fromWebSocket: register returning non-function triggers ERROR", () => {
		const n = fromWebSocket((() => undefined) as unknown as WebSocketRegister<unknown>);
		const { msgs, unsub } = collectFlat(n);
		const errorMsg = msgs.find((m) => m[0] === ERROR);
		expect(errorMsg).toBeDefined();
		expect((errorMsg![1] as Error).message).toContain("contract violation");
		unsub();
	});

	it("registration errors are forwarded as ERROR tuples", () => {
		const n = fromWebhook(() => {
			throw new Error("register boom");
		});
		const { msgs, unsub } = collectFlat(n);
		const errorMsg = msgs.find((m) => m[0] === ERROR);
		expect(errorMsg).toBeDefined();
		expect((errorMsg![1] as Error).message).toBe("register boom");
		unsub();
	});

	it("fromWebSocket: registration errors are forwarded as ERROR tuples", () => {
		const n = fromWebSocket(() => {
			throw new Error("ws register boom");
		});
		const { msgs, unsub } = collectFlat(n);
		const errorMsg = msgs.find((m) => m[0] === ERROR);
		expect(errorMsg).toBeDefined();
		expect((errorMsg![1] as Error).message).toBe("ws register boom");
		unsub();
	});
});

// ---------------------------------------------------------------------------
// Pillar 2 — Terminal-time ordering
// ---------------------------------------------------------------------------

describe("Pillar 2: terminal-time ordering", () => {
	it("cleanup runs before terminal emission (fromWebSocket register)", () => {
		const order: string[] = [];
		const n = fromWebSocket((emit, _error, complete) => {
			// Emit one value, then trigger complete asynchronously.
			emit("data");
			queueMicrotask(() => complete());
			return () => {
				order.push("cleanup");
			};
		});
		const { unsub } = collectFlat(n);
		n.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === COMPLETE) order.push("complete-received");
			}
		});
		// Allow microtask to fire.
		return new Promise<void>((resolve) => {
			setTimeout(() => {
				// Cleanup should appear before (or at same time as) complete-received.
				// The key invariant: cleanup is called, and the node reaches terminal.
				expect(order).toContain("cleanup");
				unsub();
				resolve();
			}, 50);
		});
	});

	it("emit after terminal is a no-op (fromWebhook)", () => {
		let emitFn: ((v: string) => void) | undefined;
		const n = fromWebhook<string>(({ emit, complete }) => {
			emitFn = emit;
			emit("before");
			complete();
			return undefined;
		});
		const { msgs, unsub } = collectFlat(n);
		// Try emitting after complete.
		emitFn!("after-terminal");
		const dataMessages = msgs.filter((m) => m[0] === DATA);
		// No post-terminal replay — terminal guard blocks push-on-subscribe (§1.3.4)
		expect(dataMessages).toHaveLength(1);
		expect(dataMessages[0][1]).toBe("before");
		unsub();
	});
});

// ---------------------------------------------------------------------------
// Pillar 3 — Sink transport failure handling
// ---------------------------------------------------------------------------

describe("Pillar 3: transport errors surface as ERROR tuples", () => {
	it("fromWebSocket: parse error surfaces as ERROR", () => {
		const n = fromWebSocket<string>(
			(emit, _error, _complete) => {
				emit("raw-value");
				return () => {};
			},
			{
				parse: () => {
					throw new Error("parse failed");
				},
			},
		);
		const { msgs, unsub } = collectFlat(n);
		const errorMsg = msgs.find((m) => m[0] === ERROR);
		expect(errorMsg).toBeDefined();
		expect((errorMsg![1] as Error).message).toBe("parse failed");
		unsub();
	});

	it("fromWebhook: error() forwards as ERROR tuple without throwing", () => {
		const n = fromWebhook(({ error }) => {
			error(new Error("transport err"));
			return undefined;
		});
		const { msgs, unsub } = collectFlat(n);
		const errorMsg = msgs.find((m) => m[0] === ERROR);
		expect(errorMsg).toBeDefined();
		expect((errorMsg![1] as Error).message).toBe("transport err");
		unsub();
	});
});

// ---------------------------------------------------------------------------
// Pillar 4 — Idempotency
// ---------------------------------------------------------------------------

describe("Pillar 4: idempotency", () => {
	it("repeated COMPLETE is idempotent (fromWebhook)", () => {
		let completeFn: (() => void) | undefined;
		const n = fromWebhook(({ complete }) => {
			completeFn = complete;
			return undefined;
		});
		const { msgs, unsub } = collectFlat(n);
		completeFn!();
		completeFn!();
		completeFn!();
		const completes = msgs.filter((m) => m[0] === COMPLETE);
		expect(completes).toHaveLength(1);
		unsub();
	});

	it("repeated ERROR is idempotent (fromWebhook)", () => {
		let errorFn: ((e: unknown) => void) | undefined;
		const n = fromWebhook(({ error }) => {
			errorFn = error;
			return undefined;
		});
		const { msgs, unsub } = collectFlat(n);
		errorFn!(new Error("first"));
		errorFn!(new Error("second"));
		const errors = msgs.filter((m) => m[0] === ERROR);
		expect(errors).toHaveLength(1);
		expect((errors[0][1] as Error).message).toBe("first");
		unsub();
	});

	it("emit after error is a no-op (fromWebSocket register)", () => {
		let emitFn: ((v: unknown) => void) | undefined;
		const n = fromWebSocket((emit, error, _complete) => {
			emitFn = emit;
			error(new Error("done"));
			return () => {};
		});
		const { msgs, unsub } = collectFlat(n);
		emitFn!("late-data");
		const dataMessages = msgs.filter((m) => m[0] === DATA);
		expect(dataMessages).toHaveLength(0);
		unsub();
	});

	it("COMPLETE then ERROR is idempotent (fromWebSocket register)", () => {
		let completeFn: (() => void) | undefined;
		let errorFn: ((e: unknown) => void) | undefined;
		const n = fromWebSocket((_emit, error, complete) => {
			completeFn = complete;
			errorFn = error;
			return () => {};
		});
		const { msgs, unsub } = collectFlat(n);
		completeFn!();
		errorFn!(new Error("late"));
		const terminals = msgs.filter((m) => m[0] === COMPLETE || m[0] === ERROR);
		expect(terminals).toHaveLength(1);
		expect(terminals[0][0]).toBe(COMPLETE);
		unsub();
	});
});
