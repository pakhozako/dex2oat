export const BRAND_PILL_NAME = "dex2oat-lock";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function resolveRoot(root) {
  if (!root) return document;
  if (typeof root === "string") return document.querySelector(root);
  return root;
}

export function createBrandPillMarkup({
  id = "",
  className = "",
  name = BRAND_PILL_NAME,
  version = "",
  interactiveLogo = true,
  showRefresh = false,
  refreshButtonId = "brandPillRefresh",
  refreshLabel = "刷新设备状态",
  refreshTitle = "刷新",
  showPower = false,
  powerButtonId = "brandPillPower",
  powerLabel = "重启设备",
  powerTitle = "重启",
  logoSrc = ""
} = {}) {
  const classes = ["brand-pill", className].filter(Boolean).join(" ");
  const idAttr = id ? ` id="${escapeHtml(id)}"` : "";
  const logoTag = interactiveLogo ? "button" : "span";
  const initialLogo = String(logoSrc || "");
  const logoClass = ["brand-logo", "brand-pill-logo", initialLogo ? "has-image" : ""].filter(Boolean).join(" ");
  const logoAttrs = interactiveLogo
    ? ` type="button" aria-label="${escapeHtml(name)}"`
    : ` aria-hidden="true"`;
  const imageAttrs = initialLogo
    ? ` src="${escapeHtml(initialLogo)}" loading="eager" decoding="async"`
    : " hidden";
  const refreshMarkup = showRefresh ? `
          <button class="brand-pill-refresh icon-button" id="${escapeHtml(refreshButtonId)}" type="button" title="${escapeHtml(refreshTitle)}" aria-label="${escapeHtml(refreshLabel)}">
            <span class="refresh-icon" aria-hidden="true"></span>
          </button>` : "";
  const powerMarkup = showPower ? `
          <button class="brand-pill-power icon-button" id="${escapeHtml(powerButtonId)}" type="button" title="${escapeHtml(powerTitle)}" aria-label="${escapeHtml(powerLabel)}" aria-haspopup="menu" aria-expanded="false" aria-controls="rebootMenu">
            <span class="power-icon" aria-hidden="true"></span>
          </button>` : "";
  const actionsMarkup = refreshMarkup || powerMarkup ? `
        <span class="brand-pill-divider" aria-hidden="true"></span>
        <span class="brand-pill-actions">${refreshMarkup}${powerMarkup}</span>` : "";
  return `
      <div class="${classes}"${idAttr} data-brand-pill>
        <${logoTag} class="${logoClass}"${logoAttrs}>
          <span class="brand-logo-mark" aria-hidden="true"></span>
          <img class="brand-pill-logo-image" alt=""${imageAttrs} />
        </${logoTag}>
        <span class="brand-pill-text">
          <span class="brand-pill-name topbar-title">${escapeHtml(name)}</span>
          <span class="brand-pill-version topbar-version"${version ? "" : " hidden"}>${escapeHtml(version)}</span>
        </span>${actionsMarkup}
      </div>
  `;
}

export function setBrandPillVersion(root, version) {
  const target = resolveRoot(root)?.querySelector?.(".brand-pill-version");
  if (!target) return;
  const value = String(version || "");
  target.textContent = value;
  target.hidden = !value;
}

export function applyBrandPillLogo(root, value) {
  const host = resolveRoot(root);
  const logo = host?.matches?.(".brand-pill-logo") ? host : host?.querySelector?.(".brand-pill-logo");
  if (!logo) return;
  const image = logo.querySelector(".brand-pill-logo-image");
  if (!value) {
    logo.classList.remove("has-image");
    logo.style.removeProperty("background-image");
    if (image) {
      image.hidden = true;
      image.removeAttribute("src");
    }
    return;
  }
  const source = String(value);
  if (image) {
    image.loading = "eager";
    image.decoding = "async";
    if (image.getAttribute("src") === source && image.complete && image.naturalWidth > 0) {
      image.hidden = false;
      logo.classList.add("has-image");
      return;
    }
    image.onload = () => {
      if (image.getAttribute("src") !== source) return;
      image.hidden = false;
      logo.classList.add("has-image");
    };
    image.onerror = () => {
      if (image.getAttribute("src") !== source) return;
      image.hidden = true;
      image.removeAttribute("src");
      logo.classList.remove("has-image");
    };
    image.src = source;
    if (image.complete && image.naturalWidth > 0) image.onload();
  } else {
    logo.classList.add("has-image");
    logo.style.backgroundImage = `url("${source.replace(/"/g, '\\"')}")`;
  }
}
