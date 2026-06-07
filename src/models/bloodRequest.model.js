import mongoose, { Schema } from "mongoose";

const donorAssignmentSchema = new Schema(
    {
        donor: { type: Schema.Types.ObjectId, ref: "User", required: true },
        status: {
            type: String,
            enum: ["pending", "accepted", "rejected", "completed", "cancelled"],
            default: "pending",
        },
        notificationSent: { type: Boolean, default: false },
        reminderSent:     { type: Boolean, default: false },
        respondedAt: { type: Date },
        confirmedAt: { type: Date },
    },
    { _id: true }
);

const bloodRequestSchema = new mongoose.Schema(
    {
        patientName: { type: String, required: true, trim: true },
        bloodGroup: {
            type: String,
            enum: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"],
            required: true,
        },
        location: { type: String, required: true, trim: true },
        city: { type: String, required: true, trim: true },
        hospitalName: { type: String, required: true, trim: true },
        isEmergency: {
            type: Boolean,
            default: false,
        },
        requiredUnits: { type: Number, required: true, min: 1 },
        contactInfo: { type: String, required: true, trim: true },
        age: { type: Number },
        reason: { type: String, trim: true },
        createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
        status: {
            type: String,
            enum: ["in_progress", "completed", "cancelled"],
            default: "in_progress",
            trim: true,
        },
        donationDate: { type: Date, required: true },
        donationWindow: {
            startTime: { type: String, required: true },
            endTime: { type: String, required: true },
        },
        expiresAt: { type: Date, index: true },
        donors: { type: [donorAssignmentSchema], default: [] },
        reminderSent: { type: Boolean, default: false },
    },
    { timestamps: true }
);

bloodRequestSchema.virtual("donatedUnits").get(function () {
    return this.donors.filter((d) => d.status === "completed").length;
});

export const BloodRequest = mongoose.model("BloodRequest", bloodRequestSchema);