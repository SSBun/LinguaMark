import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const ARTICLE_PARAGRAPHS = [
  "Birds fly. She is happy. I read books. He gave me a gift. They made him captain.",
  "Dr. Smith paid $3.50. He left; his assistant stayed.",
  "This paragraph stays below the viewport and must never be sent to the model.",
];

const ANNOTATIONS = {
  paragraphs: [
    {
      id: "paragraph-0",
      sentences: [
        { quote: "Birds fly.", translation: "鸟会飞。", importance: "detail", pattern: "SV", roles: [
          { role: "subject", quote: "Birds" }, { role: "verb", quote: "fly" },
        ] },
        { quote: "She is happy.", translation: "她很开心。", importance: "supporting", pattern: "SVC", roles: [
          { role: "subject", quote: "She" }, { role: "verb", quote: "is" }, { role: "subjectComplement", quote: "happy" },
        ] },
        { quote: "I read books.", translation: "我读书。", importance: "primary", pattern: "SVO", roles: [
          { role: "subject", quote: "I" }, { role: "verb", quote: "read" }, { role: "object", quote: "books" },
        ] },
        { quote: "He gave me a gift.", translation: "他给了我一份礼物。", importance: "supporting", pattern: "SVOO", roles: [
          { role: "subject", quote: "He" }, { role: "verb", quote: "gave" }, { role: "indirectObject", quote: "me" }, { role: "directObject", quote: "gift" },
        ] },
        { quote: "They made him captain.", translation: "他们让他担任队长。", importance: "detail", pattern: "SVOC", roles: [
          { role: "subject", quote: "They" }, { role: "verb", quote: "made" }, { role: "object", quote: "him" }, { role: "objectComplement", quote: "captain" },
        ] },
      ],
    },
    {
      id: "paragraph-1",
      sentences: [
        { quote: "Dr. Smith paid $3.50.", translation: "史密斯博士支付了 3.50 美元。", importance: "primary", pattern: "SVO", roles: [
          { role: "subject", quote: "Dr. Smith" }, { role: "verb", quote: "paid" }, { role: "object", quote: "$3.50" },
        ] },
        { quote: "He left; his assistant stayed.", translation: "他离开了；他的助理留下了。", importance: "supporting", pattern: "multi", roles: [
          { role: "subject", quote: "He" }, { role: "verb", quote: "left" },
          { role: "subject", quote: "his assistant" }, { role: "verb", quote: "stayed" },
        ] },
      ],
    },
  ],
};

const contentCss = await readFile(resolve("dist/content.css"), "utf8");
for (const type of ["primary", "supporting", "detail", "subject", "verb", "object", "complement"]) {
  const textRule = contentCss.match(new RegExp(`::highlight\\(linguamark-${type}\\) \\{([^}]*)\\}`, "u"));
  assert.ok(textRule);
  assert.doesNotMatch(textRule[1], /text-decoration|background(?:-color)?\s*:/u);
  assert.match(contentCss, new RegExp(`::highlight\\(linguamark-${type}-underline\\)`, "u"));
}
assert.match(contentCss, /text-decoration-line:\s*underline/u);
const manifest = JSON.parse(await readFile(resolve("dist/manifest.json"), "utf8"));
assert.equal(manifest.commands["show-hovered-translation"].suggested_key.default, "Alt+Shift+T");
assert.equal(manifest.commands["show-hovered-translation"].suggested_key.mac, "Option+Shift+T");

const requests = [];
const responseGates = new Map();
const server = createServer(async (request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
  if (request.method === "OPTIONS") {
    response.writeHead(204).end();
    return;
  }

  if (request.url === "/article") {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(`<!doctype html>
<html><head><meta charset="utf-8"><style>body{font:18px/1.7 system-ui;margin:40px auto;max-width:760px}p{margin:24px 0}</style></head>
<body><article>
<p id="patterns">Birds fly. She is happy. I read <a id="reference" href="#reference">books</a>. He gave me a gift. They made him captain.</p>
<p id="edge">Dr. Smith paid $3.50. He left; his assistant stayed.</p>
<pre id="code-block"><code><span>let CODE_BLOCK_SENTINEL = 42</span></code></pre>
<div style="height:1200px"></div>
<p id="offscreen">This paragraph stays below the viewport and must never be sent to the model.</p>
</article><script>window.linkClicks=0;document.querySelector('#reference').addEventListener('click',event=>{event.preventDefault();window.linkClicks+=1})</script></body></html>`);
    return;
  }

  if (request.url === "/v1/chat/completions" && request.method === "POST") {
    const body = await readBody(request);
    const parsedBody = JSON.parse(body);
    requests.push({ headers: request.headers, body: parsedBody });
    const userMessage = [...parsedBody.messages].reverse().find((message) => message.role === "user");
    const requestText = JSON.stringify(userMessage);
    const analysisInput = requestText.includes('"paragraphId"')
      ? readAnalysisInput(userMessage.content)
      : requestText.includes("P:paragraph-") ? readCompactInput(userMessage.content) : undefined;
    const requestedId = analysisInput?.paragraphId;
    const gate = requestedId ? responseGates.get(requestedId) : undefined;
    if (requestedId) responseGates.delete(requestedId);
    if (gate) {
      gate.markStarted();
      await gate.waitForRelease;
    }
    const responseText = requestText.includes("Reply with OK.")
      ? "OK"
      : JSON.stringify(createIndexedResponse(analysisInput));
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    response.write(`data: ${JSON.stringify({
      id: "chatcmpl-linguamark",
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: "mock-model",
      choices: [{ index: 0, delta: { role: "assistant", content: responseText }, finish_reason: null }],
    })}\n\n`);
    response.write(`data: ${JSON.stringify({
      id: "chatcmpl-linguamark",
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: "mock-model",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    })}\n\n`);
    response.end("data: [DONE]\n\n");
    return;
  }

  response.writeHead(404).end("Not found");
});

const port = await listen(server);
const userDataDir = await mkdtemp(join(tmpdir(), "linguamark-chrome-"));
let context;

try {
  const extensionPath = resolve("dist");
  const chromePath = await findChrome();
  context = await chromium.launchPersistentContext(userDataDir, {
    executablePath: chromePath,
    headless: false,
    viewport: { width: 1200, height: 900 },
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });

  let worker = context.serviceWorkers().find((candidate) => candidate.url().startsWith("chrome-extension://"));
  worker ??= await context.waitForEvent("serviceworker", { timeout: 15_000 });
  const diagnostics = [];
  worker.on("console", (message) => diagnostics.push(`worker console: ${message.text()}`));
  context.on("weberror", (webError) => diagnostics.push(`browser error: ${webError.error().message}`));
  const extensionId = new URL(worker.url()).host;

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.selectOption("#provider", "custom");
  await options.fill("#base-url", `http://127.0.0.1:${port}/v1`);
  await options.fill("#model-id", "mock-model");
  await options.fill("#api-key", "test-secret");
  await options.click("#test-provider");
  await options.waitForFunction(() => document.querySelector("#status")?.textContent === "连接成功");
  assert.equal(requests.length, 1);
  assert.match(JSON.stringify(requests[0].body.messages), /Reply with OK\./u);
  await options.click('button[type="submit"]');
  await options.waitForFunction(() => document.querySelector("#status")?.textContent === "设置已保存");
  const optionsStyle = await options.evaluate(() => {
    const panel = getComputedStyle(document.querySelector(".glass-panel"));
    const button = getComputedStyle(document.querySelector(".primary"));
    const input = getComputedStyle(document.querySelector("#base-url"));
    return {
      backdrop: panel.backdropFilter || panel.webkitBackdropFilter,
      panelBackground: panel.backgroundColor,
      radius: panel.borderRadius,
      buttonBackground: button.backgroundImage,
      inputHeight: Number.parseFloat(input.height),
      statusSuccess: document.querySelector("#status")?.classList.contains("success"),
      hasAnalysisPanel: Boolean(document.querySelector("#analysis-title")),
      analysisConcurrency: document.querySelector("#analysis-concurrency")?.valueAsNumber,
      hasParserControlsPanel: Boolean(document.querySelector("#parser-controls-title")),
      mainContentOnlyChecked: document.querySelector("#analysis-main-content-only")?.checked,
      hasRenderPanel: Boolean(document.querySelector("#render-title")),
      hasTranslationPanel: Boolean(document.querySelector("#translation-title")),
      translationControlsInOwnPanel: document.querySelector(".translation-settings #render-translation") !== null
        && document.querySelector(".translation-settings #render-translation-hover") !== null,
      renderHasTranslationControls: document.querySelector(".render-settings #render-translation, .render-settings #render-translation-hover") !== null,
      highlightRowCount: document.querySelectorAll(".render-table tbody tr").length,
      allHighlightsEnabled: [...document.querySelectorAll(".render-enabled")].every((input) => input.checked),
      allModesText: [...document.querySelectorAll(".render-mode")].every((select) => select.value === "text"),
      previewMarkCount: document.querySelectorAll("[data-preview-importance]").length,
      previewSubjectColor: getComputedStyle(document.querySelector("[data-preview-role='subject']")).color,
      previewBoundariesHidden: [...document.querySelectorAll(".render-preview-boundary")].every((item) => item.hidden),
      fullPhrasesChecked: document.querySelector("#render-full-phrases")?.checked,
      translationChecked: document.querySelector("#render-translation")?.checked,
      translationHoverChecked: document.querySelector("#render-translation-hover")?.checked,
      accentColors: [...document.querySelector("#render-subject-preset").options].slice(1).map((option) => option.value),
      allColorControlsReady: [...document.querySelectorAll(".render-color-preset")]
        .every((select) => select.options.length === 9 && getComputedStyle(select).backgroundColor !== "rgba(0, 0, 0, 0)"),
      boundariesChecked: document.querySelector("#render-boundaries")?.checked,
      importanceChecked: document.querySelector("#render-importance")?.checked,
      grammarChecked: document.querySelector("#render-grammar")?.checked,
    };
  });
  assert.match(optionsStyle.backdrop, /blur\(48px\)/u);
  assert.match(optionsStyle.backdrop, /saturate\(1\.8\)/u);
  assert.equal(optionsStyle.panelBackground, "rgba(255, 255, 255, 0.07)");
  assert.equal(optionsStyle.radius, "24px");
  assert.match(optionsStyle.buttonBackground, /228, 184, 99/u);
  assert.ok(optionsStyle.inputHeight >= 48);
  assert.equal(optionsStyle.statusSuccess, true);
  assert.equal(optionsStyle.hasAnalysisPanel, true);
  assert.equal(optionsStyle.analysisConcurrency, 10);
  assert.equal(optionsStyle.hasParserControlsPanel, true);
  assert.equal(optionsStyle.mainContentOnlyChecked, true);
  assert.equal(optionsStyle.hasRenderPanel, true);
  assert.equal(optionsStyle.hasTranslationPanel, true);
  assert.equal(optionsStyle.translationControlsInOwnPanel, true);
  assert.equal(optionsStyle.renderHasTranslationControls, false);
  assert.equal(optionsStyle.highlightRowCount, 7);
  assert.equal(optionsStyle.allHighlightsEnabled, true);
  assert.equal(optionsStyle.allModesText, true);
  assert.ok(optionsStyle.previewMarkCount > 0);
  assert.equal(optionsStyle.previewSubjectColor, "rgb(7, 91, 198)");
  assert.equal(optionsStyle.previewBoundariesHidden, true);
  assert.equal(optionsStyle.fullPhrasesChecked, true);
  assert.equal(optionsStyle.translationChecked, true);
  assert.equal(optionsStyle.translationHoverChecked, true);
  assert.deepEqual(optionsStyle.accentColors, [
    "#0088FF", "#CB30E0", "#FF2D55", "#FF383C", "#FF8D28", "#FFCC00", "#34C759", "#98989D",
  ]);
  assert.equal(optionsStyle.allColorControlsReady, true);
  assert.equal(optionsStyle.boundariesChecked, false);
  assert.equal(optionsStyle.importanceChecked, true);
  assert.equal(optionsStyle.grammarChecked, true);
  await options.fill("#analysis-concurrency", "7");
  await options.locator("#analysis-concurrency").blur();
  await options.waitForFunction(async () => (await chrome.storage.local.get("displaySettings")).displaySettings.analysisConcurrency === 7);
  await options.uncheck("#analysis-main-content-only");
  await options.waitForFunction(async () => (await chrome.storage.local.get("displaySettings")).displaySettings.mainContentOnly === false);
  await options.check("#analysis-main-content-only");
  await options.uncheck("#render-full-phrases");
  await options.waitForFunction(() => getComputedStyle(document.querySelector("[data-preview-phrase-only]")).color === "rgb(138, 90, 0)");
  assert.equal(await options.evaluate(async () => (await chrome.storage.local.get("displaySettings")).displaySettings.fullPhrases), false);
  await options.check("#render-full-phrases");
  await options.waitForFunction(() => getComputedStyle(document.querySelector("[data-preview-phrase-only]")).color === "rgb(7, 91, 198)");
  await options.uncheck("#render-translation");
  await options.waitForFunction(async () => (await chrome.storage.local.get("displaySettings")).displaySettings.translation === false);
  await options.check("#render-translation");
  await options.uncheck("#render-translation-hover");
  await options.waitForFunction(async () => (await chrome.storage.local.get("displaySettings")).displaySettings.translationHover === false);
  await options.check("#render-translation-hover");

  const article = await context.newPage();
  await article.goto(`http://127.0.0.1:${port}/article`);
  await article.bringToFront();
  await article.waitForTimeout(500);

  const popup = await context.newPage();
  popup.on("console", (message) => diagnostics.push(`popup console: ${message.text()}`));
  popup.on("pageerror", (error) => diagnostics.push(`popup error: ${error.message}`));
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  const popupStyle = await popup.evaluate(() => {
    const button = getComputedStyle(document.querySelector("#analyze"));
    const toggle = getComputedStyle(document.querySelector("#boundaries"));
    const panel = document.querySelector(".popup-panel").getBoundingClientRect();
    return {
      buttonHeight: Number.parseFloat(button.height),
      buttonBackground: button.backgroundImage,
      toggleWidth: Number.parseFloat(toggle.width),
      toggleHeight: Number.parseFloat(toggle.height),
      panelLeft: panel.left,
      panelTop: panel.top,
      panelWidth: panel.width,
      bodyWidth: document.body.getBoundingClientRect().width,
      panelRadius: getComputedStyle(document.querySelector(".popup-panel")).borderRadius,
      shellRadius: getComputedStyle(document.querySelector(".popup-shell")).borderRadius,
    };
  });
  assert.ok(popupStyle.buttonHeight >= 48);
  assert.match(popupStyle.buttonBackground, /228, 184, 99/u);
  assert.equal(popupStyle.toggleWidth, 46);
  assert.equal(popupStyle.toggleHeight, 28);
  assert.equal(popupStyle.panelLeft, 0);
  assert.equal(popupStyle.panelTop, 0);
  assert.equal(popupStyle.panelWidth, popupStyle.bodyWidth);
  assert.equal(popupStyle.panelRadius, "0px");
  assert.equal(popupStyle.shellRadius, "0px");
  await popup.keyboard.press("Tab");
  assert.notEqual(await popup.evaluate(() => document.activeElement?.tagName), "BODY");
  const secondParagraphGate = holdParagraphResponse("paragraph-1");
  await popup.click("#analyze");
  await secondParagraphGate.started;
  await article.waitForFunction(() => CSS.highlights.get("linguamark-subject")?.size === 5);
  await popup.waitForFunction(() => document.querySelector("#status")?.textContent?.includes("已解析 5/7 句"));
  const incrementalSubjects = await article.evaluate(() => {
    const highlight = CSS.highlights.get("linguamark-subject");
    return highlight ? Array.from(highlight).map((range) => range.toString()) : [];
  });
  assert.deepEqual(incrementalSubjects, ["Birds", "She", "I", "He", "They"]);
  assert.match(await popup.textContent("#status") ?? "", /已解析 5\/7 句/u);
  secondParagraphGate.release();
  await popup.waitForFunction(() => document.querySelector("#status")?.textContent?.includes("已标记 7/7 句"), null, { timeout: 20_000 });
  const popupStatus = await popup.textContent("#status");
  assert.match(popupStatus ?? "", /已标记 7\/7 句/u, diagnostics.join("\n"));

  const rendered = await article.evaluate((expected) => {
    const highlightText = (name) => {
      const highlight = CSS.highlights.get(name);
      return highlight ? Array.from(highlight).map((range) => range.toString()) : [];
    };
    const separatorNodes = [...document.querySelectorAll(".linguamark-boundary")];
    return {
      paragraphs: [...document.querySelectorAll("article p")].map((paragraph) => paragraph.textContent),
      separatorCount: separatorNodes.length,
      separatorsAreEmpty: separatorNodes.every((node) => node.textContent === ""),
      separatorsHidden: separatorNodes.every((node) => node.hidden),
      separatorGlyph: separatorNodes[0] ? getComputedStyle(separatorNodes[0], "::after").content : "",
      subjects: highlightText("linguamark-subject"),
      verbs: highlightText("linguamark-verb"),
      primaryCount: highlightText("linguamark-primary").length,
      supportingCount: highlightText("linguamark-supporting").length,
      apiKeyInDom: document.documentElement.innerHTML.includes("test-secret"),
      matchesExpected: expected.every((text, index) => document.querySelectorAll("article p")[index]?.textContent === text),
    };
  }, ARTICLE_PARAGRAPHS);

  assert.equal(rendered.matchesExpected, true);
  assert.deepEqual(rendered.paragraphs, ARTICLE_PARAGRAPHS);
  assert.equal(rendered.separatorCount, 5);
  assert.equal(rendered.separatorsAreEmpty, true);
  assert.equal(rendered.separatorsHidden, true);
  assert.match(rendered.separatorGlyph, /│/u);
  assert.deepEqual(rendered.subjects, ["Birds", "She", "I", "He", "They", "Dr. Smith", "He", "his assistant"]);
  assert.deepEqual(rendered.verbs, ["fly", "is", "read", "gave", "made", "paid", "left", "stayed"]);
  assert.equal(rendered.primaryCount, 2);
  assert.equal(rendered.supportingCount, 3);
  assert.equal(rendered.apiKeyInDom, false);
  assert.doesNotMatch(JSON.stringify(requests.slice(1).map((request) => request.body.messages)), /CODE_BLOCK_SENTINEL/u);

  const firstSentencePoint = await article.evaluate(() => {
    const text = document.querySelector("#patterns").firstChild;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, "Birds fly.".length);
    const rect = range.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await article.mouse.move(firstSentencePoint.x, firstSentencePoint.y);
  await article.waitForFunction(() => document.querySelector(".linguamark-translation:not([hidden])")?.textContent === "鸟会飞。");
  const translatedSentencePlacement = await article.evaluate(() => {
    const text = document.querySelector("#edge").firstChild;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, "Dr. Smith paid $3.50.".length);
    const rect = range.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await article.mouse.move(translatedSentencePlacement.x, translatedSentencePlacement.y);
  await article.waitForFunction(() => document.querySelector(".linguamark-translation:not([hidden])")?.textContent === "史密斯博士支付了 3.50 美元。");
  const translationPlacement = await article.evaluate(() => {
    const text = document.querySelector("#edge").firstChild;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, "Dr. Smith paid $3.50.".length);
    const sentence = range.getBoundingClientRect();
    const tooltip = document.querySelector(".linguamark-translation").getBoundingClientRect();
    return {
      sentenceTop: sentence.top,
      sentenceCenter: sentence.left + sentence.width / 2,
      tooltipBottom: tooltip.bottom,
      tooltipCenter: tooltip.left + tooltip.width / 2,
    };
  });
  assert.ok(translationPlacement.tooltipBottom <= translationPlacement.sentenceTop);
  assert.ok(Math.abs(translationPlacement.tooltipCenter - translationPlacement.sentenceCenter) < 1);
  await article.mouse.move(2, 2);
  await article.waitForFunction(() => document.querySelector(".linguamark-translation")?.hidden === true);

  const selectedText = await article.evaluate(() => {
    const selection = getSelection();
    const range = document.createRange();
    range.selectNodeContents(document.querySelector("article"));
    selection.removeAllRanges();
    selection.addRange(range);
    const text = selection.toString();
    selection.removeAllRanges();
    return text;
  });
  assert.equal(selectedText.includes("│"), false);
  assert.match(selectedText, /Birds fly\.[\s\S]*Dr\. Smith paid \$3\.50\./u);

  await article.click("#reference");
  assert.equal(await article.evaluate(() => window.linkClicks), 1);

  await options.bringToFront();
  await options.uncheck("#render-subject-enabled");
  await article.waitForFunction(() => !CSS.highlights.has("linguamark-subject"));
  await options.check("#render-subject-enabled");
  await article.waitForFunction(() => CSS.highlights.has("linguamark-subject"));
  await options.selectOption("#render-subject-preset", "#FF383C");
  await article.waitForFunction(() => getComputedStyle(document.documentElement)
    .getPropertyValue("--linguamark-subject-color").trim() === "#FF383C");
  assert.equal(await options.inputValue("#render-subject-color"), "#FF383C");
  await options.fill("#render-subject-color", "#123456");
  await article.waitForFunction(() => getComputedStyle(document.documentElement)
    .getPropertyValue("--linguamark-subject-color").trim() === "#123456");
  assert.equal(await options.inputValue("#render-subject-preset"), "");
  await options.selectOption("#render-subject-mode", "underline");
  await article.waitForFunction(() => CSS.highlights.has("linguamark-subject-underline")
    && !CSS.highlights.has("linguamark-subject"));
  await options.waitForFunction(() => {
    const style = getComputedStyle(document.querySelector("[data-preview-role='subject']"));
    return style.textDecorationLine.includes("underline") && style.textDecorationColor === "rgb(18, 52, 86)";
  });
  await options.selectOption("#render-subject-mode", "text");
  await article.waitForFunction(() => CSS.highlights.has("linguamark-subject")
    && !CSS.highlights.has("linguamark-subject-underline"));

  await popup.bringToFront();
  await popup.uncheck("#grammar");
  await article.waitForFunction(() => !CSS.highlights.has("linguamark-subject"));
  await popup.uncheck("#importance");
  await article.waitForFunction(() => !CSS.highlights.has("linguamark-primary"));
  await popup.uncheck("#boundaries");
  await article.waitForFunction(() => [...document.querySelectorAll(".linguamark-boundary")].every((node) => node.hidden));

  await popup.check("#grammar");
  await popup.check("#importance");
  await popup.check("#boundaries");
  await article.waitForFunction(() => CSS.highlights.has("linguamark-subject") && CSS.highlights.has("linguamark-primary"));

  assert.equal(requests.length, 3);
  assert.equal(requests[1].headers.authorization, "Bearer test-secret");
  assert.equal(requests[2].headers.authorization, "Bearer test-secret");
  assert.equal(requests[1].body.model, "mock-model");
  assert.equal(requests[2].body.model, "mock-model");
  const firstRequestText = JSON.stringify(requests[1].body.messages);
  const secondRequestText = JSON.stringify(requests[2].body.messages);
  assert.match(firstRequestText, /Birds fly\./u);
  assert.doesNotMatch(firstRequestText, /Dr\. Smith paid \$3\.50\./u);
  assert.match(secondRequestText, /Dr\. Smith paid \$3\.50\./u);
  assert.doesNotMatch(secondRequestText, /Birds fly\./u);
  assert.doesNotMatch(`${firstRequestText}${secondRequestText}`, /below the viewport/u);

  const staleGate = holdParagraphResponse("paragraph-0");
  await popup.bringToFront();
  await popup.click("#analyze");
  await staleGate.started;
  await article.evaluate(() => {
    const text = document.querySelector("#patterns").firstChild;
    text.data = `Changed ${text.data}`;
  });
  staleGate.release();
  await popup.waitForFunction(() => document.querySelector("#status")?.textContent?.includes("已标记 2/7 句"), null, { timeout: 20_000 });
  const subjectsAfterStaleResponse = await article.evaluate(() => {
    const highlight = CSS.highlights.get("linguamark-subject");
    return highlight ? Array.from(highlight).map((range) => range.toString()) : [];
  });
  assert.deepEqual(subjectsAfterStaleResponse, ["Birds", "She", "I", "He", "They", "Dr. Smith", "He", "his assistant"]);
  assert.equal(requests.length, 6);

  console.log(`Chrome E2E passed with extension ${extensionId}`);
} finally {
  await context?.close();
  await new Promise((resolvePromise) => server.close(resolvePromise));
  await rm(userDataDir, { recursive: true, force: true });
}

function readAnalysisInput(content) {
  const text = typeof content === "string" ? content : JSON.stringify(content);
  const start = text.lastIndexOf('{"paragraphId"');
  if (start < 0) throw new Error("模型请求缺少本地索引输入");
  return { ...JSON.parse(text.slice(start)), format: "verbose" };
}

function readCompactInput(content) {
  const text = typeof content === "string" ? content : JSON.stringify(content);
  const lines = text.split("\n");
  const paragraphId = lines.find((line) => line.startsWith("P:"))?.slice(2);
  if (!paragraphId) throw new Error("紧凑模型请求缺少段落 ID");
  const sentences = lines.filter((line) => /^S\d+:/u.test(line)).map((line) => {
    const match = line.match(/^S(\d+):(.*)$/u);
    const sentenceText = match[2].replace(/\[\d+\]/gu, "");
    const id = `s${match[1]}`;
    const tokens = [...new Intl.Segmenter("en", { granularity: "word" }).segment(sentenceText)]
      .filter((item) => !/^\s*$/u.test(item.segment))
      .map((item, index) => ({ id: `${id}t${index}`, text: item.segment }));
    return { id, text: sentenceText, tokens };
  });
  return { paragraphId, sentences, format: "compact" };
}

function createIndexedResponse(input) {
  const annotation = ANNOTATIONS.paragraphs.find((item) => item.id === input?.paragraphId);
  if (!annotation) return input?.format === "compact" ? { s: [] } : { sentences: [] };
  const sentences = annotation.sentences.map((sentence, index) => {
    const indexed = input.sentences[index];
    return {
      id: indexed.id,
      importance: sentence.importance,
      pattern: sentence.pattern,
      roles: sentence.roles.map((role) => ({
        role: role.role,
        tokenIds: tokenIdsForQuote(indexed, role.quote),
      })),
      translation: sentence.translation,
    };
  });
  if (input.format !== "compact") return { sentences };
  const roleCodes = {
    subject: "S", verb: "V", object: "O", indirectObject: "IO", directObject: "DO",
    subjectComplement: "SC", objectComplement: "OC",
  };
  return {
    s: sentences.map((sentence) => [
      sentence.id.slice(1),
      sentence.importance[0],
      sentence.pattern,
      sentence.roles.map((role) => [
        roleCodes[role.role],
        role.tokenIds.map((id) => id.replace(/^s\d+t/u, "")),
      ]),
      sentence.translation,
    ]),
  };
}

function tokenIdsForQuote(sentence, quote) {
  const expected = [...new Intl.Segmenter("en", { granularity: "word" }).segment(quote)]
    .map((item) => item.segment)
    .filter((item) => !/^\s*$/u.test(item));
  for (let start = 0; start <= sentence.tokens.length - expected.length; start += 1) {
    if (expected.every((text, index) => sentence.tokens[start + index].text === text)) {
      return sentence.tokens.slice(start, start + expected.length).map((token) => token.id);
    }
  }
  throw new Error(`找不到角色词元：${quote}`);
}

function holdParagraphResponse(paragraphId) {
  let markStarted;
  let release;
  const started = new Promise((resolvePromise) => { markStarted = resolvePromise; });
  const waitForRelease = new Promise((resolvePromise) => { release = resolvePromise; });
  responseGates.set(paragraphId, { markStarted, waitForRelease });
  return { started, release };
}

async function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    chromium.executablePath(),
    "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next installed Chrome binary.
    }
  }
  throw new Error("未找到可用于扩展自动化测试的 Chrome");
}

function listen(httpServer) {
  return new Promise((resolvePromise, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(0, "127.0.0.1", () => resolvePromise(httpServer.address().port));
  });
}

function readBody(request) {
  return new Promise((resolvePromise, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => resolvePromise(body));
    request.on("error", reject);
  });
}
