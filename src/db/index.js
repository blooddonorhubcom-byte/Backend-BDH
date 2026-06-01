import mongoose from "mongoose";

let cached = globalThis.mongooseCache;

if (!cached) {
    cached = globalThis.mongooseCache = { conn: null, promise: null };
}

export const connectDB = async () => {
    if (mongoose.connection.readyState === 1) {
        return mongoose.connection;
    }
    if (cached.conn) {
        return cached.conn;
    }
    if (!cached.promise) {
        const mongoUri = process.env.MONGO_URI;
        if (!mongoUri?.trim()) {
            throw new Error("MONGO_URI is not set");
        }
        const uri = `${mongoUri.replace(/\/$/, "")}/blood-donar`;
        cached.promise = mongoose
            .connect(uri, {
                serverSelectionTimeoutMS: 15000,
                maxPoolSize: 10,
            })
            .then(() => mongoose.connection);
    }
    try {
        cached.conn = await cached.promise;
        return cached.conn;
    } catch (error) {
        cached.promise = null;
        cached.conn = null;
        console.error("Error connecting to MongoDB:", error.message);
        if (mongoose.connection.readyState !== 0) {
            await mongoose.connection.close().catch(() => {});
        }
        throw error;
    }
};

process.on("SIGINT", async () => {
    console.log("Application is terminating...");
    if (mongoose.connection.readyState !== 0) {
        await mongoose.connection.close();
        console.log("MongoDB Connection Closed");
    }
    process.exit(0);
});
