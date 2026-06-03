import express from "express";
import db from "../config/db.js";
import authMiddleware from "../middlewares/authMiddleware.js";

const router = express.Router();

// All routes — admin only
router.use(authMiddleware, (req, res, next) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ success: false, message: "Admin access required" });
  }
  next();
});

/* =============================================
   GET /api/analytics
   Full analytics data for the admin dashboard:
   - totalRevenue, totalOrders, totalUsers
   - dailyRevenue (last 30 days)
   - topItems    (top 5 by qty ordered)
   - userGrowth  (last 90 days)
============================================= */
router.get("/", async (req, res) => {
  try {

    // ── Total revenue & orders ──────────────────
    const [[revRow]] = await db.query(
      "SELECT COALESCE(SUM(amount),0) AS revenue, COUNT(*) AS orders FROM orders WHERE amount IS NOT NULL"
    );

    // ── Total users ─────────────────────────────
    const [[usersRow]] = await db.query(
      "SELECT COUNT(*) AS total FROM users WHERE role = 'user'"
    );

    // ── Daily revenue — last 30 days ────────────
    const [dailyRevenue] = await db.query(`
      SELECT
        DATE(created_at)                    AS date,
        COALESCE(SUM(amount), 0)            AS revenue
      FROM orders
      WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        AND amount IS NOT NULL
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `);

    // Fill missing days with 0 so the chart has no gaps
    const filledRevenue = fillMissingDays(dailyRevenue, 30, "revenue");

    // ── Top 5 selling items ──────────────────────
    // Try order_items table first, fall back to menu_items
    let topItems = [];
    try {
      const [rows] = await db.query(`
        SELECT
          COALESCE(oi.name, m.name) AS name,
          SUM(oi.quantity)          AS total_qty
        FROM order_items oi
        LEFT JOIN menu_items m ON m.id = oi.menu_item_id
        GROUP BY COALESCE(oi.name, m.name)
        ORDER BY total_qty DESC
        LIMIT 5
      `);
      topItems = rows;
    } catch (_) {
      // order_items may not have name column yet — use menu_items directly
      const [rows] = await db.query(`
        SELECT name, 0 AS total_qty FROM menu_items LIMIT 5
      `);
      topItems = rows;
    }

    // ── User growth — last 90 days ───────────────
    const [userGrowthRaw] = await db.query(`
      SELECT
        DATE(created_at) AS date,
        COUNT(*)         AS count
      FROM users
      WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `);

    const userGrowth = fillMissingDays(userGrowthRaw, 90, "count");

    res.json({
      success:      true,
      totalRevenue: parseFloat(revRow.revenue) || 0,
      totalOrders:  parseInt(revRow.orders)    || 0,
      totalUsers:   parseInt(usersRow.total)   || 0,
      dailyRevenue: filledRevenue,
      topItems,
      userGrowth
    });

  } catch (err) {
    console.error("ANALYTICS ERROR:", err);
    res.status(500).json({ success: false, message: "Analytics error", error: err.message });
  }
});

/* =============================================
   Helper: fill missing days in date series
   so Chart.js lines have no sudden gaps
============================================= */
function fillMissingDays(rows, daysBack, valueKey) {
  const map = {};
  rows.forEach(r => {
    const key = new Date(r.date).toISOString().split("T")[0];
    map[key] = parseFloat(r[valueKey]) || 0;
  });

  const result = [];
  for (let i = daysBack - 1; i >= 0; i--) {
    const d   = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().split("T")[0];
    const label = d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    result.push({ date: label, [valueKey]: map[key] || 0 });
  }
  return result;
}

export default router;

/* =============================================
   ADD TO YOUR server.js / app.js:

   import analyticsRoutes from "./routes/analyticsRoutes.js";
   app.use("/api/analytics", analyticsRoutes);
============================================= */