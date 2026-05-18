const express = require("express");
const router = express.Router();

const authMiddleware = require("../middlewares/authMiddleware");
const permissionMiddleware = require("../middlewares/permissionMiddleware");

router.get(
  "/secure-check",
  authMiddleware,
  permissionMiddleware(["admin.access"]),
  (req, res) => {
    res.json({ message: "Admin access granted" });
  }
);

module.exports = router;
