import express from "express";
import bcrypt from "bcryptjs";
import db from "../config/db.js";
import authMiddleware from "../middlewares/authMiddleware.js";

const router = express.Router();

// All routes require auth
router.use(authMiddleware);

/* =============================================
   GET /api/profile
   Get current user profile + order count
============================================= */
router.get("/", async (req, res) => {
  try {
    const userId = req.user.id;

    const [users] = await db.query(
      "SELECT id, name, email, diet_pref FROM users WHERE id = ?",
      [userId]
    );

    if (!users.length) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Get order count (if orders table exists)
    let orderCount = 0;
    try {
      const [orders] = await db.query(
        "SELECT COUNT(*) as count FROM orders WHERE user_id = ?",
        [userId]
      );
      orderCount = orders[0].count || 0;
    } catch (_) {
      // orders table may not exist yet — that's fine
    }

    res.json({
      success: true,
      user: { ...users[0], order_count: orderCount }
    });

  } catch (err) {
    console.error("PROFILE GET ERROR:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/* =============================================
   PUT /api/profile/update
   Update name, email, and/or diet_pref
============================================= */
router.put("/update", async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, email, diet_pref } = req.body;

    // Build dynamic update query
    const fields  = [];
    const values  = [];

    if (name !== undefined) {
      if (!name.trim()) return res.status(400).json({ success: false, message: "Name cannot be empty" });
      fields.push("name = ?");
      values.push(name.trim());
    }

    if (email !== undefined) {
      if (!email.trim() || !/\S+@\S+\.\S+/.test(email)) {
        return res.status(400).json({ success: false, message: "Enter a valid email address" });
      }
      // Check email not already taken by another user
      const [existing] = await db.query(
        "SELECT id FROM users WHERE email = ? AND id != ?",
        [email.trim(), userId]
      );
      if (existing.length) {
        return res.status(400).json({ success: false, message: "Email already in use by another account" });
      }
      fields.push("email = ?");
      values.push(email.trim());
    }

    if (diet_pref !== undefined) {
      const allowed = ["", "Veg", "Non-Veg", "Vegan"];
      if (!allowed.includes(diet_pref)) {
        return res.status(400).json({ success: false, message: "Invalid diet preference" });
      }
      fields.push("diet_pref = ?");
      values.push(diet_pref);
    }

    if (fields.length === 0) {
      return res.status(400).json({ success: false, message: "Nothing to update" });
    }

    values.push(userId);
    await db.query(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`, values);

    // Return updated user
    const [updated] = await db.query(
      "SELECT id, name, email, diet_pref FROM users WHERE id = ?",
      [userId]
    );

    res.json({ success: true, message: "Profile updated", user: updated[0] });

  } catch (err) {
    console.error("PROFILE UPDATE ERROR:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/* =============================================
   PUT /api/profile/change-password
   Verify current password then set new one
============================================= */
router.put("/change-password", async (req, res) => {
  try {
    const userId = req.user.id;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: "Both passwords are required" });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, message: "New password must be at least 8 characters" });
    }

    // Get current hashed password
    const [users] = await db.query(
      "SELECT password FROM users WHERE id = ?",
      [userId]
    );

    if (!users.length) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Verify current password
    const isMatch = await bcrypt.compare(currentPassword, users[0].password);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: "Current password is incorrect" });
    }

    // Hash and save new password
    const hashed = await bcrypt.hash(newPassword, 12);
    await db.query("UPDATE users SET password = ? WHERE id = ?", [hashed, userId]);

    res.json({ success: true, message: "Password updated successfully" });

  } catch (err) {
    console.error("CHANGE PASSWORD ERROR:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/* =============================================
   DELETE /api/profile/delete
   Permanently delete the user account
============================================= */
router.delete("/delete", async (req, res) => {
  try {
    const userId = req.user.id;

    // Optionally delete related data first
    try {
      await db.query("DELETE FROM orders WHERE user_id = ?", [userId]);
    } catch (_) { /* orders table may not exist */ }

    await db.query("DELETE FROM users WHERE id = ?", [userId]);

    res.json({ success: true, message: "Account deleted successfully" });

  } catch (err) {
    console.error("DELETE ACCOUNT ERROR:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

export default router;

/* =============================================
   ADD TO YOUR server.js / app.js:

   import profileRoutes from "./routes/profileRoutes.js";
   app.use("/api/profile", profileRoutes);
============================================= */