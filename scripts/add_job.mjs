// Adds a real "Software Developer" job posting to the live `jobeee` DB,
// owned by the existing employer account. Uses the Job model so the
// slug + geocoding pre-save hooks run. Run: node scripts/add_job.mjs
import dotenv from "dotenv";
dotenv.config({ path: ".env" });
process.env.MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/jobeee";

import mongoose from "mongoose";
import Job from "../models/jobs.js";
import User from "../models/users.js";

await mongoose.connect(process.env.MONGODB_URI);

// post it under an employer (fall back to any admin if no employer exists)
const owner =
  (await User.findOne({ role: "employer" })) ||
  (await User.findOne({ role: "admin" }));

if (!owner) {
  console.log("No employer/admin user found to own the job. Aborting.");
  await mongoose.connection.close();
  process.exit(1);
}

const job = await Job.create({
  title: "Software Developer",
  description:
    "We are looking for a Software Developer to design, build and maintain web applications. " +
    "You'll work across our Node.js/Express backend and React frontend, write clean and tested code, " +
    "and collaborate with the team to ship features used by job seekers and employers.",
  email: "careers@jobeee.com",
  address: "Makati, Metro Manila, Philippines",
  company: "Jobeee Technologies",
  industry: ["Information Technology"],
  jobType: "Permanent",
  minEducation: "Bachelors",
  experience: "2-5 years experience",
  positions: 2,
  salary: 85000,
  user: owner._id,
});

console.log("Job posting created:");
console.log({
  id: job._id.toString(),
  title: job.title,
  company: job.company,
  slug: job.slug,
  postedBy: `${owner.name} <${owner.email}> (${owner.role})`,
  location: job.location?.formattedAddress,
  coordinates: job.location?.coordinates,
  salary: job.salary,
  positions: job.positions,
});

await mongoose.connection.close();
process.exit(0);
