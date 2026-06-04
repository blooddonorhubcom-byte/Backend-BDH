import { User } from "../models/user.model.js";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

async function clearStaleToken(token) {
    try {
        await User.updateMany({ expoPushToken: token }, { $set: { expoPushToken: null } });
        console.warn("[Push] Cleared stale/invalid token:", token);
    } catch (err) {
        console.error("[Push] Failed to clear stale token:", err.message);
    }
}

/**
 * Send a push notification via Expo's push service.
 * This is a server-to-server call — it works even when the recipient's
 * app is closed or backgrounded. Expo routes to APNs (iOS) or FCM (Android).
 *
 * Silently skips invalid/missing tokens instead of throwing.
 */
export async function sendPushNotification(token, title, body, data = {}) {
    if (!token || !String(token).startsWith("ExponentPushToken")) {
        console.warn("[Push] Skipping — invalid or missing token:", token);
        return;
    }

    const payload = {
        to: token,
        sound: "default",
        title,
        body,
        data,
        priority: "high",
        channelId: "blood-requests",
    };

    console.log(`[Push] Sending → token=${token.slice(0, 30)}… title="${title}" data.type=${data.type ?? "—"}`);

    try {
        const response = await fetch(EXPO_PUSH_URL, {
            method: "POST",
            headers: {
                Accept: "application/json",
                "Accept-encoding": "gzip, deflate",
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
        });

        console.log(`[Push] Expo HTTP status: ${response.status}`);
        const result = await response.json();

        if (!response.ok) {
            console.error("[Push] Expo rejected request:", JSON.stringify(result));
            return;
        }

        // Expo returns an array of tickets for batch sends, or a single object for one-off sends.
        const tickets = Array.isArray(result?.data) ? result.data : (result?.data ? [result.data] : []);
        if (tickets.length === 0) {
            console.warn("[Push] Unexpected Expo response shape:", JSON.stringify(result));
        }
        tickets.forEach((ticket) => {
            if (ticket.status === "ok") {
                console.log(`[Push] Ticket OK — id=${ticket.id}`);
            } else if (ticket.status === "error") {
                console.error(
                    `[Push] Ticket error — message="${ticket.message}" error=${ticket.details?.error ?? "unknown"}`,
                    ticket.details ?? ""
                );
                if (ticket.details?.error === "DeviceNotRegistered") {
                    clearStaleToken(token);
                }
            } else {
                console.warn("[Push] Unexpected ticket:", JSON.stringify(ticket));
            }
        });
    } catch (err) {
        console.error("[Push] Network/fetch error:", err.message);
        console.error("[Push] Payload that failed:", JSON.stringify(payload));
    }
}

/**
 * Notify a donor that a blood request needs their help.
 * data.type = "BLOOD_REQUEST" — frontend opens Accept/Reject modal on tap.
 * @param {object} options - { city?: string, bloodType?: string }
 */
export async function notifyDonorBloodRequest(token, requestId, receiverId, options = {}) {
    const { city, bloodType } = options;
    const title = city ? `Blood Needed in Your City 🩸` : "Blood Donation Request";
    const body = bloodType && city
        ? `Someone in ${city} needs ${bloodType} blood. Can you donate?`
        : "A patient needs urgent blood donation. Tap to respond.";

    await sendPushNotification(token, title, body, {
        requestId: String(requestId),
        receiverId: String(receiverId),
        type: "BLOOD_REQUEST",
    });
}

/**
 * Ask donor if they completed the donation (STEP 6 — 30-min reminder).
 * data.type = "DONATION_CONFIRMATION" — frontend opens Yes/No confirmation modal on tap.
 */
export async function notifyDonorConfirmation(token, requestId, donorId) {
    await sendPushNotification(
        token,
        "Did You Donate? ⏰",
        "Your donation window is almost over. Did you donate blood?",
        {
            requestId: String(requestId),
            donorId: String(donorId),
            type: "DONATION_CONFIRMATION",
        }
    );
}