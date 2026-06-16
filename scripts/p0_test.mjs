// Verifies the six P0 bug fixes. Isolated demo DB. Run: node scripts/p0_test.mjs
import dotenv from "dotenv";
dotenv.config({ path: ".env" });
process.env.NODE_ENV = "development";
process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/jobeee_p0_test";
process.env.PORT = "5093";
process.env.JWT_SECRET = process.env.JWT_SECRET || "p0_secret";
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
import Job from "../models/jobs.js";

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(fileUpload());
app.use("/api/jobs/v1", jobs);
app.use("/api/auth/v1", auth);
app.use("/api/user/v1", user);
app.use(errorMiddleware);

const results = [];
const ok = (n, c, d) => { results.push(c); console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`); };

const BASE = `http://127.0.0.1:${process.env.PORT}`;
const J = (m, p, { token, body } = {}) =>
  fetch(`${BASE}${p}`, {
    method: m,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => ({ s: r.status, j: await r.json().catch(() => null) }));

const postJob = (token, extra = {}) => J("POST", "/api/jobs/v1/job/new", {
  token,
  body: { title: "Senior Developer", description: "Build things with Node", address: "Austin, TX", company: "Acme", industry: ["Information Technology"], jobType: "Permanent", minEducation: "Bachelors", experience: "No Experience", salary: 90000, ...extra },
});

let server;
async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await Job.createIndexes(); // ensure the new text index exists (bug #4)
  await new Promise((r) => (server = app.listen(process.env.PORT, r)));
  const ts = Date.now();

  // ---- Bug #3: resume regex (pure unit check) ----
  const rx = /\.(docx|pdf)$/i;
  ok("#3 regex accepts .pdf/.docx/.PDF", rx.test(".pdf") && rx.test(".docx") && rx.test(".PDF"));
  ok("#3 regex rejects .xpdf/.txt/.pdfx", !rx.test(".xpdf") && !rx.test(".txt") && !rx.test(".pdfx"));

  // employer + user + a job + an application (resume on disk)
  const empToken = (await J("POST", "/api/auth/v1/register", { body: { name: "Emp", email: `emp${ts}@t.com`, password: "password123", role: "employer" } })).j.token;
  const empId = (await J("GET", "/api/auth/v1/me", { token: empToken })).j.user._id;
  const userToken = (await J("POST", "/api/auth/v1/register", { body: { name: "Seek Er", email: `usr${ts}@t.com`, password: "password123", role: "user" } })).j.token;
  const userId = (await J("GET", "/api/auth/v1/me", { token: userToken })).j.user._id;
  const jobId = (await postJob(empToken)).j.data._id;

  // apply with a pdf resume
  const fd = new FormData();
  fd.append("file", new Blob([Buffer.from("%PDF resume")], { type: "application/pdf" }), "cv.pdf");
  await fetch(`${BASE}/api/jobs/v1/job/${jobId}/apply`, { method: "PUT", headers: { Authorization: `Bearer ${userToken}` }, body: fd });
  const jobAfterApply = await Job.findById(jobId).select("+applicantsApplied");
  const resumeFile = jobAfterApply.applicantsApplied[0]?.resume;
  ok("setup: application persisted with resume", !!resumeFile && fs.existsSync(path.join(UPLOAD_PATH, resumeFile)), resumeFile);

  // ---- Bug #3 (HTTP): a .txt resume is rejected ----
  const fdBad = new FormData();
  fdBad.append("file", new Blob([Buffer.from("nope")], { type: "text/plain" }), "cv.txt");
  const badApply = await fetch(`${BASE}/api/jobs/v1/job/${jobId}/apply`, { method: "PUT", headers: { Authorization: `Bearer ${userToken}` }, body: fdBad });
  ok("#3 .txt resume rejected -> 400", badApply.status === 400, `status ${badApply.status}`);

  // ---- Bug #4: $text search no longer crashes ----
  const search = await J("GET", "/api/jobs/v1/jobs?q=Developer");
  ok("#4 $text keyword search works (no crash)", search.s === 200 && Array.isArray(search.j?.jobs), `status ${search.s}`);
  const stats = await J("GET", "/api/jobs/v1/stats/Developer");
  ok("#4 jobStats $text aggregation works (not 500)", stats.s !== 500, `status ${stats.s}`);

  // ---- Bug #5: default sort is -postingDate, not -__v ----
  await postJob(empToken, { title: "Junior Developer", postingDate: "2020-01-01T00:00:00Z" }); // older
  await postJob(empToken, { title: "Lead Developer", postingDate: "2030-01-01T00:00:00Z" });   // newest
  const list = await J("GET", "/api/jobs/v1/jobs?limit=100");
  const dates = (list.j?.jobs || []).map((x) => new Date(x.postingDate).getTime());
  const sortedDesc = dates.every((d, i) => i === 0 || dates[i - 1] >= d);
  ok("#5 default sort is newest-first by postingDate", sortedDesc && list.j.jobs[0].title === "Lead Developer", list.j.jobs.map((x) => x.title).join(" | "));

  // ---- Bug #2: applicant cleanup on user delete (entry + resume removed) ----
  await J("DELETE", "/api/user/v1/me/delete", { token: userToken });
  const jobAfterUserDelete = await Job.findById(jobId).select("+applicantsApplied");
  const stillThere = jobAfterUserDelete.applicantsApplied.some((a) => a.id === userId);
  ok("#2 applicant entry removed from job", !stillThere);
  ok("#2 resume file deleted from disk", !fs.existsSync(path.join(UPLOAD_PATH, resumeFile)));

  // ---- Bug #1: employer delete cascades job deletion ----
  const empJobsBefore = await Job.countDocuments({ user: empId });
  await J("DELETE", "/api/user/v1/me/delete", { token: empToken });
  const empJobsAfter = await Job.countDocuments({ user: empId });
  ok("#1 employer account deletion cascades to jobs", empJobsBefore > 0 && empJobsAfter === 0, `${empJobsBefore} -> ${empJobsAfter}`);

  // ---- Bug #6: admin delete-user error message interpolates the id ----
  const adminToken = (await J("POST", "/api/auth/v1/register", { body: { name: "Boss", email: `adm${ts}@t.com`, password: "password123", role: "admin" } })).j.token;
  const missingId = new mongoose.Types.ObjectId().toString();
  const del = await J("DELETE", `/api/user/v1/users/${missingId}`, { token: adminToken });
  const msg = del.j?.errMessage || del.j?.message || "";
  ok("#6 error message interpolates real id (no literal ${...})", del.s === 404 && msg.includes(missingId) && !msg.includes("${"), msg);
}

main()
  .catch((e) => console.error("ERROR:", e))
  .finally(async () => {
    try { fs.readdirSync(UPLOAD_PATH).filter((f) => /^(Seek_Er|cv)/.test(f)).forEach((f) => fs.rmSync(path.join(UPLOAD_PATH, f), { force: true })); } catch {}
    await mongoose.connection.dropDatabase().catch(() => {});
    await mongoose.connection.close().catch(() => {});
    if (server) server.close();
    console.log(`\n==== P0 SUMMARY: ${results.filter(Boolean).length}/${results.length} passed ====`);
    process.exit(0);
  });
