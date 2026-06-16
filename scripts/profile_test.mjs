// Verifies Wave A: profile fields (phone/headline/skills) + timestamps.
// Run: node scripts/profile_test.mjs
import dotenv from "dotenv";
dotenv.config({ path: ".env" });
process.env.NODE_ENV = "development";
process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/jobeee_profile_test";
process.env.PORT = "5089";
process.env.JWT_SECRET = process.env.JWT_SECRET || "prof_secret";
process.env.JWT_EXPIRES_TIME = process.env.JWT_EXPIRES_TIME || "7d";
process.env.COOKIE_EXPIRES_TIME = process.env.COOKIE_EXPIRES_TIME || "7";

import express from "express";
import cookieParser from "cookie-parser";
import bodyParser from "body-parser";
import fileUpload from "express-fileupload";
import mongoose from "mongoose";

import auth from "../routes/auth.js";
import user from "../routes/user.js";
import errorMiddleware from "../middleware/errors.js";

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(fileUpload());
app.use("/api/auth/v1", auth);
app.use("/api/user/v1", user);
app.use(errorMiddleware);

const results = [];
const ok = (n, c, d) => { results.push(c); console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`); };
const BASE = `http://127.0.0.1:${process.env.PORT}`;
const J = (m, p, { token, body } = {}) =>
  fetch(`${BASE}${p}`, { method: m, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined })
    .then(async (r) => ({ s: r.status, j: await r.json().catch(() => null) }));

let server;
async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await new Promise((r) => (server = app.listen(process.env.PORT, r)));
  const ts = Date.now();

  const token = (await J("POST", "/api/auth/v1/register", { body: { name: "Prof User", email: `p${ts}@t.com`, password: "password123", role: "user" } })).j.token;

  const upd = await J("PUT", "/api/user/v1/me/update", {
    token,
    body: { name: "Prof Updated", phone: "+63 912 345 6789", headline: "Full-stack dev", skills: "React, Node.js, MongoDB" },
  });
  ok("update profile fields -> 200", upd.s === 200, `status ${upd.s}`);

  const me = (await J("GET", "/api/auth/v1/me", { token })).j.user;
  ok("name updated", me.name === "Prof Updated");
  ok("phone saved", me.phone === "+63 912 345 6789", me.phone);
  ok("headline saved", me.headline === "Full-stack dev");
  ok("skills parsed to array", Array.isArray(me.skills) && me.skills.length === 3 && me.skills[0] === "React", JSON.stringify(me.skills));
  ok("timestamps present (createdAt/updatedAt)", !!me.createdAt && !!me.updatedAt);
  ok("isActive defaults true", me.isActive === true);
  ok("savedJobs defaults to empty array", Array.isArray(me.savedJobs) && me.savedJobs.length === 0);
}

main()
  .catch((e) => console.error("ERROR:", e))
  .finally(async () => {
    await mongoose.connection.dropDatabase().catch(() => {});
    await mongoose.connection.close().catch(() => {});
    if (server) server.close();
    console.log(`\n==== PROFILE SUMMARY: ${results.filter(Boolean).length}/${results.length} passed ====`);
    process.exit(0);
  });
