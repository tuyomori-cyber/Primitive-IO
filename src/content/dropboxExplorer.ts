import { insertTextIntoEmptyComposer, sendComposer } from "./chatgptAdapter";

type DropboxAccount = {
  displayName: string;
  email: string;
};

type DropboxAuthStatus = {
  connected: boolean;
  account?: DropboxAccount;
};

type DropboxEntry = {
  id: string;
  name: string;
  path: string;
  type: "file" | "folder";
};

const rootFolderId = "";

function setStyles(element: HTMLElement, styles: Record<string, string>): void {
  for (const [property, value] of Object.entries(styles)) {
    element.style.setProperty(property, value, "important");
  }
}

function makeElement<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (text) {
    element.textContent = text;
  }
  return element;
}

function isSupportedFile(name: string): boolean {
  const lowered = name.toLowerCase();
  return lowered.endsWith(".md") || lowered.endsWith(".txt");
}

async function authStatus(): Promise<DropboxAuthStatus> {
  return browser.runtime.sendMessage({ type: "primitive-io:dropbox-status" }) as Promise<DropboxAuthStatus>;
}

async function listFolder(folderId: string): Promise<DropboxEntry[]> {
  return browser.runtime.sendMessage({ type: "primitive-io:dropbox-list-folder", folderId }) as Promise<DropboxEntry[]>;
}

async function getAutoSend(): Promise<boolean> {
  return browser.runtime.sendMessage({ type: "primitive-io:auto-send-get" }) as Promise<boolean>;
}

export function mountDropboxExplorer(): void {
  const existing = document.getElementById("primitive-io-explorer");
  if (existing) {
    return;
  }

  const launcher = makeElement("button", "Dropbox");
  launcher.type = "button";
  launcher.id = "primitive-io-launcher";
  setStyles(launcher, {
    all: "initial",
    display: "none",
    position: "fixed",
    "z-index": "2147483647",
    top: "88px",
    right: "16px",
    padding: "9px 12px",
    border: "1px solid #9aa0a6",
    "border-radius": "8px",
    background: "#ffffff",
    color: "#202124",
    "box-shadow": "0 4px 12px rgb(0 0 0 / 18%)",
    "font-family": "system-ui, sans-serif",
    "font-size": "14px",
    cursor: "pointer"
  });

  const panel = makeElement("aside");
  panel.id = "primitive-io-explorer";
  panel.setAttribute("aria-label", "Primitive IO Dropbox Explorer");
  setStyles(panel, {
    all: "initial",
    display: "block",
    position: "fixed",
    "z-index": "2147483647",
    top: "88px",
    right: "16px",
    width: "300px",
    "max-width": "calc(100vw - 32px)",
    "max-height": "calc(100vh - 112px)",
    overflow: "auto",
    border: "1px solid #9aa0a6",
    "border-radius": "10px",
    background: "#ffffff",
    color: "#202124",
    "box-shadow": "0 8px 24px rgb(0 0 0 / 18%)",
    "font-family": "system-ui, sans-serif",
    "font-size": "14px",
    "line-height": "1.4"
  });

  const header = makeElement("div");
  const title = makeElement("strong", "Dropbox");
  const account = makeElement("span", "確認中…");
  const refresh = makeElement("button", "↻");
  refresh.type = "button";
  refresh.title = "rootを再取得";
  const close = makeElement("button", "×");
  close.type = "button";
  close.title = "閉じる";
  const body = makeElement("div");
  const message = makeElement("p", "接続状態を確認しています…");
  const footer = makeElement("div");
  const selectionSummary = makeElement("span", "0 / 5件選択");
  const readButton = makeElement("button", "読み込み");
  readButton.type = "button";
  const notice = makeElement("p");
  const autoSendIndicator = makeElement("p", "自動送信: OFF");

  setStyles(header, {
    display: "flex",
    "align-items": "center",
    gap: "8px",
    padding: "12px",
    "border-bottom": "1px solid #dadce0"
  });
  setStyles(title, { "font-size": "16px" });
  setStyles(account, {
    flex: "1",
    overflow: "hidden",
    "text-overflow": "ellipsis",
    "white-space": "nowrap",
    color: "#5f6368",
    "font-size": "12px"
  });
  for (const button of [refresh, close]) {
    setStyles(button, {
      all: "initial",
      display: "inline-block",
      padding: "2px 6px",
      border: "0",
      background: "transparent",
      color: "#374151",
      "font-family": "system-ui, sans-serif",
      "font-size": "18px",
      cursor: "pointer"
    });
  }
  setStyles(body, { padding: "8px 0" });
  setStyles(message, { margin: "8px 12px", color: "#5f6368", "font-size": "13px" });
  setStyles(footer, { padding: "10px 12px", "border-top": "1px solid #dadce0" });
  setStyles(selectionSummary, { color: "#5f6368", "font-size": "12px" });
  setStyles(readButton, {
    all: "initial",
    float: "right",
    padding: "7px 12px",
    border: "0",
    "border-radius": "6px",
    background: "#2563eb",
    color: "#ffffff",
    "font-family": "system-ui, sans-serif",
    "font-size": "13px",
    cursor: "pointer"
  });
  setStyles(notice, { clear: "both", margin: "8px 0 0", "font-size": "12px", color: "#5f6368" });
  setStyles(autoSendIndicator, { margin: "8px 0 0", "font-size": "11px", color: "#5f6368" });

  panel.append(header, body, footer);
  header.append(title, account, refresh, close);
  footer.append(selectionSummary, readButton, notice, autoSendIndicator);
  document.body.append(launcher, panel);

  const entriesByFolderId = new Map<string, DropboxEntry[]>();
  const expandedFolderIds = new Set<string>();
  const loadingFolderIds = new Set<string>();
  const selectedEntries = new Map<string, DropboxEntry>();
  let available = false;
  let autoSend = false;

  function setMessage(text: string, color = "#5f6368"): void {
    message.textContent = text;
    message.style.color = color;
  }

  function showNotice(text: string, color = "#5f6368"): void {
    notice.textContent = text;
    notice.style.color = color;
  }

  function fileRow(entry: DropboxEntry, depth: number): HTMLElement {
    const row = makeElement("div");
    const supported = isSupportedFile(entry.name);
    row.title = entry.path;
    setStyles(row, {
      display: "flex",
      "align-items": "center",
      gap: "6px",
      padding: "5px 12px 5px " + (24 + depth * 16) + "px",
      color: supported ? "#202124" : "#9aa0a6",
      "font-size": "13px",
      "overflow-wrap": "anywhere"
    });

    if (supported) {
      const checkbox = makeElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = selectedEntries.has(entry.id);
      checkbox.setAttribute("aria-label", `${entry.name}を選択`);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          if (selectedEntries.size >= 5) {
            checkbox.checked = false;
            showNotice("選択できるファイルは最大5件です。", "#b3261e");
            return;
          }
          selectedEntries.set(entry.id, entry);
          showNotice("");
        } else {
          selectedEntries.delete(entry.id);
          showNotice("");
        }
        render();
      });
      row.append(checkbox);
    }

    const label = makeElement("span", `📄 ${entry.name}`);
    row.append(label);
    return row;
  }

  function renderFolder(folderId: string, depth: number, target: HTMLElement): void {
    const entries = entriesByFolderId.get(folderId);
    if (!entries) {
      const loading = makeElement("p", "読み込み中…");
      setStyles(loading, { margin: "6px 12px", color: "#5f6368", "font-size": "12px" });
      target.append(loading);
      return;
    }

    if (entries.length === 0 && folderId === rootFolderId) {
      const empty = makeElement("p", "Dropbox rootは空です。");
      setStyles(empty, { margin: "8px 12px", color: "#5f6368", "font-size": "13px" });
      target.append(empty);
      return;
    }

    for (const entry of entries) {
      if (entry.type === "file") {
        target.append(fileRow(entry, depth));
        continue;
      }

      const folder = makeElement("button");
      folder.type = "button";
      const expanded = expandedFolderIds.has(entry.id);
      folder.textContent = `${expanded ? "▼" : "▶"} 📁 ${entry.name}`;
      folder.title = entry.path;
      setStyles(folder, {
        all: "initial",
        display: "block",
        width: "100%",
        "box-sizing": "border-box",
        padding: "5px 12px 5px " + (8 + depth * 16) + "px",
        border: "0",
        background: "transparent",
        color: "#202124",
        "font-family": "system-ui, sans-serif",
        "font-size": "13px",
        "text-align": "left",
        cursor: "pointer",
        "overflow-wrap": "anywhere"
      });
      folder.addEventListener("click", () => {
        if (expandedFolderIds.has(entry.id)) {
          expandedFolderIds.delete(entry.id);
          render();
          return;
        }
        expandedFolderIds.add(entry.id);
        void load(entry.id);
      });
      target.append(folder);

      if (expanded) {
        const children = makeElement("div");
        target.append(children);
        if (loadingFolderIds.has(entry.id)) {
          const loading = makeElement("p", "読み込み中…");
          setStyles(loading, { margin: "6px 12px", color: "#5f6368", "font-size": "12px" });
          children.append(loading);
        } else {
          renderFolder(entry.id, depth + 1, children);
        }
      }
    }
  }

  function render(): void {
    body.replaceChildren();
    if (!available) {
      body.append(message);
      renderFooter();
      return;
    }
    renderFolder(rootFolderId, 0, body);
    renderFooter();
  }

  function renderFooter(): void {
    selectionSummary.textContent = `${selectedEntries.size} / 5件選択`;
    readButton.disabled = selectedEntries.size === 0;
    readButton.style.opacity = selectedEntries.size === 0 ? "0.5" : "1";
    readButton.style.cursor = selectedEntries.size === 0 ? "not-allowed" : "pointer";
    autoSendIndicator.textContent = `自動送信: ${autoSend ? "ON" : "OFF"}`;
  }

  async function load(folderId: string, force = false): Promise<void> {
    if (loadingFolderIds.has(folderId) || (!force && entriesByFolderId.has(folderId))) {
      render();
      return;
    }

    loadingFolderIds.add(folderId);
    render();
    try {
      entriesByFolderId.set(folderId, await listFolder(folderId));
    } catch (error) {
      if (folderId === rootFolderId) {
        available = false;
        setMessage(error instanceof Error ? error.message : "Dropboxフォルダを取得できませんでした。", "#b3261e");
      } else {
        expandedFolderIds.delete(folderId);
        showNotice(error instanceof Error ? error.message : "Dropboxフォルダを取得できませんでした。", "#b3261e");
      }
    } finally {
      loadingFolderIds.delete(folderId);
      render();
    }
  }

  async function start(): Promise<void> {
    try {
      const status = await authStatus();
      if (!status.connected) {
        available = false;
        account.textContent = "未接続";
        setMessage("Dropboxへ接続してください。", "#b3261e");
        render();
        return;
      }

      account.textContent = status.account ? `${status.account.displayName} (${status.account.email})` : "接続済み";
      available = true;
      await load(rootFolderId);
    } catch (error) {
      available = false;
      account.textContent = "エラー";
      setMessage(error instanceof Error ? error.message : "Dropbox接続状態を確認できませんでした。", "#b3261e");
      render();
    }
  }

  refresh.addEventListener("click", () => {
    entriesByFolderId.clear();
    expandedFolderIds.clear();
    selectedEntries.clear();
    showNotice("");
    void load(rootFolderId, true);
  });
  readButton.addEventListener("click", async () => {
    const paths = Array.from(selectedEntries.values()).map((entry) => entry.path);
    const prompt = [
      "Dropboxから以下のファイルを読み込み、この会話で参照できる状態にしてください。",
      "",
      ...paths
    ].join("\n");
    const result = insertTextIntoEmptyComposer(prompt);
    if (!result.ok) {
      showNotice(result.message, "#b3261e");
      return;
    }

    autoSend = await getAutoSend();
    renderFooter();
    if (!autoSend) {
      showNotice("プロンプトを入力欄へ投入しました。送信はしていません。", "#137333");
      return;
    }

    const sendResult = await sendComposer();
    showNotice(
      sendResult.ok ? "プロンプトを投入して送信しました。" : sendResult.message,
      sendResult.ok ? "#137333" : "#b3261e"
    );
  });
  close.addEventListener("click", () => {
    panel.style.display = "none";
    launcher.style.display = "block";
  });
  launcher.addEventListener("click", () => {
    launcher.style.display = "none";
    panel.style.display = "block";
  });

  void getAutoSend().then((enabled) => {
    autoSend = enabled;
    renderFooter();
  });
  void start();
}
