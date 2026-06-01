import mongoose, { Schema } from "mongoose";

const donationRequestItemSchema = new Schema(
    {
        donarName: { type: String, trim: true },
        bloodGroup: { type: String, trim: true },
        amount: { type: String, trim: true },
        age: { type: Number },
        date: { type: String, trim: true },
        hospitalName: { type: String, trim: true },
        location: { type: String, trim: true },
        contactPersonName: { type: String, trim: true },
        mobileNumber: { type: String, trim: true },
        city: { type: String, trim: true },
        startTime: { type: String, trim: true },
        endTime: { type: String, trim: true },
        reason: { type: String, trim: true },
        donateTo: { type: Schema.Types.ObjectId, ref: "User" },
        status: {
            type: String,
            enum: ["in_progress", "completed", "cancelled"],
            default: "in_progress",
        },
    },
    { timestamps: true }
);

const donarSchema = new mongoose.Schema(
    {
        user: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true,
            unique: true,
        },
        requests: {
            type: [donationRequestItemSchema],
            default: [],
        },
    },
    { timestamps: true }
);

export const Donar = mongoose.model("Donar", donarSchema);
