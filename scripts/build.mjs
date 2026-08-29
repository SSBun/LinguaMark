import { cp, mkdir, rm } from "node:fs/promises";
import { build } from "esbuild";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });

await build({
  entryPoints: [
    "src/background.ts",
    "src/content.ts",
    "src/options.ts",
    "src/popup.ts",
  ],
  bundle: true,
  define: { "process.env.NODE_ENV": '"production"' },
  entryNames: "[name]",
  format: "iife",
  outdir: "dist",
  platform: "browser",
  target: "chrome120",
});

await cp("public", "dist", { recursive: true });
