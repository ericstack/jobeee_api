// Seed demo data (users + jobs) into whatever DB the URI points at.
//
//   Local:  node scripts/seed.mjs
//   Atlas:  $env:NODE_ENV="production"; node scripts/seed.mjs    (uses MONGODB_URI_PRO)
//   Custom: $env:SEED_URI="mongodb+srv://.../jobeee"; node scripts/seed.mjs
//
// Idempotent: re-running won't create duplicates. Job creation calls OpenCage
// (needs OPENCAGE_API_KEY + network) to geocode addresses.
import dotenv from "dotenv";
dotenv.config({ path: ".env" });

import mongoose from "mongoose";
import User from "../models/users.js";
import Job from "../models/jobs.js";

const uri =
  process.env.SEED_URI ||
  (process.env.NODE_ENV === "production"
    ? process.env.MONGODB_URI_PRO
    : process.env.MONGODB_URI);

if (!uri) {
  console.error("No Mongo URI. Set MONGODB_URI / MONGODB_URI_PRO or SEED_URI.");
  process.exit(1);
}

const PASSWORD = "password123"; // demo password for every seeded account

const upsertUser = async ({ name, email, role }) => {
  const existing = await User.findOne({ email });
  if (existing) {
    console.log(`  user exists: ${email}`);
    return existing;
  }
  const u = await User.create({ name, email, role, password: PASSWORD });
  console.log(`  created user: ${email} (${role})`);
  return u;
};

const seedJob = async (employerId, data) => {
  const exists = await Job.findOne({ title: data.title, company: data.company });
  if (exists) {
    console.log(`  job exists: ${data.title}`);
    return;
  }
  await Job.create({ ...data, user: employerId }); // pre-save hooks set slug + geocode
  console.log(`  created job: ${data.title}`);
};

const DEMO_JOBS = [
  { title: "Software Developer", description: "Build and maintain web apps with Node.js and React.", email: "jobs@acme.test", address: "Makati, Metro Manila, Philippines", company: "Acme Corp", industry: ["Information Technology"], jobType: "Permanent", minEducation: "Bachelors", experience: "2-5 years experience", salary: 85000, positions: 2 },
  { title: "Junior Frontend Developer", description: "Internship building UI components with React + Tailwind.", email: "jobs@acme.test", address: "Cebu City, Philippines", company: "Acme Corp", industry: ["Information Technology"], jobType: "Internship", minEducation: "Bachelors", experience: "No Experience", salary: 25000, positions: 1 },
  { title: "Bank Operations Officer", description: "Handle daily branch operations and compliance.", email: "careers@bankco.test", address: "Taguig, Metro Manila, Philippines", company: "BankCo", industry: ["Banking"], jobType: "Permanent", minEducation: "Bachelors", experience: "1-2 years experience", salary: 45000, positions: 3 },
  { title: "Mathematics Teacher", description: "Teach senior high school mathematics.", email: "hr@brightschool.test", address: "Quezon City, Philippines", company: "Bright School", industry: ["Education/Training"], jobType: "Permanent", minEducation: "Bachelors", experience: "2-5 years experience", salary: 35000, positions: 2 },
  { title: "Network Engineer", description: "Design and maintain telco network infrastructure.", email: "jobs@telco.test", address: "Pasig, Metro Manila, Philippines", company: "TelcoOne", industry: ["Telecommunication"], jobType: "Permanent", minEducation: "Bachelors", experience: "5 years experience ", salary: 90000, positions: 1 },
];

async function main() {
  await mongoose.connect(uri);
  console.log(`Connected to DB: "${mongoose.connection.name}"\n`);

  console.log("Users:");
  const employer = await upsertUser({ name: "Acme Recruiter", email: "employer@demo.com", role: "employer" });
  await upsertUser({ name: "Jane Seeker", email: "seeker@demo.com", role: "user" });
  await upsertUser({ name: "Site Admin", email: "admin@demo.com", role: "admin" });

  console.log("\nJobs:");
  for (const job of DEMO_JOBS) {
    try {
      await seedJob(employer._id, job);
    } catch (e) {
      console.log(`  skipped "${job.title}" — ${e.message}`);
    }
  }

  console.log(`\nDone. Demo accounts (password: "${PASSWORD}"):`);
  console.log("  employer@demo.com · seeker@demo.com · admin@demo.com");
}

main()
  .catch((e) => console.error("SEED ERROR:", e))
  .finally(async () => {
    await mongoose.connection.close().catch(() => {});
    process.exit(0);
  });
