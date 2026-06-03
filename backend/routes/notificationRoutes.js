import express from "express";
import db from "../config/db.js";
import authMiddleware from "../middlewares/authMiddleware.js";

const router = express.Router();

/* =============================================
   SQL — run once in phpMyAdmin:

   CREATE TABLE IF NOT EXISTS notifications (
     id         INT AUTO_INCREMENT PRIMARY KEY,
     user_id    INT          DEFAULT NULL,
     title      VARCHAR(255) NOT NULL,
     message    TEXT         NOT NULL,
     type       VARCHAR(20)  NOT NULL DEFAULT 'system',
     is_read    TINYINT(1)   NOT NULL DEFAULT 0,
     created_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
     FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
   );

   -- user_id NULL = sent to ALL users
============================================= */

/* =============================================
   GET /api/notifications
   Get notifications for logged-in user
============================================= */
router.get("/", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    const [rows] = await db.query(
      `SELECT * FROM notifications
       WHERE user_id = ? OR user_id IS NULL
       ORDER BY created_at DESC
       LIMIT 30`,
      [userId]
    );

    // Mark fetched notifications as delivered (not read yet)
    res.json({ success: true, notifications: rows });

  } catch (err) {
    console.error("GET NOTIFICATIONS ERROR:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/* =============================================
   GET /api/notifications/all
   Admin — get ALL notifications
============================================= */
router.get("/all", authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Admin only" });
    }

    const [rows] = await db.query(
      `SELECT n.*, u.name AS user_name
       FROM notifications n
       LEFT JOIN users u ON u.id = n.user_id
       ORDER BY n.created_at DESC
       LIMIT 100`
    );

    res.json({ success: true, notifications: rows });

  } catch (err) {
    console.error("GET ALL NOTIFICATIONS ERROR:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/* =============================================
   POST /api/notifications/send
   Admin — send notification to all or one user
============================================= */
router.post("/send", authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Admin only" });
    }

    const { title, message, type = "system", target, user_id } = req.body;

    if (!title || !message) {
      return res.status(400).json({ success: false, message: "Title and message required" });
    }

    const validTypes = ["order", "promo", "system", "alert"];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ success: false, message: "Invalid type" });
    }

    if (target === "single" && user_id) {
      // Send to one specific user
      await db.query(
        "INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, ?)",
        [user_id, title, message, type]
      );
      return res.json({ success: true, message: "Notification sent", count: 1 });
    }

    // Send to ALL users (user_id = NULL means broadcast)
    await db.query(
      "INSERT INTO notifications (user_id, title, message, type) VALUES (NULL, ?, ?, ?)",
      [title, message, type]
    );

    // Count how many users will receive it
    const [[countRow]] = await db.query(
      "SELECT COUNT(*) AS total FROM users WHERE role = 'user'"
    );

    res.json({
      success: true,
      message: "Notification broadcast to all users",
      count: countRow.total
    });

  } catch (err) {
    console.error("SEND NOTIFICATION ERROR:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/* =============================================
   PUT /api/notifications/:id/read
   Mark one notification as read
============================================= */
router.put("/:id/read", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const notifId = req.params.id;

    await db.query(
      "UPDATE notifications SET is_read = 1 WHERE id = ? AND (user_id = ? OR user_id IS NULL)",
      [notifId, userId]
    );

    res.json({ success: true, message: "Marked as read" });

  } catch (err) {
    console.error("MARK READ ERROR:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/* =============================================
   PUT /api/notifications/read-all
   Mark ALL notifications as read for this user
============================================= */
router.put("/read-all", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    await db.query(
      "UPDATE notifications SET is_read = 1 WHERE user_id = ? OR user_id IS NULL",
      [userId]
    );

    res.json({ success: true, message: "All marked as read" });

  } catch (err) {
    console.error("MARK ALL READ ERROR:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/* =============================================
   DELETE /api/notifications/:id
   Admin — delete a notification
============================================= */
router.delete("/:id", authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Admin only" });
    }

    await db.query("DELETE FROM notifications WHERE id = ?", [req.params.id]);
    res.json({ success: true, message: "Notification deleted" });

  } catch (err) {
    console.error("DELETE NOTIFICATION ERROR:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

export default router;

