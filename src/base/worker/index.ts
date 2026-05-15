/** Worker bridge — reactive cross-thread communication (roadmap §5.3). */
export type { WorkerBridge, WorkerBridgeOptions } from "./bridge.js";
export { workerBridge } from "./bridge.js";
export type {
	BatchMessage,
	BridgeMessage,
	ErrorMessage,
	InitMessage,
	ReadyMessage,
	SignalMessage,
	ValueMessage,
} from "./protocol.js";
export { deserializeError, nameToSignal, serializeError, signalToName } from "./protocol.js";
export type { WorkerSelfHandle, WorkerSelfOptions } from "./self.js";
export { workerSelf } from "./self.js";
export type { WorkerTransport } from "./transport.js";
export { createTransport } from "./transport.js";
