// Verifies pagination (#24): page/limit + total. Inserts 25 jobs directly.
// Run: node scripts/pagination_test.mjs
import dotenv from "dotenv";
dotenv.config({ path: ".env" });
process.env.NODE_ENV = "development";
process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/jobeee_page_test";
process.env.PORT = "5090";

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

let server;
async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await new Promise((r) => (server = app.listen(process.env.PORT, r)));

  const uid = new mongoose.Types.ObjectId();
  const docs = Array.from({ length: 25 }, (_, i) => ({
    title: `Job ${String(i + 1).padStart(2, "0")}`,
    description: "d", address: "X", company: "Co", industry: ["Others"],
    jobType: "Permanent", minEducation: "Bachelors", experience: "No Experience",
    salary: 1000 + i, user: uid,
  }));
  await Job.insertMany(docs);

  const p1 = await q("page=1&limit=10");
  ok("page 1 returns 10 of 25", p1.s === 200 && p1.j.jobs.length === 10 && p1.j.total === 25, `len ${p1.j?.jobs?.length}, total ${p1.j?.total}`);

  const p3 = await q("page=3&limit=10");
  ok("page 3 returns the last 5", p3.j.jobs.length === 5, `len ${p3.j?.jobs?.length}`);

  // pages must not overlap
  const ids1 = new Set(p1.j.jobs.map((j) => j._id));
  const p2 = await q("page=2&limit=10");
  const overlap = p2.j.jobs.some((j) => ids1.has(j._id));
  ok("pages 1 and 2 do not overlap", !overlap);

  // sort persists across pagination (salary desc): page1[0] highest, page1 last >= page2[0]
  const s1 = await q("page=1&limit=10&sort=-salary");
  const s2 = await q("page=2&limit=10&sort=-salary");
  const lastOfP1 = s1.j.jobs[9].salary;
  const firstOfP2 = s2.j.jobs[0].salary;
  ok("sort=-salary persists across pages", s1.j.jobs[0].salary === 1024 && lastOfP1 >= firstOfP2, `${lastOfP1} >= ${firstOfP2}`);
}

main()
  .catch((e) => console.error("ERROR:", e))
  .finally(async () => {
    await mongoose.connection.dropDatabase().catch(() => {});
    await mongoose.connection.close().catch(() => {});
    if (server) server.close();
    console.log(`\n==== PAGINATION SUMMARY: ${results.filter(Boolean).length}/${results.length} passed ====`);
    process.exit(0);
  });
