import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const [packageJsonPath = "package.json", replitPath = ".replit"] =
  process.argv.slice(2);

function fail(message) {
  console.error(`Node version validation failed: ${message}`);
  process.exit(1);
}

function packageNodeMajor(nodeEngine) {
  if (typeof nodeEngine !== "string" || nodeEngine.trim() === "") {
    fail(
      'package.json must declare engines.node. Add an engines.node value such as "22.x".',
    );
  }

  const match = nodeEngine.trim().match(/^(?:[<>=~^ ]*)?v?(\d+)/);
  if (!match) {
    fail(
      `could not determine the Node major version from package.json engines.node "${nodeEngine}". Use a recognizable value such as "22.x".`,
    );
  }

  return Number(match[1]);
}

function replitNodeMajor(replitConfig) {
  const modulesMatch = replitConfig.match(/^\s*modules\s*=\s*\[([\s\S]*?)\]/m);
  if (!modulesMatch) {
    fail(
      '.replit must declare a modules array containing exactly one Node module, for example modules = ["nodejs-22"].',
    );
  }

  const nodeModules = [
    ...modulesMatch[1].matchAll(/["']nodejs-(\d+)["']/g),
  ];
  if (nodeModules.length !== 1) {
    fail(
      `.replit must declare exactly one nodejs-<major> module; found ${nodeModules.length}. Keep one entry such as "nodejs-22" and remove any others.`,
    );
  }

  return Number(nodeModules[0][1]);
}

let packageJson;
let replitConfig;

try {
  [packageJson, replitConfig] = await Promise.all([
    readFile(resolve(packageJsonPath), "utf8").then(JSON.parse),
    readFile(resolve(replitPath), "utf8"),
  ]);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

const packageMajor = packageNodeMajor(packageJson.engines?.node);
const replitMajor = replitNodeMajor(replitConfig);

if (packageMajor !== replitMajor) {
  fail(
    `package.json requires Node ${packageMajor}, but .replit uses nodejs-${replitMajor}. Update both declarations to the same major version.`,
  );
}

console.log(
  `Node version validation passed: package.json and .replit both use Node ${packageMajor}.`,
);