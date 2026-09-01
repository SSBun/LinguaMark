import { logInfo, logWarn } from "./debug.ts";
import {
  createRenderPlan,
  DEFAULT_DISPLAY_SETTINGS,
  DISPLAY_KEY,
  HIGHLIGHT_TYPES,
  LEARNING_FAVORITES_KEY,
  learningItemKey,
  readDisplaySettings,
  readLearningFavorites,
  type DisplaySettings,
  type HighlightType,
  type LearningItem,
  type ParagraphResult,
  type ParagraphSnapshot,
  type RoleFamily,
} from "./contracts.ts";

const HIGHLIGHT_NAMES = [
  "linguamark-primary",
  "linguamark-supporting",
  "linguamark-detail",
  "linguamark-subject",
  "linguamark-verb",
  "linguamark-object",
  "linguamark-complement",
] as const;
const UNDERLINE_HIGHLIGHT_NAMES = [
  "linguamark-primary-underline",
  "linguamark-supporting-underline",
  "linguamark-detail-underline",
  "linguamark-subject-underline",
  "linguamark-verb-underline",
  "linguamark-object-underline",
  "linguamark-complement-underline",
] as const;
const RENDER_HIGHLIGHT_NAMES: readonly string[] = [...HIGHLIGHT_NAMES, ...UNDERLINE_HIGHLIGHT_NAMES];
const IMPORTANCE_HIGHLIGHTS = new Set<HighlightType>(["primary", "supporting", "detail"]);
const PARSING_HIGHLIGHT_NAME = "linguamark-parsing";
const LEARNING_ITEM_LABELS: Record<LearningItem["kind"], string> = {
  vocabulary: "特殊词汇",
  phrase: "经典短语",
  pattern: "句式",
};

type HighlightName = (typeof HIGHLIGHT_NAMES)[number];

interface TextTarget {
  element: HTMLElement;
  nodes: Text[];
}

interface TextTargetBuilder extends TextTarget {
  hasText: boolean;
}

type TextTargetStatus = "idle" | "queued" | "succeeded" | "failed";

interface TextTargetState {
  target: TextTarget;
  text: string;
  version: number;
  status: TextTargetStatus;
}

interface AnalysisArea {
  top: number;
  bottom: number;
}

interface SentenceTranslation {
  range: Range;
  text: string;
}

interface RenderedTarget {
  ranges: Map<HighlightName, Range[]>;
  translations: SentenceTranslation[];
  boundaries: HTMLElement[];
}

interface LearningAssistantElements {
  root: HTMLDivElement;
  trigger: HTMLButtonElement;
  menu: HTMLElement;
  panel: HTMLElement;
  list: HTMLUListElement;
  count: HTMLSpanElement;
  empty: HTMLParagraphElement;
  status: HTMLParagraphElement;
}

interface LearningDragState {
  pointerId: number;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  moved: boolean;
}

const EXCLUDED_TEXT_SELECTOR = "script, style, noscript, template, canvas, pre, [role='code'], textarea, select, [hidden], [aria-hidden='true'], [contenteditable]:not([contenteditable='false']), [data-linguamark-ui], [data-linguamark-ignore], .linguamark-boundary, .linguamark-translation";
const TEXT_FLOW_SELECTOR = "p, h1, h2, h3, h4, h5, h6, li, dt, dd, blockquote, figcaption, caption, th, td, svg text, math";
const STANDALONE_TEXT_SELECTOR = "a, button, label, summary, [role='button'], [role='link'], [role='menuitem'], [role='tab']";
const FRAGMENT_TARGET_SELECTOR = `h1, h2, h3, h4, h5, h6, li, dt, dd, figcaption, caption, th, td, svg text, math, ${STANDALONE_TEXT_SELECTOR}`;
const MAIN_CONTENT_UI_SELECTOR = "nav, aside, form, button, label, summary, [role='navigation'], [role='complementary'], [role='menu'], [role='menubar'], [role='toolbar'], [role='dialog'], [role='button'], [role='menuitem'], [role='tab']";
const FALLBACK_PAGE_UI_SELECTOR = `header, footer, ${MAIN_CONTENT_UI_SELECTOR}`;
const TWITTER_POST_TEXT_SELECTOR = "[data-testid='tweetText']";
const textTargets = new Map<string, TextTargetState>();
const textNodeIds = new WeakMap<Text, string>();
const renderedTargets = new Map<string, RenderedTarget>();
const parsingRanges = new Map<string, Range[]>();
let hoveredTranslation: SentenceTranslation | undefined;
let lastPointer: { x: number; y: number } | undefined;
let translationTooltip: HTMLDivElement | undefined;
let display: DisplaySettings = { ...DEFAULT_DISPLAY_SETTINGS };
let analysisMainContentOnly = DEFAULT_DISPLAY_SETTINGS.mainContentOnly;
let nextParagraphId = 0;
let autoAnalysisEnabled = false;
let scanTimer: number | undefined;
let pendingScanArea: AnalysisArea | undefined;
let lastAnalysisArea: AnalysisArea | undefined;
const learningSuggestions = new Map<string, LearningItem>();
const favoriteLearningItems = new Map<string, LearningItem>();
let learningAssistant: LearningAssistantElements | undefined;
let learningHoverTimer: number | undefined;
let learningDrag: LearningDragState | undefined;
let learningClickSuppressed = false;

initializeLearningAssistant();
initializeContentObserver();
void chrome.storage.local.get([DISPLAY_KEY, LEARNING_FAVORITES_KEY]).then((stored) => {
  display = readDisplaySettings(stored[DISPLAY_KEY]);
  replaceLearningFavorites(stored[LEARNING_FAVORITES_KEY]);
  renderDisplayState();
  renderLearningItems();
  logInfo("content", "content.ready", {
    hostname: location.hostname,
    display: {
      boundaries: display.boundaries,
      importance: display.importance,
      grammar: display.grammar,
      mainContentOnly: display.mainContentOnly,
      preload: display.preload,
      preloadPercent: display.preloadPercent,
      translation: display.translation,
      translationHover: display.translationHover,
    },
    favoriteLearningItemCount: favoriteLearningItems.size,
  });
});

addEventListener("pointermove", (event) => {
  lastPointer = { x: event.clientX, y: event.clientY };
  const translation = display.translation ? translationAtPoint(event.clientX, event.clientY) : undefined;
  if (translation === hoveredTranslation) return;
  hoveredTranslation = translation;
  if (display.translationHover && hoveredTranslation) showTranslation(hoveredTranslation);
  else hideTranslation();
}, { passive: true });

addEventListener("blur", hideTranslation);

addEventListener("linguamark:content-replaced", () => {
  autoAnalysisEnabled = false;
  if (scanTimer !== undefined) clearTimeout(scanTimer);
  scanTimer = undefined;
  pendingScanArea = undefined;
  lastAnalysisArea = undefined;
  clearParsingState();
  clearRendering();
  textTargets.clear();
  learningSuggestions.clear();
  renderLearningItems();
  setLearningStatus("尚未分析当前文件");
  logInfo("content", "analysis.content-replaced");
});

addEventListener("scroll", () => {
  hoveredTranslation = undefined;
  hideTranslation();
  if (!autoAnalysisEnabled) return;
  const current = currentAnalysisArea();
  const area = lastAnalysisArea ? unionAnalysisAreas(lastAnalysisArea, current) : current;
  lastAnalysisArea = current;
  scheduleVisibleScan(area, "scroll");
}, { passive: true });

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (changes[DISPLAY_KEY]) {
    display = readDisplaySettings(changes[DISPLAY_KEY].newValue);
    logInfo("content", "display.storage-changed", {
      boundaries: display.boundaries,
      importance: display.importance,
      grammar: display.grammar,
      mainContentOnly: display.mainContentOnly,
      preload: display.preload,
      preloadPercent: display.preloadPercent,
      translation: display.translation,
      translationHover: display.translationHover,
    });
    renderDisplayState();
  }
  if (changes[LEARNING_FAVORITES_KEY]) {
    replaceLearningFavorites(changes[LEARNING_FAVORITES_KEY].newValue);
    renderLearningItems();
    logInfo("content", "learning.favorites.storage-changed", { count: favoriteLearningItems.size });
  }
});

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isRecord(message) || typeof message.type !== "string") return undefined;

  try {
    if (message.type === "START_ANALYSIS") {
      logInfo("content", "analysis.start.received");
      sendResponse({ paragraphs: startAnalysis() });
      return undefined;
    }
    if (message.type === "APPLY_ANNOTATIONS") {
      const results = readResults(message.results);
      logInfo("content", "render.apply.received", {
        resultCount: results.length,
        paragraphIds: results.map((result) => result.id),
      });
      const result = applyAnnotations(results);
      sendResponse(result);
      return undefined;
    }
    if (message.type === "PARAGRAPH_FAILED" && typeof message.id === "string") {
      const state = textTargets.get(message.id);
      const version = typeof message.version === "number" ? message.version : 1;
      logWarn("content", "paragraph.failed", {
        paragraphId: message.id,
        paragraphVersion: version,
        currentVersion: state?.version,
        reason: typeof message.reason === "string" ? message.reason : "unknown",
      });
      if (state?.version === version) {
        state.status = "failed";
        setParagraphParsing(message.id, false);
      }
      sendResponse({ ok: true, stale: state?.version !== version });
      return undefined;
    }
    if (message.type === "SET_DISPLAY") {
      display = readDisplaySettings(message.display);
      logInfo("content", "display.message-updated", {
        boundaries: display.boundaries,
        importance: display.importance,
        grammar: display.grammar,
        mainContentOnly: display.mainContentOnly,
        preload: display.preload,
        preloadPercent: display.preloadPercent,
        translation: display.translation,
        translationHover: display.translationHover,
      });
      renderDisplayState();
      sendResponse({ ok: true });
      return undefined;
    }
    if (message.type === "SHOW_HOVERED_TRANSLATION") {
      hoveredTranslation = display.translation && lastPointer
        ? translationAtPoint(lastPointer.x, lastPointer.y)
        : undefined;
      if (hoveredTranslation) showTranslation(hoveredTranslation);
      else hideTranslation();
      sendResponse({ ok: true, shown: hoveredTranslation !== undefined });
      return undefined;
    }
  } catch (error: unknown) {
    logWarn("content", "message.failed", { messageType: message.type, error });
    sendResponse({ ok: false, error: error instanceof Error ? error.message : "标记失败" });
  }
  return undefined;
});

function startAnalysis(): ParagraphSnapshot[] {
  logInfo("content", "analysis.session.reset", {
    previousQueuedCount: [...textTargets.values()].filter((state) => state.status === "queued").length,
    previousParagraphCount: textTargets.size,
  });
  autoAnalysisEnabled = true;
  analysisMainContentOnly = display.mainContentOnly;
  if (scanTimer !== undefined) clearTimeout(scanTimer);
  scanTimer = undefined;
  pendingScanArea = undefined;
  lastAnalysisArea = currentAnalysisArea();
  clearParsingState();
  clearRendering();
  learningSuggestions.clear();
  renderLearningItems();
  setLearningStatus("正在解析当前文章…");
  textTargets.clear();
  const snapshots = collectNewVisibleTextBlocks(lastAnalysisArea);
  logInfo("content", "analysis.initial-visible.ready", {
    mainContentOnly: analysisMainContentOnly,
    paragraphCount: snapshots.length,
    paragraphIds: snapshots.map((snapshot) => snapshot.id),
    characterCount: snapshots.reduce((sum, snapshot) => sum + snapshot.text.length, 0),
  });
  return snapshots;
}

function collectNewVisibleTextBlocks(area: AnalysisArea = currentAnalysisArea()): ParagraphSnapshot[] {
  const targets = collectVisibleTextTargets(area);
  const snapshots: ParagraphSnapshot[] = [];
  let alreadyTrackedCount = 0;

  for (const target of targets) {
    const id = textTargetId(target);
    const text = textTargetText(target);
    const existing = textTargets.get(id);
    if (existing?.text === text && existing.status !== "idle") {
      existing.target = target;
      alreadyTrackedCount += 1;
      continue;
    }

    const version = existing ? existing.version + 1 : 1;
    if (existing && existing.text !== text) clearTargetRendering(id);
    textTargets.set(id, { target, text, version, status: "queued" });
    setParagraphParsing(id, true);
    snapshots.push({
      id,
      version,
      text,
      requireRoles: targetRequiresRoles(target),
    });
  }

  logInfo("content", "visible.scan.completed", {
    visibleCandidateCount: targets.length,
    alreadyTrackedCount,
    queuedCount: snapshots.length,
    analysisArea: { top: Math.round(area.top), bottom: Math.round(area.bottom) },
    viewport: { width: innerWidth, height: innerHeight, scrollY: Math.round(scrollY) },
  });
  return snapshots;
}

function collectVisibleTextTargets(area: AnalysisArea): TextTarget[] {
  const roots = textCollectionRoots();
  const targets: TextTargetBuilder[] = [];
  let current: TextTargetBuilder | undefined;

  for (const root of roots) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const text = node as Text;
      const parent = text.parentElement;
      if (parent
        && !parent.closest(EXCLUDED_TEXT_SELECTOR)
        && (!analysisMainContentOnly || isMainContentTextParent(parent, root))
        && isVisibleTextParent(parent)) {
        const element = textTargetElement(parent);
        if (!current || current.element !== element) {
          current = { element, nodes: [], hasText: false };
          targets.push(current);
        }
        current.nodes.push(text);
        current.hasText ||= text.data.trim().length > 0;
      }
      node = walker.nextNode();
    }
  }

  return targets.filter((target) => target.hasText && textTargetIntersectsAnalysisArea(target, area));
}

function textCollectionRoots(): HTMLElement[] {
  const hostname = location.hostname;
  const isTwitter = hostname === "x.com"
    || hostname.endsWith(".x.com")
    || hostname === "twitter.com"
    || hostname.endsWith(".twitter.com");
  if (isTwitter) return [...document.querySelectorAll<HTMLElement>(TWITTER_POST_TEXT_SELECTOR)];
  if (!analysisMainContentOnly) return document.body ? [document.body] : [];

  const mainRoots = topLevelRoots([...document.querySelectorAll<HTMLElement>("main, [role='main']")]);
  if (mainRoots.length > 0) return mainRoots;
  const articles = topLevelRoots([...document.querySelectorAll<HTMLElement>("article")]);
  return articles.length > 0 ? articles : document.body ? [document.body] : [];
}

function topLevelRoots(candidates: HTMLElement[]): HTMLElement[] {
  return candidates.filter((candidate) => !candidates.some((other) => other !== candidate && other.contains(candidate)));
}

function isMainContentTextParent(element: HTMLElement, root: HTMLElement): boolean {
  const selector = root === document.body ? FALLBACK_PAGE_UI_SELECTOR : MAIN_CONTENT_UI_SELECTOR;
  return !element.closest(selector);
}

function isVisibleTextParent(element: HTMLElement): boolean {
  const style = getComputedStyle(element);
  if (style.visibility === "hidden" || style.visibility === "collapse" || style.opacity === "0") return false;
  if (style.display === "contents") {
    return element.parentElement ? isVisibleTextParent(element.parentElement) : true;
  }
  return element.checkVisibility({ opacityProperty: true, visibilityProperty: true });
}

function textTargetElement(element: HTMLElement): HTMLElement {
  let current = element;
  let standalone: HTMLElement | undefined;
  while (current !== document.body && current.parentElement) {
    if (current.matches(TEXT_FLOW_SELECTOR)) return current;
    if (!standalone && current.matches(STANDALONE_TEXT_SELECTOR)) standalone = current;
    const display = getComputedStyle(current).display;
    if (display !== "inline" && display !== "contents") return standalone ?? current;
    current = current.parentElement;
  }
  return standalone ?? current;
}

function textTargetIntersectsAnalysisArea(target: TextTarget, area: AnalysisArea): boolean {
  const last = target.nodes.at(-1)!;
  const range = document.createRange();
  range.setStart(target.nodes[0], 0);
  range.setEnd(last, last.data.length);
  return [...range.getClientRects()].some((rect) => intersectsAnalysisArea(rect, area));
}

function intersectsAnalysisArea(rect: DOMRect, area: AnalysisArea): boolean {
  const documentTop = rect.top + scrollY;
  const documentBottom = rect.bottom + scrollY;
  return documentBottom > area.top
    && documentTop < area.bottom
    && rect.right > 0
    && rect.left < innerWidth;
}

function textTargetId(target: TextTarget): string {
  const anchor = target.nodes[0];
  const existing = textNodeIds.get(anchor);
  if (existing) return existing;
  const id = `paragraph-${nextParagraphId}`;
  nextParagraphId += 1;
  textNodeIds.set(anchor, id);
  logInfo("content", "paragraph.id-assigned", { paragraphId: id, characterCount: textTargetText(target).length });
  return id;
}

function textTargetText(target: TextTarget): string {
  return target.nodes.map((text) => text.data).join("");
}

function targetRequiresRoles(target: TextTarget): boolean {
  return !target.element.matches(FRAGMENT_TARGET_SELECTOR);
}

function currentAnalysisArea(): AnalysisArea {
  const height = display.preload
    ? innerHeight * (1 + display.preloadPercent / 100)
    : innerHeight;
  return { top: scrollY, bottom: scrollY + height };
}

function unionAnalysisAreas(left: AnalysisArea, right: AnalysisArea): AnalysisArea {
  return { top: Math.min(left.top, right.top), bottom: Math.max(left.bottom, right.bottom) };
}

function scheduleVisibleScan(area: AnalysisArea, source: "scroll" | "mutation"): void {
  pendingScanArea = pendingScanArea ? unionAnalysisAreas(pendingScanArea, area) : area;
  if (scanTimer !== undefined) return;
  scanTimer = window.setTimeout(() => {
    const scheduledArea = pendingScanArea ?? currentAnalysisArea();
    scanTimer = undefined;
    pendingScanArea = undefined;
    queueNewVisibleParagraphs(scheduledArea);
  }, 150);
  logInfo("content", "visible.scan.scheduled", {
    source,
    throttleMs: 150,
    area: { top: Math.round(area.top), bottom: Math.round(area.bottom) },
  });
}

function initializeContentObserver(): void {
  if (!document.body) return;
  const observer = new MutationObserver((mutations) => {
    if (!autoAnalysisEnabled || !mutations.some(mutationTouchesContent)) return;
    scheduleVisibleScan(currentAnalysisArea(), "mutation");
  });
  observer.observe(document.body, { childList: true, characterData: true, subtree: true });
}

function mutationTouchesContent(mutation: MutationRecord): boolean {
  if (mutation.type === "characterData") {
    const parent = mutation.target.parentElement;
    return Boolean(parent && !parent.closest(EXCLUDED_TEXT_SELECTOR));
  }
  return [...mutation.addedNodes, ...mutation.removedNodes].some((node) => {
    if (node instanceof Text) {
      const parent = node.parentElement ?? (mutation.target instanceof Element ? mutation.target : undefined);
      return node.data.trim().length > 0 && Boolean(parent && !parent.closest(EXCLUDED_TEXT_SELECTOR));
    }
    if (!(node instanceof Element)
      || node.matches(EXCLUDED_TEXT_SELECTOR)
      || node.closest(EXCLUDED_TEXT_SELECTOR)) {
      return false;
    }
    return (node.textContent?.trim().length ?? 0) > 0;
  });
}

function queueNewVisibleParagraphs(area: AnalysisArea): void {
  const snapshots = collectNewVisibleTextBlocks(area);
  if (snapshots.length === 0) {
    logInfo("content", "visible.scan.no-new-paragraphs");
    return;
  }
  logInfo("content", "visible.queue.sending", {
    paragraphCount: snapshots.length,
    paragraphIds: snapshots.map((snapshot) => snapshot.id),
    paragraphVersions: snapshots.map((snapshot) => snapshot.version),
  });
  void chrome.runtime.sendMessage({
    type: "QUEUE_VISIBLE_PARAGRAPHS",
    paragraphs: snapshots,
  }).then((response: unknown) => {
    if (isRecord(response) && response.ok === true) {
      logInfo("content", "visible.queue.accepted", {
        sentCount: snapshots.length,
        queuedCount: typeof response.queuedCount === "number" ? response.queuedCount : undefined,
      });
      return;
    }
    logWarn("content", "visible.queue.rejected", {
      sentCount: snapshots.length,
      error: isRecord(response) && typeof response.error === "string" ? response.error : "unknown",
    });
    releaseQueuedSnapshots(snapshots);
  }).catch((error: unknown) => {
    logWarn("content", "visible.queue.failed", { sentCount: snapshots.length, error });
    releaseQueuedSnapshots(snapshots);
  });
}

function releaseQueuedSnapshots(snapshots: ParagraphSnapshot[]): void {
  logWarn("content", "queue.snapshots.released", {
    paragraphCount: snapshots.length,
    paragraphIds: snapshots.map((snapshot) => snapshot.id),
  });
  for (const snapshot of snapshots) {
    const state = textTargets.get(snapshot.id);
    if (state?.version === (snapshot.version ?? 1)) state.status = "idle";
    setParagraphParsing(snapshot.id, false);
  }
}

function setParagraphParsing(id: string, parsing: boolean): void {
  const state = textTargets.get(id);
  const target = state?.target;
  if (parsing && target) {
    parsingRanges.set(id, target.nodes.map((text) => {
      const range = document.createRange();
      range.selectNodeContents(text);
      return range;
    }));
  } else {
    parsingRanges.delete(id);
  }
  if (target) {
    const hasActiveTarget = [...parsingRanges.keys()]
      .some((targetId) => textTargets.get(targetId)?.target.element === target.element);
    target.element.classList.toggle("linguamark-parsing", hasActiveTarget);
  }
  renderParsingHighlight();
  logInfo("content", "paragraph.parsing-state", {
    paragraphId: id,
    parsing,
    lineHighlightCount: [...parsingRanges.values()].reduce((count, targetRanges) => count + targetRanges.length, 0),
  });
}

function renderParsingHighlight(): void {
  if (!("highlights" in CSS) || typeof Highlight === "undefined") return;
  CSS.highlights.delete(PARSING_HIGHLIGHT_NAME);
  const activeRanges = [...parsingRanges.values()].flat();
  if (activeRanges.length > 0) {
    CSS.highlights.set(PARSING_HIGHLIGHT_NAME, new Highlight(...activeRanges));
  }
}

function clearParsingState(): void {
  const active = [...document.querySelectorAll<HTMLElement>(".linguamark-parsing")];
  for (const element of active) element.classList.remove("linguamark-parsing");
  parsingRanges.clear();
  if ("highlights" in CSS) CSS.highlights.delete(PARSING_HIGHLIGHT_NAME);
  if (active.length > 0) logInfo("content", "paragraph.parsing-state-cleared", { paragraphCount: active.length });
}

function applyAnnotations(results: ParagraphResult[]): {
  applied: number;
  warnings: number;
  rangeCount: number;
  renderedSentenceCount: number;
  reason?: string;
} {
  if (!("highlights" in CSS) || typeof Highlight === "undefined") {
    throw new Error("当前 Chrome 版本不支持 CSS Custom Highlight API");
  }

  const boundaryInsertions: Array<{ offset: number; point: DomPoint; rendered: RenderedTarget }> = [];
  let applied = 0;
  logInfo("content", "render.apply.started", {
    resultCount: results.length,
    paragraphIds: results.map((result) => result.id),
    paragraphVersions: results.map((result) => result.version),
  });
  let warningCount = 0;
  let rangeCount = 0;
  let renderedSentenceCount = 0;
  let failureReason: string | undefined;

  for (const result of results) {
    const state = textTargets.get(result.id);
    if (!state || state.version !== result.version) {
      warningCount += 1;
      failureReason = state ? "分析结果版本已经过期" : "找不到待应用的文本块";
      logWarn("content", "render.apply.skipped", {
        paragraphId: result.id,
        paragraphVersion: result.version,
        currentVersion: state?.version,
        stage: "target-version",
        reason: failureReason,
      });
      continue;
    }
    const target = state.target;
    setParagraphParsing(result.id, false);
    if (state.text !== result.sourceText || textTargetText(target) !== result.sourceText) {
      state.status = "failed";
      warningCount += 1;
      failureReason = "文本内容在分析期间发生变化";
      logWarn("content", "render.apply.skipped", { paragraphId: result.id, stage: "source-snapshot", reason: failureReason });
      continue;
    }

    const plan = createRenderPlan(result.sourceText, result.annotation);
    if (!plan) {
      state.status = "failed";
      warningCount += 1;
      failureReason = "本地句子位置未能匹配原文";
      logWarn("content", "render.apply.skipped", { paragraphId: result.id, stage: "render-plan", reason: failureReason });
      continue;
    }

    logInfo("content", "render.plan.created", {
      paragraphId: result.id,
      paragraphVersion: result.version,
      sentenceRanges: plan.importance.length,
      failedSentenceCount: result.annotation.failedSentences?.length ?? 0,
      roleRanges: plan.roles.length,
      boundaries: plan.boundaries.length,
      warnings: plan.warnings.length,
    });

    const textMap = createTextMap(target.nodes);
    if (textMap.length !== result.sourceText.length) {
      state.status = "failed";
      warningCount += 1;
      failureReason = "网页文本结构在分析期间发生变化";
      logWarn("content", "render.apply.skipped", {
        paragraphId: result.id,
        stage: "dom-text-map",
        reason: failureReason,
        expectedLength: result.sourceText.length,
        actualLength: textMap.length,
      });
      continue;
    }

    clearTargetRendering(result.id);
    const rendered: RenderedTarget = { ranges: new Map(), translations: [], boundaries: [] };
    let paragraphMarks = 0;
    let paragraphRenderedSentences = 0;
    for (const [sentenceIndex, item] of plan.importance.entries()) {
      const range = createDomRange(textMap, item.start, item.end);
      if (!range) continue;
      addRange(rendered, highlightName(item.importance), range);
      const translation = result.annotation.sentences[sentenceIndex]?.translation;
      if (translation) rendered.translations.push({ range, text: translation });
      paragraphRenderedSentences += 1;
      paragraphMarks += 1;
    }

    for (const item of plan.roles) {
      const range = createDomRange(textMap, item.start, item.end);
      if (!range) continue;
      addRange(rendered, roleHighlightName(item.family), range);
      paragraphMarks += 1;
    }

    for (const offset of plan.boundaries) {
      if (target.element.namespaceURI !== "http://www.w3.org/1999/xhtml") continue;
      const point = pointAt(textMap, offset);
      if (!point) continue;
      boundaryInsertions.push({ offset, point, rendered });
      paragraphMarks += 1;
    }

    warningCount += plan.warnings.length;
    renderedTargets.set(result.id, rendered);
    state.status = paragraphRenderedSentences > 0 ? "succeeded" : "failed";
    if (paragraphRenderedSentences === 0) failureReason = "该段没有成功解析的句子";
    rangeCount += paragraphMarks;
    renderedSentenceCount += paragraphRenderedSentences;
    applied += 1;
    addLearningItems(result.annotation.learningItems ?? []);
    logInfo("content", "render.apply.paragraph-completed", {
      paragraphId: result.id,
      paragraphVersion: result.version,
      validSentenceCount: result.annotation.sentences.length,
      renderedSentenceCount: paragraphRenderedSentences,
      failedSentenceCount: result.annotation.failedSentences?.length ?? 0,
      rangeCount: paragraphMarks,
      warnings: plan.warnings.length,
    });
  }

  boundaryInsertions.sort((left, right) => right.offset - left.offset);
  for (const insertion of boundaryInsertions) insertBoundary(insertion.point, insertion.rendered);
  renderDisplayState();
  logInfo("content", "render.apply.completed", {
    applied,
    warnings: warningCount,
    renderedSentenceCount,
    rangeCount,
    boundaryInsertions: boundaryInsertions.length,
    failureReason,
  });
  return {
    applied,
    warnings: warningCount,
    rangeCount,
    renderedSentenceCount,
    ...(failureReason === undefined ? {} : { reason: failureReason }),
  };
}

function clearTargetRendering(id: string): void {
  const rendered = renderedTargets.get(id);
  if (!rendered) return;
  for (const boundary of rendered.boundaries) boundary.remove();
  renderedTargets.delete(id);
  hoveredTranslation = undefined;
  hideTranslation();
  renderDisplayState();
}

function clearRendering(): void {
  const boundaryCount = [...renderedTargets.values()]
    .reduce((count, rendered) => count + rendered.boundaries.length, 0);
  logInfo("content", "render.cleared", {
    renderedTargetCount: renderedTargets.size,
    boundaryCount,
  });
  for (const name of RENDER_HIGHLIGHT_NAMES) CSS.highlights.delete(name);
  for (const rendered of renderedTargets.values()) {
    for (const boundary of rendered.boundaries) boundary.remove();
  }
  renderedTargets.clear();
  hoveredTranslation = undefined;
  lastPointer = undefined;
  hideTranslation();
}

function translationAtPoint(x: number, y: number): SentenceTranslation | undefined {
  if (hoveredTranslation && rangeContainsPoint(hoveredTranslation.range, x, y)) return hoveredTranslation;
  const caret = document.caretRangeFromPoint(x, y);
  if (!caret) return undefined;
  for (const rendered of renderedTargets.values()) {
    const translation = rendered.translations.find((item) => item.range.isPointInRange(caret.startContainer, caret.startOffset)
      && rangeContainsPoint(item.range, x, y));
    if (translation) return translation;
  }
  return undefined;
}

function rangeContainsPoint(range: Range, x: number, y: number): boolean {
  return [...range.getClientRects()].some((rect) => (
    x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
  ));
}

function showTranslation(translation: SentenceTranslation): void {
  const tooltip = translationTooltip ?? createTranslationTooltip();
  tooltip.textContent = translation.text;
  tooltip.hidden = false;

  const margin = 12;
  const gap = 10;
  const anchor = translation.range.getBoundingClientRect();
  const rect = tooltip.getBoundingClientRect();
  const maxLeft = Math.max(margin, innerWidth - rect.width - margin);
  const above = anchor.top - rect.height - gap;
  const below = Math.min(anchor.bottom + gap, innerHeight - rect.height - margin);
  tooltip.style.left = `${Math.min(Math.max(margin, anchor.left + (anchor.width - rect.width) / 2), maxLeft)}px`;
  tooltip.style.top = `${above >= margin ? above : Math.max(margin, below)}px`;
}

function createTranslationTooltip(): HTMLDivElement {
  const tooltip = document.createElement("div");
  tooltip.className = "linguamark-translation";
  tooltip.role = "tooltip";
  tooltip.setAttribute("aria-live", "polite");
  document.body.append(tooltip);
  translationTooltip = tooltip;
  return tooltip;
}

function hideTranslation(): void {
  if (translationTooltip) translationTooltip.hidden = true;
}

function renderDisplayState(): void {
  for (const type of HIGHLIGHT_TYPES) {
    document.documentElement.style.setProperty(`--linguamark-${type}-color`, display.highlights[type].color);
  }
  if (display.translation && display.translationHover && hoveredTranslation) {
    showTranslation(hoveredTranslation);
  } else {
    hideTranslation();
  }
  if (!("highlights" in CSS) || typeof Highlight === "undefined") return;
  for (const name of RENDER_HIGHLIGHT_NAMES) CSS.highlights.delete(name);

  for (const type of HIGHLIGHT_TYPES) {
    const layerEnabled = IMPORTANCE_HIGHLIGHTS.has(type) ? display.importance : display.grammar;
    const setting = display.highlights[type];
    if (!layerEnabled || !setting.enabled) continue;
    const sourceName = highlightName(type);
    registerHighlight(sourceName, setting.mode === "underline" ? underlineHighlightName(type) : sourceName);
  }
  const boundaries = [...renderedTargets.values()].flatMap((rendered) => rendered.boundaries);
  for (const boundary of boundaries) boundary.hidden = !display.boundaries;
  logInfo("content", "render.layers-updated", {
    boundaries: display.boundaries,
    importance: display.importance,
    grammar: display.grammar,
    translation: display.translation,
    translationHover: display.translationHover,
    registeredHighlights: RENDER_HIGHLIGHT_NAMES.filter((name) => CSS.highlights.has(name)),
    boundaryCount: boundaries.length,
  });
}

function registerHighlight(sourceName: HighlightName, renderedName: string): void {
  const ranges = [...renderedTargets.values()].flatMap((rendered) => rendered.ranges.get(sourceName) ?? []);
  if (ranges.length > 0) CSS.highlights.set(renderedName, new Highlight(...ranges));
}

function addRange(rendered: RenderedTarget, name: HighlightName, range: Range): void {
  const stored = rendered.ranges.get(name) ?? [];
  stored.push(range);
  rendered.ranges.set(name, stored);
}

function roleHighlightName(role: RoleFamily): HighlightName {
  return highlightName(role);
}

function highlightName(type: HighlightType): HighlightName {
  return `linguamark-${type}` as HighlightName;
}

function underlineHighlightName(type: HighlightType): string {
  return `linguamark-${type}-underline`;
}

interface TextSegment {
  node: Text;
  start: number;
  end: number;
}

interface TextMap {
  segments: TextSegment[];
  length: number;
}

interface DomPoint {
  node: Text;
  offset: number;
}

function createTextMap(nodes: readonly Text[]): TextMap {
  const segments: TextSegment[] = [];
  let length = 0;

  for (const text of nodes) {
    const next = length + text.data.length;
    segments.push({ node: text, start: length, end: next });
    length = next;
  }
  return { segments, length };
}

function createDomRange(textMap: TextMap, start: number, end: number): Range | undefined {
  const startPoint = pointAt(textMap, start);
  const endPoint = pointAt(textMap, end);
  if (!startPoint || !endPoint || start >= end) return undefined;

  const range = document.createRange();
  range.setStart(startPoint.node, startPoint.offset);
  range.setEnd(endPoint.node, endPoint.offset);
  return range;
}

function pointAt(textMap: TextMap, offset: number): DomPoint | undefined {
  if (offset < 0 || offset > textMap.length) return undefined;
  for (const segment of textMap.segments) {
    if (offset <= segment.end) return { node: segment.node, offset: offset - segment.start };
  }
  const last = textMap.segments.at(-1);
  return last ? { node: last.node, offset: last.node.data.length } : undefined;
}

function insertBoundary(point: DomPoint, rendered: RenderedTarget): void {
  const boundary = document.createElement("span");
  boundary.className = "linguamark-boundary";
  boundary.setAttribute("aria-hidden", "true");
  boundary.hidden = !display.boundaries;

  const range = document.createRange();
  range.setStart(point.node, point.offset);
  range.collapse(true);
  range.insertNode(boundary);
  rendered.boundaries.push(boundary);
}

function initializeLearningAssistant(): void {
  if (!document.body) return;
  const root = document.createElement("div");
  root.className = "linguamark-learning-root";
  root.dataset.linguamarkUi = "";
  root.innerHTML = `
    <button class="linguamark-learning-trigger" type="button" aria-label="打开 LinguaMark 菜单" aria-haspopup="menu" aria-controls="linguamark-learning-menu" aria-expanded="false" title="点击打开解析菜单；停留 2 秒打开学习卡片">
      <span aria-hidden="true">LM</span>
    </button>
    <button class="linguamark-learning-dismiss" type="button" aria-label="关闭悬浮球">×</button>
    <div id="linguamark-learning-menu" class="linguamark-learning-menu" role="menu" aria-label="LinguaMark 操作" aria-hidden="true" inert>
      <button class="linguamark-learning-analyze" type="button" role="menuitem">解析当前文章</button>
    </div>
    <section class="linguamark-learning-panel" aria-label="英文学习卡片" hidden>
      <header class="linguamark-learning-header">
        <div>
          <h2>英文学习卡片</h2>
          <span class="linguamark-learning-count">0 项</span>
        </div>
        <button class="linguamark-learning-panel-close" type="button" aria-label="关闭学习卡片">×</button>
      </header>
      <p class="linguamark-learning-status" aria-live="polite">从悬浮菜单选择“解析当前文章”开始</p>
      <ul class="linguamark-learning-list"></ul>
      <p class="linguamark-learning-empty">解析后，特殊词汇、经典短语和句式会显示在这里。</p>
    </section>`;
  document.body.append(root);

  const trigger = root.querySelector<HTMLButtonElement>(".linguamark-learning-trigger")!;
  const menu = root.querySelector<HTMLElement>(".linguamark-learning-menu")!;
  const analyze = root.querySelector<HTMLButtonElement>(".linguamark-learning-analyze")!;
  const panel = root.querySelector<HTMLElement>(".linguamark-learning-panel")!;
  learningAssistant = {
    root,
    trigger,
    menu,
    panel,
    list: root.querySelector<HTMLUListElement>(".linguamark-learning-list")!,
    count: root.querySelector<HTMLSpanElement>(".linguamark-learning-count")!,
    empty: root.querySelector<HTMLParagraphElement>(".linguamark-learning-empty")!,
    status: root.querySelector<HTMLParagraphElement>(".linguamark-learning-status")!,
  };
  moveLearningAssistant(
    innerWidth - root.offsetWidth - 16,
    Math.max(16, (innerHeight - root.offsetHeight) / 2),
  );

  root.addEventListener("pointerenter", () => {
    if (!panel.hidden || menu.classList.contains("is-open") || learningDrag) return;
    clearLearningHoverTimer();
    learningHoverTimer = window.setTimeout(showLearningPanel, 2_000);
  });
  root.addEventListener("pointerleave", clearLearningHoverTimer);
  trigger.addEventListener("click", () => {
    if (learningClickSuppressed) {
      learningClickSuppressed = false;
      return;
    }
    setLearningMenuOpen(!menu.classList.contains("is-open"));
  });
  trigger.addEventListener("pointerdown", beginLearningDrag);
  trigger.addEventListener("pointermove", continueLearningDrag);
  trigger.addEventListener("pointerup", finishLearningDrag);
  trigger.addEventListener("pointercancel", finishLearningDrag);
  analyze.addEventListener("click", () => {
    setLearningMenuOpen(false);
    showLearningPanel();
    void analyzeFromLearningAssistant();
  });

  root.querySelector<HTMLButtonElement>(".linguamark-learning-dismiss")!.addEventListener("click", () => {
    clearLearningHoverTimer();
    root.remove();
    learningAssistant = undefined;
  });
  root.querySelector<HTMLButtonElement>(".linguamark-learning-panel-close")!.addEventListener("click", hideLearningPanel);

  document.addEventListener("pointerdown", (event) => {
    const assistant = learningAssistant;
    if (!assistant || event.composedPath().includes(assistant.root)) return;
    setLearningMenuOpen(false);
    hideLearningPanel();
  }, { passive: true });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    setLearningMenuOpen(false);
    hideLearningPanel();
  });
  addEventListener("resize", () => {
    const assistant = learningAssistant;
    if (!assistant) return;
    const rect = assistant.root.getBoundingClientRect();
    moveLearningAssistant(rect.left, rect.top);
    if (!assistant.panel.hidden) positionLearningPanel();
  }, { passive: true });
}

async function analyzeFromLearningAssistant(): Promise<void> {
  const assistant = learningAssistant;
  if (!assistant || assistant.trigger.disabled) return;
  assistant.trigger.disabled = true;
  assistant.trigger.setAttribute("aria-busy", "true");
  setLearningStatus("正在解析当前文章…");

  try {
    const response: unknown = await chrome.runtime.sendMessage({ type: "ANALYZE_CURRENT_TAB" });
    if (!isRecord(response) || response.ok !== true) {
      throw new Error(isRecord(response) && typeof response.error === "string" ? response.error : "分析失败");
    }
    const paragraphCount = typeof response.paragraphCount === "number" ? response.paragraphCount : 0;
    const totalCount = typeof response.totalCount === "number" ? response.totalCount : paragraphCount;
    const discoveredSentenceCount = typeof response.discoveredSentenceCount === "number"
      ? response.discoveredSentenceCount
      : 0;
    const renderedSentenceCount = typeof response.renderedSentenceCount === "number" ? response.renderedSentenceCount : 0;
    const failedSentenceCount = typeof response.failedSentenceCount === "number" ? response.failedSentenceCount : 0;
    const suffix = failedSentenceCount > 0 ? `，${failedSentenceCount} 句失败` : "";
    setLearningStatus(discoveredSentenceCount > 0
      ? `已解析 ${renderedSentenceCount}/${discoveredSentenceCount} 句${suffix}，列出 ${learningSuggestions.size} 项`
      : `已解析 ${paragraphCount}/${totalCount} 个文本块，列出 ${learningSuggestions.size} 项`);
  } catch (error: unknown) {
    setLearningStatus(error instanceof Error ? error.message : "分析失败", true);
    logWarn("content", "learning.analysis.failed", { error });
  } finally {
    if (learningAssistant === assistant) {
      assistant.trigger.disabled = false;
      assistant.trigger.removeAttribute("aria-busy");
    }
  }
}

function beginLearningDrag(event: PointerEvent): void {
  const assistant = learningAssistant;
  if (!assistant || event.button !== 0) return;
  clearLearningHoverTimer();
  const rect = assistant.root.getBoundingClientRect();
  learningDrag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top,
    moved: false,
  };
  assistant.trigger.setPointerCapture(event.pointerId);
  assistant.root.classList.add("is-dragging");
}

function continueLearningDrag(event: PointerEvent): void {
  if (!learningDrag || event.pointerId !== learningDrag.pointerId) return;
  if (!learningDrag.moved) {
    learningDrag.moved = Math.hypot(event.clientX - learningDrag.startX, event.clientY - learningDrag.startY) > 4;
    if (learningDrag.moved) setLearningMenuOpen(false);
  }
  if (!learningDrag.moved) return;
  event.preventDefault();
  moveLearningAssistant(event.clientX - learningDrag.offsetX, event.clientY - learningDrag.offsetY);
  if (learningAssistant && !learningAssistant.panel.hidden) positionLearningPanel();
}

function finishLearningDrag(event: PointerEvent): void {
  const assistant = learningAssistant;
  if (!learningDrag || event.pointerId !== learningDrag.pointerId) return;
  if (assistant?.trigger.hasPointerCapture(event.pointerId)) assistant.trigger.releasePointerCapture(event.pointerId);
  assistant?.root.classList.remove("is-dragging");
  learningClickSuppressed = event.type === "pointerup" && learningDrag.moved;
  learningDrag = undefined;
  if (learningClickSuppressed) window.setTimeout(() => { learningClickSuppressed = false; }, 0);
  if (assistant && !assistant.panel.hidden) positionLearningPanel();
}

function moveLearningAssistant(left: number, top: number): void {
  const assistant = learningAssistant;
  if (!assistant) return;
  const margin = 8;
  const menuOpen = assistant.menu.classList.contains("is-open");
  const minLeft = menuOpen
    ? Math.max(margin, margin + assistant.menu.offsetWidth - assistant.root.offsetWidth)
    : margin;
  const minTop = margin + (menuOpen ? assistant.menu.offsetHeight + 8 : 0);
  assistant.root.style.left = `${Math.min(Math.max(minLeft, left), Math.max(minLeft, innerWidth - assistant.root.offsetWidth - margin))}px`;
  assistant.root.style.top = `${Math.min(Math.max(minTop, top), Math.max(minTop, innerHeight - assistant.root.offsetHeight - margin))}px`;
}

function setLearningMenuOpen(open: boolean): void {
  const assistant = learningAssistant;
  if (!assistant) return;
  clearLearningHoverTimer();
  assistant.menu.classList.toggle("is-open", open);
  assistant.menu.inert = !open;
  assistant.menu.setAttribute("aria-hidden", String(!open));
  assistant.trigger.setAttribute("aria-expanded", String(open));
  if (!open) return;
  const rect = assistant.root.getBoundingClientRect();
  moveLearningAssistant(rect.left, rect.top);
}

function showLearningPanel(): void {
  const assistant = learningAssistant;
  if (!assistant) return;
  setLearningMenuOpen(false);
  assistant.panel.hidden = false;
  positionLearningPanel();
}

function hideLearningPanel(): void {
  const assistant = learningAssistant;
  if (assistant) assistant.panel.hidden = true;
}

function positionLearningPanel(): void {
  const assistant = learningAssistant;
  if (!assistant || assistant.panel.hidden) return;
  const margin = 12;
  const gap = 12;
  const trigger = assistant.trigger.getBoundingClientRect();
  const panel = assistant.panel.getBoundingClientRect();
  const preferredLeft = trigger.left >= innerWidth / 2
    ? trigger.left - panel.width - gap
    : trigger.right + gap;
  const left = Math.min(Math.max(margin, preferredLeft), Math.max(margin, innerWidth - panel.width - margin));
  const top = Math.min(
    Math.max(margin, trigger.top + (trigger.height - panel.height) / 2),
    Math.max(margin, innerHeight - panel.height - margin),
  );
  assistant.panel.style.left = `${left}px`;
  assistant.panel.style.top = `${top}px`;
}

function clearLearningHoverTimer(): void {
  if (learningHoverTimer === undefined) return;
  clearTimeout(learningHoverTimer);
  learningHoverTimer = undefined;
}

function addLearningItems(items: readonly LearningItem[]): void {
  let added = 0;
  for (const item of items) {
    const key = learningItemKey(item);
    if (learningSuggestions.has(key)) continue;
    learningSuggestions.set(key, item);
    added += 1;
  }
  if (added === 0) return;
  renderLearningItems();
  setLearningStatus(`已列出 ${learningSuggestions.size} 项学习内容`);
  logInfo("content", "learning.items-added", { addedCount: added, totalCount: learningSuggestions.size });
}

function replaceLearningFavorites(value: unknown): void {
  favoriteLearningItems.clear();
  for (const item of readLearningFavorites(value)) favoriteLearningItems.set(learningItemKey(item), item);
}

function renderLearningItems(): void {
  const assistant = learningAssistant;
  if (!assistant) return;
  assistant.count.textContent = `${learningSuggestions.size} 项`;
  assistant.empty.hidden = learningSuggestions.size > 0;
  assistant.list.replaceChildren(...[...learningSuggestions.values()].map(createLearningItemElement));
  if (!assistant.panel.hidden) positionLearningPanel();
}

function createLearningItemElement(item: LearningItem): HTMLLIElement {
  const element = document.createElement("li");
  element.className = "linguamark-learning-item";

  const header = document.createElement("div");
  header.className = "linguamark-learning-item-header";
  const kind = document.createElement("span");
  kind.className = `linguamark-learning-kind is-${item.kind}`;
  kind.textContent = LEARNING_ITEM_LABELS[item.kind];
  const button = document.createElement("button");
  const saved = favoriteLearningItems.has(learningItemKey(item));
  button.className = "linguamark-learning-favorite";
  button.classList.toggle("is-saved", saved);
  button.type = "button";
  button.ariaPressed = String(saved);
  button.textContent = saved ? "已收藏" : "收藏";
  button.addEventListener("click", () => { void toggleLearningFavorite(item); });
  header.append(kind, button);

  const text = document.createElement("p");
  text.className = "linguamark-learning-text";
  text.textContent = item.text;
  const note = document.createElement("p");
  note.className = "linguamark-learning-note";
  note.textContent = item.note;
  element.append(header, text, note);
  return element;
}

async function toggleLearningFavorite(item: LearningItem): Promise<void> {
  const key = learningItemKey(item);
  const previous = favoriteLearningItems.get(key);
  if (previous) favoriteLearningItems.delete(key);
  else favoriteLearningItems.set(key, { ...item, collectedAt: Date.now() });
  renderLearningItems();

  try {
    await chrome.storage.local.set({ [LEARNING_FAVORITES_KEY]: [...favoriteLearningItems.values()] });
    setLearningStatus(previous ? "已取消收藏" : "已收藏");
  } catch (error: unknown) {
    if (previous) favoriteLearningItems.set(key, previous);
    else favoriteLearningItems.delete(key);
    renderLearningItems();
    setLearningStatus("收藏保存失败", true);
    logWarn("content", "learning.favorite-save.failed", { error });
  }
}

function setLearningStatus(message: string, error = false): void {
  const status = learningAssistant?.status;
  if (!status) return;
  status.textContent = message;
  status.classList.toggle("is-error", error);
}

function readResults(value: unknown): ParagraphResult[] {
  if (!Array.isArray(value)) throw new Error("标记结果格式无效");
  return value.flatMap((item): ParagraphResult[] => {
    if (!isRecord(item)
      || typeof item.id !== "string"
      || typeof item.version !== "number"
      || !Number.isInteger(item.version)
      || typeof item.sourceText !== "string") {
      return [];
    }
    if (!isRecord(item.annotation) || item.annotation.id !== item.id || !Array.isArray(item.annotation.sentences)) {
      return [];
    }
    return [item as unknown as ParagraphResult];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
