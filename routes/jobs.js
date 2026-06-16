import express from "express";
const router = express.Router();
import {
  getJobs,
  newJob,
  getJobsInRadius,
  updateJob,
  deleteJob,
  getJob,
  jobStats,
  applyJob,
  updateApplicantStatus,
  getMyApplications,
  getEmployerApplicants,
  getApplication,
  getApplicantResume,
} from "../controller/jobsController.js";

import { isAuthenticatedUser, authorizeRoles } from "../middleware/auth.js";

router.route("/jobs").get(getJobs);
router.route("/job/:id").get(getJob);
router.route("/jobs/:zipcode/:distance").get(getJobsInRadius);
router.route("/stats/:topic").get(jobStats);
router
  .route("/job/new")
  .post(isAuthenticatedUser, authorizeRoles("employer", "admin"), newJob);
router
  .route("/job/:id")
  .put(isAuthenticatedUser, authorizeRoles("employer", "admin"), updateJob)
  .delete(isAuthenticatedUser, authorizeRoles("employer", "admin"), deleteJob);
router
  .route("/job/:id/apply")
  .put(isAuthenticatedUser, authorizeRoles("employer", "user"), applyJob);
router
  .route("/job/:id/applicant/:applicantId/status")
  .put(
    isAuthenticatedUser,
    authorizeRoles("employer", "admin"),
    updateApplicantStatus,
  );

// Application listings / detail (frontend "applications" resource)
router
  .route("/me/applications")
  .get(isAuthenticatedUser, authorizeRoles("user"), getMyApplications);
router
  .route("/employer/applicants")
  .get(isAuthenticatedUser, authorizeRoles("employer", "admin"), getEmployerApplicants);
router
  .route("/job/:id/applicant/:applicantId")
  .get(isAuthenticatedUser, authorizeRoles("employer", "admin"), getApplication);
// resume access is owner/admin/self — role gating handled inside the controller
router
  .route("/job/:id/applicant/:applicantId/resume")
  .get(isAuthenticatedUser, getApplicantResume);

export default router;
