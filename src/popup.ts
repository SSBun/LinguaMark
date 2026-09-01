import { logInfo, logWarn } from "./debug.ts";
import {
  DEFAULT_DISPLAY_SETTINGS,
  DISPLAY_KEY,
  readDisplaySettings,
  type DisplaySettings,
} from "./contracts.ts";

const analyzeButton = requiredElement<HTMLButtonElement>("analyze");
const analyzeLabel = analyzeButton.querySelector("span");
const openReaderButton = requiredElement<HTMLButtonElement>("open-reader");
const optionsButton = requiredElement<HTMLButtonElement>("options");
const status = requiredElement<HTMLElement>("status");
const boundaries = requiredElement<HTMLInputElement>("boundaries");
const importance = requiredElement<HTMLInputElement>("importance");
const grammar = requiredElement<HTMLInputElement>("grammar");
let displaySettings = readDisplaySettings(DEFAULT_DISPLAY_SETTINGS);
let activeAnalysisTabId: number | undefined;

void initialize();

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[DISPLAY_KEY]) {
    const next = readDisplaySettings(changes[DISPLAY_KEY].newValue);
    logInfo("popup", "display.storage-changed", {
      boundaries: next.boundaries,
      importance: next.importance,
      grammar: next.grammar,
    });
    setCheckboxes(next);
  }
});

chrome.runtime.onMessage.addListener((message: unknown) => {
  if (!isRecord(message)
    || message.type !== "ANALYSIS_PROGRESS"
    || message.tabId !== activeAnalysisTabId
    || typeof message.completedCount !== "number"
    || typeof message.totalCount !== "number") {
    return;
  }

  const failedCount = typeof message.failedCount === "number" ? message.failedCount : 0;
  const discoveredSentenceCount = typeof message.discoveredSentenceCount === "number"
    ? message.discoveredSentenceCount
    : 0;
  const validSentenceCount = typeof message.validSentenceCount === "number" ? message.validSentenceCount : 0;
  const renderedSentenceCount = typeof message.renderedSentenceCount === "number" ? message.renderedSentenceCount : 0;
  const failedSentenceCount = typeof message.failedSentenceCount === "number" ? message.failedSentenceCount : 0;
  logInfo("popup", "analysis.progress.received", {
    tabId: message.tabId,
    completedCount: message.completedCount,
    totalCount: message.totalCount,
    succeededCount: typeof message.paragraphCount === "number" ? message.paragraphCount : undefined,
    failedCount,
    discoveredSentenceCount,
    validSentenceCount,
    renderedSentenceCount,
    failedSentenceCount,
    activeCount: typeof message.activeCount === "number" ? message.activeCount : undefined,
  });
  const lastError = typeof message.lastError === "string" ? message.lastError : "";
  const failure = failedSentenceCount > 0
    ? `，${failedSentenceCount} 句失败${lastError ? `：${lastError}` : ""}`
    : "";
  setStatus(discoveredSentenceCount > 0
    ? `已解析 ${renderedSentenceCount}/${discoveredSentenceCount} 句${failure}`
    : `已完成 ${message.completedCount}/${message.totalCount} 个可见文本块${failure}`);
  if (analyzeLabel) analyzeLabel.textContent = discoveredSentenceCount > 0
    ? `正在分析 ${renderedSentenceCount}/${discoveredSentenceCount} 句`
    : `正在分析 ${message.completedCount}/${message.totalCount}`;
});

analyzeButton.addEventListener("click", () => {
  logInfo("popup", "analysis.button-clicked");
  void analyzeCurrentPage();
});

openReaderButton.addEventListener("click", () => {
  logInfo("popup", "reader.open-requested");
  void openStandaloneViewer();
});

optionsButton.addEventListener("click", () => {
  logInfo("popup", "options.open-requested");
  void chrome.runtime.openOptionsPage();
});

for (const checkbox of [boundaries, importance, grammar]) {
  checkbox.addEventListener("change", () => {
    void updateDisplaySettings();
  });
}

async function initialize(): Promise<void> {
  const stored = await chrome.storage.local.get(DISPLAY_KEY);
  const initial = readDisplaySettings(stored[DISPLAY_KEY] ?? DEFAULT_DISPLAY_SETTINGS);
  setCheckboxes(initial);
  await showLocalFileStatus();
  logInfo("popup", "popup.ready", {
    boundaries: initial.boundaries,
    importance: initial.importance,
    grammar: initial.grammar,
  });
}

async function openStandaloneViewer(): Promise<void> {
  openReaderButton.disabled = true;
  try {
    const created = await chrome.tabs.create({ url: chrome.runtime.getURL("viewer.html"), active: true });
    logInfo("popup", "reader.created", { tabId: created.id });
    setStatus("阅读器已打开");
  } catch (error: unknown) {
    logWarn("popup", "reader.open-failed", { error });
    setStatus(error instanceof Error ? error.message : "无法打开阅读器", true);
  } finally {
    openReaderButton.disabled = false;
  }
}

async function analyzeCurrentPage(): Promise<void> {
  const startedAt = performance.now();
  analyzeButton.disabled = true;
  analyzeButton.setAttribute("aria-busy", "true");
  if (analyzeLabel) analyzeLabel.textContent = "正在分析…";
  setStatus("正在分析…");

  try {
    const tab = await findTargetTab();
    activeAnalysisTabId = tab.id;
    logInfo("popup", "analysis.message-sending", { tabId: tab.id });
    const response: unknown = await chrome.runtime.sendMessage({ type: "ANALYZE_TAB", tabId: tab.id });
    if (!isRecord(response) || response.ok !== true) {
      throw new Error(isRecord(response) && typeof response.error === "string" ? response.error : "分析失败");
    }

    const count = typeof response.paragraphCount === "number" ? response.paragraphCount : 0;
    const totalCount = typeof response.totalCount === "number" ? response.totalCount : count;
    const failedCount = typeof response.failedCount === "number" ? response.failedCount : 0;
    const warningCount = typeof response.warningCount === "number" ? response.warningCount : 0;
    const discoveredSentenceCount = typeof response.discoveredSentenceCount === "number"
      ? response.discoveredSentenceCount
      : 0;
    const validSentenceCount = typeof response.validSentenceCount === "number" ? response.validSentenceCount : 0;
    const renderedSentenceCount = typeof response.renderedSentenceCount === "number" ? response.renderedSentenceCount : 0;
    const failedSentenceCount = typeof response.failedSentenceCount === "number" ? response.failedSentenceCount : 0;
    const lastError = typeof response.lastError === "string" ? response.lastError : "";
    const suffix = [
      failedSentenceCount > 0 ? `${failedSentenceCount} 句失败${lastError ? `：${lastError}` : ""}` : "",
      warningCount > 0 ? `${warningCount} 处已降级` : "",
    ].filter(Boolean).join("，");
    const finalMessage = discoveredSentenceCount > 0
      ? `已标记 ${renderedSentenceCount}/${discoveredSentenceCount} 句${suffix ? `，${suffix}` : ""}`
      : `已标记 ${count}/${totalCount} 个可见文本块${suffix ? `，${suffix}` : ""}`;
    setStatus(finalMessage, discoveredSentenceCount > 0
      ? renderedSentenceCount === 0 && failedSentenceCount > 0
      : count === 0 && failedCount > 0);
    logInfo("popup", "analysis.completed", {
      tabId: activeAnalysisTabId,
      paragraphCount: count,
      totalCount,
      failedCount,
      warningCount,
      discoveredSentenceCount,
      validSentenceCount,
      renderedSentenceCount,
      failedSentenceCount,
      durationMs: Math.round(performance.now() - startedAt),
    });
  } catch (error: unknown) {
    logWarn("popup", "analysis.failed", {
      tabId: activeAnalysisTabId,
      durationMs: Math.round(performance.now() - startedAt),
      error,
    });
    setStatus(error instanceof Error ? error.message : "分析失败", true);
  } finally {
    activeAnalysisTabId = undefined;
    analyzeButton.disabled = false;
    analyzeButton.removeAttribute("aria-busy");
    if (analyzeLabel) analyzeLabel.textContent = "分析可见文字";
  }
}

async function updateDisplaySettings(): Promise<void> {
  const display = currentDisplaySettings();
  displaySettings = display;
  logInfo("popup", "display.update-requested", {
    boundaries: display.boundaries,
    importance: display.importance,
    grammar: display.grammar,
  });
  await chrome.storage.local.set({ [DISPLAY_KEY]: display });

  try {
    const tab = await findTargetTab();
    await chrome.tabs.sendMessage(tab.id!, { type: "SET_DISPLAY", display });
    logInfo("popup", "display.update-delivered", { tabId: tab.id });
  } catch (error: unknown) {
    logWarn("popup", "display.update-not-delivered", { error });
  }
}

async function findTargetTab(): Promise<chrome.tabs.Tab> {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const target = tabs
    .filter((tab) => tab.id !== undefined && isSupportedPage(tab.url))
    .sort((left, right) => (right.lastAccessed ?? 0) - (left.lastAccessed ?? 0))[0];
  if (!target?.id) {
    logWarn("popup", "target-tab.not-found", { tabCount: tabs.length });
    throw new Error("请先打开一个网页或本地 Markdown 文件");
  }
  if (target.url?.startsWith("file:") && !(await chrome.extension.isAllowedFileSchemeAccess())) {
    throw new Error("请在扩展详情页开启“允许访问文件网址”并刷新 Markdown 页面");
  }
  logInfo("popup", "target-tab.selected", {
    tabId: target.id,
    hostname: target.url ? new URL(target.url).hostname || "local-file" : "unknown",
  });
  return target;
}

async function showLocalFileStatus(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.startsWith("file:") || !isSupportedPage(tab.url)) return;
  if (!(await chrome.extension.isAllowedFileSchemeAccess())) {
    analyzeButton.disabled = true;
    if (analyzeLabel) analyzeLabel.textContent = "请开启本地文件访问";
    setStatus("请在扩展详情页开启“允许访问文件网址”，然后刷新 Markdown 页面", true);
    return;
  }
  setStatus("Markdown 仅本地渲染；点击分析后才会发送正文");
}

function isSupportedPage(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:"
      || url.protocol === "https:"
      || (url.protocol === "file:" && /\.md$/iu.test(url.pathname))
      || `${url.origin}${url.pathname}` === chrome.runtime.getURL("viewer.html");
  } catch {
    return false;
  }
}

function currentDisplaySettings(): DisplaySettings {
  return {
    ...displaySettings,
    boundaries: boundaries.checked,
    importance: importance.checked,
    grammar: grammar.checked,
  };
}

function setCheckboxes(display: DisplaySettings): void {
  displaySettings = display;
  boundaries.checked = display.boundaries;
  importance.checked = display.importance;
  grammar.checked = display.grammar;
  for (const type of ["subject", "verb", "object", "complement"] as const) {
    document.documentElement.style.setProperty(`--${type}`, display.highlights[type].color);
  }
}

function setStatus(message: string, error = false): void {
  logInfo("popup", "status.updated", { message, error });
  status.textContent = message;
  status.classList.toggle("error", error);
  status.classList.toggle("success", !error && message.startsWith("已标记"));
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
