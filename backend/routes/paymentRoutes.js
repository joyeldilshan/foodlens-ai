import express from "express";
import Stripe from "stripe";
import db from "../config/db.js";
import authMiddleware from "../middlewares/authMiddleware.js";
const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/* =========================
   CREATE CHECKOUT SESSION
========================= */
router.post(
  "/create-checkout-session",
  authMiddleware,   // 🔥 ADD THIS
  async (req, res) => {
  try {
    const { cart } = req.body;

    if (!cart || cart.length === 0) {
      return res.status(400).json({ message: "Cart is empty" });
    }

const session = await stripe.checkout.sessions.create({
  payment_method_types: ["card"],
  mode: "payment",
  line_items: cart.map(item => ({
    price_data: {
      currency: "gbp",
      product_data: {
        name: item.name,
      },
      unit_amount: Math.round(item.price * 100),
    },
    quantity: item.quantity,
  })),
  metadata: {
    user_id: req.user.id
  },
  success_url: `http://localhost:5000/success.html?session_id={CHECKOUT_SESSION_ID}`,
  cancel_url: "http://localhost:5000/user-dashboard.html",
});

router.get("/verify/:id", async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.retrieve(req.params.id);

    if (session.payment_status === "paid") {

      const userId = session.metadata.user_id || null;
      const amount = session.amount_total / 100;
      const paymentId = session.id;

      await db.query(
        "INSERT INTO orders (user_id, amount, payment_id) VALUES (?, ?, ?)",
        [userId, amount, paymentId]
      );

      return res.json({ success: true });
    }

    res.json({ success: false });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Verification failed" });
  }
});

    res.json({ url: session.url });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Stripe error" });
  }
});

export default router;