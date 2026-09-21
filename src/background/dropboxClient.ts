import { getDropboxAccessToken } from "./dropboxAuth";

const listFolderEndpoint = "https://api.dropboxapi.com/2/files/list_folder";
const continueListFolderEndpoint = "https://api.dropboxapi.com/2/files/list_folder/continue";

export type DropboxEntry = {
  id: string;
  name: string;
  path: string;
  type: "file" | "folder";
};

export type DropboxClientErrorCode =
  | "AUTH_EXPIRED"
  | "RATE_LIMITED"
  | "API_FAILURE"
  | "NETWORK_FAILURE";

export class DropboxClientError extends Error {
  constructor(
    public readonly code: DropboxClientErrorCode,
    message: string
  ) {
    super(message);
  }
}

type DropboxApiEntry = {
  ".tag": "file" | "folder" | "deleted";
  id?: string;
  name?: string;
  path_display?: string;
};

type ListFolderResponse = {
  entries: DropboxApiEntry[];
  cursor: string;
  has_more: boolean;
};

const inFlightFolderRequests = new Map<string, Promise<DropboxEntry[]>>();

function normalizeFolderReference(folderId: string): string {
  if (!folderId || folderId === "/") {
    return "";
  }

  return folderId;
}

async function postDropboxJson<T>(url: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await getDropboxAccessToken()}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
  } catch {
    throw new DropboxClientError("NETWORK_FAILURE", "Dropbox APIへ接続できませんでした。");
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new DropboxClientError("AUTH_EXPIRED", "Dropboxの認証が無効です。再接続してください。");
    }
    if (response.status === 429) {
      throw new DropboxClientError("RATE_LIMITED", "Dropbox APIの利用制限に達しました。少し待ってから再試行してください。");
    }
    throw new DropboxClientError("API_FAILURE", `Dropbox APIの取得に失敗しました（HTTP ${response.status}）。`);
  }

  return response.json() as Promise<T>;
}

function toEntry(entry: DropboxApiEntry): DropboxEntry | undefined {
  if (
    (entry[".tag"] !== "file" && entry[".tag"] !== "folder") ||
    !entry.id ||
    !entry.name ||
    !entry.path_display
  ) {
    return undefined;
  }

  return {
    id: entry.id,
    name: entry.name,
    path: entry.path_display,
    type: entry[".tag"]
  };
}

async function listFolderInternal(folderId: string): Promise<DropboxEntry[]> {
  const firstPage = await postDropboxJson<ListFolderResponse>(listFolderEndpoint, {
    // Dropbox accepts a folder ID here. IDs remain stable when a folder is renamed,
    // unlike display paths, which are retained only for the UI and generated prompt.
    path: folderId,
    recursive: false,
    include_deleted: false,
    include_mounted_folders: true,
    limit: 2_000
  });
  const entries = firstPage.entries.flatMap((entry) => {
    const mapped = toEntry(entry);
    return mapped ? [mapped] : [];
  });

  let page = firstPage;
  while (page.has_more) {
    page = await postDropboxJson<ListFolderResponse>(continueListFolderEndpoint, { cursor: page.cursor });
    entries.push(...page.entries.flatMap((entry) => {
      const mapped = toEntry(entry);
      return mapped ? [mapped] : [];
    }));
  }

  return entries.sort((left, right) => {
    if (left.type !== right.type) {
      return left.type === "folder" ? -1 : 1;
    }
    return left.name.localeCompare(right.name, "ja");
  });
}

/** Returns immediate children only; no recursive scan or file-content request is made. */
export function listDropboxFolder(folderId = ""): Promise<DropboxEntry[]> {
  const normalizedFolderId = normalizeFolderReference(folderId);
  const existing = inFlightFolderRequests.get(normalizedFolderId);
  if (existing) {
    return existing;
  }

  const request = listFolderInternal(normalizedFolderId).finally(() => {
    inFlightFolderRequests.delete(normalizedFolderId);
  });
  inFlightFolderRequests.set(normalizedFolderId, request);
  return request;
}
