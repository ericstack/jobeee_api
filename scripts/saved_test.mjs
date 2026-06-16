// Verifies Wave B: saved jobs (save/unsave/list, idempotent). Run: node scripts/saved_test.mjs
import dotenv from "dotenv";
dotenv.config({ path: ".env" });
process.env.NODE_ENV = "development";
process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/jobeee_saved_test";
process.env.PORT = "5088";
process.env.JWT_SECRET = process.env.JWT_SECRET || "saved_secret";
process.env.JWT_EXPIRES_TIME = process.env.JWT_EXPIRES_TIME || "7d";
process.env.COOKIE_EXPIRES_TIME = process.env.COOKIE_EXPIRES_TIME || "7";

import express from "express";
import cookieParser from "cookie-parser";
import bodyParser from "body-parser";
import mongoose from "mongoose";

import auth from "../routes/auth.js";
import user from "../routes/user.js";
import errorMiddleware from "../middleware/errors.js";
import Job from "../models/jobs.js";

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use("/api/auth/v1", auth);
app.use("/api/user/v1", user);
app.use(errorMiddleware);

const results = [];
const ok = (n, c, d) => { results.push(c); console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`); };
const BASE = `http://127.0.0.1:${process.env.PORT}`;
const J = (m, p, token) =>
  fetch(`${BASE}${p}`, { method: m, headers: token ? { Authorization: `Bearer ${token}` } : {} })
    .then(async (r) => ({ s: r.status, j: await r.json().catch(() => null) }));

let server;
async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await new Promise((r) => (server = app.listen(process.env.PORT, r)));
  const ts = Date.now();

  const reg = await fetch(`${BASE}/api/auth/v1/register`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Saver", email: `s${ts}@t.com`, password: "password123", role: "user" }),
  }).then((r) => r.json());
  const token = reg.token;

  const [job] = await Job.insertMany([{
    title: "Saved Test Job", description: "d", address: "X", company: "Co",
    industry: ["Others"], jobType: "Permanent", minEducation: "Bachelors",
    experience: "No Experience", salary: 50000, user: new mongoose.Types.ObjectId(),
  }]);
  const jobId = job._id.toString();

  const save1 = await J("PUT", `/api/user/v1/jobs/saved/${jobId}`, token);
  ok("save job -> 200", save1.s === 200, `status ${save1.s}`);

  const list1 = await J("GET", "/api/user/v1/jobs/saved", token);
  ok("saved list has the job", list1.s === 200 && list1.j.results === 1 && list1.j.jobs[0]._id === jobId);

  const save2 = await J("PUT", `/api/user/v1/jobs/saved/${jobId}`, token);
  const list2 = await J("GET", "/api/user/v1/jobs/saved", token);
  ok("saving twice is idempotent (still 1)", save2.s === 200 && list2.j.results === 1);

  const unsave = await J("DELETE", `/api/user/v1/jobs/saved/${jobId}`, token);
  const list3 = await J("GET", "/api/user/v1/jobs/saved", token);
  ok("unsave removes it (0)", unsave.s === 200 && list3.j.results === 0);

  const missing = await J("PUT", `/api/user/v1/jobs/saved/${new mongoose.Types.ObjectId()}`, token);
  ok("saving a non-existent job -> 404", missing.s === 404, `status ${missing.s}`);

  const noauth = await J("GET", "/api/user/v1/jobs/saved");
  ok("saved list requires auth -> 401", noauth.s === 401, `status ${noauth.s}`);
}

main()
  .catch((e) => console.error("ERROR:", e))
  .finally(async () => {
    await mongoose.connection.dropDatabase().catch(() => {});
    await mongoose.connection.close().catch(() => {});
    if (server) server.close();
    console.log(`\n==== SAVED SUMMARY: ${results.filter(Boolean).length}/${results.length} passed ====`);
    process.exit(0);
  });
