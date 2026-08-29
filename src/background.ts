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
import { logError, logInfo, logWarn } from "./debug.ts";
import { DEFAULT_PARSING_ADAPTER } from "./parsing.ts";
import {
  DEFAULT_DISPLAY_SETTINGS,
  DISPLAY_KEY,
  indexParagraph,
  SETTINGS_KEY,
  type ParagraphResult,
  type ParagraphSnapshot,
  type ProviderSettings,
  validateProviderSettings,
} from "./contracts.ts";

const PARSING_ADAPTER = DEFAULT_PARSING_ADAPTER;

const PROVIDER_ID = "linguamark-openai-compatible";
const ANALYSIS_TIMEOUT_MS = 180_000;
const MAX_CONCURRENCY = 2;

interface AnalysisSummary {
  paragraphCount: number;
  totalCount: number;
  failedCount: number;
  warningCount: number;
  lastError?: string;
}

interface BatchTracker extends AnalysisSummary {
  remainingCount: number;
  resolve: (summary: AnalysisSummary) => void;
}

interface QueueItem {
  paragraph: ParagraphSnapshot;
  batch?: BatchTracker;
}

interface TabAnalysisState extends AnalysisSummary {
  tabId: number;
  sessionId: string;
  settings: ProviderSettings;
  knownIds: Set<string>;
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

  if (message.type === "ANALYZE_TAB" && Number.isInteger(message.tabId)) {
    logInfo("background", "analysis.requested", { tabId: message.tabId });
    void analyzeTab(Number(message.tabId))
      .then((result) => {
        logInfo("background", "analysis.initial-batch.completed", { tabId: message.tabId, ...result });
        sendResponse({ ok: true, ...result });
      })
      .catch((error: unknown) => {
        logError("background", "analysis.request.failed", { tabId: message.tabId, error });
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
        logError("background", "scroll.queue.failed", { tabId: sender.tab?.id, error });
        sendResponse({ ok: false, error: errorMessage(error) });
      });
    return true;
  }

  if (message.type === "TEST_PROVIDER") {
    logInfo("background", "provider.test.received");
    void testProvider(message.settings)
      .then(() => sendResponse({ ok: true }))
      .catch((error: unknown) => {
        logError("background", "provider.test.rejected", { error });
        sendResponse({ ok: false, error: errorMessage(error) });
      });
    return true;
  }

  return undefined;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  const removed = analysisStates.delete(tabId);
  if (removed) logInfo("background", "analysis.session.removed", { tabId, reason: "tab-closed" });
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
    knownIds: new Set(),
    queue: [],
    activeCount: 0,
    completedCount: 0,
    paragraphCount: 0,
    totalCount: 0,
    failedCount: 0,
    warningCount: 0,
  };
  analysisStates.set(tabId, state);
  logInfo("background", "analysis.session.started", {
    sessionId: state.sessionId,
    tabId,
    provider: state.settings.provider,
    modelId: state.settings.modelId,
    endpointOrigin: endpointOrigin(state.settings.baseUrl),
    maxConcurrency: MAX_CONCURRENCY,
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
    throw new Error("当前可见区域没有可分析的英文正文段落");
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
      knownIds: new Set(),
      queue: [],
      activeCount: 0,
      completedCount: 0,
      paragraphCount: 0,
      totalCount: 0,
      failedCount: 0,
      warningCount: 0,
    };
    analysisStates.set(tabId, state);
    logInfo("background", "analysis.session.restored", {
      sessionId: state.sessionId,
      tabId,
      reason: "service-worker-restarted",
      provider: state.settings.provider,
      modelId: state.settings.modelId,
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
  const unseen = paragraphs.filter((paragraph) => !state.knownIds.has(paragraph.id));
  for (const paragraph of unseen) {
    state.knownIds.add(paragraph.id);
    state.queue.push({ paragraph, batch });
  }
  state.totalCount += unseen.length;
  logInfo("background", "queue.enqueued", {
    sessionId: state.sessionId,
    tabId: state.tabId,
    addedCount: unseen.length,
    paragraphIds: unseen.map((paragraph) => paragraph.id),
    queuedCount: state.queue.length,
    activeCount: state.activeCount,
    totalCount: state.totalCount,
  });
  notifyProgress(state);
  pumpQueue(state);
  return unseen.length;
}

function pumpQueue(state: TabAnalysisState): void {
  while (state.activeCount < MAX_CONCURRENCY && state.queue.length > 0) {
    const item = state.queue.shift();
    if (!item) return;
    state.activeCount += 1;
    void processQueueItem(state, item);
  }
}

async function processQueueItem(state: TabAnalysisState, item: QueueItem): Promise<void> {
  const startedAt = performance.now();
  let success = false;
  let warnings = 0;
  let failure: string | undefined;

  logInfo("background", "queue.item.started", {
    sessionId: state.sessionId,
    tabId: state.tabId,
    paragraphId: item.paragraph.id,
    characterCount: item.paragraph.text.length,
    activeCount: state.activeCount,
    queuedCount: state.queue.length,
  });

  try {
    const result = await analyzeParagraph(item.paragraph, state.settings, state.sessionId);
    logInfo("background", "render.apply.requested", {
      sessionId: state.sessionId,
      tabId: state.tabId,
      paragraphId: item.paragraph.id,
      sentenceCount: result.annotation.sentences.length,
    });
    const applied: unknown = await chrome.tabs.sendMessage(state.tabId, {
      type: "APPLY_ANNOTATIONS",
      results: [result],
    });
    if (!isRecord(applied) || typeof applied.applied !== "number") {
      throw new Error("页面未能应用该段标记结果");
    }
    warnings = typeof applied.warnings === "number" ? Number(applied.warnings) : 0;
    if (applied.applied !== 1 || typeof applied.visibleMarks !== "number" || applied.visibleMarks < 1) {
      throw new Error(typeof applied.reason === "string" ? applied.reason : "该段没有生成可见标记");
    }
    success = true;
    logInfo("background", "render.apply.succeeded", {
      sessionId: state.sessionId,
      tabId: state.tabId,
      paragraphId: item.paragraph.id,
      visibleMarks: applied.visibleMarks,
      warnings,
    });
  } catch (error: unknown) {
    failure = safeErrorMessage(error, state.settings.apiKey);
    logError("background", "queue.item.failed", {
      sessionId: state.sessionId,
      tabId: state.tabId,
      paragraphId: item.paragraph.id,
      durationMs: Math.round(performance.now() - startedAt),
      error: failure,
    });
    void chrome.tabs.sendMessage(state.tabId, {
      type: "PARAGRAPH_FAILED",
      id: item.paragraph.id,
      reason: failure,
    }).catch(() => undefined);
  }

  state.activeCount -= 1;
  state.completedCount += 1;
  state.warningCount += warnings;
  if (success) state.paragraphCount += 1;
  else state.failedCount += 1;
  if (failure !== undefined) state.lastError = failure;

  if (item.batch) {
    item.batch.remainingCount -= 1;
    item.batch.warningCount += warnings;
    if (success) item.batch.paragraphCount += 1;
    else item.batch.failedCount += 1;
    if (failure !== undefined) item.batch.lastError = failure;
    if (item.batch.remainingCount === 0) item.batch.resolve(summaryFrom(item.batch));
  }

  logInfo("background", "queue.item.completed", {
    sessionId: state.sessionId,
    tabId: state.tabId,
    paragraphId: item.paragraph.id,
    success,
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
    activeCount: state.activeCount,
    ...(state.lastError === undefined ? {} : { lastError: state.lastError }),
  }).catch(() => undefined);
}

async function readSettings(): Promise<ProviderSettings> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
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
  return settings;
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
    logError("background", "provider.test.failed", {
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
  settings: ProviderSettings,
  sessionId: string,
): Promise<ParagraphResult> {
  const indexed = indexParagraph(paragraph);
  const parsingRequest = PARSING_ADAPTER.createRequest(indexed, settings.provider);
  const { model, models } = createConfiguredModels(settings, parsingRequest.samplingParams);
  const agent = new Agent({
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
    characterCount: paragraph.text.length,
    provider: settings.provider,
    modelId: settings.modelId,
    endpointOrigin: endpointOrigin(settings.baseUrl),
    timeoutMs: ANALYSIS_TIMEOUT_MS,
    parsingAdapter: PARSING_ADAPTER.id,
    inputCharacterCount: parsingRequest.systemPrompt.length + parsingRequest.userPrompt.length,
  });

  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    agent.abort();
  }, ANALYSIS_TIMEOUT_MS);
  try {
    await agent.prompt(parsingRequest.userPrompt);
  } finally {
    clearTimeout(timeout);
  }

  const assistant = [...agent.state.messages].reverse().find((message) => message.role === "assistant");
  if (!assistant || assistant.role !== "assistant") {
    logError("background", "model.response.missing", {
      sessionId,
      paragraphId: paragraph.id,
      durationMs: Math.round(performance.now() - startedAt),
      agentError: agent.state.errorMessage,
    });
    throw new Error(agent.state.errorMessage || "模型没有返回分析结果");
  }
  if (assistant.stopReason === "error" || assistant.stopReason === "aborted") {
    logError("background", "model.request.failed", {
      sessionId,
      paragraphId: paragraph.id,
      durationMs: Math.round(performance.now() - startedAt),
      stopReason: assistant.stopReason,
      timedOut,
      error: safeErrorMessage(assistant.errorMessage || agent.state.errorMessage || "模型请求失败", settings.apiKey),
      partialOutputCharacterCount: contentText(assistant.content).length,
    });
    const providerError = assistant.errorMessage || agent.state.errorMessage;
    const safeProviderError = providerError ? safeErrorMessage(providerError, settings.apiKey) : "";
    throw new Error(timedOut
      ? `单段分析超过 ${ANALYSIS_TIMEOUT_MS / 1000} 秒，已跳过${safeProviderError ? `；底层错误：${safeProviderError}` : ""}`
      : safeProviderError || "模型请求失败");
  }
  if (assistant.stopReason === "length") {
    logWarn("background", "model.response.truncated", {
      sessionId,
      paragraphId: paragraph.id,
      durationMs: Math.round(performance.now() - startedAt),
    });
    throw new Error("单段模型输出被截断");
  }

  const assistantText = contentText(assistant.content);
  logInfo("background", "model.response.received", {
    sessionId,
    paragraphId: paragraph.id,
    durationMs: Math.round(performance.now() - startedAt),
    stopReason: assistant.stopReason,
    outputCharacterCount: assistantText.length,
  });
  let annotation;
  try {
    annotation = PARSING_ADAPTER.parseResponse(assistantText, indexed);
  } catch (error: unknown) {
    logError("background", "model.response.parse-failed", {
      sessionId,
      paragraphId: paragraph.id,
      outputCharacterCount: assistantText.length,
      error: errorMessage(error),
    });
    throw new Error(`响应 JSON 解析失败：${errorMessage(error)}`);
  }
  logInfo("background", "model.response.parsed", {
    sessionId,
    paragraphId: paragraph.id,
    sentenceCount: annotation.sentences.length,
    roleCount: annotation.sentences.reduce((sum, sentence) => sum + sentence.roles.length, 0),
    durationMs: Math.round(performance.now() - startedAt),
  });
  return {
    id: paragraph.id,
    sourceText: paragraph.text,
    annotation,
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
    return paragraph.text.trim().length === 0 ? [] : [{ id: paragraph.id, text: paragraph.text }];
  });
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
