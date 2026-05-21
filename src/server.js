require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { env, validate } = require("./config/env");

const generatedPrismaClientPath = path.join(__dirname, "generated", "prisma", "index.js");

function ensurePrismaClientGenerated() {
  if (fs.existsSync(generatedPrismaClientPath)) return;

  console.warn("Prisma client not found at startup. Running prisma generate.");

  const generateScriptPath = path.resolve(
    __dirname,
    "..",
    "scripts",
    "prisma-generate.js"
  );
  const result = spawnSync(process.execPath, [generateScriptPath], {
    cwd: path.resolve(__dirname, ".."),
    env: process.env,
    stdio: "inherit"
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`prisma generate failed with exit code ${result.status}`);
  }
  if (!fs.existsSync(generatedPrismaClientPath)) {
    throw new Error("Prisma client generation completed but the generated client is still missing.");
  }
}

if (env.validateEnvOnBoot) {
  validate();
}

(async () => {
  try {
    ensurePrismaClientGenerated();

    const app = require("./app");
    const prisma = require("./config/db");
    const { ensureDefaultPermissions, ensureSystemRoles } = require("./utils/permissionSeeder");
    const { initSocketServer } = require("./sockets/socketServer");
    const { startMessageDispatchQueue } = require("./services/messageDispatchQueue");

    try {
      await ensureDefaultPermissions();
      await ensureSystemRoles();
    } catch (e) {
      console.error("Permission seeding failed:", e?.message || e);
    }

    const { server } = initSocketServer(app);
    startMessageDispatchQueue();

    const gracefulShutdown = async (signal) => {
      console.log("Received shutdown signal", signal);
      server.close(async () => {
        await prisma.$disconnect().catch(() => null);
        process.exit(0);
      });
    };

    process.on("SIGTERM", gracefulShutdown);
    process.on("SIGINT", gracefulShutdown);

    server.listen(env.port, "0.0.0.0", () => {
      console.log("UnitFlow core API started", {
        port: env.port,
        runtime_mode: env.runtimeMode,
        api_client_mode: env.apiClientMode,
        build_fingerprint: env.buildFingerprint
      });
    });
  } catch (e) {
    console.error("Server boot failed:", e?.message || e);
    process.exit(1);
  }
})();
