import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const scriptPath = resolve("scripts/check-vercel-node-version.mjs");
const temporaryDirectories: string[] = [];
const servers: Server[] = [];
const secretToken = "test-token-that-must-never-be-printed";

type ApiResponse = {
  body: string;
  contentType?: string;
  neverRespond?: boolean;
  status?: number;
};

async function startApi(response: ApiResponse) {
  const server = createServer((request, reply) => {
    expect(request.headers.authorization).toBe(`Bearer ${secretToken}`);
    if (response.neverRespond) {
      return;
    }
    reply.writeHead(response.status ?? 200, {
      "content-type": response.contentType ?? "application/json",
    });
    reply.end(response.body);
  });
  servers.push(server);

  await new Promise<void>((resolveListening) => {
    server.listen(0, "127.0.0.1", resolveListening);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test API did not expose a TCP port.");
  }
  return `http://127.0.0.1:${address.port}`;
}

async function runValidator({
  apiResponse,
  env = {},
  packageJson = { engines: { node: "22.x" } },
}: {
  apiResponse?: ApiResponse;
  env?: Record<string, string | undefined>;
  packageJson?: unknown;
}) {
  const directory = await mkdtemp(resolve(tmpdir(), "vercel-node-version-"));
  temporaryDirectories.push(directory);
  const packageJsonPath = resolve(directory, "package.json");
  await writeFile(packageJsonPath, JSON.stringify(packageJson));

  const apiUrl = apiResponse ? await startApi(apiResponse) : undefined;
  const childEnv = {
    ...process.env,
    VERCEL: undefined,
    VERCEL_API_URL: apiUrl,
    VERCEL_ORG_ID: undefined,
    VERCEL_PROJECT_ID: undefined,
    VERCEL_TOKEN: undefined,
    ...env,
  };

  try {
    const result = await execFileAsync(
      process.execPath,
      [scriptPath, packageJsonPath],
      { env: childEnv },
    );
    return { exitCode: 0, stderr: result.stderr, stdout: result.stdout };
  } catch (error) {
    const failure = error as {
      code: number;
      stderr: string;
      stdout: string;
    };
    return {
      exitCode: failure.code,
      stderr: failure.stderr,
      stdout: failure.stdout,
    };
  }
}

function expectTokenRedacted(result: { stderr: string; stdout: string }) {
  expect(result.stdout).not.toContain(secretToken);
  expect(result.stderr).not.toContain(secretToken);
}

afterEach(async () => {
  await Promise.all([
    ...temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
    ...servers.splice(0).map(
      (server) =>
        new Promise<void>((resolveClosed, reject) => {
          server.close((error) => (error ? reject(error) : resolveClosed()));
        }),
    ),
  ]);
});

describe("check-vercel-node-version", () => {
  it("accepts matching package and Vercel Node majors", async () => {
    const result = await runValidator({
      apiResponse: { body: JSON.stringify({ name: "erp", nodeVersion: "22.x" }) },
      env: { VERCEL_PROJECT_ID: "project-id", VERCEL_TOKEN: secretToken },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("both use Node 22");
    expect(result.stderr).toBe("");
    expectTokenRedacted(result);
  });

  it("blocks a deployment when Vercel uses a different Node major", async () => {
    const result = await runValidator({
      apiResponse: { body: JSON.stringify({ name: "erp", nodeVersion: "20.x" }) },
      env: { VERCEL: "1", VERCEL_PROJECT_ID: "project-id", VERCEL_TOKEN: secretToken },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("package.json requires Node 22");
    expect(result.stderr).toContain("configured for Node 20");
    expectTokenRedacted(result);
  });

  it("rejects an invalid JSON response without printing its contents", async () => {
    const result = await runValidator({
      apiResponse: { body: `invalid response containing ${secretToken}` },
      env: { VERCEL_PROJECT_ID: "project-id", VERCEL_TOKEN: secretToken },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("invalid project configuration response");
    expectTokenRedacted(result);
  });

  it("rejects API errors without printing an untrusted response body", async () => {
    const result = await runValidator({
      apiResponse: {
        body: JSON.stringify({
          error: { code: "forbidden", message: `do not print ${secretToken}` },
        }),
        status: 403,
      },
      env: { VERCEL_PROJECT_ID: "project-id", VERCEL_TOKEN: secretToken },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("HTTP 403 (forbidden)");
    expect(result.stderr).not.toContain("do not print");
    expectTokenRedacted(result);
  });

  it("blocks a deployment when the Vercel API does not respond", async () => {
    const result = await runValidator({
      apiResponse: { body: "", neverRespond: true },
      env: {
        VERCEL_API_TIMEOUT_MS: "50",
        VERCEL_PROJECT_ID: "project-id",
        VERCEL_TOKEN: secretToken,
      },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "Vercel project configuration request timed out after 50ms",
    );
    expect(result.stderr).toContain("try the deployment again");
    expectTokenRedacted(result);
  });

  it("uses the package engine and skips the API check without VERCEL_TOKEN during a Vercel build", async () => {
    const result = await runValidator({ env: { VERCEL: "1" } });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("validation skipped");
    expect(result.stdout).toContain("engines.node remains the effective Vercel build version");
    expect(result.stderr).toBe("");
    expectTokenRedacted(result);
  });

  it("skips without VERCEL_TOKEN outside a Vercel build", async () => {
    const result = await runValidator({});

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("validation skipped");
    expect(result.stderr).toBe("");
    expectTokenRedacted(result);
  });
});