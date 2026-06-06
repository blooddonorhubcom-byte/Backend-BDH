import { Router } from "express";
import { verifyJwt } from "../middlewares/auth.middleware.js";
import { upload } from "../middlewares/multer.middleware.js";
import { profileSetUp, getProfile, changeNumber, updateProfile, updateAccountInfo, medicalInfo, getMedicalInfo, getPublicUserProfile, getDonors, savePushToken } from "../controllers/user.controller.js";

const userRouter = Router();

// All routes require JWT
userRouter.use(verifyJwt);

// Profile
userRouter.route("/createProfile").post(upload.single("avatar"), profileSetUp);
userRouter.route("/profile").get(getProfile);
userRouter.route("/profile").put(upload.single("avatar"), updateProfile);
userRouter.route("/changeNumber").put(changeNumber);
userRouter.route("/account-info").put(updateAccountInfo);

// Medical Info
userRouter.route("/medicalInfo").post(medicalInfo);
userRouter.route("/medicalInfo").get(getMedicalInfo);

userRouter.route("/public/:userId").get(getPublicUserProfile);

// Donors
userRouter.route("/donors").get(getDonors);

// Push token — must be registered so backend can send notifications to this device
userRouter.route("/push-token").patch(savePushToken);

export default userRouter;