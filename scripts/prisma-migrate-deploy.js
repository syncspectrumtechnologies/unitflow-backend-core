const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const prismaCliJs = path.join(repoRoot, "node_modules", "prisma", "build", "index.js");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required for prisma migrate deploy");
  process.exit(1);
}

const result = fs.existsSync(prismaCliJs)
  ? spawnSync(process.execPath, [prismaCliJs, "migrate", "deploy"], {
      cwd: repoRoot,
      env: process.env,
      stdio: "inherit"
    })
  : spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["prisma", "migrate", "deploy"], {
      cwd: repoRoot,
      env: process.env,
      stdio: "inherit"
    });

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 0);
