// Verifies Wave C admin endpoints: list users, role-gating, delete (cascade),
// and admin sees all applicants. Run: node scripts/admin_test.mjs
import dotenv from "dotenv";
dotenv.config({ path: ".env" });
process.env.NODE_ENV = "development";
process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/jobeee_admin_test";
process.env.PORT = "5087";
process.env.JWT_SECRET = process.env.JWT_SECRET || "admin_secret";
process.env.JWT_EXPIRES_TIME = process.env.JWT_EXPIRES_TIME || "7d";
process.env.COOKIE_EXPIRES_TIME = process.env.COOKIE_EXPIRES_TIME || "7";

import express from "express";
import cookieParser from "cookie-parser";
import bodyParser from "body-parser";
import mongoose from "mongoose";

import auth from "../routes/auth.js";
import user from "../routes/user.js";
import jobsRoute from "../routes/jobs.js";
import errorMiddleware from "../middleware/errors.js";
import Job from "../models/jobs.js";

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use("/api/auth/v1", auth);
app.use("/api/user/v1", user);
app.use("/api/jobs/v1", jobsRoute);
app.use(errorMiddleware);

const results = [];
const ok = (n, c, d) => { results.push(c); console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`); };
const BASE = `http://127.0.0.1:${process.env.PORT}`;
const reg = (body) => fetch(`${BASE}/api/auth/v1/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
const J = (m, p, token) => fetch(`${BASE}${p}`, { method: m, headers: token ? { Authorization: `Bearer ${token}` } : {} }).then(async (r) => ({ s: r.status, j: await r.json().catch(() => null) }));
const me = (token) => J("GET", "/api/auth/v1/me", token).then((r) => r.j.user._id);

let server;
async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await new Promise((r) => (server = app.listen(process.env.PORT, r)));
  const ts = Date.now();

  const adminToken = (await reg({ name: "Boss", email: `a${ts}@t.com`, password: "password123", role: "admin" })).token;
  const empToken = (await reg({ name: "Emp", email: `e${ts}@t.com`, password: "password123", role: "employer" })).token;
  const userToken = (await reg({ name: "Seeker", email: `u${ts}@t.com`, password: "password123", role: "user" })).token;
  const empId = await me(empToken);
  const userId = await me(userToken);

  // a job owned by the employer, with the user as a hired applicant
  await Job.insertMany([{
    title: "Admin Test Job", description: "d", address: "X", company: "Co",
    industry: ["Others"], jobType: "Permanent", minEducation: "Bachelors",
    experience: "No Experience", salary: 70000, user: new mongoose.Types.ObjectId(empId),
    applicantsApplied: [{ id: userId, resume: "r.pdf", status: "hired" }],
  }]);

  const list = await J("GET", "/api/user/v1/users?limit=1000", adminToken);
  ok("admin lists all users (3)", list.s === 200 && list.j.results === 3, `results ${list.j?.results}`);

  const forbidden = await J("GET", "/api/user/v1/users", userToken);
  ok("non-admin blocked from /users -> 403", forbidden.s === 403, `status ${forbidden.s}`);

  const applicants = await J("GET", "/api/jobs/v1/employer/applicants", adminToken);
  ok("admin sees all applicants across jobs", applicants.s === 200 && applicants.j.results >= 1 && applicants.j.applications[0].user.name === "Seeker", `results ${applicants.j?.results}`);

  // delete the employer -> cascade their jobs
  const jobsBefore = await Job.countDocuments({ user: empId });
  const del = await J("DELETE", `/api/user/v1/users/${empId}`, adminToken);
  const jobsAfter = await Job.countDocuments({ user: empId });
  ok("admin deletes employer", del.s === 200);
  ok("deleting employer cascades their jobs", jobsBefore === 1 && jobsAfter === 0, `${jobsBefore} -> ${jobsAfter}`);

  const list2 = await J("GET", "/api/user/v1/users?limit=1000", adminToken);
  ok("user count drops to 2 after delete", list2.j.results === 2, `results ${list2.j?.results}`);

  const missing = await J("DELETE", `/api/user/v1/users/${new mongoose.Types.ObjectId()}`, adminToken);
  ok("delete missing user -> 404", missing.s === 404, `status ${missing.s}`);
}

main()
  .catch((e) => console.error("ERROR:", e))
  .finally(async () => {
    await mongoose.connection.dropDatabase().catch(() => {});
    await mongoose.connection.close().catch(() => {});
    if (server) server.close();
    console.log(`\n==== ADMIN SUMMARY: ${results.filter(Boolean).length}/${results.length} passed ====`);
    process.exit(0);
  });
