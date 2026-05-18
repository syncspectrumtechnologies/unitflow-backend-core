const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const authMiddleware = require("../middlewares/authMiddleware");

router.post("/login", authController.login);
router.get("/me", authMiddleware, authController.me);
router.post("/refresh", authMiddleware, authController.refresh);

router.post("/forgot-password/request-otp", authController.requestPasswordResetOtp);
router.post("/forgot-password/reset", authController.resetOwnPasswordWithOtp);

module.exports = router;
