// Focused test: a USER applies to a job, using concrete test data.
// Isolated demo DB so real `jobeee` data is untouched. Verbose output.
// Run: node scripts/apply_test.mjs
import dotenv from "dotenv";
dotenv.config({ path: ".env" });

process.env.NODE_ENV = "development";
process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/jobeee_apply_demo";
process.env.PORT = "5096";
process.env.JWT_SECRET = process.env.JWT_SECRET || "apply_demo_secret";
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

import jobs from "../routes/jobs.js";
import auth from "../routes/auth.js";
import user from "../routes/user.js";
import errorMiddleware from "../middleware/errors.js";

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(fileUpload());
app.use("/api/jobs/v1", jobs);
app.use("/api/auth/v1", auth);
app.use("/api/user/v1", user);
app.use(errorMiddleware);

const BASE = `http://127.0.0.1:${process.env.PORT}`;
function api(method, p, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers["Content-Type"] = "application/json";
  return fetch(`${BASE}${p}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
}

// ---- TEST DATA ----
const EMPLOYER = { name: "Acme Recruiter", email: "recruiter@acme-test.com", password: "password123", role: "employer" };
const APPLICANT = { name: "Jane Applicant", email: "jane.applicant@test.com", password: "password123", role: "user" };
const JOB = {
  title: "Backend Developer (Node.js)",
  description: "Build and maintain REST APIs for the Jobeee platform.",
  email: "jobs@acme-test.com",
  address: "San Francisco, CA",
  company: "Acme Corp",
  industry: ["Information Technology"],
  jobType: "Permanent",
  minEducation: "Bachelors",
  experience: "2-5 years experience",
  salary: 110000,
};
const RESUME_TEXT = "%PDF-1.4\nJane Applicant — CV — 5 yrs Node.js, Express, MongoDB.";

let server;
async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await new Promise((r) => (server = app.listen(process.env.PORT, r)));

  console.log("=== Apply-to-Job test (test data) ===\n");

  // 1) employer registers + a job is posted
  const emp = await api("POST", "/api/auth/v1/register", { body: EMPLOYER });
  const empToken = emp.json.token;
  console.log(`1. Employer registered: ${EMPLOYER.email}`);

  const posted = await api("POST", "/api/jobs/v1/job/new", { token: empToken, body: JOB });
  const jobId = posted.json?.data?._id;
  console.log(`2. Job posted: "${JOB.title}" @ ${JOB.company} (id ${jobId}) -> HTTP ${posted.status}`);

  // 2) applicant registers + logs in
  await api("POST", "/api/auth/v1/register", { body: APPLICANT });
  const login = await api("POST", "/api/auth/v1/login", { body: { email: APPLICANT.email, password: APPLICANT.password } });
  const userToken = login.json.token;
  const me = await api("GET", "/api/auth/v1/me", { token: userToken });
  const applicantId = me.json.user._id;
  console.log(`3. Applicant registered + logged in: ${APPLICANT.email} (id ${applicantId})\n`);

  // 3) THE APPLY ACTION — multipart upload of a resume
  const fd = new FormData();
  fd.append("file", new Blob([Buffer.from(RESUME_TEXT)], { type: "application/pdf" }), "jane_cv.pdf");
  const applyRes = await fetch(`${BASE}/api/jobs/v1/job/${jobId}/apply`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${userToken}` },
    body: fd,
  });
  const applyJson = await applyRes.json().catch(() => null);
  console.log("4. APPLY  -> HTTP", applyRes.status, "|", applyJson?.message, "| resume:", applyJson?.data);

  // 4) duplicate apply should be blocked
  const fd2 = new FormData();
  fd2.append("file", new Blob([Buffer.from(RESUME_TEXT)], { type: "application/pdf" }), "jane_cv.pdf");
  const dupRes = await fetch(`${BASE}/api/jobs/v1/job/${jobId}/apply`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${userToken}` },
    body: fd2,
  });
  const dupJson = await dupRes.json().catch(() => null);
  console.log("5. APPLY AGAIN (dup) -> HTTP", dupRes.status, "|", dupJson?.message);

  // 5) applicant tracks the application
  const applied = await api("GET", "/api/user/v1/jobs/applied", { token: userToken });
  console.log("\n6. Applicant's tracked applications:", applied.json?.results);

  // 6) show the stored application record straight from Mongo (incl. status)
  const Job = (await import("../models/jobs.js")).default;
  const dbJob = await Job.findById(jobId).select("+applicantsApplied").lean();
  console.log("\n7. Stored application record in DB:");
  console.log(JSON.stringify(dbJob.applicantsApplied, null, 2));

  // 7) confirm the resume file landed on disk
  const resumeFile = applyJson?.data;
  const onDisk = resumeFile ? fs.existsSync(path.join(UPLOAD_PATH, resumeFile)) : false;
  console.log(`\n8. Resume file written to disk: ${onDisk ? "YES" : "NO"} (${resumeFile})`);

  // cleanup uploaded resume + demo db
  if (resumeFile) fs.rmSync(path.join(UPLOAD_PATH, resumeFile), { force: true });
}

main()
  .catch((e) => console.error("ERROR:", e))
  .finally(async () => {
    await mongoose.connection.dropDatabase().catch(() => {});
    await mongoose.connection.close().catch(() => {});
    if (server) server.close();
    console.log("\n=== done (demo DB dropped) ===");
    process.exit(0);
  });
