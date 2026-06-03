import express from "express";
import db from "../config/db.js";
import authMiddleware from "../middlewares/authMiddleware.js";

const router = express.Router();

/* =============================
   GET DASHBOARD DATA
============================= */
router.get("/", authMiddleware, async (req, res) => {
  try {
    // User
    const [[user]] = await db.query(
      "SELECT id, name, email, diet_pref FROM users WHERE id=?",
      [req.user.id]
    );

    // Restaurants
    const [restaurants] = await db.query(
      "SELECT * FROM restaurants"
    );

    // AI recommended foods
    let query = `
      SELECT m.*, r.name AS restaurant_name
      FROM menu_items m
      JOIN restaurants r ON m.restaurant_id = r.id
    `;
    let params = [];

    if (user.diet_pref) {
      query += " WHERE m.tags LIKE ?";
      params.push(`%${user.diet_pref}%`);
    }

    const [recommended] = await db.query(query, params);

    res.json({
      success: true,
      user,
      restaurants,
      recommended
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

/* =============================
   GET MENU BY RESTAURANT
============================= */
router.get("/menu/:restaurantId", authMiddleware, async (req, res) => {
  const { restaurantId } = req.params;

  const [menu] = await db.query(
    "SELECT * FROM menu_items WHERE restaurant_id = ?",
    [restaurantId]
  );

  res.json(menu);
});

export default router;
