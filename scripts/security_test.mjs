// Verifies Security P1 backend fixes: pre-save hash hook, password-reset flow,
// and per-endpoint rate limiting. Isolated DB. Run: node scripts/security_test.mjs
import dotenv from "dotenv";
dotenv.config({ path: ".env" });
process.env.NODE_ENV = "development";
process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/jobeee_sec_test";
process.env.PORT = "5092";
process.env.JWT_SECRET = process.env.JWT_SECRET || "sec_secret";
process.env.JWT_EXPIRES_TIME = process.env.JWT_EXPIRES_TIME || "7d";
process.env.COOKIE_EXPIRES_TIME = process.env.COOKIE_EXPIRES_TIME || "7";

import express from "express";
import cookieParser from "cookie-parser";
import bodyParser from "body-parser";
import mongoose from "mongoose";

import auth from "../routes/auth.js";
import errorMiddleware from "../middleware/errors.js";
import User from "../models/users.js";

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use("/api/auth/v1", auth);
app.use(errorMiddleware);

const results = [];
const ok = (n, c, d) => { results.push(c); console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`); };

const BASE = `http://127.0.0.1:${process.env.PORT}`;
const J = (m, p, body) =>
  fetch(`${BASE}${p}`, { method: m, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined })
    .then(async (r) => ({ s: r.status, j: await r.json().catch(() => null) }));
const login = (email, password) => J("POST", "/api/auth/v1/login", { email, password });

let server;
async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await new Promise((r) => (server = app.listen(process.env.PORT, r)));
  const ts = Date.now();
  const email = `sec${ts}@t.com`;

  await J("POST", "/api/auth/v1/register", { name: "Sec User", email, password: "password123", role: "user" });

  // --- pre-save hash hook: saving a doc without changing the password must NOT re-hash it ---
  const u = await User.findOne({ email });
  u.resetPasswordToken = "dummy";
  await u.save({ validateBeforeSave: false }); // would corrupt the hash with the old buggy hook
  const afterTokenSave = await login(email, "password123");
  ok("hash hook: login still works after a non-password save", afterTokenSave.s === 200, `status ${afterTokenSave.s}`);

  // --- reset flow: generate a token like forgotPassword, then reset ---
  const user = await User.findOne({ email });
  const rawToken = user.getResetPasswordToken();
  await user.save({ validateBeforeSave: false });
  const reset = await J("PUT", `/api/auth/v1/password/reset/${rawToken}`, { password: "newpassword123" });
  ok("reset with valid token succeeds", reset.s === 200 && !!reset.j?.token, `status ${reset.s}`);
  ok("login with NEW password works", (await login(email, "newpassword123")).s === 200);
  ok("login with OLD password fails", (await login(email, "password123")).s === 401);

  // --- reset enforces min length ---
  const user2 = await User.findOne({ email });
  const rawToken2 = user2.getResetPasswordToken();
  await user2.save({ validateBeforeSave: false });
  const shortReset = await J("PUT", `/api/auth/v1/password/reset/${rawToken2}`, { password: "short" });
  ok("reset rejects password < 8 chars -> 400", shortReset.s === 400, `status ${shortReset.s}`);

  // --- invalid/expired token rejected ---
  const badReset = await J("PUT", `/api/auth/v1/password/reset/deadbeef`, { password: "whatever123" });
  ok("reset with bad token -> 400", badReset.s === 400, `status ${badReset.s}`);

  // --- rate limiting on /login (authLimiter max 30 / 15min, shared with register) ---
  let limited = false;
  for (let i = 0; i < 40; i++) {
    const r = await login(email, "wrongpass");
    if (r.s === 429) { limited = true; break; }
  }
  ok("login rate limit eventually returns 429", limited);
}

main()
  .catch((e) => console.error("ERROR:", e))
  .finally(async () => {
    await mongoose.connection.dropDatabase().catch(() => {});
    await mongoose.connection.close().catch(() => {});
    if (server) server.close();
    console.log(`\n==== SECURITY SUMMARY: ${results.filter(Boolean).length}/${results.length} passed ====`);
    process.exit(0);
  });
