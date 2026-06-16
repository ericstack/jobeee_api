// Verifies avatar upload uses a unique filename per upload and deletes the old one.
// Isolated demo DB. Run: node scripts/avatar_test.mjs
import dotenv from "dotenv";
dotenv.config({ path: ".env" });
process.env.NODE_ENV = "development";
process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/jobeee_avatar_test";
process.env.PORT = "5094";
process.env.JWT_SECRET = process.env.JWT_SECRET || "avatar_secret";
process.env.JWT_EXPIRES_TIME = process.env.JWT_EXPIRES_TIME || "7d";
process.env.COOKIE_EXPIRES_TIME = process.env.COOKIE_EXPIRES_TIME || "7";
process.env.MAX_FILE_SIZE = process.env.MAX_FILE_SIZE || "2000000";

import express from "express";
import cookieParser from "cookie-parser";
import fileUpload from "express-fileupload";
import bodyParser from "body-parser";
import mongoose from "mongoose";
import fs from "fs";
import path from "path";

const UPLOAD_PATH = path.resolve("./public/uploads");
fs.mkdirSync(UPLOAD_PATH, { recursive: true });
process.env.UPLOAD_PATH = UPLOAD_PATH;

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

let server;
async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await new Promise((r) => (server = app.listen(process.env.PORT, r)));
  const BASE = `http://127.0.0.1:${process.env.PORT}`;
  const ts = Date.now();

  const reg = await fetch(`${BASE}/api/auth/v1/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Pic User", email: `pic${ts}@t.com`, password: "password123", role: "employer" }),
  }).then((r) => r.json());
  const token = reg.token;

  const upload = async (label) => {
    const fd = new FormData();
    fd.append("photo", new Blob([Buffer.from("\x89PNG fake " + label)], { type: "image/png" }), "me.png");
    const r = await fetch(`${BASE}/api/user/v1/me/update`, { method: "PUT", headers: { Authorization: `Bearer ${token}` }, body: fd });
    const j = await r.json();
    return j?.data?.avatar;
  };

  const first = await upload("one");
  ok("1st upload sets avatar", !!first && /^avatar_.*_\d+\.png$/.test(first), first);
  const firstExists = fs.existsSync(path.join(UPLOAD_PATH, first));
  ok("1st file written to disk", firstExists);

  const second = await upload("two");
  ok("2nd upload sets a DIFFERENT filename", !!second && second !== first, `${first} -> ${second}`);
  ok("2nd file exists on disk", fs.existsSync(path.join(UPLOAD_PATH, second)));
  ok("OLD file deleted (no stale cache target)", !fs.existsSync(path.join(UPLOAD_PATH, first)));

  // cleanup
  [first, second].forEach((f) => { try { fs.rmSync(path.join(UPLOAD_PATH, f), { force: true }); } catch {} });
}

main()
  .catch((e) => console.error("ERROR:", e))
  .finally(async () => {
    await mongoose.connection.dropDatabase().catch(() => {});
    await mongoose.connection.close().catch(() => {});
    if (server) server.close();
    console.log(`\n==== AVATAR SUMMARY: ${results.filter(Boolean).length}/${results.length} passed ====`);
    process.exit(0);
  });
