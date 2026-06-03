import cron from "node-cron";
import { BloodRequest } from "../models/bloodRequest.model.js";
import { User } from "../models/user.model.js";
import { notifyDonorConfirmation } from "../services/notification.service.js";

/**
 * Parse "HH:mm" endTime into a Date on the same calendar day as baseDate.
 * If endTime is earlier than startTime (midnight-crossing window), adds 1 day.
 * Returns null if inputs are invalid.
 */
function parseTimeOnDate(baseDate, timeStr, startTimeStr = null) {
    if (!baseDate || !timeStr) return null;
    const parts = String(timeStr).split(":");
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    if (isNaN(hours) || isNaN(minutes)) return null;
    const d = new Date(baseDate);
    d.setHours(hours, minutes, 0, 0);
    if (startTimeStr) {
        const sParts = String(startTimeStr).split(":");
        const sh = parseInt(sParts[0], 10);
        const sm = parseInt(sParts[1], 10);
        if (!isNaN(sh) && !isNaN(sm)) {
            if ((hours * 60 + minutes) < (sh * 60 + sm)) {
                d.setDate(d.getDate() + 1);
            }
        }
    }
    return d;
}

// ─── JOB 1: Donation Reminder ─────────────────────────────────────────────────
// Runs every 30 minutes.
// Sends "Did you donate blood?" push to accepted donors when we're within
// 30 minutes before the end of their donation window.
// Uses per-donor reminderSent flag so replacement donors always receive reminders.
async function runReminderJob(io) {
    try {
        const now = new Date();

        const requests = await BloodRequest.find({
            status: "in_progress",
            "donors.status": "accepted",
        });

        for (const request of requests) {
            // Prefer precomputed expiresAt; fall back to parsing donationWindow
            const expiresAt = request.expiresAt
                || parseTimeOnDate(request.donationDate, request.donationWindow?.endTime, request.donationWindow?.startTime);
            if (!expiresAt) continue;

            const reminderAt = new Date(expiresAt.getTime() - 30 * 60 * 1000);
            if (now < reminderAt) continue;
            // No upper-bound check on expiresAt — reminderSent flag prevents duplicates,
            // so a cron tick that fires slightly past the end time still delivers the notification.

            // Send reminder only to accepted donors who haven't been reminded yet
            const needsReminder = request.donors.filter(
                (d) => d.status === "accepted" && !d.reminderSent
            );
            if (needsReminder.length === 0) continue;

            await sendConfirmationReminders(request, needsReminder);

            // Mark each reminded donor atomically
            for (const donorEntry of needsReminder) {
                await BloodRequest.updateOne(
                    { _id: request._id, "donors._id": donorEntry._id },
                    { $set: { "donors.$.reminderSent": true } }
                );
            }

            // Also set request-level flag for backward compat queries
            await BloodRequest.findByIdAndUpdate(request._id, { reminderSent: true });
            console.log(`[ReminderJob] Sent reminder for request ${request._id}`);
        }
    } catch (err) {
        console.error("[ReminderJob] Error:", err.message);
    }
}

async function sendConfirmationReminders(request, donorEntries) {
    for (const donorEntry of donorEntries) {
        try {
            const user = await User.findById(donorEntry.donor).select("expoPushToken");
            if (user?.expoPushToken) {
                await notifyDonorConfirmation(
                    user.expoPushToken,
                    request._id,
                    donorEntry.donor
                );
            }
        } catch (err) {
            console.error(`[ReminderJob] Push failed for donor ${donorEntry.donor}:`, err.message);
        }
    }
}

// ─── JOB 2: Auto-Cancel ───────────────────────────────────────────────────────
// Runs every 60 minutes.
// Auto-cancels in_progress requests where the donation window ended 2+ hours ago
// and no donor has confirmed completion.
// Does NOT require reminderSent — expired requests are cancelled regardless.
async function runAutoCancelJob(io) {
    try {
        const now = new Date();

        const requests = await BloodRequest.find({
            status: "in_progress",
        });

        for (const request of requests) {
            const expiresAt = request.expiresAt
                || parseTimeOnDate(request.donationDate, request.donationWindow?.endTime, request.donationWindow?.startTime);
            if (!expiresAt) continue;

            // Auto-cancel 2 hours after window end with no confirmed donation
            const autoCancelAt = new Date(expiresAt.getTime() + 2 * 60 * 60 * 1000);
            if (now < autoCancelAt) continue;

            const anyCompleted = request.donors.some((d) => d.status === "completed");
            if (anyCompleted) continue; // at least one donor donated — do not cancel

            // Cancel all non-finalized donors
            request.donors.forEach((d) => {
                if (!["completed", "rejected", "cancelled"].includes(d.status)) {
                    d.status = "cancelled";
                }
            });
            request.status = "cancelled";
            await request.save();

            console.log(`[AutoCancelJob] Auto-cancelled request ${request._id}`);

            // Real-time: notify receiver
            io.to(String(request.createdBy)).emit("requestUpdated", {
                requestId: String(request._id),
                status: "cancelled",
                event: "auto_cancelled",
            });

            // Real-time: notify each assigned donor
            request.donors.forEach((d) => {
                io.to(String(d.donor)).emit("requestUpdated", {
                    requestId: String(request._id),
                    donorStatus: "cancelled",
                    event: "auto_cancelled",
                });
            });
        }
    } catch (err) {
        console.error("[AutoCancelJob] Error:", err.message);
    }
}

// ─── JOB 3: BloodRequest Cleanup ─────────────────────────────────────────────
// Runs daily at 02:00 AM.
// Permanently deletes BloodRequest documents that are completed or cancelled
// and older than 30 days, keeping the collection lean.
async function runBloodRequestCleanupJob() {
    try {
        const now = new Date();

        // Delete completed/cancelled requests whose donation window has already passed
        const result = await BloodRequest.deleteMany({
            status: { $in: ["completed", "cancelled"] },
            expiresAt: { $lt: now },
        });

        console.log(`[BloodRequestCleanup] Deleted ${result.deletedCount} old completed/cancelled requests`);
    } catch (err) {
        console.error("[BloodRequestCleanup] Error:", err.message);
    }
}

// ─── START ALL JOBS ───────────────────────────────────────────────────────────
export function startReminderJob(io) {
    // Every 30 minutes — donation reminder
    cron.schedule("*/30 * * * *", () => {
        console.log("[Jobs] Running donation reminder check…");
        runReminderJob(io);
    });

    // Every 60 minutes — auto-cancel BloodRequests
    cron.schedule("0 * * * *", () => {
        console.log("[Jobs] Running auto-cancel check…");
        runAutoCancelJob(io);
    });

    // Daily at 12:00 AM (midnight) — delete old completed/cancelled BloodRequest records
    cron.schedule("0 0 * * *", () => {
        console.log("[Jobs] Running BloodRequest cleanup…");
        runBloodRequestCleanupJob();
    });

    console.log("[Jobs] Reminder (30 min), auto-cancel (60 min), and BloodRequest cleanup (12 AM) jobs started");
}