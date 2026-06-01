import { v2 as cloudinary } from "cloudinary";
import fs from "fs";

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_SECRET_KEY,
})

export const uploadOnCloudinary = async (localFilePath) => {
    try {
        if (!localFilePath) return null;

        const cfg = cloudinary.config();
        console.log("[Cloudinary] cloud_name:", cfg.cloud_name, "| api_key:", cfg.api_key, "| secret set:", !!cfg.api_secret);
        console.log("[Cloudinary] uploading file:", localFilePath, "| exists:", fs.existsSync(localFilePath));

        const response = await cloudinary.uploader.upload(localFilePath, {
            resource_type: "auto",
        });

        console.log("[Cloudinary] upload success, url:", response.secure_url);
        fs.unlinkSync(localFilePath);
        return response;
    } catch (error) {
        console.error("[Cloudinary] upload failed:", error?.message ?? error);
        if (fs.existsSync(localFilePath)) fs.unlinkSync(localFilePath);
        return null;
    }
}
