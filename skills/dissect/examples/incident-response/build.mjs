// node build.mjs [--light | --dark] [--audit]  ->  a page next to this file
import { buildFile } from "../../scripts/build.mjs";

await buildFile(new URL("./model.mjs", import.meta.url), process.argv.slice(2));
