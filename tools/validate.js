const { run } = require("./toolkit");
const { validateJs } = require("./validate-js");
const { validateJson } = require("./validate-json");
const { validateShell } = require("./validate-shell");

async function validateAll(environment = null) {
  const shell = await validateShell(environment?.shell);
  const js = await validateJs();
  const json = await validateJson();
  const options = run(process.execPath, ["tools/validate-options.mjs"]);
  if (options.status !== 0) {
    throw new Error(`Options validation failed:\n${options.stdout}\n${options.stderr}`.trim());
  }
  return {
    shell,
    js,
    json,
    options: JSON.parse(options.stdout)
  };
}

module.exports = {
  validateAll
};

if (require.main === module) {
  validateAll()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exit(1);
    });
}
