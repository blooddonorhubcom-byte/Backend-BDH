import { StatusCodes } from "http-status-codes";
import { UserInfo } from "../models/userInfo.model.js";
import { User } from "../models/user.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { responseMessages } from "../constants/responseMessages.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { uploadOnCloudinary } from "../utils/cloudinary.js";
import { Donar } from "../models/donar.models.js";
import { sendPushNotification } from "../services/notification.service.js";
import fs from "fs";
import mongoose from "mongoose";

const {
    NO_USER,
    GET_SUCCESS_MESSAGES,
    UPDATE_SUCCESS_MESSAGES,
    ADD_SUCCESS_MESSAGES,
    NO_DATA_FOUND,
    MISSING_FIELDS,
    DELETED_SUCCESS_MESSAGES,
    UNAUTHORIZED_REQUEST,
} = responseMessages;

function plainSubdoc(r) {
    if (!r) return null;
    return typeof r.toObject === "function" ? r.toObject({ flattenMaps: true }) : { ...r };
}

function getActiveDonationRequest(donarData) {
    const list = donarData?.requests ?? [];
    const active = list.find((r) => r.status === "in_progress" && r.donarName && String(r.donarName).trim());
    return active ? plainSubdoc(active) : null;
}


// ─── PROFILE ────────────────────────────────────────────────────────────────

// @desc    Create profile
// @route   POST /api/v1/user/createProfile
// @access  Private
export const profileSetUp = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    const existingProfile = await UserInfo.findOne({ user: userId });
    if (existingProfile) {
        throw new ApiError(StatusCodes.CONFLICT, "Profile already exists. Use update endpoint.");
    }

    const { mobileNumber, bloodGroup, city, dateOfBirth, gender, canDonateBlood, about } = req.body;

    if (!mobileNumber || !bloodGroup || !city || !dateOfBirth || !gender || canDonateBlood === undefined) {
        if (req.file?.path) fs.unlinkSync(req.file.path);
        throw new ApiError(StatusCodes.BAD_REQUEST, MISSING_FIELDS);
    }

    let picUrl = "";
    if (req.file?.path) {
        const uploaded = await uploadOnCloudinary(req.file.path);
        if (uploaded) picUrl = uploaded.secure_url;
    }

    const profile = await UserInfo.create({
        user: userId,
        pic: picUrl,
        mobileNumber,
        bloodGroup,
        city,
        dateOfBirth,
        gender: gender.toLowerCase(),
        canDonateBlood: canDonateBlood.toLowerCase(),
        about,
    });

    return res.status(StatusCodes.CREATED).send(new ApiResponse(StatusCodes.CREATED, ADD_SUCCESS_MESSAGES, profile));
});


// @desc    Get current user's full profile
// @route   GET /api/v1/user/profile
// @access  Private
export const getProfile = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    const user = await User.findById(userId).select("-password -otp -expiresIn");
    const userInfo = await UserInfo.findOne({ user: userId });
    const donarData = await Donar.findOne({ user: userId });

    const donationRequests = (donarData?.requests ?? []).map(plainSubdoc).filter(Boolean);

    return res.status(StatusCodes.OK).send(
        new ApiResponse(StatusCodes.OK, GET_SUCCESS_MESSAGES, {
            user,
            userInfo: userInfo || null,
            medicalInfo: userInfo?.medicalInfo?.diabetes ? userInfo.medicalInfo : null,
            donationRequest: getActiveDonationRequest(donarData),
            donationRequests,
        })
    );
});


// @desc    Change mobile number
// @route   PUT /api/v1/user/changeNumber
// @access  Private
export const changeNumber = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const { mobileNumber } = req.body;

    if (!mobileNumber) {
        throw new ApiError(StatusCodes.BAD_REQUEST, MISSING_FIELDS);
    }

    const profile = await UserInfo.findOneAndUpdate(
        { user: userId },
        { $set: { mobileNumber } },
        { returnDocument: "after", runValidators: true }
    );

    if (!profile) {
        throw new ApiError(StatusCodes.NOT_FOUND, NO_DATA_FOUND);
    }

    return res
        .status(StatusCodes.OK)
        .send(new ApiResponse(StatusCodes.OK, UPDATE_SUCCESS_MESSAGES, profile));
});


// @desc    Update profile
// @route   PUT /api/v1/user/profile
// @access  Private
export const updateProfile = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    const allowedFields = ["mobileNumber", "bloodGroup", "city", "dateOfBirth", "gender", "canDonateBlood", "about", "country"];
    const updates = {};

    for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
            updates[field] = req.body[field];
        }
    }

    // Handle optional avatar update
    if (req.file?.path) {
        const uploaded = await uploadOnCloudinary(req.file.path);
        if (uploaded) updates.pic = uploaded.secure_url;
    }

    if (Object.keys(updates).length === 0 && !req.file) {
        throw new ApiError(StatusCodes.BAD_REQUEST, "No fields to update");
    }

    const profile = await UserInfo.findOneAndUpdate(
        { user: userId },
        { $set: updates },
        { returnDocument: "after", upsert: true, runValidators: false }
    );

    return res.status(StatusCodes.OK).send(new ApiResponse(StatusCodes.OK, UPDATE_SUCCESS_MESSAGES, profile));
});


// ─── MEDICAL INFO ────────────────────────────────────────────────────────────

// @desc    Save / update medical information
// @route   POST /api/v1/user/medicalInfo
// @access  Private
export const medicalInfo = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    const requiredFields = ["diabetes", "headOrLungsProblem", "recentCovid", "cancerHistory", "hivAidsTest", "recentVaccination"];
    const missing = requiredFields.filter((f) => req.body[f] === undefined);
    if (missing.length) {
        throw new ApiError(StatusCodes.BAD_REQUEST, `Missing fields: ${missing.join(", ")}`);
    }

    const { diabetes, headOrLungsProblem, recentCovid, cancerHistory, hivAidsTest, recentVaccination } = req.body;

    const userInfo = await UserInfo.findOneAndUpdate(
        { user: userId },
        {
            $set: {
                medicalInfo: { diabetes, headOrLungsProblem, recentCovid, cancerHistory, hivAidsTest, recentVaccination },
            },
        },
        { returnDocument: "after", upsert: true }
    );

    return res.status(StatusCodes.OK).send(new ApiResponse(StatusCodes.OK, ADD_SUCCESS_MESSAGES, userInfo.medicalInfo));
});


// @desc    Get current user's medical info
// @route   GET /api/v1/user/medicalInfo
// @access  Private
export const getMedicalInfo = asyncHandler(async (req, res) => {
    const userInfo = await UserInfo.findOne({ user: req.user._id });
    const info = userInfo?.medicalInfo ?? null;
    if (!info || !info.diabetes) {
        return res.status(StatusCodes.NOT_FOUND).send(new ApiError(StatusCodes.NOT_FOUND, NO_DATA_FOUND));
    }
    return res.status(StatusCodes.OK).send(new ApiResponse(StatusCodes.OK, GET_SUCCESS_MESSAGES, info));
});


// ─── DONATION REQUESTS ────────────────────────────────────────────────────────

// @desc    Create / update donation request
// @route   POST /api/v1/user/donarRequest
// @access  Private
export const donationRequest = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    const requiredFields = ["donarName", "bloodGroup", "amount", "age", "date", "hospitalName", "location", "contactPersonName", "mobileNumber", "city", "startTime", "endTime", "reason"];
    const missing = requiredFields.filter((f) => req.body[f] === undefined || req.body[f] === "");
    if (missing.length) {
        throw new ApiError(StatusCodes.BAD_REQUEST, `Missing fields: ${missing.join(", ")}`);
    }

    const { donarName, bloodGroup, amount, age, date, hospitalName, location, contactPersonName, mobileNumber, city, startTime, endTime, reason, donateTo } = req.body;

    const donateToVal =
        donateTo && mongoose.isValidObjectId(donateTo) ? new mongoose.Types.ObjectId(donateTo) : undefined;

    const newItem = {
        donarName,
        bloodGroup,
        amount,
        age: Number(age),
        date,
        hospitalName,
        location,
        contactPersonName,
        mobileNumber,
        city,
        startTime,
        endTime,
        reason,
        status: "in_progress",
    };
    if (donateToVal) newItem.donateTo = donateToVal;

    const donar = await Donar.findOneAndUpdate(
        { user: userId },
        { $push: { requests: newItem } },
        { returnDocument: "after", upsert: true }
    );

    const created = (donar.requests ?? []).at(-1);

    // Send push notifications to random users (up to `amount` units) — fire and forget
    const unitsNeeded = Math.max(1, parseInt(String(amount), 10) || 1);
    User.find({
        _id: { $ne: userId },
        expoPushToken: { $ne: null, $exists: true },
    })
        .select("_id expoPushToken")
        .limit(unitsNeeded * 10) // over-fetch for random selection
        .then((users) => {
            const shuffled = users.sort(() => 0.5 - Math.random());
            const selected = shuffled.slice(0, unitsNeeded);
            selected.forEach((u) => {
                if (u.expoPushToken) {
                    sendPushNotification(
                        u.expoPushToken,
                        "🩸 Blood Donation Request",
                        `${unitsNeeded} unit(s) of ${bloodGroup} blood needed urgently. Tap to view.`,
                        { requestId: String(created._id), type: "BLOOD_REQUEST" }
                    ).catch(() => {});
                }
            });
        })
        .catch(() => {});

    return res.status(StatusCodes.OK).send(new ApiResponse(StatusCodes.OK, ADD_SUCCESS_MESSAGES, plainSubdoc(created)));
});


// @desc    Delete a donation request (owner only)
// @route   DELETE /api/v1/user/requests/:id
// @access  Private
export const deleteRequest = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const requestId = req.params.id;

    const donar = await Donar.findOne({ user: userId });
    if (!donar) throw new ApiError(StatusCodes.NOT_FOUND, NO_DATA_FOUND);

    const exists = donar.requests.id(requestId);
    if (!exists) throw new ApiError(StatusCodes.NOT_FOUND, UNAUTHORIZED_REQUEST);

    await Donar.findOneAndUpdate(
        { user: userId },
        { $pull: { requests: { _id: new mongoose.Types.ObjectId(requestId) } } }
    );

    return res.status(StatusCodes.OK).send(new ApiResponse(StatusCodes.OK, DELETED_SUCCESS_MESSAGES, null));
});


// @desc    Get all donation requests (for home feed)
// @route   GET /api/v1/user/requests
// @access  Private
export const getAllRequests = asyncHandler(async (req, res) => {
    const { bloodGroup, city, page = 1, limit = 20 } = req.query;

    const elem = { donarName: { $exists: true, $nin: [null, ""] }, status: "in_progress" };
    if (bloodGroup) elem.bloodGroup = bloodGroup;
    if (city) elem.city = { $regex: city, $options: "i" };

    const filter = { requests: { $elemMatch: elem } };

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const donars = await Donar.find(filter)
        .populate({ path: "user", select: "userName email" })
        .skip(skip)
        .limit(parseInt(limit))
        .sort({ updatedAt: -1 });

    const requests = donars.flatMap((d) =>
        (d.requests ?? [])
            .filter(
                (r) =>
                    r.status === "in_progress" &&
                    r.donarName &&
                    String(r.donarName).trim() &&
                    (!bloodGroup || r.bloodGroup === bloodGroup) &&
                    (!city || String(r.city ?? "").toLowerCase().includes(String(city).toLowerCase()))
            )
            .map((r) => ({
                _id: r._id,
                donarDocumentId: d._id,
                userId: d.user,
                status: r.status,
                ...plainSubdoc(r),
            }))
    );

    return res.status(StatusCodes.OK).send(new ApiResponse(StatusCodes.OK, GET_SUCCESS_MESSAGES, requests));
});


// @desc    Get single donation request by donor id
// @route   GET /api/v1/user/requests/:id
// @access  Private
export const getRequestById = asyncHandler(async (req, res) => {
    const paramId = req.params.id;

    let donar = await Donar.findOne({ "requests._id": paramId }).populate({ path: "user", select: "userName email" });
    let embedded = donar ? donar.requests.id(paramId) : null;

    if (!embedded?.donarName) {
        donar = await Donar.findById(paramId).populate({ path: "user", select: "userName email" });
        if (donar) {
            const list = donar.requests ?? [];
            embedded =
                list.find((r) => r.status === "in_progress" && r.donarName && String(r.donarName).trim()) ||
                list.find((r) => r.donarName && String(r.donarName).trim()) ||
                null;
        }
    }

    if (!donar || !embedded?.donarName) {
        return res.status(StatusCodes.NOT_FOUND).send(new ApiError(StatusCodes.NOT_FOUND, NO_DATA_FOUND));
    }

    const ownerId = donar.user?._id ?? donar.user;
    const posterUserInfo = await UserInfo.findOne({ user: ownerId });

    const embObj = plainSubdoc(embedded);

    const medForRequest = posterUserInfo?.medicalInfo?.diabetes ? posterUserInfo.medicalInfo : null;

    const result = {
        _id: embObj._id,
        donarDocumentId: donar._id,
        status: embObj.status,
        userId: donar.user,
        posterProfile: posterUserInfo
            ? {
                  pic: posterUserInfo.pic || "",
                  mobileNumber: posterUserInfo.mobileNumber,
                  city: posterUserInfo.city,
                  bloodGroup: posterUserInfo.bloodGroup,
                  gender: posterUserInfo.gender,
                  dateOfBirth: posterUserInfo.dateOfBirth,
                  about: posterUserInfo.about,
                  country: posterUserInfo.country,
              }
            : null,
        ...embObj,
        medicalInformation: medForRequest,
    };

    return res.status(StatusCodes.OK).send(new ApiResponse(StatusCodes.OK, GET_SUCCESS_MESSAGES, result));
});


// @desc    Public profile of another user (for request poster / donor view)
// @route   GET /api/v1/user/public/:userId
// @access  Private
export const getPublicUserProfile = asyncHandler(async (req, res) => {
    const { userId } = req.params;
    if (!mongoose.isValidObjectId(userId)) {
        throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid user id");
    }

    const user = await User.findById(userId).select("userName email suspended");
    if (!user || user.suspended) {
        throw new ApiError(StatusCodes.NOT_FOUND, NO_DATA_FOUND);
    }

    const userInfo = await UserInfo.findOne({ user: userId }).select(
        "pic mobileNumber city bloodGroup gender dateOfBirth about country"
    );

    let ageStr = "—";
    if (userInfo?.dateOfBirth) {
        const dob = new Date(userInfo.dateOfBirth);
        const today = new Date();
        let age = today.getFullYear() - dob.getFullYear();
        const m = today.getMonth() - dob.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) {
            age--;
        }
        ageStr = String(age);
    }

    return res.status(StatusCodes.OK).send(
        new ApiResponse(StatusCodes.OK, GET_SUCCESS_MESSAGES, {
            user: { userName: user.userName, email: user.email },
            userInfo: userInfo
                ? {
                      pic: userInfo.pic || "",
                      mobileNumber: userInfo.mobileNumber,
                      city: userInfo.city,
                      bloodGroup: userInfo.bloodGroup,
                      gender: userInfo.gender,
                      about: userInfo.about,
                      country: userInfo.country,
                      age: ageStr,
                  }
                : null,
        })
    );
});


// @desc    Update account info (userName, city, about)
// @route   PUT /api/v1/user/account-info
// @access  Private
export const updateAccountInfo = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const { userName, city, about } = req.body;

    if (!userName && city === undefined && about === undefined) {
        throw new ApiError(StatusCodes.BAD_REQUEST, "No fields to update");
    }

    let updatedUser = null;
    if (userName) {
        const duplicate = await User.findOne({ userName, _id: { $ne: userId } });
        if (duplicate) {
            throw new ApiError(StatusCodes.CONFLICT, "Username already taken");
        }
        updatedUser = await User.findOneAndUpdate(
            { _id: userId },
            { $set: { userName } },
            { returnDocument: "after", runValidators: true }
        ).select("-password -otp -expiresIn");
    }

    const infoUpdates = {};
    if (city !== undefined) infoUpdates.city = city;
    if (about !== undefined) infoUpdates.about = about;

    let updatedInfo = null;
    if (Object.keys(infoUpdates).length > 0) {
        updatedInfo = await UserInfo.findOneAndUpdate(
            { user: userId },
            { $set: infoUpdates },
            { returnDocument: "after", runValidators: true }
        );
    }

    return res.status(StatusCodes.OK).send(
        new ApiResponse(StatusCodes.OK, UPDATE_SUCCESS_MESSAGES, {
            user: updatedUser,
            userInfo: updatedInfo,
        })
    );
});


// ─── PUSH TOKEN ──────────────────────────────────────────────────────────────

// @desc    Save / update Expo push token for this device
// @route   PATCH /api/v1/user/push-token
// @access  Private
export const savePushToken = asyncHandler(async (req, res) => {
    const { expoPushToken } = req.body;

    // Allow null to clear the token (user disabled notifications)
    if (expoPushToken === undefined) {
        throw new ApiError(StatusCodes.BAD_REQUEST, MISSING_FIELDS);
    }

    await User.findByIdAndUpdate(req.user._id, { expoPushToken: expoPushToken || null });

    return res.status(StatusCodes.OK).send(
        new ApiResponse(StatusCodes.OK, UPDATE_SUCCESS_MESSAGES, null)
    );
});


// ─── DONORS LIST ─────────────────────────────────────────────────────────────

// @desc    Get donors list with optional filters
// @route   GET /api/v1/user/donors
// @access  Private
export const getDonors = asyncHandler(async (req, res) => {
    const { bloodGroup, city, page = 1, limit = 20 } = req.query;

    const infoFilter = { canDonateBlood: "yes" };
    if (bloodGroup) infoFilter.bloodGroup = bloodGroup;
    if (city) infoFilter.city = { $regex: city, $options: "i" };

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const donors = await UserInfo.find(infoFilter)
        .populate({ path: "user", select: "userName email" })
        .skip(skip)
        .limit(parseInt(limit))
        .sort({ createdAt: -1 });

    return res.status(StatusCodes.OK).send(new ApiResponse(StatusCodes.OK, GET_SUCCESS_MESSAGES, donors));
});


