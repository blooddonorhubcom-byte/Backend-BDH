import mongoose from "mongoose";

const userInfoSchema = new mongoose.Schema({
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true, 
    },

    pic: {
        type: String,
        default: ""
    },

    mobileNumber: {
      type: String,
      required: true,
      trim: true,
    },

    bloodGroup: {
      type: String,
      enum: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"],
      required: true,
    },

    country: {
      type: String,
      default: "Pakistan",
    },

    city: {
      type: String,
      required: true,
    },

    dateOfBirth: {
      type: Date,
      required: true,
    },

    gender: {
      type: String,
      enum: ["male", "female", "other"],
      required: true,
    },

    canDonateBlood: {
      type: String,
      enum: ["yes", "no"],
      required: true,
    },

    about: {
      type: String,
      trim: true,
      maxlength: 500,
    },

    medicalInfo: {
      diabetes:            { type: String, enum: ["yes", "no"] },
      headOrLungsProblem:  { type: String, enum: ["yes", "no"] },
      recentCovid:         { type: String, enum: ["yes", "no"] },
      cancerHistory:       { type: String, enum: ["yes", "no"] },
      hivAidsTest:         { type: String, enum: ["yes", "no"] },
      recentVaccination:   { type: String, enum: ["yes", "no"] },
    },
  },
  { timestamps: true }
);

export const UserInfo = mongoose.model("UserInfo", userInfoSchema);