import nodemailer from "nodemailer";
import { SEND_EMAIL_CODE } from "../email/template.js";
const emailConfig = {
    service: "gmail",
    auth: {
        user: process.env.PORTAL_EMAIL,
        pass: process.env.PORTAL_PASSWORD,
    },
};

async function sendEmailOTP(mail, otp) { 
    const transporter = nodemailer.createTransport(emailConfig);
    const mailOptions = {
        from: process.env.PORTAL_EMAIL,
        to: mail, 
        subject: "Blood Donor Hub Password Reset OTP",
        html: SEND_EMAIL_CODE(otp),
    };

    try {
        await transporter.sendMail(mailOptions);
        return `OTP sent to ${mail} via email`;
    } catch (error) {
        throw new Error(
            `Error sending OTP to ${mail} via email: ${error?.message || error}`,
        );
    }
}

export { sendEmailOTP }