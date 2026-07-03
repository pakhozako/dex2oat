export const MATERIAL_YOU_THEMES = [
  { id: "purple", label: "Material You Purple", seed: "#6750a4", neutralHue: 285 },
  { id: "blue", label: "Material You Blue", seed: "#0061a4", neutralHue: 255 },
  { id: "green", label: "Material You Green", seed: "#386a20", neutralHue: 140 },
  { id: "cyan", label: "Material You Cyan", seed: "#006874", neutralHue: 210 },
  { id: "red", label: "Material You Red", seed: "#ba1a1a", neutralHue: 20 },
  { id: "orange", label: "Material You Orange", seed: "#9a4600", neutralHue: 38 },
  { id: "pink", label: "Material You Pink", seed: "#984061", neutralHue: 350 },
  { id: "white", label: "Material You White", seed: "#fefbff", swatch: "#ffffff", neutralHue: 255, neutral: true }
];

const DEFAULT_THEME_ID = "purple";
const COLOR_ROLES = [
  "primary", "onPrimary", "primaryContainer", "onPrimaryContainer",
  "secondary", "onSecondary", "secondaryContainer", "onSecondaryContainer",
  "tertiary", "onTertiary", "tertiaryContainer", "onTertiaryContainer",
  "error", "onError", "errorContainer", "onErrorContainer",
  "background", "onBackground", "surface", "onSurface",
  "surfaceVariant", "onSurfaceVariant", "outline", "outlineVariant",
  "shadow", "scrim", "inverseSurface", "inverseOnSurface", "inversePrimary",
  "surfaceDim", "surfaceBright", "surfaceContainerLowest", "surfaceContainerLow",
  "surfaceContainer", "surfaceContainerHigh", "surfaceContainerHighest"
];

export function generateColorScheme(sourceHex, options = {}) {
  return createScheme(sourceHex || "#6750a4", {
    dark: Boolean(options.dark),
    neutralHue: options.neutralHue,
    neutral: Boolean(options.neutral)
  });
}

export function applyScheme(scheme) {
  const root = document.documentElement;
  for (const role of COLOR_ROLES) {
    if (!Object.prototype.hasOwnProperty.call(scheme, role)) continue;
    const cssVar = `--md-sys-color-${role.replace(/([A-Z])/g, "-$1").toLowerCase()}`;
    root.style.setProperty(cssVar, scheme[role]);
  }
}

export function applySourceColor(hex) {
  const preset = findPresetBySeed(hex) || { id: "custom", seed: hex };
  applyMaterialTheme(preset.id, { source: hex });
}

export function restoreSourceColor() {
  applyMaterialTheme(getMaterialTheme());
}

export function setTheme(mode) {
  const root = document.documentElement;
  root.removeAttribute("data-theme");
  if (mode === "light" || mode === "dark") root.setAttribute("data-theme", mode);
  writeStorage("md-theme-mode", mode || "auto");
  applyMaterialTheme(getMaterialTheme());
}

export function getTheme() {
  return readStorage("md-theme-mode", "auto") || "auto";
}

export function initTheme() {
  installColorSchemeListener();
  const mode = getTheme();
  if (mode !== "auto") setTheme(mode);
  else restoreSourceColor();
}

export function getMaterialTheme() {
  return readStorage("md-material-theme", DEFAULT_THEME_ID) || DEFAULT_THEME_ID;
}

export function applyMaterialTheme(id = DEFAULT_THEME_ID, options = {}) {
  const preset = MATERIAL_YOU_THEMES.find((item) => item.id === id) || MATERIAL_YOU_THEMES[0];
  const seed = options.source || preset.seed;
  const dark = shouldUseDarkScheme();
  applyScheme(generateColorScheme(seed, {
    dark,
    neutralHue: preset.neutralHue,
    neutral: preset.neutral
  }));
  document.documentElement.style.setProperty("--md-source-color", seed);
  writeStorage("md-material-theme", preset.id);
  writeStorage("md-source-color", seed);
  return preset.id;
}

function createScheme(sourceHex, options = {}) {
  const source = hexToHsl(sourceHex);
  const neutralHue = Number.isFinite(options.neutralHue) ? options.neutralHue : source.h;
  const h = options.neutral ? neutralHue : source.h;
  const accentS = options.neutral ? 10 : clamp(source.s, 34, 84);
  const secondaryS = options.neutral ? 8 : clamp(source.s * 0.28, 10, 30);
  const tertiaryHue = options.neutral ? (neutralHue + 36) % 360 : (h + 54) % 360;
  const tertiaryS = options.neutral ? 12 : clamp(source.s * 0.5, 18, 48);
  return options.dark
    ? createDarkScheme({ h, accentS, secondaryS, tertiaryHue, tertiaryS, neutralHue })
    : createLightScheme({ h, accentS, secondaryS, tertiaryHue, tertiaryS, neutralHue });
}

function createLightScheme({ h, accentS, secondaryS, tertiaryHue, tertiaryS, neutralHue }) {
  return {
    primary: hslToHex(h, accentS, 40),
    onPrimary: "#ffffff",
    primaryContainer: hslToHex(h, clamp(accentS - 8, 10, 74), 90),
    onPrimaryContainer: hslToHex(h, clamp(accentS + 4, 18, 84), 16),
    secondary: hslToHex(h, secondaryS, 40),
    onSecondary: "#ffffff",
    secondaryContainer: hslToHex(h, secondaryS, 90),
    onSecondaryContainer: hslToHex(h, clamp(secondaryS + 4, 10, 34), 16),
    tertiary: hslToHex(tertiaryHue, tertiaryS, 40),
    onTertiary: "#ffffff",
    tertiaryContainer: hslToHex(tertiaryHue, clamp(tertiaryS - 4, 10, 44), 90),
    onTertiaryContainer: hslToHex(tertiaryHue, clamp(tertiaryS + 4, 14, 52), 16),
    error: "#ba1a1a",
    onError: "#ffffff",
    errorContainer: "#ffdad6",
    onErrorContainer: "#410002",
    background: hslToHex(neutralHue, 10, 99),
    onBackground: hslToHex(neutralHue, 8, 12),
    surface: hslToHex(neutralHue, 10, 99),
    onSurface: hslToHex(neutralHue, 8, 12),
    surfaceVariant: hslToHex(neutralHue, 12, 89),
    onSurfaceVariant: hslToHex(neutralHue, 8, 30),
    outline: hslToHex(neutralHue, 7, 48),
    outlineVariant: hslToHex(neutralHue, 10, 78),
    shadow: "#000000",
    scrim: "#000000",
    inverseSurface: hslToHex(neutralHue, 8, 20),
    inverseOnSurface: hslToHex(neutralHue, 10, 95),
    inversePrimary: hslToHex(h, clamp(accentS - 10, 18, 70), 80),
    surfaceDim: hslToHex(neutralHue, 9, 87),
    surfaceBright: hslToHex(neutralHue, 10, 99),
    surfaceContainerLowest: "#ffffff",
    surfaceContainerLow: hslToHex(neutralHue, 10, 97),
    surfaceContainer: hslToHex(neutralHue, 10, 95),
    surfaceContainerHigh: hslToHex(neutralHue, 10, 93),
    surfaceContainerHighest: hslToHex(neutralHue, 10, 90)
  };
}

function createDarkScheme({ h, accentS, secondaryS, tertiaryHue, tertiaryS, neutralHue }) {
  return {
    primary: hslToHex(h, clamp(accentS - 8, 18, 74), 80),
    onPrimary: hslToHex(h, clamp(accentS + 2, 20, 84), 20),
    primaryContainer: hslToHex(h, clamp(accentS - 4, 16, 76), 30),
    onPrimaryContainer: hslToHex(h, clamp(accentS - 8, 12, 72), 90),
    secondary: hslToHex(h, secondaryS, 80),
    onSecondary: hslToHex(h, clamp(secondaryS + 4, 12, 34), 20),
    secondaryContainer: hslToHex(h, secondaryS, 30),
    onSecondaryContainer: hslToHex(h, secondaryS, 90),
    tertiary: hslToHex(tertiaryHue, tertiaryS, 80),
    onTertiary: hslToHex(tertiaryHue, clamp(tertiaryS + 4, 16, 52), 20),
    tertiaryContainer: hslToHex(tertiaryHue, tertiaryS, 30),
    onTertiaryContainer: hslToHex(tertiaryHue, tertiaryS, 90),
    error: "#ffb4ab",
    onError: "#690005",
    errorContainer: "#93000a",
    onErrorContainer: "#ffdad6",
    background: hslToHex(neutralHue, 8, 8),
    onBackground: hslToHex(neutralHue, 9, 90),
    surface: hslToHex(neutralHue, 8, 8),
    onSurface: hslToHex(neutralHue, 9, 90),
    surfaceVariant: hslToHex(neutralHue, 9, 30),
    onSurfaceVariant: hslToHex(neutralHue, 10, 80),
    outline: hslToHex(neutralHue, 7, 60),
    outlineVariant: hslToHex(neutralHue, 8, 30),
    shadow: "#000000",
    scrim: "#000000",
    inverseSurface: hslToHex(neutralHue, 9, 90),
    inverseOnSurface: hslToHex(neutralHue, 8, 20),
    inversePrimary: hslToHex(h, accentS, 40),
    surfaceDim: hslToHex(neutralHue, 8, 8),
    surfaceBright: hslToHex(neutralHue, 8, 24),
    surfaceContainerLowest: hslToHex(neutralHue, 8, 6),
    surfaceContainerLow: hslToHex(neutralHue, 8, 12),
    surfaceContainer: hslToHex(neutralHue, 8, 14),
    surfaceContainerHigh: hslToHex(neutralHue, 8, 18),
    surfaceContainerHighest: hslToHex(neutralHue, 8, 22)
  };
}

function shouldUseDarkScheme() {
  const mode = getTheme();
  if (mode === "dark") return true;
  if (mode === "light") return false;
  return Boolean(globalThis.matchMedia?.("(prefers-color-scheme: dark)")?.matches);
}

function installColorSchemeListener() {
  const media = globalThis.matchMedia?.("(prefers-color-scheme: dark)");
  if (!media || media.__dex2oatThemeListener) return;
  const listener = () => {
    if (getTheme() === "auto") applyMaterialTheme(getMaterialTheme());
  };
  media.addEventListener?.("change", listener);
  media.addListener?.(listener);
  media.__dex2oatThemeListener = listener;
}

function findPresetBySeed(hex) {
  const normalized = String(hex || "").toLowerCase();
  return MATERIAL_YOU_THEMES.find((item) => item.seed.toLowerCase() === normalized);
}

function hexToHsl(hex) {
  const normalized = String(hex || "#6750a4").replace("#", "").padEnd(6, "0").slice(0, 6);
  const r = parseInt(normalized.slice(0, 2), 16) / 255;
  const g = parseInt(normalized.slice(2, 4), 16) / 255;
  const b = parseInt(normalized.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }

  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function readStorage(key, fallback) {
  try {
    if (typeof localStorage === "undefined") return fallback;
    const value = localStorage.getItem(key);
    return value == null ? fallback : value;
  } catch (_error) {
    return fallback;
  }
}

function writeStorage(key, value) {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(key, value);
  } catch (_error) {
    // WebView storage can be disabled; the static Material 3 theme still works.
  }
}
