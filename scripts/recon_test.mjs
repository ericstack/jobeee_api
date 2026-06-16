// Verifies the application endpoints return the shapes the frontend expects.
// Isolated demo DB. Run: node scripts/recon_test.mjs
import dotenv from "dotenv";
dotenv.config({ path: ".env" });
process.env.NODE_ENV = "development";
process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/jobeee_recon_test";
process.env.PORT = "5095";
process.env.JWT_SECRET = process.env.JWT_SECRET || "recon_secret";
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

const results = [];
const ok = (n, cond, detail) => {
  results.push(cond);
  console.log(`${cond ? "PASS" : "FAIL"}  ${n}${detail ? "  — " + detail : ""}`);
};

const BASE = `http://127.0.0.1:${process.env.PORT}`;
const J = (m, p, { token, body } = {}) =>
  fetch(`${BASE}${p}`, {
    method: m,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => ({ s: r.status, j: await r.json().catch(() => null) }));

let server;
async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await new Promise((r) => (server = app.listen(process.env.PORT, r)));
  const ts = Date.now();

  const empToken = (await J("POST", "/api/auth/v1/register", { body: { name: "Acme HR", email: `emp${ts}@t.com`, password: "password123", role: "employer" } })).j.token;
  const userToken = (await J("POST", "/api/auth/v1/register", { body: { name: "Jane Seeker", email: `jane${ts}@t.com`, password: "password123", role: "user" } })).j.token;
  const applicantId = (await J("GET", "/api/auth/v1/me", { token: userToken })).j.user._id;
  const jobId = (await J("POST", "/api/jobs/v1/job/new", { token: empToken, body: { title: "Frontend Dev", description: "d", address: "Austin, TX", company: "Acme", industry: ["Information Technology"], jobType: "Permanent", minEducation: "Bachelors", experience: "No Experience", salary: 90000 } })).j.data._id;

  // apply with a cover letter + resume
  const fd = new FormData();
  fd.append("coverLetter", "I am a great fit because I love building UIs.");
  fd.append("file", new Blob([Buffer.from("%PDF resume")], { type: "application/pdf" }), "cv.pdf");
  await fetch(`${BASE}/api/jobs/v1/job/${jobId}/apply`, { method: "PUT", headers: { Authorization: `Bearer ${userToken}` }, body: fd });

  const compositeId = `${jobId}__${applicantId}`;

  // 1) applicant: my applications shape
  const mine = await J("GET", "/api/jobs/v1/me/applications", { token: userToken });
  const a0 = mine.j?.applications?.[0];
  ok("getMyApplications returns applications[]", mine.s === 200 && mine.j?.results === 1 && !!a0, `status ${mine.s}`);
  ok("  application _id is composite", a0?._id === compositeId, a0?._id);
  ok("  status defaults to pending", a0?.status === "pending");
  ok("  coverLetter persisted", a0?.coverLetter?.includes("great fit"));
  ok("  resume is an authenticated API path", typeof a0?.resume === "string" && a0.resume.includes("/resume"), a0?.resume);
  ok("  nested job brief present", a0?.job?.title === "Frontend Dev" && !!a0?.job?._id);

  // 2) employer: applicants list shape (with applicant user details)
  const emp = await J("GET", "/api/jobs/v1/employer/applicants", { token: empToken });
  const e0 = emp.j?.applications?.[0];
  ok("getEmployerApplicants returns applicants[]", emp.s === 200 && emp.j?.results === 1, `status ${emp.s}`);
  ok("  applicant user name/email joined", e0?.user?.name === "Jane Seeker" && !!e0?.user?.email);
  ok("  same composite _id", e0?._id === compositeId);

  // 3) single application detail
  const det = await J("GET", `/api/jobs/v1/job/${jobId}/applicant/${applicantId}`, { token: empToken });
  ok("getApplication detail", det.s === 200 && det.j?.application?.user?.name === "Jane Seeker", `status ${det.s}`);

  // 4) full status pipeline pending -> shortlisted -> interview -> hired
  for (const st of ["shortlisted", "interview", "hired"]) {
    const r = await J("PUT", `/api/jobs/v1/job/${jobId}/applicant/${applicantId}/status`, { token: empToken, body: { status: st } });
    ok(`update status -> ${st}`, r.s === 200 && r.j?.data?.status === st, `status ${r.s}`);
  }

  // 5) applicant sees final status
  const after = await J("GET", "/api/jobs/v1/me/applications", { token: userToken });
  ok("applicant sees status = hired", after.j?.applications?.[0]?.status === "hired");

  // 6) invalid status rejected (old enum value no longer allowed)
  const bad = await J("PUT", `/api/jobs/v1/job/${jobId}/applicant/${applicantId}/status`, { token: empToken, body: { status: "accepted" } });
  ok("old enum 'accepted' rejected -> 400", bad.s === 400, `status ${bad.s}`);

  // 7) applicant cannot list employer applicants -> 403
  const forbidden = await J("GET", "/api/jobs/v1/employer/applicants", { token: userToken });
  ok("applicant blocked from employer applicants -> 403", forbidden.s === 403, `status ${forbidden.s}`);
}

main()
  .catch((e) => console.error("ERROR:", e))
  .finally(async () => {
    fs.rmSync(path.join(UPLOAD_PATH, "Jane_Seeker_*"), { force: true });
    try { fs.readdirSync(UPLOAD_PATH).filter((f) => f.startsWith("Jane_Seeker_")).forEach((f) => fs.rmSync(path.join(UPLOAD_PATH, f), { force: true })); } catch {}
    await mongoose.connection.dropDatabase().catch(() => {});
    await mongoose.connection.close().catch(() => {});
    if (server) server.close();
    const passed = results.filter(Boolean).length;
    console.log(`\n==== RECON SUMMARY: ${passed}/${results.length} passed ====`);
    process.exit(0);
  });
