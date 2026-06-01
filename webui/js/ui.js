export function $(selector, root = document) {
  return root.querySelector(selector);
}

export function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}

export function metric(label, value) {
  const node = createElement("div", "metric");
  node.append(createElement("span", "metric-label", label));
  node.append(createElement("strong", "metric-value", value));
  return node;
}

export function setStatus(message, tone = "neutral") {
  const target = $("#statusMessage");
  if (!target) return;
  target.textContent = message;
  target.dataset.tone = tone;
}

export function showConfirm(message) {
  return globalThis.confirm(message);
}
