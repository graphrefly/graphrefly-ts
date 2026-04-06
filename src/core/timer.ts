/**
 * Creates a resettable deadline timer for internal timeout, retry, and rate-limiting use.
 *
 * @remarks **Centralised primitive:** wraps `setTimeout`/`clearTimeout` with a generation guard
 * so that stale callbacks never fire after `cancel()` or a new `start()`.
 *
 * @remarks **Spec §5.10 exception:** resilience operators (`timeout`, `retry`, `rateLimiter`)
 * need raw timers — `fromTimer` creates a new Node per reset, which is too heavy here.
 *
 * @example
 * ```ts
 * import { ResettableTimer } from "@graphrefly/graphrefly-ts";
 *
 * const timer = new ResettableTimer();
 * timer.start(1000, () => console.log("fired"));
 * timer.cancel();          // cancels before firing
 * timer.start(500, () => console.log("new deadline"));
 * console.log(timer.pending); // true
 * ```
 *
 * @category core
 */
export class ResettableTimer {
	private _timer: ReturnType<typeof setTimeout> | undefined;
	private _gen = 0;

	/** Schedule callback after delayMs. Cancels any pending timer. */
	start(delayMs: number, callback: () => void): void {
		this.cancel();
		this._gen += 1;
		const gen = this._gen;
		this._timer = setTimeout(() => {
			this._timer = undefined;
			if (gen !== this._gen) return;
			callback();
		}, delayMs);
	}

	/** Cancel the pending timer (if any). */
	cancel(): void {
		if (this._timer !== undefined) {
			clearTimeout(this._timer);
			this._timer = undefined;
		}
	}

	/** Whether a timer is currently pending. */
	get pending(): boolean {
		return this._timer !== undefined;
	}
}
