const DIRECTORY_DB_NAME = "linguamark-directory";
const DIRECTORY_STORE_NAME = "handles";
const DIRECTORY_HANDLE_KEY = "root";

const IMAGE_MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
};

export type DirectoryFileKind = "markdown" | "image" | "other";
export type DirectoryAccessState = "none" | "granted" | "prompt" | "denied";

export interface DirectoryTreeEntry {
  name: string;
  path: string;
  type: "directory" | "file";
  fileKind?: DirectoryFileKind;
  children?: DirectoryTreeEntry[];
}

export interface DirectoryBrowserState {
  status: DirectoryAccessState;
  rootName?: string;
  entries?: DirectoryTreeEntry[];
}

export type DirectoryFileContent =
  | { kind: "markdown"; path: string; text: string }
  | { kind: "image"; path: string; dataUrl: string };

export function directoryFileKind(name: string): DirectoryFileKind {
  const extension = fileExtension(name);
  if (extension === ".md") return "markdown";
  return IMAGE_MIME_TYPES[extension] ? "image" : "other";
}

export function parseDirectoryPath(value: unknown): string[] | undefined {
  if (typeof value !== "string") return undefined;
  if (value === "") return [];
  const parts = value.split("/");
  return parts.every((part) => part !== "" && part !== "." && part !== ".." && !part.includes("\0"))
    ? parts
    : undefined;
}

export async function getStoredDirectoryHandle(tabId?: number): Promise<FileSystemDirectoryHandle | undefined> {
  const database = await openDirectoryDatabase();
  try {
    const value = await requestValue(database.transaction(DIRECTORY_STORE_NAME).objectStore(DIRECTORY_STORE_NAME).get(directoryHandleKey(tabId)));
    return isDirectoryHandle(value) ? value : undefined;
  } finally {
    database.close();
  }
}

export async function storeDirectoryHandle(handle: FileSystemDirectoryHandle, tabId?: number): Promise<void> {
  const database = await openDirectoryDatabase();
  try {
    const transaction = database.transaction(DIRECTORY_STORE_NAME, "readwrite");
    transaction.objectStore(DIRECTORY_STORE_NAME).put(handle, directoryHandleKey(tabId));
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
}

export async function deleteStoredDirectoryHandle(tabId: number): Promise<void> {
  const database = await openDirectoryDatabase();
  try {
    const transaction = database.transaction(DIRECTORY_STORE_NAME, "readwrite");
    transaction.objectStore(DIRECTORY_STORE_NAME).delete(directoryHandleKey(tabId));
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
}

export async function queryDirectoryPermission(handle: FileSystemDirectoryHandle): Promise<PermissionState> {
  return typeof handle.queryPermission === "function"
    ? handle.queryPermission({ mode: "read" })
    : "granted";
}

export async function requestDirectoryPermission(handle: FileSystemDirectoryHandle): Promise<PermissionState> {
  if (await queryDirectoryPermission(handle) === "granted") return "granted";
  return typeof handle.requestPermission === "function"
    ? handle.requestPermission({ mode: "read" })
    : "granted";
}

export async function readDirectoryState(tabId?: number): Promise<DirectoryBrowserState> {
  const root = await getStoredDirectoryHandle(tabId);
  if (!root) return { status: "none" };
  const status = await queryDirectoryPermission(root);
  if (status !== "granted") return { status, rootName: root.name };
  return { status, rootName: root.name, entries: await readDirectoryTree(root) };
}

export async function readStoredDirectoryFile(path: string, tabId?: number): Promise<DirectoryFileContent> {
  const parts = parseDirectoryPath(path);
  if (!parts || parts.length === 0) throw new Error("文件路径无效");
  const root = await getStoredDirectoryHandle(tabId);
  if (!root || await queryDirectoryPermission(root) !== "granted") throw new Error("目录需要重新授权");

  let directory = root;
  for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part);
  const name = parts.at(-1)!;
  const kind = directoryFileKind(name);
  if (kind === "other") throw new Error("不支持打开此文件类型");
  const file = await (await directory.getFileHandle(name)).getFile();
  if (kind === "markdown") return { kind, path, text: await file.text() };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const mimeType = IMAGE_MIME_TYPES[fileExtension(name)] || file.type || "application/octet-stream";
  return { kind, path, dataUrl: `data:${mimeType};base64,${bytesToBase64(bytes)}` };
}

async function readDirectoryTree(directory: FileSystemDirectoryHandle, parentPath = ""): Promise<DirectoryTreeEntry[]> {
  // ponytail: eager recursion is simplest for note folders; switch to lazy loading if very large trees become common.
  const entries: DirectoryTreeEntry[] = [];
  for await (const [name, handle] of directory.entries()) {
    const path = parentPath ? `${parentPath}/${name}` : name;
    entries.push(handle.kind === "directory"
      ? { name, path, type: "directory", children: await readDirectoryTree(handle as FileSystemDirectoryHandle, path) }
      : { name, path, type: "file", fileKind: directoryFileKind(name) });
  }
  return entries.sort((left, right) => {
    if (left.type !== right.type) return left.type === "directory" ? -1 : 1;
    return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
  });
}

function fileExtension(name: string): string {
  const index = name.lastIndexOf(".");
  return index < 0 ? "" : name.slice(index).toLowerCase();
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function directoryHandleKey(tabId?: number): string {
  return tabId === undefined ? DIRECTORY_HANDLE_KEY : `tab:${tabId}`;
}

function isDirectoryHandle(value: unknown): value is FileSystemDirectoryHandle {
  return typeof value === "object" && value !== null && "kind" in value && value.kind === "directory";
}

function openDirectoryDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DIRECTORY_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DIRECTORY_STORE_NAME)) {
        request.result.createObjectStore(DIRECTORY_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("无法打开目录存储"));
  });
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("无法读取目录存储"));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("无法保存目录授权"));
    transaction.onabort = () => reject(transaction.error ?? new Error("目录授权保存已取消"));
  });
}
