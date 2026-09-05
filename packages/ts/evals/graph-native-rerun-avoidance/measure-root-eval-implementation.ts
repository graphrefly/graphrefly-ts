import { measureCurrentImplementation } from "./implementation-manifest.js";

process.stdout.write(`${await measureCurrentImplementation()}\n`);
