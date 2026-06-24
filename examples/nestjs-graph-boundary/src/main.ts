import "reflect-metadata";
import { depLatest } from "@graphrefly/ts";
import {
	fromNestCron,
	fromNestError,
	fromNestGuard,
	fromNestLifecycle,
	fromNestReq,
	GraphCron,
	GraphError,
	GraphGuard,
	GraphGuardDecision,
	type GraphGuardDecision as GraphGuardDecisionPayload,
	GraphHttpReply,
	GraphLifecycle,
	GraphReq,
	type HttpDataIssue,
	type NestBoundaryEnvelope,
	type NestReplyEnvelope,
} from "@graphrefly/ts/adapters/nestjs";
import {
	createGraphExceptionFilter,
	provideGraphBoundaryInterceptor,
	provideGraphCronScheduler,
	provideGraphGuard,
	provideGraphLifecycleHooks,
} from "@graphrefly/ts/adapters/nestjs/native";
import { type Graph, graph } from "@graphrefly/ts/graph";
import {
	Body,
	Controller,
	Get,
	Headers,
	Injectable,
	Logger,
	Module,
	type OnModuleDestroy,
	Param,
	Post,
	UseFilters,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

interface HttpHost<T> {
	readonly requestId: string;
	readonly body: T;
	readonly headers?: Record<string, string | string[] | undefined>;
	readonly path?: string;
}

interface HttpResult<T = unknown> {
	readonly status: number;
	readonly body: T;
}

interface PolicyState {
	readonly acceptOrders: boolean;
	readonly reason?: string;
}

interface OrderRequest {
	readonly orderId: string;
	readonly item: string;
	readonly quantity: number;
}

interface AuditEntry {
	readonly requestId: string;
	readonly accepted: boolean;
	readonly orderId?: string;
	readonly reason?: string;
}

let fallbackRequestSeq = 0;

function nextRequestSeq(): number {
	fallbackRequestSeq += 1;
	return fallbackRequestSeq;
}

function requestId(prefix: string, seq: () => number, ...candidates: unknown[]): string {
	for (const candidate of candidates) {
		const value = Array.isArray(candidate) ? candidate[0] : candidate;
		if (typeof value !== "string") continue;
		const trimmed = value.trim();
		if (trimmed.length > 0) return trimmed;
	}
	return `${prefix}-${seq()}`;
}

function result<T>(status: number, body: T): HttpResult<T> {
	return { status, body };
}

const g = graph({ name: "nestjs-graph-boundary" });

const policy = g.state<PolicyState>({ acceptOrders: true }, { name: "policy/current" });

const echoIn = fromNestReq<HttpHost<{ readonly message?: string }>, { readonly message?: string }>(
	g,
	{
		bindingId: "node.echo.in",
		payload: (host) => host.body,
		requestId: (host) => host.requestId,
	},
);

const echoOut = g.node<NestReplyEnvelope<HttpResult>>(
	[echoIn.node],
	(ctx) => {
		const envelope = depLatest(ctx, 0) as NestBoundaryEnvelope<{ readonly message?: string }>;
		if (envelope.requestId === undefined) return;
		ctx.down([
			[
				"DATA",
				{
					requestId: envelope.requestId,
					bindingId: "http.echo.out",
					version: 1,
					payload: result(200, { echo: envelope.payload.message ?? "" }),
				},
			],
		]);
	},
	{ name: "http.echo.out" },
);

const ordersIn = fromNestReq<HttpHost<OrderRequest>, OrderRequest>(g, {
	bindingId: "node.orders.in",
});

const ordersGuardIn = fromNestGuard<
	HttpHost<OrderRequest>,
	{ readonly apiKey?: string; readonly orderId?: string }
>(g, {
	bindingId: "node.orders.guard.in",
});

const ordersGuardOut = g.node<NestReplyEnvelope<GraphGuardDecisionPayload>>(
	[ordersGuardIn.node],
	(ctx) => {
		const envelope = depLatest(ctx, 0) as NestBoundaryEnvelope<{
			readonly apiKey?: string;
			readonly orderId?: string;
		}>;
		if (envelope.requestId === undefined) return;
		ctx.down([
			[
				"DATA",
				{
					requestId: envelope.requestId,
					bindingId: "guard.orders.out",
					version: 1,
					payload:
						envelope.payload.apiKey === "demo-key"
							? { kind: "allow", reason: "demo api key accepted" }
							: {
									kind: "deny",
									reason: "missing demo api key",
									status: 403,
									body: { accepted: false, reason: "send x-api-key: demo-key" },
								},
				},
			],
		]);
	},
	{ name: "guard.orders.out" },
);

const ordersAudit = g.node<AuditEntry>(
	[ordersIn.node, policy],
	(ctx) => {
		const envelope = depLatest(ctx, 0) as NestBoundaryEnvelope<OrderRequest>;
		if (envelope.requestId === undefined) return;
		const currentPolicy = depLatest(ctx, 1) as PolicyState;
		const accepted = currentPolicy.acceptOrders && envelope.payload.quantity > 0;
		ctx.down([
			[
				"DATA",
				{
					requestId: envelope.requestId,
					accepted,
					orderId: envelope.payload.orderId,
					reason: accepted ? undefined : (currentPolicy.reason ?? "orders are not admitted"),
				},
			],
		]);
	},
	{ name: "orders.audit" },
);

const ordersOut = g.node<NestReplyEnvelope<HttpResult>>(
	[ordersAudit],
	(ctx) => {
		const audit = depLatest(ctx, 0) as AuditEntry;
		const issue: HttpDataIssue = {
			kind: "issue",
			code: "orders.not_admitted",
			message: audit.reason ?? "Order was not admitted.",
			status: 403,
			body: { accepted: false, reason: audit.reason },
		};
		ctx.down([
			[
				"DATA",
				{
					requestId: audit.requestId,
					bindingId: "http.orders.out",
					version: 1,
					payload: audit.accepted ? result(202, { accepted: true, orderId: audit.orderId }) : issue,
				},
			],
		]);
	},
	{ name: "http.orders.out" },
);

const errorIn = fromNestError<
	{ requestId: string; exception: Error },
	{ readonly message: string }
>(g, {
	bindingId: "node.error.in",
});

const errorOut = g.node<NestReplyEnvelope<HttpResult>>(
	[errorIn.node],
	(ctx) => {
		const envelope = depLatest(ctx, 0) as NestBoundaryEnvelope<{ readonly message: string }>;
		if (envelope.requestId === undefined) return;
		ctx.down([
			[
				"DATA",
				{
					requestId: envelope.requestId,
					bindingId: "http.error.out",
					version: 1,
					payload: result(418, { handled: true, message: envelope.payload.message }),
				},
			],
		]);
	},
	{ name: "http.error.out" },
);

const graphHandledExceptionFilter = createGraphExceptionFilter({
	target: (_host, exception) =>
		exception instanceof Error && exception.message === "graph-handled"
			? { target: DemoController, methodKey: "handledError" }
			: undefined,
	host: (host, exception) => {
		const req = host.switchToHttp().getRequest<{
			headers?: Record<string, string | string[] | undefined>;
			id?: string;
			requestId?: string;
		}>();
		return {
			requestId: requestId(
				"error",
				nextRequestSeq,
				req.requestId,
				req.id,
				req.headers?.["x-request-id"],
			),
			exception: exception instanceof Error ? exception : new Error(String(exception)),
		};
	},
	requestId: (host) => host.requestId,
});

const cronIn = fromNestCron<unknown, { readonly tick: string; readonly timezone: string }>(g, {
	bindingId: "cron.demo.in",
});

const lifecycleIn = fromNestLifecycle<unknown, { readonly event: string }>(g, {
	bindingId: "lifecycle.app.in",
});

@Injectable()
class GraphAuditLogger implements OnModuleDestroy {
	private readonly logger = new Logger("GraphAudit");
	private readonly audit = new Map<string, AuditEntry>();
	private readonly stop = g.observe("orders.audit").subscribe((event) => {
		if (event.msg[0] !== "DATA") return;
		const entry = event.msg[1] as AuditEntry;
		this.audit.set(entry.requestId, entry);
		this.logger.log(
			`orders.audit ${entry.requestId} accepted=${entry.accepted}${
				entry.reason ? ` reason=${entry.reason}` : ""
			}`,
		);
	});

	auditEntry(requestId: string): AuditEntry | undefined {
		return this.audit.get(requestId);
	}

	onModuleDestroy(): void {
		this.stop();
	}
}

@Injectable()
class GraphBoundaryDemo {
	setPolicy(nextPolicy: PolicyState): PolicyState {
		policy.set(nextPolicy);
		return nextPolicy;
	}

	teardown(): HttpResult {
		return result(202, { lifecycle: "teardown-envelope-emitted" });
	}

	describe(): ReturnType<Graph["describe"]> {
		return g.describe();
	}
}

@Controller()
class DemoController {
	constructor(
		private readonly demo: GraphBoundaryDemo,
		private readonly auditLogger: GraphAuditLogger,
	) {}

	@Post("echo")
	@GraphReq(echoIn, {
		bindingId: "http.echo.in",
		payload: (host: HttpHost<{ readonly message?: string }>) => host.body,
		requestId: (host: HttpHost<unknown>) => host.requestId,
	})
	@GraphHttpReply(echoOut, { bindingId: "http.echo.out" })
	echo(): void {}

	@Post("policy")
	policy(@Body() body: Partial<PolicyState>): PolicyState {
		return this.demo.setPolicy({
			acceptOrders: body.acceptOrders ?? true,
			reason: body.reason,
		});
	}

	@Post("orders")
	@GraphGuard(ordersGuardIn, {
		bindingId: "guard.orders.in",
		payload: (host: HttpHost<OrderRequest>) => ({
			apiKey: String(host.headers?.["x-api-key"] ?? ""),
			orderId: host.body.orderId,
		}),
		requestId: (host: HttpHost<unknown>) => host.requestId,
	})
	@GraphGuardDecision(ordersGuardOut, { bindingId: "guard.orders.out" })
	@GraphReq(ordersIn, {
		bindingId: "http.orders.in",
		payload: (host: HttpHost<OrderRequest>) => host.body,
		requestId: (host: HttpHost<unknown>) => host.requestId,
	})
	@GraphHttpReply(ordersOut, { bindingId: "http.orders.out" })
	orders(): void {}

	@Post("handled-error")
	@UseFilters(graphHandledExceptionFilter)
	@GraphError(errorIn, {
		bindingId: "error.demo.in",
		payload: (host: { exception: Error }) => ({ message: host.exception.message }),
		requestId: (host: { requestId: string }) => host.requestId,
	})
	@GraphHttpReply(errorOut, { bindingId: "http.error.out" })
	handledError(): void {
		throw new Error("graph-handled");
	}

	@Get("audit/:requestId")
	audit(@Param("requestId") id: string): HttpResult {
		return result(200, this.auditLogger.auditEntry(id) ?? null);
	}

	@Post("lifecycle/teardown")
	@GraphLifecycle(lifecycleIn, {
		bindingId: "lifecycle.app.in",
		payload: () => ({ event: "manual-teardown" }),
	})
	teardown(@Headers("x-request-id") _header?: string): HttpResult {
		return this.demo.teardown();
	}

	@Post("cron/tick")
	@GraphCron(cronIn, {
		bindingId: "cron.demo.in",
		payload: (host: { timestamp_ns: string; timezone?: string }) => ({
			tick: host.timestamp_ns,
			timezone: host.timezone ?? "host-local",
		}),
	})
	cronTick(): HttpResult {
		return result(202, { cron: "registered" });
	}

	@Get("graph")
	graph(): ReturnType<GraphBoundaryDemo["describe"]> {
		return this.demo.describe();
	}
}

@Module({
	controllers: [DemoController],
	providers: [
		GraphBoundaryDemo,
		GraphAuditLogger,
		provideGraphBoundaryInterceptor({
			host: (context) => {
				const req = context.switchToHttp?.().getRequest<{
					body?: unknown;
					headers?: Record<string, string | string[] | undefined>;
					id?: string;
					path?: string;
					requestId?: string;
				}>() ?? { body: {}, headers: {}, path: undefined };
				return {
					requestId: requestId(
						String(context.getHandler().name || "graph"),
						nextRequestSeq,
						req.requestId,
						req.id,
						req.headers?.["x-request-id"],
						req.headers?.["x-correlation-id"],
					),
					body: req.body ?? {},
					headers: req.headers,
					path: req.path,
				};
			},
			requestId: (host) => host.requestId,
		}),
		provideGraphGuard({
			host: (context) => {
				const req = context.switchToHttp().getRequest<{
					body?: OrderRequest;
					headers?: Record<string, string | string[] | undefined>;
					id?: string;
					requestId?: string;
				}>();
				return {
					requestId: requestId(
						"guard",
						nextRequestSeq,
						req.requestId,
						req.id,
						req.headers?.["x-request-id"],
					),
					body: req.body ?? { orderId: "", item: "", quantity: 0 },
					headers: req.headers,
				};
			},
			requestId: (host) => host.requestId,
		}),
		provideGraphCronScheduler({
			targets: [
				{
					target: DemoController,
					methodKey: "cronTick",
					expr: "* * * * *",
					timezone: "UTC",
				},
			],
		}),
		provideGraphLifecycleHooks({
			targets: [
				{
					target: DemoController,
					methodKey: "teardown",
					event: "module-destroy",
					host: () => ({ event: "module-destroy" }),
				},
			],
		}),
	],
})
class AppModule {}

const app = await NestFactory.create(AppModule);
const port = Number(process.env.PORT ?? 3000);
await app.listen(port);
console.log(`NestJS GraphBoundary demo listening on http://localhost:${port}`);
