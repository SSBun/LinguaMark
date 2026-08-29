import { access, chmod, mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionPath = join(root, "dist");
const fixturePath = join(root, "tests", "fixtures", "english-reading-article.html");

await access(join(extensionPath, "manifest.json"));
const fixture = await readFile(fixturePath);
const server = createServer((request, response) => {
  if (request.url === "/favicon.ico") {
    response.writeHead(204).end();
    return;
  }
  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Length": String(fixture.length),
    "Content-Type": "text/html; charset=utf-8",
  });
  response.end(fixture);
});

await new Promise((resolvePromise, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolvePromise);
});

const address = server.address();
if (!address || typeof address === "string") throw new Error("无法启动本地测试页面服务");
const url = `http://127.0.0.1:${address.port}/english-reading-article.html`;
const profile = resolve(process.env.LINGUAMARK_DEV_PROFILE
  ?? join(homedir(), "Library", "Application Support", "LinguaMark", "DevChromeProfile"));
await mkdir(profile, { recursive: true, mode: 0o700 });
await chmod(profile, 0o700);

let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    executablePath: chromium.executablePath(),
    headless: false,
    viewport: null,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--no-default-browser-check",
      "--no-first-run",
      "--start-maximized",
    ],
  });

  let worker = context.serviceWorkers().find((candidate) => candidate.url().startsWith("chrome-extension://"));
  worker ??= await context.waitForEvent("serviceworker", { timeout: 15_000 });

  const extensionId = new URL(worker.url()).host;
  const optionsPage = await context.newPage();
  await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);

  const page = context.pages()[0] ?? await context.newPage();
  await page.goto(url);
  await page.bringToFront();
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  console.log(JSON.stringify({
    status: "ready",
    title: await page.title(),
    url: page.url(),
    extensionId,
    optionsUrl: optionsPage.url(),
    profile,
    viewport,
  }));

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => { void context.close(); });
  }
  await new Promise((resolvePromise) => context.once("close", resolvePromise));
} finally {
  server.close();
}
