import express from "express";
import db from "../config/db.js";
import upload from "../middlewares/upload.js";

const router = express.Router();

/* =========================
   AUTO-NOTIFY HELPER
   Sends notification to ALL users (user_id = NULL = broadcast)
========================= */
async function notifyAll(title, message, type = "system") {
  try {
    await db.query(
      "INSERT INTO notifications (user_id, title, message, type) VALUES (NULL, ?, ?, ?)",
      [title, message, type]
    );
  } catch (err) {
    // Non-critical — don't crash if notifications table not ready
    console.warn("Notification skipped:", err.message);
  }
}

/* =========================
   RESTAURANTS CRUD
========================= */

// GET restaurants
router.get("/restaurants", async (req, res) => {
  const [rows] = await db.query("SELECT * FROM restaurants");
  res.json({ success: true, data: rows });
});

// ADD restaurant (WITH IMAGE)
router.post(
  "/restaurants",
  upload.single("image"),
  async (req, res) => {
    const { name, description } = req.body;
    const image = req.file ? req.file.filename : null;

    if (!name || name.trim() === '') {
      return res.status(400).json({ success: false, message: "Restaurant name is required" });
    }
    if (!description || description.trim() === '') {
      return res.status(400).json({ success: false, message: "Description is required" });
    }

    await db.query(
      "INSERT INTO restaurants (name, description, image) VALUES (?, ?, ?)",
      [name, description, image]
    );

    // ✅ Auto-notify all users about the new restaurant
    await notifyAll(
      `🏪 New restaurant: ${name}!`,
      `${name} just joined FoodLens AI. ${description ? description.substring(0, 80) : "Check out their menu now!"}`,
      "system"
    );

    res.json({ success: true });
  }
);

// UPDATE restaurant (WITH IMAGE)
router.put(
  "/restaurants/:id",
  upload.single("image"),
  async (req, res) => {
    const { name, description } = req.body;
    const image = req.file ? req.file.filename : null;

    let sql = "UPDATE restaurants SET name=?, description=?";
    const params = [name, description];

    if (image) {
      sql += ", image=?";
      params.push(image);
    }

    sql += " WHERE id=?";
    params.push(req.params.id);

    await db.query(sql, params);
    res.json({ success: true });
  }
);

// DELETE restaurant
router.delete("/restaurants/:id", async (req, res) => {
  await db.query("DELETE FROM restaurants WHERE id=?", [req.params.id]);
  res.json({ success: true });
});

/* =========================
   MENU ITEMS CRUD
========================= */

// GET menu
router.get("/menu", async (req, res) => {
  const [rows] = await db.query(`
    SELECT m.*, r.name AS restaurant_name
    FROM menu_items m
    LEFT JOIN restaurants r ON m.restaurant_id = r.id
  `);
  res.json({ success: true, data: rows });
});

// ADD menu item (WITH IMAGE)
router.post(
  "/menu",
  upload.single("image"),
  async (req, res) => {
    const { restaurant_id, name, price, tags } = req.body;
    const image = req.file ? req.file.filename : null;

    // ── Validate required fields ──────────────────────────
    if (!restaurant_id || restaurant_id === '' || restaurant_id === 'undefined') {
      return res.status(400).json({ success: false, message: "Please select a restaurant" });
    }
    if (!name || name.trim() === '') {
      return res.status(400).json({ success: false, message: "Food name is required" });
    }
    if (!price || isNaN(price)) {
      return res.status(400).json({ success: false, message: "Valid price is required" });
    }

    // ── Check restaurant exists ───────────────────────────
    const [rest] = await db.query("SELECT id FROM restaurants WHERE id = ?", [restaurant_id]);
    if (!rest.length) {
      return res.status(400).json({ success: false, message: "Selected restaurant does not exist" });
    }

    await db.query(
      "INSERT INTO menu_items (restaurant_id, name, price, tags, image) VALUES (?, ?, ?, ?, ?)",
      [restaurant_id, name.trim(), price, tags || '', image]
    );

    // ✅ Auto-notify all users about the new menu item
    await notifyAll(
      `🍽 New dish available: ${name}!`,
      `${name} is now on the menu for £${price}.${tags ? " Tags: " + tags + "." : ""} Order now!`,
      "system"
    );

    res.json({ success: true, message: "Menu item saved!" });
  }
);

// UPDATE menu item (WITH IMAGE)
router.put(
  "/menu/:id",
  upload.single("image"),
  async (req, res) => {
    const { restaurant_id, name, price, tags } = req.body;
    const image = req.file ? req.file.filename : null;

    let sql = `
      UPDATE menu_items
      SET restaurant_id=?, name=?, price=?, tags=?
    `;
    const params = [restaurant_id, name, price, tags];

    if (image) {
      sql += ", image=?";
      params.push(image);
    }

    sql += " WHERE id=?";
    params.push(req.params.id);

    await db.query(sql, params);
    res.json({ success: true });
  }
);

// DELETE menu item
router.delete("/menu/:id", async (req, res) => {
  await db.query("DELETE FROM menu_items WHERE id=?", [req.params.id]);
  res.json({ success: true });
});

/* =========================
   USERS
========================= */

router.get("/users", async (req, res) => {
  const [rows] = await db.query(
    "SELECT id, name, email, diet_pref, role, created_at FROM users"
  );
  res.json({ success: true, data: rows });
});

router.delete("/users/:id", async (req, res) => {
  await db.query("DELETE FROM users WHERE id=?", [req.params.id]);
  res.json({ success: true });
});

/* =========================
   ORDERS
========================= */

router.get("/sales-summary", async (req, res) => {
  try {
    const [revenue] = await db.query("SELECT SUM(amount) as total FROM orders");
    const [orders]  = await db.query("SELECT COUNT(*) as total FROM orders");
    const [recent]  = await db.query("SELECT * FROM orders ORDER BY id DESC LIMIT 10");

    res.json({
      revenue: revenue[0].total || 0,
      orders:  orders[0].total  || 0,
      recent
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to load sales" });
  }
});

export default router;