/** D645 rootless native Libpod API v0 contract for D604 PostgreSQL containers. */
import type {
	LocalContainerPostgresqlDriver,
	LocalContainerPostgresqlDriverContext,
} from "./local-container-postgresql.js";
import { LOCAL_CONTAINER_POSTGRESQL_COMPATIBILITY } from "./local-container-postgresql.js";
import type {
	PostgresqlDriverQueryResult,
	PostgresqlQueryToolArguments,
} from "./postgresql-tool-provider.js";

export const PODMAN_LIBPOD_API_V0_ROOTLESS_BROKER_COMPATIBILITY =
	"graphrefly-local-container-postgresql-podman-libpod-api-v0-rootless-broker-v1" as const;
export const PODMAN_LIBPOD_API_V0_ROOTLESS_CERTIFIER_COMPATIBILITY =
	"graphrefly-local-container-postgresql-podman-libpod-api-v0-rootless-certifier-v1" as const;

export type PodmanLibpodApiV0RootlessHostResult<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false };

/**
 * Runtime effects remain app-private. This contract carries no socket, endpoint,
 * credential, secret handle, certified-host matrix, or proof override.
 */
export interface PodmanLibpodApiV0RootlessLocalContainerPostgresqlHost {
	createRunContainer(opts: {
		readonly imageRef: string;
		readonly args: PostgresqlQueryToolArguments;
		readonly context: LocalContainerPostgresqlDriverContext;
	}):
		| PodmanLibpodApiV0RootlessHostResult<unknown>
		| PromiseLike<PodmanLibpodApiV0RootlessHostResult<unknown>>;
	startRunContainer(
		binding: unknown,
		context: LocalContainerPostgresqlDriverContext,
	):
		| PodmanLibpodApiV0RootlessHostResult<void>
		| PromiseLike<PodmanLibpodApiV0RootlessHostResult<void>>;
	waitRunContainer(
		binding: unknown,
		context: LocalContainerPostgresqlDriverContext,
	):
		| PodmanLibpodApiV0RootlessHostResult<PostgresqlDriverQueryResult>
		| PromiseLike<PodmanLibpodApiV0RootlessHostResult<PostgresqlDriverQueryResult>>;
	stopRunContainer(
		binding: unknown,
		context: LocalContainerPostgresqlDriverContext,
		graceMs: number,
	):
		| PodmanLibpodApiV0RootlessHostResult<void>
		| PromiseLike<PodmanLibpodApiV0RootlessHostResult<void>>;
	killRunContainer(
		binding: unknown,
		context: LocalContainerPostgresqlDriverContext,
	):
		| PodmanLibpodApiV0RootlessHostResult<void>
		| PromiseLike<PodmanLibpodApiV0RootlessHostResult<void>>;
	removeRunContainer(
		binding: unknown,
		context: LocalContainerPostgresqlDriverContext,
	):
		| PodmanLibpodApiV0RootlessHostResult<void>
		| PromiseLike<PodmanLibpodApiV0RootlessHostResult<void>>;
}

export interface PodmanLibpodApiV0RootlessLocalContainerPostgresqlDriverOptions {
	readonly host: PodmanLibpodApiV0RootlessLocalContainerPostgresqlHost;
	readonly imageRef: string;
}

export function podmanLibpodApiV0RootlessLocalContainerPostgresqlDriver(
	opts: PodmanLibpodApiV0RootlessLocalContainerPostgresqlDriverOptions,
): LocalContainerPostgresqlDriver {
	return Object.freeze({
		compatibility: LOCAL_CONTAINER_POSTGRESQL_COMPATIBILITY,
		prepare: () => undefined,
		create: async (
			context: LocalContainerPostgresqlDriverContext,
			args: PostgresqlQueryToolArguments,
		): Promise<unknown> => {
			if (!digestPinned(opts.imageRef)) throw new TypeError("Podman image must be digest pinned.");
			const created = await opts.host.createRunContainer({
				imageRef: opts.imageRef,
				args,
				context,
			});
			if (!created.ok) throw new Error("Podman Libpod API v0 run container create failed.");
			return created.value;
		},
		start: async (binding: unknown, context: LocalContainerPostgresqlDriverContext) => {
			const result = await opts.host.startRunContainer(binding, context);
			if (!result.ok) throw new Error("Podman Libpod API v0 run container start failed.");
		},
		wait: async (
			binding: unknown,
			context: LocalContainerPostgresqlDriverContext,
		): Promise<PostgresqlDriverQueryResult> => {
			const result = await opts.host.waitRunContainer(binding, context);
			if (!result.ok) throw new Error("Podman Libpod API v0 run container wait failed.");
			return result.value;
		},
		stop: async (
			binding: unknown,
			context: LocalContainerPostgresqlDriverContext,
			graceMs: number,
		) => {
			const result = await opts.host.stopRunContainer(
				binding,
				terminationContext(context),
				graceMs,
			);
			if (!result.ok) throw new Error("Podman Libpod API v0 run container stop failed.");
		},
		kill: async (binding: unknown, context: LocalContainerPostgresqlDriverContext) => {
			const result = await opts.host.killRunContainer(binding, terminationContext(context));
			if (!result.ok) throw new Error("Podman Libpod API v0 run container kill failed.");
		},
		remove: async (binding: unknown, context: LocalContainerPostgresqlDriverContext) => {
			const result = await opts.host.removeRunContainer(binding, terminationContext(context));
			if (!result.ok) throw new Error("Podman Libpod API v0 run container remove failed.");
		},
		cleanup: () => undefined,
	});
}

function terminationContext(
	context: LocalContainerPostgresqlDriverContext,
): LocalContainerPostgresqlDriverContext {
	return Object.freeze({
		runId: context.runId,
		attempt: context.attempt,
		sessionEpoch: context.sessionEpoch,
		manifestFingerprint: context.manifestFingerprint,
		signal: new AbortController().signal,
	});
}

function digestPinned(value: string): boolean {
	return (
		/^(?:[A-Za-z0-9][A-Za-z0-9._:/+-]{0,190}@)?sha256:[a-f0-9]{64}$/.test(value) &&
		value.length <= 255
	);
}
