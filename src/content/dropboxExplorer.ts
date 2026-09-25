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

export type OutputFileEntry = Pick<DropboxEntry, "name" | "type">;

export function validateOutputBaseName(value: string): string | undefined {
  const name = value.trim();
  if (!name) return "ベースファイル名を入力してください。";
  if (name.includes("/")) return "ベースファイル名に / は使えません。";
  if (/\.[^.]+$/u.test(name)) return "拡張子は入力せず、ベースファイル名だけを指定してください。";
  return undefined;
}

export function determineOutputFileName(baseName: string, entries: OutputFileEntry[]): string {
  const input = baseName.trim();
  const match = input.match(/^(.*)-v(0|[1-9][0-9]*)$/u);
  const stem = match ? match[1] : input;
  const inputVersion = match ? Number(match[2]) : 0;
  const escapedStem = stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp("^" + escapedStem + "-v(0|[1-9][0-9]*)\\.md$", "iu");
  const existingVersion = entries.reduce((maximum, entry) => {
    if (entry.type !== "file") return maximum;
    const version = entry.name.match(pattern)?.[1];
    return version === undefined ? maximum : Math.max(maximum, Number(version));
  }, 0);
  return stem + "-v" + (Math.max(inputVersion, existingVersion) + 1) + ".md";
}

export function buildDropboxOutputPrompt(folderPath: string, fileName: string): string {
  return [
    "Dropbox 連携を使って、この会話での議論内容を Markdown 文書として要約し、次の新規ファイルとして保存してください。",
    "既存ファイルは上書きしないでください。指定したファイル名以外の代替名を決めないでください。",
    "",
    "保存先フォルダ: " + folderPath,
    "ファイル名: " + fileName
  ].join("\n");
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

async function openOptionsPage(): Promise<void> {
  await browser.runtime.sendMessage({ type: "primitive-io:open-options-page" });
}

export function mountDropboxExplorer(): void {
  const existing = document.getElementById("primitive-io-explorer");
  if (existing) {
    return;
  }

  const launcher = makeElement("button", "Cloud Explorer");
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
  const clientSelector = makeElement("select");
  clientSelector.setAttribute("aria-label", "表示するクラウドサービス");
  for (const [value, label] of [["dropbox", "Dropbox"], ["github", "GitHub"]] as const) {
    const option = makeElement("option", label);
    option.value = value;
    clientSelector.append(option);
  }
  const account = makeElement("span", "確認中…");
  const refresh = makeElement("button", "↻");
  refresh.type = "button";
  refresh.title = "rootを再取得";
  const settings = makeElement("button", "⚙");
  settings.type = "button";
  settings.title = "設定を開く";
  settings.setAttribute("aria-label", "設定を開く");
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
  const outputSection = makeElement("div");
  const outputDestination = makeElement("p", "保存先: 未選択");
  const outputBaseName = makeElement("input");
  outputBaseName.type = "text";
  outputBaseName.placeholder = "ベースファイル名";
  outputBaseName.setAttribute("aria-label", "出力するベースファイル名");
  const outputFileName = makeElement("p", "保存ファイル名: —");
  const outputButton = makeElement("button", "保存を依頼");
  outputButton.type = "button";

  setStyles(header, {
    display: "flex",
    "align-items": "center",
    gap: "8px",
    padding: "12px",
    "border-bottom": "1px solid #dadce0"
  });
  setStyles(clientSelector, { padding: "2px 4px", border: "1px solid #9aa0a6", "border-radius": "4px", background: "#ffffff", color: "#202124", "font-family": "system-ui, sans-serif", "font-size": "16px", "font-weight": "700", cursor: "pointer" });
  setStyles(account, {
    flex: "1",
    overflow: "hidden",
    "text-overflow": "ellipsis",
    "white-space": "nowrap",
    color: "#5f6368",
    "font-size": "12px"
  });
  for (const button of [refresh, settings, close]) {
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

  setStyles(outputSection, { clear: "both", margin: "14px 0 0", padding: "10px 0 0", "border-top": "1px solid #dadce0" });
  setStyles(outputDestination, { margin: "0 0 6px", "font-size": "12px", "overflow-wrap": "anywhere" });
  setStyles(outputBaseName, { width: "100%", "box-sizing": "border-box", padding: "6px", border: "1px solid #9aa0a6", "border-radius": "4px", "font-family": "system-ui, sans-serif" });
  setStyles(outputFileName, { margin: "6px 0", "font-size": "12px", "overflow-wrap": "anywhere" });
  setStyles(outputButton, { all: "initial", display: "inline-block", padding: "7px 12px", border: "0", "border-radius": "6px", background: "#2563eb", color: "#ffffff", "font-family": "system-ui, sans-serif", "font-size": "13px", cursor: "pointer" });
  outputSection.append(makeElement("strong", "Output (Markdown)"), outputDestination, outputBaseName, outputFileName, outputButton);
  panel.append(header, body, footer);
  header.append(clientSelector, account, refresh, settings, close);
  footer.append(selectionSummary, readButton, notice, autoSendIndicator, outputSection);
  document.body.append(launcher, panel);

  clientSelector.addEventListener("change", () => {
    document.dispatchEvent(new CustomEvent<string>("primitive-io:client-select", { detail: clientSelector.value }));
  });
  document.addEventListener("primitive-io:client-select", (event: Event) => {
    const client = (event as CustomEvent<string>).detail;
    if (client === "dropbox") {
      panel.style.display = "block";
      launcher.style.display = "none";
      clientSelector.value = "dropbox";
    } else if (client === "github") {
      panel.style.display = "none";
      launcher.style.display = "none";
    }
  });

  const entriesByFolderId = new Map<string, DropboxEntry[]>();
  const expandedFolderIds = new Set<string>();
  const loadingFolderIds = new Set<string>();
  const selectedEntries = new Map<string, DropboxEntry>();
  let available = false;
  let autoSend = false;
  let activeFolder: DropboxEntry | undefined;
  let outputCycleComplete = false;

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
      setStyles(checkbox, { display: "inline-block", width: "16px", height: "16px", appearance: "auto", "flex": "0 0 auto", cursor: "pointer" });
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
      const folderRow = makeElement("div");
      setStyles(folderRow, { display: "flex", "align-items": "center" });
      folder.style.flex = "1";
      const destinationButton = makeElement("button", activeFolder?.id === entry.id ? "保存先" : "保存先にする");
      destinationButton.type = "button";
      setStyles(destinationButton, { all: "initial", padding: "3px 6px", margin: "0 8px 0 4px", border: "1px solid #9aa0a6", "border-radius": "4px", color: "#374151", "font-family": "system-ui, sans-serif", "font-size": "11px", cursor: "pointer" });
      destinationButton.addEventListener("click", (event) => {
        event.stopPropagation();
        activeFolder = entry;
        outputCycleComplete = false;
        showNotice("保存先を設定しました。", "#137333");
        render();
      });
      folderRow.append(folder, destinationButton);
      target.append(folderRow);

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
    if (entriesByFolderId.has(rootFolderId)) {
      const rootDestination = makeElement("button", activeFolder?.id === rootFolderId ? "Dropbox rootは保存先です" : "Dropbox rootを保存先にする");
      rootDestination.type = "button";
      setStyles(rootDestination, { all: "initial", display: "block", margin: "6px 12px", padding: "4px 6px", border: "1px solid #9aa0a6", "border-radius": "4px", color: "#374151", "font-family": "system-ui, sans-serif", "font-size": "11px", cursor: "pointer" });
      rootDestination.addEventListener("click", () => {
        activeFolder = { id: rootFolderId, name: "Dropbox root", path: "/", type: "folder" };
        outputCycleComplete = false;
        showNotice("保存先を設定しました。", "#137333");
        render();
      });
      body.append(rootDestination);
    }
    renderFolder(rootFolderId, 0, body);
    renderFooter();
  }

  function renderOutput(): void {
    const validationError = validateOutputBaseName(outputBaseName.value);
    const previewEntries = activeFolder ? entriesByFolderId.get(activeFolder.id) ?? [] : [];
    const preview = !validationError && activeFolder ? determineOutputFileName(outputBaseName.value, previewEntries) : undefined;
    outputDestination.textContent = activeFolder ? "保存先: " + activeFolder.path : "保存先: 未選択";
    outputFileName.textContent = preview ? "保存ファイル名: " + preview : "保存ファイル名: —";
    outputButton.disabled = !activeFolder || !!validationError || outputCycleComplete;
    outputButton.style.opacity = outputButton.disabled ? "0.5" : "1";
    outputButton.style.cursor = outputButton.disabled ? "not-allowed" : "pointer";
  }

  function renderFooter(): void {
    selectionSummary.textContent = `${selectedEntries.size} / 5件選択`;
    readButton.disabled = selectedEntries.size === 0;
    readButton.style.opacity = selectedEntries.size === 0 ? "0.5" : "1";
    readButton.style.cursor = selectedEntries.size === 0 ? "not-allowed" : "pointer";
    autoSendIndicator.textContent = `自動送信: ${autoSend ? "ON" : "OFF"}`;
    renderOutput();
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
      if (folderId === rootFolderId) {
        // A previous root-load failure hides the explorer. Restore it once a
        // manual refresh succeeds after the connection has recovered.
        available = true;
        setMessage("");
      }
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
    outputCycleComplete = false;
    showNotice("");
    void load(rootFolderId, true);
  });
  settings.addEventListener("click", async () => {
    try {
      await openOptionsPage();
      showNotice("設定画面を開きました。", "#137333");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "不明なエラー";
      showNotice(`設定画面を開けませんでした: ${detail}`, "#b3261e");
    }
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
  outputBaseName.addEventListener("input", () => { outputCycleComplete = false; renderOutput(); });
  outputButton.addEventListener("click", async () => {
    if (!activeFolder) return;
    const validationError = validateOutputBaseName(outputBaseName.value);
    if (validationError) { showNotice(validationError, "#b3261e"); return; }
    try {
      const entries = await listFolder(activeFolder.id);
      const fileName = determineOutputFileName(outputBaseName.value, entries);
      const result = insertTextIntoEmptyComposer(buildDropboxOutputPrompt(activeFolder.path, fileName));
      if (!result.ok) { showNotice(result.message, "#b3261e"); return; }
      autoSend = await getAutoSend();
      outputCycleComplete = true;
      if (!autoSend) showNotice("保存依頼のプロンプトを入力欄へ投入しました。送信はしていません。", "#137333");
      else { const sent = await sendComposer(); showNotice(sent.ok ? "保存依頼のプロンプトを投入して送信を試行しました。" : sent.message, sent.ok ? "#137333" : "#b3261e"); }
    } catch (error) { showNotice(error instanceof Error ? error.message : "保存先フォルダを取得できませんでした。", "#b3261e"); }
    renderFooter();
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
