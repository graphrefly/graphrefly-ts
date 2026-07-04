/**
 * Async + sync sources (binding-layer sugar, D43 / D40 / feedback_async_sources_binding_layer).
 *
 * Sources are depless {@link Operator}`<never, T>` specs built on the `producer`/`node` path:
 * the body runs ONCE on activation (node `_activate`), schedules its work, and emits later via
 * the captured `ctx.down` (an external tier-3 emit → the leading DIRTY is synthesized for it,
 * R-dirty-before-data). Async lives ONLY here (R-no-raw-async / F-SYNC-CORE): `setTimeout` /
 * `Promise` / `for await` are confined to source bodies; the wave core stays sync. Cleanup is
 * `ctx.onDeactivation` (D28), NOT a returned object. Per-language (D6/D24), never in parity.
 *
 * Instantiate via `g.initNode(timer(1000), [])` (graph-bound, inspectable) or
 * {@link initNode}(timer(1000), []) (bare). Pool/pause defaults (D43): timer/interval =
 * sync + pausable:false (keep producing through PAUSE); fromPromise/fromAsyncIter = async
 * (default pausable, so a paused source buffers its late emits — R-async-paused).
 */

import type { Ctx } from "../ctx/types.js";
import type { Node, NodeOptions } from "../node/node.js";
import { errorPayload } from "../protocol/messages.js";
import { toCheckpointJson } from "./checkpoint.js";
import type {
	DriverCancel,
	DriverResult,
	HttpRequest,
	HttpResponse,
	ProcessCommand,
	ProcessResult,
	SseDriverEvent,
	SseEvent,
	SseRequest,
	WebhookDriverEvent,
	WebhookEvent,
	WebhookRegistration,
	WebSocketDriverEvent,
	WebSocketEvent,
	WebSocketRequest,
} from "./environment.js";
import { initNode, type Operator } from "./operators.js";

/**
 * Values accepted by {@link fromAny}: an existing Node, a Promise, an (a)sync iterable, or a
 * bare scalar. The universal coercion target for higher-order operators (CSP-2.7).
 */
export type NodeInput<T> = Node<T> | PromiseLike<T> | AsyncIterable<T> | Iterable<T> | T;

/** Host-boundary options for {@link singleFromAny}. */
export interface SingleFromAnyOptions<K> {
	/**
	 * Map a caller key to the in-flight dedupe key. Defaults to key identity; object keys dedupe only
	 * when the same object reference is reused. Return a stable string/canonical value for structural
	 * object-key dedupe.
	 */
	keyOf?: (key: K) => unknown;
	/** Treat a sync iterable result as a stream and take its first item. Defaults to scalar value. */
	iter?: boolean;
}

/**
 * Internal: build a depless source spec. `setup` runs once on activation; its returned fn (if
 * any) is registered as the deactivation cleanup (clear timers / abort). `setup` schedules the
 * async work and emits via `ctx.down` — synchronously (sync sources) or later (async sources).
 */
function source<T>(
	factory: string,
	// biome-ignore lint/suspicious/noConfusingVoidType: setup returns a cleanup fn OR nothing — the void arm keeps no-return source bodies (e.g. `of`/`fromIter`) ergonomic, same idiom as EffectFn.
	setup: (ctx: Ctx) => void | (() => void),
	opts?: Partial<NodeOptions<T>>,
): Operator<never, T> {
	return {
		factory,
		opts,
		body: (ctx) => {
			let cleanup: undefined | (() => void);
			let deactivated = false;
			ctx.onDeactivation(() => {
				deactivated = true;
				if (typeof cleanup === "function") cleanup();
			});
			const maybeCleanup = setup(ctx);
			cleanup = typeof maybeCleanup === "function" ? maybeCleanup : undefined;
			if (deactivated && typeof cleanup === "function") cleanup();
		},
	};
}

function assertNonEmptyString(value: string, label: string): void {
	if (typeof value !== "string" || value.length === 0) {
		throw new TypeError(`${label} must be a non-empty string`);
	}
}

function cleanupDriverWork(
	active: { value: boolean },
	cancelSlot: { value: DriverCancel | undefined },
): void {
	active.value = false;
	const cancel = cancelSlot.value;
	cancelSlot.value = undefined;
	if (cancel !== undefined) runDriverCancel(cancel);
}

function installDriverCancel(
	active: { value: boolean },
	cancelSlot: { value: DriverCancel | undefined },
	cancel: DriverCancel,
): void {
	if (active.value) cancelSlot.value = cancel;
	else runDriverCancel(cancel);
}

function runDriverCancel(cancel: DriverCancel): void {
	try {
		cancel();
	} catch {
		// Driver cleanup is best-effort: it must not suppress graph-visible terminal delivery.
	}
}

function driverOneShotSource<T>(
	factory: string,
	missing: string,
	start: (ctx: Ctx, callback: (result: DriverResult<T>) => void) => DriverCancel | undefined,
): Operator<never, T> {
	return source<T>(
		factory,
		(ctx) => {
			const active = { value: true };
			const cancelSlot: { value: DriverCancel | undefined } = { value: undefined };
			const callback = (result: DriverResult<T>) => {
				if (!active.value) return;
				cleanupDriverWork(active, cancelSlot);
				if (result.ok) ctx.down([["DATA", result.value], ["COMPLETE"]]);
				else ctx.down([["ERROR", errorPayload(result.error)]]);
			};
			let cancel: DriverCancel | undefined;
			try {
				cancel = start(ctx, callback);
			} catch (e) {
				active.value = false;
				ctx.down([["ERROR", errorPayload(e)]]);
				return;
			}
			if (cancel === undefined) {
				active.value = false;
				ctx.down([["ERROR", missing]]);
				return;
			}
			installDriverCancel(active, cancelSlot, cancel);
			return () => cleanupDriverWork(active, cancelSlot);
		},
		{ pool: "async", pausable: false },
	);
}

function driverStreamSource<T, E extends { readonly kind: string }>(
	factory: string,
	missing: string,
	start: (ctx: Ctx, callback: (event: E) => void) => DriverCancel | undefined,
	dataOf: (event: E) => T | undefined,
	errorOf: (event: E) => unknown,
): Operator<never, T> {
	return source<T>(
		factory,
		(ctx) => {
			const active = { value: true };
			const cancelSlot: { value: DriverCancel | undefined } = { value: undefined };
			const callback = (event: E) => {
				if (!active.value) return;
				if (event.kind === "event") {
					const value = dataOf(event);
					if (value !== undefined) ctx.down([["DATA", value]]);
				} else if (event.kind === "error") {
					cleanupDriverWork(active, cancelSlot);
					ctx.down([["ERROR", errorPayload(errorOf(event))]]);
				} else if (event.kind === "complete") {
					cleanupDriverWork(active, cancelSlot);
					ctx.down([["COMPLETE"]]);
				}
			};
			let cancel: DriverCancel | undefined;
			try {
				cancel = start(ctx, callback);
			} catch (e) {
				active.value = false;
				ctx.down([["ERROR", errorPayload(e)]]);
				return;
			}
			if (cancel === undefined) {
				active.value = false;
				ctx.down([["ERROR", missing]]);
				return;
			}
			installDriverCancel(active, cancelSlot, cancel);
			return () => cleanupDriverWork(active, cancelSlot);
		},
		{ pool: "async", pausable: false },
	);
}

function isNode(x: unknown): x is Node {
	return (
		x != null &&
		typeof x === "object" &&
		"cache" in x &&
		typeof (x as Node).subscribe === "function"
	);
}

function isThenable(x: unknown): x is PromiseLike<unknown> {
	return x != null && typeof (x as PromiseLike<unknown>).then === "function";
}

function isAsyncIterable<T>(x: unknown): x is AsyncIterable<T> {
	return (
		x !== null &&
		x !== undefined &&
		typeof (x as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === "function"
	);
}

function isIterable<T>(x: unknown): x is Iterable<T> {
	return (
		x !== null &&
		x !== undefined &&
		typeof (x as { [Symbol.iterator]?: unknown })[Symbol.iterator] === "function"
	);
}

/** Options shared by async/timer sources: an optional AbortSignal → ERROR on abort. */
export interface AsyncSourceOpts {
	signal?: AbortSignal;
}

export interface TimerSourceOpts extends AsyncSourceOpts {
	period?: number;
}

/** Options for {@link fromCron}. */
export interface FromCronOptions extends AsyncSourceOpts {
	/** Cron matcher polling interval in milliseconds. Default: 60_000. */
	tickMs?: number;
	/** IANA timezone used for wall-clock cron matching. Defaults to the host-local timezone. */
	timezone?: string;
	/**
	 * DST policy for timezone-aware matching. Current D484 defaults are explicit: nonexistent
	 * wall-clock minutes are skipped, and repeated wall-clock minutes fire at most once.
	 */
	dst?: {
		readonly nonexistent?: "skip";
		readonly repeated?: "once";
	};
	/**
	 * Emitted value shape. `timestamp_ns` is a decimal string so it cannot lose precision as a
	 * JavaScript number; use `timestamp_ms` when numeric millisecond precision is enough.
	 */
	output?: "date" | "timestamp_ms" | "timestamp_ns";
}

/** Minimal five-field cron schedule: minute hour day-of-month month day-of-week. */
export interface CronSchedule {
	readonly minutes: ReadonlySet<number>;
	readonly hours: ReadonlySet<number>;
	readonly daysOfMonth: ReadonlySet<number>;
	readonly months: ReadonlySet<number>;
	readonly daysOfWeek: ReadonlySet<number>;
}

/** DOM/EventEmitter-style target accepted by {@link fromEvent}. */
export interface EventTargetLike {
	addEventListener(
		type: string,
		listener: (event: unknown) => void,
		options?: EventListenerOptionsLike,
	): void;
	removeEventListener(
		type: string,
		listener: (event: unknown) => void,
		options?: EventListenerOptionsLike,
	): void;
}

export interface EventListenerOptionsLike {
	capture?: boolean;
	passive?: boolean;
	once?: boolean;
}

export type FromEventOptions = EventListenerOptionsLike;

/** Host push registration callback accepted by {@link fromPushNotification}. */
export type PushUnsubscribe = () => void;
export type PushRegister<T> = (deliver: (payload: T) => void) => PushUnsubscribe | undefined;

function parseCronField(field: string, min: number, max: number): Set<number> {
	if (field.length === 0) throw new Error("Invalid cron field: empty");
	const out = new Set<number>();
	for (const part of field.split(",")) {
		if (part.length === 0) throw new Error(`Invalid cron field: ${field}`);
		const stepParts = part.split("/");
		if (stepParts.length > 2) throw new Error(`Invalid cron step: ${part}`);
		const [range, stepText] = stepParts;
		if (range == null || range.length === 0) throw new Error(`Invalid cron field: ${field}`);
		if (stepText === "") throw new Error(`Invalid cron step: ${part}`);
		const step = stepText == null ? 1 : parseCronInt(stepText, `Invalid cron step: ${part}`);
		if (step < 1) throw new Error(`Invalid cron step: ${part}`);

		let start: number;
		let end: number;
		if (range === "*") {
			start = min;
			end = max;
		} else if (range.includes("-")) {
			const [a, b, extra] = range.split("-");
			if (extra !== undefined || a === "" || b === "")
				throw new Error(`Invalid cron field: ${field}`);
			start = parseCronInt(a, `Invalid cron field: ${field}`);
			end = parseCronInt(b, `Invalid cron field: ${field}`);
		} else {
			start = parseCronInt(range, `Invalid cron field: ${field}`);
			end = start;
		}

		if (!Number.isInteger(start) || !Number.isInteger(end)) {
			throw new Error(`Invalid cron field: ${field}`);
		}
		if (start < min || end > max) {
			throw new RangeError(`Cron field out of range: ${field} (${min}-${max})`);
		}
		if (start > end) throw new Error(`Invalid cron range: ${start}-${end} in ${field}`);
		for (let i = start; i <= end; i += step) out.add(i);
	}
	return out;
}

function parseCronInt(text: string, message: string): number {
	if (!/^\d+$/.test(text)) throw new Error(message);
	const value = Number.parseInt(text, 10);
	if (!Number.isSafeInteger(value)) throw new Error(message);
	return value;
}

/**
 * Parse a standard five-field cron expression.
 *
 * @param expr - Cron expression in `minute hour day month weekday` order.
 * @returns A normalized cron schedule with one set per field.
 * @example
 * ```ts
 * parseCron("0,5 * * * *");
 * ```
 * @category sources
 */
export function parseCron(expr: string): CronSchedule {
	const parts = expr.trim().split(/\s+/);
	if (parts.length !== 5 || parts.some((part) => part.length === 0)) {
		throw new Error(`Invalid cron: expected 5 fields, got ${parts.length}`);
	}
	return {
		minutes: parseCronField(parts[0], 0, 59),
		hours: parseCronField(parts[1], 0, 23),
		daysOfMonth: parseCronField(parts[2], 1, 31),
		months: parseCronField(parts[3], 1, 12),
		daysOfWeek: parseCronField(parts[4], 0, 6),
	};
}

export interface CronMatchOptions {
	/** IANA timezone used for wall-clock projection. Defaults to the host-local timezone. */
	timezone?: string;
}

interface CronWallClockFields {
	readonly year: number;
	readonly month: number;
	readonly day: number;
	readonly hour: number;
	readonly minute: number;
	readonly dayOfWeek: number;
}

/**
 * Test whether a date matches a parsed cron schedule.
 *
 * @param schedule - Parsed cron schedule to match against.
 * @param date - Date to test.
 * @param opts - Optional timezone override.
 * @returns `true` when the date satisfies all cron fields.
 * @example
 * ```ts
 * matchesCron(parseCron("0 * * * *"), new Date());
 * ```
 * @category sources
 */
export function matchesCron(
	schedule: CronSchedule,
	date: Date,
	opts: CronMatchOptions = {},
): boolean {
	const fields = cronWallClockFields(date, opts.timezone);
	return (
		schedule.minutes.has(fields.minute) &&
		schedule.hours.has(fields.hour) &&
		schedule.daysOfMonth.has(fields.day) &&
		schedule.months.has(fields.month) &&
		schedule.daysOfWeek.has(fields.dayOfWeek)
	);
}

function cronMinuteKey(date: Date, timezone?: string): string {
	const fields = cronWallClockFields(date, timezone);
	return `${fields.year}-${fields.month}-${fields.day}-${fields.hour}-${fields.minute}`;
}

function cronDayKey(date: Date, timezone?: string): string {
	const fields = cronWallClockFields(date, timezone);
	return `${fields.year}-${fields.month}-${fields.day}`;
}

function cronWallClockFields(date: Date, timezone?: string): CronWallClockFields {
	if (timezone === undefined) {
		return {
			year: date.getFullYear(),
			month: date.getMonth() + 1,
			day: date.getDate(),
			hour: date.getHours(),
			minute: date.getMinutes(),
			dayOfWeek: date.getDay(),
		};
	}
	const parts = timezoneFormatter(timezone).formatToParts(date);
	const values: Record<string, number> = {};
	for (const part of parts) {
		if (
			part.type === "year" ||
			part.type === "month" ||
			part.type === "day" ||
			part.type === "hour" ||
			part.type === "minute"
		) {
			values[part.type] = Number.parseInt(part.value, 10);
		}
	}
	const year = values.year;
	const month = values.month;
	const day = values.day;
	const hour = values.hour;
	const minute = values.minute;
	if (
		year === undefined ||
		month === undefined ||
		day === undefined ||
		hour === undefined ||
		minute === undefined
	) {
		throw new Error(`fromCron: timezone projection failed for ${timezone}`);
	}
	return {
		year,
		month,
		day,
		hour,
		minute,
		dayOfWeek: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
	};
}

const TIMEZONE_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function timezoneFormatter(timezone: string): Intl.DateTimeFormat {
	const existing = TIMEZONE_FORMATTERS.get(timezone);
	if (existing !== undefined) return existing;
	assertNonEmptyString(timezone, "fromCron: timezone");
	try {
		const formatter = new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
			timeZone: timezone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			hourCycle: "h23",
		});
		formatter.format(new Date(0));
		TIMEZONE_FORMATTERS.set(timezone, formatter);
		return formatter;
	} catch (error) {
		throw new RangeError(
			`fromCron: unsupported IANA timezone '${timezone}' (${error instanceof Error ? error.message : String(error)})`,
		);
	}
}

function dateToTimestampNs(date: Date): string {
	return (BigInt(date.getTime()) * 1_000_000n).toString();
}

export function fromCron(
	expr: string,
	opts: FromCronOptions & { output: "date" },
): Operator<never, Date>;
export function fromCron(
	expr: string,
	opts: FromCronOptions & { output: "timestamp_ms" },
): Operator<never, number>;
export function fromCron(
	expr: string,
	opts?: FromCronOptions & { output?: "timestamp_ns" },
): Operator<never, string>;
export function fromCron(
	expr: string,
	opts?: FromCronOptions,
): Operator<never, Date | number | string>;
/**
 * Emit wall-clock cron ticks on a graph source.
 *
 * @param expr - Five-field cron expression.
 * @param opts - Cron polling, timezone, DST, abort, and output-shape options.
 * @returns A source operator that emits the current time when the schedule matches.
 * @example
 * ```ts
 * import { graph, fromCron } from "@graphrefly/ts";
 *
 * const everyMinute = graph().initNode(fromCron("0 * * * *"), []);
 * ```
 * @category sources
 */
export function fromCron(
	expr: string,
	opts: FromCronOptions = {},
): Operator<never, Date | number | string> {
	const schedule = parseCron(expr);
	const { tickMs = 60_000, output = "timestamp_ns", signal, timezone } = opts;
	if (opts.dst?.nonexistent !== undefined && opts.dst.nonexistent !== "skip") {
		throw new RangeError("fromCron: dst.nonexistent currently supports only 'skip'");
	}
	if (opts.dst?.repeated !== undefined && opts.dst.repeated !== "once") {
		throw new RangeError("fromCron: dst.repeated currently supports only 'once'");
	}
	if (timezone !== undefined) timezoneFormatter(timezone);
	if (!Number.isFinite(tickMs) || tickMs <= 0) {
		throw new RangeError("fromCron: tickMs must be a positive finite number");
	}
	return source<Date | number | string>(
		"fromCron",
		(ctx) => {
			let done = false;
			let lastFiredKey: string | undefined;
			let firedTimezoneDay: string | undefined;
			const firedTimezoneMinutes = new Set<string>();
			let intervalId: ReturnType<typeof setInterval> | undefined;
			const cleanup = () => {
				done = true;
				if (intervalId !== undefined) clearInterval(intervalId);
				intervalId = undefined;
				signal?.removeEventListener("abort", onAbort);
			};
			const onAbort = () => {
				if (done) return;
				cleanup();
				ctx.down([["ERROR", errorPayload(signal?.reason)]]);
			};
			const emitNow = (now: Date) => {
				if (output === "date") ctx.down([["DATA", now]]);
				else if (output === "timestamp_ms") ctx.down([["DATA", now.getTime()]]);
				else ctx.down([["DATA", dateToTimestampNs(now)]]);
			};
			const check = () => {
				if (done) return;
				const now = new Date();
				const key = cronMinuteKey(now, timezone);
				const alreadyFired =
					timezone === undefined ? key === lastFiredKey : firedTimezoneMinutes.has(key);
				if (!alreadyFired && matchesCron(schedule, now, { timezone })) {
					lastFiredKey = key;
					if (timezone !== undefined) {
						const dayKey = cronDayKey(now, timezone);
						if (dayKey !== firedTimezoneDay) {
							firedTimezoneDay = dayKey;
							firedTimezoneMinutes.clear();
						}
						firedTimezoneMinutes.add(key);
					}
					emitNow(now);
				}
			};
			if (signal?.aborted) {
				onAbort();
				return cleanup;
			}
			signal?.addEventListener("abort", onAbort, { once: true });
			check();
			intervalId = setInterval(check, tickMs);
			return cleanup;
		},
		{ pool: "sync", pausable: false },
	);
}

/**
 * Run a command and emit its process result once.
 *
 * @param program - Executable name or path.
 * @param args - Command-line arguments.
 * @returns A source operator that emits one `ProcessResult`.
 * @example
 * ```ts
 * runProcess("git", ["status"]);
 * ```
 * @category sources
 */
export function runProcess(
	program: string,
	args: readonly string[] = [],
): Operator<never, ProcessResult> {
	return runProcessWithOptions({ program, args });
}

/**
 * Emit a process result using the legacy `fromProcess` factory name.
 *
 * @param program - Executable name or path.
 * @param args - Command-line arguments.
 * @returns A source operator that emits one `ProcessResult`.
 * @example
 * ```ts
 * fromProcess("git", ["status"]);
 * ```
 * @category sources
 */
export function fromProcess(
	program: string,
	args: readonly string[] = [],
): Operator<never, ProcessResult> {
	return processSource("fromProcess", { program, args });
}

/**
 * Run a caller-supplied process command through the graph environment driver.
 *
 * @param command - Process command object consumed by the graph-local process driver.
 * @returns A source operator that emits one `ProcessResult`.
 * @example
 * ```ts
 * import { graph, runProcessWithOptions } from "@graphrefly/ts";
 *
 * const status = graph().initNode(runProcessWithOptions({ program: "git", args: ["status"] }), []);
 * ```
 * @category sources
 */
export function runProcessWithOptions(command: ProcessCommand): Operator<never, ProcessResult> {
	return processSource("runProcess", command);
}

function processSource(factory: string, command: ProcessCommand): Operator<never, ProcessResult> {
	assertNonEmptyString(command.program, `${factory}: program`);
	return driverOneShotSource<ProcessResult>(
		factory,
		`${factory}: missing process driver`,
		(ctx, callback) => ctx.environment().processDriver()?.run(command, callback),
	);
}

/**
 * Emit a single HTTP response for a GET request.
 *
 * @param url - Request URL.
 * @returns A source operator that emits one `HttpResponse`.
 * @example
 * ```ts
 * fromHttp("https://example.com");
 * ```
 * @category sources
 */
export function fromHttp(url: string): Operator<never, HttpResponse> {
	return fromHttpWithOptions({ method: "GET", url });
}

/**
 * Emit a single HTTP response using a caller-supplied request object.
 *
 * @param request - HTTP request to dispatch.
 * @returns A source operator that emits one `HttpResponse`.
 * @example
 * ```ts
 * fromHttpWithOptions({ method: "GET", url: "https://example.com" });
 * ```
 * @category sources
 */
export function fromHttpWithOptions(request: HttpRequest): Operator<never, HttpResponse> {
	assertNonEmptyString(request.url, "fromHttp: url");
	assertNonEmptyString(request.method, "fromHttp: method");
	return driverOneShotSource<HttpResponse>(
		"fromHttp",
		"fromHttp: missing http driver",
		(ctx, callback) => ctx.environment().httpDriver()?.request(request, callback),
	);
}

/**
 * Emit server-sent events from a URL.
 *
 * @param url - SSE endpoint URL.
 * @returns A source operator that emits each SSE event.
 * @example
 * ```ts
 * fromSSE("https://example.com/events");
 * ```
 * @category sources
 */
export function fromSSE(url: string): Operator<never, SseEvent> {
	return fromSSEWithOptions({ url });
}

/**
 * Emit server-sent events using a caller-supplied request object.
 *
 * @param request - SSE request details.
 * @returns A source operator that emits each SSE event.
 * @example
 * ```ts
 * fromSSEWithOptions({ url: "https://example.com/events" });
 * ```
 * @category sources
 */
export function fromSSEWithOptions(request: SseRequest): Operator<never, SseEvent> {
	assertNonEmptyString(request.url, "fromSSE: url");
	return driverStreamSource<SseEvent, SseDriverEvent>(
		"fromSSE",
		"fromSSE: missing sse driver",
		(ctx, callback) => ctx.environment().sseDriver()?.connect(request, callback),
		(event) => (event.kind === "event" ? event.event : undefined),
		(event) => (event.kind === "error" ? event.error : undefined),
	);
}

/**
 * Emit WebSocket events from a URL.
 *
 * @param url - WebSocket endpoint URL.
 * @returns A source operator that emits connection, message, and close events.
 * @example
 * ```ts
 * fromWebSocket("wss://example.com/socket");
 * ```
 * @category sources
 */
export function fromWebSocket(url: string): Operator<never, WebSocketEvent> {
	return fromWebSocketWithOptions({ url });
}

/**
 * Emit WebSocket events using a caller-supplied request object.
 *
 * @param request - WebSocket request details.
 * @returns A source operator that emits connection, message, and close events.
 * @example
 * ```ts
 * fromWebSocketWithOptions({ url: "wss://example.com/socket" });
 * ```
 * @category sources
 */
export function fromWebSocketWithOptions(
	request: WebSocketRequest,
): Operator<never, WebSocketEvent> {
	assertNonEmptyString(request.url, "fromWebSocket: url");
	return driverStreamSource<WebSocketEvent, WebSocketDriverEvent>(
		"fromWebSocket",
		"fromWebSocket: missing websocket driver",
		(ctx, callback) => ctx.environment().webSocketDriver()?.connect(request, callback),
		(event) => (event.kind === "event" ? event.event : undefined),
		(event) => (event.kind === "error" ? event.error : undefined),
	);
}

/**
 * Emit webhook delivery events for a registration id.
 *
 * @param id - Webhook registration id.
 * @returns A source operator that emits each webhook delivery event.
 * @example
 * ```ts
 * fromWebhook("ingest-events");
 * ```
 * @category sources
 */
export function fromWebhook(id: string): Operator<never, WebhookEvent> {
	return fromWebhookWithOptions({ id });
}

/**
 * Emit webhook delivery events using a caller-supplied registration object.
 *
 * @param registration - Webhook registration details.
 * @returns A source operator that emits each webhook delivery event.
 * @example
 * ```ts
 * fromWebhookWithOptions({ id: "ingest-events", method: "POST" });
 * ```
 * @category sources
 */
export function fromWebhookWithOptions(
	registration: WebhookRegistration,
): Operator<never, WebhookEvent> {
	assertNonEmptyString(registration.id, "fromWebhook: id");
	return driverStreamSource<WebhookEvent, WebhookDriverEvent>(
		"fromWebhook",
		"fromWebhook: missing webhook driver",
		(ctx, callback) => ctx.environment().webhookDriver()?.register(registration, callback),
		(event) => (event.kind === "event" ? event.event : undefined),
		(event) => (event.kind === "error" ? event.error : undefined),
	);
}

function timerSource(factory: string, ms: number, opts?: TimerSourceOpts): Operator<never, number> {
	const { period, signal } = opts ?? {};
	const op = source<number>(
		factory,
		(ctx) => {
			let done = false;
			let count = 0;
			let t: ReturnType<typeof setTimeout> | undefined;
			let iv: ReturnType<typeof setInterval> | undefined;
			const cleanup = () => {
				done = true;
				if (t !== undefined) clearTimeout(t);
				if (iv !== undefined) clearInterval(iv);
				signal?.removeEventListener("abort", onAbort);
			};
			const onAbort = () => {
				if (done) return;
				cleanup();
				ctx.down([["ERROR", errorPayload(signal?.reason)]]);
			};
			const finish = () => {
				if (done) return;
				if (period != null) {
					ctx.down([["DATA", count++]]);
					iv = setInterval(() => {
						if (done) return;
						ctx.down([["DATA", count++]]);
					}, period);
				} else {
					// One-shot: DATA then COMPLETE in one wave (terminal-is-forever).
					done = true;
					signal?.removeEventListener("abort", onAbort);
					ctx.down([["DATA", count++], ["COMPLETE"]]);
				}
			};
			if (signal?.aborted) {
				onAbort();
				return;
			}
			signal?.addEventListener("abort", onAbort, { once: true });
			t = setTimeout(finish, ms);
			return cleanup;
		},
		{ pool: "sync", pausable: false },
	);
	if (factory === "timer" && period === undefined && signal === undefined) {
		return { ...op, restore: { ref: "timer", config: { ms: toCheckpointJson(ms, "timer.ms") } } };
	}
	return op;
}

/**
 * Timer source: one-shot (first tick then COMPLETE) or periodic (`{period}` → 0, 1, 2, …).
 * sync pool + pausable:false (a timer keeps producing through PAUSE, R-pause-modes). Emits the
 * tick counter from 0; deactivation clears the timers.
 *
 * @param ms - Delay before the first tick in milliseconds.
 * @param opts - Optional period and source options.
 * @returns A source operator that emits tick counters.
 * @example
 * ```ts
 * import { graph, timer } from "@graphrefly/ts";
 *
 * const tick = graph().initNode(timer(100), []);
 * ```
 * @category sources
 */
export function timer(ms: number, opts?: TimerSourceOpts): Operator<never, number> {
	return timerSource("timer", ms, opts);
}

/**
 * Create a timer source with the legacy `fromTimer` factory name.
 *
 * @param ms - Delay before the first tick in milliseconds.
 * @param opts - Optional period and source options.
 * @returns A source operator that emits tick counters.
 * @example
 * ```ts
 * import { fromTimer, graph } from "@graphrefly/ts";
 *
 * const tick = graph().initNode(fromTimer(100), []);
 * ```
 * @remarks **Factory name:** This preserves the real `fromTimer` factory name in `describe()`.
 * @category sources
 */
export function fromTimer(ms: number, opts?: TimerSourceOpts): Operator<never, number> {
	return timerSource("fromTimer", ms, opts);
}

/**
 * Emit periodic tick counters.
 *
 * @param ms - Delay before the first tick and between later ticks in milliseconds.
 * @returns A source operator that emits `0`, `1`, `2`, and so on.
 * @example
 * ```ts
 * import { graph, interval } from "@graphrefly/ts";
 *
 * const ticks = graph().initNode(interval(1000), []);
 * ```
 * @category sources
 */
export function interval(ms: number): Operator<never, number> {
	return timerSource("interval", ms, { period: ms });
}

/**
 * Lift a Promise (or thenable) to a single-value stream: one DATA then COMPLETE, or ERROR on
 * rejection. async pool (default pausable → a paused source buffers its late emit). Optional
 * `signal` aborts to ERROR.
 *
 * @param p - Promise or thenable to lift into the graph.
 * @param opts - Optional abort signal and async source options.
 * @returns A source operator that emits one DATA value and COMPLETE, or ERROR on rejection/abort.
 * @example
 * ```ts
 * import { fromPromise, graph } from "@graphrefly/ts";
 *
 * const user = graph().initNode(fromPromise(fetch("/user").then((res) => res.json())), []);
 * ```
 * @category sources
 */
export function fromPromise<T>(
	p: Promise<T> | PromiseLike<T>,
	opts?: AsyncSourceOpts,
): Operator<never, T> {
	const signal = opts?.signal;
	return source<T>(
		"fromPromise",
		(ctx) => {
			let settled = false;
			const onAbort = () => {
				if (settled) return;
				settled = true;
				// onAbort only runs from a `signal` listener / the `signal.aborted` guard → signal is defined.
				ctx.down([["ERROR", errorPayload((signal as AbortSignal).reason)]]);
			};
			if (signal?.aborted) {
				onAbort();
				return;
			}
			signal?.addEventListener("abort", onAbort, { once: true });
			void Promise.resolve(p).then(
				(v) => {
					if (settled) return;
					settled = true;
					signal?.removeEventListener("abort", onAbort);
					ctx.down([["DATA", v], ["COMPLETE"]]);
				},
				(e) => {
					if (settled) return;
					settled = true;
					signal?.removeEventListener("abort", onAbort);
					ctx.down([["ERROR", errorPayload(e)]]);
				},
			);
			return () => {
				settled = true;
				signal?.removeEventListener("abort", onAbort);
			};
		},
		{ pool: "async" },
	);
}

/**
 * Read an async iterable: each value → DATA; COMPLETE when done; ERROR on failure. async pool.
 * Optional `signal` aborts the pump.
 *
 * @param iterable - Async iterable to pump into the graph.
 * @param opts - Optional abort signal and async source options.
 * @returns A source operator that emits every iterable value and then COMPLETE.
 * @example
 * ```ts
 * import { fromAsyncIter, graph } from "@graphrefly/ts";
 *
 * const stream = graph().initNode(fromAsyncIter(events()), []);
 * ```
 * @category sources
 */
export function fromAsyncIter<T>(
	iterable: AsyncIterable<T>,
	opts?: AsyncSourceOpts,
): Operator<never, T> {
	const outerSignal = opts?.signal;
	return source<T>(
		"fromAsyncIter",
		(ctx) => {
			const ac = new AbortController();
			const onOuterAbort = () => ac.abort(outerSignal?.reason);
			outerSignal?.addEventListener("abort", onOuterAbort, { once: true });
			let done = false;
			const pump = async () => {
				try {
					for await (const v of iterable) {
						if (ac.signal.aborted) break;
						ctx.down([["DATA", v]]);
					}
					if (!ac.signal.aborted) ctx.down([["COMPLETE"]]);
				} catch (e) {
					if (!ac.signal.aborted) ctx.down([["ERROR", errorPayload(e)]]);
				} finally {
					done = true;
				}
			};
			void pump();
			return () => {
				if (!done) ac.abort();
				outerSignal?.removeEventListener("abort", onOuterAbort);
			};
		},
		{ pool: "async" },
	);
}

/**
 * of: synchronous values — each argument as DATA, then COMPLETE. `of()` is the EMPTY source.
 *
 * @param values - Values to emit synchronously on activation.
 * @returns A source operator that emits each value and then COMPLETE.
 * @example
 * ```ts
 * import { graph, of } from "@graphrefly/ts";
 *
 * const values = graph().initNode(of(1, 2, 3), []);
 * ```
 * @category sources
 */
export function of<T = never>(...values: T[]): Operator<never, T> {
	return source<T>(
		"of",
		(ctx) => {
			for (const value of values) ctx.down([["DATA", value]]);
			ctx.down([["COMPLETE"]]);
		},
		{ pool: "sync" },
	);
}

/**
 * Emit every value from a synchronous iterable.
 *
 * @param iterable - Iterable whose values are emitted in order.
 * @returns A source operator that emits every iterable value and then COMPLETE.
 * @example
 * ```ts
 * import { fromIter, graph } from "@graphrefly/ts";
 *
 * const values = graph().initNode(fromIter([1, 2, 3]), []);
 * ```
 * @category sources
 */
export function fromIter<T>(iterable: Iterable<T>): Operator<never, T> {
	return source<T>(
		"fromIter",
		(ctx) => {
			for (const v of iterable) ctx.down([["DATA", v]]);
			ctx.down([["COMPLETE"]]);
		},
		{ pool: "sync" },
	);
}

/**
 * Complete immediately without emitting DATA.
 *
 * @returns A source operator that emits COMPLETE on activation.
 * @example
 * ```ts
 * import { empty, graph } from "@graphrefly/ts";
 *
 * const done = graph().initNode(empty(), []);
 * ```
 * @category sources
 */
export function empty<T = never>(): Operator<never, T> {
	return source<T>(
		"empty",
		(ctx) => {
			ctx.down([["COMPLETE"]]);
		},
		{ pool: "sync" },
	);
}

/**
 * Activate and remain silent until deactivation.
 *
 * @returns A source operator that never emits DATA or terminal messages by itself.
 * @example
 * ```ts
 * import { graph, never } from "@graphrefly/ts";
 *
 * const quiet = graph().initNode(never(), []);
 * ```
 * @category sources
 */
export function never<T = never>(): Operator<never, T> {
	return source<T>("never", () => undefined, { pool: "sync" });
}

/**
 * Terminate with ERROR on activation.
 *
 * @param err - Host-language error payload to normalize into a protocol ERROR payload.
 * @returns A source operator that emits ERROR.
 * @example
 * ```ts
 * import { graph, throwError } from "@graphrefly/ts";
 *
 * const failed = graph().initNode(throwError(new Error("boom")), []);
 * ```
 * @category sources
 */
export function throwError(err: unknown): Operator<never, never> {
	return source<never>(
		"throwError",
		(ctx) => {
			ctx.down([["ERROR", errorPayload(err)]]);
		},
		{ pool: "sync" },
	);
}

/**
 * Wrap a DOM-style event target. Each event becomes DATA; deactivation removes the listener.
 * External callbacks are source boundaries (D43), so no polling or operator-level async leaks in.
 *
 * @param target - Event target implementing `addEventListener` and `removeEventListener`.
 * @param type - Event type to subscribe to.
 * @param opts - Optional listener options and source options.
 * @returns A source operator that emits each event as DATA.
 * @example
 * ```ts
 * import { fromEvent, graph } from "@graphrefly/ts";
 *
 * const clicks = graph().initNode(fromEvent<MouseEvent>(button, "click"), []);
 * ```
 * @category sources
 */
export function fromEvent<T = unknown>(
	target: EventTargetLike,
	type: string,
	opts: FromEventOptions = {},
): Operator<never, T> {
	if (target == null || typeof target.addEventListener !== "function") {
		throw new TypeError("fromEvent: target must implement addEventListener");
	}
	if (typeof target.removeEventListener !== "function") {
		throw new TypeError("fromEvent: target must implement removeEventListener");
	}
	if (typeof type !== "string" || type.length === 0) {
		throw new TypeError("fromEvent: event type must be a non-empty string");
	}
	return source<T>(
		"fromEvent",
		(ctx) => {
			let done = false;
			const handler = (event: unknown) => {
				if (!done) ctx.down([["DATA", event as T]]);
			};
			target.addEventListener(type, handler, opts);
			return () => {
				done = true;
				target.removeEventListener(type, handler, opts);
			};
		},
		{ pool: "sync" },
	);
}

/**
 * Wrap a host push transport. The host owns network/native setup; this factory owns reactive
 * delivery and teardown only, preserving async-at-source-boundary discipline.
 * @param register - register value used by the helper.
 * @returns A Operator<never, T> value for the boundary or adapter.
 * @category sources
 * @example
 * ```ts
 * import { fromPushNotification } from "@graphrefly/ts/sources";
 * ```
 */
export function fromPushNotification<T = unknown>(register: PushRegister<T>): Operator<never, T> {
	if (typeof register !== "function") {
		throw new TypeError("fromPushNotification: register must be a function");
	}
	return source<T>(
		"fromPushNotification",
		(ctx) => {
			let done = false;
			const deliver = (payload: T) => {
				if (!done) ctx.down([["DATA", payload]]);
			};
			const unsubscribe = register(deliver);
			return () => {
				done = true;
				if (typeof unsubscribe === "function") unsubscribe();
			};
		},
		{ pool: "sync" },
	);
}

/**
 * Coerce a {@link NodeInput}`<T>` to a `Node<T>` (D43 — coercion prerequisite for the CSP-2.7
 * higher-order operators). An existing Node passes through; a thenable → {@link fromPromise};
 * an async iterable → {@link fromAsyncIter}; with `{iter:true}` a sync iterable →
 * {@link fromIter}; everything else → {@link of}. Coerced nodes are bare (use
 * `opts.dispatcher` to bind one, default = process-global D26).
 * @param input - Input value to project or validate.
 * @param opts - Options that configure the helper.
 * @returns A Node<T> value for the boundary or adapter.
 * @category sources
 * @example
 * ```ts
 * import { fromAny } from "@graphrefly/ts/sources";
 * ```
 */
export function fromAny<T>(
	input: NodeInput<T>,
	opts: NodeOptions<T> & { iter?: boolean } = {},
): Node<T> {
	if (isNode(input)) return input as Node<T>;
	const { iter, ...nodeOpts } = opts;
	if (isThenable(input)) {
		return initNode(fromPromise(input as PromiseLike<T>), [], nodeOpts);
	}
	if (input !== null && input !== undefined) {
		const candidate = input as {
			[Symbol.asyncIterator]?: unknown;
			[Symbol.iterator]?: unknown;
		};
		if (typeof candidate[Symbol.asyncIterator] === "function") {
			return initNode(fromAsyncIter(input as AsyncIterable<T>), [], nodeOpts);
		}
		if (iter === true && typeof candidate[Symbol.iterator] === "function") {
			return initNode(fromIter(input as Iterable<T>), [], nodeOpts);
		}
	}
	return initNode(of(input as T), [], nodeOpts);
}

/**
 * Resolve the first DATA from a Node as a Promise.
 *
 * @param source - Node to subscribe to.
 * @returns A Promise for the first DATA value, or a rejection on ERROR/early completion.
 * @example
 * ```ts
 * import { firstValueFrom, graph } from "@graphrefly/ts";
 *
 * const g = graph();
 * await firstValueFrom(g.state(1));
 * ```
 * @remarks Host-boundary escape hatch only. Do not call it from reactive node bodies; use graph
 * deps/messages there so the topology remains declarative and inspectable.
 * @category sources
 */
export function firstValueFrom<T>(source: Node<T>): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		let settled = false;
		let shouldUnsub = false;
		let unsub: (() => void) | undefined;
		const finish = (f: () => void): void => {
			if (settled) return;
			settled = true;
			f();
			if (unsub) {
				unsub();
				unsub = undefined;
			} else {
				shouldUnsub = true;
			}
		};
		unsub = source.subscribe((msg) => {
			if (msg[0] === "DATA") {
				finish(() => resolve(msg[1] as T));
			} else if (msg[0] === "ERROR") {
				finish(() => reject(msg[1]));
			} else if (msg[0] === "COMPLETE") {
				finish(() => reject(new Error("firstValueFrom: completed without DATA")));
			} else if (msg[0] === "TEARDOWN") {
				finish(() => reject(new Error("firstValueFrom: torn down without DATA")));
			}
		});
		if (shouldUnsub) {
			unsub?.();
			unsub = undefined;
		}
	});
}

function singleFromAnyValue<T>(value: T): T {
	if (value === undefined) {
		throw new TypeError("singleFromAny: undefined is the substrate SENTINEL");
	}
	return value;
}

async function firstFromAsyncIterable<T>(input: AsyncIterable<T>): Promise<T> {
	const iter = input[Symbol.asyncIterator]();
	const { value, done } = await iter.next();
	if (done) {
		await iter.return?.();
		throw new Error("singleFromAny: factory returned empty async iterable");
	}
	try {
		await iter.return?.();
	} catch {
		// The first value is the bridge result; close failures after that are cleanup-only.
	}
	return value as T;
}

function firstFromIterable<T>(input: Iterable<T>): Promise<T> {
	const iter = input[Symbol.iterator]();
	const { value, done } = iter.next();
	if (done) {
		iter.return?.();
		return Promise.reject(new Error("singleFromAny: factory returned empty iterable"));
	}
	try {
		iter.return?.();
	} catch {
		// The first value is the bridge result; close failures after that are cleanup-only.
	}
	return Promise.resolve(value as T);
}

function nodeInputToPromise<T>(input: NodeInput<T>, opts: { iter?: boolean }): Promise<T> {
	if (isThenable(input)) return Promise.resolve(input as PromiseLike<T>).then(singleFromAnyValue);
	if (isNode(input)) return firstValueFrom(input as Node<T>).then(singleFromAnyValue);
	if (isAsyncIterable<T>(input)) return firstFromAsyncIterable(input).then(singleFromAnyValue);
	if (opts.iter === true && isIterable<T>(input)) {
		return firstFromIterable(input).then(singleFromAnyValue);
	}
	if (input === undefined) {
		return Promise.reject(new TypeError("singleFromAny: undefined is the substrate SENTINEL"));
	}
	return Promise.resolve(singleFromAnyValue(input as T));
}

/**
 * Keyed singleflight over {@link NodeInput}.
 *
 * @param factory - Function that produces a value, iterable, promise, or node for each key.
 * @param opts - Optional key canonicalizer and iterable handling.
 * @returns A memoizing loader keyed by the transformed key.
 * @example
 * ```ts
 * const loadUser = singleFromAny((id: string) => fetch(`/api/users/${id}`).then((r) => r.json()));
 * ```
 * @remarks Host-boundary helper only. It deduplicates external calls and does not create graph
 * topology or act as a graph operator.
 * @category sources
 */
export function singleFromAny<K, T>(
	factory: (key: K) => NodeInput<T>,
	opts: SingleFromAnyOptions<K> = {},
): (key: K) => Promise<T> {
	const keyOf = opts.keyOf ?? ((key: K): unknown => key);
	const inFlight = new Map<unknown, Promise<T>>();

	return (key: K): Promise<T> => {
		const dedupeKey = keyOf(key);
		const existing = inFlight.get(dedupeKey);
		if (existing) return existing;

		let resolvePending!: (value: T) => void;
		let rejectPending!: (reason: unknown) => void;
		let tracked!: Promise<T>;
		const cleanup = (): void => {
			if (inFlight.get(dedupeKey) === tracked) inFlight.delete(dedupeKey);
		};
		const pending = new Promise<T>((resolve, reject) => {
			resolvePending = resolve;
			rejectPending = reject;
		});
		tracked = pending.then(
			(value) => {
				cleanup();
				return value;
			},
			(error) => {
				cleanup();
				throw error;
			},
		);
		inFlight.set(dedupeKey, tracked);
		try {
			nodeInputToPromise(factory(key), opts).then(resolvePending, rejectPending);
		} catch (e) {
			rejectPending(e);
		}
		return tracked;
	};
}
