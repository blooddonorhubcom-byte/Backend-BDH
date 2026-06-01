import { StatusCodes } from "http-status-codes";
import { User } from "../models/user.model.js";
import { UserInfo } from "../models/userInfo.model.js";
import { Donar } from "../models/donar.models.js";
import { BloodRequest } from "../models/bloodRequest.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { uploadOnCloudinary } from "../utils/cloudinary.js";
import { responseMessages } from "../constants/responseMessages.js";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";

const {
    GET_SUCCESS_MESSAGES,
    ADD_SUCCESS_MESSAGES,
    UPDATE_SUCCESS_MESSAGES,
    DELETED_SUCCESS_MESSAGES,
    NO_USER,
    NO_DATA_FOUND,
    MISSING_FIELDS,
    USER_EXISTS,
} = responseMessages;

function plainSubdoc(r) {
    if (!r) return null;
    return typeof r.toObject === "function" ? r.toObject({ flattenMaps: true }) : { ...r };
}


// ─── USERS ───────────────────────────────────────────────────────────────────

// @desc    Get all users with their profile info
// @route   GET /api/v1/admin/users
// @access  Admin
export const getAllUsers = asyncHandler(async (req, res) => {
    const { page = 1, limit = 20, search } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const filter = {};
    if (search) {
        filter.$or = [
            { userName: { $regex: search, $options: "i" } },
            { email: { $regex: search, $options: "i" } },
        ];
    }

    const [users, total] = await Promise.all([
        User.find(filter)
            .select("-password -otp -expiresIn")
            .skip(skip)
            .limit(parseInt(limit))
            .sort({ createdAt: -1 }),
        User.countDocuments(filter),
    ]);

    // Attach userInfo to each user
    const userIds = users.map((u) => u._id);
    const infos = await UserInfo.find({ user: { $in: userIds } });
    const infoMap = {};
    infos.forEach((i) => { infoMap[i.user.toString()] = i; });

    const result = users.map((u) => ({
        ...u.toObject(),
        userInfo: infoMap[u._id.toString()] || null,
    }));

    return res.status(StatusCodes.OK).send(
        new ApiResponse(StatusCodes.OK, GET_SUCCESS_MESSAGES, { users: result, total, page: parseInt(page), limit: parseInt(limit) })
    );
});


// @desc    Create a user (admin only)
// @route   POST /api/v1/admin/users
// @access  Admin
export const createUser = asyncHandler(async (req, res) => {
    const {
        userName,
        email,
        password,
        role = "user",
        mobileNumber,
        bloodGroup,
        city,
        dateOfBirth,
        gender,
        canDonateBlood,
        country,
        about,
    } = req.body;

    if (!userName || !email || !password) {
        throw new ApiError(StatusCodes.BAD_REQUEST, MISSING_FIELDS);
    }

    const exists = await User.findOne({ $or: [{ userName }, { email }] });
    if (exists) {
        throw new ApiError(StatusCodes.CONFLICT, USER_EXISTS);
    }

    const user = await User.create({
        userName: userName.trim().toLowerCase(),
        email: email.trim().toLowerCase(),
        password,
        role,
        isVerified: true, // admin-created accounts skip verification
    });

    // If profile fields are provided, create userInfo as well.
    const hasProfilePayload = mobileNumber || bloodGroup || city || dateOfBirth || gender || canDonateBlood || about;
    if (hasProfilePayload) {
        try {
            if (!mobileNumber || !bloodGroup || !city || !dateOfBirth || !gender || !canDonateBlood) {
                throw new ApiError(
                    StatusCodes.BAD_REQUEST,
                    "To create user profile, required fields are: mobileNumber, bloodGroup, city, dateOfBirth, gender, canDonateBlood"
                );
            }

            await UserInfo.create({
                user: user._id,
                mobileNumber: String(mobileNumber).trim(),
                bloodGroup: String(bloodGroup).trim(),
                city: String(city).trim(),
                dateOfBirth: new Date(dateOfBirth),
                gender: String(gender).trim().toLowerCase(),
                canDonateBlood: String(canDonateBlood).trim().toLowerCase(),
                country: country ? String(country).trim() : "Pakistan",
                about: about ? String(about).trim() : "",
            });
        } catch (error) {
            // keep DB consistent if profile create fails
            await User.findByIdAndDelete(user._id);
            throw error;
        }
    }

    const created = await User.findById(user._id).select("-password -otp -expiresIn");
    const userInfo = await UserInfo.findOne({ user: user._id });
    return res.status(StatusCodes.CREATED).send(new ApiResponse(StatusCodes.CREATED, ADD_SUCCESS_MESSAGES, { ...created.toObject(), userInfo }));
});


// @desc    Suspend or unsuspend a user
// @route   PATCH /api/v1/admin/users/:id/suspend
// @access  Admin
export const toggleSuspendUser = asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user) {
        throw new ApiError(StatusCodes.NOT_FOUND, NO_USER);
    }

    if (user.role === "admin") {
        throw new ApiError(StatusCodes.FORBIDDEN, "Cannot suspend another admin");
    }

    user.suspended = !user.suspended;
    await user.save({ validateBeforeSave: false });

    const status = user.suspended ? "suspended" : "activated";
    return res.status(StatusCodes.OK).send(
        new ApiResponse(StatusCodes.OK, `User ${status} successfully`, { suspended: user.suspended })
    );
});

// @desc    Block / unblock a user
// @route   PATCH /api/v1/admin/user/:id/block
// @access  Admin
export const toggleBlockUser = asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user) {
        throw new ApiError(StatusCodes.NOT_FOUND, NO_USER);
    }

    if (user.role === "admin") {
        throw new ApiError(StatusCodes.FORBIDDEN, "Cannot block another admin");
    }

    user.suspended = !user.suspended;
    await user.save({ validateBeforeSave: false });

    return res.status(StatusCodes.OK).send(
        new ApiResponse(
            StatusCodes.OK,
            user.suspended ? "User blocked successfully" : "User unblocked successfully",
            { blocked: user.suspended }
        )
    );
});


// @desc    Delete a user
// @route   DELETE /api/v1/admin/users/:id
// @access  Admin
export const deleteUser = asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user) {
        throw new ApiError(StatusCodes.NOT_FOUND, NO_USER);
    }

    if (user.role === "admin") {
        throw new ApiError(StatusCodes.FORBIDDEN, "Cannot delete another admin");
    }

    // Clean up related documents
    await Promise.all([
        UserInfo.findOneAndDelete({ user: user._id }),
        Donar.findOneAndDelete({ user: user._id }),
        User.findByIdAndDelete(user._id),
    ]);

    return res.status(StatusCodes.OK).send(new ApiResponse(StatusCodes.OK, DELETED_SUCCESS_MESSAGES, {}));
});

// @desc    Update user basic/profile fields
// @route   PATCH /api/v1/admin/users/:id
// @access  Admin
export const updateUserByAdmin = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const user = await User.findById(id);
    if (!user) {
        throw new ApiError(StatusCodes.NOT_FOUND, NO_USER);
    }

    const userUpdates = {};
    if (req.body.userName !== undefined) userUpdates.userName = String(req.body.userName).trim().toLowerCase();
    if (req.body.email !== undefined) userUpdates.email = String(req.body.email).trim().toLowerCase();
    if (req.body.role !== undefined) {
        const r = String(req.body.role).trim().toLowerCase();
        if (r === "user" || r === "admin") userUpdates.role = r;
    }

    if (Object.keys(userUpdates).length > 0) {
        await User.findByIdAndUpdate(id, { $set: userUpdates }, { returnDocument: "after", runValidators: true });
    }

    const profileFields = ["mobileNumber", "bloodGroup", "city", "country", "about"];
    const profileUpdates = {};
    for (const field of profileFields) {
        if (req.body[field] !== undefined) profileUpdates[field] = req.body[field];
    }

    if (req.body.gender !== undefined) {
        profileUpdates.gender = String(req.body.gender).trim().toLowerCase();
    }

    if (req.body.canDonateBlood !== undefined) {
        profileUpdates.canDonateBlood = String(req.body.canDonateBlood).trim().toLowerCase();
    }

    if (req.body.dateOfBirth !== undefined && req.body.dateOfBirth !== "") {
        profileUpdates.dateOfBirth = new Date(req.body.dateOfBirth);
    }

    if (req.body.age !== undefined && req.body.age !== "") {
        const numericAge = Number(req.body.age);
        if (Number.isFinite(numericAge) && numericAge > 0) {
            const dob = new Date();
            dob.setFullYear(dob.getFullYear() - numericAge);
            profileUpdates.dateOfBirth = dob;
        }
    }

    if (Object.keys(profileUpdates).length > 0) {
        await UserInfo.findOneAndUpdate({ user: id }, { $set: profileUpdates }, { upsert: true, returnDocument: "after" });
    }

    const updatedUser = await User.findById(id).select("-password -otp -expiresIn");
    const userInfo = await UserInfo.findOne({ user: id });

    return res
        .status(StatusCodes.OK)
        .send(new ApiResponse(StatusCodes.OK, UPDATE_SUCCESS_MESSAGES, { ...updatedUser.toObject(), userInfo }));
});


// ─── DONATION REQUESTS ───────────────────────────────────────────────────────

// @desc    Get all donation requests
// @route   GET /api/v1/admin/requests
// @access  Admin
export const getAllDonationRequests = asyncHandler(async (req, res) => {
    const { page = 1, limit = 20, bloodGroup, city } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const filter = {};
    if (bloodGroup) filter.bloodGroup = bloodGroup;
    if (city) filter.city = { $regex: city, $options: "i" };

    const [requests, total] = await Promise.all([
        BloodRequest.find(filter)
            .populate({ path: "createdBy", select: "userName email" })
            .skip(skip)
            .limit(parseInt(limit))
            .sort({ createdAt: -1 }),
        BloodRequest.countDocuments(filter),
    ]);

    return res.status(StatusCodes.OK).send(
        new ApiResponse(StatusCodes.OK, GET_SUCCESS_MESSAGES, { requests, total, page: parseInt(page), limit: parseInt(limit) })
    );
});

// @desc    Update a blood request
// @route   PATCH /api/v1/admin/requests/:id
// @access  Admin
export const updateDonationRequest = asyncHandler(async (req, res) => {
    const request = await BloodRequest.findById(req.params.id);
    if (!request) {
        throw new ApiError(StatusCodes.NOT_FOUND, NO_DATA_FOUND);
    }

    const scalarFields = ["patientName", "bloodGroup", "location", "city", "hospitalName", "contactInfo", "reason"];
    for (const f of scalarFields) {
        if (req.body[f] !== undefined) request[f] = String(req.body[f]).trim();
    }

    if (req.body.age !== undefined) {
        const n = Number(req.body.age);
        if (Number.isFinite(n) && n > 0) request.age = n;
    }
    if (req.body.requiredUnits !== undefined) {
        const n = Number(req.body.requiredUnits);
        if (Number.isFinite(n) && n > 0) request.requiredUnits = n;
    }
    if (req.body.urgencyLevel !== undefined) {
        const valid = ["low", "medium", "high", "critical"];
        const v = String(req.body.urgencyLevel).toLowerCase();
        if (valid.includes(v)) request.urgencyLevel = v;
    }
    if (req.body.status !== undefined) {
        const valid = ["in_progress", "completed", "cancelled"];
        if (valid.includes(req.body.status)) request.status = req.body.status;
    }
    if (req.body.donationDate !== undefined) {
        const d = new Date(req.body.donationDate);
        if (!isNaN(d.getTime())) request.donationDate = d;
    }
    if (req.body.startTime !== undefined) request.donationWindow.startTime = req.body.startTime;
    if (req.body.endTime !== undefined) request.donationWindow.endTime = req.body.endTime;

    await request.save();

    const updated = await BloodRequest.findById(request._id).populate({ path: "createdBy", select: "userName email" });
    return res.status(StatusCodes.OK).send(new ApiResponse(StatusCodes.OK, UPDATE_SUCCESS_MESSAGES, updated));
});

// @desc    Delete a blood request
// @route   DELETE /api/v1/admin/requests/:id
// @access  Admin
export const deleteDonationRequest = asyncHandler(async (req, res) => {
    const request = await BloodRequest.findByIdAndDelete(req.params.id);
    if (!request) {
        throw new ApiError(StatusCodes.NOT_FOUND, NO_DATA_FOUND);
    }
    return res.status(StatusCodes.OK).send(new ApiResponse(StatusCodes.OK, DELETED_SUCCESS_MESSAGES, {}));
});

// @desc    Get all blood donors
// @route   GET /api/v1/admin/donors
// @access  Admin
export const getAllDonors = asyncHandler(async (req, res) => {
    const { page = 1, limit = 20, bloodGroup, city } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const filter = { canDonateBlood: "yes" };
    if (bloodGroup) filter.bloodGroup = bloodGroup;
    if (city) filter.city = { $regex: city, $options: "i" };

    const [donors, total] = await Promise.all([
        UserInfo.find(filter)
            .populate({ path: "user", select: "userName email suspended role" })
            .skip(skip)
            .limit(parseInt(limit))
            .sort({ createdAt: -1 }),
        UserInfo.countDocuments(filter),
    ]);

    return res.status(StatusCodes.OK).send(
        new ApiResponse(StatusCodes.OK, GET_SUCCESS_MESSAGES, {
            donors,
            total,
            page: parseInt(page),
            limit: parseInt(limit),
        })
    );
});

// @desc    Create blood request (admin)
// @route   POST /api/v1/admin/blood-request
// @access  Admin
export const createBloodRequest = asyncHandler(async (req, res) => {
    const { patientName, bloodGroup, location, urgencyLevel, requiredUnits, contactInfo } = req.body;

    if (!patientName || !bloodGroup || !location || !urgencyLevel || !requiredUnits || !contactInfo) {
        throw new ApiError(StatusCodes.BAD_REQUEST, MISSING_FIELDS);
    }

    const normalizedUrgency = String(urgencyLevel).toLowerCase().trim();
    const allowedUrgency = ["low", "medium", "high", "critical"];
    if (!allowedUrgency.includes(normalizedUrgency)) {
        throw new ApiError(StatusCodes.BAD_REQUEST, "urgencyLevel must be one of: low, medium, high, critical");
    }

    const units = Number(requiredUnits);
    if (!Number.isFinite(units) || units <= 0) {
        throw new ApiError(StatusCodes.BAD_REQUEST, "requiredUnits must be a number greater than 0");
    }

    const request = await BloodRequest.create({
        patientName: String(patientName).trim(),
        bloodGroup: String(bloodGroup).trim(),
        location: String(location).trim(),
        urgencyLevel: normalizedUrgency,
        requiredUnits: units,
        contactInfo: String(contactInfo).trim(),
        createdBy: req.user._id,
    });

    return res
        .status(StatusCodes.CREATED)
        .send(new ApiResponse(StatusCodes.CREATED, ADD_SUCCESS_MESSAGES, request));
});


// ─── STATS ───────────────────────────────────────────────────────────────────

// @desc    Get dashboard stats
// @route   GET /api/v1/admin/stats
// @access  Admin
export const getStats = asyncHandler(async (req, res) => {
    const [totalUsers, totalDonors, totalRequests, suspendedUsers] = await Promise.all([
        User.countDocuments({ role: "user" }),
        UserInfo.countDocuments({ canDonateBlood: "yes" }),
        BloodRequest.countDocuments(),
        User.countDocuments({ suspended: true }),
    ]);

    return res.status(StatusCodes.OK).send(
        new ApiResponse(StatusCodes.OK, GET_SUCCESS_MESSAGES, {
            totalUsers,
            totalDonors,
            totalRequests,
            suspendedUsers,
        })
    );
});
