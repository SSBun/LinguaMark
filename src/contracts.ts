export const SETTINGS_KEY = "providerSettings";
export const DISPLAY_KEY = "displaySettings";
export const LEARNING_FAVORITES_KEY = "learningFavorites";
export const DEFAULT_ANALYSIS_CONCURRENCY = 10;
export const MAX_ANALYSIS_CONCURRENCY = 20;

export const PROVIDER_PRESETS = {
  deepseek: {
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    modelId: "deepseek-v4-flash",
  },
  glm: {
    label: "GLM（ZAI／智谱）",
    baseUrl: "https://api.z.ai/api/paas/v4",
    modelId: "glm-4.7",
  },
  custom: {
    label: "OpenAI 兼容接口",
    baseUrl: "",
    modelId: "",
  },
} as const;

export type ProviderId = keyof typeof PROVIDER_PRESETS;

export interface ProviderSettings {
  provider: ProviderId;
  baseUrl: string;
  modelId: string;
  apiKey: string;
}

export type Importance = "primary" | "supporting" | "detail";
export const HIGHLIGHT_TYPES = [
  "primary",
  "supporting",
  "detail",
  "subject",
  "verb",
  "object",
  "complement",
] as const;
export type HighlightType = (typeof HIGHLIGHT_TYPES)[number];

export type HighlightMode = "text" | "underline";

export interface HighlightSettings {
  enabled: boolean;
  color: string;
  mode: HighlightMode;
}

export const LEARNING_ITEM_KINDS = ["vocabulary", "phrase", "pattern"] as const;
export type LearningItemKind = (typeof LEARNING_ITEM_KINDS)[number];

export interface DisplaySettings {
  boundaries: boolean;
  importance: boolean;
  grammar: boolean;
  analysisConcurrency: number;
  mainContentOnly: boolean;
  preload: boolean;
  preloadPercent: number;
  fullPhrases: boolean;
  translation: boolean;
  translationHover: boolean;
  excerpts: Record<LearningItemKind, boolean>;
  highlights: Record<HighlightType, HighlightSettings>;
}

export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  boundaries: false,
  importance: true,
  grammar: true,
  analysisConcurrency: DEFAULT_ANALYSIS_CONCURRENCY,
  mainContentOnly: true,
  preload: true,
  preloadPercent: 30,
  fullPhrases: true,
  translation: true,
  translationHover: true,
  excerpts: {
    vocabulary: true,
    phrase: true,
    pattern: true,
  },
  highlights: {
    primary: { enabled: true, color: "#8A5A00", mode: "text" },
    supporting: { enabled: true, color: "#344054", mode: "text" },
    detail: { enabled: true, color: "#667085", mode: "text" },
    subject: { enabled: true, color: "#075BC6", mode: "text" },
    verb: { enabled: true, color: "#B42318", mode: "text" },
    object: { enabled: true, color: "#067647", mode: "text" },
    complement: { enabled: true, color: "#7A3DB8", mode: "text" },
  },
};
export type SentencePattern = "SV" | "SVC" | "SVO" | "SVOO" | "SVOC" | "multi" | "unclassified" | "fragment";

export interface LearningItem {
  kind: LearningItemKind;
  text: string;
  note: string;
  collectedAt?: number;
}

export type GrammarRole =
  | "subject"
  | "verb"
  | "object"
  | "indirectObject"
  | "directObject"
  | "subjectComplement"
  | "objectComplement";
export type RoleFamily = "subject" | "verb" | "object" | "complement";

export interface RoleAnnotation {
  role: GrammarRole;
  quote: string;
  occurrence?: number;
}

export interface SentenceAnnotation {
  id?: string;
  start?: number;
  end?: number;
  quote: string;
  translation?: string;
  importance: Importance;
  pattern: SentencePattern;
  roles: RoleAnnotation[];
}

export interface SentenceFailure {
  id: string;
  start: number;
  end: number;
  reason: string;
}

export interface ParagraphAnnotation {
  id: string;
  sentences: SentenceAnnotation[];
  failedSentences?: SentenceFailure[];
  learningItems?: LearningItem[];
}

export interface ParagraphSnapshot {
  id: string;
  version?: number;
  text: string;
  requireRoles?: boolean;
}

export interface IndexedToken {
  id: string;
  text: string;
  start: number;
  end: number;
  wordLike: boolean;
}

export interface IndexedSentence {
  id: string;
  start: number;
  end: number;
  quote: string;
  tokens: IndexedToken[];
}

export interface IndexedParagraph {
  id: string;
  requireRoles: boolean;
  includeTranslation: boolean;
  learningItemKinds: LearningItemKind[];
  sentences: IndexedSentence[];
}

export interface ParagraphResult {
  id: string;
  version: number;
  sourceText: string;
  annotation: ParagraphAnnotation;
}

export interface OffsetRange {
  start: number;
  end: number;
}

export interface ImportanceRange extends OffsetRange {
  importance: Importance;
}

export interface RoleRange extends OffsetRange {
  family: RoleFamily;
}

export interface RenderPlan {
  boundaries: number[];
  importance: ImportanceRange[];
  roles: RoleRange[];
  warnings: string[];
}

const IMPORTANCE = new Set<Importance>(["primary", "supporting", "detail"]);
const PATTERNS = new Set<SentencePattern>(["SV", "SVC", "SVO", "SVOO", "SVOC", "multi", "unclassified", "fragment"]);
const ROLES = new Set<GrammarRole>([
  "subject",
  "verb",
  "object",
  "indirectObject",
  "directObject",
  "subjectComplement",
  "objectComplement",
]);
const LEARNING_ITEM_KIND_SET = new Set<LearningItemKind>(LEARNING_ITEM_KINDS);

const REQUIRED_ROLES: Record<Exclude<SentencePattern, "fragment" | "multi" | "unclassified">, ReadonlySet<GrammarRole>> = {
  SV: new Set(["subject", "verb"]),
  SVC: new Set(["subject", "verb", "subjectComplement"]),
  SVO: new Set(["subject", "verb", "object"]),
  SVOO: new Set(["subject", "verb", "indirectObject", "directObject"]),
  SVOC: new Set(["subject", "verb", "object", "objectComplement"]),
};

function rolesMatchPattern(pattern: SentencePattern, roles: readonly RoleAnnotation[]): boolean {
  const actual = new Set(roles.map((role) => role.role));
  if (pattern === "fragment") return roles.length === 0;
  if (pattern === "multi") return actual.has("subject") && roles.filter((role) => role.role === "verb").length >= 2;
  if (pattern === "unclassified") return actual.has("verb");
  const required = REQUIRED_ROLES[pattern];
  return roles.length === required.size
    && actual.size === required.size
    && [...actual].every((role) => required.has(role));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} 必须是非空字符串`);
  }
  return value;
}

export function indexParagraph(
  paragraph: ParagraphSnapshot,
  includeTranslation = true,
  learningItemKinds: readonly LearningItemKind[] = LEARNING_ITEM_KINDS,
): IndexedParagraph {
  const sentences = segmentSentenceSlices(paragraph.text).map((slice, sentenceIndex): IndexedSentence => {
    const id = `s${sentenceIndex}`;
    const tokens: IndexedToken[] = [];
    for (const token of new Intl.Segmenter("en", { granularity: "word" }).segment(slice.quote)) {
      if (isWhitespace(token.segment)) continue;
      for (const part of splitToken(token.segment, token.index, token.isWordLike === true)) {
        tokens.push({ id: `${id}t${tokens.length}`, ...part });
      }
    }
    return { id, start: slice.start, end: slice.end, quote: slice.quote, tokens };
  });
  if (sentences.length === 0) throw new Error("段落没有可分析的句子");
  return {
    id: paragraph.id,
    requireRoles: paragraph.requireRoles !== false,
    includeTranslation,
    learningItemKinds: [...learningItemKinds],
    sentences,
  };
}

export function parseIndexedAnnotationJson(text: string, indexed: IndexedParagraph): ParagraphAnnotation {
  const value = parseModelJson(text);
  if (!isRecord(value)) throw new Error("Agent 响应必须是 JSON 对象");
  return createIndexedAnnotation(indexed, value.sentences, value.learningItems);
}

export function createIndexedAnnotation(
  indexed: IndexedParagraph,
  sentenceValues: unknown,
  learningValues?: unknown,
): ParagraphAnnotation {
  if (!Array.isArray(sentenceValues)) throw new Error("Agent 响应缺少 sentences 数组");

  const returned = new Map<string, Record<string, unknown>>();
  const knownIds = new Set(indexed.sentences.map((sentence) => sentence.id));
  for (const sentence of sentenceValues) {
    if (!isRecord(sentence) || typeof sentence.id !== "string" || !knownIds.has(sentence.id)) {
      throw new Error("Agent 返回了未知的句子 ID");
    }
    if (returned.has(sentence.id)) throw new Error("Agent 返回了重复的句子 ID");
    returned.set(sentence.id, sentence);
  }
  if (returned.size !== indexed.sentences.length) throw new Error("Agent 没有返回全部句子");

  const sentences = indexed.sentences.map((sentence) => parseIndexedSentence(indexed, sentence, returned.get(sentence.id)!));
  const learningItems = parseLearningItems(indexed, learningValues);
  return {
    id: indexed.id,
    sentences,
    ...(learningItems.length > 0 ? { learningItems } : {}),
  };
}

export function createRecoverableIndexedAnnotation(
  indexed: IndexedParagraph,
  sentenceValues: unknown,
  learningValues?: unknown,
  expectedSentenceIds: readonly string[] = indexed.sentences.map((sentence) => sentence.id),
): ParagraphAnnotation {
  if (!Array.isArray(sentenceValues)) throw new Error("Agent 响应缺少 sentences 数组");

  const expected = new Set(expectedSentenceIds);
  const known = new Set(indexed.sentences.map((sentence) => sentence.id));
  const returned = new Map<string, Record<string, unknown>>();
  const duplicates = new Set<string>();
  for (const sentence of sentenceValues) {
    if (!isRecord(sentence) || typeof sentence.id !== "string" || !known.has(sentence.id) || !expected.has(sentence.id)) {
      continue;
    }
    if (returned.has(sentence.id)) duplicates.add(sentence.id);
    else returned.set(sentence.id, sentence);
  }

  const sentences: SentenceAnnotation[] = [];
  const failedSentences: SentenceFailure[] = [];
  for (const sentence of indexed.sentences) {
    if (!expected.has(sentence.id)) continue;
    const value = returned.get(sentence.id);
    if (duplicates.has(sentence.id)) {
      failedSentences.push({ id: sentence.id, start: sentence.start, end: sentence.end, reason: "Agent 返回了重复的句子 ID" });
      continue;
    }
    if (!value) {
      failedSentences.push({ id: sentence.id, start: sentence.start, end: sentence.end, reason: "Agent 没有返回该句子" });
      continue;
    }
    try {
      sentences.push(parseIndexedSentence(indexed, sentence, value));
    } catch (error: unknown) {
      failedSentences.push({
        id: sentence.id,
        start: sentence.start,
        end: sentence.end,
        reason: error instanceof Error ? error.message : "Agent 返回了无效句子",
      });
    }
  }

  const learningItems = parseLearningItems(indexed, learningValues);
  return {
    id: indexed.id,
    sentences,
    ...(failedSentences.length > 0 ? { failedSentences } : {}),
    ...(learningItems.length > 0 ? { learningItems } : {}),
  };
}

function parseIndexedSentence(
  indexed: IndexedParagraph,
  sentence: IndexedSentence,
  value: Record<string, unknown>,
): SentenceAnnotation {
  let pattern = value.pattern as SentencePattern;
  let roles = Array.isArray(value.roles)
    ? value.roles.flatMap((role): RoleAnnotation[] => {
      const parsed = parseIndexedRole(role, sentence);
      return parsed ? [parsed] : [];
    })
    : [];
  const fallbackRoles = roles.filter((role) => role.role === "subject" || role.role === "verb");

  if (!PATTERNS.has(pattern)) {
    if (!rolesMatchPattern("unclassified", fallbackRoles)) {
      throw new Error(`Agent 返回了无效句型：${sentence.id}`);
    }
    pattern = "unclassified";
    roles = fallbackRoles;
  }
  if (pattern === "fragment" && indexed.requireRoles) {
    if (!rolesMatchPattern("unclassified", fallbackRoles)) {
      throw new Error(`Agent 将完整文本块错误降级为片段：${sentence.id}`);
    }
    pattern = "unclassified";
    roles = fallbackRoles;
  }
  if (!rolesMatchPattern(pattern, roles)) {
    if (pattern === "fragment" || !rolesMatchPattern("unclassified", fallbackRoles)) {
      throw new Error(`Agent 返回了不完整的句法角色：${sentence.id}`);
    }
    pattern = "unclassified";
    roles = fallbackRoles;
  }
  if (!rolesHaveDistinctOffsets(sentence.quote, roles)) {
    throw new Error(`Agent 返回了重叠或无法定位的句法角色：${sentence.id}`);
  }
  const translation = typeof value.translation === "string" ? value.translation.trim() : "";
  if (indexed.includeTranslation && translation.length === 0) {
    throw new Error(`Agent 未返回句子翻译：${sentence.id}`);
  }
  return {
    id: sentence.id,
    start: sentence.start,
    end: sentence.end,
    quote: sentence.quote,
    ...(indexed.includeTranslation ? { translation } : {}),
    importance: indexed.sentences.length === 1
      ? "primary"
      : IMPORTANCE.has(value.importance as Importance) ? (value.importance as Importance) : "supporting",
    pattern,
    roles,
  };
}

export function learningItemKey(item: Pick<LearningItem, "kind" | "text">): string {
  return `${item.kind}:${item.text.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US")}`;
}

export function readLearningFavorites(value: unknown): LearningItem[] {
  if (!Array.isArray(value)) return [];
  const items = new Map<string, LearningItem>();

  for (const candidate of value) {
    if (!isRecord(candidate) || !LEARNING_ITEM_KIND_SET.has(candidate.kind as LearningItemKind)) continue;
    const text = typeof candidate.text === "string" ? candidate.text.trim() : "";
    const note = typeof candidate.note === "string" ? candidate.note.trim() : "";
    if (!text || !note) continue;
    const collectedAt = typeof candidate.collectedAt === "number"
      && Number.isFinite(candidate.collectedAt)
      && candidate.collectedAt >= 0
      ? candidate.collectedAt
      : undefined;
    const item: LearningItem = {
      kind: candidate.kind as LearningItemKind,
      text,
      note,
      ...(collectedAt === undefined ? {} : { collectedAt }),
    };
    const key = learningItemKey(item);
    const current = items.get(key);
    if (!current
      || current.collectedAt === undefined
      || (collectedAt !== undefined && collectedAt < current.collectedAt)) {
      items.set(key, item);
    }
  }
  return [...items.values()];
}

function parseLearningItems(indexed: IndexedParagraph, value: unknown): LearningItem[] {
  if (!Array.isArray(value)) return [];
  const enabledKinds = new Set(indexed.learningItemKinds);
  const items: LearningItem[] = [];
  const seen = new Set<string>();

  for (const candidate of value) {
    if (items.length === 3) break;
    if (!isRecord(candidate)
      || !LEARNING_ITEM_KIND_SET.has(candidate.kind as LearningItemKind)
      || !enabledKinds.has(candidate.kind as LearningItemKind)) continue;
    const text = typeof candidate.text === "string" ? candidate.text.trim() : "";
    const note = typeof candidate.note === "string" ? candidate.note.trim() : "";
    if (!text || !note || !indexed.sentences.some((sentence) => sentence.quote.includes(text))) continue;

    const item: LearningItem = { kind: candidate.kind as LearningItemKind, text, note };
    const key = learningItemKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
  }
  return items;
}

export function parseModelJson(text: string): unknown {
  const trimmed = text.trim();
  const jsonText = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?\s*/u, "").replace(/\s*```$/u, "")
    : trimmed;
  try {
    return JSON.parse(jsonText);
  } catch {
    const start = jsonText.indexOf("{");
    const end = jsonText.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("Agent 响应中没有 JSON 对象");
    return JSON.parse(jsonText.slice(start, end + 1));
  }
}

function parseIndexedRole(value: unknown, sentence: IndexedSentence): RoleAnnotation | undefined {
  if (!isRecord(value) || !ROLES.has(value.role as GrammarRole) || !Array.isArray(value.tokenIds)) {
    return undefined;
  }
  const tokenIds = value.tokenIds;
  if (tokenIds.length === 0 || tokenIds.some((id) => typeof id !== "string")) return undefined;

  const tokenIndexes = new Map(sentence.tokens.map((token, index) => [token.id, index]));
  const indexes = tokenIds.map((id) => tokenIndexes.get(String(id)) ?? -1);
  if (new Set(indexes).size !== indexes.length || indexes.some((index) => index < 0)) return undefined;
  if (!indexes.some((index) => sentence.tokens[index].wordLike)) return undefined;
  for (let index = 1; index < indexes.length; index += 1) {
    if (indexes[index] !== indexes[index - 1] + 1) return undefined;
  }

  const first = sentence.tokens[indexes[0]];
  const last = sentence.tokens[indexes.at(-1)!];
  const quote = sentence.quote.slice(first.start, last.end);
  const occurrence = quoteOccurrence(sentence.quote, quote, first.start);
  return {
    role: value.role as GrammarRole,
    quote,
    ...(occurrence === undefined ? {} : { occurrence }),
  };
}

function splitToken(text: string, start: number, wordLike: boolean): Array<{
  text: string;
  start: number;
  end: number;
  wordLike: boolean;
}> {
  const match = wordLike ? text.match(/^(.+?)(n['’]t|['’](?:s|re|ve|ll|d|m))$/iu) : undefined;
  if (!match) return [{ text, start, end: start + text.length, wordLike }];
  const baseEnd = start + match[1].length;
  return [
    { text: match[1], start, end: baseEnd, wordLike: true },
    { text: match[2], start: baseEnd, end: start + text.length, wordLike: true },
  ];
}

function quoteOccurrence(source: string, quote: string, selectedStart: number): number | undefined {
  const matches: number[] = [];
  let cursor = 0;
  while (cursor <= source.length - quote.length) {
    const index = source.indexOf(quote, cursor);
    if (index < 0) break;
    matches.push(index);
    cursor = index + quote.length;
  }
  if (matches.length <= 1) return undefined;
  const selected = matches.indexOf(selectedStart);
  return selected < 0 ? undefined : selected + 1;
}

interface SentenceSlice {
  quote: string;
  start: number;
  end: number;
}

function segmentSentenceSlices(source: string): SentenceSlice[] {
  const segments = [...new Intl.Segmenter("en", { granularity: "sentence" }).segment(source)];
  const slices: SentenceSlice[] = [];
  let start = segments[0]?.index ?? 0;

  for (const [index, segment] of segments.entries()) {
    const end = segment.index + segment.segment.length;
    const next = segments[index + 1];
    if (next && shouldMergeSentence(source.slice(start, end), next.segment)) continue;

    const raw = source.slice(start, end);
    const leading = raw.match(/^\s*/u)?.[0].length ?? 0;
    const trailing = raw.match(/\s*$/u)?.[0].length ?? 0;
    if (leading + trailing < raw.length) {
      const sliceStart = start + leading;
      const sliceEnd = end - trailing;
      slices.push({ quote: source.slice(sliceStart, sliceEnd), start: sliceStart, end: sliceEnd });
    }
    start = end;
  }
  return slices;
}

function shouldMergeSentence(current: string, next: string): boolean {
  const left = current.trimEnd();
  const right = next.trimStart();
  const abbreviation = /\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|No|vs|etc)\.$/iu.test(left)
    || /\b[A-Z]\.$/u.test(left);
  const reportingClause = /^[a-z]/u.test(right) && /[?!][”"'’)]?$/u.test(left);
  return abbreviation || reportingClause;
}

export function readAnalysisConcurrency(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_ANALYSIS_CONCURRENCY
    ? value
    : DEFAULT_ANALYSIS_CONCURRENCY;
}

export function readDisplaySettings(value: unknown): DisplaySettings {
  const stored = isRecord(value) ? value : {};
  const excerpts = isRecord(stored.excerpts) ? stored.excerpts : {};
  const highlights = isRecord(stored.highlights) ? stored.highlights : {};
  return {
    boundaries: typeof stored.boundaries === "boolean" ? stored.boundaries : DEFAULT_DISPLAY_SETTINGS.boundaries,
    importance: typeof stored.importance === "boolean" ? stored.importance : DEFAULT_DISPLAY_SETTINGS.importance,
    grammar: typeof stored.grammar === "boolean" ? stored.grammar : DEFAULT_DISPLAY_SETTINGS.grammar,
    analysisConcurrency: readAnalysisConcurrency(stored.analysisConcurrency),
    mainContentOnly: typeof stored.mainContentOnly === "boolean" ? stored.mainContentOnly : DEFAULT_DISPLAY_SETTINGS.mainContentOnly,
    preload: typeof stored.preload === "boolean" ? stored.preload : DEFAULT_DISPLAY_SETTINGS.preload,
    preloadPercent: typeof stored.preloadPercent === "number"
      && Number.isFinite(stored.preloadPercent)
      && stored.preloadPercent >= 0
      ? stored.preloadPercent
      : DEFAULT_DISPLAY_SETTINGS.preloadPercent,
    fullPhrases: typeof stored.fullPhrases === "boolean" ? stored.fullPhrases : DEFAULT_DISPLAY_SETTINGS.fullPhrases,
    translation: typeof stored.translation === "boolean" ? stored.translation : DEFAULT_DISPLAY_SETTINGS.translation,
    translationHover: typeof stored.translationHover === "boolean" ? stored.translationHover : DEFAULT_DISPLAY_SETTINGS.translationHover,
    excerpts: Object.fromEntries(LEARNING_ITEM_KINDS.map((kind) => [
      kind,
      typeof excerpts[kind] === "boolean" ? excerpts[kind] : DEFAULT_DISPLAY_SETTINGS.excerpts[kind],
    ])) as Record<LearningItemKind, boolean>,
    highlights: Object.fromEntries(HIGHLIGHT_TYPES.map((type) => {
      const fallback = DEFAULT_DISPLAY_SETTINGS.highlights[type];
      const setting = isRecord(highlights[type]) ? highlights[type] : {};
      const color = typeof setting.color === "string" && /^#[\da-f]{6}$/iu.test(setting.color)
        ? setting.color.toUpperCase()
        : fallback.color;
      return [type, {
        enabled: typeof setting.enabled === "boolean" ? setting.enabled : fallback.enabled,
        color,
        mode: setting.mode === "underline" ? "underline" : "text",
      }];
    })) as Record<HighlightType, HighlightSettings>,
  };
}

export function validateProviderSettings(value: unknown): ProviderSettings {
  if (!isRecord(value) || typeof value.provider !== "string" || !(value.provider in PROVIDER_PRESETS)) {
    throw new Error("请选择模型供应商");
  }

  const baseUrl = requiredString(value.baseUrl, "API Base URL").replace(/\/+$/u, "");
  const url = new URL(baseUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("API Base URL 只支持 HTTP 或 HTTPS");
  }

  return {
    provider: value.provider as ProviderId,
    baseUrl,
    modelId: requiredString(value.modelId, "Model ID").trim(),
    apiKey: requiredString(value.apiKey, "API Key").trim(),
  };
}

export function createRenderPlan(source: string, annotation: ParagraphAnnotation): RenderPlan | undefined {
  const importance: ImportanceRange[] = [];
  const roles: RoleRange[] = [];
  const boundaries: number[] = [];
  const warnings: string[] = [];
  const positioned = annotation.sentences.every((sentence) => (
    Number.isInteger(sentence.start) && Number.isInteger(sentence.end)
  ));
  const sentences = positioned
    ? [...annotation.sentences].sort((left, right) => left.start! - right.start!)
    : annotation.sentences;
  let cursor = 0;

  for (const [sentenceIndex, sentence] of sentences.entries()) {
    const start = positioned ? sentence.start! : source.indexOf(sentence.quote, cursor);
    const end = positioned ? sentence.end! : start + sentence.quote.length;
    if (start < 0 || end <= start || source.slice(start, end) !== sentence.quote) return undefined;
    if (positioned) {
      if (start < cursor) return undefined;
    } else if (!isWhitespace(source.slice(cursor, start))) {
      return undefined;
    }

    importance.push({ start, end, importance: sentence.importance });

    const sentenceRoles = resolveSentenceRoles(sentence, start);
    if (sentenceRoles) {
      roles.push(...sentenceRoles);
      if (sentence.pattern === "unclassified") warnings.push(`第 ${sentenceIndex + 1} 句仅保留可验证角色`);
    } else if (sentence.pattern !== "fragment") {
      warnings.push(`第 ${sentenceIndex + 1} 句的句法标记已降级`);
    }

    if (sentenceIndex < sentences.length - 1) boundaries.push(end);
    cursor = end;
  }

  if (!positioned && !isWhitespace(source.slice(cursor))) return undefined;
  return { boundaries, importance, roles, warnings };
}

function rolesHaveDistinctOffsets(sentence: string, roles: readonly RoleAnnotation[]): boolean {
  const ranges = roles.map((role) => {
    const start = findRoleOffset(sentence, role);
    return start === undefined ? undefined : { start, end: start + role.quote.length };
  });
  if (ranges.some((range) => range === undefined)) return false;
  const sorted = (ranges as OffsetRange[]).sort((left, right) => left.start - right.start || left.end - right.end);
  return sorted.every((range, index) => index === 0 || range.start >= sorted[index - 1].end);
}

function resolveSentenceRoles(sentence: SentenceAnnotation, sentenceStart: number): RoleRange[] | undefined {
  if (sentence.pattern === "fragment") return [];
  if (!rolesMatchPattern(sentence.pattern, sentence.roles)) return undefined;

  const ranges: RoleRange[] = [];
  for (const role of sentence.roles) {
    const relativeStart = findRoleOffset(sentence.quote, role);
    if (relativeStart === undefined) return undefined;
    ranges.push({
      start: sentenceStart + relativeStart,
      end: sentenceStart + relativeStart + role.quote.length,
      family: roleFamily(role.role),
    });
  }

  ranges.sort((left, right) => left.start - right.start || left.end - right.end);
  for (let index = 1; index < ranges.length; index += 1) {
    if (ranges[index].start < ranges[index - 1].end) return undefined;
  }
  return ranges;
}

function findRoleOffset(sentence: string, role: RoleAnnotation): number | undefined {
  const matches: number[] = [];
  let cursor = 0;
  while (cursor <= sentence.length - role.quote.length) {
    const index = sentence.indexOf(role.quote, cursor);
    if (index < 0) break;
    matches.push(index);
    cursor = index + role.quote.length;
  }

  if (role.occurrence !== undefined) return matches[role.occurrence - 1];
  return matches.length === 1 ? matches[0] : undefined;
}

function roleFamily(role: GrammarRole): RoleFamily {
  if (role === "subject") return "subject";
  if (role === "verb") return "verb";
  if (role === "subjectComplement" || role === "objectComplement") return "complement";
  return "object";
}

function isWhitespace(value: string): boolean {
  return /^\s*$/u.test(value);
}
