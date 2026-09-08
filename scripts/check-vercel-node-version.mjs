import { readFile } from "node:fs/promises";

const packageJsonPath = process.argv[2] ?? "package.json";
const token = process.env.VERCEL_TOKEN?.trim();
const projectId = process.env.VERCEL_PROJECT_ID?.trim();
const teamId = process.env.VERCEL_ORG_ID?.trim();
const apiBaseUrl = (process.env.VERCEL_API_URL ?? "https://api.vercel.com").replace(
  /\/+$/,
  "",
);
const apiTimeoutMs = Number(process.env.VERCEL_API_TIMEOUT_MS ?? "10000");

function fail(message) {
  console.error(`Vercel Node version validation failed: ${message}`);
  process.exit(1);
}

function nodeMajor(value, source) {
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${source} does not declare a Node version.`);
  }

  const match = value.trim().match(/^(?:[<>=~^ ]*)?v?(\d+)/);
  if (!match) {
    fail(`could not determine the Node major version from ${source} "${value}".`);
  }

  return Number(match[1]);
}

if (!token) {
  console.log(
    "Vercel Node version validation skipped: VERCEL_TOKEN is not available. package.json engines.node remains the effective Vercel build version.",
  );
  process.exit(0);
}

if (!projectId) {
  fail(
    "VERCEL_PROJECT_ID is required to identify the Vercel project. Vercel supplies it automatically during builds.",
  );
}

if (!Number.isFinite(apiTimeoutMs) || apiTimeoutMs <= 0) {
  fail("VERCEL_API_TIMEOUT_MS must be a positive number of milliseconds.");
}

let packageJson;
try {
  packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

const query = teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";
let response;
try {
  response = await fetch(
    `${apiBaseUrl}/v9/projects/${encodeURIComponent(projectId)}${query}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(apiTimeoutMs),
    },
  );
} catch (error) {
  if (error instanceof Error && error.name === "TimeoutError") {
    fail(
      `the Vercel project configuration request timed out after ${apiTimeoutMs}ms. Check Vercel API availability and try the deployment again.`,
    );
  }
  fail(
    `could not query the Vercel project configuration: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
}

if (!response.ok) {
  let providerCode = "";
  try {
    const body = await response.json();
    providerCode =
      typeof body?.error?.code === "string" ? ` (${body.error.code})` : "";
  } catch {
    // The status is sufficient and avoids echoing an untrusted response body.
  }
  fail(
    `Vercel returned HTTP ${response.status}${providerCode} while reading project settings. Check the project/team identifiers and token permissions.`,
  );
}

let project;
try {
  project = await response.json();
} catch {
  fail("Vercel returned an invalid project configuration response.");
}

const packageMajor = nodeMajor(
  packageJson.engines?.node,
  "package.json engines.node",
);
const vercelMajor = nodeMajor(project.nodeVersion, "Vercel project nodeVersion");

if (packageMajor !== vercelMajor) {
  fail(
    `package.json requires Node ${packageMajor}, but Vercel project "${project.name ?? projectId}" is configured for Node ${vercelMajor}. Update the Vercel project setting or package.json so both use the same major version.`,
  );
}

console.log(
  `Vercel Node version validation passed: package.json and project "${project.name ?? projectId}" both use Node ${packageMajor}.`,
);