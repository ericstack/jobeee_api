import express from "express";
const router = express.Router();

import {
  registerUser,
  forgotPassword,
  loginUser,
  resetPassword,
  logout,
} from "../controller/authController.js";

import { isAuthenticatedUser } from "../middleware/auth.js";

router.route("/register").post(registerUser);
router.route("/login").post(loginUser);
router.route("/password/forgot").post(forgotPassword);
router.route("/password/reset/:token").put(resetPassword);
router.route("/logout").get(isAuthenticatedUser, logout);

export default router;
