const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { root } = require("./toolkit");

const viewports = [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 800 }
];

const HOME_LABEL = "\u9996\u9875";
const CUSTOM_LABEL = "\u81ea\u5b9a\u4e49";
const CONFIG_CONFIRM_LABEL = "\u914d\u7f6e\u786e\u8ba4";
const CONFIRM_LABEL = "\u786e\u8ba4";

function installSmokeBridge(page) {
  return page.addInitScript(() => {
    const config = {
      profile: "safe",
      riskMode: "safe",
      riskAgreement: {
        version: 2,
        agreed: true,
        agreedAt: "2026-07-03T00:00:00Z",
        customUnlocked: true,
        aggressiveUnlocked: true
      },
      ui: { skin: "default", skinMotion: false },
      items: {}
    };

    globalThis.nativeBridge = {
      async shell(command) {
        const text = String(command || "");
        if (/supporter-install-id\.sh/.test(text)) {
          return { code: 0, stdout: JSON.stringify({ ok: true, installId: "fnv1a-smoke-test" }), stderr: "" };
        }
        if (/skin-unlock\.sh/.test(text) && / list /.test(text)) {
          return { code: 0, stdout: JSON.stringify({ ok: true, skins: [] }), stderr: "" };
        }
        if (/cat .*config\.json/.test(text)) {
          return { code: 0, stdout: JSON.stringify(config), stderr: "" };
        }
        if (/cat .*state\.prop/.test(text)) {
          return {
            code: 0,
            stdout: [
              "risk.mode=safe",
              "risk.agreement_version=2",
              "risk.custom_unlocked=yes",
              "risk.aggressive_unlocked=yes",
              "match.matched_total=0",
              "config.source=smoke",
              "config.reason=smoke",
              ""
            ].join("\n"),
            stderr: ""
          };
        }
        if (/test -f .*matched-props/.test(text)) {
          return { code: 1, stdout: "", stderr: "" };
        }
        return { code: 0, stdout: "", stderr: "" };
      }
    };
  });
}

async function collectPageErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      errors.push(`${message.type()}: ${message.text()}`);
    }
  });
  return errors;
}

async function validateRiskModeInteraction(browser, viewport, url) {
  const page = await browser.newPage({ viewport });
  const errors = await collectPageErrors(page);
  try {
    await installSmokeBridge(page);
    await page.goto(url, { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(1500);
    await page.locator('button[data-page="custom"]').click({ timeout: 5000 });
    await page.waitForTimeout(500);

    const riskButtons = await page.locator("button.risk-mode-card").count();
    if (riskButtons !== 3) throw new Error(`WebUI ${viewport.name} risk mode cards expected 3, got ${riskButtons}`);
    if (await page.locator("button.risk-mode-card.safe.active").count() !== 1) {
      throw new Error(`WebUI ${viewport.name} safe risk mode was not initially active`);
    }

    for (const mode of ["caution", "aggressive", "safe"]) {
      await page.locator(`button.risk-mode-card.${mode}`).click({ timeout: 5000 });
      await page.waitForTimeout(500);
      if (await page.locator(`button.risk-mode-card.${mode}.active`).count() !== 1) {
        throw new Error(`WebUI ${viewport.name} risk mode did not switch to ${mode}`);
      }
    }
    if (errors.length) {
      throw new Error(`WebUI ${viewport.name} console errors during risk mode smoke:\n${errors.join("\n")}`);
    }
    return { riskButtons, modes: ["safe", "caution", "aggressive"] };
  } finally {
    await page.close();
  }
}

async function validateWebuiSmoke() {
  let chromium;
  try {
    ({ chromium } = require("playwright"));
  } catch (error) {
    throw new Error(`Playwright is required for WebUI smoke: ${error.message}`);
  }

  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const viewport of viewports) {
      const page = await browser.newPage({ viewport });
      const errors = await collectPageErrors(page);

      const url = pathToFileURL(path.join(root, "webroot", "index.html")).href;
      await page.goto(url, { waitUntil: "load", timeout: 30000 });
      await page.waitForTimeout(1500);
      const snapshot = await page.evaluate(() => ({
        title: document.title,
        bodyText: document.body.innerText || "",
        scripts: [...document.scripts].map((item) => item.getAttribute("src")).filter(Boolean),
        stylesheets: [...document.querySelectorAll('link[rel="stylesheet"]')].map((item) => item.getAttribute("href")),
        buttons: document.querySelectorAll("button").length,
        readyState: document.readyState
      }));

      if (errors.length) throw new Error(`WebUI ${viewport.name} console errors:\n${errors.join("\n")}`);
      if (snapshot.readyState !== "complete") throw new Error(`WebUI ${viewport.name} did not reach complete readyState`);
      if (!/Dex2oat Lock/.test(snapshot.title)) throw new Error(`WebUI ${viewport.name} title is unexpected: ${snapshot.title}`);
      if (!snapshot.scripts.some((item) => item.includes("dex2oat-ui.protected.js"))) {
        throw new Error(`WebUI ${viewport.name} missing protected JS script`);
      }
      if (!snapshot.stylesheets.some((item) => item.includes("dex2oat-ui.protected.css"))) {
        throw new Error(`WebUI ${viewport.name} missing protected CSS stylesheet`);
      }
      if (!snapshot.bodyText.includes(HOME_LABEL) || !snapshot.bodyText.includes(CUSTOM_LABEL)) {
        throw new Error(`WebUI ${viewport.name} did not render primary navigation`);
      }
      if (snapshot.buttons < 5) throw new Error(`WebUI ${viewport.name} rendered too few buttons: ${snapshot.buttons}`);

      await page.locator('button[data-page="custom"]').click({ timeout: 5000 });
      await page.waitForTimeout(500);
      const customText = await page.evaluate(() => document.body.innerText || "");
      if (!customText.includes(CONFIG_CONFIRM_LABEL) || !customText.includes(CONFIRM_LABEL)) {
        throw new Error(`WebUI ${viewport.name} custom agreement gate did not render`);
      }
      if (errors.length) {
        throw new Error(`WebUI ${viewport.name} console errors after custom navigation:\n${errors.join("\n")}`);
      }

      const riskMode = await validateRiskModeInteraction(browser, viewport, url);
      results.push({
        name: viewport.name,
        buttons: snapshot.buttons,
        riskMode,
        textBytes: Buffer.byteLength(snapshot.bodyText, "utf8")
      });
      await page.close();
    }
  } finally {
    await browser.close();
  }

  return { viewports: results };
}

module.exports = {
  validateWebuiSmoke
};

if (require.main === module) {
  validateWebuiSmoke()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exit(1);
    });
}
