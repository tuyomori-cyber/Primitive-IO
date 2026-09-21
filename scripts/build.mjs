import { build } from "esbuild";
import { cp, mkdir } from "node:fs/promises";

const outputDirectory = "dist";

await mkdir(outputDirectory, { recursive: true });

await Promise.all([
  build({
    bundle: true,
    entryPoints: ["src/background/index.ts"],
    format: "iife",
    outfile: `${outputDirectory}/background.js`,
    platform: "browser",
    sourcemap: true,
    target: "firefox128"
  }),
  build({
    bundle: true,
    entryPoints: ["src/content/index.ts"],
    format: "iife",
    outfile: `${outputDirectory}/content.js`,
    platform: "browser",
    sourcemap: true,
    target: "firefox128"
  }),
  build({
    bundle: true,
    entryPoints: ["src/options/index.ts"],
    format: "iife",
    outfile: `${outputDirectory}/options.js`,
    platform: "browser",
    sourcemap: true,
    target: "firefox128"
  }),
  cp("src/manifest.json", `${outputDirectory}/manifest.json`),
  cp("src/options/options.html", `${outputDirectory}/options.html`)
]);
