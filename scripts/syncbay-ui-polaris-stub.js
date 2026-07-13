for (const element of document.querySelectorAll("*")) {
  const tagName = element.tagName.toLowerCase();
  if (!tagName.startsWith("s-") || customElements.get(tagName)) continue;

  customElements.define(tagName, class extends HTMLElement {});
}
