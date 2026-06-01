import { Server } from "socket.io";
import dotenv from "dotenv";
import { Chat } from "../models/chat.model.js";

dotenv.config();

export default class SocketService {
  constructor() {
    this._io = new Server({
      cors: {
        allowedHeaders: ["*"],
        origin: "*",
      },
    });

    this.userSocketMap = new Set();
  }

  async initListener() {
    const io = this._io;

    io.on("connection", (socket) => {
      const userId = socket.handshake?.query?.userId;

      console.log(`Socket connected: ${socket.id} for user ${userId}`);

      if (userId) {
        this.userSocketMap.add(userId);
        // Join a personal room so io.to(userId) works
        socket.join(String(userId));
      }

      console.log("Online users:", Array.from(this.userSocketMap));
      io.emit("getOnlineUser", Array.from(this.userSocketMap));

      //  Join Room
      socket.on("joinRoom", (chatId) => {
        socket.join(chatId);
        console.log(`Socket ${socket.id} joined room ${chatId}`);
      });

      //  Leave Room
      socket.on("leaveRoom", (chatId) => {
        socket.leave(chatId);
        console.log(`Socket ${socket.id} left room ${chatId}`);
      });

      //  Send Message (legacy socket path disabled)
      // NOTE: Message persistence + realtime fan-out is handled by REST
      // POST /api/v1/chat/messages in chat.controller.js.
      // Keeping this handler to avoid client crashes from old emits.
      socket.on("message", () => {
        // no-op intentionally to prevent duplicate delivery
      });

      //  Delete Message
      socket.on("delete", async (data) => {
        const { customId, receiver } = data;

        if (!customId || !receiver) return;

        io.to(receiver).emit("deleteMsg", customId);

        try {
          await Chat.findOneAndDelete({ customId });
        } catch (error) {
          console.error("Delete failed:", error.message);
        }
      });

      //  Edit Message
      socket.on("edit", async (data) => {
        const { customId, receiver, message } = data;

        if (!receiver || !customId) return;

        io.to(receiver).emit("editMsg", { customId, message });

        try {
          await Chat.findOneAndUpdate({ customId }, { message });
        } catch (error) {
          console.error("Edit failed:", error.message);
        }
      });

      //  Seen Message
      socket.on("seenMsg", async ({ sender, receiver }) => {
        if (!sender || !receiver) return;

        io.to(sender).emit("seenMsg", receiver);

        try {
          await Chat.updateMany(
            { sender, receiver, seen: false },
            { $set: { seen: true } }
          );
        } catch (error) {
          console.error("Seen update failed:", error.message);
        }
      });

      //  Disconnect
      socket.on("disconnect", () => {
        if (userId) {
          this.userSocketMap.delete(userId);
        }

        console.log(`Socket disconnected: ${socket.id}`);
        io.emit("getOnlineUser", Array.from(this.userSocketMap));
      });

      socket.on("connect_error", (error) => {
        console.log("Socket Connection Error", error);
      });
    });
  }

  get io() {
    return this._io;
  }
}