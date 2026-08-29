import { logError, logInfo, logWarn } from "./debug.ts";
import {
  DEFAULT_DISPLAY_SETTINGS,
  DISPLAY_KEY,
  readDisplaySettings,
  type DisplaySettings,
} from "./contracts.ts";

const analyzeButton = requiredElement<HTMLButtonElement>("analyze");
const analyzeLabel = analyzeButton.querySelector("span");
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
  logInfo("popup", "analysis.progress.received", {
    tabId: message.tabId,
    completedCount: message.completedCount,
    totalCount: message.totalCount,
    succeededCount: typeof message.paragraphCount === "number" ? message.paragraphCount : undefined,
    failedCount,
    activeCount: typeof message.activeCount === "number" ? message.activeCount : undefined,
  });
  const lastError = typeof message.lastError === "string" ? message.lastError : "";
  const failure = failedCount > 0 ? `，${failedCount} 个失败${lastError ? `：${lastError}` : ""}` : "";
  setStatus(`已完成 ${message.completedCount}/${message.totalCount} 个可见段落${failure}`);
  if (analyzeLabel) analyzeLabel.textContent = `正在分析 ${message.completedCount}/${message.totalCount}`;
});

analyzeButton.addEventListener("click", () => {
  logInfo("popup", "analysis.button-clicked");
  void analyzeCurrentPage();
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
  logInfo("popup", "popup.ready", {
    boundaries: initial.boundaries,
    importance: initial.importance,
    grammar: initial.grammar,
  });
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
    const lastError = typeof response.lastError === "string" ? response.lastError : "";
    const suffix = [
      failedCount > 0 ? `${failedCount} 个失败${lastError ? `：${lastError}` : ""}` : "",
      warningCount > 0 ? `${warningCount} 处已降级` : "",
    ].filter(Boolean).join("，");
    const finalMessage = `已标记 ${count}/${totalCount} 个可见段落${suffix ? `，${suffix}` : ""}`;
    setStatus(finalMessage, count === 0 && failedCount > 0);
    logInfo("popup", "analysis.completed", {
      tabId: activeAnalysisTabId,
      paragraphCount: count,
      totalCount,
      failedCount,
      warningCount,
      durationMs: Math.round(performance.now() - startedAt),
    });
  } catch (error: unknown) {
    logError("popup", "analysis.failed", {
      tabId: activeAnalysisTabId,
      durationMs: Math.round(performance.now() - startedAt),
      error,
    });
    setStatus(error instanceof Error ? error.message : "分析失败", true);
  } finally {
    activeAnalysisTabId = undefined;
    analyzeButton.disabled = false;
    analyzeButton.removeAttribute("aria-busy");
    if (analyzeLabel) analyzeLabel.textContent = "分析可见内容";
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
    .filter((tab) => tab.id !== undefined && /^https?:/u.test(tab.url ?? ""))
    .sort((left, right) => (right.lastAccessed ?? 0) - (left.lastAccessed ?? 0))[0];
  if (!target?.id) {
    logWarn("popup", "target-tab.not-found", { tabCount: tabs.length });
    throw new Error("请先打开一个 HTTP 或 HTTPS 文章页面");
  }
  logInfo("popup", "target-tab.selected", {
    tabId: target.id,
    hostname: target.url ? new URL(target.url).hostname : "unknown",
  });
  return target;
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
