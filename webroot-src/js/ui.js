export function $(selector, root = document) {
  return root.querySelector(selector);
}

export function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = safeText(text);
  return element;
}

export function metric(label, value) {
  const node = createElement("div", "metric");
  node.append(createElement("span", "metric-label", safeText(label, "项目")));
  node.append(createElement("strong", "metric-value", safeText(value)));
  return node;
}

export function setStatus(message, tone = "neutral") {
  const target = $("#statusMessage");
  if (!target) return;
  target.textContent = safeText(message, "已同步");
  target.dataset.tone = tone;
}

let toastTimer = null;
let toastCloseTimer = null;
let toastSequence = 0;

function safeText(value, fallback = "暂不可用") {
  const text = String(value ?? "").trim();
  if (!text || /^(null|undefined|nan)$/i.test(text)) return fallback;
  return text;
}

export function showToast(message, tone = "neutral") {
  const text = safeText(message, "已同步");
  if (!document.body) return;
  const sequence = ++toastSequence;

  let host = $("#toastLayer");
  if (!host) {
    host = createElement("div", "toast-layer");
    host.id = "toastLayer";
    host.setAttribute("aria-live", "polite");
    host.setAttribute("aria-atomic", "true");
    document.body.append(host);
  }

  let toast = $(".toast", host);
  if (!toast) {
    toast = createElement("div", "toast");
    host.append(toast);
  }

  toast.dataset.tone = tone;
  toast.textContent = text;
  toast.classList.remove("is-closing");
  requestAnimationFrame(() => {
    if (sequence !== toastSequence) return;
    toast.classList.add("is-visible");
  });

  if (toastTimer) clearTimeout(toastTimer);
  if (toastCloseTimer) clearTimeout(toastCloseTimer);
  toastTimer = setTimeout(() => closeToast(host, toast, sequence), 1800);
}

function closeToast(host, toast, sequence) {
  if (!host || !toast || sequence !== toastSequence) return;
  toast.classList.add("is-closing");
  toast.classList.remove("is-visible");
  if (toastCloseTimer) clearTimeout(toastCloseTimer);
  toastCloseTimer = setTimeout(() => {
    if (sequence !== toastSequence) return;
    toast.remove();
    if (!host.querySelector(".toast")) host.remove();
  }, 220);
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
    panel.append(title, createElement("p", "risk-note", message), actions);
    dialog.append(panel);

    const finish = (value) => {
      if (dialog.classList.contains("is-closing")) return;
      dialog.classList.add("is-closing");
      setTimeout(() => dialog.remove(), 220);
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
