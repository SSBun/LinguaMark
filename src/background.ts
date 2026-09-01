import { Agent } from "@earendil-works/pi-agent-core";
import {
  contentText,
  createModels,
  createProvider,
  type Model,
  type MutableModels,
  type OpenAICompletionsCompat,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { logInfo, logWarn } from "./debug.ts";
import {
  deleteStoredDirectoryHandle,
  readDirectoryState,
  readStoredDirectoryFile,
  type DirectoryTreeEntry,
} from "./directory.ts";
import { DEFAULT_PARSING_ADAPTER } from "./parsing.ts";
import {
  DEFAULT_DISPLAY_SETTINGS,
  DISPLAY_KEY,
  LEARNING_ITEM_KINDS,
  indexParagraph,
  readDisplaySettings,
  SETTINGS_KEY,
  type DisplaySettings,
  type IndexedParagraph,
  type ParagraphAnnotation,
  type ParagraphResult,
  type ParagraphSnapshot,
  type ProviderSettings,
  validateProviderSettings,
} from "./contracts.ts";

const PARSING_ADAPTER = DEFAULT_PARSING_ADAPTER;

const PROVIDER_ID = "linguamark-openai-compatible";
const SHOW_TRANSLATION_COMMAND = "show-hovered-translation";
const ANALYSIS_TIMEOUT_MS = 180_000;

type AnalysisSettings = ProviderSettings & Pick<DisplaySettings, "analysisConcurrency" | "fullPhrases" | "translation" | "excerpts">;

interface AnalysisSummary {
  paragraphCount: number;
  totalCount: number;
  failedCount: number;
  warningCount: number;
  discoveredSentenceCount: number;
  validSentenceCount: number;
  renderedSentenceCount: number;
  failedSentenceCount: number;
  lastError?: string;
}

interface BatchTracker extends AnalysisSummary {
  remainingCount: number;
  resolve: (summary: AnalysisSummary) => void;
}

interface QueueItem {
  paragraph: ParagraphSnapshot;
  indexed: IndexedParagraph;
  enqueuedAt: number;
  batch?: BatchTracker;
}

interface TabAnalysisState extends AnalysisSummary {
  tabId: number;
  sessionId: string;
  settings: AnalysisSettings;
  knownVersions: Set<string>;
  queue: QueueItem[];
  activeCount: number;
  completedCount: number;
}

const analysisStates = new Map<number, TabAnalysisState>();

chrome.runtime.onInstalled.addListener((details) => {
  logInfo("background", "extension.installed", { reason: details.reason });
  void initializeDisplaySettings();
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!isRecord(message)) return undefined;

  if (message.type === "OPEN_DIRECTORY_PICKER" && sender.tab?.id !== undefined && isMarkdownViewerSender(sender)) {
    const tabId = sender.tab.id;
    const isolated = isStandaloneViewerSender(sender) ? "&isolated=1" : "";
    void chrome.windows.create({
      url: chrome.runtime.getURL(`directory-picker.html?tabId=${tabId}${isolated}`),
      type: "popup",
      width: 520,
      height: 390,
      focused: true,
    }).then(() => sendResponse({ ok: true })).catch((error: unknown) => {
      logWarn("directory", "picker.window.failed", { tabId, error });
      sendResponse({ ok: false, error: errorMessage(error) });
    });
    return true;
  }

  if (message.type === "DIRECTORY_PICKER_COMPLETE"
    && Number.isInteger(message.tabId)
    && sender.url?.startsWith(chrome.runtime.getURL("directory-picker.html"))) {
    const tabId = Number(message.tabId);
    void chrome.tabs.sendMessage(tabId, { type: "DIRECTORY_STATE_CHANGED" })
      .catch(() => undefined)
      .then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === "GET_DIRECTORY_STATE" && isMarkdownViewerSender(sender)) {
    void readDirectoryState(isStandaloneViewerSender(sender) ? sender.tab?.id : undefined).then((state) => {
      logInfo("directory", "state.read", {
        status: state.status,
        entryCount: countDirectoryEntries(state.entries ?? []),
      });
      sendResponse({ ok: true, state });
    }).catch((error: unknown) => {
      logWarn("directory", "state.failed", { error });
      sendResponse({ ok: false, error: errorMessage(error) });
    });
    return true;
  }

  if (message.type === "READ_DIRECTORY_FILE" && typeof message.path === "string" && isMarkdownViewerSender(sender)) {
    void readStoredDirectoryFile(message.path, isStandaloneViewerSender(sender) ? sender.tab?.id : undefined).then((file) => {
      logInfo("directory", "file.read", { kind: file.kind });
      sendResponse({ ok: true, file });
    }).catch((error: unknown) => {
      logWarn("directory", "file.failed", { error });
      sendResponse({ ok: false, error: errorMessage(error) });
    });
    return true;
  }

  const analysisTabId = message.type === "ANALYZE_TAB" && Number.isInteger(message.tabId)
    ? Number(message.tabId)
    : message.type === "ANALYZE_CURRENT_TAB" && sender.tab?.id !== undefined
      ? sender.tab.id
      : undefined;
  if (analysisTabId !== undefined) {
    logInfo("background", "analysis.requested", { tabId: analysisTabId, source: message.type });
    void analyzeTab(analysisTabId)
      .then((result) => {
        logInfo("background", "analysis.initial-batch.completed", { tabId: analysisTabId, ...result });
        sendResponse({ ok: true, ...result });
      })
      .catch((error: unknown) => {
        logWarn("background", "analysis.request.failed", { tabId: analysisTabId, error });
        sendResponse({ ok: false, error: errorMessage(error) });
      });
    return true;
  }

  if (message.type === "QUEUE_VISIBLE_PARAGRAPHS" && sender.tab?.id !== undefined) {
    logInfo("background", "scroll.queue.received", {
      tabId: sender.tab.id,
      receivedCount: Array.isArray(message.paragraphs) ? message.paragraphs.length : 0,
    });
    void queueVisibleParagraphs(sender.tab.id, message.paragraphs)
      .then((queuedCount) => {
        logInfo("background", "scroll.queue.accepted", { tabId: sender.tab?.id, queuedCount });
        sendResponse({ ok: true, queuedCount });
      })
      .catch((error: unknown) => {
        logWarn("background", "scroll.queue.failed", { tabId: sender.tab?.id, error });
        sendResponse({ ok: false, error: errorMessage(error) });
      });
    return true;
  }

  if (message.type === "TEST_PROVIDER") {
    logInfo("background", "provider.test.received");
    void testProvider(message.settings)
      .then(() => sendResponse({ ok: true }))
      .catch((error: unknown) => {
        logWarn("background", "provider.test.rejected", { error });
        sendResponse({ ok: false, error: errorMessage(error) });
      });
    return true;
  }

  return undefined;
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== SHOW_TRANSLATION_COMMAND || tab?.id === undefined) return;
  void chrome.tabs.sendMessage(tab.id, { type: "SHOW_HOVERED_TRANSLATION" }).catch(() => undefined);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  const removed = analysisStates.delete(tabId);
  if (removed) logInfo("background", "analysis.session.removed", { tabId, reason: "tab-closed" });
  void deleteStoredDirectoryHandle(tabId).catch((error: unknown) => {
    logWarn("directory", "viewer.state.cleanup-failed", { tabId, error });
  });
});

async function initializeDisplaySettings(): Promise<void> {
  const stored = await chrome.storage.local.get(DISPLAY_KEY);
  if (stored[DISPLAY_KEY] === undefined) {
    await chrome.storage.local.set({ [DISPLAY_KEY]: DEFAULT_DISPLAY_SETTINGS });
    logInfo("background", "display.defaults.created");
  } else {
    logInfo("background", "display.defaults.preserved");
  }
}

async function analyzeTab(tabId: number): Promise<AnalysisSummary> {
  const existing = analysisStates.get(tabId);
  if (existing && (existing.activeCount > 0 || existing.queue.length > 0)) {
    logWarn("background", "analysis.request.rejected", {
      sessionId: existing.sessionId,
      tabId,
      activeCount: existing.activeCount,
      queuedCount: existing.queue.length,
      reason: "already-running",
    });
    throw new Error("当前页面仍在分析，请等待现有段落完成");
  }

  const state: TabAnalysisState = {
    tabId,
    sessionId: createSessionId(),
    settings: await readSettings(),
    knownVersions: new Set(),
    queue: [],
    activeCount: 0,
    completedCount: 0,
    paragraphCount: 0,
    totalCount: 0,
    failedCount: 0,
    warningCount: 0,
    discoveredSentenceCount: 0,
    validSentenceCount: 0,
    renderedSentenceCount: 0,
    failedSentenceCount: 0,
  };
  analysisStates.set(tabId, state);
  logInfo("background", "analysis.session.started", {
    sessionId: state.sessionId,
    tabId,
    provider: state.settings.provider,
    modelId: state.settings.modelId,
    endpointOrigin: endpointOrigin(state.settings.baseUrl),
    fullPhrases: state.settings.fullPhrases,
    translation: state.settings.translation,
    excerpts: state.settings.excerpts,
    maxConcurrency: state.settings.analysisConcurrency,
  });

  let collected: unknown;
  try {
    collected = await chrome.tabs.sendMessage(tabId, { type: "START_ANALYSIS" });
  } catch (error: unknown) {
    analysisStates.delete(tabId);
    throw error;
  }
  const paragraphs = readParagraphs(collected);
  logInfo("background", "analysis.visible.collected", {
    sessionId: state.sessionId,
    tabId,
    paragraphCount: paragraphs.length,
    paragraphIds: paragraphs.map((paragraph) => paragraph.id),
    characterCount: paragraphs.reduce((sum, paragraph) => sum + paragraph.text.length, 0),
  });
  if (paragraphs.length === 0) {
    analysisStates.delete(tabId);
    throw new Error("当前可见区域没有可分析的英文文字");
  }
  return enqueueInitialParagraphs(state, paragraphs);
}

async function queueVisibleParagraphs(tabId: number, value: unknown): Promise<number> {
  let state = analysisStates.get(tabId);
  if (!state) {
    state = {
      tabId,
      sessionId: createSessionId(),
      settings: await readSettings(),
      knownVersions: new Set(),
      queue: [],
      activeCount: 0,
      completedCount: 0,
      paragraphCount: 0,
      totalCount: 0,
      failedCount: 0,
      warningCount: 0,
      discoveredSentenceCount: 0,
      validSentenceCount: 0,
      renderedSentenceCount: 0,
      failedSentenceCount: 0,
    };
    analysisStates.set(tabId, state);
    logInfo("background", "analysis.session.restored", {
      sessionId: state.sessionId,
      tabId,
      reason: "service-worker-restarted",
      provider: state.settings.provider,
      modelId: state.settings.modelId,
      fullPhrases: state.settings.fullPhrases,
      translation: state.settings.translation,
      excerpts: state.settings.excerpts,
      maxConcurrency: state.settings.analysisConcurrency,
    });
  }
  const paragraphs = readParagraphs({ paragraphs: value });
  logInfo("background", "scroll.queue.parsed", {
    sessionId: state.sessionId,
    tabId,
    paragraphCount: paragraphs.length,
    paragraphIds: paragraphs.map((paragraph) => paragraph.id),
  });
  return enqueueParagraphs(state, paragraphs);
}

function enqueueInitialParagraphs(
  state: TabAnalysisState,
  paragraphs: ParagraphSnapshot[],
): Promise<AnalysisSummary> {
  return new Promise((resolve) => {
    const batch: BatchTracker = {
      paragraphCount: 0,
      totalCount: 0,
      failedCount: 0,
      warningCount: 0,
      discoveredSentenceCount: 0,
      validSentenceCount: 0,
      renderedSentenceCount: 0,
      failedSentenceCount: 0,
      remainingCount: 0,
      resolve,
    };
    const queuedCount = enqueueParagraphs(state, paragraphs, batch);
    batch.totalCount = queuedCount;
    batch.remainingCount = queuedCount;
    if (queuedCount === 0) resolve(summaryFrom(batch));
  });
}

function enqueueParagraphs(
  state: TabAnalysisState,
  paragraphs: ParagraphSnapshot[],
  batch?: BatchTracker,
): number {
  const unseen = paragraphs.filter((paragraph) => !state.knownVersions.has(paragraphVersionKey(paragraph)));
  let addedSentenceCount = 0;
  for (const paragraph of unseen) {
    const indexed = indexParagraph(
      paragraph,
      state.settings.translation,
      LEARNING_ITEM_KINDS.filter((kind) => state.settings.excerpts[kind]),
    );
    state.knownVersions.add(paragraphVersionKey(paragraph));
    state.queue.push({ paragraph, indexed, enqueuedAt: performance.now(), batch });
    addedSentenceCount += indexed.sentences.length;
  }
  state.totalCount += unseen.length;
  state.discoveredSentenceCount += addedSentenceCount;
  if (batch) batch.discoveredSentenceCount += addedSentenceCount;
  logInfo("background", "queue.enqueued", {
    sessionId: state.sessionId,
    tabId: state.tabId,
    addedCount: unseen.length,
    paragraphIds: unseen.map((paragraph) => paragraph.id),
    queuedCount: state.queue.length,
    activeCount: state.activeCount,
    totalCount: state.totalCount,
    addedSentenceCount,
    discoveredSentenceCount: state.discoveredSentenceCount,
  });
  notifyProgress(state);
  pumpQueue(state);
  return unseen.length;
}

function pumpQueue(state: TabAnalysisState): void {
  while (state.activeCount < state.settings.analysisConcurrency && state.queue.length > 0) {
    const item = state.queue.shift();
    if (!item) return;
    state.activeCount += 1;
    void processQueueItem(state, item);
  }
}

async function processQueueItem(state: TabAnalysisState, item: QueueItem): Promise<void> {
  const startedAt = performance.now();
  const queueWaitMs = Math.round(startedAt - item.enqueuedAt);
  const discoveredSentenceCount = item.indexed.sentences.length;
  let validSentenceCount = 0;
  let renderedSentenceCount = 0;
  let failedSentenceCount = discoveredSentenceCount;
  let success = false;
  let warnings = 0;
  let failure: string | undefined;

  logInfo("background", "queue.item.started", {
    sessionId: state.sessionId,
    tabId: state.tabId,
    paragraphId: item.paragraph.id,
    paragraphVersion: item.paragraph.version,
    characterCount: item.paragraph.text.length,
    discoveredSentenceCount,
    queueWaitMs,
    activeCount: state.activeCount,
    queuedCount: state.queue.length,
  });

  try {
    const result = await analyzeParagraph(item.paragraph, item.indexed, state.settings, state.sessionId);
    validSentenceCount = result.annotation.sentences.length;
    const modelFailureCount = result.annotation.failedSentences?.length ?? 0;
    logInfo("background", "render.apply.requested", {
      sessionId: state.sessionId,
      tabId: state.tabId,
      paragraphId: item.paragraph.id,
      paragraphVersion: item.paragraph.version,
      validSentenceCount,
      modelFailureCount,
    });
    const applied: unknown = await chrome.tabs.sendMessage(state.tabId, {
      type: "APPLY_ANNOTATIONS",
      results: [result],
    });
    if (!isRecord(applied)
      || typeof applied.applied !== "number"
      || typeof applied.renderedSentenceCount !== "number") {
      throw new Error("页面未能应用该段标记结果");
    }
    warnings = (typeof applied.warnings === "number" ? Number(applied.warnings) : 0) + modelFailureCount;
    if (applied.applied !== 1) {
      throw new Error(typeof applied.reason === "string" ? applied.reason : "页面拒绝了该段标记结果");
    }
    renderedSentenceCount = Math.min(validSentenceCount, Math.max(0, Number(applied.renderedSentenceCount)));
    failedSentenceCount = Math.max(0, discoveredSentenceCount - renderedSentenceCount);
    success = renderedSentenceCount > 0;
    if (!success) failure = typeof applied.reason === "string" ? applied.reason : "该段没有成功渲染的句子";
    logInfo("background", "render.apply.succeeded", {
      sessionId: state.sessionId,
      tabId: state.tabId,
      paragraphId: item.paragraph.id,
      paragraphVersion: item.paragraph.version,
      validSentenceCount,
      renderedSentenceCount,
      failedSentenceCount,
      rangeCount: typeof applied.rangeCount === "number" ? applied.rangeCount : 0,
      warnings,
    });
  } catch (error: unknown) {
    failure = safeErrorMessage(error, state.settings.apiKey);
    renderedSentenceCount = 0;
    failedSentenceCount = discoveredSentenceCount;
    logWarn("background", "queue.item.failed", {
      sessionId: state.sessionId,
      tabId: state.tabId,
      paragraphId: item.paragraph.id,
      paragraphVersion: item.paragraph.version,
      discoveredSentenceCount,
      validSentenceCount,
      durationMs: Math.round(performance.now() - startedAt),
      error: failure,
    });
    void chrome.tabs.sendMessage(state.tabId, {
      type: "PARAGRAPH_FAILED",
      id: item.paragraph.id,
      version: item.paragraph.version,
      reason: failure,
    }).catch(() => undefined);
  }

  state.activeCount -= 1;
  state.completedCount += 1;
  state.warningCount += warnings;
  state.validSentenceCount += validSentenceCount;
  state.renderedSentenceCount += renderedSentenceCount;
  state.failedSentenceCount += failedSentenceCount;
  if (success) state.paragraphCount += 1;
  else state.failedCount += 1;
  if (failure !== undefined) state.lastError = failure;

  if (item.batch) {
    item.batch.remainingCount -= 1;
    item.batch.warningCount += warnings;
    item.batch.validSentenceCount += validSentenceCount;
    item.batch.renderedSentenceCount += renderedSentenceCount;
    item.batch.failedSentenceCount += failedSentenceCount;
    if (success) item.batch.paragraphCount += 1;
    else item.batch.failedCount += 1;
    if (failure !== undefined) item.batch.lastError = failure;
    if (item.batch.remainingCount === 0) item.batch.resolve(summaryFrom(item.batch));
  }

  logInfo("background", "queue.item.completed", {
    sessionId: state.sessionId,
    tabId: state.tabId,
    paragraphId: item.paragraph.id,
    paragraphVersion: item.paragraph.version,
    success,
    discoveredSentenceCount,
    validSentenceCount,
    renderedSentenceCount,
    failedSentenceCount,
    queueWaitMs,
    durationMs: Math.round(performance.now() - startedAt),
    activeCount: state.activeCount,
    queuedCount: state.queue.length,
    completedCount: state.completedCount,
    totalCount: state.totalCount,
  });
  notifyProgress(state);
  pumpQueue(state);
}

function summaryFrom(summary: AnalysisSummary): AnalysisSummary {
  return {
    paragraphCount: summary.paragraphCount,
    totalCount: summary.totalCount,
    failedCount: summary.failedCount,
    warningCount: summary.warningCount,
    discoveredSentenceCount: summary.discoveredSentenceCount,
    validSentenceCount: summary.validSentenceCount,
    renderedSentenceCount: summary.renderedSentenceCount,
    failedSentenceCount: summary.failedSentenceCount,
    ...(summary.lastError === undefined ? {} : { lastError: summary.lastError }),
  };
}

function notifyProgress(state: TabAnalysisState): void {
  logInfo("background", "analysis.progress", {
    sessionId: state.sessionId,
    tabId: state.tabId,
    completedCount: state.completedCount,
    totalCount: state.totalCount,
    succeededCount: state.paragraphCount,
    failedCount: state.failedCount,
    discoveredSentenceCount: state.discoveredSentenceCount,
    validSentenceCount: state.validSentenceCount,
    renderedSentenceCount: state.renderedSentenceCount,
    failedSentenceCount: state.failedSentenceCount,
    activeCount: state.activeCount,
    queuedCount: state.queue.length,
  });
  void chrome.runtime.sendMessage({
    type: "ANALYSIS_PROGRESS",
    tabId: state.tabId,
    completedCount: state.completedCount,
    totalCount: state.totalCount,
    paragraphCount: state.paragraphCount,
    failedCount: state.failedCount,
    discoveredSentenceCount: state.discoveredSentenceCount,
    validSentenceCount: state.validSentenceCount,
    renderedSentenceCount: state.renderedSentenceCount,
    failedSentenceCount: state.failedSentenceCount,
    activeCount: state.activeCount,
    ...(state.lastError === undefined ? {} : { lastError: state.lastError }),
  }).catch(() => undefined);
}

async function readSettings(): Promise<AnalysisSettings> {
  const stored = await chrome.storage.local.get([SETTINGS_KEY, DISPLAY_KEY]);
  if (stored[SETTINGS_KEY] === undefined) {
    logWarn("background", "settings.missing");
    throw new Error("请先打开模型设置并保存供应商配置");
  }
  const settings = validateProviderSettings(stored[SETTINGS_KEY]);
  logInfo("background", "settings.loaded", {
    provider: settings.provider,
    modelId: settings.modelId,
    endpointOrigin: endpointOrigin(settings.baseUrl),
    hasApiKey: settings.apiKey.length > 0,
  });
  const display = readDisplaySettings(stored[DISPLAY_KEY]);
  return {
    ...settings,
    analysisConcurrency: display.analysisConcurrency,
    fullPhrases: display.fullPhrases,
    translation: display.translation,
    excerpts: display.excerpts,
  };
}

async function testProvider(value: unknown): Promise<void> {
  const startedAt = performance.now();
  const settings = validateProviderSettings(value);
  logInfo("background", "provider.test.started", {
    provider: settings.provider,
    modelId: settings.modelId,
    endpointOrigin: endpointOrigin(settings.baseUrl),
    hasApiKey: settings.apiKey.length > 0,
  });
  const { model, models } = createConfiguredModels(settings);
  const response = await models.completeSimple(model, {
    messages: [{ role: "user", content: "Reply with OK.", timestamp: Date.now() }],
  }, {
    maxTokens: 8,
    timeoutMs: 30_000,
    maxRetries: 0,
  });
  if (response.stopReason === "error" || response.stopReason === "aborted") {
    logWarn("background", "provider.test.failed", {
      provider: settings.provider,
      modelId: settings.modelId,
      durationMs: Math.round(performance.now() - startedAt),
      stopReason: response.stopReason,
      error: safeErrorMessage(response.errorMessage || "供应商连接测试失败", settings.apiKey),
    });
    throw new Error(response.errorMessage || "供应商连接测试失败");
  }
  logInfo("background", "provider.test.succeeded", {
    provider: settings.provider,
    modelId: settings.modelId,
    durationMs: Math.round(performance.now() - startedAt),
    stopReason: response.stopReason,
  });
}

async function analyzeParagraph(
  paragraph: ParagraphSnapshot,
  indexed: IndexedParagraph,
  settings: AnalysisSettings,
  sessionId: string,
): Promise<ParagraphResult> {
  const parsingRequest = PARSING_ADAPTER.createRequest(indexed, settings.provider, settings.fullPhrases);
  const { model, models } = createConfiguredModels(settings, parsingRequest.samplingParams);
  const createAgent = (): Agent => new Agent({
    initialState: {
      systemPrompt: parsingRequest.systemPrompt,
      model,
      thinkingLevel: "off",
      tools: [],
      messages: [],
    },
    streamFn: models.streamSimple.bind(models),
    getApiKey: () => settings.apiKey,
  });

  const startedAt = performance.now();
  logInfo("background", "model.request.started", {
    sessionId,
    paragraphId: paragraph.id,
    paragraphVersion: paragraph.version,
    characterCount: paragraph.text.length,
    discoveredSentenceCount: indexed.sentences.length,
    provider: settings.provider,
    modelId: settings.modelId,
    endpointOrigin: endpointOrigin(settings.baseUrl),
    timeoutMs: ANALYSIS_TIMEOUT_MS,
    parsingAdapter: PARSING_ADAPTER.id,
    fullPhrases: settings.fullPhrases,
    translation: settings.translation,
    excerpts: settings.excerpts,
    inputCharacterCount: parsingRequest.systemPrompt.length + parsingRequest.userPrompt.length,
  });

  async function promptAndRead(agent: Agent, prompt: string, attempt: number): Promise<string> {
    const attemptStartedAt = performance.now();
    const previousAssistantCount = agent.state.messages.filter((message) => message.role === "assistant").length;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      agent.abort();
    }, ANALYSIS_TIMEOUT_MS);
    try {
      await agent.prompt(prompt);
    } finally {
      clearTimeout(timeout);
    }

    const assistants = agent.state.messages.filter((message) => message.role === "assistant");
    const assistant = assistants.at(-1);
    if (!assistant || assistant.role !== "assistant" || assistants.length === previousAssistantCount) {
      logWarn("background", "model.response.missing", {
        sessionId,
        paragraphId: paragraph.id,
        paragraphVersion: paragraph.version,
        attempt,
        requestDurationMs: Math.round(performance.now() - attemptStartedAt),
        totalDurationMs: Math.round(performance.now() - startedAt),
        agentError: agent.state.errorMessage,
      });
      throw new Error(agent.state.errorMessage || "模型没有返回分析结果");
    }
    if (assistant.stopReason === "error" || assistant.stopReason === "aborted") {
      logWarn("background", "model.request.failed", {
        sessionId,
        paragraphId: paragraph.id,
        paragraphVersion: paragraph.version,
        attempt,
        requestDurationMs: Math.round(performance.now() - attemptStartedAt),
        totalDurationMs: Math.round(performance.now() - startedAt),
        stopReason: assistant.stopReason,
        timedOut,
        error: safeErrorMessage(assistant.errorMessage || agent.state.errorMessage || "模型请求失败", settings.apiKey),
        partialOutputCharacterCount: contentText(assistant.content).length,
      });
      const providerError = assistant.errorMessage || agent.state.errorMessage;
      const safeProviderError = providerError ? safeErrorMessage(providerError, settings.apiKey) : "";
      throw new Error(timedOut
        ? `单段分析超过 ${ANALYSIS_TIMEOUT_MS / 1000} 秒${safeProviderError ? `；底层错误：${safeProviderError}` : ""}`
        : safeProviderError || "模型请求失败");
    }
    if (assistant.stopReason === "length") {
      logWarn("background", "model.response.truncated", {
        sessionId,
        paragraphId: paragraph.id,
        paragraphVersion: paragraph.version,
        attempt,
        requestDurationMs: Math.round(performance.now() - attemptStartedAt),
        totalDurationMs: Math.round(performance.now() - startedAt),
      });
      throw new Error("单段模型输出被截断");
    }

    const assistantText = contentText(assistant.content);
    logInfo("background", "model.response.received", {
      sessionId,
      paragraphId: paragraph.id,
      paragraphVersion: paragraph.version,
      attempt,
      requestDurationMs: Math.round(performance.now() - attemptStartedAt),
      totalDurationMs: Math.round(performance.now() - startedAt),
      stopReason: assistant.stopReason,
      outputCharacterCount: assistantText.length,
    });
    return assistantText;
  }

  const sentenceIds = indexed.sentences.map((sentence) => sentence.id);
  const firstAgent = createAgent();
  let firstAnnotation: ParagraphAnnotation | undefined;
  let firstResponseReceived = false;
  let firstError: unknown;
  let attemptCount = 1;
  try {
    const assistantText = await promptAndRead(firstAgent, parsingRequest.userPrompt, attemptCount);
    firstResponseReceived = true;
    try {
      firstAnnotation = PARSING_ADAPTER.parseRecoverableResponse(assistantText, indexed, sentenceIds);
    } catch (error: unknown) {
      firstError = error;
      logWarn("background", "model.response.parse-failed", {
        sessionId,
        paragraphId: paragraph.id,
        paragraphVersion: paragraph.version,
        attempt: attemptCount,
        willRetry: true,
        outputCharacterCount: assistantText.length,
        error: errorMessage(error),
      });
    }
  } catch (error: unknown) {
    firstError = error;
  }

  let annotation = firstAnnotation;
  const unresolvedIds = firstAnnotation
    ? firstAnnotation.failedSentences?.map((sentence) => sentence.id) ?? []
    : sentenceIds;
  if (unresolvedIds.length > 0) {
    attemptCount = 2;
    try {
      const retryAgent = firstResponseReceived ? firstAgent : createAgent();
      const retryPrompt = firstResponseReceived
        ? recoveryPrompt(unresolvedIds)
        : parsingRequest.userPrompt;
      const assistantText = await promptAndRead(retryAgent, retryPrompt, attemptCount);
      const recovered = PARSING_ADAPTER.parseRecoverableResponse(assistantText, indexed, unresolvedIds);
      annotation = mergeAnnotations(indexed, firstAnnotation, recovered);
    } catch (retryError: unknown) {
      logWarn("background", "model.response.recovery-failed", {
        sessionId,
        paragraphId: paragraph.id,
        paragraphVersion: paragraph.version,
        attempt: attemptCount,
        unresolvedSentenceCount: unresolvedIds.length,
        preservedSentenceCount: firstAnnotation?.sentences.length ?? 0,
        error: errorMessage(retryError),
      });
      if (!annotation) throw new Error(`模型请求连续失败：${errorMessage(retryError || firstError)}`);
    }
  }

  if (!annotation) throw new Error(`模型没有返回可解析结果：${errorMessage(firstError)}`);
  logInfo("background", "model.response.parsed", {
    sessionId,
    paragraphId: paragraph.id,
    paragraphVersion: paragraph.version,
    attemptCount,
    validSentenceCount: annotation.sentences.length,
    failedSentenceCount: annotation.failedSentences?.length ?? 0,
    degradedSentenceCount: annotation.sentences.filter((sentence) => sentence.pattern === "unclassified").length,
    roleCount: annotation.sentences.reduce((sum, sentence) => sum + sentence.roles.length, 0),
    durationMs: Math.round(performance.now() - startedAt),
  });
  return {
    id: paragraph.id,
    version: paragraph.version ?? 1,
    sourceText: paragraph.text,
    annotation,
  };
}

function recoveryPrompt(sentenceIds: readonly string[]): string {
  if (PARSING_ADAPTER.id === "compact-marked") {
    const rows = sentenceIds.map((id) => `${id} as row ID "${id.replace(/^s/u, "")}"`).join(", ");
    return `Correct only these sentences for the same indexed text: ${rows}. Return each requested row exactly once and no other sentence rows using {"s":[...],"l":[]}. Return only the corrected response.`;
  }
  return `Correct only these sentence IDs for the same indexed text: ${sentenceIds.join(", ")}. Return each requested ID exactly once and no other sentence IDs using {"sentences":[...],"learningItems":[]}. Return only the corrected response.`;
}

function mergeAnnotations(
  indexed: IndexedParagraph,
  first: ParagraphAnnotation | undefined,
  recovered: ParagraphAnnotation,
): ParagraphAnnotation {
  const sentences = new Map(first?.sentences.map((sentence) => [sentence.id!, sentence]) ?? []);
  for (const sentence of recovered.sentences) sentences.set(sentence.id!, sentence);

  const failures = new Map(first?.failedSentences?.map((failure) => [failure.id, failure]) ?? []);
  for (const sentence of recovered.sentences) failures.delete(sentence.id!);
  for (const failure of recovered.failedSentences ?? []) failures.set(failure.id, failure);

  return {
    id: indexed.id,
    sentences: indexed.sentences.flatMap((sentence) => {
      const annotation = sentences.get(sentence.id);
      return annotation ? [annotation] : [];
    }),
    ...(failures.size > 0 ? { failedSentences: [...failures.values()] } : {}),
    ...(first?.learningItems?.length
      ? { learningItems: first.learningItems }
      : recovered.learningItems?.length ? { learningItems: recovered.learningItems } : {}),
  };
}

function createConfiguredModels(settings: ProviderSettings, samplingParams?: Record<string, unknown>): {
  model: Model<"openai-completions">;
  models: MutableModels;
} {
  const model = createModel(settings, samplingParams);
  const models = createModels();
  models.setProvider(createProvider({
    id: PROVIDER_ID,
    name: "LinguaMark OpenAI Compatible",
    baseUrl: settings.baseUrl,
    auth: {
      apiKey: {
        name: "LinguaMark API key",
        resolve: async () => ({
          auth: { apiKey: settings.apiKey },
          source: "LinguaMark settings",
        }),
      },
    },
    models: [model],
    api: openAICompletionsApi(),
  }));
  return { model, models };
}

function createModel(
  settings: ProviderSettings,
  samplingParams?: Record<string, unknown>,
): Model<"openai-completions"> {
  return {
    id: settings.modelId,
    name: settings.modelId,
    api: "openai-completions",
    provider: PROVIDER_ID,
    baseUrl: settings.baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 32_768,
    ...(samplingParams ? { samplingParams } : {}),
    compat: providerCompat(settings.provider),
  };
}

function providerCompat(provider: ProviderSettings["provider"]): OpenAICompletionsCompat {
  const common: OpenAICompletionsCompat = {
    supportsStore: false,
    supportsDeveloperRole: false,
    supportsReasoningEffort: false,
    supportsUsageInStreaming: false,
    supportsStrictMode: false,
    maxTokensField: "max_tokens",
  };
  if (provider === "deepseek") {
    return {
      ...common,
      thinkingFormat: "deepseek",
      requiresReasoningContentOnAssistantMessages: true,
    };
  }
  if (provider === "glm") return { ...common, thinkingFormat: "zai", zaiToolStream: true };
  return common;
}

function readParagraphs(value: unknown): ParagraphSnapshot[] {
  if (!isRecord(value) || !Array.isArray(value.paragraphs)) return [];
  return value.paragraphs.flatMap((paragraph): ParagraphSnapshot[] => {
    if (!isRecord(paragraph) || typeof paragraph.id !== "string" || typeof paragraph.text !== "string") {
      return [];
    }
    return paragraph.text.trim().length === 0 ? [] : [{
      id: paragraph.id,
      version: typeof paragraph.version === "number" && Number.isInteger(paragraph.version) && paragraph.version >= 1
        ? paragraph.version
        : 1,
      text: paragraph.text,
      requireRoles: paragraph.requireRoles === true,
    }];
  });
}

function paragraphVersionKey(paragraph: ParagraphSnapshot): string {
  return `${paragraph.id}:${paragraph.version ?? 1}`;
}

function createSessionId(): string {
  return crypto.randomUUID().slice(0, 8);
}

function endpointOrigin(baseUrl: string): string {
  try {
    return new URL(baseUrl).origin;
  } catch {
    return "invalid-url";
  }
}

function isStandaloneViewerSender(sender: chrome.runtime.MessageSender): boolean {
  const value = sender.tab?.url;
  if (!value) return false;
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}` === chrome.runtime.getURL("viewer.html");
  } catch {
    return false;
  }
}

function isMarkdownViewerSender(sender: chrome.runtime.MessageSender): boolean {
  const value = sender.tab?.url;
  if (!value) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "file:" && /\.md$/iu.test(url.pathname))
      || `${url.origin}${url.pathname}` === chrome.runtime.getURL("viewer.html");
  } catch {
    return false;
  }
}

function countDirectoryEntries(entries: readonly DirectoryTreeEntry[]): number {
  return entries.reduce((count, entry) => count + 1 + countDirectoryEntries(entry.children ?? []), 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "未知错误";
}

function safeErrorMessage(error: unknown, secret: string): string {
  const message = errorMessage(error);
  return (secret.length >= 8 ? message.replaceAll(secret, "[redacted]") : message).slice(0, 100);
}
