export type ComposerErrorCode =
  | "COMPOSER_NOT_FOUND"
  | "COMPOSER_NOT_EMPTY"
  | "COMPOSER_NOT_EDITABLE"
  | "SEND_BUTTON_NOT_FOUND"
  | "SEND_NOT_AVAILABLE";

export type ComposerResult =
  | { ok: true }
  | { ok: false; code: ComposerErrorCode; message: string };

const composerSelectors = [
  "#prompt-textarea",
  "textarea[data-id='root']",
  "textarea",
  "[contenteditable='true'][role='textbox']",
  "[contenteditable='true']"
];

function isVisible(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  return element.getClientRects().length > 0 && style.visibility !== "hidden" && style.display !== "none";
}

function findComposer(): HTMLElement | undefined {
  for (const selector of composerSelectors) {
    const composer = Array.from(document.querySelectorAll<HTMLElement>(selector)).find(isVisible);
    if (composer) {
      return composer;
    }
  }

  return undefined;
}

function findSendButton(): HTMLButtonElement | undefined {
  const selectors = [
    "button[data-testid='send-button']",
    "button[aria-label='Send prompt']",
    "button[aria-label='送信']",
    "form button[type='submit']"
  ];

  for (const selector of selectors) {
    const button = Array.from(document.querySelectorAll<HTMLButtonElement>(selector))
      .find((candidate) => isVisible(candidate));
    if (button) {
      return button;
    }
  }

  return undefined;
}

function composerText(composer: HTMLElement): string {
  if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
    return composer.value;
  }

  return composer.textContent ?? "";
}

function setNativeValue(element: HTMLTextAreaElement | HTMLInputElement, value: string): void {
  const prototype = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;

  if (setter) {
    setter.call(element, value);
  } else {
    element.value = value;
  }
}

function notifyInput(composer: HTMLElement, text: string): void {
  composer.dispatchEvent(new InputEvent("input", {
    bubbles: true,
    composed: true,
    inputType: "insertText",
    data: text
  }));
}

/**
 * Empty composer only. This prevents an extension action from overwriting a
 * draft that the user has already started writing.
 */
export function insertTextIntoEmptyComposer(text: string): ComposerResult {
  const composer = findComposer();
  if (!composer) {
    return {
      ok: false,
      code: "COMPOSER_NOT_FOUND",
      message: "ChatGPTの入力欄を検出できませんでした。"
    };
  }

  if (composerText(composer).trim().length > 0) {
    return {
      ok: false,
      code: "COMPOSER_NOT_EMPTY",
      message: "入力欄に既存の下書きがあるため、上書きせず中止しました。"
    };
  }

  if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
    if (composer.disabled || composer.readOnly) {
      return {
        ok: false,
        code: "COMPOSER_NOT_EDITABLE",
        message: "ChatGPTの入力欄を編集できません。"
      };
    }

    composer.focus();
    setNativeValue(composer, text);
    notifyInput(composer, text);
    return { ok: true };
  }

  if (composer.getAttribute("contenteditable") !== "true") {
    return {
      ok: false,
      code: "COMPOSER_NOT_EDITABLE",
      message: "ChatGPTの入力欄を編集できません。"
    };
  }

  composer.focus();
  composer.textContent = text;
  notifyInput(composer, text);
  return { ok: true };
}

export async function sendComposer(): Promise<ComposerResult> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const sendButton = findSendButton();
  if (!sendButton) {
    return {
      ok: false,
      code: "SEND_BUTTON_NOT_FOUND",
      message: "ChatGPTの送信ボタンを検出できませんでした。"
    };
  }
  if (sendButton.disabled || sendButton.getAttribute("aria-disabled") === "true") {
    return {
      ok: false,
      code: "SEND_NOT_AVAILABLE",
      message: "ChatGPTの送信ボタンが有効ではありません。"
    };
  }

  sendButton.click();
  return { ok: true };
}
