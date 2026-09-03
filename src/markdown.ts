import zenuml from "@mermaid-js/mermaid-zenuml";
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/common";
import katex from "katex";
import MarkdownIt from "markdown-it";
import footnote from "markdown-it-footnote";
import taskLists from "markdown-it-task-lists";
import texmath from "markdown-it-texmath";
import mermaid from "mermaid";
import { logInfo, logWarn } from "./debug.ts";
import {
  deleteStoredDirectoryHandle,
  deleteStoredFileHandle,
  directoryFileKind,
  getStoredFileHandle,
  parseDirectoryPath,
  readDirectoryFileContent,
  readDirectoryHandleFile,
  readDirectoryHandleState,
  storeDirectoryHandle,
  storeFileHandle,
  type DirectoryBrowserState,
  type DirectoryFileContent,
  type DirectoryFileKind,
  type DirectoryTreeEntry,
} from "./directory.ts";

const MARKDOWN_PATH = /\.md$/iu;
const VIEWER_FAVORITES_KEY = "markdownViewerFavorites";
const VIEWER_RECENTS_KEY = "markdownViewerRecents";
const VIEWER_RELOAD_ANIMATION_KEY = "markdownViewerReloadAnimation";
const VIEWER_DIRECT_DIRECTORY_KEY = "markdownViewerDirectDirectory";
const MAX_VIEWER_RECENTS = 5;
const HAN_CHARACTER_PATTERN = /\p{Script=Han}/gu;
const ENGLISH_WORD_PATTERN = /\p{Script=Latin}+(?:['’-]\p{Script=Latin}+)*/gu;
const ALERT_LABELS = {
  note: "Note",
  tip: "Tip",
  important: "Important",
  warning: "Warning",
  caution: "Caution",
} as const;

type ViewerItemKind = "directory" | "file";
type SidebarView = "files" | "outline";

interface ViewerItem {
  kind: ViewerItemKind;
  path: string;
}

interface ViewerLibraryElements {
  dialog: HTMLDialogElement;
  favoriteList: HTMLUListElement;
  recentList: HTMLUListElement;
}

interface ViewerElements {
  toolbar: HTMLElement;
  shell: HTMLElement;
  content: HTMLElement;
  fileName: HTMLElement;
  openFileButton?: HTMLButtonElement;
  openDirectoryButton: HTMLButtonElement;
  directoryInput?: HTMLInputElement;
  favoriteButton: HTMLButtonElement;
  favoriteIcon: HTMLElement;
  favoriteLabel: HTMLElement;
  libraryButton: HTMLButtonElement;
  libraryDialog: HTMLDialogElement;
  favoriteList: HTMLUListElement;
  recentList: HTMLUListElement;
  currentItem?: ViewerItem;
  directoryRootName?: string;
  directoryHandle?: FileSystemDirectoryHandle;
  directoryFiles?: Map<string, File>;
  directoryFileState?: DirectoryBrowserState;
  directoryTabId?: number;
  directDirectorySession?: boolean;
  pendingDirectoryItem?: ViewerItem;
  setSidebar: (view: SidebarView, sidebar: HTMLElement | undefined, activate?: boolean) => void;
  openSidebar: () => void;
  setPath: (path: string) => void;
  setContentCount: (source: string) => void;
}

interface ResolvedDirectoryReference {
  path: string;
  hash?: string;
}

interface DirectoryFileSelection {
  state: DirectoryBrowserState;
  files: Map<string, File>;
}

let diagramRenderSequence = 0;
let directoryRenderSequence = 0;
let mermaidInitialization: Promise<void> | undefined;
let viewerFavorites: ViewerItem[] = [];
let viewerRecents: ViewerItem[] = [];
let viewerLibraryReady: Promise<void> | undefined;
let viewerLibraryLoaded = false;
let reloadScrollAnimationEnabled = false;
let closeDirectoryContextMenu: ((restoreFocus?: boolean) => void) | undefined;
const directoryImageCache = new Map<string, string>();

const markdown = new MarkdownIt({
  html: true,
  linkify: true,
  highlight(source, language) {
    if (!language || !hljs.getLanguage(language)) return escapeHtml(source);
    return hljs.highlight(source, { language, ignoreIllegals: true }).value;
  },
})
  .use(footnote)
  .use(taskLists, { enabled: false })
  .use(texmath, {
    engine: katex,
    delimiters: ["dollars", "beg_end"],
    katexOptions: { throwOnError: false, strict: "ignore", trust: false },
  });

const standaloneViewerUrl = chrome.runtime.getURL("viewer.html");
try {
  setReloadScrollAnimation(sessionStorage.getItem(VIEWER_RELOAD_ANIMATION_KEY) === "true");
} catch (error: unknown) {
  logWarn("content", "markdown.reload-animation.load.failed", { errorName: errorName(error) });
}
if (location.protocol === "file:" && MARKDOWN_PATH.test(location.pathname)) renderLocalMarkdown();
else if (location.href.split("#", 1)[0] === standaloneViewerUrl) renderStandaloneViewer();

function setReloadScrollAnimation(enabled: boolean): void {
  reloadScrollAnimationEnabled = enabled;
  document.documentElement.classList.toggle("linguamark-reload-scroll-animation", enabled);
}

function contentCount(source: string): number {
  return (source.match(HAN_CHARACTER_PATTERN)?.length ?? 0)
    + (source.match(ENGLISH_WORD_PATTERN)?.length ?? 0);
}

function renderLocalMarkdown(): void {
  const source = readRawMarkdown();
  try {
    const { article, customCss } = createArticle(source);
    appendKatexStyle();
    document.body.classList.add("linguamark-markdown-page");
    const viewer = createViewer(article, false, { kind: "file", path: localMarkdownPath() });
    viewer.setContentCount(source);
    document.body.replaceChildren(viewer.toolbar, viewer.shell, viewer.libraryDialog);
    replaceCustomStyle(customCss);
    document.documentElement.dataset.linguamarkMarkdown = "ready";
    document.title = article.querySelector("h1")?.textContent?.trim() || markdownFileName();
    const diagramCount = article.querySelectorAll<HTMLElement>(".md-diagram-panel").length;
    logInfo("content", "markdown.rendered", {
      characterCount: source.length,
      diagramCount,
      headingCount: article.querySelectorAll("h1, h2, h3, h4, h5, h6").length,
    });
    void renderDiagrams(article);
    initializeViewerLibrary(viewer);
    void initializeDirectoryBrowser(viewer);
  } catch (error: unknown) {
    showFallbackNotice();
    document.documentElement.dataset.linguamarkMarkdown = "error";
    logWarn("content", "markdown.render.failed", { errorName: errorName(error) });
  }
}

function renderStandaloneViewer(): void {
  try {
    const article = createEmptyViewerArticle();
    appendKatexStyle();
    document.body.classList.add("linguamark-markdown-page", "linguamark-standalone-viewer");
    const viewer = createViewer(article, true);
    document.body.replaceChildren(viewer.toolbar, viewer.shell, viewer.libraryDialog);
    document.documentElement.dataset.linguamarkMarkdown = "ready";
    document.title = "Markdown Viewer · LinguaMark";
    initializeStandaloneFilePicker(viewer);
    initializeViewerLibrary(viewer);
    void initializeDirectoryBrowser(viewer);
  } catch (error: unknown) {
    showFallbackNotice();
    document.documentElement.dataset.linguamarkMarkdown = "error";
    logWarn("content", "markdown.standalone.failed", { errorName: errorName(error) });
  }
}

function createEmptyViewerArticle(): HTMLElement {
  const article = document.createElement("article");
  article.id = "write";
  article.className = "linguamark-empty-viewer";
  article.dataset.linguamarkIgnore = "";
  const home = document.createElement("div");
  home.className = "linguamark-empty-viewer-home";
  const message = document.createElement("div");
  message.className = "linguamark-empty-viewer-message";
  const title = document.createElement("p");
  title.className = "linguamark-empty-viewer-title";
  title.textContent = "打开 Markdown 开始阅读";
  const description = document.createElement("p");
  description.textContent = "使用顶部按钮选择单个 Markdown 文件，或打开一个阅读目录。";
  message.append(title, description);

  const library = document.createElement("div");
  library.className = "linguamark-markdown-library-grid linguamark-empty-viewer-library";
  const favorites = createViewerLibrarySection("全部收藏");
  favorites.list.dataset.viewerItems = "favorites";
  const recents = createViewerLibrarySection("最近浏览");
  recents.list.dataset.viewerItems = "recents";
  library.append(favorites.section, recents.section);
  home.append(message, library);
  article.append(home);
  return article;
}

function readRawMarkdown(): string {
  const onlyChild = document.body?.children.length === 1 ? document.body.firstElementChild : undefined;
  if (onlyChild?.tagName === "PRE") return onlyChild.textContent ?? "";
  return document.body?.textContent ?? "";
}

function createArticle(source: string): { article: HTMLElement; customCss: string } {
  const { body, frontMatter } = splitFrontMatter(source);
  const template = document.createElement("template");
  template.innerHTML = `${frontMatter ? `<pre class="md-meta-block">${escapeHtml(frontMatter)}</pre>` : ""}${markdown.render(body)}`;

  const customCss = [...template.content.querySelectorAll("style")]
    .map((style) => style.textContent ?? "")
    .map(scopeCustomCss)
    .filter(Boolean)
    .join("\n");
  for (const style of template.content.querySelectorAll("style")) style.remove();

  const purified = DOMPurify.sanitize(template.innerHTML, {
    RETURN_DOM_FRAGMENT: true,
    USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true },
    ADD_TAGS: ["iframe", "eq", "eqn"],
    ADD_ATTR: ["sandbox", "loading", "referrerpolicy", "target", "rel"],
    FORBID_TAGS: ["script", "style", "object", "embed", "base", "meta", "link"],
    FORBID_ATTR: ["srcdoc"],
  }) as DocumentFragment;
  const clean = purified.cloneNode(true) as DocumentFragment;

  const article = document.createElement("article");
  article.id = "write";
  article.append(clean);
  secureInteractiveContent(article);
  decorateAlerts(article);
  decorateMath(article);
  prepareDiagrams(article);
  return { article, customCss };
}

function splitFrontMatter(source: string): { body: string; frontMatter?: string } {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
  if (!match) return { body: source };
  return { body: source.slice(match[0].length), frontMatter: match[1] };
}

function scopeCustomCss(source: string): string {
  const sheet = new CSSStyleSheet();
  try {
    sheet.replaceSync(source);
  } catch {
    return "";
  }

  const globalRules: string[] = [];
  const scopedRules: string[] = [];
  for (const rule of sheet.cssRules) {
    if (rule.type === CSSRule.IMPORT_RULE
      || rule.type === CSSRule.KEYFRAMES_RULE
      || rule.type === CSSRule.NAMESPACE_RULE) {
      continue;
    }
    if (rule.type === CSSRule.FONT_FACE_RULE) globalRules.push(rule.cssText);
    else scopedRules.push(rule.cssText);
  }
  return [
    globalRules.join("\n"),
    scopedRules.length > 0 ? `@scope (#write) {\n${scopedRules.join("\n")}\n}` : "",
  ].filter(Boolean).join("\n");
}

function appendKatexStyle(): void {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = chrome.runtime.getURL("katex.min.css");
  document.head.append(link);
}

function replaceCustomStyle(css: string): void {
  for (const existing of document.querySelectorAll("style[data-linguamark-markdown-style]")) existing.remove();
  if (!css) return;
  const style = document.createElement("style");
  style.dataset.linguamarkMarkdownStyle = "";
  style.textContent = css;
  document.head.append(style);
}

function secureInteractiveContent(article: HTMLElement): void {
  for (const active of article.querySelectorAll("script, object, embed")) active.remove();
  for (const element of article.querySelectorAll("*")) {
    for (const attribute of [...element.attributes]) {
      if (attribute.name.toLowerCase().startsWith("on")
        || (isUrlAttribute(attribute.name) && isExecutableUrl(attribute.value))) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  for (const iframe of article.querySelectorAll("iframe")) {
    iframe.setAttribute("sandbox", "");
    iframe.removeAttribute("allow");
    iframe.removeAttribute("srcdoc");
    iframe.loading = "lazy";
    iframe.referrerPolicy = "no-referrer";
  }
  for (const form of article.querySelectorAll("form")) form.inert = true;
  for (const anchor of article.querySelectorAll<HTMLAnchorElement>("a[target='_blank']")) {
    anchor.rel = "noopener noreferrer";
  }
}

function isUrlAttribute(name: string): boolean {
  return ["href", "src", "action", "formaction", "poster", "xlink:href"].includes(name.toLowerCase());
}

function isExecutableUrl(value: string): boolean {
  return /^(?:javascript|vbscript):|^data:text\/html/iu.test(value.replaceAll(/[\u0000-\u0020]+/gu, ""));
}

function decorateAlerts(article: HTMLElement): void {
  for (const quote of article.querySelectorAll("blockquote")) {
    const firstParagraph = quote.querySelector(":scope > p:first-child");
    const firstText = firstParagraph ? document.createTreeWalker(firstParagraph, NodeFilter.SHOW_TEXT).nextNode() as Text | null : null;
    const match = firstText?.data.match(/^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/iu);
    if (!firstParagraph || !firstText || !match) continue;

    const kind = match[1].toLowerCase() as keyof typeof ALERT_LABELS;
    firstText.data = firstText.data.slice(match[0].length);
    quote.classList.add("md-alert", `md-alert-${kind}`);
    quote.role = "note";
    const heading = document.createElement("div");
    heading.className = "md-alert-text-container";
    const label = document.createElement("span");
    label.className = "md-alert-text";
    label.textContent = ALERT_LABELS[kind];
    heading.append(label);
    quote.prepend(heading);
    if (!firstParagraph.textContent?.trim()) firstParagraph.remove();
  }
}

function decorateMath(article: HTMLElement): void {
  for (const equation of article.querySelectorAll<HTMLElement>("eq")) {
    equation.classList.add("md-inline-math");
    equation.dataset.linguamarkIgnore = "";
  }
  for (const equation of article.querySelectorAll<HTMLElement>("eqn")) {
    const block = equation.closest<HTMLElement>("section") ?? equation;
    block.classList.add("md-math-block");
    block.dataset.linguamarkIgnore = "";
  }
}

function prepareDiagrams(article: HTMLElement): void {
  const blocks = [...article.querySelectorAll<HTMLElement>("pre > code.language-mermaid")];
  for (const code of blocks) {
    const pre = code.parentElement;
    if (!pre) continue;
    pre.classList.add("linguamark-mermaid-source");
    const panel = document.createElement("div");
    panel.className = "md-diagram-panel";
    panel.dataset.linguamarkIgnore = "";
    pre.replaceWith(panel);
    panel.append(pre);
  }
}

async function initializeMermaid(): Promise<void> {
  mermaidInitialization ??= (async () => {
    await mermaid.registerExternalDiagrams([zenuml]);
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      fontFamily: '"LXGW WenKai", "PingFang SC", system-ui, sans-serif',
      themeVariables: {
        background: "#faf7ef",
        primaryColor: "#faf7ef",
        primaryTextColor: "#2c3a32",
        primaryBorderColor: "#2f5a40",
        lineColor: "#4a7c59",
        secondaryColor: "#ecefe6",
        tertiaryColor: "#f7f3e8",
      },
    });
  })();
  return mermaidInitialization;
}

async function renderDiagrams(article: HTMLElement): Promise<void> {
  const panels = [...article.querySelectorAll<HTMLElement>(".md-diagram-panel")];
  if (panels.length === 0) return;

  await initializeMermaid();
  const renderId = ++diagramRenderSequence;
  for (const [index, panel] of panels.entries()) {
    const source = panel.querySelector("code")?.textContent ?? "";
    const diagramId = `linguamark-mermaid-${renderId}-${index}`;
    try {
      const { svg } = await mermaid.render(diagramId, source);
      removeMermaidScratch(diagramId);
      panel.innerHTML = svg;
      secureInteractiveContent(panel);
    } catch (error: unknown) {
      removeMermaidScratch(diagramId);
      panel.querySelector("pre")?.setAttribute("data-render-error", "true");
      logWarn("content", "markdown.mermaid.failed", { diagramIndex: index, errorName: errorName(error) });
    }
  }
}

function removeMermaidScratch(diagramId: string): void {
  document.getElementById(`d${diagramId}`)?.remove();
}

function createViewer(article: HTMLElement, standalone = false, initialItem?: ViewerItem): ViewerElements {
  const documentSidebar = createTableOfContents(article);
  const toolbar = document.createElement("header");
  toolbar.className = "linguamark-markdown-toolbar";
  toolbar.dataset.linguamarkUi = "";

  const sidebarControl = document.createElement("label");
  sidebarControl.className = "linguamark-markdown-toc-toggle";
  const sidebarIcon = document.createElement("span");
  sidebarIcon.className = "linguamark-markdown-toc-icon";
  sidebarIcon.setAttribute("aria-hidden", "true");
  sidebarIcon.textContent = "☰";
  const sidebarSelect = document.createElement("select");
  sidebarSelect.className = "linguamark-markdown-sidebar-select";
  sidebarSelect.setAttribute("aria-controls", "linguamark-markdown-toc");
  sidebarSelect.setAttribute("aria-label", "侧栏显示内容");
  const filesOption = new Option("文件树", "files");
  const outlineOption = new Option("文章目录", "outline");
  const hiddenOption = new Option("隐藏侧栏", "hidden");
  sidebarSelect.append(filesOption, outlineOption, hiddenOption);
  const sidebarIndicator = document.createElement("span");
  sidebarIndicator.className = "linguamark-markdown-sidebar-indicator";
  sidebarIndicator.setAttribute("aria-hidden", "true");
  sidebarIndicator.textContent = "▾";
  sidebarControl.append(sidebarIcon, sidebarSelect, sidebarIndicator);

  const openFileButton = standalone ? document.createElement("button") : undefined;
  if (openFileButton) {
    openFileButton.type = "button";
    openFileButton.className = "linguamark-markdown-directory-button";
    openFileButton.textContent = "打开文件";
  }
  const openDirectoryButton = document.createElement("button");
  openDirectoryButton.type = "button";
  openDirectoryButton.className = "linguamark-markdown-directory-button";
  openDirectoryButton.textContent = "打开目录";
  const directoryInput = standalone ? undefined : document.createElement("input");
  if (directoryInput) {
    directoryInput.type = "file";
    directoryInput.multiple = true;
    directoryInput.webkitdirectory = true;
    directoryInput.hidden = true;
    directoryInput.dataset.linguamarkUi = "";
  }

  const fileName = document.createElement("span");
  fileName.className = "linguamark-markdown-file-name";
  fileName.textContent = standalone ? "空白阅读器" : markdownFileName();
  fileName.title = fileName.textContent;

  const widthButton = document.createElement("button");
  widthButton.type = "button";
  widthButton.className = "linguamark-markdown-directory-button linguamark-markdown-width-button";
  widthButton.setAttribute("aria-pressed", "false");
  const widthIcon = document.createElement("span");
  widthIcon.className = "linguamark-markdown-action-icon";
  widthIcon.setAttribute("aria-hidden", "true");
  widthIcon.textContent = "↔";
  const widthLabel = document.createElement("span");
  widthLabel.className = "linguamark-markdown-action-label";
  widthButton.append(widthIcon, widthLabel);
  const setFullWidth = (fullWidth: boolean): void => {
    document.body.classList.toggle("linguamark-full-width", fullWidth);
    widthButton.setAttribute("aria-pressed", String(fullWidth));
    widthLabel.textContent = fullWidth ? "整屏宽度" : "固定宽度";
    const nextMode = fullWidth ? "固定宽度" : "整屏宽度";
    widthButton.setAttribute("aria-label", `当前${widthLabel.textContent}，点击切换为${nextMode}`);
    widthButton.title = `切换为${nextMode}`;
  };
  widthButton.addEventListener("click", () => {
    setFullWidth(!document.body.classList.contains("linguamark-full-width"));
  });
  setFullWidth(false);

  const animationButton = document.createElement("button");
  animationButton.type = "button";
  animationButton.className = "linguamark-markdown-directory-button linguamark-markdown-animation-button";
  animationButton.setAttribute("role", "switch");
  const animationIcon = document.createElement("span");
  animationIcon.className = "linguamark-markdown-action-icon";
  animationIcon.setAttribute("aria-hidden", "true");
  animationIcon.textContent = "↝";
  const animationLabel = document.createElement("span");
  animationLabel.className = "linguamark-markdown-action-label";
  animationLabel.textContent = "重载动画";
  animationButton.append(animationIcon, animationLabel);
  const updateAnimationButton = (enabled: boolean): void => {
    setReloadScrollAnimation(enabled);
    animationButton.setAttribute("aria-checked", String(enabled));
    animationButton.setAttribute("aria-label", `${enabled ? "关闭" : "开启"}重载滚动动画`);
    animationButton.title = `${enabled ? "关闭" : "开启"}重载时的平滑滚动动画`;
  };
  animationButton.addEventListener("click", () => {
    const enabled = !reloadScrollAnimationEnabled;
    updateAnimationButton(enabled);
    try {
      sessionStorage.setItem(VIEWER_RELOAD_ANIMATION_KEY, String(enabled));
    } catch (error: unknown) {
      logWarn("content", "markdown.reload-animation.save.failed", { errorName: errorName(error) });
    }
  });
  updateAnimationButton(reloadScrollAnimationEnabled);

  const favoriteButton = document.createElement("button");
  favoriteButton.type = "button";
  favoriteButton.className = "linguamark-markdown-directory-button linguamark-markdown-favorite-button";
  favoriteButton.disabled = true;
  favoriteButton.setAttribute("aria-pressed", "false");
  const favoriteIcon = document.createElement("span");
  favoriteIcon.className = "linguamark-markdown-action-icon";
  favoriteIcon.setAttribute("aria-hidden", "true");
  favoriteIcon.textContent = "☆";
  const favoriteLabel = document.createElement("span");
  favoriteLabel.className = "linguamark-markdown-action-label";
  favoriteLabel.textContent = "收藏";
  favoriteButton.append(favoriteIcon, favoriteLabel);

  const libraryButton = document.createElement("button");
  libraryButton.type = "button";
  libraryButton.className = "linguamark-markdown-directory-button linguamark-markdown-library-button";
  libraryButton.setAttribute("aria-haspopup", "dialog");
  libraryButton.setAttribute("aria-controls", "linguamark-markdown-library");
  libraryButton.setAttribute("aria-label", "查看收藏与最近浏览");
  const libraryIcon = document.createElement("span");
  libraryIcon.className = "linguamark-markdown-action-icon";
  libraryIcon.setAttribute("aria-hidden", "true");
  libraryIcon.textContent = "☷";
  const libraryLabel = document.createElement("span");
  libraryLabel.className = "linguamark-markdown-action-label";
  libraryLabel.textContent = "收藏列表";
  libraryButton.append(libraryIcon, libraryLabel);

  const brand = document.createElement("span");
  brand.className = "linguamark-markdown-brand";
  brand.textContent = "LinguaMark";
  const actions = document.createElement("div");
  actions.className = "linguamark-markdown-toolbar-actions";
  actions.append(brand, widthButton, animationButton, favoriteButton, libraryButton);
  toolbar.append(
    sidebarControl,
    ...(openFileButton ? [openFileButton] : []),
    openDirectoryButton,
    ...(directoryInput ? [directoryInput] : []),
    fileName,
    actions,
  );

  const shell = document.createElement("div");
  shell.className = "linguamark-markdown-shell";
  const content = document.createElement("div");
  content.className = "linguamark-markdown-content";
  content.append(article);
  const resizer = document.createElement("div");
  resizer.className = "linguamark-markdown-toc-resizer";
  resizer.dataset.linguamarkUi = "";
  resizer.tabIndex = -1;
  resizer.setAttribute("role", "separator");
  resizer.setAttribute("aria-controls", "linguamark-markdown-toc");
  resizer.setAttribute("aria-orientation", "vertical");
  resizer.setAttribute("aria-valuemin", "200");
  resizer.title = "拖动调整侧栏宽度";
  const backdrop = document.createElement("button");
  backdrop.type = "button";
  backdrop.className = "linguamark-markdown-toc-backdrop";
  backdrop.dataset.linguamarkUi = "";
  backdrop.setAttribute("aria-label", "关闭侧栏");

  const characterCountLabel = document.createElement("output");
  characterCountLabel.className = "linguamark-markdown-character-count";
  characterCountLabel.dataset.linguamarkUi = "";
  characterCountLabel.setAttribute("aria-live", "polite");
  const setContentCount = (source: string): void => {
    const formatted = contentCount(source).toLocaleString("zh-CN");
    characterCountLabel.textContent = `${formatted} 字词`;
    characterCountLabel.setAttribute("aria-label", `当前内容共 ${formatted} 字词`);
  };
  setContentCount("");

  const library = createViewerLibrary();
  shell.append(content, resizer, backdrop, characterCountLabel);

  const narrowScreen = matchMedia("(max-width: 900px)");
  const minimumSidebarWidth = 200;
  const defaultSidebarWidth = 272;
  const sidebars: Record<SidebarView, HTMLElement | undefined> = {
    files: undefined,
    outline: documentSidebar,
  };
  const sidebarLabels: Record<SidebarView, string> = {
    files: "文件树",
    outline: "文章目录",
  };
  let activeSidebar: HTMLElement | undefined;
  let sidebarView: SidebarView = "outline";
  let sidebarOpen = false;
  let sidebarWidth = defaultSidebarWidth;
  let sidebarResizePointer: number | undefined;
  const maximumSidebarWidth = (): number => Math.max(defaultSidebarWidth, Math.floor(innerWidth / 2));
  const setSidebarWidth = (width: number): void => {
    const maximum = maximumSidebarWidth();
    sidebarWidth = Math.min(Math.max(Math.round(width), minimumSidebarWidth), maximum);
    shell.style.setProperty("--linguamark-markdown-toc-width", `${sidebarWidth}px`);
    resizer.setAttribute("aria-valuemax", String(maximum));
    resizer.setAttribute("aria-valuenow", String(sidebarWidth));
    resizer.setAttribute("aria-valuetext", `${sidebarWidth} 像素`);
  };
  const syncSidebar = (): void => {
    const nextSidebar = sidebars[sidebarView];
    if (activeSidebar !== nextSidebar) {
      activeSidebar?.remove();
      activeSidebar = nextSidebar;
      if (activeSidebar) {
        shell.insertBefore(activeSidebar, content);
        shell.insertBefore(resizer, content);
      }
    }
    filesOption.disabled = !sidebars.files;
    outlineOption.disabled = !sidebars.outline;
    sidebarControl.hidden = !sidebars.files && !sidebars.outline;
    resizer.setAttribute("aria-label", `调整${sidebarLabels[sidebarView]}宽度`);
    shell.classList.toggle("has-no-toc", !activeSidebar);
  };
  const setSidebarOpen = (open: boolean): void => {
    sidebarOpen = Boolean(activeSidebar) && open;
    document.body.classList.toggle("linguamark-toc-open", sidebarOpen);
    sidebarControl.classList.toggle("is-open", sidebarOpen);
    sidebarControl.title = sidebarOpen ? `当前显示${sidebarLabels[sidebarView]}` : "选择侧栏内容";
    sidebarSelect.value = sidebarOpen ? sidebarView : "hidden";
    resizer.tabIndex = sidebarOpen && !narrowScreen.matches ? 0 : -1;
    backdrop.hidden = !sidebarOpen;
  };
  const setSidebar = (view: SidebarView, sidebar: HTMLElement | undefined, activate = false): void => {
    const wasOpen = sidebarOpen;
    sidebars[view] = sidebar;
    if (activate && sidebar) sidebarView = view;
    if (!sidebars[sidebarView]) sidebarView = sidebars.files ? "files" : "outline";
    syncSidebar();
    setSidebarOpen(activate ? !narrowScreen.matches : wasOpen);
  };

  resizer.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || sidebarResizePointer !== undefined || narrowScreen.matches || !sidebarOpen) return;
    sidebarResizePointer = event.pointerId;
    resizer.setPointerCapture(event.pointerId);
    document.body.classList.add("linguamark-toc-resizing");
    event.preventDefault();
  });
  resizer.addEventListener("pointermove", (event) => {
    if (event.pointerId !== sidebarResizePointer) return;
    setSidebarWidth(event.clientX - shell.getBoundingClientRect().left);
  });
  const finishSidebarResize = (event: PointerEvent): void => {
    if (event.pointerId !== sidebarResizePointer) return;
    if (resizer.hasPointerCapture(event.pointerId)) resizer.releasePointerCapture(event.pointerId);
    sidebarResizePointer = undefined;
    document.body.classList.remove("linguamark-toc-resizing");
  };
  resizer.addEventListener("pointerup", finishSidebarResize);
  resizer.addEventListener("pointercancel", finishSidebarResize);
  resizer.addEventListener("lostpointercapture", () => {
    sidebarResizePointer = undefined;
    document.body.classList.remove("linguamark-toc-resizing");
  });
  resizer.addEventListener("keydown", (event) => {
    let width: number;
    if (event.key === "ArrowLeft") width = sidebarWidth - 16;
    else if (event.key === "ArrowRight") width = sidebarWidth + 16;
    else if (event.key === "Home") width = minimumSidebarWidth;
    else if (event.key === "End") width = maximumSidebarWidth();
    else return;
    event.preventDefault();
    setSidebarWidth(width);
  });
  sidebarSelect.addEventListener("change", () => {
    const view = sidebarSelect.value;
    if (view === "hidden") {
      setSidebarOpen(false);
      return;
    }
    if ((view !== "files" && view !== "outline") || !sidebars[view]) return;
    sidebarView = view;
    syncSidebar();
    setSidebarOpen(true);
  });
  backdrop.addEventListener("click", () => setSidebarOpen(false));
  shell.addEventListener("click", (event) => {
    if (narrowScreen.matches
      && event.target instanceof Element
      && event.target.closest("#linguamark-markdown-toc a, #linguamark-markdown-toc button[data-directory-path]")) {
      setSidebarOpen(false);
    }
  });
  narrowScreen.addEventListener("change", (event) => setSidebarOpen(Boolean(activeSidebar) && !event.matches));
  addEventListener("resize", () => {
    if (!narrowScreen.matches) setSidebarWidth(sidebarWidth);
  }, { passive: true });
  addEventListener("keydown", (event) => {
    if (event.key === "Escape" && sidebarOpen) setSidebarOpen(false);
  });
  setSidebarWidth(defaultSidebarWidth);
  setSidebar("outline", documentSidebar, true);

  return {
    toolbar,
    shell,
    content,
    fileName,
    ...(openFileButton ? { openFileButton } : {}),
    openDirectoryButton,
    ...(directoryInput ? { directoryInput } : {}),
    favoriteButton,
    favoriteIcon,
    favoriteLabel,
    libraryButton,
    libraryDialog: library.dialog,
    favoriteList: library.favoriteList,
    recentList: library.recentList,
    ...(initialItem ? { currentItem: initialItem } : {}),
    setSidebar,
    openSidebar() {
      setSidebarOpen(true);
    },
    setPath(path) {
      fileName.textContent = path;
      fileName.title = path;
    },
    setContentCount,
  };
}

function createViewerLibrary(): ViewerLibraryElements {
  const dialog = document.createElement("dialog");
  dialog.id = "linguamark-markdown-library";
  dialog.className = "linguamark-markdown-library";
  dialog.dataset.linguamarkUi = "";
  dialog.setAttribute("aria-labelledby", "linguamark-markdown-library-title");

  const panel = document.createElement("div");
  panel.className = "linguamark-markdown-library-panel";
  const header = document.createElement("div");
  header.className = "linguamark-markdown-library-header";
  const title = document.createElement("h2");
  title.id = "linguamark-markdown-library-title";
  title.textContent = "收藏与最近浏览";
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "linguamark-markdown-library-close";
  closeButton.setAttribute("aria-label", "关闭收藏列表");
  closeButton.textContent = "×";
  closeButton.addEventListener("click", () => dialog.close());
  header.append(title, closeButton);

  const grid = document.createElement("div");
  grid.className = "linguamark-markdown-library-grid";
  const favorites = createViewerLibrarySection("全部收藏");
  const recents = createViewerLibrarySection("最近浏览");
  grid.append(favorites.section, recents.section);
  panel.append(header, grid);
  dialog.append(panel);
  return { dialog, favoriteList: favorites.list, recentList: recents.list };
}

function createViewerLibrarySection(titleText: string): { section: HTMLElement; list: HTMLUListElement } {
  const section = document.createElement("section");
  section.className = "linguamark-markdown-library-section";
  const title = document.createElement("h3");
  title.textContent = titleText;
  const list = document.createElement("ul");
  list.className = "linguamark-markdown-library-list";
  section.append(title, list);
  return { section, list };
}

function initializeViewerLibrary(viewer: ViewerElements): void {
  renderViewerLibrary(viewer);
  viewer.favoriteButton.addEventListener("click", () => {
    void toggleViewerFavorite(viewer);
  });
  viewer.libraryButton.addEventListener("click", () => {
    openViewerLibrary(viewer);
  });

  const initialItem = viewer.currentItem;
  viewerLibraryReady = chrome.storage.local.get([VIEWER_FAVORITES_KEY, VIEWER_RECENTS_KEY]).then((stored) => {
    viewerFavorites = readViewerItems(stored[VIEWER_FAVORITES_KEY]);
    viewerRecents = readViewerItems(stored[VIEWER_RECENTS_KEY], MAX_VIEWER_RECENTS);
    viewerLibraryLoaded = true;
    updateViewerFavoriteButton(viewer);
    renderViewerLibrary(viewer);
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local") return;
      if (changes[VIEWER_FAVORITES_KEY]) {
        viewerFavorites = readViewerItems(changes[VIEWER_FAVORITES_KEY].newValue);
      }
      if (changes[VIEWER_RECENTS_KEY]) {
        viewerRecents = readViewerItems(changes[VIEWER_RECENTS_KEY].newValue, MAX_VIEWER_RECENTS);
      }
      updateViewerFavoriteButton(viewer);
      renderViewerLibrary(viewer);
    });
  });

  void viewerLibraryReady
    .then(() => initialItem ? recordViewerRecent(initialItem, viewer) : undefined)
    .catch((error: unknown) => {
      logWarn("content", "markdown.library.initialize.failed", { errorName: errorName(error) });
      showDirectoryNotice("无法读取收藏与最近浏览记录");
    });
}

async function toggleViewerFavorite(viewer: ViewerElements, item: ViewerItem | undefined = viewer.currentItem): Promise<void> {
  if (!viewerLibraryLoaded || !item) return;
  const previous = viewerFavorites;
  const keys = viewerFavoriteKeys(item, viewer);
  const saved = viewerFavorites.some((favorite) => keys.has(viewerItemKey(favorite)));
  viewerFavorites = saved
    ? viewerFavorites.filter((favorite) => !keys.has(viewerItemKey(favorite)))
    : [item, ...viewerFavorites.filter((favorite) => !keys.has(viewerItemKey(favorite)))];
  updateViewerFavoriteButton(viewer);
  renderViewerLibrary(viewer);

  try {
    await chrome.storage.local.set({ [VIEWER_FAVORITES_KEY]: viewerFavorites });
  } catch (error: unknown) {
    viewerFavorites = previous;
    updateViewerFavoriteButton(viewer);
    renderViewerLibrary(viewer);
    logWarn("content", "markdown.favorite.save.failed", { errorName: errorName(error) });
    showDirectoryNotice("收藏保存失败");
  }
}

function openViewerLibrary(viewer: ViewerElements): void {
  try {
    if (!viewer.libraryDialog.open) viewer.libraryDialog.showModal();
  } catch (error: unknown) {
    logWarn("content", "markdown.library.open.failed", { errorName: errorName(error) });
    showDirectoryNotice("无法打开收藏列表");
  }
}

function setViewerCurrentItem(viewer: ViewerElements, item: ViewerItem): void {
  viewer.currentItem = item;
  updateViewerFavoriteButton(viewer);
  const ready = viewerLibraryReady;
  if (!ready) return;
  void ready.then(() => recordViewerRecent(item, viewer)).catch((error: unknown) => {
    logWarn("content", "markdown.recent.save.failed", { errorName: errorName(error) });
  });
}

async function recordViewerRecent(item: ViewerItem, viewer: ViewerElements): Promise<void> {
  const key = viewerItemKey(item);
  if (viewerRecents[0] && viewerItemKey(viewerRecents[0]) === key) return;
  viewerRecents = [item, ...viewerRecents.filter((recent) => viewerItemKey(recent) !== key)]
    .slice(0, MAX_VIEWER_RECENTS);
  renderViewerLibrary(viewer);
  try {
    await chrome.storage.local.set({ [VIEWER_RECENTS_KEY]: viewerRecents });
  } catch (error: unknown) {
    logWarn("content", "markdown.recent.save.failed", { errorName: errorName(error) });
  }
}

function updateViewerFavoriteButton(viewer: ViewerElements): void {
  const item = viewer.currentItem;
  const saved = Boolean(item && isViewerFavorite(item, viewer));
  viewer.favoriteButton.disabled = !viewerLibraryLoaded || !item;
  viewer.favoriteButton.classList.toggle("is-saved", saved);
  viewer.favoriteButton.setAttribute("aria-pressed", String(saved));
  viewer.favoriteIcon.textContent = saved ? "★" : "☆";
  viewer.favoriteLabel.textContent = saved ? "已收藏" : "收藏";
  const action = saved ? "取消收藏" : "收藏";
  viewer.favoriteButton.setAttribute("aria-label", item ? `${action}${viewerItemLabel(item)} ${item.path}` : "请先打开目录或文件");
  viewer.favoriteButton.title = item ? `${action}：${item.path}` : "请先打开目录或文件";
}

function renderViewerLibrary(viewer: ViewerElements): void {
  const favorites = viewerFavoritesForDisplay(viewer);
  renderViewerItems(viewer.favoriteList, favorites, "暂无收藏", viewer);
  renderViewerItems(viewer.recentList, viewerRecents, "暂无浏览记录", viewer);
  const emptyFavorites = viewer.content.querySelector<HTMLUListElement>('[data-viewer-items="favorites"]');
  const emptyRecents = viewer.content.querySelector<HTMLUListElement>('[data-viewer-items="recents"]');
  if (emptyFavorites) renderViewerItems(emptyFavorites, favorites, "暂无收藏", viewer);
  if (emptyRecents) renderViewerItems(emptyRecents, viewerRecents, "暂无浏览记录", viewer);
}

function renderViewerItems(
  list: HTMLUListElement,
  items: ViewerItem[],
  emptyText: string,
  viewer: ViewerElements,
): void {
  if (items.length === 0) {
    const empty = document.createElement("li");
    empty.className = "linguamark-markdown-library-empty";
    empty.textContent = emptyText;
    list.replaceChildren(empty);
    return;
  }

  list.replaceChildren(...items.map((item) => {
    const row = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "linguamark-markdown-library-item";
    button.title = item.path;
    button.setAttribute("aria-label", `打开${viewerItemLabel(item)} ${item.path}`);
    const kind = document.createElement("span");
    kind.className = `linguamark-markdown-library-kind is-${item.kind}`;
    kind.textContent = viewerItemLabel(item);
    const path = document.createElement("span");
    path.className = "linguamark-markdown-library-path";
    path.textContent = item.path;
    button.append(kind, path);
    button.addEventListener("click", () => {
      void openViewerItem(item, viewer);
    });
    row.append(button);
    return row;
  }));
}

async function openViewerItem(item: ViewerItem, viewer: ViewerElements): Promise<void> {
  viewer.libraryDialog.close();
  if (item.kind === "directory") {
    if (viewer.directoryRootName !== item.path) {
      requestViewerDirectoryAccess(item, viewer);
      return;
    }
    await refreshDirectoryBrowser(viewer, true);
    if (viewer.directoryRootName !== item.path) {
      requestViewerDirectoryAccess(item, viewer);
      return;
    }
    viewer.openSidebar();
    return;
  }

  if (viewer.currentItem && viewerItemKey(viewer.currentItem) === viewerItemKey(item)) return;
  const directoryPrefix = viewer.directoryRootName ? `${viewer.directoryRootName}/` : "";
  if (directoryPrefix && item.path.startsWith(directoryPrefix)) {
    const path = item.path.slice(directoryPrefix.length);
    const kind = directoryFileKind(path);
    if (kind === "other") {
      showDirectoryNotice(`不支持打开文件“${item.path}”`);
      return;
    }
    await openDirectoryEntry(path, kind, viewer);
    return;
  }

  if (item.path.startsWith("/")) {
    if (!(await chrome.extension.isAllowedFileSchemeAccess())) {
      showDirectoryNotice("请在扩展详情页开启“允许访问文件网址”后再打开");
      return;
    }
    const url = new URL("file:///");
    url.pathname = item.path;
    location.assign(url.href);
    return;
  }

  if (viewerItemDirectoryName(item)) {
    requestViewerDirectoryAccess(item, viewer);
    return;
  }
  showDirectoryNotice(`请重新选择文件“${item.path}”后再打开`);
}

function requestViewerDirectoryAccess(item: ViewerItem, viewer: ViewerElements): void {
  void openDirectoryPicker(viewer, item);
}

function viewerItemDirectoryName(item: ViewerItem): string | undefined {
  if (item.kind === "directory") return item.path;
  if (item.path.startsWith("/")) return undefined;
  const separator = item.path.indexOf("/");
  return separator > 0 ? item.path.slice(0, separator) : undefined;
}

function readViewerItems(value: unknown, limit = Number.POSITIVE_INFINITY): ViewerItem[] {
  if (!Array.isArray(value)) return [];
  const items: ViewerItem[] = [];
  const keys = new Set<string>();
  for (const candidate of value) {
    if (!isRecord(candidate)
      || (candidate.kind !== "directory" && candidate.kind !== "file")
      || typeof candidate.path !== "string"
      || !candidate.path.trim()) {
      continue;
    }
    const item: ViewerItem = { kind: candidate.kind, path: candidate.path };
    const key = viewerItemKey(item);
    if (keys.has(key)) continue;
    keys.add(key);
    items.push(item);
    if (items.length >= limit) break;
  }
  return items;
}

function viewerItemKey(item: ViewerItem): string {
  return `${item.kind}:${item.path}`;
}

function viewerFavoriteKeys(item: ViewerItem, viewer: ViewerElements): Set<string> {
  const keys = new Set([viewerItemKey(item)]);
  const current = viewer.currentItem;
  const rootName = viewer.directoryRootName;
  const sidebar = document.querySelector<HTMLElement>(".linguamark-directory-sidebar");
  if (item.kind !== "file" || current?.kind !== "file" || !rootName || !sidebar) return keys;

  const relativePath = currentDirectoryPath(viewer, sidebar);
  if (!relativePath) return keys;
  const currentKey = viewerItemKey(current);
  const directoryKey = viewerItemKey({ kind: "file", path: `${rootName}/${relativePath}` });
  if (keys.has(currentKey) || keys.has(directoryKey)) {
    keys.add(currentKey);
    keys.add(directoryKey);
  }
  return keys;
}

function isViewerFavorite(item: ViewerItem, viewer: ViewerElements): boolean {
  const keys = viewerFavoriteKeys(item, viewer);
  return viewerFavorites.some((favorite) => keys.has(viewerItemKey(favorite)));
}

function viewerFavoritesForDisplay(viewer: ViewerElements): ViewerItem[] {
  const seen = new Set<string>();
  return viewerFavorites.filter((favorite) => {
    const keys = viewerFavoriteKeys(favorite, viewer);
    if ([...keys].some((key) => seen.has(key))) return false;
    for (const key of keys) seen.add(key);
    return true;
  });
}

function viewerItemLabel(item: ViewerItem): string {
  return item.kind === "directory" ? "目录" : "文件";
}

function createTableOfContents(article: HTMLElement): HTMLElement | undefined {
  const placeholders = [...article.querySelectorAll("p")]
    .filter((paragraph) => paragraph.childElementCount === 0 && paragraph.textContent?.trim().toUpperCase() === "[TOC]");
  for (const placeholder of placeholders) placeholder.remove();

  const headings = [...article.querySelectorAll<HTMLHeadingElement>("h1, h2, h3, h4, h5, h6")];
  if (headings.length === 0) return undefined;

  const usedIds = new Set<string>();
  for (const heading of headings) {
    const base = heading.id || slugify(heading.textContent ?? "") || "section";
    let id = base;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${base}-${suffix}`;
      suffix += 1;
    }
    heading.id = id;
    usedIds.add(id);
  }

  const minimumLevel = Math.min(...headings.map(headingLevel));
  const sidebar = document.createElement("aside");
  sidebar.id = "linguamark-markdown-toc";
  sidebar.className = "linguamark-markdown-toc";
  sidebar.dataset.linguamarkUi = "";
  sidebar.setAttribute("aria-label", "文档目录");
  const title = document.createElement("p");
  title.className = "linguamark-markdown-toc-title";
  title.textContent = "目录";
  const navigation = document.createElement("nav");
  const list = document.createElement("ul");
  list.className = "linguamark-markdown-toc-list";
  for (const heading of headings) {
    const item = document.createElement("li");
    item.style.setProperty("--toc-depth", String(headingLevel(heading) - minimumLevel));
    const link = document.createElement("a");
    link.href = `#${heading.id}`;
    link.textContent = heading.textContent?.trim() || "未命名章节";
    item.append(link);
    list.append(item);
  }
  navigation.append(list);
  sidebar.append(title, navigation);
  return sidebar;
}

function initializeStandaloneFilePicker(viewer: ViewerElements): void {
  const button = viewer.openFileButton;
  if (!button) return;
  button.addEventListener("click", () => {
    void chooseStandaloneMarkdownFile(viewer);
  });
}

async function chooseStandaloneMarkdownFile(viewer: ViewerElements): Promise<void> {
  logInfo("content", "markdown.file-picker.requested");
  let handle: FileSystemFileHandle | undefined;
  try {
    [handle] = await window.showOpenFilePicker({
      startIn: "downloads",
      multiple: false,
      excludeAcceptAllOption: true,
      types: [{ description: "Markdown", accept: { "text/markdown": [".md"] } }],
    });
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === "AbortError") {
      logInfo("content", "markdown.file-picker.cancelled");
      return;
    }
    logWarn("content", "markdown.file-picker.request.failed", { errorName: errorName(error) });
    showDirectoryNotice("无法打开系统文件选择器");
    return;
  }
  if (!handle) {
    logInfo("content", "markdown.file-picker.cancelled");
    return;
  }

  logInfo("content", "markdown.file-picker.selected");
  if (await reuseStandaloneFileTab(handle, viewer)) return;
  await rememberStandaloneFileHandle(handle, viewer);
  await openStandaloneMarkdownFile(handle, viewer);
}

async function reuseStandaloneFileTab(handle: FileSystemFileHandle, viewer: ViewerElements): Promise<boolean> {
  try {
    const currentTab = await chrome.tabs.getCurrent();
    if (currentTab?.id === undefined) return false;
    viewer.directoryTabId = currentTab.id;

    const tabs = (await chrome.tabs.query({}))
      .filter((tab) => tab.id !== currentTab.id && tab.url?.split("#", 1)[0] === standaloneViewerUrl)
      .sort((left, right) => (right.lastAccessed ?? 0) - (left.lastAccessed ?? 0));
    for (const tab of tabs) {
      if (tab.id === undefined) continue;
      const existingHandle = await getStoredFileHandle(tab.id);
      if (!existingHandle || !(await handle.isSameEntry(existingHandle))) continue;

      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      await chrome.tabs.reload(tab.id);
      if (!viewer.currentItem) await chrome.tabs.remove(currentTab.id);
      logInfo("content", "markdown.file-picker.reused", { tabId: tab.id });
      return true;
    }
  } catch (error: unknown) {
    logWarn("content", "markdown.file-picker.reuse.failed", { errorName: errorName(error) });
  }
  return false;
}

async function rememberStandaloneFileHandle(handle: FileSystemFileHandle, viewer: ViewerElements): Promise<void> {
  const tabId = viewer.directoryTabId ?? (await chrome.tabs.getCurrent())?.id;
  if (tabId === undefined) return;
  viewer.directoryTabId = tabId;
  try {
    await deleteStoredDirectoryHandle(tabId);
    await storeFileHandle(handle, tabId);
  } catch (error: unknown) {
    logWarn("content", "markdown.file-picker.persist.failed", { errorName: errorName(error) });
  }
}

async function openStandaloneMarkdownFile(handle: FileSystemFileHandle, viewer: ViewerElements): Promise<boolean> {
  try {
    const file = await handle.getFile();
    if (!MARKDOWN_PATH.test(file.name)) throw new Error("请选择 Markdown 文件");
    renderStandaloneMarkdown(await file.text(), file.name, viewer);
    logInfo("content", "markdown.file-picker.opened");
    return true;
  } catch (error: unknown) {
    logWarn("content", "markdown.file-picker.open.failed", { errorName: errorName(error) });
    showDirectoryNotice(error instanceof Error ? error.message : "无法打开 Markdown 文件");
    return false;
  }
}

function renderStandaloneMarkdown(source: string, name: string, viewer: ViewerElements): void {
  const { article, customCss } = createArticle(source);
  const sidebar = createTableOfContents(article);
  directoryRenderSequence += 1;
  disableStandaloneRelativeResources(article);
  viewer.content.replaceChildren(article);
  viewer.setContentCount(source);
  viewer.setSidebar("outline", sidebar, true);
  viewer.setPath(name);
  setViewerCurrentItem(viewer, { kind: "file", path: name });
  viewer.openDirectoryButton.textContent = "打开目录";
  replaceCustomStyle(customCss);
  document.title = article.querySelector("h1")?.textContent?.trim() || name;
  resetLocationHash();
  setActiveDirectoryPath("");
  clearDirectoryNotice();
  dispatchEvent(new CustomEvent("linguamark:content-replaced"));
  void renderDiagrams(article);
}

function disableStandaloneRelativeResources(article: HTMLElement): void {
  for (const image of article.querySelectorAll<HTMLImageElement>("img[src]")) {
    const source = image.getAttribute("src");
    if (!source || source.startsWith("#") || isExternalReference(source)) continue;
    image.removeAttribute("src");
    image.removeAttribute("srcset");
    image.classList.add("linguamark-directory-image-error");
    image.title = "打开目录后才能读取相对图片";
  }
  for (const anchor of article.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    const href = anchor.getAttribute("href");
    if (!href || href.startsWith("#") || isExternalReference(href)) continue;
    anchor.removeAttribute("href");
    anchor.classList.add("linguamark-directory-link-disabled");
    anchor.setAttribute("aria-disabled", "true");
  }
}

async function initializeDirectoryBrowser(viewer: ViewerElements): Promise<void> {
  let storedFileHandle: FileSystemFileHandle | undefined;
  if (viewer.openFileButton) {
    const tab = await chrome.tabs.getCurrent();
    if (tab?.id === undefined) {
      showDirectoryNotice("无法识别当前阅读器标签页");
      return;
    }
    viewer.directoryTabId = tab.id;
    try {
      storedFileHandle = await getStoredFileHandle(tab.id);
    } catch (error: unknown) {
      logWarn("content", "markdown.file-picker.restore.failed", { errorName: errorName(error) });
    }
  } else {
    try {
      viewer.directDirectorySession = sessionStorage.getItem(VIEWER_DIRECT_DIRECTORY_KEY) === "true";
    } catch (error: unknown) {
      logWarn("directory", "viewer.session.load.failed", { errorName: errorName(error) });
    }
  }
  viewer.directoryInput?.addEventListener("cancel", () => {
    viewer.pendingDirectoryItem = undefined;
    logInfo("directory", "viewer.picker.cancelled");
  });
  viewer.directoryInput?.addEventListener("change", () => {
    void selectDirectoryFiles(viewer);
  });
  viewer.openDirectoryButton.addEventListener("click", () => {
    void openDirectoryPicker(viewer);
  });
  if (storedFileHandle && await openStandaloneMarkdownFile(storedFileHandle, viewer)) return;
  await refreshDirectoryBrowser(viewer);
}

async function openDirectoryPicker(viewer: ViewerElements, pendingItem?: ViewerItem): Promise<void> {
  viewer.pendingDirectoryItem = pendingItem;
  logInfo("directory", "viewer.picker.requested");
  if (viewer.directoryInput) {
    viewer.directoryInput.value = "";
    viewer.directoryInput.click();
    return;
  }

  try {
    const handle = await window.showDirectoryPicker({ startIn: "downloads", mode: "read" });
    viewer.directoryHandle = handle;
    logInfo("directory", "viewer.picker.selected");
    if (viewer.openFileButton) {
      try {
        const tabId = viewer.directoryTabId ?? (await chrome.tabs.getCurrent())?.id;
        if (tabId === undefined) throw new Error("无法识别当前阅读器标签页");
        viewer.directoryTabId = tabId;
        await deleteStoredFileHandle(tabId);
        await storeDirectoryHandle(handle, tabId);
      } catch (error: unknown) {
        logWarn("directory", "viewer.picker.persist.failed", { errorName: errorName(error) });
      }
    } else {
      viewer.directDirectorySession = true;
      try {
        sessionStorage.setItem(VIEWER_DIRECT_DIRECTORY_KEY, "true");
      } catch (error: unknown) {
        logWarn("directory", "viewer.session.save.failed", { errorName: errorName(error) });
      }
    }
    await handleDirectoryStateChanged(viewer);
  } catch (error: unknown) {
    if (viewer.pendingDirectoryItem === pendingItem) viewer.pendingDirectoryItem = undefined;
    if (error instanceof DOMException && error.name === "AbortError") {
      logInfo("directory", "viewer.picker.cancelled");
      return;
    }
    logWarn("directory", "viewer.picker.failed", { errorName: errorName(error) });
    showDirectoryNotice(error instanceof Error ? error.message : "无法打开系统目录选择器");
  }
}

async function selectDirectoryFiles(viewer: ViewerElements): Promise<void> {
  const input = viewer.directoryInput;
  const files = input ? [...(input.files ?? [])] : [];
  if (input) input.value = "";
  if (files.length === 0) {
    viewer.pendingDirectoryItem = undefined;
    logInfo("directory", "viewer.picker.cancelled");
    return;
  }

  try {
    const selection = createDirectoryFileSelection(files);
    viewer.directoryHandle = undefined;
    viewer.directoryFiles = selection.files;
    viewer.directoryFileState = selection.state;
    viewer.directDirectorySession = true;
    try {
      sessionStorage.setItem(VIEWER_DIRECT_DIRECTORY_KEY, "true");
    } catch (error: unknown) {
      logWarn("directory", "viewer.session.save.failed", { errorName: errorName(error) });
    }
    logInfo("directory", "viewer.picker.selected");
    await handleDirectoryStateChanged(viewer);
  } catch (error: unknown) {
    viewer.pendingDirectoryItem = undefined;
    logWarn("directory", "viewer.picker.failed", { errorName: errorName(error) });
    showDirectoryNotice(error instanceof Error ? error.message : "无法读取所选目录");
  }
}

async function handleDirectoryStateChanged(viewer: ViewerElements): Promise<void> {
  const pendingItem = viewer.pendingDirectoryItem;
  viewer.pendingDirectoryItem = undefined;
  await refreshDirectoryBrowser(viewer, true);
  if (!pendingItem) return;

  const expectedDirectory = viewerItemDirectoryName(pendingItem);
  if (!expectedDirectory || viewer.directoryRootName !== expectedDirectory) {
    showDirectoryNotice(`目标位于目录“${expectedDirectory ?? pendingItem.path}”，请授权该目录后重试`);
    return;
  }
  await openViewerItem(pendingItem, viewer);
}

async function readViewerDirectoryState(viewer: ViewerElements): Promise<DirectoryBrowserState> {
  if (viewer.directoryFileState) return viewer.directoryFileState;
  if (viewer.directoryHandle) return readDirectoryHandleState(viewer.directoryHandle);
  if (viewer.directDirectorySession) return { status: "none" };
  const response: unknown = await chrome.runtime.sendMessage({ type: "GET_DIRECTORY_STATE" });
  if (!isRecord(response) || response.ok !== true || !isDirectoryBrowserState(response.state)) {
    throw new Error(isRecord(response) && typeof response.error === "string" ? response.error : "无法读取目录状态");
  }
  return response.state;
}

function createDirectoryFileSelection(selectedFiles: File[]): DirectoryFileSelection {
  const files = new Map<string, File>();
  const directories = new Map<string, DirectoryTreeEntry>();
  const entries: DirectoryTreeEntry[] = [];
  let rootName: string | undefined;

  for (const file of selectedFiles) {
    const parts = file.webkitRelativePath.split("/");
    const nextRoot = parts.shift();
    const path = parts.join("/");
    if (!nextRoot || parts.length === 0 || !parseDirectoryPath(path)) throw new Error("目录文件路径无效");
    if (rootName && rootName !== nextRoot) throw new Error("请选择单个目录");
    rootName = nextRoot;
    files.set(path, file);

    let children = entries;
    let parentPath = "";
    for (const name of parts.slice(0, -1)) {
      const directoryPath = parentPath ? `${parentPath}/${name}` : name;
      let directory = directories.get(directoryPath);
      if (!directory) {
        directory = { name, path: directoryPath, type: "directory", children: [] };
        directories.set(directoryPath, directory);
        children.push(directory);
      }
      children = directory.children!;
      parentPath = directoryPath;
    }
    children.push({
      name: parts.at(-1)!,
      path,
      type: "file",
      fileKind: directoryFileKind(path),
    });
  }

  if (!rootName) throw new Error("所选目录为空");
  sortDirectoryEntries(entries);
  return { state: { status: "granted", rootName, entries }, files };
}

function sortDirectoryEntries(entries: DirectoryTreeEntry[]): void {
  for (const entry of entries) {
    if (entry.type === "directory" && entry.children) sortDirectoryEntries(entry.children);
  }
  entries.sort((left, right) => {
    if (left.type !== right.type) return left.type === "directory" ? -1 : 1;
    return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
  });
}

async function refreshDirectoryBrowser(viewer: ViewerElements, resetCurrent = false): Promise<void> {
  const button = viewer.openDirectoryButton;
  button.disabled = true;
  try {
    const state = await readViewerDirectoryState(viewer);
    directoryImageCache.clear();
    if (state.status === "granted") {
      viewer.directoryRootName = state.rootName;
      if (state.rootName && (resetCurrent || !viewer.currentItem)) {
        viewer.setPath(state.rootName);
        setViewerCurrentItem(viewer, { kind: "directory", path: state.rootName });
      }
      button.textContent = "更换目录";
      const sidebar = createDirectorySidebar(state, viewer);
      viewer.setSidebar("files", sidebar, true);
      setActiveDirectoryPath(currentDirectoryPath(viewer, sidebar));
      updateViewerFavoriteButton(viewer);
      renderViewerLibrary(viewer);
      clearDirectoryNotice();
      return;
    }

    viewer.directoryRootName = undefined;
    viewer.setSidebar("files", undefined);
    button.textContent = state.status === "none" ? "打开目录" : "重新授权";
  } catch (error: unknown) {
    viewer.directoryRootName = undefined;
    logWarn("directory", "viewer.state.failed", { errorName: errorName(error) });
    showDirectoryNotice(error instanceof Error ? error.message : "无法读取目录状态");
  } finally {
    button.disabled = false;
  }
}

function createDirectorySidebar(state: DirectoryBrowserState, viewer: ViewerElements): HTMLElement {
  const sidebar = document.createElement("aside");
  sidebar.id = "linguamark-markdown-toc";
  sidebar.className = "linguamark-markdown-toc linguamark-directory-sidebar";
  sidebar.dataset.linguamarkUi = "";
  sidebar.setAttribute("aria-label", "目录文件树");
  const panel = document.createElement("div");
  panel.className = "linguamark-directory-tree";
  const title = document.createElement("p");
  title.className = "linguamark-markdown-toc-title";
  title.textContent = state.rootName ?? "文件";
  panel.append(title);

  if (!state.entries || state.entries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "linguamark-directory-empty";
    empty.textContent = "目录为空";
    panel.append(empty);
    sidebar.append(panel);
    return sidebar;
  }

  const tree = document.createElement("ul");
  tree.className = "linguamark-directory-list";
  tree.addEventListener("contextmenu", (event) => {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement>("[data-directory-path]")
      : null;
    if (!target || !tree.contains(target)) return;
    event.preventDefault();
    showDirectoryContextMenu(event, target, viewer);
  });
  for (const entry of state.entries) tree.append(createDirectoryTreeItem(entry, viewer));

  const controls = document.createElement("div");
  controls.className = "linguamark-directory-toolbar";
  controls.setAttribute("role", "toolbar");
  controls.setAttribute("aria-label", "文件树控制");
  const folderToggle = document.createElement("button");
  folderToggle.type = "button";
  folderToggle.className = "linguamark-markdown-directory-button linguamark-directory-toolbar-button";
  const updateFolderToggle = (): void => {
    const folders = [...tree.querySelectorAll<HTMLDetailsElement>("details")];
    const allExpanded = folders.length > 0 && folders.every((folder) => folder.open);
    folderToggle.disabled = folders.length === 0;
    folderToggle.textContent = allExpanded ? "全部折叠" : "全部展开";
    folderToggle.setAttribute("aria-pressed", String(allExpanded));
  };
  folderToggle.addEventListener("click", () => {
    const expand = folderToggle.getAttribute("aria-pressed") !== "true";
    for (const details of tree.querySelectorAll<HTMLDetailsElement>("details")) details.open = expand;
    updateFolderToggle();
  });
  tree.addEventListener("toggle", updateFolderToggle, true);
  updateFolderToggle();

  const focusButton = document.createElement("button");
  focusButton.type = "button";
  focusButton.className = "linguamark-markdown-directory-button linguamark-directory-toolbar-button linguamark-directory-focus-button";
  focusButton.textContent = "定位当前文件";
  focusButton.title = "在文件列表中定位当前打开的文件";
  focusButton.disabled = true;
  focusButton.addEventListener("click", () => {
    const path = tree.querySelector<HTMLButtonElement>(".linguamark-directory-file.is-active")?.dataset.directoryPath;
    if (path) setActiveDirectoryPath(path);
  });
  controls.append(folderToggle, focusButton);
  panel.append(tree);
  sidebar.append(controls, panel);
  return sidebar;
}

function createDirectoryTreeItem(entry: DirectoryTreeEntry, viewer: ViewerElements): HTMLLIElement {
  const item = document.createElement("li");
  if (entry.type === "directory") {
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.dataset.directoryPath = entry.path;
    summary.setAttribute("aria-haspopup", "menu");
    summary.textContent = entry.name;
    summary.title = entry.path;
    const children = document.createElement("ul");
    children.className = "linguamark-directory-list";
    for (const child of entry.children ?? []) children.append(createDirectoryTreeItem(child, viewer));
    details.append(summary, children);
    item.append(details);
    return item;
  }

  const kind = entry.fileKind ?? "other";
  const button = document.createElement("button");
  button.type = "button";
  button.className = `linguamark-directory-file is-${kind}`;
  button.dataset.directoryPath = entry.path;
  button.dataset.fileKind = kind;
  button.setAttribute("aria-haspopup", "menu");
  button.title = entry.path;
  if (kind === "other") {
    button.setAttribute("aria-disabled", "true");
    button.setAttribute("aria-label", `${entry.name}，不支持打开`);
    button.addEventListener("click", (event) => event.stopPropagation());
  }
  const badge = document.createElement("span");
  badge.className = "linguamark-directory-file-badge";
  badge.setAttribute("aria-hidden", "true");
  badge.textContent = kind === "markdown" ? "MD" : kind === "image" ? "IMG" : "FILE";
  const name = document.createElement("span");
  name.className = "linguamark-directory-file-name";
  name.textContent = entry.name;
  button.append(badge, name);
  if (kind !== "other") {
    button.addEventListener("click", () => {
      void openDirectoryEntry(entry.path, kind, viewer);
    });
  }
  item.append(button);
  return item;
}

function showDirectoryContextMenu(event: MouseEvent, target: HTMLElement, viewer: ViewerElements): void {
  const relativePath = target.dataset.directoryPath;
  if (!relativePath) return;
  closeDirectoryContextMenu?.(false);

  const menu = document.createElement("div");
  menu.className = "linguamark-directory-context-menu";
  menu.dataset.linguamarkUi = "";
  menu.popover = "manual";
  menu.role = "menu";
  menu.setAttribute("aria-label", "项目操作");

  const controller = new AbortController();
  let restoreFocus = true;
  const closeMenu = (shouldRestoreFocus = true): void => {
    restoreFocus = shouldRestoreFocus;
    controller.abort();
    if (closeDirectoryContextMenu === closeMenu) closeDirectoryContextMenu = undefined;
    if (menu.matches(":popover-open")) menu.hidePopover();
    else menu.remove();
  };
  closeDirectoryContextMenu = closeMenu;

  const buttons: HTMLButtonElement[] = [];
  const addButton = (label: string, action: () => void): void => {
    const button = document.createElement("button");
    button.type = "button";
    button.role = "menuitem";
    button.textContent = label;
    button.addEventListener("click", () => {
      closeMenu();
      action();
    });
    buttons.push(button);
  };
  const copyToClipboard = (value: string): void => {
    void navigator.clipboard.writeText(value).catch((error: unknown) => {
      logWarn("directory", "viewer.clipboard.copy.failed", { errorName: errorName(error) });
      showDirectoryNotice("无法复制到剪贴板");
    });
  };

  addButton("Copy Relative Path", () => copyToClipboard(relativePath));
  addButton("Copy Name", () => copyToClipboard(relativePath.split("/").at(-1) ?? relativePath));

  if (target.dataset.fileKind !== undefined) {
    const item: ViewerItem = {
      kind: "file",
      path: viewer.directoryRootName ? `${viewer.directoryRootName}/${relativePath}` : relativePath,
    };
    const saved = isViewerFavorite(item, viewer);
    addButton(saved ? "Remove from Favorites" : "Add to Favorites", () => {
      void toggleViewerFavorite(viewer, item);
    });
  } else {
    const folder = target.closest<HTMLDetailsElement>("details");
    if (folder) {
      const setSubtreeExpanded = (expanded: boolean): void => {
        folder.open = expanded;
        for (const descendant of folder.querySelectorAll<HTMLDetailsElement>("details")) descendant.open = expanded;
      };
      addButton("Expand Subtree", () => setSubtreeExpanded(true));
      addButton("Collapse Subtree", () => setSubtreeExpanded(false));
    }
  }

  menu.addEventListener("keydown", (keyboardEvent) => {
    if (keyboardEvent.key !== "ArrowDown" && keyboardEvent.key !== "ArrowUp") return;
    keyboardEvent.preventDefault();
    const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const offset = keyboardEvent.key === "ArrowDown" ? 1 : -1;
    buttons[(currentIndex + offset + buttons.length) % buttons.length].focus();
  });
  menu.addEventListener("toggle", (toggleEvent) => {
    if (toggleEvent.newState !== "closed") return;
    menu.remove();
    if (restoreFocus && target.isConnected) target.focus({ preventScroll: true });
  });
  menu.append(...buttons);

  const targetBounds = target.getBoundingClientRect();
  const fromKeyboard = event.clientX === 0 && event.clientY === 0;
  menu.style.left = `${fromKeyboard ? targetBounds.left : event.clientX}px`;
  menu.style.top = `${fromKeyboard ? targetBounds.bottom : event.clientY}px`;
  document.body.append(menu);
  menu.showPopover();
  document.addEventListener("pointerdown", (pointerEvent) => {
    if (!(pointerEvent.target instanceof Node) || !menu.contains(pointerEvent.target)) closeMenu(false);
  }, { capture: true, signal: controller.signal });
  document.addEventListener("keydown", (keyboardEvent) => {
    if (keyboardEvent.key !== "Escape") return;
    keyboardEvent.preventDefault();
    keyboardEvent.stopPropagation();
    closeMenu();
  }, { capture: true, signal: controller.signal });
  const menuBounds = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(menuBounds.left, innerWidth - menuBounds.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(menuBounds.top, innerHeight - menuBounds.height - 8))}px`;
  buttons[0].focus();
}

async function openDirectoryEntry(
  path: string,
  kind: DirectoryFileKind,
  viewer: ViewerElements,
  hash?: string,
): Promise<void> {
  try {
    const file = await readDirectoryFile(path, viewer);
    if (kind === "markdown" && file.kind === "markdown") {
      renderDirectoryMarkdown(file, viewer, hash);
    } else if (kind === "image" && file.kind === "image") {
      renderDirectoryImage(file, viewer);
    } else {
      throw new Error("文件类型与读取结果不匹配");
    }
    setActiveDirectoryPath(path);
    setViewerCurrentItem(viewer, {
      kind: "file",
      path: viewer.directoryRootName ? `${viewer.directoryRootName}/${path}` : path,
    });
    clearDirectoryNotice();
  } catch (error: unknown) {
    logWarn("directory", "viewer.file.failed", { kind, errorName: errorName(error) });
    showDirectoryNotice(error instanceof Error ? error.message : "无法打开文件");
  }
}

async function readDirectoryFile(path: string, viewer: ViewerElements): Promise<DirectoryFileContent> {
  if (viewer.directoryFiles) {
    const file = viewer.directoryFiles.get(path);
    if (!file) throw new Error("目录中不存在此文件");
    return readDirectoryFileContent(file, path);
  }
  if (viewer.directoryHandle) return readDirectoryHandleFile(viewer.directoryHandle, path);
  const response: unknown = await chrome.runtime.sendMessage({ type: "READ_DIRECTORY_FILE", path });
  if (!isRecord(response) || response.ok !== true || !isRecord(response.file)) {
    throw new Error(isRecord(response) && typeof response.error === "string" ? response.error : "无法读取文件");
  }
  const file = response.file;
  if (file.kind === "markdown" && typeof file.path === "string" && typeof file.text === "string") {
    return { kind: "markdown", path: file.path, text: file.text };
  }
  if (file.kind === "image" && typeof file.path === "string" && typeof file.dataUrl === "string") {
    return { kind: "image", path: file.path, dataUrl: file.dataUrl };
  }
  throw new Error("文件读取结果无效");
}

function renderDirectoryMarkdown(file: Extract<DirectoryFileContent, { kind: "markdown" }>, viewer: ViewerElements, hash?: string): void {
  const { article, customCss } = createArticle(file.text);
  viewer.setSidebar("outline", createTableOfContents(article));
  const renderId = ++directoryRenderSequence;
  prepareDirectoryDocument(article, file.path, viewer, renderId);
  viewer.content.replaceChildren(article);
  viewer.setContentCount(file.text);
  viewer.setPath(file.path);
  replaceCustomStyle(customCss);
  document.title = article.querySelector("h1")?.textContent?.trim() || file.path.split("/").at(-1) || "Markdown";
  resetLocationHash();
  dispatchEvent(new CustomEvent("linguamark:content-replaced"));
  void renderDiagrams(article);
  if (hash) {
    window.setTimeout(() => {
      article.querySelector(`#${CSS.escape(decodeURIComponentSafely(hash))}`)?.scrollIntoView();
    }, 0);
  }
}

function renderDirectoryImage(file: Extract<DirectoryFileContent, { kind: "image" }>, viewer: ViewerElements): void {
  directoryRenderSequence += 1;
  viewer.setSidebar("outline", undefined);
  const article = document.createElement("article");
  article.id = "write";
  article.className = "linguamark-directory-image-preview";
  article.dataset.linguamarkIgnore = "";
  const figure = document.createElement("figure");
  const image = document.createElement("img");
  image.src = file.dataUrl;
  image.alt = file.path.split("/").at(-1) ?? "图片";
  const caption = document.createElement("figcaption");
  caption.textContent = file.path;
  figure.append(image, caption);
  article.append(figure);
  viewer.content.replaceChildren(article);
  viewer.setContentCount("");
  viewer.setPath(file.path);
  replaceCustomStyle("");
  document.title = image.alt;
  resetLocationHash();
  dispatchEvent(new CustomEvent("linguamark:content-replaced"));
}

function prepareDirectoryDocument(article: HTMLElement, currentPath: string, viewer: ViewerElements, renderId: number): void {
  for (const image of article.querySelectorAll<HTMLImageElement>("img[src]")) {
    const reference = image.getAttribute("src");
    if (!reference || isExternalReference(reference) || reference.startsWith("#")) continue;
    const resolved = resolveDirectoryReference(currentPath, reference);
    image.removeAttribute("srcset");
    image.removeAttribute("src");
    if (!resolved || directoryFileKind(resolved.path) !== "image") {
      image.classList.add("linguamark-directory-image-error");
      continue;
    }
    image.classList.add("linguamark-directory-image-loading");
    void loadDirectoryImage(image, resolved.path, article, viewer, renderId);
  }

  for (const anchor of article.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    const reference = anchor.getAttribute("href");
    if (!reference || reference.startsWith("#") || isExternalReference(reference)) continue;
    const resolved = resolveDirectoryReference(currentPath, reference);
    const kind = resolved ? directoryFileKind(resolved.path) : "other";
    if (!resolved || kind === "other") {
      anchor.removeAttribute("href");
      anchor.classList.add("linguamark-directory-link-disabled");
      anchor.setAttribute("aria-disabled", "true");
      continue;
    }
    anchor.href = "#";
    anchor.addEventListener("click", (event) => {
      event.preventDefault();
      void openDirectoryEntry(resolved.path, kind, viewer, resolved.hash);
    });
  }
}

async function loadDirectoryImage(
  image: HTMLImageElement,
  path: string,
  article: HTMLElement,
  viewer: ViewerElements,
  renderId: number,
): Promise<void> {
  try {
    let dataUrl = directoryImageCache.get(path);
    if (!dataUrl) {
      const file = await readDirectoryFile(path, viewer);
      if (file.kind !== "image") throw new Error("相对资源不是图片");
      dataUrl = file.dataUrl;
      directoryImageCache.set(path, dataUrl);
    }
    if (renderId !== directoryRenderSequence || !article.isConnected) return;
    image.src = dataUrl;
    image.classList.remove("linguamark-directory-image-loading");
  } catch (error: unknown) {
    if (renderId !== directoryRenderSequence) return;
    image.classList.remove("linguamark-directory-image-loading");
    image.classList.add("linguamark-directory-image-error");
    image.title = error instanceof Error ? error.message : "无法加载图片";
  }
}

function resolveDirectoryReference(currentPath: string, reference: string): ResolvedDirectoryReference | undefined {
  const hashIndex = reference.indexOf("#");
  const hash = hashIndex >= 0 ? reference.slice(hashIndex + 1) : undefined;
  const beforeHash = hashIndex >= 0 ? reference.slice(0, hashIndex) : reference;
  const pathValue = beforeHash.split("?", 1)[0];
  if (!pathValue) return undefined;

  const decoded = decodeURIComponentSafely(pathValue).replaceAll("\\", "/");
  const parts = decoded.startsWith("/") ? [] : currentPath.split("/").slice(0, -1);
  for (const part of decoded.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return undefined;
      parts.pop();
    } else if (part.includes("\0")) {
      return undefined;
    } else {
      parts.push(part);
    }
  }
  return parts.length > 0 ? { path: parts.join("/"), ...(hash ? { hash } : {}) } : undefined;
}

function isExternalReference(reference: string): boolean {
  return /^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(reference);
}

function currentDirectoryPath(viewer: ViewerElements, sidebar: HTMLElement): string {
  if (viewer.currentItem?.kind !== "file" || !viewer.directoryRootName) return "";
  const parts = viewer.currentItem.path.replaceAll("\\", "/").split("/");
  for (let index = parts.length - 2; index >= 0; index -= 1) {
    if (parts[index] !== viewer.directoryRootName) continue;
    const path = parts.slice(index + 1).join("/");
    if (sidebar.querySelector(`.linguamark-directory-file[data-directory-path="${CSS.escape(path)}"]`)) return path;
  }
  return "";
}

function setActiveDirectoryPath(path: string): void {
  let activeFile: HTMLButtonElement | undefined;
  for (const button of document.querySelectorAll<HTMLButtonElement>(".linguamark-directory-file[data-directory-path]")) {
    const isActive = button.dataset.directoryPath === path;
    button.classList.toggle("is-active", isActive);
    if (isActive) {
      button.setAttribute("aria-current", "page");
      activeFile = button;
    } else {
      button.removeAttribute("aria-current");
    }
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>(".linguamark-directory-focus-button")) {
    button.disabled = !activeFile;
  }
  if (!activeFile) return;
  for (let folder = activeFile.closest("details"); folder; folder = folder.parentElement?.closest("details") ?? null) {
    folder.open = true;
  }
  activeFile.scrollIntoView({ block: "center", inline: "nearest" });
  activeFile.focus({ preventScroll: true });
}

function resetLocationHash(): void {
  if (!location.hash) return;
  try {
    history.replaceState(null, "", location.href.slice(0, -location.hash.length));
  } catch {
    location.hash = "";
  }
}

function showDirectoryNotice(message: string): void {
  clearDirectoryNotice();
  const notice = document.createElement("aside");
  notice.className = "linguamark-markdown-error linguamark-directory-notice";
  notice.dataset.linguamarkUi = "";
  notice.role = "status";
  notice.textContent = message;
  document.body.append(notice);
}

function clearDirectoryNotice(): void {
  document.querySelector(".linguamark-directory-notice")?.remove();
}

function isDirectoryBrowserState(value: unknown): value is DirectoryBrowserState {
  if (!isRecord(value) || !["none", "granted", "prompt", "denied"].includes(String(value.status))) return false;
  return value.entries === undefined || Array.isArray(value.entries);
}

function decodeURIComponentSafely(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function headingLevel(heading: HTMLHeadingElement): number {
  return Number.parseInt(heading.tagName.slice(1), 10);
}

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .toLocaleLowerCase()
    .replaceAll(/[^\p{Letter}\p{Number}\s-]/gu, "")
    .trim()
    .replaceAll(/\s+/gu, "-")
    .replaceAll(/-+/gu, "-");
}

function showFallbackNotice(): void {
  const notice = document.createElement("aside");
  notice.className = "linguamark-markdown-error";
  notice.dataset.linguamarkUi = "";
  notice.role = "status";
  notice.textContent = "LinguaMark 无法渲染此 Markdown，已保留原始内容。";
  document.body?.prepend(notice);
}

function localMarkdownPath(): string {
  return decodeURIComponentSafely(location.pathname) || markdownFileName();
}

function markdownFileName(): string {
  const encoded = location.pathname.split("/").at(-1) || "Markdown";
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

function escapeHtml(value: string): string {
  return value.replaceAll(/[&<>"']/gu, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character]!);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}
