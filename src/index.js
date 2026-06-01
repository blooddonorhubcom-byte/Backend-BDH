import { connectDB } from "./db/index.js";
import http from "http";
import app from "./app.js";
import SocketService from "./socket/index.js";
import { startReminderJob } from "./jobs/reminderJob.js";
import dotenv from "dotenv";

dotenv.config({ path: "./.env" });

const PORT = process.env.PORT || 3001;
const server = http.createServer(app);

const socketService = new SocketService();
socketService.io.attach(server);
socketService.initListener();
app.set("io", socketService.io);

connectDB()
    .then(() => {
        server.listen(PORT, () => {
            console.log(`🚀 Server is running on http://localhost:${PORT}`);
            startReminderJob(socketService.io);
        });
    })
  .catch((err) => {
    console.error("❌ MongoDB connection failed:", err.message);
    process.exit(1);
  });