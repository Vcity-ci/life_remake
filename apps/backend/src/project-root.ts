import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function resolveProjectRoot(moduleUrl: string): string {
  const moduleDir = path.dirname(fileURLToPath(moduleUrl));
  const candidates = [
    process.cwd(),
    path.resolve(moduleDir, "../../.."),
    path.resolve(moduleDir, "../../../../../../")
  ];
  return candidates.find((candidate) => fs.existsSync(path.resolve(candidate, "data"))) ?? process.cwd();
}
