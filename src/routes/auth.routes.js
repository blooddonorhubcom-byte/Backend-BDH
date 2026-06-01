import { Router } from 'express';
import { verifyJwt } from "../middlewares/auth.middleware.js";
import { updatePassword, forgotPassword, login, logout, resendOtp, signup, verifyEmail } from '../controllers/auth.controller.js';

const authRouter = Router();

authRouter.route("/signup").post(signup);
authRouter.route("/login").post(login);
authRouter.route("/verify-email").post(verifyJwt, verifyEmail);
authRouter.route("/resend-otp").post(resendOtp);
authRouter.route("/forgot-password").post(forgotPassword);
authRouter.route("/update-password").post(updatePassword);
authRouter.route("/logout").post(verifyJwt, logout);

export default authRouter;