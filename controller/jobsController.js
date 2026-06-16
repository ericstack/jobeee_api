import Job from "../models/jobs.js";
import User from "../models/users.js";
import geoCoder from "../utils/geocoder.js";
import ErrorHandler from "../utils/errorHandler.js";
import catchAsyncErrors from "../middleware/catchAsyncErrors.js";
import APIFilters from "../utils/apiFilters.js";
import sendEmail from "../utils/sendEmail.js";
import path from "path";
import fs from "fs";

// Fire-and-forget email — never blocks or fails the request if SMTP is down.
const notify = (email, subject, message) => {
  if (!email) return;
  sendEmail({ email, subject, message }).catch((e) =>
    console.log("Notification email failed:", e.message),
  );
};

// Separator used to build a composite application id (jobId + applicantId).
// ObjectIds are hex only, so "__" is unambiguous.
const APP_ID_SEP = "__";

// Trimmed job fields the frontend needs in an application object.
const jobBrief = (job) => ({
  _id: job._id,
  title: job.title,
  company: job.company,
  address: job.address,
  salary: job.salary,
  jobType: job.jobType,
});

// Map a job + one of its applicant sub-docs into the application shape the UI expects.
// resume is an AUTHENTICATED API path (relative to /api) — not a public /uploads URL —
// so the frontend fetches it with the user's token (see getApplicantResume).
const toApplication = (req, job, applicant, applicantUser) => ({
  _id: `${job._id}${APP_ID_SEP}${applicant.id}`,
  status: applicant.status || "pending",
  createdAt: applicant.appliedAt,
  coverLetter: applicant.coverLetter || "",
  resume: applicant.resume
    ? `jobs/v1/job/${job._id}/applicant/${applicant.id}/resume`
    : "",
  user: applicantUser
    ? {
        _id: applicantUser._id,
        name: applicantUser.name,
        email: applicantUser.email,
        avatar: applicantUser.avatar,
      }
    : { _id: applicant.id, name: "Unknown applicant" },
  job: jobBrief(job),
});

//get all jobs /api/v1/jobs
export const getJobs = catchAsyncErrors(async (req, res, next) => {
  //total matching the filters (before pagination) for accurate UI counts
  const countFilters = new APIFilters(Job.find(), req.query)
    .filter()
    .searchFilters();
  const total = await Job.countDocuments(countFilters.query.getFilter());

  const apiFilters = new APIFilters(Job.find(), req.query)
    .filter()
    .searchFilters()
    .sort()
    .limitFields()
    .searchByQuery()
    .pagination();

  const jobs = await apiFilters.query;

  res.status(200).json({
    success: true,
    results: jobs.length,
    total,
    jobs: jobs,
  });
});

// create new Job / api/v1/job/new
export const newJob = catchAsyncErrors(async (req, res, next) => {
  //add user to body
  req.body.user = req.user.id;
  const job = await Job.create(req.body);

  res.status(200).json({
    success: true,
    message: "job created",
    data: job,
  });
});

// update a Job /api/v1/job/:id
export const updateJob = catchAsyncErrors(async (req, res, next) => {
  let job = await Job.findById(req.params.id);
  if (!job) {
    return next(new ErrorHandler("Job not found", 404));
  }

  //check if the user is owner
  if (job.user.toString() !== req.user.id && req.user.role !== "admin") {
    return next(
      new ErrorHandler(
        `User (${req.user.id}) is not allowed to update this job`,
      ),
    );
  }

  job = await Job.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
    useFindAndModify: false,
  });

  res.status(200).json({
    success: true,
    message: "Job is updated",
    data: job,
  });
});

//delete job /api/v1/job/:id
export const deleteJob = catchAsyncErrors(async (req, res, next) => {
  let job = await Job.findById(req.params.id).select("+applicantsApplied");

  if (!job) {
    return next(new ErrorHandler("Job not found", 404));
  }

  //check if the user is owner
  if (job.user.toString() !== req.user.id && req.user.role !== "admin") {
    return next(
      new ErrorHandler(
        `User (${req.user.id}) is not allowed to delete this job`,
      ),
    );
  }

  const uploadPath = process.env.UPLOAD_PATH || "./public/uploads";
  for (let i = 0; i < job.applicantsApplied.length; i++) {
    const resume = job.applicantsApplied[i].resume;
    if (!resume) continue;
    fs.unlink(path.join(uploadPath, resume), (err) => {
      if (err) return console.log(err);
    });
  }

  job = await Job.findByIdAndDelete(req.params.id);

  res.status(200).json({
    success: true,
    message: "Job is deleted",
    data: job,
  });
});

//single job /api/v1/job/:id
export const getJob = catchAsyncErrors(async (req, res, next) => {
  const job = await Job.find({
    $and: [{ _id: req.params.id }],
  }).populate({
    path: "user",
    select: "name",
  });

  if (!job || job.length === 0) {
    return next(new ErrorHandler("Job not found", 404));
  }

  res.status(200).json({
    success: true,
    message: "Job is found",
    jobs: job,
  });
});

//Search jobs within raduis => /api/v1/jobs/:zipcode/:distance
export const getJobsInRadius = catchAsyncErrors(async (req, res, next) => {
  const { zipcode, distance } = req.params;

  const loc = await geoCoder(zipcode);

  const latitude = loc.geometry.lat;
  const longitude = loc.geometry.lng;

  const radius = distance / 3963;
  const jobs = await Job.find({
    location: {
      $geoWithin: { $centerSphere: [[longitude, latitude], radius] },
    },
  });

  res.status(200).json({
    success: true,
    results: jobs.length,
    data: jobs,
  });
});

// get stats about a topic(job)
export const jobStats = catchAsyncErrors(async (req, res, next) => {
  const stats = await Job.aggregate([
    {
      $match: { $text: { $search: '"' + req.params.topic + '"' } },
    },
    {
      $group: {
        _id: { $toUpper: "$experience" },
        totalJobs: { $sum: 1 },
        avgPosition: { $avg: "$positions" },
        avgSalary: { $avg: "$salary" },
        minSalary: { $min: "$salary" },
        maxSalary: { $max: "$salary" },
      },
    },
  ]);
  if (stats.length === 0) {
    return next(new ErrorHandler("No stat found", 404));
  }

  res.status(200).json({
    success: true,
    data: stats,
  });
});
//apply to job using resume => /api/v1/job/:id/apply
export const applyJob = catchAsyncErrors(async (req, res, next) => {
  let job = await Job.findById(req.params.id).select("+applicantsApplied");

  if (!job) {
    return next(new ErrorHandler("job not found", 404));
  }

  //Check that if job last date has been passed or not
  if (job.lastDate < new Date(Date.now())) {
    return next(
      new ErrorHandler("You can not apply to this job. Date is over", 400),
    );
  }

  //check if user has applied before
  for (let i = 0; i < job.applicantsApplied.length; i++) {
    if (job.applicantsApplied[i].id === req.user.id) {
      return next(
        new ErrorHandler("You have already applied to this job", 400),
      );
    }
  }

  //Check the files
  if (!req.files) {
    return next(new ErrorHandler("Please upload file.", 400));
  }

  const file = req.files.file;

  //check file type
  const supportedFiles = /\.(docx|pdf)$/i;
  if (!supportedFiles.test(path.extname(file.name))) {
    return next(new ErrorHandler("Please upload document file.", 400));
  }

  //check doc size
  if (file.size > process.env.MAX_FILE_SIZE) {
    return next(new ErrorHandler("Please upload file less than 2MB.", 400));
  }

  //renaming resume
  file.name = `${req.user.name.replace(" ", "_")}_${job._id}${
    path.parse(file.name).ext
  }`;
  file.mv(`${process.env.UPLOAD_PATH}/${file.name}`, async (err) => {
    if (err) {
      console.log(err);
      return next(new ErrorHandler("Resume upload failed.", 500));
    }
    // atomic guard: only push if this user is not already in applicantsApplied
    const updated = await Job.findOneAndUpdate(
      { _id: req.params.id, "applicantsApplied.id": { $ne: req.user.id } },
      {
        $push: {
          applicantsApplied: {
            id: req.user.id,
            resume: file.name,
            coverLetter: req.body.coverLetter || "",
          },
        },
      },
      { new: true, runValidators: true, useFindAndModify: false },
    );

    if (!updated) {
      return next(
        new ErrorHandler("You have already applied to this job", 400),
      );
    }

    // notify the employer (non-blocking)
    const employer = await User.findById(job.user).select("email");
    notify(
      employer?.email,
      "New application received",
      `${req.user.name} has applied to your job "${job.title}".`,
    );

    res.status(200).json({
      success: true,
      message: "Applied to Job successfully",
      data: file.name,
    });
  });
});

// Update an applicant's status (employer/admin) => /api/v1/job/:id/applicant/:applicantId/status
export const updateApplicantStatus = catchAsyncErrors(async (req, res, next) => {
  const { status } = req.body;
  const allowed = ["pending", "shortlisted", "interview", "hired", "rejected"];

  if (!allowed.includes(status)) {
    return next(
      new ErrorHandler(
        `Invalid status. Allowed values: ${allowed.join(", ")}`,
        400,
      ),
    );
  }

  const job = await Job.findById(req.params.id).select("+applicantsApplied");
  if (!job) {
    return next(new ErrorHandler("Job not found", 404));
  }

  //only the job owner or an admin can change applicant status
  if (job.user.toString() !== req.user.id && req.user.role !== "admin") {
    return next(
      new ErrorHandler(
        `User (${req.user.id}) is not allowed to update applicants for this job`,
        403,
      ),
    );
  }

  const applicant = job.applicantsApplied.find(
    (a) => a.id === req.params.applicantId,
  );
  if (!applicant) {
    return next(
      new ErrorHandler("This applicant has not applied to this job", 404),
    );
  }

  //update via positional operator to avoid re-running pre-save geocoding hooks
  await Job.updateOne(
    { _id: req.params.id, "applicantsApplied.id": req.params.applicantId },
    {
      $set: {
        "applicantsApplied.$.status": status,
        "applicantsApplied.$.statusUpdatedAt": new Date(),
      },
    },
  );

  // notify the applicant of the status change (non-blocking)
  const applicantUser = await User.findById(req.params.applicantId).select("email");
  notify(
    applicantUser?.email,
    "Your application status was updated",
    `Your application for "${job.title}" is now: ${status}.`,
  );

  res.status(200).json({
    success: true,
    message: "Applicant status updated",
    data: { applicant: req.params.applicantId, status },
  });
});

// Current user's own applications => /api/v1/me/applications  (role: user)
export const getMyApplications = catchAsyncErrors(async (req, res, next) => {
  const jobs = await Job.find({ "applicantsApplied.id": req.user.id }).select(
    "+applicantsApplied",
  );

  const applications = jobs.map((job) => {
    const mine =
      job.applicantsApplied.find((a) => a.id === req.user.id) || {};
    return toApplication(req, job, mine, null);
  });

  res.status(200).json({
    success: true,
    results: applications.length,
    applications,
  });
});

// All applicants across the employer's jobs => /api/v1/employer/applicants
export const getEmployerApplicants = catchAsyncErrors(async (req, res, next) => {
  const filter = req.user.role === "admin" ? {} : { user: req.user.id };
  const jobs = await Job.find(filter).select("+applicantsApplied");

  const flat = [];
  for (const job of jobs) {
    for (const applicant of job.applicantsApplied) {
      flat.push({ job, applicant });
    }
  }

  //resolve applicant user details in a single query
  const userIds = [...new Set(flat.map((x) => x.applicant.id))];
  const users = await User.find({ _id: { $in: userIds } }).select(
    "name email avatar",
  );
  const usersById = {};
  users.forEach((u) => (usersById[u._id.toString()] = u));

  const applications = flat.map(({ job, applicant }) =>
    toApplication(req, job, applicant, usersById[applicant.id]),
  );

  res.status(200).json({
    success: true,
    results: applications.length,
    applications,
  });
});

// Single application detail => /api/v1/job/:id/applicant/:applicantId
export const getApplication = catchAsyncErrors(async (req, res, next) => {
  const job = await Job.findById(req.params.id).select("+applicantsApplied");
  if (!job) {
    return next(new ErrorHandler("Job not found", 404));
  }

  //only the job owner or an admin can view applicant details
  if (job.user.toString() !== req.user.id && req.user.role !== "admin") {
    return next(
      new ErrorHandler("You are not allowed to view this applicant", 403),
    );
  }

  const applicant = job.applicantsApplied.find(
    (a) => a.id === req.params.applicantId,
  );
  if (!applicant) {
    return next(
      new ErrorHandler("This applicant has not applied to this job", 404),
    );
  }

  const applicantUser = await User.findById(req.params.applicantId).select(
    "name email avatar",
  );

  res.status(200).json({
    success: true,
    application: toApplication(req, job, applicant, applicantUser),
  });
});

// Stream an applicant's resume (auth-only) => /api/v1/job/:id/applicant/:applicantId/resume
// Allowed: the job owner, an admin, or the applicant themselves.
export const getApplicantResume = catchAsyncErrors(async (req, res, next) => {
  const job = await Job.findById(req.params.id).select("+applicantsApplied");
  if (!job) {
    return next(new ErrorHandler("Job not found", 404));
  }

  const isOwner = job.user.toString() === req.user.id;
  const isAdmin = req.user.role === "admin";
  const isSelf = req.user.id === req.params.applicantId;
  if (!isOwner && !isAdmin && !isSelf) {
    return next(
      new ErrorHandler("You are not allowed to access this resume", 403),
    );
  }

  const applicant = job.applicantsApplied.find(
    (a) => a.id === req.params.applicantId,
  );
  if (!applicant || !applicant.resume) {
    return next(new ErrorHandler("Resume not found", 404));
  }

  const uploadPath = process.env.UPLOAD_PATH || "./public/uploads";
  const filePath = path.resolve(uploadPath, applicant.resume);

  // guard against path traversal — the resolved path must stay inside uploadPath
  if (!filePath.startsWith(path.resolve(uploadPath))) {
    return next(new ErrorHandler("Invalid resume path", 400));
  }
  if (!fs.existsSync(filePath)) {
    return next(new ErrorHandler("Resume file is missing", 404));
  }

  res.sendFile(filePath);
});
