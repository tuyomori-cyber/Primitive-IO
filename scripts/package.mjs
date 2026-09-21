import { execFile } from "node:child_process";
import { mkdir, readFile, unlink } from "node:fs/promises";
import { promisify } from "node:util";

import "./build.mjs";

const executeFile = promisify(execFile);
const manifest = JSON.parse(await readFile("src/manifest.json", "utf8"));
const outputDirectory = "dist";
const archivePath = `${outputDirectory}/primitive-io-${manifest.version}.xpi`;
const packageFiles = ["manifest.json", "background.js", "content.js", "options.html", "options.js"];

await mkdir(outputDirectory, { recursive: true });
await unlink(archivePath).catch((error) => {
  if (error.code !== "ENOENT") {
    throw error;
  }
});

await executeFile("zip", ["-q", "-r", `primitive-io-${manifest.version}.xpi`, ...packageFiles], {
  cwd: outputDirectory
});

console.log(`Created ${archivePath}`);
