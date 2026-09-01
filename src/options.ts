import { logInfo, logWarn } from "./debug.ts";
import {
  DEFAULT_DISPLAY_SETTINGS,
  DISPLAY_KEY,
  HIGHLIGHT_TYPES,
  LEARNING_FAVORITES_KEY,
  MAX_ANALYSIS_CONCURRENCY,
  PROVIDER_PRESETS,
  SETTINGS_KEY,
  readAnalysisConcurrency,
  readDisplaySettings,
  readLearningFavorites,
  type DisplaySettings,
  type HighlightMode,
  type HighlightSettings,
  type HighlightType,
  type LearningItem,
  type ProviderId,
  type ProviderSettings,
  validateProviderSettings,
} from "./contracts.ts";

const form = requiredElement<HTMLFormElement>("settings-form");
const provider = requiredElement<HTMLSelectElement>("provider");
const baseUrl = requiredElement<HTMLInputElement>("base-url");
const modelId = requiredElement<HTMLInputElement>("model-id");
const apiKey = requiredElement<HTMLInputElement>("api-key");
const testButton = requiredElement<HTMLButtonElement>("test-provider");
const status = requiredElement<HTMLElement>("status");
const analysisConcurrency = requiredElement<HTMLInputElement>("analysis-concurrency");
const mainContentOnly = requiredElement<HTMLInputElement>("analysis-main-content-only");
const preload = requiredElement<HTMLInputElement>("analysis-preload");
const preloadPercent = requiredElement<HTMLInputElement>("analysis-preload-percent");
const boundaries = requiredElement<HTMLInputElement>("render-boundaries");
const importance = requiredElement<HTMLInputElement>("render-importance");
const grammar = requiredElement<HTMLInputElement>("render-grammar");
const fullPhrases = requiredElement<HTMLInputElement>("render-full-phrases");
const translation = requiredElement<HTMLInputElement>("render-translation");
const translationHover = requiredElement<HTMLInputElement>("render-translation-hover");
const excerptControls = {
  vocabulary: requiredElement<HTMLInputElement>("excerpt-vocabulary"),
  phrase: requiredElement<HTMLInputElement>("excerpt-phrase"),
  pattern: requiredElement<HTMLInputElement>("excerpt-pattern"),
} satisfies Record<LearningItem["kind"], HTMLInputElement>;
const optionsTabList = requiredElement<HTMLElement>("options-tabs");
const optionsTabs = [...optionsTabList.querySelectorAll<HTMLButtonElement>("[role='tab']")];
const collectionGroups = requiredElement<HTMLElement>("collection-groups");
const collectionEmpty = requiredElement<HTMLElement>("collection-empty");
const previewMarks = [...document.querySelectorAll<HTMLElement>("[data-preview-importance]")];
const previewBoundaries = [...document.querySelectorAll<HTMLElement>(".render-preview-boundary")];
const HEX_COLOR = /^#[\da-f]{6}$/iu;
const APPLE_ACCENT_COLORS = [
  ["#0088FF", "蓝色 · Blue"],
  ["#CB30E0", "紫色 · Purple"],
  ["#FF2D55", "粉色 · Pink"],
  ["#FF383C", "红色 · Red"],
  ["#FF8D28", "橙色 · Orange"],
  ["#FFCC00", "黄色 · Yellow"],
  ["#34C759", "绿色 · Green"],
  ["#98989D", "石墨色 · Graphite"],
] as const;
const LEARNING_ITEM_LABELS: Record<LearningItem["kind"], string> = {
  vocabulary: "特殊词汇",
  phrase: "经典短语",
  pattern: "句式",
};
const COLLECTION_DAY_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "short",
});
const highlightControls = HIGHLIGHT_TYPES.map((type) => ({
  type,
  enabled: requiredElement<HTMLInputElement>(`render-${type}-enabled`),
  mode: requiredElement<HTMLSelectElement>(`render-${type}-mode`),
  preset: requiredElement<HTMLSelectElement>(`render-${type}-preset`),
  color: requiredElement<HTMLInputElement>(`render-${type}-color`),
}));
type HighlightControl = (typeof highlightControls)[number];
let displaySettings = readDisplaySettings(DEFAULT_DISPLAY_SETTINGS);

analysisConcurrency.max = String(MAX_ANALYSIS_CONCURRENCY);
void initialize();

for (const tab of optionsTabs) {
  tab.addEventListener("click", () => activateOptionsTab(tab));
}

optionsTabList.addEventListener("keydown", (event) => {
  if (!(["ArrowLeft", "ArrowRight", "Home", "End"] as string[]).includes(event.key)) return;
  event.preventDefault();
  const current = optionsTabs.findIndex((tab) => tab.getAttribute("aria-selected") === "true");
  const next = event.key === "Home"
    ? 0
    : event.key === "End"
      ? optionsTabs.length - 1
      : (current + (event.key === "ArrowRight" ? 1 : -1) + optionsTabs.length) % optionsTabs.length;
  activateOptionsTab(optionsTabs[next], true);
});

provider.addEventListener("change", () => {
  logInfo("options", "provider.changed", { provider: provider.value });
  applyPreset(provider.value as ProviderId);
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  logInfo("options", "settings.submit-requested");
  void saveSettings();
});

testButton.addEventListener("click", () => {
  logInfo("options", "provider.test-button-clicked");
  void testProviderConnection();
});

for (const checkbox of [
  mainContentOnly,
  preload,
  boundaries,
  importance,
  grammar,
  fullPhrases,
  translation,
  translationHover,
  ...Object.values(excerptControls),
]) {
  checkbox.addEventListener("change", () => {
    void updateDisplaySettings();
  });
}

analysisConcurrency.addEventListener("change", () => {
  analysisConcurrency.value = String(readAnalysisConcurrency(analysisConcurrency.valueAsNumber));
  void updateDisplaySettings();
});

preloadPercent.addEventListener("change", () => {
  preloadPercent.value = String(currentPreloadPercent());
  void updateDisplaySettings();
});

for (const control of highlightControls) {
  for (const [color, label] of APPLE_ACCENT_COLORS) {
    control.preset.add(new Option(label, color));
  }
  control.enabled.addEventListener("change", () => {
    void updateDisplaySettings();
  });
  control.mode.addEventListener("change", () => {
    void updateDisplaySettings();
  });
  control.preset.addEventListener("change", () => {
    const color = readHexColor(control.preset.value);
    if (!color) return;
    control.color.value = color;
    control.color.setCustomValidity("");
    control.color.setAttribute("aria-invalid", "false");
    void updateDisplaySettings();
  });
  control.color.addEventListener("input", () => {
    const color = readHexColor(control.color.value);
    control.color.setCustomValidity(color ? "" : "请输入 #RRGGBB 格式的颜色");
    control.color.setAttribute("aria-invalid", String(color === undefined));
    if (!color) return;
    control.color.value = color;
    void updateDisplaySettings();
  });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (changes[DISPLAY_KEY]) {
    const next = readDisplaySettings(changes[DISPLAY_KEY].newValue);
    logInfo("options", "display.storage-changed", {
      analysisConcurrency: next.analysisConcurrency,
      mainContentOnly: next.mainContentOnly,
      boundaries: next.boundaries,
      importance: next.importance,
      grammar: next.grammar,
      preload: next.preload,
      preloadPercent: next.preloadPercent,
      fullPhrases: next.fullPhrases,
      translation: next.translation,
      translationHover: next.translationHover,
      excerpts: next.excerpts,
    });
    setDisplaySettings(next);
  }
  if (changes[LEARNING_FAVORITES_KEY]) {
    renderLearningFavorites(changes[LEARNING_FAVORITES_KEY].newValue);
  }
});

async function initialize(): Promise<void> {
  const stored = await chrome.storage.local.get([SETTINGS_KEY, DISPLAY_KEY, LEARNING_FAVORITES_KEY]);
  const settings = readStoredSettings(stored[SETTINGS_KEY]);
  provider.value = settings.provider;
  baseUrl.value = settings.baseUrl;
  modelId.value = settings.modelId;
  apiKey.value = settings.apiKey;
  const initialDisplay = readDisplaySettings(stored[DISPLAY_KEY] ?? DEFAULT_DISPLAY_SETTINGS);
  const favorites = readLearningFavorites(stored[LEARNING_FAVORITES_KEY]);
  setDisplaySettings(initialDisplay);
  renderLearningFavorites(favorites);
  logInfo("options", "options.ready", {
    ...settingsMetadata(settings),
    favoriteCount: favorites.length,
    display: {
      analysisConcurrency: initialDisplay.analysisConcurrency,
      mainContentOnly: initialDisplay.mainContentOnly,
      boundaries: initialDisplay.boundaries,
      importance: initialDisplay.importance,
      grammar: initialDisplay.grammar,
      preload: initialDisplay.preload,
      preloadPercent: initialDisplay.preloadPercent,
      fullPhrases: initialDisplay.fullPhrases,
      translation: initialDisplay.translation,
      translationHover: initialDisplay.translationHover,
      excerpts: initialDisplay.excerpts,
    },
  });
}

async function saveSettings(): Promise<void> {
  const startedAt = performance.now();
  try {
    const settings = currentSettings();
    logInfo("options", "settings.save-started", settingsMetadata(settings));
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    setStatus("设置已保存");
    logInfo("options", "settings.save-succeeded", {
      ...settingsMetadata(settings),
      durationMs: Math.round(performance.now() - startedAt),
    });
  } catch (error: unknown) {
    logWarn("options", "settings.save-failed", {
      durationMs: Math.round(performance.now() - startedAt),
      error,
    });
    setStatus(error instanceof Error ? error.message : "设置无效", true);
  }
}

async function testProviderConnection(): Promise<void> {
  const startedAt = performance.now();
  testButton.disabled = true;
  testButton.setAttribute("aria-busy", "true");
  try {
    const settings = currentSettings();
    logInfo("options", "provider.test-started", settingsMetadata(settings));
    setStatus("正在测试连接…");
    const response: unknown = await chrome.runtime.sendMessage({
      type: "TEST_PROVIDER",
      settings,
    });
    if (!isRecord(response) || response.ok !== true) {
      throw new Error(isRecord(response) && typeof response.error === "string" ? response.error : "连接失败");
    }
    setStatus("连接成功");
    logInfo("options", "provider.test-succeeded", {
      durationMs: Math.round(performance.now() - startedAt),
    });
  } catch (error: unknown) {
    logWarn("options", "provider.test-failed", {
      durationMs: Math.round(performance.now() - startedAt),
      error,
    });
    setStatus(error instanceof Error ? error.message : "连接失败", true);
  } finally {
    testButton.disabled = false;
    testButton.removeAttribute("aria-busy");
  }
}

function currentSettings(): ProviderSettings {
  return validateProviderSettings({
    provider: provider.value,
    baseUrl: baseUrl.value.trim(),
    modelId: modelId.value.trim(),
    apiKey: apiKey.value.trim(),
  });
}

async function updateDisplaySettings(): Promise<void> {
  displaySettings = currentDisplaySettings();
  for (const control of highlightControls) {
    syncColorControl(control, displaySettings.highlights[control.type].color);
  }
  renderDisplayPreview(displaySettings);
  logInfo("options", "display.save-started", {
    analysisConcurrency: displaySettings.analysisConcurrency,
    mainContentOnly: displaySettings.mainContentOnly,
    boundaries: displaySettings.boundaries,
    importance: displaySettings.importance,
    grammar: displaySettings.grammar,
    preload: displaySettings.preload,
    preloadPercent: displaySettings.preloadPercent,
    fullPhrases: displaySettings.fullPhrases,
    translation: displaySettings.translation,
    translationHover: displaySettings.translationHover,
    excerpts: displaySettings.excerpts,
    highlightEnabled: Object.fromEntries(HIGHLIGHT_TYPES.map((type) => [type, displaySettings.highlights[type].enabled])),
  });
  await chrome.storage.local.set({ [DISPLAY_KEY]: displaySettings });
  logInfo("options", "display.save-succeeded");
}

function currentDisplaySettings(): DisplaySettings {
  return {
    ...displaySettings,
    analysisConcurrency: readAnalysisConcurrency(analysisConcurrency.valueAsNumber),
    mainContentOnly: mainContentOnly.checked,
    boundaries: boundaries.checked,
    importance: importance.checked,
    grammar: grammar.checked,
    preload: preload.checked,
    preloadPercent: currentPreloadPercent(),
    fullPhrases: fullPhrases.checked,
    translation: translation.checked,
    translationHover: translationHover.checked,
    excerpts: {
      vocabulary: excerptControls.vocabulary.checked,
      phrase: excerptControls.phrase.checked,
      pattern: excerptControls.pattern.checked,
    },
    highlights: Object.fromEntries(highlightControls.map((control) => [control.type, {
      enabled: control.enabled.checked,
      color: readHexColor(control.color.value) ?? displaySettings.highlights[control.type].color,
      mode: control.mode.value as HighlightMode,
    }])) as Record<HighlightType, HighlightSettings>,
  };
}

function setDisplaySettings(display: DisplaySettings): void {
  displaySettings = display;
  analysisConcurrency.value = String(display.analysisConcurrency);
  mainContentOnly.checked = display.mainContentOnly;
  boundaries.checked = display.boundaries;
  importance.checked = display.importance;
  grammar.checked = display.grammar;
  preload.checked = display.preload;
  preloadPercent.value = String(display.preloadPercent);
  fullPhrases.checked = display.fullPhrases;
  translation.checked = display.translation;
  translationHover.checked = display.translationHover;
  excerptControls.vocabulary.checked = display.excerpts.vocabulary;
  excerptControls.phrase.checked = display.excerpts.phrase;
  excerptControls.pattern.checked = display.excerpts.pattern;
  for (const control of highlightControls) {
    const setting = display.highlights[control.type];
    control.enabled.checked = setting.enabled;
    control.mode.value = setting.mode;
    control.color.value = setting.color;
    control.color.setCustomValidity("");
    control.color.setAttribute("aria-invalid", "false");
    syncColorControl(control, setting.color);
  }
  renderDisplayPreview(display);
}

function currentPreloadPercent(): number {
  const value = preloadPercent.valueAsNumber;
  return Number.isFinite(value) && value >= 0 ? value : displaySettings.preloadPercent;
}

function syncColorControl(control: HighlightControl, color: string): void {
  control.preset.value = APPLE_ACCENT_COLORS.some(([preset]) => preset === color) ? color : "";
  control.preset.style.backgroundColor = color;
}

function renderDisplayPreview(display: DisplaySettings): void {
  for (const mark of previewMarks) {
    const importanceType = mark.dataset.previewImportance as HighlightType;
    const roleType = mark.dataset.previewRole as HighlightType | undefined;
    const importanceSetting = display.importance && display.highlights[importanceType].enabled
      ? display.highlights[importanceType]
      : undefined;
    const roleSetting = roleType
      && (display.fullPhrases || !mark.hasAttribute("data-preview-phrase-only"))
      && display.grammar
      && display.highlights[roleType].enabled
      ? display.highlights[roleType]
      : undefined;
    const textSetting = roleSetting?.mode === "text"
      ? roleSetting
      : importanceSetting?.mode === "text" ? importanceSetting : undefined;
    const underlineSetting = roleSetting?.mode === "underline"
      ? roleSetting
      : importanceSetting?.mode === "underline" ? importanceSetting : undefined;
    mark.style.color = textSetting?.color ?? "";
    mark.style.textDecorationLine = underlineSetting ? "underline" : "none";
    mark.style.textDecorationColor = underlineSetting?.color ?? "";
  }
  for (const boundary of previewBoundaries) boundary.hidden = !display.boundaries;
}

function activateOptionsTab(tab: HTMLButtonElement, focus = false): void {
  for (const candidate of optionsTabs) {
    const selected = candidate === tab;
    candidate.setAttribute("aria-selected", String(selected));
    candidate.tabIndex = selected ? 0 : -1;
    const panel = document.getElementById(candidate.getAttribute("aria-controls") ?? "");
    const heading = document.getElementById(candidate.dataset.heading ?? "");
    if (panel) panel.hidden = !selected;
    if (heading) heading.hidden = !selected;
  }
  if (focus) tab.focus();
}

function renderLearningFavorites(value: unknown): void {
  const favorites = readLearningFavorites(value).sort((left, right) => (
    (right.collectedAt ?? Number.NEGATIVE_INFINITY) - (left.collectedAt ?? Number.NEGATIVE_INFINITY)
  ));
  const days = new Map<string, { timestamp?: number; items: LearningItem[] }>();
  for (const item of favorites) {
    const key = item.collectedAt === undefined ? "unknown" : localDayKey(item.collectedAt);
    const day = days.get(key) ?? {
      ...(item.collectedAt === undefined ? {} : { timestamp: item.collectedAt }),
      items: [],
    };
    day.items.push(item);
    days.set(key, day);
  }

  collectionGroups.replaceChildren(...[...days.values()].map(createCollectionDay));
  collectionEmpty.hidden = favorites.length > 0;
}

function createCollectionDay(day: { timestamp?: number; items: LearningItem[] }): HTMLElement {
  const section = document.createElement("section");
  section.className = "control-section collection-day";
  const heading = document.createElement("div");
  heading.className = "section-heading collection-day-heading";
  const title = document.createElement("h2");
  title.textContent = day.timestamp === undefined ? "日期未知" : COLLECTION_DAY_FORMATTER.format(day.timestamp);
  const count = document.createElement("span");
  count.textContent = `${day.items.length} ITEMS`;
  heading.append(title, count);

  const list = document.createElement("ul");
  list.className = "collection-list";
  list.append(...day.items.map(createCollectionItem));
  section.append(heading, list);
  return section;
}

function createCollectionItem(item: LearningItem): HTMLLIElement {
  const element = document.createElement("li");
  element.className = "collection-item";
  const kind = document.createElement("span");
  kind.className = `collection-kind is-${item.kind}`;
  kind.textContent = LEARNING_ITEM_LABELS[item.kind];
  const text = document.createElement("strong");
  text.className = "collection-text";
  text.textContent = item.text;
  const note = document.createElement("p");
  note.className = "collection-note";
  note.textContent = item.note;
  element.append(kind, text, note);
  return element;
}

function localDayKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function readHexColor(value: string): string | undefined {
  const color = value.trim().toUpperCase();
  return HEX_COLOR.test(color) ? color : undefined;
}

function readStoredSettings(value: unknown): ProviderSettings {
  try {
    return validateProviderSettings(value);
  } catch {
    const preset = PROVIDER_PRESETS.deepseek;
    return {
      provider: "deepseek",
      baseUrl: preset.baseUrl,
      modelId: preset.modelId,
      apiKey: "",
    };
  }
}

function applyPreset(id: ProviderId): void {
  const preset = PROVIDER_PRESETS[id];
  logInfo("options", "provider.preset-applied", { provider: id, modelId: preset.modelId, endpointOrigin: endpointOrigin(preset.baseUrl) });
  baseUrl.value = preset.baseUrl;
  modelId.value = preset.modelId;
  setStatus("");
}

function setStatus(message: string, error = false): void {
  logInfo("options", "status.updated", { message, error });
  status.textContent = message;
  status.classList.toggle("error", error);
  status.classList.toggle("success", !error && (message === "设置已保存" || message === "连接成功"));
}

function settingsMetadata(settings: ProviderSettings): Record<string, unknown> {
  return {
    provider: settings.provider,
    modelId: settings.modelId,
    endpointOrigin: endpointOrigin(settings.baseUrl),
    hasApiKey: settings.apiKey.length > 0,
  };
}

function endpointOrigin(baseUrlValue: string): string {
  try {
    return new URL(baseUrlValue).origin;
  } catch {
    return "invalid-url";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}
