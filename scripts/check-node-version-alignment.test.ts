import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const scriptPath = resolve("scripts/check-node-version-alignment.mjs");
const temporaryDirectories: string[] = [];

async function runValidator({
  packageJson = { engines: { node: "22.x" } },
  replit = 'modules = ["nodejs-22"]\n',
}: {
  packageJson?: unknown;
  replit?: string;
}) {
  const directory = await mkdtemp(resolve(tmpdir(), "node-alignment-"));
  temporaryDirectories.push(directory);

  const packageJsonPath = resolve(directory, "package.json");
  const replitPath = resolve(directory, ".replit");
  await Promise.all([
    writeFile(packageJsonPath, JSON.stringify(packageJson)),
    writeFile(replitPath, replit),
  ]);

  try {
    const result = await execFileAsync(process.execPath, [
      scriptPath,
      packageJsonPath,
      replitPath,
    ]);
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

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("check-node-version-alignment", () => {
  it("accepts aligned Node declarations", async () => {
    const result = await runValidator({});

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("both use Node 22");
    expect(result.stderr).toBe("");
  });

  it("rejects different major versions and explains how to align them", async () => {
    const result = await runValidator({
      replit: 'modules = ["nodejs-20"]\n',
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("requires Node 22");
    expect(result.stderr).toContain("uses nodejs-20");
    expect(result.stderr).toContain(
      "Update both declarations to the same major version",
    );
  });

  it("rejects a missing engines.node declaration and shows an example", async () => {
    const result = await runValidator({ packageJson: {} });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("must declare engines.node");
    expect(result.stderr).toContain('Add an engines.node value such as "22.x"');
  });

  it("rejects multiple Node modules and explains which entry to keep", async () => {
    const result = await runValidator({
      replit: 'modules = ["nodejs-20", "python-base-3.13", "nodejs-22"]\n',
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("exactly one nodejs-<major> module; found 2");
    expect(result.stderr).toContain(
      'Keep one entry such as "nodejs-22" and remove any others',
    );
  });

  it("rejects an unrecognizable engines.node value and shows a valid format", async () => {
    const result = await runValidator({
      packageJson: { engines: { node: "latest" } },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      'could not determine the Node major version from package.json engines.node "latest"',
    );
    expect(result.stderr).toContain(
      'Use a recognizable value such as "22.x"',
    );
  });

  it("rejects a missing modules array and shows the declaration to add", async () => {
    const result = await runValidator({ replit: "[deployment]\n" });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("must declare a modules array");
    expect(result.stderr).toContain('modules = ["nodejs-22"]');
  });

  it("rejects an unrecognizable Node module and shows a valid module", async () => {
    const result = await runValidator({
      replit: 'modules = ["nodejs-lts"]\n',
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("exactly one nodejs-<major> module; found 0");
    expect(result.stderr).toContain('Keep one entry such as "nodejs-22"');
  });
});