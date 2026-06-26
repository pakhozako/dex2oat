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
  return new Promise((resolve) => {
    const dialog = createElement("div", "dialog confirm-dialog");
    const panel = createElement("div", "dialog-panel");
    const title = createElement("div", "section-title");
    title.append(createElement("h2", "", "确认操作"));
    const actions = createElement("div", "dialog-actions");
    const cancel = createElement("button", "text-button", "取消");
    const ok = createElement("button", "primary-button", "确认");
    cancel.type = "button";
    ok.type = "button";
    actions.append(cancel, ok);
    title.append(actions);
    panel.append(title, createElement("p", "risk-note", message));
    dialog.append(panel);

    const finish = (value) => {
      dialog.remove();
      resolve(value);
    };
    cancel.addEventListener("click", () => finish(false));
    ok.addEventListener("click", () => finish(true));
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) finish(false);
    });
    document.body.append(dialog);
    ok.focus();
  });
}
