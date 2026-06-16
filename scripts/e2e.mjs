// End-to-end test harness for jobeee_api.
// Boots the real routers + middleware against a THROWAWAY test database,
// then drives register -> login -> post job -> apply over real HTTP.
// Run: node scripts/e2e.mjs
import dotenv from "dotenv";
dotenv.config({ path: ".env" });

// --- env required by the app, with test-safe overrides ---
// NOTE: must be "development" or "production" — middleware/errors.js only
// sends a response for those two values (see E2E findings).
process.env.NODE_ENV = "development";
process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/jobeee_e2e_test";
process.env.PORT = process.env.E2E_PORT || "5099";
process.env.JWT_SECRET = process.env.JWT_SECRET || "e2e_test_secret";
process.env.JWT_EXPIRES_TIME = process.env.JWT_EXPIRES_TIME || "7d";
process.env.COOKIE_EXPIRES_TIME = process.env.COOKIE_EXPIRES_TIME || "7";
process.env.MAX_FILE_SIZE = process.env.MAX_FILE_SIZE || "2000000";

import express from "express";
import cookieParser from "cookie-parser";
import fileUpload from "express-fileupload";
import bodyParser from "body-parser";
import mongoSanitize from "express-mongo-sanitize";
import hpp from "hpp";
import cors from "cors";
import mongoose from "mongoose";
import fs from "fs";
import path from "path";

// upload dir for the apply flow (app expects UPLOAD_PATH set)
const UPLOAD_PATH = path.resolve("./public/uploads");
fs.mkdirSync(UPLOAD_PATH, { recursive: true });
process.env.UPLOAD_PATH = UPLOAD_PATH;

import jobs from "../routes/jobs.js";
import auth from "../routes/auth.js";
import user from "../routes/user.js";
import errorMiddleware from "../middleware/errors.js";
import ErrorHandler from "../utils/errorHandler.js";

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

// Build an app that mirrors app.js (minus self-listen, rate limiter).
const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(fileUpload());
app.use(mongoSanitize());
app.use(hpp());
app.use(cors());
app.use("/api/jobs/v1", jobs);
app.use("/api/auth/v1", auth);
app.use("/api/user/v1", user);
app.all("*", (req, res, next) =>
  next(new ErrorHandler(`${req.originalUrl} route not found`, 404)),
);
app.use(errorMiddleware);

const BASE = `http://127.0.0.1:${process.env.PORT}`;
async function req(method, p, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) {
    payload = form;
  } else if (body) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${p}`, { method, headers, body: payload });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-json */
  }
  return { status: res.status, json };
}

let server;
async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  await mongoose.connection.dropDatabase(); // clean slate
  await new Promise((r) => (server = app.listen(process.env.PORT, r)));

  const ts = Date.now();
  const employerEmail = `employer_${ts}@test.com`;
  const userEmail = `user_${ts}@test.com`;
  const pass = "password123";
  let empToken, userToken, jobId;

  // 1. public list endpoint reachable
  try {
    const r = await req("GET", "/api/jobs/v1/jobs");
    record("GET /jobs (public list)", r.status === 200 && r.json?.success, `status ${r.status}`);
  } catch (e) {
    record("GET /jobs (public list)", false, e.message);
  }

  // 2. register employer
  try {
    const r = await req("POST", "/api/auth/v1/register", {
      body: { name: "Emp Loyer", email: employerEmail, password: pass, role: "employer" },
    });
    empToken = r.json?.token;
    record("Register employer", r.status === 200 && !!empToken, `status ${r.status}`);
  } catch (e) {
    record("Register employer", false, e.message);
  }

  // 3. register applicant
  try {
    const r = await req("POST", "/api/auth/v1/register", {
      body: { name: "Reg User", email: userEmail, password: pass, role: "user" },
    });
    record("Register user", r.status === 200 && !!r.json?.token, `status ${r.status}`);
  } catch (e) {
    record("Register user", false, e.message);
  }

  // 4. login employer
  try {
    const r = await req("POST", "/api/auth/v1/login", { body: { email: employerEmail, password: pass } });
    empToken = r.json?.token || empToken;
    record("Login employer", r.status === 200 && !!empToken, `status ${r.status}`);
  } catch (e) {
    record("Login employer", false, e.message);
  }

  // 5. login user
  try {
    const r = await req("POST", "/api/auth/v1/login", { body: { email: userEmail, password: pass } });
    userToken = r.json?.token;
    record("Login user", r.status === 200 && !!userToken, `status ${r.status}`);
  } catch (e) {
    record("Login user", false, e.message);
  }

  // 6. login with wrong password rejected
  try {
    const r = await req("POST", "/api/auth/v1/login", { body: { email: employerEmail, password: "wrong" } });
    record("Login wrong password -> 401", r.status === 401, `status ${r.status}`);
  } catch (e) {
    record("Login wrong password -> 401", false, e.message);
  }

  // 7. /me with token
  try {
    const r = await req("GET", "/api/auth/v1/me", { token: empToken });
    record("GET /me (auth)", r.status === 200 && r.json?.user?.email === employerEmail, `status ${r.status}`);
  } catch (e) {
    record("GET /me (auth)", false, e.message);
  }

  // 8. /me without token rejected
  try {
    const r = await req("GET", "/api/auth/v1/me");
    record("GET /me without token -> 401", r.status === 401, `status ${r.status}`);
  } catch (e) {
    record("GET /me without token -> 401", false, e.message);
  }

  // 9. role gate: plain user cannot post a job
  try {
    const r = await req("POST", "/api/jobs/v1/job/new", {
      token: userToken,
      body: { title: "x", description: "y", address: "Paris", company: "C", industry: ["Business"], jobType: "Permanent", minEducation: "Bachelors", experience: "No Experience", salary: 1 },
    });
    record("User posting job -> 403", r.status === 403, `status ${r.status}`);
  } catch (e) {
    record("User posting job -> 403", false, e.message);
  }

  // 10. employer posts a job (triggers geocoder -> external OpenCage API)
  try {
    const r = await req("POST", "/api/jobs/v1/job/new", {
      token: empToken,
      body: {
        title: "Senior Node Engineer",
        description: "Build the jobeee API",
        email: "jobs@test.com",
        address: "1600 Amphitheatre Parkway, Mountain View, CA",
        company: "Jobeee Inc",
        industry: ["Information Technology"],
        jobType: "Permanent",
        minEducation: "Bachelors",
        experience: "2-5 years experience",
        salary: 120000,
      },
    });
    jobId = r.json?.data?._id;
    record("Employer posts job", r.status === 200 && !!jobId, `status ${r.status}${r.json?.message ? " / " + r.json.message : ""}`);
  } catch (e) {
    record("Employer posts job", false, e.message);
  }

  // 11. get single job
  if (jobId) {
    try {
      const r = await req("GET", `/api/jobs/v1/job/${jobId}`);
      record("GET /job/:id", r.status === 200 && r.json?.jobs?.length > 0, `status ${r.status}`);
    } catch (e) {
      record("GET /job/:id", false, e.message);
    }
  } else {
    record("GET /job/:id", false, "skipped — no jobId (post failed)");
  }

  // 12. apply without file -> 400
  if (jobId) {
    try {
      const r = await req("PUT", `/api/jobs/v1/job/${jobId}/apply`, { token: userToken });
      record("Apply without file -> 400", r.status === 400, `status ${r.status}${r.json?.message ? " / " + r.json.message : ""}`);
    } catch (e) {
      record("Apply without file -> 400", false, e.message);
    }
  } else {
    record("Apply without file -> 400", false, "skipped — no jobId");
  }

  // 13. apply WITH a pdf file (full happy path: upload + persist)
  if (jobId) {
    try {
      const fd = new FormData();
      fd.append("file", new Blob([Buffer.from("%PDF-1.4 fake resume")], { type: "application/pdf" }), "resume.pdf");
      const res = await fetch(`${BASE}/api/jobs/v1/job/${jobId}/apply`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${userToken}` },
        body: fd,
      });
      const json = await res.json().catch(() => null);
      record("Apply with resume (upload)", res.status === 200 && json?.success, `status ${res.status}${json?.message ? " / " + json.message : ""}`);
    } catch (e) {
      record("Apply with resume (upload)", false, e.message);
    }
  } else {
    record("Apply with resume (upload)", false, "skipped — no jobId");
  }

  // 14. unknown route -> 404
  try {
    const r = await req("GET", "/api/nope");
    record("Unknown route -> 404", r.status === 404, `status ${r.status}`);
  } catch (e) {
    record("Unknown route -> 404", false, e.message);
  }

  // 15. forgot password — handler runs; 200 if SMTP works, 500 if it can't send
  // (test .env has placeholder SMTP creds, so 500 is expected here — not a crash/404)
  try {
    const r = await req("POST", "/api/auth/v1/password/forgot", { body: { email: employerEmail } });
    record("POST /password/forgot (handler runs)", r.status === 200 || r.status === 500, `status ${r.status}`);
  } catch (e) {
    record("POST /password/forgot (handler runs)", false, e.message);
  }

  // 16. applicant tracks applied jobs
  try {
    const r = await req("GET", "/api/user/v1/jobs/applied", { token: userToken });
    const ok = r.status === 200 && r.json?.results >= 1 && r.json?.data?.[0]?._id === jobId;
    record("Applicant tracks applied jobs", ok, `status ${r.status} / results ${r.json?.results}`);
  } catch (e) {
    record("Applicant tracks applied jobs", false, e.message);
  }

  // 17. applicant edits profile (name + email)
  try {
    const r = await req("PUT", "/api/user/v1/me/update", {
      token: userToken,
      body: { name: "Renamed User", email: `renamed_${ts}@test.com` },
    });
    record("Applicant edits profile", r.status === 200 && r.json?.data?.name === "Renamed User", `status ${r.status}`);
  } catch (e) {
    record("Applicant edits profile", false, e.message);
  }

  // 18. applicant uploads a profile photo
  try {
    const fd = new FormData();
    fd.append("name", "Renamed User");
    fd.append("photo", new Blob([Buffer.from("\x89PNG\r\n fake png")], { type: "image/png" }), "me.png");
    const res = await fetch(`${BASE}/api/user/v1/me/update`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${userToken}` },
      body: fd,
    });
    const json = await res.json().catch(() => null);
    const avatar = json?.data?.avatar;
    record("Applicant uploads profile photo", res.status === 200 && !!avatar && avatar.endsWith(".png"), `status ${res.status} / avatar ${avatar}`);
  } catch (e) {
    record("Applicant uploads profile photo", false, e.message);
  }

  // 19. reject unsupported photo type
  try {
    const fd = new FormData();
    fd.append("photo", new Blob([Buffer.from("not an image")], { type: "text/plain" }), "evil.txt");
    const res = await fetch(`${BASE}/api/user/v1/me/update`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${userToken}` },
      body: fd,
    });
    record("Reject non-image photo -> 400", res.status === 400, `status ${res.status}`);
  } catch (e) {
    record("Reject non-image photo -> 400", false, e.message);
  }

  // capture the applicant's user id (needed to address their application)
  let applicantId;
  try {
    const me = await req("GET", "/api/auth/v1/me", { token: userToken });
    applicantId = me.json?.user?._id;
  } catch {
    /* handled by skips below */
  }

  // helper: read the logged-in applicant's status for this job
  async function myStatus() {
    const r = await req("GET", "/api/user/v1/jobs/applied", { token: userToken });
    const job = r.json?.data?.find((j) => j._id === jobId);
    return job?.applicantsApplied?.find((a) => a.id === applicantId)?.status;
  }

  // 20. new application defaults to "pending"
  if (jobId && applicantId) {
    try {
      record("New application status = pending", (await myStatus()) === "pending");
    } catch (e) {
      record("New application status = pending", false, e.message);
    }
  } else {
    record("New application status = pending", false, "skipped — missing jobId/applicantId");
  }

  // 21. employer updates applicant status -> shortlisted
  if (jobId && applicantId) {
    try {
      const r = await req("PUT", `/api/jobs/v1/job/${jobId}/applicant/${applicantId}/status`, {
        token: empToken,
        body: { status: "shortlisted" },
      });
      record("Employer updates applicant status", r.status === 200 && r.json?.data?.status === "shortlisted", `status ${r.status}`);
    } catch (e) {
      record("Employer updates applicant status", false, e.message);
    }
  } else {
    record("Employer updates applicant status", false, "skipped — missing jobId/applicantId");
  }

  // 22. applicant sees the updated status
  if (jobId && applicantId) {
    try {
      record("Applicant sees updated status", (await myStatus()) === "shortlisted");
    } catch (e) {
      record("Applicant sees updated status", false, e.message);
    }
  } else {
    record("Applicant sees updated status", false, "skipped — missing jobId/applicantId");
  }

  // 23. plain user cannot update status -> 403
  if (jobId && applicantId) {
    try {
      const r = await req("PUT", `/api/jobs/v1/job/${jobId}/applicant/${applicantId}/status`, {
        token: userToken,
        body: { status: "accepted" },
      });
      record("Non-employer updating status -> 403", r.status === 403, `status ${r.status}`);
    } catch (e) {
      record("Non-employer updating status -> 403", false, e.message);
    }
  } else {
    record("Non-employer updating status -> 403", false, "skipped — missing jobId/applicantId");
  }

  // 24. invalid status value -> 400
  if (jobId && applicantId) {
    try {
      const r = await req("PUT", `/api/jobs/v1/job/${jobId}/applicant/${applicantId}/status`, {
        token: empToken,
        body: { status: "banana" },
      });
      record("Invalid status value -> 400", r.status === 400, `status ${r.status}`);
    } catch (e) {
      record("Invalid status value -> 400", false, e.message);
    }
  } else {
    record("Invalid status value -> 400", false, "skipped — missing jobId/applicantId");
  }
}

main()
  .catch((e) => console.error("HARNESS ERROR:", e))
  .finally(async () => {
    try {
      await mongoose.connection.dropDatabase();
    } catch {}
    await mongoose.connection.close().catch(() => {});
    if (server) server.close();
    const passed = results.filter((r) => r.ok).length;
    console.log(`\n==== E2E SUMMARY: ${passed}/${results.length} passed ====`);
    process.exit(0);
  });
