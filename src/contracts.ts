export const SETTINGS_KEY = "providerSettings";
export const DISPLAY_KEY = "displaySettings";

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

export interface DisplaySettings {
  boundaries: boolean;
  importance: boolean;
  grammar: boolean;
  highlights: Record<HighlightType, HighlightSettings>;
}

export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  boundaries: false,
  importance: true,
  grammar: true,
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
export type SentencePattern = "SV" | "SVC" | "SVO" | "SVOO" | "SVOC" | "unclassified";
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
  quote: string;
  importance: Importance;
  pattern: SentencePattern;
  roles: RoleAnnotation[];
}

export interface ParagraphAnnotation {
  id: string;
  sentences: SentenceAnnotation[];
}

export interface ParagraphSnapshot {
  id: string;
  text: string;
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
  quote: string;
  tokens: IndexedToken[];
}

export interface IndexedParagraph {
  id: string;
  sentences: IndexedSentence[];
}

export interface ParagraphResult {
  id: string;
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
const PATTERNS = new Set<SentencePattern>(["SV", "SVC", "SVO", "SVOO", "SVOC", "unclassified"]);
const ROLES = new Set<GrammarRole>([
  "subject",
  "verb",
  "object",
  "indirectObject",
  "directObject",
  "subjectComplement",
  "objectComplement",
]);

const REQUIRED_ROLES: Record<Exclude<SentencePattern, "unclassified">, ReadonlySet<GrammarRole>> = {
  SV: new Set(["subject", "verb"]),
  SVC: new Set(["subject", "verb", "subjectComplement"]),
  SVO: new Set(["subject", "verb", "object"]),
  SVOO: new Set(["subject", "verb", "indirectObject", "directObject"]),
  SVOC: new Set(["subject", "verb", "object", "objectComplement"]),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} 必须是非空字符串`);
  }
  return value;
}

export function indexParagraph(paragraph: ParagraphSnapshot): IndexedParagraph {
  const sentences = segmentSentenceSlices(paragraph.text).map((slice, sentenceIndex): IndexedSentence => {
    const id = `s${sentenceIndex}`;
    const tokens: IndexedToken[] = [];
    for (const token of new Intl.Segmenter("en", { granularity: "word" }).segment(slice.quote)) {
      if (isWhitespace(token.segment)) continue;
      for (const part of splitToken(token.segment, token.index, token.isWordLike === true)) {
        tokens.push({ id: `${id}t${tokens.length}`, ...part });
      }
    }
    return { id, quote: slice.quote, tokens };
  });
  if (sentences.length === 0) throw new Error("段落没有可分析的句子");
  return { id: paragraph.id, sentences };
}

export function parseIndexedAnnotationJson(text: string, indexed: IndexedParagraph): ParagraphAnnotation {
  const value = parseModelJson(text);
  if (!isRecord(value)) throw new Error("Agent 响应必须是 JSON 对象");
  return createIndexedAnnotation(indexed, value.sentences);
}

export function createIndexedAnnotation(indexed: IndexedParagraph, sentenceValues: unknown): ParagraphAnnotation {
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

  const sentences = indexed.sentences.map((sentence): SentenceAnnotation => {
    const value = returned.get(sentence.id)!;
    return {
      quote: sentence.quote,
      importance: indexed.sentences.length === 1
        ? "primary"
        : IMPORTANCE.has(value.importance as Importance) ? (value.importance as Importance) : "supporting",
      pattern: PATTERNS.has(value.pattern as SentencePattern)
        ? (value.pattern as SentencePattern)
        : "unclassified",
      roles: Array.isArray(value.roles)
        ? value.roles.flatMap((role): RoleAnnotation[] => {
          const parsed = parseIndexedRole(role, sentence);
          return parsed ? [parsed] : [];
        })
        : [],
    };
  });
  return { id: indexed.id, sentences };
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
      slices.push({ quote: raw.slice(leading, raw.length - trailing) });
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

export function readDisplaySettings(value: unknown): DisplaySettings {
  const stored = isRecord(value) ? value : {};
  const highlights = isRecord(stored.highlights) ? stored.highlights : {};
  return {
    boundaries: typeof stored.boundaries === "boolean" ? stored.boundaries : DEFAULT_DISPLAY_SETTINGS.boundaries,
    importance: typeof stored.importance === "boolean" ? stored.importance : DEFAULT_DISPLAY_SETTINGS.importance,
    grammar: typeof stored.grammar === "boolean" ? stored.grammar : DEFAULT_DISPLAY_SETTINGS.grammar,
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
  let cursor = 0;

  for (const [sentenceIndex, sentence] of annotation.sentences.entries()) {
    const start = source.indexOf(sentence.quote, cursor);
    if (start < 0 || !isWhitespace(source.slice(cursor, start))) return undefined;

    const end = start + sentence.quote.length;
    importance.push({ start, end, importance: sentence.importance });

    const sentenceRoles = resolveSentenceRoles(sentence, start);
    if (sentenceRoles) roles.push(...sentenceRoles);
    else if (sentence.pattern !== "unclassified") warnings.push(`第 ${sentenceIndex + 1} 句的句法标记已降级`);

    if (sentenceIndex < annotation.sentences.length - 1) boundaries.push(end);
    cursor = end;
  }

  if (!isWhitespace(source.slice(cursor))) return undefined;
  return { boundaries, importance, roles, warnings };
}

function resolveSentenceRoles(sentence: SentenceAnnotation, sentenceStart: number): RoleRange[] | undefined {
  if (sentence.pattern === "unclassified") return [];

  const required = REQUIRED_ROLES[sentence.pattern];
  const actual = new Set(sentence.roles.map((role) => role.role));
  if (actual.size !== required.size || [...actual].some((role) => !required.has(role))) return undefined;
  if ([...required].some((role) => !actual.has(role))) return undefined;

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
