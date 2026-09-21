import { mountDropboxExplorer } from "./dropboxExplorer";

function mount(): void {
  mountDropboxExplorer();
  void browser.runtime.sendMessage({
    type: "primitive-io:content-mounted",
    href: location.href
  }).catch(() => undefined);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount, { once: true });
} else {
  mount();
}
