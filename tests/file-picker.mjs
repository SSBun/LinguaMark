import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const userDataDir = await mkdtemp(join(tmpdir(), "linguamark-file-picker-"));
let context;

try {
  const executablePath = chromium.executablePath();
  await access(executablePath);
  context = await chromium.launchPersistentContext(userDataDir, {
    executablePath,
    headless: false,
    viewport: { width: 1100, height: 800 },
    args: [
      `--disable-extensions-except=${resolve("dist")}`,
      `--load-extension=${resolve("dist")}`,
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });
  await context.addInitScript(() => {
    window.__pickerMode = "success";
    window.__pickerOptions = undefined;
    window.__pickerSource = "# Picker Test\n\n中文内容";
    window.showOpenFilePicker = async (options) => {
      window.__pickerOptions = options;
      if (window.__pickerMode === "cancel") throw new DOMException("cancelled", "AbortError");
      if (window.__pickerMode === "fail") throw new DOMException("blocked", "NotAllowedError");
      const root = await navigator.storage.getDirectory();
      const handle = await root.getFileHandle("picker-test.md", { create: true });
      const writable = await handle.createWritable();
      await writable.write(window.__pickerSource);
      await writable.close();
      return [handle];
    };
  });

  let worker = context.serviceWorkers().find((candidate) => candidate.url().startsWith("chrome-extension://"));
  worker ??= await context.waitForEvent("serviceworker", { timeout: 15_000 });
  const page = await context.newPage();
  const logs = [];
  page.on("console", (message) => logs.push(message.text()));
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/viewer.html`);
  const button = page.getByRole("button", { name: "打开文件" });
  const characterCount = page.locator(".linguamark-markdown-character-count");
  assert.equal(await characterCount.textContent(), "0 字词");
  assert.equal(await characterCount.getAttribute("data-linguamark-ui"), "");

  await button.click();
  await page.getByRole("heading", { name: "Picker Test" }).waitFor();
  assert.equal(await button.isEnabled(), true);
  assert.deepEqual(await page.evaluate(() => window.__pickerOptions), {
    startIn: "downloads",
    multiple: false,
    excludeAcceptAllOption: true,
    types: [{ description: "Markdown", accept: { "text/markdown": [".md"] } }],
  });
  assert.ok(logs.some((message) => message.includes("markdown.file-picker.requested")));
  assert.ok(logs.some((message) => message.includes("markdown.file-picker.selected")));
  assert.ok(logs.some((message) => message.includes("markdown.file-picker.opened")));
  assert.equal(await characterCount.textContent(), "6 字词");
  const labelBounds = await characterCount.boundingBox();
  const sidebarBounds = await page.locator("#linguamark-markdown-toc").boundingBox();
  assert.ok(labelBounds && sidebarBounds);
  assert.ok(labelBounds.y >= sidebarBounds.y + sidebarBounds.height);

  await page.evaluate(() => {
    window.__pickerSource = "中文，hello world! 123 can't can’t state-of-the-art";
  });
  await button.click();
  await page.waitForFunction(() => document.querySelector(".linguamark-markdown-character-count")?.textContent === "7 字词");

  await page.evaluate(() => { window.__reuseProbe = true; });
  const duplicate = await context.newPage();
  await duplicate.goto(page.url());
  await duplicate.evaluate(() => { window.__pickerSource = "# Picker Test\n\nRefreshed 中文内容"; });
  const duplicateClosed = duplicate.waitForEvent("close");
  await duplicate.getByRole("button", { name: "打开文件" }).click();
  await duplicateClosed;
  await page.waitForFunction(() => !window.__reuseProbe && document.querySelector("#write")?.textContent?.includes("Refreshed"));
  assert.equal(await characterCount.textContent(), "7 字词");
  assert.equal(context.pages().filter((candidate) => candidate.url() === page.url()).length, 1);
  assert.equal((await page.evaluate(() => chrome.tabs.getCurrent())).active, true);

  await page.evaluate(() => { window.__pickerMode = "cancel"; });
  const cancelled = waitForConsole(page, "markdown.file-picker.cancelled");
  await button.click();
  await cancelled;
  assert.equal(await page.getByRole("heading", { name: "Picker Test" }).count(), 1);
  assert.equal(await button.isEnabled(), true);

  await page.evaluate(() => { window.__pickerMode = "fail"; });
  const failed = waitForConsole(page, "markdown.file-picker.request.failed");
  await button.click();
  await failed;
  await page.getByText("无法打开系统文件选择器").waitFor();
  assert.equal(await button.isEnabled(), true);
  assert.equal(logs.some((message) => message.includes("picker-test.md") || message.includes("# Picker Test")), false);

  console.log("PASS 文件选择、中英字词统计、重复标签复用、取消、失败、日志与 Downloads 起点");
} finally {
  await context?.close();
  await rm(userDataDir, { recursive: true, force: true });
}

function waitForConsole(page, needle) {
  return new Promise((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(() => {
      page.off("console", onConsole);
      rejectPromise(new Error(`未收到 Console 日志：${needle}`));
    }, 5_000);
    const onConsole = (message) => {
      if (!message.text().includes(needle)) return;
      clearTimeout(timeout);
      page.off("console", onConsole);
      resolvePromise();
    };
    page.on("console", onConsole);
  });
}
