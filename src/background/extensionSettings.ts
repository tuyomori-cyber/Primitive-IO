const autoSendStorageKey = "autoSend";

export async function getAutoSend(): Promise<boolean> {
  const values = await browser.storage.local.get(autoSendStorageKey);
  return values[autoSendStorageKey] === true;
}

export async function setAutoSend(enabled: boolean): Promise<boolean> {
  await browser.storage.local.set({ [autoSendStorageKey]: enabled });
  return enabled;
}
