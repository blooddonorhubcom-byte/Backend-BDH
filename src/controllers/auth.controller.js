import { User } from "../models/user.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { StatusCodes } from "http-status-codes";
import { v4 as uuidv4 } from 'uuid';
import { sendEmailOTP } from '../utils/sendEmail.js';
import { asyncHandler } from "../utils/asyncHandler.js";
import { responseMessages } from "../constants/responseMessages.js";

const {
    MISSING_FIELDS,
    USER_EXISTS,
    UN_AUTHORIZED,
    SUCCESS_REGISTRATION,
    NO_USER,
    NO_USER_FOUND,
    SUCCESS_LOGIN,
    INVALID_OTP,
    OTP_EXPIRED,
    EMAIL_VERIFY,
    SUCCESS_LOGOUT,
    MISSING_FIELD_EMAIL_PASSWORD,
    UNAUTHORIZED_REQUEST,
    RESET_LINK_SUCCESS,
    PASSWORD_CHANGE,
    NOT_VERIFY,
    MISSING_FIELD_EMAIL,
    RESET_OTP_SECCESS,
    INVALID_TOKEN,
    INVALID_DATA,
    EMAIL_ERROR,
} = responseMessages;


const generateAccessToken = async (userId) => {
    try {
        const user = await User.findById(userId);
        const accessToken = user.generateAccessToken();
        await user.save({ validateBeforeSave: false });
        return { accessToken };
    } catch (error) {
        throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, error.message);
    }
};


// @desc    SIGNUP
// @route   POST /api/v1/auth/signup
// @access  Public
export const signup = asyncHandler(async (req, res) => {
    const { userName, email, password } = req.body;

    if ([userName, email, password].some( (field) => typeof field !== "string" || field.trim() === "" )) {
        throw new ApiError(StatusCodes.BAD_REQUEST, MISSING_FIELDS);
    }


    const isUserExist = await User.findOne({ $or: [{ userName, email }] });

    if (isUserExist) {
        throw new ApiError(StatusCodes.CONFLICT, USER_EXISTS);
    }

    const otp = uuidv4().replace(/-/g, "").slice(0, 6).toUpperCase();
    const otpExpiry = Date.now() + 600000;

    // try {
    // } catch (err) {
    //     console.error("Email error:", err);
    //     throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, EMAIL_ERROR);
    // }
    
    await sendEmailOTP(email, otp);

    const user = await User.create({
        userName,
        email,
        password,
        otp,
        expiresIn: otpExpiry,
    });

    const { accessToken } = await generateAccessToken(user._id);

    const createdUser = await User.findById(user._id)
        .select("-password -otp -expiresIn");

    const options = { httpOnly: true, secure: true };

    return res
        .status(StatusCodes.CREATED)
        .cookie("accessToken", accessToken, options)
        .send(new ApiResponse(
            StatusCodes.CREATED,
            SUCCESS_REGISTRATION,
            { user: createdUser, accessToken }
        ));
});

// @desc    RESEND OTP
// @route   POST /api/v1/auth/resend-otp
// @access  Public
export const resendOtp = asyncHandler(async (req, res) => {
    const { email } = req.body;
    if (!email) {
        return res.status(StatusCodes.BAD_REQUEST).send(new ApiError(StatusCodes.BAD_REQUEST, MISSING_FIELD_EMAIL));
    }

    const isUser = await User.findOne({ email });
    if (!isUser) {
        return res.status(StatusCodes.NOT_FOUND).send(new ApiError(StatusCodes.NOT_FOUND, NO_USER));
    }

    const newOtp = uuidv4().replace(/-/g, "").slice(0, 6).toUpperCase();

    await sendEmailOTP(email, newOtp);

    isUser.otp = newOtp;
    isUser.expiresIn = Date.now() + 600000;
    await isUser.save({ validateBeforeSave: false });

    return res.status(StatusCodes.OK).send(new ApiResponse(StatusCodes.OK, RESET_OTP_SECCESS));
});


// @desc    VERIFY EMAIL
// @route   POST /api/v1/auth/verify-email
// @access  Private (requires JWT)
export const verifyEmail = asyncHandler(async (req, res) => {
    const { otp } = req.body;

    if (!otp) {
        return res.status(StatusCodes.BAD_REQUEST).send(new ApiError(StatusCodes.BAD_REQUEST, MISSING_FIELDS));
    }

    const user = await User.findById(req.user._id);
    if (!user) {
        return res.status(StatusCodes.NOT_FOUND).send(new ApiError(StatusCodes.NOT_FOUND, NO_USER));
    }

    if (user.otp !== otp) {
        return res.status(StatusCodes.FORBIDDEN).send(new ApiError(StatusCodes.FORBIDDEN, INVALID_OTP));
    }

    if (user.expiresIn < Date.now()) {
        return res.status(StatusCodes.FORBIDDEN).send(new ApiError(StatusCodes.FORBIDDEN, OTP_EXPIRED));
    }

    user.isVerified = true;
    user.otp = undefined;
    user.expiresIn = undefined;
    await user.save({ validateBeforeSave: false });

    return res
        .status(StatusCodes.OK)
        .send(new ApiResponse(StatusCodes.OK, EMAIL_VERIFY, { email: user.email, isVerified: user.isVerified }));
});


// @desc    LOGIN
// @route   POST /api/v1/auth/login
// @access  Public
export const login = asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        throw new ApiError(StatusCodes.BAD_REQUEST, MISSING_FIELD_EMAIL_PASSWORD);
    }

    const user = await User.findOne({ email });
    if (!user) {
        throw new ApiError(StatusCodes.NOT_FOUND, NO_USER);
    }

    if (!user.isVerified) {
        throw new ApiError(StatusCodes.FORBIDDEN, "Please verify your email before logging in.");
    }

    if (user.suspended) {
        throw new ApiError(StatusCodes.FORBIDDEN, "Your account has been suspended. Contact support.");
    }

    const isPasswordValid = await user.isPasswordCorrect(password);
    if (!isPasswordValid) {
        throw new ApiError(StatusCodes.UNAUTHORIZED, UN_AUTHORIZED);
    }

    const { accessToken } = await generateAccessToken(user._id);

    const loggedInUser = await User.findById(user._id).select("-password -otp -expiresIn");

    const options = { httpOnly: true, secure: process.env.NODE_ENV === "production" };

    return res
        .status(StatusCodes.OK)
        .cookie("accessToken", accessToken, options)
        .send(new ApiResponse(StatusCodes.OK, SUCCESS_LOGIN, { user: loggedInUser, accessToken }));
});


// @desc    LOGOUT
// @route   POST /api/v1/auth/logout
// @access  Private
export const logout = asyncHandler(async (req, res) => {
    const options = { httpOnly: true, secure: process.env.NODE_ENV === "production" };

    return res
        .status(StatusCodes.OK)
        .clearCookie("accessToken", options)
        .send(new ApiResponse(StatusCodes.OK, SUCCESS_LOGOUT, {}));
});


// @desc    FORGOT PASSWORD
// @route   POST /api/v1/auth/forgot-password
// @access  Public
export const forgotPassword = asyncHandler(async (req, res) => {
    const { email } = req.body;
    if (!email) {
        return res.status(StatusCodes.BAD_REQUEST).send(new ApiError(StatusCodes.BAD_REQUEST, MISSING_FIELD_EMAIL));
    }

    const user = await User.findOne({ email });
    if (!user) {
        return res.status(StatusCodes.NOT_FOUND).send(new ApiError(StatusCodes.NOT_FOUND, NO_USER_FOUND));
    }

    if (!user.isVerified) {
        return res.status(StatusCodes.FORBIDDEN).send(new ApiError(StatusCodes.FORBIDDEN, NOT_VERIFY));
    }

    const otp = uuidv4().replace(/-/g, "").slice(0, 6).toUpperCase();
    user.otp = otp;
    user.expiresIn = Date.now() + 600000; // 10 minutes

    const emailResponse = await sendEmailOTP(email, otp);
    if (!emailResponse) {
        throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, EMAIL_ERROR);
    }

    await user.save({ validateBeforeSave: false });

    return res.status(StatusCodes.OK).send(new ApiResponse(StatusCodes.OK, RESET_LINK_SUCCESS));
});


// @desc    UPDATE PASSWORD (reset via OTP)
// @route   POST /api/v1/auth/update-password
// @access  Public
export const updatePassword = asyncHandler(async (req, res) => {
    const { newPassword, otp } = req.body;

    if (!newPassword || !otp) {
        return res.status(StatusCodes.BAD_REQUEST).send(new ApiError(StatusCodes.BAD_REQUEST, MISSING_FIELDS));
    }

    const user = await User.findOne({ otp });
    if (!user) {
        return res.status(StatusCodes.NOT_FOUND).send(new ApiError(StatusCodes.NOT_FOUND, INVALID_DATA));
    }

    if (user.expiresIn < Date.now()) {
        return res.status(StatusCodes.FORBIDDEN).send(new ApiError(StatusCodes.FORBIDDEN, OTP_EXPIRED));
    }

    user.password = newPassword;
    user.otp = undefined;
    user.expiresIn = undefined;
    await user.save({ validateBeforeSave: false });

    return res.status(StatusCodes.OK).send(new ApiResponse(StatusCodes.OK, PASSWORD_CHANGE, {}));
});