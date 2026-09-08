import { readFile } from "node:fs/promises";

const lockfilePath = new URL("../package-lock.json", import.meta.url);
const forbiddenRegistry = "package-firewall.replit.internal";
const lockfile = await readFile(lockfilePath, "utf8");

if (lockfile.includes(forbiddenRegistry)) {
  console.error(
    `package-lock.json contains ${forbiddenRegistry}, which is unreachable from Vercel.`,
  );
  process.exit(1);
}

console.log("package-lock.json contains no Replit-internal registry URLs.");