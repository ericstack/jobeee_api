import { test, describe } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import User from "./users.js";

// Unit tests for the User model instance methods.
// These instantiate documents in memory and never touch MongoDB.

describe("User model methods", () => {
  test("getResetPasswordToken returns a 40-char hex token", () => {
    const user = new User();
    const resetToken = user.getResetPasswordToken();

    assert.match(resetToken, /^[a-f0-9]{40}$/);
  });

  test("getResetPasswordToken stores the sha256 hash of the token, not the raw token", () => {
    const user = new User();
    const resetToken = user.getResetPasswordToken();

    const expectedHash = crypto
      .createHash("sha256")
      .update(resetToken)
      .digest("hex");

    assert.equal(user.resetPasswordToken, expectedHash);
    assert.notEqual(user.resetPasswordToken, resetToken);
  });

  test("getResetPasswordToken sets an expiry ~30 minutes in the future", () => {
    const user = new User();
    const before = Date.now();
    user.getResetPasswordToken();
    const after = Date.now();

    const expire = user.resetPasswordExpire.getTime
      ? user.resetPasswordExpire.getTime()
      : user.resetPasswordExpire;

    assert.ok(expire >= before + 30 * 60 * 1000);
    assert.ok(expire <= after + 30 * 60 * 1000);
  });

  test("comparePassword returns true for a matching password", async () => {
    const plain = "supersecret123";
    const user = new User({ password: await bcrypt.hash(plain, 10) });

    assert.equal(await user.comparePassword(plain), true);
  });

  test("comparePassword returns false for a wrong password", async () => {
    const user = new User({ password: await bcrypt.hash("supersecret123", 10) });

    assert.equal(await user.comparePassword("wrongpassword"), false);
  });
});
