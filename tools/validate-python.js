const path = require("node:path");
const { listFiles, root, run } = require("./toolkit");

async function validatePython() {
  const files = (await listFiles(root, {
    skip: ["KernelSU-ref"]
  })).filter((file) => path.extname(file) === ".py");
  const python = process.env.PYTHON || "python";
  const failures = [];
  for (const file of files) {
    const result = run(python, ["-m", "py_compile", file], { timeout: 30000 });
    if (result.status !== 0) {
      failures.push({ file, error: `${result.stdout}\n${result.stderr}`.trim() });
    }
  }
  if (failures.length) {
    throw new Error(`Python validation failed:\n${failures.map((item) => `${item.file}: ${item.error}`).join("\n")}`);
  }
  const fixture = run(python, ["tools/validate-python-fixtures.py"], { timeout: 30000 });
  if (fixture.status !== 0) {
    throw new Error(`Python fixture validation failed:\n${fixture.stdout}\n${fixture.stderr}`.trim());
  }
  return { files: files.length, python, fixtures: true };
}

module.exports = {
  validatePython
};

if (require.main === module) {
  validatePython()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exit(1);
    });
}
