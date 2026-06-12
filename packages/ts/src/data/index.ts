/**
 * Passive DATA-level result vocabulary (D184).
 *
 * These shapes are ordinary payload facts. They are not protocol ERROR messages and
 * carry no wave terminal or lifecycle semantics.
 */

export interface DataIssue {
	readonly kind: "issue";
	readonly code: string;
	readonly message: string;
	readonly severity?: "info" | "warning" | "error";
	readonly source?: string;
	readonly subjectId?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
	readonly path?: readonly (string | number)[];
	readonly refs?: readonly string[];
	readonly retryable?: boolean;
	readonly details?: unknown;
	readonly metadata?: Record<string, unknown>;
}

export interface DataOk<T> {
	readonly kind: "ok";
	readonly value: T;
	readonly issues?: readonly DataIssue[];
	readonly metadata?: Record<string, unknown>;
}

export interface DataError<E extends DataIssue = DataIssue> {
	readonly kind: "error";
	readonly error: E;
	readonly issues?: readonly DataIssue[];
	readonly metadata?: Record<string, unknown>;
}

export type DataResult<T, E extends DataIssue = DataIssue> = DataOk<T> | DataError<E>;
