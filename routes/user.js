import express from "express";
const router = express.Router();
import {
  getUserProfile,
  updatePassword,
  updateUser,
  deleteUser,
  getAppliedJobs,
  getPublishedJobs,
  saveJob,
  unsaveJob,
  getSavedJobs,
  getUsers,
  deleteUserAdmin,
} from "../controller/userController.js";
import { isAuthenticatedUser, authorizeRoles } from "../middleware/auth.js";

router.use(isAuthenticatedUser);

router.route("/userProfile").get(getUserProfile);
router.route("/jobs/applied").get(authorizeRoles("user"), getAppliedJobs);
router
  .route("/jobs/published")
  .get(authorizeRoles("employer", "admin"), getPublishedJobs);
router.route("/jobs/saved").get(getSavedJobs);
router.route("/jobs/saved/:jobId").put(saveJob).delete(unsaveJob);
router.route("/password/update").put(updatePassword);
router.route("/me/update").put(updateUser);
router.route("/me/delete").delete(deleteUser);

//admin only route
router.route("/users").get(authorizeRoles("admin"), getUsers);
router.route("/users/:id").delete(authorizeRoles("admin"), deleteUserAdmin);

export default router;
