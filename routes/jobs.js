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
export default router;
