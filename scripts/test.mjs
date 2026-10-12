// Cross-platform test runner: works on Windows shells and every supported Node version.
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

const files = readdirSync("test").filter((f) => f.endsWith(".test.mjs")).sort().map((f) => `test/${f}`);
const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exit(result.status ?? 1);
