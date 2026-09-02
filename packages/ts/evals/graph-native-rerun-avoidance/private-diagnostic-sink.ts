/** Optional private I/O, never a provider/tool outcome or budget authority (D153). */
export function createPrivateDiagnosticSink<T>(input: {
	readonly maxPending: number;
	readonly write: (value: T, signal: AbortSignal) => Promise<void>;
}) {
	if (!Number.isSafeInteger(input.maxPending) || input.maxPending < 1)
		throw new TypeError("private diagnostic pending bound invalid");
	const cancellation = new AbortController();
	const pending = new Set<Promise<void>>();
	let closed = false;
	let failed = 0;
	let dropped = 0;
	let persisted = 0;
	return Object.freeze({
		write(value: T): void {
			if (closed || pending.size >= input.maxPending) {
				dropped += 1;
				return;
			}
			// This schedules optional filesystem I/O only, never a domain occurrence.
			const operation = Promise.resolve().then(() => input.write(value, cancellation.signal));
			const settled = operation
				.then(
					() => {
						persisted += 1;
					},
					() => {
						failed += 1;
					},
				)
				.finally(() => pending.delete(settled));
			pending.add(settled);
		},
		async drain(signal: AbortSignal): Promise<void> {
			closed = true;
			let stop: () => void = () => undefined;
			const cancelled = new Promise<void>((resolve) => {
				const abort = () => {
					cancellation.abort(signal.reason);
					resolve();
				};
				if (signal.aborted) abort();
				else {
					signal.addEventListener("abort", abort, { once: true });
					stop = () => signal.removeEventListener("abort", abort);
				}
			});
			try {
				await Promise.race([Promise.all([...pending]), cancelled]);
			} finally {
				stop();
			}
		},
		status: () => Object.freeze({ persisted, failed, dropped, pending: pending.size }),
	});
}
