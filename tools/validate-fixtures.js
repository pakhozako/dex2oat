const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { detectShell } = require("./environment");
const { root, run, safeRemove } = require("./toolkit");

const fixtureRoot = path.join(root, "tools", "fixtures", "matching");

function toShellPath(file, shellType) {
  const resolved = path.resolve(file);
  if (shellType === "git-bash") {
    const match = resolved.match(/^([A-Za-z]):\\(.*)$/);
    if (match) return `/${match[1].toLowerCase()}/${match[2].replace(/\\/g, "/")}`;
  }
  if (shellType === "wsl") {
    const match = resolved.match(/^([A-Za-z]):\\(.*)$/);
    if (match) return `/mnt/${match[1].toLowerCase()}/${match[2].replace(/\\/g, "/")}`;
  }
  return resolved.replace(/\\/g, "/");
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function runShell(shell, command, options = {}) {
  const args = shell.type === "wsl" ? ["sh", "-c", command] : ["-c", command];
  const result = run(shell.command, args, { timeout: options.timeout || 120000 });
  if (result.status !== 0) {
    throw new Error(`${command} failed\n${result.stdout}\n${result.stderr}`.trim());
  }
  return result;
}

async function prepareWebuiModules(tempDir) {
  const jsDir = path.join(tempDir, "webui-js");
  await fsp.mkdir(jsDir, { recursive: true });
  for (const file of ["bridge", "config", "utils", "skin-manifest"]) {
    const source = await fsp.readFile(path.join(root, "webroot-src", "js", `${file}.js`), "utf8");
    await fsp.writeFile(path.join(jsDir, `${file}.mjs`), source.replace(/\.\/([a-z0-9-]+)\.js/g, "./$1.mjs"), "utf8");
  }
  return path.join(jsDir, "config.mjs");
}

function defaultConfigForOptions(options) {
  const items = {};
  for (const category of options.categories || []) {
    for (const item of category.items || []) {
      items[item.id] = {
        enabled: false,
        value: String(item.fallbackValue ?? item.defaultValue ?? ""),
        explicit: false,
        matched: false
      };
    }
  }
  return {
    profile: "safe",
    riskMode: "safe",
    riskAgreement: {
      version: 2,
      agreed: false,
      customUnlocked: false,
      aggressiveUnlocked: false
    },
    pendingReboot: false,
    items
  };
}

async function validateShellFixtures(shell, tempDir) {
  const fakeBin = path.join(tempDir, "fakebin");
  await fsp.mkdir(fakeBin, { recursive: true });
  const fakeGetprop = path.join(fakeBin, "getprop");
  const getpropFixture = await fsp.readFile(path.join(fixtureRoot, "outside-prefix.getprop"), "utf8");
  await fsp.writeFile(fakeGetprop, `#!/bin/sh\ncat <<'EOF'\n${getpropFixture.trim()}\nEOF\n`, "utf8");
  await fsp.chmod(fakeGetprop, 0o755);

  const rules = path.join(fixtureRoot, "outside-prefix.rule-props.tsv");
  const captured = path.join(tempDir, "captured.txt");
  const output = path.join(tempDir, "system.prop");
  const matched = path.join(tempDir, "matched-props.txt");
  const report = path.join(tempDir, "match-report.txt");
  const source = path.join(tempDir, "config-source.prop");
  const emptyOutput = path.join(tempDir, "empty-system.prop");
  const emptyMatched = path.join(tempDir, "empty-matched-props.txt");
  const emptyReport = path.join(tempDir, "empty-report.txt");
  const emptySource = path.join(tempDir, "empty-source.prop");

  const prefix = `PATH=${shellQuote(toShellPath(fakeBin, shell.type))}:$PATH`;
  runShell(shell, `${prefix} sh ${shellQuote(toShellPath(path.join(root, "scripts", "capture-props.sh"), shell.type))} ${shellQuote(toShellPath(captured, shell.type))} "" ${shellQuote(toShellPath(rules, shell.type))}`);
  const capturedText = await fsp.readFile(captured, "utf8");
  if (!capturedText.includes("persist.vendor.dex2oat.fixture")) throw new Error("outside-prefix fixture was not captured");
  if (capturedText.includes("debug.dex2oat.unmanaged")) throw new Error("unmanaged getprop leaked into rule-driven capture");

  runShell(shell, `sh ${shellQuote(toShellPath(path.join(root, "scripts", "generate-props.sh"), shell.type))} ${shellQuote(toShellPath(captured, shell.type))} ${shellQuote(toShellPath(rules, shell.type))} ${shellQuote(toShellPath(output, shell.type))} ${shellQuote(toShellPath(matched, shell.type))} ${shellQuote(toShellPath(report, shell.type))} ${shellQuote(toShellPath(source, shell.type))} fixture ""`);
  const matchedText = await fsp.readFile(matched, "utf8");
  if (!/^persist\.vendor\.dex2oat\.fixture=true$/m.test(matchedText)) throw new Error("outside-prefix fixture did not generate matched prop");

  runShell(shell, `sh ${shellQuote(toShellPath(path.join(root, "scripts", "generate-props.sh"), shell.type))} ${shellQuote(toShellPath(path.join(fixtureRoot, "empty-captured.txt"), shell.type))} ${shellQuote(toShellPath(rules, shell.type))} ${shellQuote(toShellPath(emptyOutput, shell.type))} ${shellQuote(toShellPath(emptyMatched, shell.type))} ${shellQuote(toShellPath(emptyReport, shell.type))} ${shellQuote(toShellPath(emptySource, shell.type))} fixture ""`);
  const emptySystemProp = await fsp.readFile(emptyOutput, "utf8");
  const emptyMatchedText = await fsp.readFile(emptyMatched, "utf8");
  const emptySourceText = await fsp.readFile(emptySource, "utf8");
  if (!emptySystemProp.includes("# Dex2oat Lock generated system.prop")) throw new Error("empty matched fixture lost generated header");
  if (emptyMatchedText.trim()) throw new Error("empty matched fixture produced matched props");
  if (!/^matched_total=0$/m.test(emptySourceText)) throw new Error("empty matched fixture did not record matched_total=0");
}

async function validateSkinUnlockFixtures(shell, tempDir) {
  const stateDir = path.join(tempDir, "skin-state");
  const stateDirSh = toShellPath(stateDir, shell.type);
  const modDirSh = toShellPath(root, shell.type);
  const scriptSh = toShellPath(path.join(root, "core", "skin-unlock.sh"), shell.type);
  const stateEnv = `STATE_DIR=${shellQuote(stateDirSh)}`;
  const runSkin = (args) => runShell(shell, `${stateEnv} sh ${shellQuote(scriptSh)} ${shellQuote(modDirSh)} ${args}`);

  runSkin("unlock-many fnv1a-device-a 12345 memorial-amber founder-qingmu");
  const firstFile = JSON.parse(await fsp.readFile(path.join(stateDir, "unlocked-skins.json"), "utf8"));
  if ((firstFile.records || []).length !== 2) throw new Error("unlock-many did not write multiple skin records atomically");

  runSkin("unlock-many fnv1a-device-a 12345 memorial-amber founder-qingmu");
  const secondFile = JSON.parse(await fsp.readFile(path.join(stateDir, "unlocked-skins.json"), "utf8"));
  if ((secondFile.records || []).length !== 2) throw new Error("unlock-many duplicated skin records for the same installHash");

  const listA = JSON.parse(runSkin("list fnv1a-device-a").stdout || "{}");
  if (!listA.skins?.includes("memorial-amber") || !listA.skins?.includes("founder-qingmu")) {
    throw new Error("skin unlock list did not return records for the matching installHash");
  }

  const listB = JSON.parse(runSkin("list fnv1a-device-b").stdout || "{}");
  if (listB.skins?.includes("memorial-amber") || listB.skins?.includes("founder-qingmu")) {
    throw new Error("skin unlock list accepted copied records from a different installHash");
  }

  const missingHash = JSON.parse(runSkin("list").stdout || "{}");
  if (missingHash.ok !== false || missingHash.skins?.some((id) => id !== "default")) {
    throw new Error("skin unlock list did not fail closed when installHash was missing");
  }
}

async function validateSupporterInstallIdFixtures(shell, tempDir) {
  const stateDir = path.join(tempDir, "supporter-install-id-state");
  await fsp.mkdir(stateDir, { recursive: true });
  await fsp.writeFile(path.join(stateDir, "supporter-install-id"), "bad\n", "utf8");

  const stateDirSh = toShellPath(stateDir, shell.type);
  const modDirSh = toShellPath(root, shell.type);
  const scriptSh = toShellPath(path.join(root, "core", "supporter-install-id.sh"), shell.type);
  const stateEnv = `STATE_DIR=${shellQuote(stateDirSh)}`;
  const runInstallId = () => JSON.parse(runShell(shell, `${stateEnv} sh ${shellQuote(scriptSh)} ${shellQuote(modDirSh)}`).stdout || "{}");

  const first = runInstallId();
  if (first.ok !== true || !/^[a-f0-9-]{8,96}$/i.test(first.installId || "")) {
    throw new Error("supporter install id did not repair a corrupted id");
  }

  const second = runInstallId();
  if (second.installId !== first.installId) {
    throw new Error("supporter install id is not stable across repeated reads");
  }

  const stored = (await fsp.readFile(path.join(stateDir, "supporter-install-id"), "utf8")).trim();
  if (stored !== first.installId) {
    throw new Error("supporter install id output does not match the stored file");
  }
}

async function validateRedeemCodeVerifyFixtures(shell, tempDir) {
  const fakeBin = path.join(tempDir, "redeem-fakebin");
  const stateDir = path.join(tempDir, "redeem-state");
  await fsp.mkdir(fakeBin, { recursive: true });
  await fsp.mkdir(stateDir, { recursive: true });
  const fakeCurl = path.join(fakeBin, "curl");
  await fsp.writeFile(fakeCurl, `#!/bin/sh
OUT=""
PAYLOAD=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -k|--insecure)
      echo "insecure curl is forbidden" >&2
      exit 9
      ;;
    -o)
      shift
      OUT="$1"
      ;;
    --data)
      shift
      PAYLOAD="$1"
      ;;
  esac
  shift || break
done
[ -n "$OUT" ] || exit 2
case "$PAYLOAD" in
  *MEMORIALAMBER12345*)
    printf '%s\\n' '{"ok":true,"codeId":"mem-fixture","skinIds":["memorial-amber"],"verifiedAt":12345}' > "$OUT"
    printf 200
    ;;
  *FOUNDERQINGMU12345*)
    printf '%s\\n' '{"ok":true,"codeId":"founder-fixture","skinIds":["founder-qingmu"],"verifiedAt":12346}' > "$OUT"
    printf 200
    ;;
  *NOSCOPECODE123456X*)
    printf '%s\\n' '{"ok":true,"codeId":"plain-fixture","verifiedAt":12347}' > "$OUT"
    printf 200
    ;;
  *)
    printf '%s\\n' '{"ok":false,"error":"not_found","message":"not found"}' > "$OUT"
    printf 404
    ;;
esac
`, "utf8");
  await fsp.chmod(fakeCurl, 0o755);

  const stateDirSh = toShellPath(stateDir, shell.type);
  const fakeBinSh = toShellPath(fakeBin, shell.type);
  const modDirSh = toShellPath(root, shell.type);
  const scriptSh = toShellPath(path.join(root, "core", "redeem-code-verify.sh"), shell.type);
  const runRedeem = (code, installHash = "fnv1a-fixture-device") => {
    const command = [
      `PATH=${shellQuote(fakeBinSh)}:$PATH`,
      `STATE_DIR=${shellQuote(stateDirSh)}`,
      `DEX2OAT_SUPPORTER_VERIFY_URL=https://fixture.invalid/api/supporter/verify`,
      "sh",
      shellQuote(scriptSh),
      shellQuote(modDirSh),
      shellQuote(code),
      shellQuote(installHash)
    ].join(" ");
    return runShell(shell, command);
  };
  const runRedeemRaw = (code, installHash = "fnv1a-fixture-device") => {
    const command = [
      `PATH=${shellQuote(fakeBinSh)}:$PATH`,
      `STATE_DIR=${shellQuote(stateDirSh)}`,
      `DEX2OAT_SUPPORTER_VERIFY_URL=https://fixture.invalid/api/supporter/verify`,
      "sh",
      shellQuote(scriptSh),
      shellQuote(modDirSh),
      shellQuote(code),
      shellQuote(installHash)
    ].join(" ");
    const args = shell.type === "wsl" ? ["sh", "-c", command] : ["-c", command];
    return run(shell.command, args, { timeout: 120000 });
  };

  const memorial = JSON.parse(runRedeem("MEMORIALAMBER12345").stdout || "{}");
  if (!memorial.ok || memorial.skins?.length !== 1 || memorial.skins[0] !== "memorial-amber") {
    throw new Error("redeem fixture did not return memorial-only skin scope");
  }
  const afterMemorial = JSON.parse(runShell(shell, `STATE_DIR=${shellQuote(stateDirSh)} sh ${shellQuote(toShellPath(path.join(root, "core", "skin-unlock.sh"), shell.type))} ${shellQuote(modDirSh)} list fnv1a-fixture-device`).stdout || "{}");
  if (!afterMemorial.skins?.includes("memorial-amber") || afterMemorial.skins?.includes("founder-qingmu")) {
    throw new Error("redeem fixture unlocked the wrong skins for memorial code");
  }

  const founder = JSON.parse(runRedeem("FOUNDERQINGMU12345").stdout || "{}");
  if (!founder.ok || founder.skins?.length !== 1 || founder.skins[0] !== "founder-qingmu") {
    throw new Error("redeem fixture did not return founder-only skin scope");
  }
  const afterFounder = JSON.parse(runShell(shell, `STATE_DIR=${shellQuote(stateDirSh)} sh ${shellQuote(toShellPath(path.join(root, "core", "skin-unlock.sh"), shell.type))} ${shellQuote(modDirSh)} list fnv1a-fixture-device`).stdout || "{}");
  if (!afterFounder.skins?.includes("memorial-amber") || !afterFounder.skins?.includes("founder-qingmu")) {
    throw new Error("redeem fixture did not preserve both scoped unlock records");
  }

  const missingScope = runRedeemRaw("NOSCOPECODE123456X", "fnv1a-scope-missing");
  if (missingScope.status === 0) throw new Error("redeem fixture accepted a success response without skin scope");
  const missingData = JSON.parse(missingScope.stdout || "{}");
  if (missingData.error !== "skin_scope_missing") {
    throw new Error("redeem fixture did not fail closed when skin scope was missing");
  }
}

async function validateWebuiSkinFixtures() {
  const appSource = await fsp.readFile(path.join(root, "webroot-src", "js", "app.js"), "utf8");
  const legacyRefs = [...appSource.matchAll(/legacySupporterUnlocksMemorial\(/g)].length;
  if (!/function legacySupporterUnlocksMemorial\(\) \{\n  return false;\n\}/.test(appSource)) {
    throw new Error("legacy supporter pass can still unlock memorial skin");
  }
  if (legacyRefs !== 1) throw new Error("legacy supporter unlock helper is still used outside its disabled definition");
  if (/unlockedSkinIdsFromCloud/.test(appSource)) throw new Error("redeem result still uses cloud-scope fallback naming");
  const stableInstallBlock = appSource.slice(appSource.indexOf("function getStableInstallId"), appSource.indexOf("function generateRandomId"));
  if (/getOrCreateTelemetryInstallId\(\)/.test(stableInstallBlock)) {
    throw new Error("supporter installHash still falls back to localStorage telemetry id");
  }

  const redeemSource = await fsp.readFile(path.join(root, "core", "redeem-code-verify.sh"), "utf8");
  if (/ unlock-all /.test(redeemSource)) throw new Error("redeem-code-verify still uses hard-coded full unlock");
  if (!/ unlock-many /.test(redeemSource)) throw new Error("redeem-code-verify does not use scoped atomic unlock-many");
  if (!/json_array_values skinIds/.test(redeemSource)) throw new Error("redeem-code-verify does not parse structured skinIds scope");
  if (/for SKIN_ID in \$UNLOCK_SKINS/.test(redeemSource)) throw new Error("redeem-code-verify still unlocks skins in multiple transactions");
  if (/fallback_install_hash/.test(redeemSource)) throw new Error("redeem-code-verify still has a shell-side installHash fallback");
}

async function validateRiskModeUiFixtures() {
  const appSource = await fsp.readFile(path.join(root, "webroot-src", "js", "app.js"), "utf8");
  const currentStart = appSource.indexOf("function currentRiskMode()");
  const syncStart = appSource.indexOf("function syncRiskMode", currentStart);
  if (currentStart < 0 || syncStart < 0) throw new Error("risk mode helpers are missing from app.js");

  const currentBlock = appSource.slice(currentStart, syncStart);
  if (!/state\.config\?\.riskMode/.test(currentBlock) || !/state\.config\?\.profile/.test(currentBlock)) {
    throw new Error("currentRiskMode no longer reads the saved config risk mode");
  }
  if (!/state\.unifiedState\?\.\["risk\.mode"\]/.test(currentBlock)) {
    throw new Error("currentRiskMode no longer falls back to unified risk.mode");
  }
  if (!/return "safe";/.test(currentBlock)) {
    throw new Error("currentRiskMode lost its explicit safe fallback");
  }

  const persistStart = appSource.indexOf("async function persistWebConfig");
  const aboutStart = appSource.indexOf("function renderAbout", persistStart);
  if (persistStart < 0 || aboutStart < 0) throw new Error("persistWebConfig block is missing from app.js");
  const persistBlock = appSource.slice(persistStart, aboutStart);
  if (!/"risk\.mode": persistedRiskMode/.test(persistBlock)) {
    throw new Error("persistWebConfig no longer updates in-memory unified risk.mode");
  }
  if (!/"risk\.aggressive_unlocked": state\.config\.riskAgreement\?\.aggressiveUnlocked/.test(persistBlock)) {
    throw new Error("persistWebConfig no longer mirrors risk agreement state after saving");
  }
}

async function validateCloudSupporterFixtures() {
  const serverPath = path.join(root, "deploy", "cloud", "dex2oat_cloud_server.py");
  const poolPath = path.join(root, "deploy", "cloud", "supporters.private.json");
  const serverSource = await fsp.readFile(serverPath, "utf8");
  if (!/def supporter_skin_ids\(entry\):/.test(serverSource)) {
    throw new Error("cloud supporter verify response has no structured skin scope helper");
  }
  if (!/"codeId": matched_code_id/.test(serverSource)) {
    throw new Error("cloud supporter verify response no longer returns codeId");
  }
  if (!/"skinId": skin_ids\[0\] if len\(skin_ids\) == 1 else ""/.test(serverSource)) {
    throw new Error("cloud supporter verify response no longer returns skinId");
  }
  if (!/"skinIds": skin_ids/.test(serverSource)) {
    throw new Error("cloud supporter verify response no longer returns skinIds");
  }

  const pool = JSON.parse(await fsp.readFile(poolPath, "utf8"));
  const items = Array.isArray(pool.items) ? pool.items : [];
  const counts = { "memorial-amber": 0, "founder-qingmu": 0 };
  for (const item of items) {
    if (Object.prototype.hasOwnProperty.call(counts, item.skinId)) counts[item.skinId] += 1;
    if (item.skinId && (!Array.isArray(item.skinIds) || !item.skinIds.includes(item.skinId))) {
      throw new Error(`supporter pool item ${item.id || item.codeId || "unknown"} has inconsistent skinIds`);
    }
  }
  if (counts["memorial-amber"] !== 500 || counts["founder-qingmu"] !== 10) {
    throw new Error(`supporter pool split changed unexpectedly: memorial=${counts["memorial-amber"]}, founder=${counts["founder-qingmu"]}`);
  }
}

async function validateWebuiFixtures(tempDir) {
  const configModulePath = await prepareWebuiModules(tempDir);
  const configModule = await import(pathToFileURL(configModulePath).href);
  const options = JSON.parse(await fsp.readFile(path.join(root, "webroot-src", "data", "options.json"), "utf8"));
  const config = defaultConfigForOptions(options);
  const matchedText = await fsp.readFile(path.join(fixtureRoot, "cross-risk.matched-props.txt"), "utf8");
  const matched = new Set(matchedText.split(/\\r?\\n/).filter(Boolean).map((line) => line.slice(0, line.indexOf("="))));
  config.items.pm_install.enabled = true;
  config.items.pm_install.value = "speed";
  const systemProp = configModule.generateSystemPropForMatched(options, config, "", matched);
  if (!/^pm\.dexopt\.install=speed$/m.test(systemProp)) {
    throw new Error("cross-risk matched fixture was still filtered by riskMode=safe");
  }
  let legacyFailed = false;
  try {
    configModule.generateSystemProp(options, config, "");
  } catch {
    legacyFailed = true;
  }
  if (!legacyFailed) throw new Error("legacy generateSystemProp did not require matched props");
}

async function validateFixtures() {
  const shell = detectShell();
  if (!shell.command) throw new Error("No shell found for fixture validation");
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "dex2oat-fixtures-"));
  try {
    await validateShellFixtures(shell, tempDir);
    await validateSkinUnlockFixtures(shell, tempDir);
    await validateSupporterInstallIdFixtures(shell, tempDir);
    await validateRedeemCodeVerifyFixtures(shell, tempDir);
    await validateWebuiFixtures(tempDir);
    await validateWebuiSkinFixtures();
    await validateRiskModeUiFixtures();
    await validateCloudSupporterFixtures();
  } finally {
    await safeRemove(tempDir, os.tmpdir());
  }
  return { fixtures: 13, shell: shell.type };
}

module.exports = {
  validateFixtures
};

if (require.main === module) {
  validateFixtures()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exit(1);
    });
}
