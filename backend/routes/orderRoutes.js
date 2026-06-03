import express from "express";
import db from "../config/db.js";
import authMiddleware from "../middlewares/authMiddleware.js";


const router = express.Router();

/* =============================================
   DB SETUP — run this SQL once in your DB:
   =============================================

   ALTER TABLE orders
     ADD COLUMN IF NOT EXISTS status VARCHAR(20)  NOT NULL DEFAULT 'placed',
     ADD COLUMN IF NOT EXISTS eta    INT           DEFAULT 30,
     ADD COLUMN IF NOT EXISTS address VARCHAR(255) DEFAULT NULL,
     ADD COLUMN IF NOT EXISTS phone  VARCHAR(50)   DEFAULT NULL,
     ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50) DEFAULT 'Online',
     ADD COLUMN IF NOT EXISTS step_times JSON     DEFAULT NULL;

   -- step_times stores timestamps for each step:
   -- {"placed":"2026-03-15T10:00:00","preparing":"...","on_the_way":"...","delivered":"..."}

============================================= */

const VALID_STATUSES = ["placed","preparing","on_the_way","delivered","cancelled"];

/* =============================================
   GET /api/orders/:id/track
   Get full order tracking info (user + admin)
============================================= */
router.get("/:id/track", authMiddleware, async (req, res) => {
  try {
    const orderId = req.params.id;
    const userId  = req.user.id;
    const isAdmin = req.user.role === "admin";

    // Fetch order — users can only see their own
    const [orders] = await db.query(
      `SELECT o.*,
              u.name  AS user_name,
              u.email AS user_email
       FROM orders o
       LEFT JOIN users u ON u.id = o.user_id
       WHERE o.id = ?
       ${isAdmin ? "" : "AND o.user_id = ?"}`,
      isAdmin ? [orderId] : [orderId, userId]
    );

    if (!orders.length) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    const order = orders[0];

    // Fetch order items with menu details
    let items = [];
    try {
      const [rows] = await db.query(
        `SELECT oi.quantity, oi.price,
                m.name, m.image
         FROM order_items oi
         LEFT JOIN menu_items m ON m.id = oi.menu_item_id
         WHERE oi.order_id = ?`,
        [orderId]
      );
      items = rows;
    } catch (_) {
      // order_items table may not exist yet
    }

    // Parse step_times from JSON string if needed
    let stepTimes = {};
    try {
      stepTimes = typeof order.step_times === "string"
        ? JSON.parse(order.step_times)
        : order.step_times || {};
    } catch (_) {}

    // Calculate ETA based on status
    const etaMap = { placed: 35, preparing: 25, on_the_way: 10, delivered: 0, cancelled: 0 };
    const eta = order.eta ?? etaMap[order.status] ?? 30;

    res.json({
      success:        true,
      id:             order.id,
      status:         order.status || "placed",
      eta,
      address:        order.address        || null,
      phone:          order.phone          || null,
      payment_method: order.payment_method || "Online",
      created_at:     order.created_at,
      user_name:      order.user_name,
      user_email:     order.user_email,
      step_times:     stepTimes,
      items
    });

  } catch (err) {
    console.error("TRACK ORDER ERROR:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/* =============================================
   GET /api/orders/my
   Get all orders for the logged-in user
============================================= */
router.get("/my", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    const [orders] = await db.query(
      `SELECT id, status, eta, address, amount, created_at,
              (SELECT SUM(oi.price * oi.quantity)
               FROM order_items oi WHERE oi.order_id = orders.id) AS total
       FROM orders
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 20`,
      [userId]
    );

    // Attach items to each order
    for (const order of orders) {
      try {
        const [items] = await db.query(
          `SELECT oi.quantity, oi.price,
                  COALESCE(oi.name, m.name)   AS name,
                  COALESCE(oi.image, m.image) AS image
           FROM order_items oi
           LEFT JOIN menu_items m ON m.id = oi.menu_item_id
           WHERE oi.order_id = ?`,
          [order.id]
        );
        order.items = items;
      } catch(_) {
        order.items = [];
      }
    }

    res.json({ success: true, orders });

  } catch (err) {
    console.error("MY ORDERS ERROR:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/* =============================================
   PUT /api/orders/:id/status
   Update order status — admin only
============================================= */
router.put("/:id/status", authMiddleware, async (req, res) => {
  try {
    const orderId = req.params.id;
    const isAdmin = req.user.role === "admin";
    const { status } = req.body;

    if (!isAdmin) {
      return res.status(403).json({ success: false, message: "Admin access required" });
    }

    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}`
      });
    }

    // Check order exists
    const [orders] = await db.query("SELECT * FROM orders WHERE id = ?", [orderId]);
    if (!orders.length) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    const order = orders[0];

    // Update step_times — record timestamp when each step is reached
    let stepTimes = {};
    try {
      stepTimes = typeof order.step_times === "string"
        ? JSON.parse(order.step_times)
        : order.step_times || {};
    } catch (_) {}

    if (!stepTimes[status]) {
      stepTimes[status] = new Date().toISOString();
    }

    // Calculate new ETA
    const etaMap = { placed: 35, preparing: 25, on_the_way: 10, delivered: 0, cancelled: 0 };
    const newEta = etaMap[status] ?? 30;

    await db.query(
      "UPDATE orders SET status = ?, eta = ?, step_times = ? WHERE id = ?",
      [status, newEta, JSON.stringify(stepTimes), orderId]
    );

    // Fetch updated order with items for response
    const [updated] = await db.query(
      `SELECT o.*, u.name AS user_name FROM orders o
       LEFT JOIN users u ON u.id = o.user_id
       WHERE o.id = ?`,
      [orderId]
    );

    let items = [];
    try {
      const [rows] = await db.query(
        `SELECT oi.quantity, oi.price, m.name, m.image
         FROM order_items oi
         LEFT JOIN menu_items m ON m.id = oi.menu_item_id
         WHERE oi.order_id = ?`,
        [orderId]
      );
      items = rows;
    } catch (_) {}

    const updatedOrder = updated[0];
    let parsedStepTimes = {};
    try {
      parsedStepTimes = typeof updatedOrder.step_times === "string"
        ? JSON.parse(updatedOrder.step_times)
        : updatedOrder.step_times || {};
    } catch (_) {}

    res.json({
      success: true,
      message: `Order status updated to: ${status}`,
      order: {
        id:             updatedOrder.id,
        status:         updatedOrder.status,
        eta:            newEta,
        address:        updatedOrder.address        || null,
        phone:          updatedOrder.phone          || null,
        payment_method: updatedOrder.payment_method || "Online",
        created_at:     updatedOrder.created_at,
        user_name:      updatedOrder.user_name,
        step_times:     parsedStepTimes,
        items
      }
    });

  } catch (err) {
    console.error("UPDATE STATUS ERROR:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/* =============================================
   GET /api/orders/all  (admin only)
   List all orders with status for admin panel
============================================= */
router.get("/all", authMiddleware, async (req, res) => {
  try {
    const isAdmin = req.user.role === "admin";
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: "Admin access required" });
    }

    const [orders] = await db.query(
      `SELECT o.id, o.status, o.eta, o.created_at,
              u.name AS user_name,
              (SELECT SUM(oi.price * oi.quantity)
               FROM order_items oi WHERE oi.order_id = o.id) AS total
       FROM orders o
       LEFT JOIN users u ON u.id = o.user_id
       ORDER BY o.created_at DESC
       LIMIT 50`
    );

    res.json({ success: true, orders });

  } catch (err) {
    console.error("ALL ORDERS ERROR:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

export default router;

/* =============================================
   ADD TO YOUR server.js / app.js:

   import orderRoutes from "./routes/orderRoutes.js";
   app.use("/api/orders", orderRoutes);

   =============================================
   ALSO: When a user checks out via Stripe,
   save the order to DB with status = "placed":

   await db.query(
     `INSERT INTO orders
       (user_id, status, eta, address, phone, payment_method, step_times)
      VALUES (?, 'placed', 35, ?, ?, 'Stripe', ?)`,
     [userId, address, phone, JSON.stringify({ placed: new Date().toISOString() })]
   );
============================================= */