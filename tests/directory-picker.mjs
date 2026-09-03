import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const temporaryDirectory = await mkdtemp(join(tmpdir(), "linguamark-directory-picker-"));
let context;

try {
  context = await chromium.launchPersistentContext(join(temporaryDirectory, "profile"), {
    executablePath: chromium.executablePath(),
    headless: false,
    viewport: { width: 1100, height: 800 },
    args: [
      `--disable-extensions-except=${resolve("dist")}`,
      `--load-extension=${resolve("dist")}`,
      "--allow-file-access-from-files",
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });
  await context.addInitScript(() => {
    window.showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory();
      const directory = await root.getDirectoryHandle("StandaloneDirect", { create: true });
      const file = await directory.getFileHandle("guide.md", { create: true });
      const writer = await file.createWritable();
      await writer.write("# Standalone Directory");
      await writer.close();
      return directory;
    };
  });

  let worker = context.serviceWorkers().find((candidate) => candidate.url().startsWith("chrome-extension://"));
  worker ??= await context.waitForEvent("serviceworker", { timeout: 15_000 });
  const extensionId = new URL(worker.url()).host;

  await checkStandaloneViewer(extensionId);
  await checkFileViewer();
  assert.equal(context.pages().some((page) => page.url().includes("directory-picker.html")), false);
  console.log("PASS 直接目录选择、取消、读取及 standalone 恢复／file:// 会话隔离");
} finally {
  await context?.close();
  await rm(temporaryDirectory, { recursive: true, force: true });
}

async function checkStandaloneViewer(extensionId) {
  const page = await context.newPage();
  const logs = [];
  page.on("console", (message) => logs.push(message.text()));
  await page.goto(`chrome-extension://${extensionId}/viewer.html`);
  await page.getByRole("button", { name: "打开目录", exact: true }).click();
  await expectDirectory(page, "StandaloneDirect");
  await page.locator('[data-directory-path="guide.md"]').click();
  await page.getByRole("heading", { name: "Standalone Directory" }).waitFor();
  assert.ok(logs.some((message) => message.includes("directory] viewer.picker.requested")));
  assert.ok(logs.some((message) => message.includes("directory] viewer.picker.selected")));

  await page.reload();
  await expectDirectory(page, "StandaloneDirect");
  await page.evaluate(() => {
    window.showDirectoryPicker = async () => { throw new DOMException("cancelled", "AbortError"); };
  });
  await page.getByRole("button", { name: "更换目录", exact: true }).click();
  await waitForLog(logs, "directory] viewer.picker.cancelled");
  await expectDirectory(page, "StandaloneDirect");
}

async function checkFileViewer() {
  const markdownPath = join(temporaryDirectory, "source.md");
  const selectedDirectory = join(temporaryDirectory, "FileDirect");
  await mkdir(selectedDirectory);
  await writeFile(markdownPath, "# File Viewer");
  await writeFile(join(selectedDirectory, "guide.md"), "# File Directory");
  const page = await context.newPage();
  const logs = [];
  page.on("console", (message) => logs.push(message.text()));
  await page.goto(pathToFileURL(markdownPath).href);
  await page.waitForFunction(() => document.documentElement.dataset.linguamarkMarkdown === "ready");
  const input = page.locator('input[type="file"][webkitdirectory]');
  assert.equal(await input.count(), 1);

  let chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /^(?:打开目录|更换目录|重新授权)$/u }).click();
  let chooser = await chooserPromise;
  await chooser.setFiles(selectedDirectory);
  await expectDirectory(page, "FileDirect");
  await page.locator('[data-directory-path="guide.md"]').click();
  await page.getByRole("heading", { name: "File Directory" }).waitFor();

  await input.dispatchEvent("cancel");
  await waitForLog(logs, "directory] viewer.picker.cancelled");
  await expectDirectory(page, "FileDirect");

  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.linguamarkMarkdown === "ready");
  assert.equal(await page.locator(".linguamark-directory-sidebar").count(), 0);
  assert.equal(await page.getByRole("button", { name: "打开目录", exact: true }).isEnabled(), true);
}

async function expectDirectory(page, name) {
  await page.locator(".linguamark-directory-sidebar .linguamark-markdown-toc-title")
    .filter({ hasText: name })
    .waitFor();
}

async function waitForLog(logs, needle) {
  const deadline = Date.now() + 5_000;
  while (!logs.some((message) => message.includes(needle))) {
    if (Date.now() >= deadline) throw new Error(`未收到 Console 日志：${needle}`);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
}
