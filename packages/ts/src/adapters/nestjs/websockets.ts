/**
 * Future NestJS WebSocket bridge boundary (D486).
 *
 * This focused subpath is dependency-light today: it exposes only structural
 * boundary factories and envelope types. Official native WebSocket consumers
 * will live here later if they provide request/ack/reply correlation and keep
 * host-private socket handles out of graph DATA.
 */

export {
	fromNestWs,
	type NestBoundaryDecoratorOptions,
	type NestBoundaryEnvelope,
	type NestIngressBoundary,
	type NestIngressEmitOptions,
	type NestIngressOptions,
	type NestReplyEnvelope,
} from "../nestjs.js";
