const fs = require("fs");
const path = require("path");

function getStorageDir() {
  const base = process.env.FILE_STORAGE_DIR || "storage";
  return path.isAbsolute(base) ? base : path.join(process.cwd(), base);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function pdfDir() {
  return ensureDir(path.join(getStorageDir(), "pdf"));
}

function tmpDir() {
  return ensureDir(path.join(getStorageDir(), "tmp"));
}

function safeFilename(name) {
  return String(name).replace(/[^a-zA-Z0-9._-]/g, "_");
}

function buildPdfPath(type, companyId, factoryId, entityId) {
  const dir = pdfDir();
  const fname = safeFilename(`${type}-${companyId}-${factoryId || "na"}-${entityId}.pdf`);
  return path.join(dir, fname);
}

// Use for PDFs that should not remain on disk.
// Generates a unique file name (safe for concurrent downloads).
function buildTempPdfPath(type, companyId, factoryId, entityId) {
  const dir = tmpDir();
  const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const fname = safeFilename(`${type}-${companyId}-${factoryId || "na"}-${entityId}-${nonce}.pdf`);
  return path.join(dir, fname);
}

function buildPublicPdfUrl(req, absolutePath) {
  const publicBase = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
  const baseDir = pdfDir();
  const rel = path.relative(baseDir, absolutePath).split(path.sep).join("/");
  return `${publicBase}/files/pdf/${encodeURIComponent(rel)}`;
}

module.exports = {
  getStorageDir,
  pdfDir,
  tmpDir,
  buildPdfPath,
  buildTempPdfPath,
  buildPublicPdfUrl
};
