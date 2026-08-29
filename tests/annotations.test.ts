import assert from "node:assert/strict";
import test from "node:test";
import {
  createRenderPlan,
  indexParagraph,
  parseIndexedAnnotationJson,
  PROVIDER_PRESETS,
  readDisplaySettings,
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

test("旧高亮设置默认文字变色，并可读取彩色下划线模式", () => {
  const legacy = readDisplaySettings({ highlights: { subject: { enabled: true, color: "#123456" } } });
  const underline = readDisplaySettings({ highlights: { subject: { enabled: true, color: "#123456", mode: "underline" } } });
  assert.equal(legacy.highlights.subject.mode, "text");
  assert.equal(underline.highlights.subject.mode, "underline");
});

function sentence(
  quote: string,
  pattern: SentencePattern,
  roles: RoleAnnotation[],
  importance: SentenceAnnotation["importance"] = "supporting",
): SentenceAnnotation {
  return { quote, pattern, roles, importance };
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
      sentence("He left; his assistant stayed.", "unclassified", []),
    ],
  };

  const plan = createRenderPlan(source, annotation);
  assert.ok(plan);
  assert.equal(plan.boundaries.length, 1);
  assert.equal(source.slice(plan.boundaries[0] - 1, plan.boundaries[0] + 2), ". H");
  assert.equal(plan.roles.length, 3);
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
      sentence("One.", "unclassified", []),
      sentence("Two.", "unclassified", []),
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

test("模型只返回句子和词元 ID，本地重建精确引用与单句 primary", () => {
  const indexed = indexParagraph({ id: "paragraph-0", text: "Birds fly." });
  const annotation = parseIndexedAnnotationJson(`
{"sentences":[{"id":"s0","importance":"supporting","pattern":"SV","roles":[{"role":"subject","tokenIds":["s0t0"]},{"role":"verb","tokenIds":["s0t1"]}]}]}
`, indexed);
  assert.equal(annotation.sentences[0].quote, "Birds fly.");
  assert.equal(annotation.sentences[0].importance, "primary");
  assert.deepEqual(annotation.sentences[0].roles, [
    { role: "subject", quote: "Birds" },
    { role: "verb", quote: "fly" },
  ]);
});

test("说明文字中的 ID 响应可提取，非法枚举和未知词元安全降级", () => {
  const indexed = indexParagraph({ id: "paragraph-0", text: "Birds fly. She is happy." });
  const annotation = parseIndexedAnnotationJson(`Result:
{"sentences":[{"id":"s0","importance":"urgent","pattern":"SVA","roles":[{"role":"subject","tokenIds":["missing"]}]},{"id":"s1","importance":"supporting","pattern":"SVC","roles":[{"role":"subject","tokenIds":["s1t0"]},{"role":"verb","tokenIds":["s1t1"]},{"role":"subjectComplement","tokenIds":["s1t2"]}]}]}
Done.`, indexed);
  assert.equal(annotation.sentences[0].importance, "supporting");
  assert.equal(annotation.sentences[0].pattern, "unclassified");
  assert.deepEqual(annotation.sentences[0].roles, []);
  assert.deepEqual(annotation.sentences[1].roles.map((role) => role.quote), ["She", "is", "happy"]);
});

test("JSON 与紧凑 Adapter 共享本地索引并生成相同标记", () => {
  const indexed = indexParagraph({ id: "paragraph-0", text: "Birds fly." });
  const jsonRequest = jsonTokenParsingAdapter.createRequest(indexed, "deepseek");
  const compactRequest = compactMarkedParsingAdapter.createRequest(indexed, "deepseek");
  assert.deepEqual(jsonRequest.samplingParams.thinking, { type: "disabled" });
  assert.match(compactRequest.userPrompt, /S0:\[0\]Birds \[1\]fly\[2\]\./u);
  assert.match(compactRequest.systemPrompt, /Modern readers move quickly through a crowded world/u);

  const verbose = jsonTokenParsingAdapter.parseResponse(
    '{"sentences":[{"id":"s0","importance":"primary","pattern":"SV","roles":[{"role":"subject","tokenIds":["s0t0"]},{"role":"verb","tokenIds":["s0t1"]}]}]}',
    indexed,
  );
  const compact = compactMarkedParsingAdapter.parseResponse(
    '{"s":[["0","p","SV",[["S",["0"]],["V",["1"]]]]]}',
    indexed,
  );
  assert.deepEqual(compact, verbose);
  assert.equal(DEFAULT_PARSING_ADAPTER.id, "compact-marked");
});

test("本地词元拆分缩约词，紧凑 Adapter 对复杂分句安全降级", () => {
  const question = indexParagraph({ id: "paragraph-0", text: "What's your name?" });
  assert.deepEqual(question.sentences[0].tokens.map((token) => token.text), ["What", "'s", "your", "name", "?"]);

  const compound = indexParagraph({ id: "paragraph-1", text: "He left; his assistant stayed." });
  const annotation = compactMarkedParsingAdapter.parseResponse(
    '{"s":[["0","p","SV",[["S",["0"]],["V",["1"]]]]]}',
    compound,
  );
  assert.equal(annotation.sentences[0].pattern, "unclassified");
  assert.deepEqual(annotation.sentences[0].roles, []);
});
