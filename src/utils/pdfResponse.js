const fs = require("fs");

function safeUnlink(p) {
  if (!p) return;
  try {
    fs.unlink(p, () => {});
  } catch (_) {
    // ignore
  }
}

// Stream a PDF file to the response and delete it after the response completes.
function streamPdfAndDelete({ res, filePath, filename, inline = true }) {
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    safeUnlink(filePath);
  };

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `${inline ? "inline" : "attachment"}; filename="${filename || "document.pdf"}"`
  );

  const stream = fs.createReadStream(filePath);
  stream.on("error", (err) => {
    cleanup();
    if (!res.headersSent) {
      res.status(500).json({ message: err?.message || "Failed to read PDF" });
    } else {
      res.end();
    }
  });

  res.on("finish", cleanup);
  res.on("close", cleanup);

  stream.pipe(res);
}

module.exports = { streamPdfAndDelete, safeUnlink };
