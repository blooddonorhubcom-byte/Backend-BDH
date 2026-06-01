import { Router } from "express";
import { verifyJwt, checkAdmin } from "../middlewares/auth.middleware.js";
import {
    getAllUsers,
    createUser,
    toggleSuspendUser,
    toggleBlockUser,
    deleteUser,
    updateUserByAdmin,
    getAllDonationRequests,
    updateDonationRequest,
    deleteDonationRequest,
    getAllDonors,
    getStats,
    // createBloodRequest,
} from "../controllers/admin.controller.js";

const adminRouter = Router();

// All admin routes require JWT + admin role
adminRouter.use(verifyJwt, checkAdmin);

// Stats
adminRouter.route("/stats").get(getStats);

// Users
adminRouter.route("/users").get(getAllUsers).post(createUser);
adminRouter.route("/donors").get(getAllDonors);
adminRouter.route("/requests").get(getAllDonationRequests);
adminRouter.route("/requests/:id").patch(updateDonationRequest).delete(deleteDonationRequest);
adminRouter.route("/users/:id").delete(deleteUser).patch(updateUserByAdmin);
adminRouter.route("/users/:id/suspend").patch(toggleSuspendUser);
adminRouter.route("/user/:id/block").patch(toggleBlockUser);
// adminRouter.route("/blood-request").post(createBloodRequest);

export default adminRouter;
