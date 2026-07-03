const fs = require("node:fs");
const path = require("node:path");
const { root } = require("./toolkit");

// Skin scheme is badge-only: only skin-badges.css is shipped as an
// on-demand asset. Full theme CSS files (theme-memorial-amber.css,
// theme-founder-qingmu.css) are no longer loaded at runtime and are not
// included in the build output. readSkinCssAssets() no longer scans
// skin-manifest.js for themeHref entries.
function readSkinCssAssets() {
  const names = ["skin-badges.css"];
  for (const name of names) {
    const sourcePath = path.join(root, "webroot-src", "css", name);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Skin CSS source missing: ${sourcePath}`);
    }
  }
  return names;
}

module.exports = {
  readSkinCssAssets
};
