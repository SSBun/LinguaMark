import { logError, logInfo } from "./debug.ts";
import {
  DEFAULT_DISPLAY_SETTINGS,
  DISPLAY_KEY,
  HIGHLIGHT_TYPES,
  PROVIDER_PRESETS,
  SETTINGS_KEY,
  readDisplaySettings,
  type DisplaySettings,
  type HighlightMode,
  type HighlightSettings,
  type HighlightType,
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
const boundaries = requiredElement<HTMLInputElement>("render-boundaries");
const importance = requiredElement<HTMLInputElement>("render-importance");
const grammar = requiredElement<HTMLInputElement>("render-grammar");
const highlightControls = HIGHLIGHT_TYPES.map((type) => ({
  type,
  enabled: requiredElement<HTMLInputElement>(`render-${type}-enabled`),
  mode: requiredElement<HTMLSelectElement>(`render-${type}-mode`),
  color: requiredElement<HTMLInputElement>(`render-${type}-color`),
  value: requiredElement<HTMLOutputElement>(`render-${type}-value`),
}));
let displaySettings = readDisplaySettings(DEFAULT_DISPLAY_SETTINGS);

void initialize();

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

for (const checkbox of [boundaries, importance, grammar]) {
  checkbox.addEventListener("change", () => {
    void updateDisplaySettings();
  });
}

for (const control of highlightControls) {
  control.enabled.addEventListener("change", () => {
    void updateDisplaySettings();
  });
  control.mode.addEventListener("change", () => {
    void updateDisplaySettings();
  });
  control.color.addEventListener("input", () => {
    control.value.value = control.color.value.toUpperCase();
  });
  control.color.addEventListener("change", () => {
    void updateDisplaySettings();
  });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[DISPLAY_KEY]) {
    const next = readDisplaySettings(changes[DISPLAY_KEY].newValue);
    logInfo("options", "display.storage-changed", {
      boundaries: next.boundaries,
      importance: next.importance,
      grammar: next.grammar,
    });
    setDisplaySettings(next);
  }
});

async function initialize(): Promise<void> {
  const stored = await chrome.storage.local.get([SETTINGS_KEY, DISPLAY_KEY]);
  const settings = readStoredSettings(stored[SETTINGS_KEY]);
  provider.value = settings.provider;
  baseUrl.value = settings.baseUrl;
  modelId.value = settings.modelId;
  apiKey.value = settings.apiKey;
  const initialDisplay = readDisplaySettings(stored[DISPLAY_KEY] ?? DEFAULT_DISPLAY_SETTINGS);
  setDisplaySettings(initialDisplay);
  logInfo("options", "options.ready", {
    ...settingsMetadata(settings),
    display: { boundaries: initialDisplay.boundaries, importance: initialDisplay.importance, grammar: initialDisplay.grammar },
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
    logError("options", "settings.save-failed", {
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
    logError("options", "provider.test-failed", {
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
  logInfo("options", "display.save-started", {
    boundaries: displaySettings.boundaries,
    importance: displaySettings.importance,
    grammar: displaySettings.grammar,
    highlightEnabled: Object.fromEntries(HIGHLIGHT_TYPES.map((type) => [type, displaySettings.highlights[type].enabled])),
  });
  await chrome.storage.local.set({ [DISPLAY_KEY]: displaySettings });
  logInfo("options", "display.save-succeeded");
}

function currentDisplaySettings(): DisplaySettings {
  return {
    ...displaySettings,
    boundaries: boundaries.checked,
    importance: importance.checked,
    grammar: grammar.checked,
    highlights: Object.fromEntries(highlightControls.map((control) => [control.type, {
      enabled: control.enabled.checked,
      color: control.color.value.toUpperCase(),
      mode: control.mode.value as HighlightMode,
    }])) as Record<HighlightType, HighlightSettings>,
  };
}

function setDisplaySettings(display: DisplaySettings): void {
  displaySettings = display;
  boundaries.checked = display.boundaries;
  importance.checked = display.importance;
  grammar.checked = display.grammar;
  for (const control of highlightControls) {
    const setting = display.highlights[control.type];
    control.enabled.checked = setting.enabled;
    control.mode.value = setting.mode;
    control.color.value = setting.color;
    control.value.value = setting.color;
  }
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
