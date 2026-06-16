// Verifies job-search filters against the live `jobeee` DB via the running server.
// Run: node scripts/filter_test.mjs   (needs API up on :3000)
const BASE = "http://localhost:3000/api/jobs/v1/jobs";
const results = [];
const ok = (n, c, d) => { results.push(c); console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`); };

const q = async (qs) => {
  const r = await fetch(`${BASE}?${qs}`);
  const j = await r.json().catch(() => null);
  return { s: r.status, j };
};

const all = await q("limit=100");
ok("baseline list", all.s === 200 && Array.isArray(all.j?.jobs), `total=${all.j?.total}, returned=${all.j?.results}`);

const byType = await q("jobType=Permanent&limit=100");
ok("filter by type=Permanent", byType.s === 200 && byType.j.jobs.every((j) => j.jobType === "Permanent"), `${byType.j?.total} match`);

const byTypeNone = await q("jobType=Internship&limit=100");
ok("filter by type=Internship", byTypeNone.s === 200 && byTypeNone.j.jobs.every((j) => j.jobType === "Internship"), `${byTypeNone.j?.total} match`);

const byLoc = await q("location=Makati&limit=100");
ok("filter by location=Makati (partial, case-insensitive)", byLoc.s === 200 && byLoc.j.jobs.every((j) => /makati/i.test(j.address || "")), `${byLoc.j?.total} match`);

const byCompany = await q("company=jobeee&limit=100");
ok("filter by company=jobeee (partial)", byCompany.s === 200 && byCompany.j.jobs.every((j) => /jobeee/i.test(j.company || "")), `${byCompany.j?.total} match`);

const bySalary = await q("salaryMin=80000&salaryMax=100000&limit=100");
ok("filter by salary range 80k–100k", bySalary.s === 200 && bySalary.j.jobs.every((j) => j.salary >= 80000 && j.salary <= 100000), `${bySalary.j?.total} match`);

const byKeyword = await q("keyword=developer&limit=100");
ok("filter by keyword=developer", byKeyword.s === 200 && byKeyword.j.jobs.every((j) => /developer/i.test(`${j.title} ${j.company} ${j.description}`)), `${byKeyword.j?.total} match`);

const combo = await q("jobType=Permanent&location=Makati&salaryMin=50000&limit=100");
ok("combined filters", combo.s === 200 && combo.j.jobs.every((j) => j.jobType === "Permanent" && /makati/i.test(j.address || "") && j.salary >= 50000), `${combo.j?.total} match`);

const passed = results.filter(Boolean).length;
console.log(`\n==== FILTER SUMMARY: ${passed}/${results.length} passed ====`);
process.exit(0);
