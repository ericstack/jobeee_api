// Verifies #18: resume access control (owner/admin/self only). Run: node scripts/resume_acl_test.mjs
import dotenv from "dotenv";
dotenv.config({ path: ".env" });
process.env.NODE_ENV = "development";
process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/jobeee_resumeacl_test";
process.env.PORT = "5085";
process.env.JWT_SECRET = process.env.JWT_SECRET || "racl_secret";
process.env.JWT_EXPIRES_TIME = process.env.JWT_EXPIRES_TIME || "7d";
process.env.COOKIE_EXPIRES_TIME = process.env.COOKIE_EXPIRES_TIME || "7";

import express from "express";
import cookieParser from "cookie-parser";
import bodyParser from "body-parser";
import mongoose from "mongoose";
import path from "path";
import fs from "fs";

const UPLOAD_PATH = path.resolve("./public/uploads");
fs.mkdirSync(UPLOAD_PATH, { recursive: true });
process.env.UPLOAD_PATH = UPLOAD_PATH;

import auth from "../routes/auth.js";
import jobsRoute from "../routes/jobs.js";
import errorMiddleware from "../middleware/errors.js";
import Job from "../models/jobs.js";

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use("/api/auth/v1", auth);
app.use("/api/jobs/v1", jobsRoute);
app.use(errorMiddleware);

const results = [];
const ok = (n, c, d) => { results.push(c); console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`); };
const BASE = `http://127.0.0.1:${process.env.PORT}`;
const reg = (b) => fetch(`${BASE}/api/auth/v1/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json());
const me = (t) => fetch(`${BASE}/api/auth/v1/me`, { headers: { Authorization: `Bearer ${t}` } }).then((r) => r.json()).then((j) => j.user._id);
const status = (p, t) => fetch(`${BASE}${p}`, { headers: t ? { Authorization: `Bearer ${t}` } : {} }).then((r) => r.status);

let server;
async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await new Promise((r) => (server = app.listen(process.env.PORT, r)));
  const ts = Date.now();

  const empToken = (await reg({ name: "Emp", email: `e${ts}@t.com`, password: "password123", role: "employer" })).token;
  const userToken = (await reg({ name: "Seeker", email: `u${ts}@t.com`, password: "password123", role: "user" })).token;
  const otherToken = (await reg({ name: "Nosy", email: `o${ts}@t.com`, password: "password123", role: "user" })).token;
  const empId = await me(empToken);
  const userId = await me(userToken);

  const resumeName = `acl_${ts}.pdf`;
  fs.writeFileSync(path.join(UPLOAD_PATH, resumeName), "%PDF test");

  const [job] = await Job.insertMany([{
    title: "ACL Job", description: "d", address: "X", company: "Co",
    industry: ["Others"], jobType: "Permanent", minEducation: "Bachelors",
    experience: "No Experience", salary: 60000, user: new mongoose.Types.ObjectId(empId),
    applicantsApplied: [{ id: userId, resume: resumeName, status: "pending" }],
  }]);

  const p = `/api/jobs/v1/job/${job._id}/applicant/${userId}/resume`;

  ok("owner (employer) can view resume -> 200", (await status(p, empToken)) === 200);
  ok("applicant (self) can view own resume -> 200", (await status(p, userToken)) === 200);
  ok("unrelated user blocked -> 403", (await status(p, otherToken)) === 403);
  ok("unauthenticated blocked -> 401", (await status(p)) === 401);
  ok("missing applicant -> 404", (await status(`/api/jobs/v1/job/${job._id}/applicant/${new mongoose.Types.ObjectId()}/resume`, empToken)) === 404);

  fs.rmSync(path.join(UPLOAD_PATH, resumeName), { force: true });
}

main()
  .catch((e) => console.error("ERROR:", e))
  .finally(async () => {
    await mongoose.connection.dropDatabase().catch(() => {});
    await mongoose.connection.close().catch(() => {});
    if (server) server.close();
    console.log(`\n==== RESUME ACL SUMMARY: ${results.filter(Boolean).length}/${results.length} passed ====`);
    process.exit(0);
  });
