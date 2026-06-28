# WebUI Material 3 Rebuild Handoff

## Scope

This rebuild treats the previous WebUI as replaceable presentation code. The preserved boundary is the WebView/API contract:

- Keep JSBridge calls in `webroot-src/js/bridge.js`.
- Keep config loading, saving, backup, and protected data decoding APIs unchanged.
- Keep source files in `webroot-src/`; generate `webroot/` only through `node tools/build-webui.mjs`.
- Keep protected data out of plain `webroot/data`, except `rule-props.tsv`.
- Keep Android WebView compatibility for Magisk, KernelSU, and APatch environments.
- Keep the logo tap easter egg, custom agreement gate, risk agreement flow, install history dialog, and system.prop export flow.

## Material 3 Direction

The UI now follows the Android Material 3 / Material You shape:

- `m3-tokens.css` defines baseline Material 3 color roles, typography scale, shape scale, elevations, motion, and state-layer opacity.
- `m3-theme.css` defines dark mode roles and manual `data-theme` overrides.
- `app.css` is the new app-level implementation. It replaces the old layered visual patchwork with one coherent surface:
  - 64px small top app bar.
  - 80px bottom navigation bar with 56x32 active indicator.
  - Filled, outlined, and elevated cards.
  - 40px buttons with full rounded shape and 58px min width.
  - 52x32 switches with Material 3 thumb sizes.
  - 28px dialog container shape on `SurfaceContainerHigh`.

Reference basis:

- Android Material 3 Compose design-system docs describe app theming through color scheme, typography, and shapes.
- Compose Material3 release notes include the user-requested `1.5.0-alpha22` reference point.
- AndroidX Material3 token files were checked for practical dimensions such as navigation bar, small app bar, button, card, switch, and dialog sizes.

## Startup Screen

`webroot-src/index.html` and `tools/build-webui.mjs` now share the same startup markup.

Behavior:

- The startup screen stays visible for about 3 seconds through `BOOT_SCREEN_MIN_MS = 3000`.
- During that period the app loads metadata, unified state, device state, config source, health state, system info, options, and user config.
- After data is ready, the shell and home page are rendered behind the startup screen.
- The startup overlay leaves only after both the minimum time and initialization work are done.
- The startup logo is a shared element: it stays visible, moves with `transform` into the top-right Material 3 brand pill, then the main shell owns the same logo element.
- The startup screen intentionally has no progress bar, percentage, canvas, or wave code. The only startup text is `正在同步设备状态与配置缓存`, with CSS-only animated trailing dots.
- The visual shell is reduced to one glassmorphism main card with the logo and status text; the old outer frame, decorative border, progress strip, and extra startup ornaments are removed.

User-facing copy is intentionally minimal. Do not show engineering labels such as CSS, JS, config, or prerender on the startup screen.

## Material You Themes

- `webroot-src/js/m3-theme.js` owns the runtime Material You palette switcher and writes Material 3 color roles into CSS variables.
- The default theme remains `current`; additional presets are Blue, Green, Purple, Orange, Teal, Pink, and White.
- The White preset is a neutral Material You palette, not a hard-coded all-white override, so surfaces, outlines, text, buttons, status cards, menus, and accents keep proper contrast in light and dark mode.
- The Appearance panel exposes the theme swatches. Switching is immediate, persists in local storage, and does not require a page refresh.
- Keep future UI color work on `--md-sys-color-*` roles instead of component-local hard-coded colors.

## Brand Pill And Reboot Menu

- `webroot-src/js/brand-pill.js` owns the replaceable Brand Pill markup and logo application helpers.
- The main top bar places the Brand Pill at the top-right. It contains the logo, brand name, version, and power button.
- The power button opens an in-place Material-style dropdown menu under the button. It does not navigate away from the current page.
- Menu actions call the existing WebView shell boundary through `exec("reboot")`, `exec("reboot recovery")`, and `exec("reboot bootloader")`.
- Custom top-bar logo replacement continues to use the system gallery/file picker and local WebView storage.

## Files Changed

- `webroot-src/index.html`: redesigned startup screen.
- `webroot-src/js/brand-pill.js`: reusable Brand Pill markup, version, and logo helpers.
- `webroot-src/js/app.js`: Material 3 shell markup, feature cards, risk mode cards, startup gating and prerender flow.
- `webroot-src/js/m3-theme.js`: cleaned theme manager.
- `webroot-src/css/m3-tokens.css`: baseline Material 3 tokens.
- `webroot-src/css/m3-theme.css`: dark/manual theme roles.
- `webroot-src/css/app.css`: complete Material 3 app styling.
- `tools/build-webui.mjs`: generated release HTML now matches source startup markup.

## Follow-Up Notes

- New files and dependencies are allowed by product direction, but this pass avoids CDN or online font dependencies to keep Android WebView/offline module usage reliable.
- If later engineers add icon libraries, bundle them locally and include them in the protected build path.
- If later engineers add more pages, prefer composing from the same local patterns: top app bar, navigation bar, cards, chips, switches, dialogs, and state-layer overlays.
- Do not reintroduce old app.css overrides after this file. Add new app-specific rules in the current clean `app.css` or split a new local CSS file and add it to `buildCss()`.
