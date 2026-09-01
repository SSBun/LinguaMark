import {
  getStoredDirectoryHandle,
  queryDirectoryPermission,
  requestDirectoryPermission,
  storeDirectoryHandle,
} from "./directory.ts";
import { logInfo, logWarn } from "./debug.ts";

const status = requiredElement<HTMLElement>("status");
const restoreButton = requiredElement<HTMLButtonElement>("restore-directory");
const chooseButton = requiredElement<HTMLButtonElement>("choose-directory");
const searchParams = new URLSearchParams(location.search);
const tabId = Number.parseInt(searchParams.get("tabId") ?? "", 10);
const isolated = searchParams.get("isolated") === "1";
const directoryTabId = isolated ? tabId : undefined;
let storedHandle: FileSystemDirectoryHandle | undefined;

void initialize();

restoreButton.addEventListener("click", () => {
  void restoreDirectory();
});

chooseButton.addEventListener("click", () => {
  void chooseDirectory();
});

async function initialize(): Promise<void> {
  if (isolated && !Number.isInteger(tabId)) {
    setStatus("无法识别目标阅读器页面。", true);
    chooseButton.disabled = true;
    return;
  }
  if (typeof window.showDirectoryPicker !== "function") {
    setStatus("当前 Chrome 不支持目录选择。", true);
    chooseButton.disabled = true;
    return;
  }

  try {
    storedHandle = await getStoredDirectoryHandle(directoryTabId);
    if (!storedHandle) {
      setStatus("选择一个包含 Markdown 与图片的目录。", false);
      return;
    }
    const permission = await queryDirectoryPermission(storedHandle);
    restoreButton.hidden = false;
    restoreButton.textContent = permission === "granted"
      ? `使用“${storedHandle.name}”`
      : `重新授权“${storedHandle.name}”`;
    setStatus(permission === "granted"
      ? "可以继续使用已保存的目录，或选择其他目录。"
      : "Chrome 需要你重新确认目录访问权限。", false);
  } catch (error: unknown) {
    logWarn("directory", "picker.initialize.failed", { errorName: errorName(error) });
    setStatus("无法读取已保存的目录授权。", true);
  }
}

async function restoreDirectory(): Promise<void> {
  if (!storedHandle) return;
  setBusy(true);
  try {
    if (await requestDirectoryPermission(storedHandle) !== "granted") {
      setStatus("未获得目录访问权限。", true);
      return;
    }
    await complete(storedHandle);
  } catch (error: unknown) {
    logWarn("directory", "picker.restore.failed", { errorName: errorName(error) });
    setStatus("目录重新授权失败。", true);
  } finally {
    setBusy(false);
  }
}

async function chooseDirectory(): Promise<void> {
  setBusy(true);
  try {
    const handle = await window.showDirectoryPicker({ id: "linguamark-markdown-directory", mode: "read" });
    await complete(handle);
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === "AbortError") {
      setStatus("已取消目录选择。", false);
    } else {
      logWarn("directory", "picker.choose.failed", { errorName: errorName(error) });
      setStatus("无法打开所选目录。", true);
    }
  } finally {
    setBusy(false);
  }
}

async function complete(handle: FileSystemDirectoryHandle): Promise<void> {
  await storeDirectoryHandle(handle, directoryTabId);
  logInfo("directory", "picker.completed");
  setStatus(`已授权“${handle.name}”。`, false);
  if (Number.isInteger(tabId)) {
    await chrome.runtime.sendMessage({ type: "DIRECTORY_PICKER_COMPLETE", tabId });
  }
  window.setTimeout(() => window.close(), 250);
}

function setBusy(busy: boolean): void {
  restoreButton.disabled = busy;
  chooseButton.disabled = busy;
  document.body.setAttribute("aria-busy", String(busy));
}

function setStatus(message: string, error: boolean): void {
  status.textContent = message;
  status.classList.toggle("is-error", error);
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}
