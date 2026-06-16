import express from "express";
import rateLimit from "express-rate-limit";
const router = express.Router();

import {
  getUserProfile,
  registerUser,
  forgotPassword,
  loginUser,
  resetPassword,
  logout,
} from "../controller/authController.js";

import { isAuthenticatedUser } from "../middleware/auth.js";

// Stricter limits on credential endpoints to slow brute-force / abuse.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many attempts. Please try again later.",
  },
});

// Password reset is more sensitive — keep it tight.
const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many password reset requests. Please try again later.",
  },
});

router.route("/register").post(authLimiter, registerUser);
router.route("/login").post(authLimiter, loginUser);
router.route("/me").get(isAuthenticatedUser, getUserProfile);
router.route("/password/forgot").post(passwordResetLimiter, forgotPassword);
router.route("/password/reset/:token").put(passwordResetLimiter, resetPassword);
router.route("/logout").post(isAuthenticatedUser, logout);

export default router;
