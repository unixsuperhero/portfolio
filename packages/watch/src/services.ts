import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ProjectServices } from "@portfolio/core";

const LOCKFILE_RUNNERS: [string, ProjectServices["runner"]][] = [
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
];

function detectRunner(path: string): ProjectServices["runner"] {
  for (const [lockfile, runner] of LOCKFILE_RUNNERS) if (existsSync(join(path, lockfile))) return runner;
  return existsSync(join(path, "package.json")) ? "npm" : null;
}

function readScripts(path: string): Record<string, string> {
  const file = join(path, "package.json");
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return parsed && typeof parsed.scripts === "object" ? parsed.scripts : {};
  } catch {
    return {};
  }
}

/** `name:` targets in a Makefile, excluding .PHONY and any target starting with a dot. */
function readMakeTargets(path: string): string[] {
  const file = join(path, "Makefile");
  if (!existsSync(file)) return [];
  const targets: string[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^([A-Za-z0-9_.-]+):/);
    if (!match || match[1] === ".PHONY" || match[1].startsWith(".")) continue;
    targets.push(match[1]);
  }
  return targets;
}

/** A project's runnable scripts: package.json scripts, the runner picked from its lockfile, and Makefile targets. */
export function projectServices(path: string): ProjectServices {
  return { runner: detectRunner(path), scripts: readScripts(path), make_targets: readMakeTargets(path) };
}

/** The exact shell line to run one script or make target, in the runner's syntax. */
export function serviceCommand(services: ProjectServices, name: string, args = ""): string {
  const suffix = args ? ` ${args}` : "";
  if (services.make_targets.includes(name) && !(name in services.scripts)) return `make ${name}${suffix}`;
  switch (services.runner) {
    case "bun": return `bun run ${name}${suffix}`;
    case "pnpm": return `pnpm run ${name}${suffix}`;
    case "yarn": return `yarn run ${name}${suffix}`;
    case "npm": return args ? `npm run ${name} -- ${args}` : `npm run ${name}`;
    default: return `make ${name}${suffix}`;
  }
}
