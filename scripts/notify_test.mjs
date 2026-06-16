// Verifies Wave D: non-blocking email notifications + atomic apply dedupe.
// SMTP points at a dead port so notify() fails fast (must NOT break requests).
// Run: node scripts/notify_test.mjs
import dotenv from "dotenv";
dotenv.config({ path: ".env" });
process.env.NODE_ENV = "development";
process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/jobeee_notify_test";
process.env.PORT = "5086";
process.env.JWT_SECRET = process.env.JWT_SECRET || "notify_secret";
process.env.JWT_EXPIRES_TIME = process.env.JWT_EXPIRES_TIME || "7d";
process.env.COOKIE_EXPIRES_TIME = process.env.COOKIE_EXPIRES_TIME || "7";
process.env.MAX_FILE_SIZE = "2000000";
process.env.SMTP_HOST = "127.0.0.1";
process.env.SMTP_PORT = "1"; // nothing listening -> sendMail rejects fast

import express from "express";
import cookieParser from "cookie-parser";
import bodyParser from "body-parser";
import fileUpload from "express-fileupload";
import mongoose from "mongoose";
import path from "path";
import fs from "fs";

const UPLOAD_PATH = path.resolve("./public/uploads");
fs.mkdirSync(UPLOAD_PATH, { recursive: true });
process.env.UPLOAD_PATH = UPLOAD_PATH;

import auth from "../routes/auth.js";
import user from "../routes/user.js";
import jobsRoute from "../routes/jobs.js";
import errorMiddleware from "../middleware/errors.js";
import Job from "../models/jobs.js";

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(fileUpload());
app.use("/api/auth/v1", auth);
app.use("/api/user/v1", user);
app.use("/api/jobs/v1", jobsRoute);
app.use(errorMiddleware);

const results = [];
const ok = (n, c, d) => { results.push(c); console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`); };
const BASE = `http://127.0.0.1:${process.env.PORT}`;
const reg = (b) => fetch(`${BASE}/api/auth/v1/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json());
const me = (t) => fetch(`${BASE}/api/auth/v1/me`, { headers: { Authorization: `Bearer ${t}` } }).then((r) => r.json()).then((j) => j.user._id);
const applyPdf = (jobId, token) => {
  const fd = new FormData();
  fd.append("file", new Blob([Buffer.from("%PDF x")], { type: "application/pdf" }), "cv.pdf");
  return fetch(`${BASE}/api/jobs/v1/job/${jobId}/apply`, { method: "PUT", headers: { Authorization: `Bearer ${token}` }, body: fd }).then((r) => r.status);
};

let server;
async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await new Promise((r) => (server = app.listen(process.env.PORT, r)));
  const ts = Date.now();

  const empToken = (await reg({ name: "Emp", email: `e${ts}@t.com`, password: "password123", role: "employer" })).token;
  const userToken = (await reg({ name: "Seeker", email: `u${ts}@t.com`, password: "password123", role: "user" })).token;
  const empId = await me(empToken);
  const userId = await me(userToken);

  const [job] = await Job.insertMany([{
    title: "Notify Job", description: "d", address: "X", company: "Co",
    industry: ["Others"], jobType: "Permanent", minEducation: "Bachelors",
    experience: "No Experience", salary: 60000, user: new mongoose.Types.ObjectId(empId),
    lastDate: new Date(Date.now() + 7 * 864e5),
  }]);
  const jobId = job._id.toString();

  const a1 = await applyPdf(jobId, userToken);
  ok("apply succeeds despite SMTP down (non-blocking)", a1 === 200, `status ${a1}`);

  const a2 = await applyPdf(jobId, userToken);
  ok("second apply blocked by atomic dedupe -> 400", a2 === 400, `status ${a2}`);

  const st = await fetch(`${BASE}/api/jobs/v1/job/${jobId}/applicant/${userId}/status`, {
    method: "PUT", headers: { Authorization: `Bearer ${empToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ status: "shortlisted" }),
  }).then((r) => r.status);
  ok("status update succeeds despite SMTP down", st === 200, `status ${st}`);

  // cleanup uploaded resume
  try { fs.readdirSync(UPLOAD_PATH).filter((f) => f.startsWith("Seeker_")).forEach((f) => fs.rmSync(path.join(UPLOAD_PATH, f), { force: true })); } catch {}
}

main()
  .catch((e) => console.error("ERROR:", e))
  .finally(async () => {
    await mongoose.connection.dropDatabase().catch(() => {});
    await mongoose.connection.close().catch(() => {});
    if (server) server.close();
    console.log(`\n==== NOTIFY/DEDUPE SUMMARY: ${results.filter(Boolean).length}/${results.length} passed ====`);
    process.exit(0);
  });
