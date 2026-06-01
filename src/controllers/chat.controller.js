import { StatusCodes } from "http-status-codes";
import { Chat } from "../models/chat.model.js";
import { User } from "../models/user.model.js";
import { UserInfo } from "../models/userInfo.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { responseMessages } from "../constants/responseMessages.js";
import mongoose from "mongoose";
import { randomUUID } from "crypto";

const { GET_SUCCESS_MESSAGES, ADD_SUCCESS_MESSAGES, NO_DATA_FOUND, DELETED_SUCCESS_MESSAGES, UPDATE_SUCCESS_MESSAGES } = responseMessages;


// @desc    Get chat history between current user and another user
// @route   GET /api/v1/chat/messages/:receiverId
// @access  Private
export const getMessages = asyncHandler(async (req, res) => {
    const senderId = req.user._id;
    const { receiverId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    if (!mongoose.isValidObjectId(receiverId)) {
        throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid receiver id");
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [messages] = await Promise.all([
        Chat.find({
            $or: [
                { sender: senderId, receiver: receiverId },
                { sender: receiverId, receiver: senderId },
            ],
        })
            .sort({ createdAt: 1 })
            .skip(skip)
            .limit(parseInt(limit))
            .populate({ path: "sender", select: "userName" })
            .populate({ path: "receiver", select: "userName" }),
        // Mark all unread messages from this partner as seen immediately
        Chat.updateMany(
            { sender: receiverId, receiver: senderId, seen: false },
            { $set: { seen: true } }
        ),
    ]);

    return res.status(StatusCodes.OK).send(
        new ApiResponse(StatusCodes.OK, GET_SUCCESS_MESSAGES, messages)
    );
});


// @desc    Get all conversations for current user (latest message per conversation)
// @route   GET /api/v1/chat/conversations
// @access  Private
export const getConversations = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    // Aggregate to get latest message per conversation partner
    const conversations = await Chat.aggregate([
        {
            $match: {
                $or: [{ sender: userId }, { receiver: userId }],
            },
        },
        { $sort: { createdAt: -1 } },
        {
            $group: {
                _id: {
                    $cond: [
                        { $lt: ["$sender", "$receiver"] },
                        { a: "$sender", b: "$receiver" },
                        { a: "$receiver", b: "$sender" },
                    ],
                },
                latestMessage: { $first: "$$ROOT" },
                unreadCount: {
                    $sum: {
                        $cond: [
                            { $and: [{ $eq: ["$receiver", userId] }, { $eq: ["$seen", false] }] },
                            1,
                            0,
                        ],
                    },
                },
            },
        },
        { $replaceRoot: { newRoot: { $mergeObjects: ["$latestMessage", { unreadCount: "$unreadCount" }] } } },
        { $sort: { createdAt: -1 } },
    ]);

    // Populate sender/receiver names and pics
    const populated = await Promise.all(
        conversations.map(async (conv) => {
            const partnerId = conv.sender.toString() === userId.toString() ? conv.receiver : conv.sender;
            const partner = await User.findById(partnerId).select("userName");
            const partnerInfo = await UserInfo.findOne({ user: partnerId }).select("pic");

            return {
                ...conv,
                partner: {
                    _id: partnerId,
                    userName: partner?.userName,
                    pic: partnerInfo?.pic || "",
                },
            };
        })
    );

    return res.status(StatusCodes.OK).send(
        new ApiResponse(StatusCodes.OK, GET_SUCCESS_MESSAGES, populated)
    );
});


// @desc    Send a message (REST fallback alongside socket)
// @route   POST /api/v1/chat/messages
// @access  Private
export const sendMessage = asyncHandler(async (req, res) => {
    const senderId = req.user._id;
    const { receiverId, message, customId } = req.body;

    if (!receiverId || !message?.trim()) {
        throw new ApiError(StatusCodes.BAD_REQUEST, "receiverId and message are required");
    }

    if (!mongoose.isValidObjectId(receiverId)) {
        throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid receiverId");
    }

    const receiver = await User.findById(receiverId).select("_id");
    if (!receiver) {
        throw new ApiError(StatusCodes.NOT_FOUND, "Receiver not found");
    }

    const newMessage = await Chat.create({
        customId: customId || randomUUID(),
        sender: senderId,
        receiver: receiverId,
        message: message.trim(),
    });

    const populated = await Chat.findById(newMessage._id)
        .populate({ path: "sender", select: "userName" })
        .populate({ path: "receiver", select: "userName" });

    // Realtime fan-out to receiver room (room id = receiver userId)
    const io = req.app.get("io");
    if (io) {
        io.to(String(receiverId)).emit("newMessage", {
            sender: String(senderId),
            receiver: String(receiverId),
            message: newMessage.message,
            customId: newMessage.customId,
            createdAt: newMessage.createdAt,
        });
    }

    return res.status(StatusCodes.CREATED).send(
        new ApiResponse(StatusCodes.CREATED, ADD_SUCCESS_MESSAGES, populated)
    );
});


// @desc    Delete a message by customId (only sender can delete)
// @route   DELETE /api/v1/chat/messages/:customId
// @access  Private
export const deleteMessage = asyncHandler(async (req, res) => {
    const { customId } = req.params;

    const message = await Chat.findOne({ customId });
    if (!message) {
        throw new ApiError(StatusCodes.NOT_FOUND, NO_DATA_FOUND);
    }

    if (message.sender.toString() !== req.user._id.toString()) {
        throw new ApiError(StatusCodes.FORBIDDEN, "You can only delete your own messages");
    }

    await Chat.findOneAndDelete({ customId });

    return res.status(StatusCodes.OK).send(
        new ApiResponse(StatusCodes.OK, DELETED_SUCCESS_MESSAGES, { customId })
    );
});


// @desc    Edit a message by customId (only sender can edit)
// @route   PATCH /api/v1/chat/messages/:customId
// @access  Private
export const editMessage = asyncHandler(async (req, res) => {
    const { customId } = req.params;
    const { message } = req.body;

    if (!message || !message.trim()) {
        throw new ApiError(StatusCodes.BAD_REQUEST, "Message content is required");
    }

    const existing = await Chat.findOne({ customId });
    if (!existing) {
        throw new ApiError(StatusCodes.NOT_FOUND, NO_DATA_FOUND);
    }

    if (existing.sender.toString() !== req.user._id.toString()) {
        throw new ApiError(StatusCodes.FORBIDDEN, "You can only edit your own messages");
    }

    const updated = await Chat.findOneAndUpdate(
        { customId },
        { $set: { message: message.trim() } },
        { returnDocument: "after" }
    );

    return res.status(StatusCodes.OK).send(
        new ApiResponse(StatusCodes.OK, UPDATE_SUCCESS_MESSAGES, updated)
    );
});


// @desc    Search users to start a new chat (WhatsApp-like)
// @route   GET /api/v1/chat/users/search?q=hamza
// @access  Private
export const searchUsers = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const q = String(req.query.q ?? "").trim();

    if (!q) {
        return res
            .status(StatusCodes.OK)
            .send(new ApiResponse(StatusCodes.OK, GET_SUCCESS_MESSAGES, []));
    }

    // Basic safe search: username/email (case-insensitive). Exclude self + suspended.
    const users = await User.find({
        _id: { $ne: userId },
        suspended: { $ne: true },
        $or: [
            { userName: { $regex: q, $options: "i" } },
            { email: { $regex: q, $options: "i" } },
        ],
    })
        .select("userName email")
        .limit(20);

    const infos = await UserInfo.find({ user: { $in: users.map((u) => u._id) } })
        .select("user pic city")
        .lean();
    const infoMap = new Map(infos.map((i) => [String(i.user), i]));

    const result = users.map((u) => {
        const info = infoMap.get(String(u._id));
        return {
            _id: u._id,
            userName: u.userName,
            email: u.email,
            pic: info?.pic || "",
            city: info?.city || "",
        };
    });

    return res
        .status(StatusCodes.OK)
        .send(new ApiResponse(StatusCodes.OK, GET_SUCCESS_MESSAGES, result));
});
