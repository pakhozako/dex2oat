/**
 * Material Design 3 — Theme Manager
 * 主题切换 + 动态配色生成
 */

/**
 * 从源色生成 M3 色彩方案 (简化版 tonal palette)
 * 完整版应使用 HCT 色彩空间，这里用 OKLCH 近似
 */
export function generateColorScheme(sourceHex) {
  const { h, s, l } = hexToHsl(sourceHex);

  return {
    primary:          hslToHex(h, clamp(s, 20, 90), 50),
    onPrimary:        hslToHex(h, s > 10 ? 90 : 0, 100),
    primaryContainer: hslToHex(h, clamp(s, 15, 60), 90),
    onPrimaryContainer: hslToHex(h, clamp(s, 20, 80), 10),

    secondary:          hslToHex(h, Math.max(s * 0.12, 4), 45),
    onSecondary:        hslToHex(h, s > 10 ? 90 : 0, 100),
    secondaryContainer: hslToHex(h, Math.max(s * 0.12, 4), 90),
    onSecondaryContainer: hslToHex(h, Math.max(s * 0.15, 5), 10),

    tertiary:          hslToHex((h + 60) % 360, clamp(s * 0.6, 10, 50), 45),
    onTertiary:        hslToHex(h, s > 10 ? 90 : 0, 100),
    tertiaryContainer: hslToHex((h + 60) % 360, clamp(s * 0.5, 10, 40), 90),
    onTertiaryContainer: hslToHex((h + 60) % 360, clamp(s * 0.6, 10, 50), 10),

    error:          '#ba1a1a',
    onError:        '#ffffff',
    errorContainer: '#ffdad6',
    onErrorContainer: '#410002',
  };
}

/**
 * 将配色方案应用到 DOM
 */
export function applyScheme(scheme) {
  const root = document.documentElement;
  for (const role in scheme) {
    if (!Object.prototype.hasOwnProperty.call(scheme, role)) continue;
    const value = scheme[role];
    const cssVar = `--md-sys-color-${role.replace(/([A-Z])/g, '-$1').toLowerCase()}`;
    root.style.setProperty(cssVar, value);
  }
}

/**
 * 从源色动态生成并应用配色方案
 */
export function applySourceColor(hex) {
  const scheme = generateColorScheme(hex);
  applyScheme(scheme);
  writeStorage('md-source-color', hex);
}

/**
 * 读取存储的源色并应用
 */
export function restoreSourceColor() {
  const saved = readStorage('md-source-color', '');
  if (saved) applySourceColor(saved);
}

/**
 * 手动切换主题 (light / dark / auto)
 */
export function setTheme(mode) {
  const root = document.documentElement;
  root.removeAttribute('data-theme');

  if (mode === 'light') {
    root.setAttribute('data-theme', 'light');
  } else if (mode === 'dark') {
    root.setAttribute('data-theme', 'dark');
  }
  // 'auto' = 不设置 data-theme，靠 media query

  writeStorage('md-theme-mode', mode);
}

/**
 * 获取当前主题
 */
export function getTheme() {
  return readStorage('md-theme-mode', 'auto') || 'auto';
}

/**
 * 初始化主题系统
 */
export function initTheme() {
  restoreSourceColor();
  const mode = getTheme();
  if (mode !== 'auto') setTheme(mode);
}

// ── Color conversion helpers ──

function hexToHsl(hex) {
  hex = hex.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;

  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;

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
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = n => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function readStorage(key, fallback) {
  try {
    if (typeof localStorage === 'undefined') return fallback;
    const value = localStorage.getItem(key);
    return value == null ? fallback : value;
  } catch (_error) {
    return fallback;
  }
}

function writeStorage(key, value) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
  } catch (_error) {
    // Some WebUI WebViews disable storage; theme fallback remains usable.
  }
}
