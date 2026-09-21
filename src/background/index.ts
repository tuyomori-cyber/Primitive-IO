import {
  connectDropbox,
  disconnectDropbox,
  getDropboxAuthStatus,
  saveDropboxAppKey,
  verifyDropboxConnection
} from "./dropboxAuth";
import { listDropboxFolder } from "./dropboxClient";
import { getAutoSend, setAutoSend } from "./extensionSettings";

const chatGptOrigins = ["https://chatgpt.com/", "https://chat.openai.com/"];

function isChatGptPage(url: string | undefined): boolean {
  return url !== undefined && chatGptOrigins.some((origin) => url.startsWith(origin));
}

async function injectContentScript(tabId: number): Promise<void> {
  try {
    await browser.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });
  } catch (error) {
    console.warn("Primitive IO could not inject its content script", error);
  }
}

browser.runtime.onInstalled.addListener(() => {
  console.info("Primitive IO installed");
});

browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && isChatGptPage(tab.url)) {
    void injectContentScript(tabId);
  }
});

browser.runtime.onMessage.addListener((message: unknown) => {
  if (message === "primitive-io:ping") {
    return Promise.resolve({ status: "ok" });
  }

  if (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    message.type === "primitive-io:content-mounted"
  ) {
    console.info("Primitive IO content script mounted", message);
    return Promise.resolve({ status: "ok" });
  }

  if (typeof message === "object" && message !== null && "type" in message) {
    switch (message.type) {
      case "primitive-io:dropbox-status":
        return getDropboxAuthStatus();
      case "primitive-io:dropbox-save-app-key":
        if ("appKey" in message && typeof message.appKey === "string") {
          return saveDropboxAppKey(message.appKey);
        }
        return Promise.reject(new Error("Dropbox App keyが不正です。"));
      case "primitive-io:dropbox-connect":
        return connectDropbox();
      case "primitive-io:dropbox-disconnect":
        return disconnectDropbox();
      case "primitive-io:dropbox-verify":
        return verifyDropboxConnection();
      case "primitive-io:dropbox-list-folder":
        if ("path" in message && typeof message.path === "string") {
          return listDropboxFolder(message.path);
        }
        return Promise.reject(new Error("Dropboxフォルダのパスが不正です。"));
      case "primitive-io:auto-send-get":
        return getAutoSend();
      case "primitive-io:auto-send-set":
        if ("enabled" in message && typeof message.enabled === "boolean") {
          return setAutoSend(message.enabled);
        }
        return Promise.reject(new Error("自動送信設定が不正です。"));
      default:
        return undefined;
    }
  }

  return undefined;
});
