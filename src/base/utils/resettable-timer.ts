/**
 * Resettable deadline timer — escape hatch for resilience/timeout/retry operators.
 *
 * Wraps `setTimeout`/`clearTimeout` with a generation guard so stale callbacks
 * never fire after `cancel()` or a new `start()`.
 *
 * Spec §5.10 exception: resilience operators need raw timers; `fromTimer` creates
 * a new Node per reset, which is too heavy. This is the single shared implementation
 * within the presentation layer (`@graphrefly/graphrefly`).
 *
 * Mirrors `@graphrefly/pure-ts` internal `core/_internal/timer.ts`.
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
