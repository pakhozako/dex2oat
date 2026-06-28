const { run } = require("./toolkit");

async function protectWebui() {
  const result = run(process.execPath, ["tools/build-webui.mjs"], { timeout: 120000 });
  if (result.status !== 0) {
    throw new Error(`WebUI protect failed:\n${result.stdout}\n${result.stderr}`.trim());
  }
  return JSON.parse(result.stdout);
}

module.exports = {
  protectWebui
};

if (require.main === module) {
  protectWebui()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exit(1);
    });
}
