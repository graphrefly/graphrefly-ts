/**
 * Fixed-capacity ring buffer — O(1) push and drop-oldest eviction.
 *
 * Used by `Graph._traceRing` (reasoning trace), `reactiveLog` (append-only
 * log backend), and `reactiveSink` (drop-oldest backpressure buffer). One
 * implementation, three use sites.
 *
 * @module
 * @internal
 */

/**
 * Fixed-capacity ring buffer. Once `capacity` entries are stored, subsequent
 * `push` calls evict the oldest entry (drop-oldest / FIFO eviction).
 *
 * Operations:
 * - `push(item)` — O(1).
 * - `shift()` — O(1) remove oldest (returns `undefined` when empty).
 * - `at(i)` — O(1) index lookup, with Python-style negative indexing.
 * - `toArray()` — O(n) materialize in insertion order.
 * - `clear()` — O(1) reset to empty.
 *
 * Not thread-safe; JS semantics assumed (single-threaded within a sync call).
 */
export class RingBuffer<T> {
	private buf: (T | undefined)[];
	private head = 0;
	private _size = 0;

	constructor(private capacity: number) {
		if (!Number.isInteger(capacity) || capacity <= 0) {
			throw new Error(`RingBuffer capacity must be a positive integer (got ${capacity})`);
		}
		this.buf = new Array(capacity);
	}

	/** Current number of stored entries. */
	get size(): number {
		return this._size;
	}

	/** Configured maximum before drop-oldest eviction fires. */
	get maxSize(): number {
		return this.capacity;
	}

	/**
	 * Append an item. If size equals capacity, drops the oldest entry and
	 * advances the head pointer.
	 */
	push(item: T): void {
		const idx = (this.head + this._size) % this.capacity;
		this.buf[idx] = item;
		if (this._size < this.capacity) this._size++;
		else this.head = (this.head + 1) % this.capacity;
	}

	/** Remove and return the oldest entry; `undefined` when empty. */
	shift(): T | undefined {
		if (this._size === 0) return undefined;
		const item = this.buf[this.head];
		this.buf[this.head] = undefined;
		this.head = (this.head + 1) % this.capacity;
		this._size--;
		return item;
	}

	/**
	 * O(1) index lookup. Negative indices count from the tail (Python-style).
	 * Returns `undefined` for out-of-range.
	 */
	at(i: number): T | undefined {
		if (this._size === 0) return undefined;
		const n = i < 0 ? this._size + i : i;
		if (n < 0 || n >= this._size) return undefined;
		return this.buf[(this.head + n) % this.capacity];
	}

	/**
	 * Materialize the contents in insertion order (oldest → newest).
	 * Returns a new array each call.
	 */
	toArray(): T[] {
		const result: T[] = new Array(this._size);
		for (let i = 0; i < this._size; i++) {
			result[i] = this.buf[(this.head + i) % this.capacity]!;
		}
		return result;
	}

	/** Reset to empty. Storage slots are released so held refs can GC. */
	clear(): void {
		for (let i = 0; i < this._size; i++) {
			this.buf[(this.head + i) % this.capacity] = undefined;
		}
		this.head = 0;
		this._size = 0;
	}
}
