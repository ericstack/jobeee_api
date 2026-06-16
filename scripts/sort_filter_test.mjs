// Verifies industry filter (#21) and sorting (#20) on GET /jobs.
// Inserts jobs directly (bypassing geocoding). Run: node scripts/sort_filter_test.mjs
import dotenv from "dotenv";
dotenv.config({ path: ".env" });
process.env.NODE_ENV = "development";
process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/jobeee_sortfilter_test";
process.env.PORT = "5091";

import express from "express";
import mongoose from "mongoose";
import jobs from "../routes/jobs.js";
import errorMiddleware from "../middleware/errors.js";
import Job from "../models/jobs.js";

const app = express();
app.use(express.json());
app.use("/api/jobs/v1", jobs);
app.use(errorMiddleware);

const results = [];
const ok = (n, c, d) => { results.push(c); console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`); };
const BASE = `http://127.0.0.1:${process.env.PORT}`;
const q = (qs) => fetch(`${BASE}/api/jobs/v1/jobs?${qs}`).then(async (r) => ({ s: r.status, j: await r.json().catch(() => null) }));

const base = {
  description: "d", address: "Somewhere", jobType: "Permanent",
  minEducation: "Bachelors", experience: "No Experience",
  user: new mongoose.Types.ObjectId(),
};

let server;
async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await new Promise((r) => (server = app.listen(process.env.PORT, r)));

  // insertMany bypasses the geocoding pre('save') hook
  await Job.insertMany([
    { ...base, title: "IT Job A", company: "Acme", industry: ["Information Technology"], salary: 50000, postingDate: new Date("2024-01-01") },
    { ...base, title: "IT Job B", company: "Acme", industry: ["Information Technology"], salary: 150000, postingDate: new Date("2025-01-01") },
    { ...base, title: "Bank Job", company: "BankCo", industry: ["Banking"], salary: 90000, postingDate: new Date("2026-01-01") },
  ]);

  // #21 industry filter
  const banking = await q("industry=Banking&limit=100");
  ok("industry=Banking returns only banking jobs", banking.s === 200 && banking.j.jobs.length === 1 && banking.j.jobs[0].title === "Bank Job", `total ${banking.j?.total}`);
  const it = await q("industry=Information Technology&limit=100");
  ok("industry=IT returns the 2 IT jobs", it.j.total === 2 && it.j.jobs.every((j) => j.industry.includes("Information Technology")));

  // #20 sorting
  const salDesc = await q("sort=-salary&limit=100");
  const desc = salDesc.j.jobs.map((j) => j.salary);
  ok("sort=-salary is descending", desc.every((v, i) => i === 0 || desc[i - 1] >= v), desc.join(","));
  const salAsc = await q("sort=salary&limit=100");
  const asc = salAsc.j.jobs.map((j) => j.salary);
  ok("sort=salary is ascending", asc.every((v, i) => i === 0 || asc[i - 1] <= v), asc.join(","));
  const def = await q("limit=100");
  const dates = def.j.jobs.map((j) => new Date(j.postingDate).getTime());
  ok("default sort is newest postingDate first", dates.every((v, i) => i === 0 || dates[i - 1] >= v), def.j.jobs.map((j) => j.title).join(" | "));

  // combined: industry + sort
  const combo = await q("industry=Information Technology&sort=-salary&limit=100");
  ok("industry + sort combine", combo.j.jobs.length === 2 && combo.j.jobs[0].salary === 150000, combo.j.jobs.map((j) => j.salary).join(","));
}

main()
  .catch((e) => console.error("ERROR:", e))
  .finally(async () => {
    await mongoose.connection.dropDatabase().catch(() => {});
    await mongoose.connection.close().catch(() => {});
    if (server) server.close();
    console.log(`\n==== SORT/FILTER SUMMARY: ${results.filter(Boolean).length}/${results.length} passed ====`);
    process.exit(0);
  });
