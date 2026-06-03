import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Load environment variables
dotenv.config();

// Fix for __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Test DB connection on startup ─────────────────────────────
import db from "./config/db.js";

db.query("SELECT 1")
  .then(() => console.log("✅ Database connected — foodlens_ai"))
  .catch((err) => {
    console.error("❌ Database connection FAILED:", err.message);
    console.error("👉 Check your .env file: DB_HOST, DB_USER, DB_PASS, DB_NAME");
    console.error("👉 Make sure XAMPP MySQL is running");
  });

// Import routes
import aiRoutes           from "./routes/aiRoutes.js";
import userRoutes         from "./routes/userRoutes.js";
import adminRoutes        from "./routes/adminRoutes.js";
import dashboardRoutes    from "./routes/dashboardRoutes.js";
import paymentRoutes      from "./routes/paymentRoutes.js";
import profileRoutes      from "./routes/Profileroutes.js";
import orderRoutes        from "./routes/orderRoutes.js";
import analyticsRoutes    from "./routes/analyticsRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

/* ===============================
   SERVE FRONTEND
================================= */
app.use(express.static(path.join(__dirname, "../frontend")));

/* ===============================
   API ROUTES
================================= */
app.use("/api/ai",            aiRoutes);
app.use("/api/user",          userRoutes);
app.use("/api/admin",         adminRoutes);
app.use("/api/dashboard",     dashboardRoutes);
app.use("/api/payment",       paymentRoutes);
app.use("/api/profile",       profileRoutes);
app.use("/api/orders",        orderRoutes);
app.use("/api/analytics",     analyticsRoutes);
app.use("/api/notifications", notificationRoutes);

/* ===============================
   UPLOADS
================================= */
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

/* ===============================
   HEALTH CHECK — test in browser:
   http://localhost:5000/api/health
================================= */
app.get("/api/health", async (req, res) => {
  try {
    await db.query("SELECT 1");
    res.json({
      status:   "ok",
      database: "connected ✅",
      server:   "running ✅"
    });
  } catch (err) {
    res.status(500).json({
      status:   "error",
      database: "FAILED ❌ — " + err.message,
      server:   "running ✅"
    });
  }
});

/* ===============================
   DEFAULT ROUTE
================================= */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/index.html"));
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log(`🔍 Test DB: http://localhost:${PORT}/api/health`);
});