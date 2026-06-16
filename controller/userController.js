import User from "../models/users.js";
import catchAsyncErrors from "../middleware/catchAsyncErrors.js";
import ErrorHandler from "../utils/errorHandler.js";
import sendToken from "../utils/jwtToken.js";
import fs from "fs";
import path from "path";
import Job from "../models/jobs.js";
import jobs from "../models/jobs.js";
import APIFilter from "../utils/apiFilters.js";

//Get current user profile => /api/v1/me
export const getUserProfile = catchAsyncErrors(async (req, res, next) => {
  const user = await User.findById(req.user.id).populate({
    path: "jobPublished",
    select: "title postingDate",
  });

  res.status(200).json({
    success: true,
    data: user,
  });
});

//update current user data => /api/v1/me/update
export const updateUser = catchAsyncErrors(async (req, res, next) => {
  // only update fields the client actually sent
  const newUserData = {};
  ["name", "email", "phone", "headline"].forEach((f) => {
    if (req.body[f] !== undefined) newUserData[f] = req.body[f];
  });
  if (req.body.skills !== undefined) {
    newUserData.skills = Array.isArray(req.body.skills)
      ? req.body.skills
      : String(req.body.skills)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
  }

  //handle profile photo upload (optional)
  if (req.files && req.files.photo) {
    const photo = req.files.photo;

    //check file type
    const supportedFiles = /\.(jpg|jpeg|png)$/i;
    if (!supportedFiles.test(path.extname(photo.name))) {
      return next(
        new ErrorHandler("Please upload an image file (jpg, jpeg, png).", 400),
      );
    }

    //check file size
    if (photo.size > process.env.MAX_FILE_SIZE) {
      return next(new ErrorHandler("Please upload an image less than 2MB.", 400));
    }

    //unique filename per upload so the URL changes — avoids stale browser cache
    photo.name = `avatar_${req.user.id}_${Date.now()}${path.parse(photo.name).ext}`;
    const uploadPath = process.env.UPLOAD_PATH || "./public/uploads";
    fs.mkdirSync(uploadPath, { recursive: true }); // ensure target dir exists
    try {
      await photo.mv(path.join(uploadPath, photo.name));
    } catch (err) {
      console.log(err);
      return next(new ErrorHandler("Profile photo upload failed.", 500));
    }

    //best-effort cleanup of the previous avatar file
    const current = await User.findById(req.user.id).select("avatar");
    if (current?.avatar && current.avatar !== photo.name) {
      fs.unlink(path.join(uploadPath, current.avatar), () => {});
    }

    newUserData.avatar = photo.name;
  }

  const user = await User.findByIdAndUpdate(req.user.id, newUserData, {
    new: true,
    runValidators: true,
    useFindAndModify: false,
  });

  res.status(200).json({
    success: true,
    data: user,
  });
});

// update current user password => /api/v1/password/update
export const updatePassword = catchAsyncErrors(async (req, res, next) => {
  const user = await User.findById(req.user.id).select("+password");

  //Check previous user password
  const isMatched = await user.comparePassword(req.body.currentPassword);

  if (!isMatched) {
    return next(new ErrorHandler("Old Password is incorrect", 401));
  }

  user.password = req.body.newPassword;
  await user.save();

  sendToken(user, 200, res);
});

// Show all applied jobs => /api/v1/jobs/applied
export const getAppliedJobs = catchAsyncErrors(async (req, res, next) => {
  const jobs = await Job.find({ "applicantsApplied.id": req.user.id }).select(
    "+applicantsApplied",
  );
  res.status(200).json({
    success: true,
    results: jobs.length,
    data: jobs,
  });
});
// Show all jobs published by employer => /api/v1/jobs/published
export const getPublishedJobs = catchAsyncErrors(async (req, res, next) => {
  const jobs = await Job.find({ user: req.user.id });

  res.status(200).json({
    success: true,
    results: jobs.length,
    data: jobs,
  });
});

// Save (bookmark) a job => PUT /api/user/v1/jobs/saved/:jobId
export const saveJob = catchAsyncErrors(async (req, res, next) => {
  const job = await Job.findById(req.params.jobId);
  if (!job) {
    return next(new ErrorHandler("Job not found", 404));
  }
  // $addToSet keeps it idempotent (no duplicates)
  await User.findByIdAndUpdate(req.user.id, {
    $addToSet: { savedJobs: req.params.jobId },
  });
  res.status(200).json({ success: true, message: "Job saved" });
});

// Remove a saved job => DELETE /api/user/v1/jobs/saved/:jobId
export const unsaveJob = catchAsyncErrors(async (req, res, next) => {
  await User.findByIdAndUpdate(req.user.id, {
    $pull: { savedJobs: req.params.jobId },
  });
  res.status(200).json({ success: true, message: "Job removed from saved" });
});

// List saved jobs => GET /api/user/v1/jobs/saved
export const getSavedJobs = catchAsyncErrors(async (req, res, next) => {
  const user = await User.findById(req.user.id).populate("savedJobs");
  const jobs = (user.savedJobs || []).filter(Boolean); // drop refs to deleted jobs
  res.status(200).json({ success: true, results: jobs.length, jobs });
});

// delete current user => /api/v1/me/delete
export const deleteUser = catchAsyncErrors(async (req, res, next) => {
  //console.log(req.user)
  await deleteUserData(req.user.id, req.user.role);

  const user = await User.findByIdAndDelete(req.user.id);

  const isProd = process.env.NODE_ENV === "production";
  res.cookie("token", "none", {
    expires: new Date(Date.now()),
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
  });

  res.status(200).json({
    success: true,
    message: "Your account has been deleted.",
  });
});

//Adding controller methods for admins

//show all user => /api/v1/users
export const getUsers = catchAsyncErrors(async (req, res, next) => {
  const apiFilters = new APIFilter(User.find(), req.query)
    .filter()
    .sort()
    .limitFields()
    .pagination();

  const users = await apiFilters.query;

  res.status(200).json({
    success: true,
    results: users.length,
    data: users,
  });
});
//Delete User(admin) => /api/v1/user/:id
export const deleteUserAdmin = catchAsyncErrors(async (req, res, next) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    return next(
      new ErrorHandler(`User not found with id: ${req.params.id}`, 404),
    );
  }

  await deleteUserData(user.id, user.role);
  await user.deleteOne();

  res.status(200).json({
    success: true,
    message: "User is deleted by Admin",
  });
});

// delete current userdata
async function deleteUserData(user, role) {
  if (role === "employer") {
    await Job.deleteMany({ user: user });
  }

  if (role === "user") {
    const appliedJobs = await Job.find({ "applicantsApplied.id": user }).select(
      "+applicantsApplied",
    );

    const uploadPath = process.env.UPLOAD_PATH || "./public/uploads";

    for (let i = 0; i < appliedJobs.length; i++) {
      const obj = appliedJobs[i].applicantsApplied.find((o) => o.id === user);
      if (!obj) continue;

      if (obj.resume) {
        const filepath = path.join(uploadPath, obj.resume);
        fs.unlink(filepath, (err) => {
          if (err) return console.log(err);
        });
      }

      const index = appliedJobs[i].applicantsApplied.indexOf(obj);
      if (index !== -1) {
        appliedJobs[i].applicantsApplied.splice(index, 1);
      }

      await appliedJobs[i].save();
    }
  }
}
