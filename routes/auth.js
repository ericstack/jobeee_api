const express = require("express");
const router = express.Router();

const {
  registerUser,
  forgotPassword,
  loginUser,
  resetPassword,
  logout,
} = require("../controller/authController");

const { isAuthenticatedUser } = require("../middleware/auth");

router.route("/register").post(registerUser);
router.route("/login").post(loginUser);
router.route("/password/forgot").post(forgotPassword);
router.route("/password/reset/:token").put(resetPassword);
router.route("/logout").get(isAuthenticatedUser, logout);

module.exports = router;
