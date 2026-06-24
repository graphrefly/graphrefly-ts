/**
 * Future NestJS microservice/message bridge boundary (D486).
 *
 * This focused subpath is dependency-light today: it exposes only structural
 * message boundary factories and envelope types. Official native message
 * consumers will live here later if they provide request/ack/reply correlation
 * and keep host-private transport handles out of graph DATA.
 */

export {
	fromNestMessage,
	type NestBoundaryDecoratorOptions,
	type NestBoundaryEnvelope,
	type NestIngressBoundary,
	type NestIngressEmitOptions,
	type NestIngressOptions,
	type NestReplyEnvelope,
} from "../nestjs.js";
