const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const localPrismaBinary = path.join(
  repoRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "prisma.cmd" : "prisma"
);
const hasLocalPrismaBinary = fs.existsSync(localPrismaBinary);
const command = hasLocalPrismaBinary
  ? localPrismaBinary
  : process.platform === "win32"
    ? "npx.cmd"
    : "npx";
const args = hasLocalPrismaBinary ? ["generate"] : ["prisma", "generate"];
const env = { ...process.env };

if (!env.DATABASE_URL) {
  // Prisma generate only needs a syntactically valid URL while building the client.
  env.DATABASE_URL = "postgresql://prisma:prisma@localhost:5432/unitflow";
}

const result = spawnSync(command, args, {
  cwd: repoRoot,
  env,
  stdio: "inherit"
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 0);
