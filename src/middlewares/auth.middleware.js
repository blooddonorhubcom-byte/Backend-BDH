import { StatusCodes } from "http-status-codes";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import jwt from "jsonwebtoken";
import { responseMessages } from "../constants/responseMessages.js";
import { User } from "../models/user.model.js";

const { UNAUTHORIZED_REQUEST, INVALID_TOKEN, ADMIN_ACCESS } = responseMessages;

export const verifyJwt = asyncHandler(async (req, _, next) => {
    const token =
        req.cookies?.accessToken ||
        req.header("Authorization")?.replace("Bearer ", "");

    if (!token) {
        throw new ApiError(StatusCodes.UNAUTHORIZED, UNAUTHORIZED_REQUEST);
    }

    const decodedToken = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);

    const user = await User.findById(decodedToken?._id).select("-password");
    if (!user) {
        throw new ApiError(StatusCodes.UNAUTHORIZED, INVALID_TOKEN);
    }

    req.user = user;
    next();
});


// Use after verifyJwt: [verifyJwt, checkAdmin]
export const checkAdmin = asyncHandler(async (req, _, next) => {
    if (req.user?.role !== "admin") {
        throw new ApiError(StatusCodes.FORBIDDEN, ADMIN_ACCESS);
    }
    next();
});
