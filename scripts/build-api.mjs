import { spawn } from "node:child_process";
import { resolve } from "node:path";

const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const clean = spawn(process.execPath, [resolve("scripts/clean-output.mjs"), "api-dist"], { stdio: "inherit" });
const cleanCode = await new Promise((resolveExit) => clean.once("exit", resolveExit));
if (cleanCode !== 0) process.exit(cleanCode ?? 1);
const packages = spawn(command, ["--filter", "@inf/contracts", "build"], { stdio: "inherit" });
const packagesCode = await new Promise((resolveExit) => packages.once("exit", resolveExit));
if (packagesCode !== 0) process.exit(packagesCode ?? 1);
const domain = spawn(command, ["--filter", "@inf/domain", "build"], { stdio: "inherit" });
const domainCode = await new Promise((resolveExit) => domain.once("exit", resolveExit));
if (domainCode !== 0) process.exit(domainCode ?? 1);
const child = spawn(command, ["--filter", "@inf/api", "build"], { stdio: "inherit" });
const code = await new Promise((resolveExit) => child.once("exit", resolveExit));
if (code !== 0) process.exit(code ?? 1);
const deploy = spawn(command, ["--filter", "@inf/api", "--prod", "--config.node-linker=hoisted", "deploy", "api-dist"], { stdio: "inherit" });
const deployCode = await new Promise((resolveExit) => deploy.once("exit", resolveExit));
process.exitCode = deployCode ?? 1;
