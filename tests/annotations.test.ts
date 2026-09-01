import assert from "node:assert/strict";
import test from "node:test";
import {
  createRenderPlan,
  indexParagraph,
  learningItemKey,
  parseIndexedAnnotationJson,
  PROVIDER_PRESETS,
  readDisplaySettings,
  readLearningFavorites,
  type ParagraphAnnotation,
  type RoleAnnotation,
  type SentenceAnnotation,
  type SentencePattern,
} from "../src/contracts.ts";
import {
  compactMarkedParsingAdapter,
  DEFAULT_PARSING_ADAPTER,
  jsonTokenParsingAdapter,
} from "../src/parsing.ts";

test("DeepSeek 预设默认使用 V4 Flash", () => {
  assert.equal(PROVIDER_PRESETS.deepseek.modelId, "deepseek-v4-flash");
});

test("旧显示设置默认开启 30% 预加载、完整短语与翻译，并可读取显式设置", () => {
  const legacy = readDisplaySettings({ highlights: { subject: { enabled: true, color: "#123456" } } });
  const explicit = readDisplaySettings({
    analysisConcurrency: 7,
    mainContentOnly: false,
    preload: false,
    preloadPercent: 75,
    fullPhrases: false,
    translation: false,
    translationHover: false,
    highlights: { subject: { enabled: true, color: "#123456", mode: "underline" } },
  });
  assert.equal(legacy.highlights.subject.mode, "text");
  assert.equal(legacy.analysisConcurrency, 10);
  assert.equal(legacy.mainContentOnly, true);
  assert.equal(legacy.preload, true);
  assert.equal(legacy.preloadPercent, 30);
  assert.equal(legacy.fullPhrases, true);
  assert.equal(legacy.translation, true);
  assert.equal(legacy.translationHover, true);
  assert.equal(explicit.highlights.subject.mode, "underline");
  assert.equal(explicit.analysisConcurrency, 7);
  assert.equal(explicit.mainContentOnly, false);
  assert.equal(explicit.preload, false);
  assert.equal(explicit.preloadPercent, 75);
  assert.equal(explicit.fullPhrases, false);
  assert.equal(explicit.translation, false);
  assert.equal(explicit.translationHover, false);
  assert.equal(readDisplaySettings({ analysisConcurrency: 0 }).analysisConcurrency, 10);
  assert.equal(readDisplaySettings({ analysisConcurrency: 21 }).analysisConcurrency, 10);
  assert.equal(readDisplaySettings({ analysisConcurrency: 1.5 }).analysisConcurrency, 10);
});

function sentence(
  quote: string,
  pattern: SentencePattern,
  roles: RoleAnnotation[],
  importance: SentenceAnnotation["importance"] = "supporting",
): SentenceAnnotation {
  return { quote, translation: "测试翻译", pattern, roles, importance };
}

test("五大句型生成不重叠的角色范围和四个句界", () => {
  const source = "Birds fly. She is happy. I read books. He gave me a gift. They made him captain.";
  const annotation: ParagraphAnnotation = {
    id: "paragraph-0",
    sentences: [
      sentence("Birds fly.", "SV", [
        { role: "subject", quote: "Birds" },
        { role: "verb", quote: "fly" },
      ], "detail"),
      sentence("She is happy.", "SVC", [
        { role: "subject", quote: "She" },
        { role: "verb", quote: "is" },
        { role: "subjectComplement", quote: "happy" },
      ]),
      sentence("I read books.", "SVO", [
        { role: "subject", quote: "I" },
        { role: "verb", quote: "read" },
        { role: "object", quote: "books" },
      ], "primary"),
      sentence("He gave me a gift.", "SVOO", [
        { role: "subject", quote: "He" },
        { role: "verb", quote: "gave" },
        { role: "indirectObject", quote: "me" },
        { role: "directObject", quote: "gift" },
      ]),
      sentence("They made him captain.", "SVOC", [
        { role: "subject", quote: "They" },
        { role: "verb", quote: "made" },
        { role: "object", quote: "him" },
        { role: "objectComplement", quote: "captain" },
      ], "detail"),
    ],
  };

  const plan = createRenderPlan(source, annotation);
  assert.ok(plan);
  assert.equal(plan.boundaries.length, 4);
  assert.equal(plan.roles.length, 16);
  assert.equal(plan.warnings.length, 0);
  assert.deepEqual(
    plan.roles.map((range) => source.slice(range.start, range.end)),
    ["Birds", "fly", "She", "is", "happy", "I", "read", "books", "He", "gave", "me", "gift", "They", "made", "him", "captain"],
  );
});

test("multi 句型渲染多个互不重叠的顶层分句角色", () => {
  const source = "Birds fly, and fish swim.";
  const annotation: ParagraphAnnotation = {
    id: "paragraph-multi",
    sentences: [sentence(source, "multi", [
      { role: "subject", quote: "Birds" },
      { role: "verb", quote: "fly" },
      { role: "subject", quote: "fish" },
      { role: "verb", quote: "swim" },
    ], "primary")],
  };

  const plan = createRenderPlan(source, annotation);
  assert.ok(plan);
  assert.equal(plan.warnings.length, 0);
  assert.deepEqual(plan.roles.map((range) => source.slice(range.start, range.end)), ["Birds", "fly", "fish", "swim"]);
});

test("multi 使用词元位置区分重复的分句主语", () => {
  const source = "They work, and they rest.";
  const indexed = indexParagraph({ id: "paragraph-repeat", text: source });
  const annotation = compactMarkedParsingAdapter.parseResponse(
    '{"s":[["0","p","M",[["S",["0"]],["V",["1"]],["S",["4"]],["V",["5"]]],"他们工作，而他们休息。"]]}',
    indexed,
  );
  const plan = createRenderPlan(source, annotation);
  assert.ok(plan);
  assert.deepEqual(plan.roles.map((range) => source.slice(range.start, range.end)), ["They", "work", "they", "rest"]);
});

test("学习卡片条目只保留原文引用并按类型和文本去重", () => {
  const source = "Resilient teams bounce back under pressure.";
  const indexed = indexParagraph({ id: "paragraph-learning", text: source });
  const annotation = compactMarkedParsingAdapter.parseResponse(
    `{"s":[["0","p","SV",[["S",["0","1"]],["V",["2","3"]]],"有韧性的团队能在压力下恢复。"]],"l":[["W","Resilient","有韧性的"],["W","Resilient","有韧性的"],["W","invented","原文中不存在"],["P","bounce back","恢复；重新振作"],["C","${source}","主语加动词短语的常用句式"]]}`,
    indexed,
  );

  assert.deepEqual(annotation.learningItems?.map((item) => item.text), ["Resilient", "bounce back", source]);
  assert.equal(
    learningItemKey({ kind: "phrase", text: " Bounce   Back " }),
    learningItemKey({ kind: "phrase", text: "bounce back" }),
  );
});

test("收藏读取保留首次日期、兼容旧数据并按规范化文本去重", () => {
  const favorites = readLearningFavorites([
    { kind: "vocabulary", text: "Resilient", note: "有韧性的", collectedAt: 2_000 },
    { kind: "vocabulary", text: " resilient ", note: "重复项", collectedAt: 3_000 },
    { kind: "phrase", text: "bounce back", note: "恢复；重新振作" },
    { kind: "unknown", text: "ignored", note: "无效类型" },
  ]);

  assert.equal(favorites.length, 2);
  assert.equal(favorites[0].collectedAt, 2_000);
  assert.equal(favorites[1].collectedAt, undefined);
});

test("缩写、小数和分号由完整句子引用决定", () => {
  const source = "Dr. Smith paid $3.50. He left; his assistant stayed.";
  const annotation: ParagraphAnnotation = {
    id: "paragraph-1",
    sentences: [
      sentence("Dr. Smith paid $3.50.", "SVO", [
        { role: "subject", quote: "Dr. Smith" },
        { role: "verb", quote: "paid" },
        { role: "object", quote: "$3.50" },
      ], "primary"),
      sentence("He left; his assistant stayed.", "multi", [
        { role: "subject", quote: "He" },
        { role: "verb", quote: "left" },
        { role: "subject", quote: "his assistant" },
        { role: "verb", quote: "stayed" },
      ]),
    ],
  };

  const plan = createRenderPlan(source, annotation);
  assert.ok(plan);
  assert.equal(plan.boundaries.length, 1);
  assert.equal(source.slice(plan.boundaries[0] - 1, plan.boundaries[0] + 2), ". H");
  assert.equal(plan.roles.length, 7);
});

test("角色重叠时只降级该句的句法层", () => {
  const source = "I read books.";
  const annotation: ParagraphAnnotation = {
    id: "paragraph-0",
    sentences: [sentence("I read books.", "SVO", [
      { role: "subject", quote: "I" },
      { role: "verb", quote: "read" },
      { role: "object", quote: "read books" },
    ], "primary")],
  };

  const plan = createRenderPlan(source, annotation);
  assert.ok(plan);
  assert.equal(plan.roles.length, 0);
  assert.equal(plan.importance.length, 1);
  assert.equal(plan.warnings.length, 1);
});

test("句子引用未覆盖非空白原文时整段拒绝", () => {
  const annotation: ParagraphAnnotation = {
    id: "paragraph-0",
    sentences: [
      sentence("One.", "fragment", []),
      sentence("Two.", "fragment", []),
    ],
  };
  assert.equal(createRenderPlan("One. omitted Two.", annotation), undefined);
});

test("本地分句保留缩写、小数、引号报告句和分号", () => {
  const indexed = indexParagraph({
    id: "paragraph-0",
    text: "Dr. Smith paid $3.50. “Is careful reading really slower?” she asked. He left; his assistant stayed.",
  });
  assert.deepEqual(indexed.sentences.map((item) => item.quote), [
    "Dr. Smith paid $3.50.",
    "“Is careful reading really slower?” she asked.",
    "He left; his assistant stayed.",
  ]);
});

test("模型返回句子 ID、角色和翻译，本地重建精确引用与单句 primary", () => {
  const indexed = indexParagraph({ id: "paragraph-0", text: "Birds fly." });
  const annotation = parseIndexedAnnotationJson(`
{"sentences":[{"id":"s0","importance":"supporting","pattern":"SV","roles":[{"role":"subject","tokenIds":["s0t0"]},{"role":"verb","tokenIds":["s0t1"]}],"translation":"鸟会飞。"}]}
`, indexed);
  assert.equal(annotation.sentences[0].quote, "Birds fly.");
  assert.equal(annotation.sentences[0].translation, "鸟会飞。");
  assert.equal(annotation.sentences[0].importance, "primary");
  assert.deepEqual(annotation.sentences[0].roles, [
    { role: "subject", quote: "Birds" },
    { role: "verb", quote: "fly" },
  ]);
});

test("完整句子的空角色、非法句型和缺失翻译会被拒绝，文本片段可为空", () => {
  const sentence = indexParagraph({ id: "paragraph-0", text: "Birds fly." });
  assert.throws(() => parseIndexedAnnotationJson(
    '{"sentences":[{"id":"s0","importance":"primary","pattern":"SV","roles":[],"translation":"鸟会飞。"}]}',
    sentence,
  ), /不完整的句法角色/u);
  assert.throws(() => parseIndexedAnnotationJson(
    '{"sentences":[{"id":"s0","importance":"primary","pattern":"SVA","roles":[],"translation":"鸟会飞。"}]}',
    sentence,
  ), /无效句型/u);
  assert.throws(() => parseIndexedAnnotationJson(
    '{"sentences":[{"id":"s0","importance":"primary","pattern":"SV","roles":[{"role":"subject","tokenIds":["s0t0"]},{"role":"verb","tokenIds":["s0t1"]}]}]}',
    sentence,
  ), /未返回句子翻译/u);

  assert.throws(() => parseIndexedAnnotationJson(
    '{"sentences":[{"id":"s0","importance":"detail","pattern":"fragment","roles":[],"translation":"每周石油库存水平"}]}',
    sentence,
  ), /错误降级为片段/u);

  const fragment = indexParagraph({ id: "paragraph-1", text: "Weekly oil stock levels", requireRoles: false });
  const annotation = parseIndexedAnnotationJson(
    '{"sentences":[{"id":"s0","importance":"detail","pattern":"fragment","roles":[],"translation":"每周石油库存水平"}]}',
    fragment,
  );
  assert.equal(annotation.sentences[0].pattern, "fragment");
  assert.deepEqual(annotation.sentences[0].roles, []);

  const uncertain = indexParagraph({ id: "paragraph-2", text: "Go!" });
  const fallback = parseIndexedAnnotationJson(
    '{"sentences":[{"id":"s0","importance":"primary","pattern":"unclassified","roles":[{"role":"verb","tokenIds":["s0t0"]}],"translation":"走！"}]}',
    uncertain,
  );
  assert.deepEqual(fallback.sentences[0].roles.map((role) => role.quote), ["Go"]);
});

test("已有谓语但句型角色不完整时保守降级并保留可见角色", () => {
  const source = "People build tools.";
  const indexed = indexParagraph({ id: "paragraph-degraded", text: source });
  const annotation = compactMarkedParsingAdapter.parseResponse(
    '{"s":[["0","p","SVO",[["S",["0"]],["V",["1"]]],"人们构建工具。"]]}',
    indexed,
  );
  assert.equal(annotation.sentences[0].pattern, "unclassified");
  assert.deepEqual(annotation.sentences[0].roles.map((role) => role.quote), ["People", "build"]);
  const plan = createRenderPlan(source, annotation);
  assert.ok(plan);
  assert.equal(plan.warnings.length, 1);
  assert.deepEqual(plan.roles.map((range) => source.slice(range.start, range.end)), ["People", "build"]);
});

test("可恢复解析保留有效句并只报告缺失句", () => {
  const source = "Birds fly. People build tools.";
  const indexed = indexParagraph({ id: "paragraph-recovery", text: source });
  const partial = compactMarkedParsingAdapter.parseRecoverableResponse(
    '{"s":[["0","p","SV",[["S",["0"]],["V",["1"]]],"鸟会飞。"]],"l":[]}',
    indexed,
  );

  assert.deepEqual(partial.sentences.map((item) => item.id), ["s0"]);
  assert.deepEqual(partial.failedSentences?.map((item) => item.id), ["s1"]);
  const plan = createRenderPlan(source, partial);
  assert.ok(plan);
  assert.equal(plan.importance.length, 1);
  assert.equal(source.slice(plan.importance[0].start, plan.importance[0].end), "Birds fly.");
  assert.throws(() => compactMarkedParsingAdapter.parseResponse(
    '{"s":[["0","p","SV",[["S",["0"]],["V",["1"]]],"鸟会飞。"]],"l":[]}',
    indexed,
  ), /没有返回全部句子/u);

  const recovered = compactMarkedParsingAdapter.parseRecoverableResponse(
    '{"s":[["1","s","SVO",[["S",["0"]],["V",["1"]],["O",["2"]]],"人们制造工具。"]],"l":[]}',
    indexed,
    ["s1"],
  );
  assert.deepEqual(recovered.sentences.map((item) => item.id), ["s1"]);
  assert.equal(recovered.failedSentences, undefined);
});

test("JSON 与紧凑 Adapter 共享索引并遵循短语和翻译设置", () => {
  const indexed = indexParagraph({ id: "paragraph-0", text: "Birds fly." });
  const withoutTranslation = indexParagraph({ id: "paragraph-0", text: "Birds fly." }, false);
  const jsonRequest = jsonTokenParsingAdapter.createRequest(indexed, "deepseek");
  const compactRequest = compactMarkedParsingAdapter.createRequest(indexed, "deepseek");
  const jsonCoreRequest = jsonTokenParsingAdapter.createRequest(indexed, "deepseek", false);
  const compactCoreRequest = compactMarkedParsingAdapter.createRequest(indexed, "deepseek", false);
  const jsonWithoutTranslation = jsonTokenParsingAdapter.createRequest(withoutTranslation, "deepseek");
  const compactWithoutTranslation = compactMarkedParsingAdapter.createRequest(withoutTranslation, "deepseek");
  assert.deepEqual(jsonRequest.samplingParams.thinking, { type: "disabled" });
  assert.match(compactRequest.userPrompt, /^P:paragraph-0\nR:1\n/u);
  assert.match(compactRequest.userPrompt, /S0:\[0\]Birds \[1\]fly\[2\]\./u);
  assert.match(jsonRequest.systemPrompt, /complete contiguous phrase/u);
  assert.match(compactRequest.systemPrompt, /subject Modern readers/u);
  assert.match(compactRequest.systemPrompt, /Pattern codes: M=multi/u);
  assert.match(jsonCoreRequest.systemPrompt, /head nouns/u);
  assert.match(compactCoreRequest.systemPrompt, /subject readers/u);
  assert.match(compactRequest.systemPrompt, /Simplified Chinese/u);
  assert.match(jsonWithoutTranslation.systemPrompt, /Translation is disabled/u);
  assert.match(compactWithoutTranslation.systemPrompt, /Translation is disabled/u);
  assert.doesNotMatch(jsonWithoutTranslation.systemPrompt, /简体中文翻译/u);
  assert.doesNotMatch(compactWithoutTranslation.systemPrompt, /鸟会飞/u);

  const verbose = jsonTokenParsingAdapter.parseResponse(
    '{"sentences":[{"id":"s0","importance":"primary","pattern":"SV","roles":[{"role":"subject","tokenIds":["s0t0"]},{"role":"verb","tokenIds":["s0t1"]}],"translation":"鸟会飞。"}]}',
    indexed,
  );
  const compact = compactMarkedParsingAdapter.parseResponse(
    '{"s":[["0","p","SV",[["S",["0"]],["V",["1"]]],"鸟会飞。"]]}',
    indexed,
  );
  assert.deepEqual(compact, verbose);
  const untranslatedVerbose = jsonTokenParsingAdapter.parseResponse(
    '{"sentences":[{"id":"s0","importance":"primary","pattern":"SV","roles":[{"role":"subject","tokenIds":["s0t0"]},{"role":"verb","tokenIds":["s0t1"]}]}]}',
    withoutTranslation,
  );
  const untranslated = compactMarkedParsingAdapter.parseResponse(
    '{"s":[["0","p","SV",[["S",["0"]],["V",["1"]]]]]}',
    withoutTranslation,
  );
  assert.deepEqual(untranslated, untranslatedVerbose);
  assert.equal(untranslated.sentences[0].translation, undefined);
  assert.equal(DEFAULT_PARSING_ADAPTER.id, "compact-marked");
});

test("本地词元拆分缩约词，紧凑 Adapter 保留分号两侧角色", () => {
  const question = indexParagraph({ id: "paragraph-0", text: "What's your name?" });
  assert.deepEqual(question.sentences[0].tokens.map((token) => token.text), ["What", "'s", "your", "name", "?"]);

  const compound = indexParagraph({ id: "paragraph-1", text: "He left; his assistant stayed." });
  const annotation = compactMarkedParsingAdapter.parseResponse(
    '{"s":[["0","p","M",[["S",["0"]],["V",["1"]],["S",["3","4"]],["V",["5"]]],"他离开了；他的助理留下了。"]]}',
    compound,
  );
  assert.equal(annotation.sentences[0].pattern, "multi");
  assert.deepEqual(annotation.sentences[0].roles.map((role) => role.quote), ["He", "left", "his assistant", "stayed"]);
});
