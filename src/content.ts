import { logError, logInfo, logWarn } from "./debug.ts";
import {
  createRenderPlan,
  DEFAULT_DISPLAY_SETTINGS,
  DISPLAY_KEY,
  HIGHLIGHT_TYPES,
  readDisplaySettings,
  type DisplaySettings,
  type HighlightType,
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

type HighlightName = (typeof HIGHLIGHT_NAMES)[number];

const paragraphs = new Map<string, HTMLElement>();
const elementIds = new WeakMap<HTMLElement, string>();
const queuedIds = new Set<string>();
const ranges = new Map<HighlightName, Range[]>();
const parsingRanges = new Map<string, Range>();
let boundaries: HTMLElement[] = [];
let display: DisplaySettings = { ...DEFAULT_DISPLAY_SETTINGS };
let nextParagraphId = 0;
let autoAnalysisEnabled = false;
let scrollTimer: number | undefined;

void chrome.storage.local.get(DISPLAY_KEY).then((stored) => {
  display = readDisplaySettings(stored[DISPLAY_KEY]);
  renderDisplayState();
  logInfo("content", "content.ready", {
    hostname: location.hostname,
    display: { boundaries: display.boundaries, importance: display.importance, grammar: display.grammar },
  });
});

addEventListener("scroll", () => {
  if (!autoAnalysisEnabled) return;
  if (scrollTimer !== undefined) clearTimeout(scrollTimer);
  scrollTimer = window.setTimeout(queueNewVisibleParagraphs, 150);
  logInfo("content", "scroll.scan.scheduled", { debounceMs: 150, scrollY: Math.round(scrollY) });
}, { passive: true });

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes[DISPLAY_KEY]) return;
  display = readDisplaySettings(changes[DISPLAY_KEY].newValue);
  logInfo("content", "display.storage-changed", {
    boundaries: display.boundaries,
    importance: display.importance,
    grammar: display.grammar,
  });
  renderDisplayState();
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
      logWarn("content", "paragraph.failed", {
        paragraphId: message.id,
        reason: typeof message.reason === "string" ? message.reason : "unknown",
      });
      setParagraphParsing(message.id, false);
      sendResponse({ ok: true });
      return undefined;
    }
    if (message.type === "SET_DISPLAY") {
      display = readDisplaySettings(message.display);
      logInfo("content", "display.message-updated", {
        boundaries: display.boundaries,
        importance: display.importance,
        grammar: display.grammar,
      });
      renderDisplayState();
      sendResponse({ ok: true });
      return undefined;
    }
  } catch (error: unknown) {
    logError("content", "message.failed", { messageType: message.type, error });
    sendResponse({ ok: false, error: error instanceof Error ? error.message : "标记失败" });
  }
  return undefined;
});

function startAnalysis(): ParagraphSnapshot[] {
  logInfo("content", "analysis.session.reset", {
    previousQueuedCount: queuedIds.size,
    previousParagraphCount: paragraphs.size,
  });
  autoAnalysisEnabled = true;
  queuedIds.clear();
  clearParsingState();
  clearRendering();
  paragraphs.clear();
  const snapshots = collectNewVisibleParagraphs();
  logInfo("content", "analysis.initial-visible.ready", {
    paragraphCount: snapshots.length,
    paragraphIds: snapshots.map((snapshot) => snapshot.id),
    characterCount: snapshots.reduce((sum, snapshot) => sum + snapshot.text.length, 0),
  });
  return snapshots;
}

function collectNewVisibleParagraphs(): ParagraphSnapshot[] {
  const scoped = [...document.querySelectorAll<HTMLElement>("article p, main p")].filter(isReadableParagraph);
  const candidates = scoped.length > 0
    ? scoped
    : [...document.querySelectorAll<HTMLElement>("p")].filter(isReadableParagraph);
  const unique = [...new Set(candidates)];
  const snapshots: ParagraphSnapshot[] = [];
  logInfo("content", "visible.scan.completed", {
    scopedCandidateCount: scoped.length,
    visibleCandidateCount: unique.length,
    alreadyQueuedCount: unique.filter((element) => {
      const id = elementIds.get(element);
      return id !== undefined && queuedIds.has(id);
    }).length,
    viewport: { width: innerWidth, height: innerHeight, scrollY: Math.round(scrollY) },
  });

  for (const element of unique) {
    const id = paragraphId(element);
    paragraphs.set(id, element);
    if (queuedIds.has(id)) continue;
    queuedIds.add(id);
    setParagraphParsing(id, true);
    snapshots.push({ id, text: element.textContent ?? "" });
  }
  return snapshots;
}

function paragraphId(element: HTMLElement): string {
  const existing = elementIds.get(element);
  if (existing) return existing;
  const id = `paragraph-${nextParagraphId}`;
  nextParagraphId += 1;
  elementIds.set(element, id);
  logInfo("content", "paragraph.id-assigned", { paragraphId: id, characterCount: element.textContent?.length ?? 0 });
  return id;
}

function queueNewVisibleParagraphs(): void {
  scrollTimer = undefined;
  const snapshots = collectNewVisibleParagraphs();
  if (snapshots.length === 0) {
    logInfo("content", "scroll.scan.no-new-paragraphs");
    return;
  }
  logInfo("content", "scroll.queue.sending", {
    paragraphCount: snapshots.length,
    paragraphIds: snapshots.map((snapshot) => snapshot.id),
  });
  void chrome.runtime.sendMessage({
    type: "QUEUE_VISIBLE_PARAGRAPHS",
    paragraphs: snapshots,
  }).then((response: unknown) => {
    if (isRecord(response) && response.ok === true) {
      logInfo("content", "scroll.queue.accepted", {
        sentCount: snapshots.length,
        queuedCount: typeof response.queuedCount === "number" ? response.queuedCount : undefined,
      });
      return;
    }
    logWarn("content", "scroll.queue.rejected", {
      sentCount: snapshots.length,
      error: isRecord(response) && typeof response.error === "string" ? response.error : "unknown",
    });
    releaseQueuedSnapshots(snapshots);
  }).catch((error: unknown) => {
    logError("content", "scroll.queue.failed", { sentCount: snapshots.length, error });
    releaseQueuedSnapshots(snapshots);
  });
}

function releaseQueuedSnapshots(snapshots: ParagraphSnapshot[]): void {
  logWarn("content", "queue.snapshots.released", {
    paragraphCount: snapshots.length,
    paragraphIds: snapshots.map((snapshot) => snapshot.id),
  });
  for (const snapshot of snapshots) {
    queuedIds.delete(snapshot.id);
    setParagraphParsing(snapshot.id, false);
  }
}

function setParagraphParsing(id: string, parsing: boolean): void {
  const element = paragraphs.get(id);
  element?.classList.toggle("linguamark-parsing", parsing);
  if (parsing && element) {
    const range = document.createRange();
    range.selectNodeContents(element);
    parsingRanges.set(id, range);
  } else {
    parsingRanges.delete(id);
  }
  renderParsingHighlight();
  logInfo("content", "paragraph.parsing-state", {
    paragraphId: id,
    parsing,
    lineHighlightCount: parsingRanges.size,
  });
}

function renderParsingHighlight(): void {
  if (!("highlights" in CSS) || typeof Highlight === "undefined") return;
  CSS.highlights.delete(PARSING_HIGHLIGHT_NAME);
  if (parsingRanges.size > 0) {
    CSS.highlights.set(PARSING_HIGHLIGHT_NAME, new Highlight(...parsingRanges.values()));
  }
}

function clearParsingState(): void {
  const active = [...document.querySelectorAll<HTMLElement>(".linguamark-parsing")];
  for (const element of active) element.classList.remove("linguamark-parsing");
  parsingRanges.clear();
  if ("highlights" in CSS) CSS.highlights.delete(PARSING_HIGHLIGHT_NAME);
  if (active.length > 0) logInfo("content", "paragraph.parsing-state-cleared", { paragraphCount: active.length });
}

function isReadableParagraph(element: HTMLElement): boolean {
  const text = element.textContent?.trim() ?? "";
  if (text.length < 40 || element.closest("nav, header, footer, aside, [aria-hidden='true']")) return false;
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== "none"
    && style.visibility !== "hidden"
    && rect.width > 0
    && rect.height > 0
    && rect.bottom > 0
    && rect.top < innerHeight
    && rect.right > 0
    && rect.left < innerWidth;
}

function applyAnnotations(results: ParagraphResult[]): {
  applied: number;
  warnings: number;
  visibleMarks: number;
  reason?: string;
} {
  if (!("highlights" in CSS) || typeof Highlight === "undefined") {
    throw new Error("当前 Chrome 版本不支持 CSS Custom Highlight API");
  }

  const boundaryInsertions: Array<{ offset: number; point: DomPoint }> = [];
  let applied = 0;
  logInfo("content", "render.apply.started", {
    resultCount: results.length,
    paragraphIds: results.map((result) => result.id),
  });
  let warningCount = 0;
  let visibleMarks = 0;
  let failureReason: string | undefined;

  for (const result of results) {
    const element = paragraphs.get(result.id);
    if (!element) {
      warningCount += 1;
      failureReason = "找不到待应用的段落";
      logWarn("content", "render.apply.skipped", { paragraphId: result.id, stage: "element-lookup", reason: failureReason });
      continue;
    }
    setParagraphParsing(result.id, false);
    if ((element.textContent ?? "") !== result.sourceText) {
      warningCount += 1;
      failureReason = "段落内容在分析期间发生变化";
      logWarn("content", "render.apply.skipped", { paragraphId: result.id, stage: "source-snapshot", reason: failureReason });
      continue;
    }

    const plan = createRenderPlan(result.sourceText, result.annotation);
    if (!plan) {
      warningCount += 1;
      failureReason = "模型引用未能完整匹配原文";
      logWarn("content", "render.apply.skipped", { paragraphId: result.id, stage: "render-plan", reason: failureReason });
      continue;
    }

    logInfo("content", "render.plan.created", {
      paragraphId: result.id,
      sentenceRanges: plan.importance.length,
      roleRanges: plan.roles.length,
      boundaries: plan.boundaries.length,
      warnings: plan.warnings.length,
    });

    const textMap = createTextMap(element);
    if (textMap.length !== result.sourceText.length) {
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

    let paragraphMarks = 0;
    for (const item of plan.importance) {
      const range = createDomRange(textMap, item.start, item.end);
      if (!range) continue;
      addRange(highlightName(item.importance), range);
      paragraphMarks += 1;
    }

    for (const item of plan.roles) {
      const range = createDomRange(textMap, item.start, item.end);
      if (!range) continue;
      addRange(roleHighlightName(item.family), range);
      paragraphMarks += 1;
    }

    for (const offset of plan.boundaries) {
      const point = pointAt(textMap, offset);
      if (!point) continue;
      boundaryInsertions.push({ offset, point });
      paragraphMarks += 1;
    }

    warningCount += plan.warnings.length;
    if (paragraphMarks === 0) {
      warningCount += 1;
      failureReason = "该段解析完成，但没有生成任何可见标记";
      logWarn("content", "render.apply.skipped", { paragraphId: result.id, stage: "visible-marks", reason: failureReason });
      continue;
    }
    visibleMarks += paragraphMarks;
    applied += 1;
    logInfo("content", "render.apply.paragraph-succeeded", {
      paragraphId: result.id,
      visibleMarks: paragraphMarks,
      warnings: plan.warnings.length,
    });
  }

  boundaryInsertions.sort((left, right) => right.offset - left.offset);
  for (const insertion of boundaryInsertions) insertBoundary(insertion.point);
  renderDisplayState();
  logInfo("content", "render.apply.completed", {
    applied,
    warnings: warningCount,
    visibleMarks,
    boundaryInsertions: boundaryInsertions.length,
    failureReason,
  });
  return {
    applied,
    warnings: warningCount,
    visibleMarks,
    ...(failureReason === undefined ? {} : { reason: failureReason }),
  };
}

function clearRendering(): void {
  logInfo("content", "render.cleared", {
    highlightTypes: ranges.size,
    boundaryCount: boundaries.length,
  });
  for (const name of RENDER_HIGHLIGHT_NAMES) CSS.highlights.delete(name);
  ranges.clear();
  for (const boundary of boundaries) boundary.remove();
  boundaries = [];
}

function renderDisplayState(): void {
  for (const type of HIGHLIGHT_TYPES) {
    document.documentElement.style.setProperty(`--linguamark-${type}-color`, display.highlights[type].color);
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
  for (const boundary of boundaries) boundary.hidden = !display.boundaries;
  logInfo("content", "render.layers-updated", {
    boundaries: display.boundaries,
    importance: display.importance,
    grammar: display.grammar,
    registeredHighlights: RENDER_HIGHLIGHT_NAMES.filter((name) => CSS.highlights.has(name)),
    boundaryCount: boundaries.length,
  });
}

function registerHighlight(sourceName: HighlightName, renderedName: string): void {
  const stored = ranges.get(sourceName);
  if (stored && stored.length > 0) CSS.highlights.set(renderedName, new Highlight(...stored));
}

function addRange(name: HighlightName, range: Range): void {
  const stored = ranges.get(name) ?? [];
  stored.push(range);
  ranges.set(name, stored);
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

function createTextMap(element: HTMLElement): TextMap {
  const segments: TextSegment[] = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let length = 0;
  let node = walker.nextNode();

  while (node) {
    const text = node as Text;
    const next = length + text.data.length;
    segments.push({ node: text, start: length, end: next });
    length = next;
    node = walker.nextNode();
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

function insertBoundary(point: DomPoint): void {
  const boundary = document.createElement("span");
  boundary.className = "linguamark-boundary";
  boundary.setAttribute("aria-hidden", "true");
  boundary.hidden = !display.boundaries;

  const range = document.createRange();
  range.setStart(point.node, point.offset);
  range.collapse(true);
  range.insertNode(boundary);
  boundaries.push(boundary);
}

function readResults(value: unknown): ParagraphResult[] {
  if (!Array.isArray(value)) throw new Error("标记结果格式无效");
  return value.flatMap((item): ParagraphResult[] => {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.sourceText !== "string") return [];
    if (!isRecord(item.annotation) || item.annotation.id !== item.id || !Array.isArray(item.annotation.sentences)) {
      return [];
    }
    return [item as unknown as ParagraphResult];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
