import { prepareRootEvalD159Horizon } from "./root-eval-task-manifest-store.js";

const receipt = await prepareRootEvalD159Horizon();
process.stdout.write(`${receipt.receiptDigest}\n`);
