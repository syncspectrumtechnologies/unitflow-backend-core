const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const authMiddleware = require("../middlewares/authMiddleware");
const {
  validateLogin,
  validatePasswordResetRequest,
  validatePasswordReset
} = require("../middlewares/authValidationMiddleware");

router.post("/login", validateLogin, authController.login);
router.get("/me", authMiddleware, authController.me);
router.post("/refresh", authMiddleware, authController.refresh);

router.post("/forgot-password/request-otp", validatePasswordResetRequest, authController.requestPasswordResetOtp);
router.post("/forgot-password/reset", validatePasswordReset, authController.resetOwnPasswordWithOtp);

module.exports = router;
