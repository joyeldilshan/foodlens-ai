import express from "express";
import db from "../config/db.js";
import authMiddleware from "../middlewares/authMiddleware.js";

const router = express.Router();

// Lazy-load Anthropic
let anthropicClient = null;
async function getClient() {
  if (!anthropicClient) {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return anthropicClient;
}

/* ============================================================
   HELPER — Build a rich system prompt personalised per user
============================================================ */
async function buildSystemPrompt(userId) {
  try {
    // Get user profile
    const [[user]] = await db.query(
      "SELECT name, diet_pref FROM users WHERE id = ?",
      [userId]
    );

    // Get user's past orders (last 10)
    const [orders] = await db.query(
      `SELECT oi.name, oi.price, COUNT(*) as times_ordered
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE o.user_id = ?
       GROUP BY oi.name, oi.price
       ORDER BY times_ordered DESC
       LIMIT 10`,
      [userId]
    );

    // Get available menu items
    const [menu] = await db.query(
      `SELECT m.name, m.price, m.tags, r.name AS restaurant
       FROM menu_items m
       LEFT JOIN restaurants r ON r.id = m.restaurant_id
       ORDER BY r.name, m.name
       LIMIT 50`
    );

    // Get available restaurants
    const [restaurants] = await db.query(
      "SELECT name, description FROM restaurants LIMIT 20"
    );

    // Format menu into readable text
    const menuText = menu.length
      ? menu.map(m => `• ${m.name} — £${m.price}${m.tags ? ` (${m.tags})` : ""} @ ${m.restaurant}`).join("\n")
      : "Menu is currently being updated.";

    const restaurantText = restaurants.length
      ? restaurants.map(r => `• ${r.name}: ${r.description}`).join("\n")
      : "No restaurants listed yet.";

    const orderHistory = orders.length
      ? orders.map(o => `• ${o.name} (ordered ${o.times_ordered}x)`).join("\n")
      : "No order history yet — this might be a new user.";

    const userName  = user?.name?.split(" ")[0] || "there";
    const dietPref  = user?.diet_pref || "no specific preference";

    return `You are Lens, the friendly and intelligent personal food assistant for FoodLens AI.
You are speaking with ${userName}, whose dietary preference is: ${dietPref}.

YOUR PERSONALITY:
- Warm, enthusiastic, and genuinely helpful
- You remember the user's preferences and order history
- You give specific, actionable food recommendations
- You use emojis naturally but not excessively
- You're knowledgeable about nutrition, cuisines, and food culture
- You can suggest dishes based on mood, health goals, or cravings

USER'S ORDER HISTORY (what they love):
${orderHistory}

AVAILABLE RESTAURANTS:
${restaurantText}

AVAILABLE MENU ITEMS:
${menuText}

YOUR CAPABILITIES:
1. RECOMMEND dishes from our menu based on mood, diet, cravings, or health goals
2. ANSWER questions about any food (nutrition, calories, ingredients, how it's made)
3. ANALYSE food images — identify dishes, estimate calories and macros, give health scores
4. SUGGEST meals based on dietary preference (${dietPref})
5. REMEMBER past orders and suggest favourites or new items the user might enjoy
6. HELP users build a balanced meal — starter + main + dessert combinations
7. EXPLAIN allergens, dietary info, and spice levels of dishes

IMPORTANT RULES:
- Only recommend items that are actually on the menu above
- When recommending, always mention the price
- If a user asks about a dish not on the menu, acknowledge it and suggest the closest alternative
- Keep responses concise (2-4 sentences max) unless the user asks for detail
- If analysing an image, always give: dish name, estimated calories, protein/carbs/fat breakdown, and a health score /10
- Never make up menu items or prices

Start every NEW conversation with a warm greeting using the user's name.`;

  } catch (err) {
    console.error("buildSystemPrompt error:", err);
    return `You are Lens, a friendly personal food assistant for FoodLens AI. 
Help users discover great food, answer nutrition questions, and analyse food images. 
Be warm, concise, and helpful.`;
  }
}

/* ============================================================
   POST /api/ai/chat
   Main chat endpoint — streams response
============================================================ */
router.post("/chat", authMiddleware, async (req, res) => {
  try {
    const userId  = req.user.id;
    const { messages, stream = false } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ success: false, message: "messages array required" });
    }

    // Build personalised system prompt
    const systemPrompt = await buildSystemPrompt(userId);

    // Save user message to DB for history
    const lastMessage = messages[messages.length - 1];
    const userText = Array.isArray(lastMessage?.content)
      ? lastMessage.content.find(c => c.type === "text")?.text || ""
      : lastMessage?.content || "";

    if (userText) {
      await db.query(
        "INSERT INTO chat_history (user_id, role, message) VALUES (?, 'user', ?) ON DUPLICATE KEY UPDATE message=message",
        [userId, userText.substring(0, 500)]
      ).catch(() => {}); // Non-critical — table may not exist yet
    }

    // Call Anthropic API
    const client = await getClient();
    const response = await client.messages.create({
      model:      "claude-sonnet-4-6",
      max_tokens: 1024,
      system:     systemPrompt,
      messages:   messages,
    });

    const assistantText = response.content
      .filter(b => b.type === "text")
      .map(b => b.text)
      .join("");

    // Save assistant response
    if (assistantText) {
      await db.query(
        "INSERT INTO chat_history (user_id, role, message) VALUES (?, 'assistant', ?) ON DUPLICATE KEY UPDATE message=message",
        [userId, assistantText.substring(0, 500)]
      ).catch(() => {});
    }

    res.json({
      success: true,
      message: assistantText,
      usage:   response.usage,
    });

  } catch (err) {
    console.error("AI CHAT ERROR:", err);

    // Return a friendly error instead of crashing
    if (err.status === 401) {
      return res.status(401).json({ success: false, message: "Invalid Anthropic API key. Check your .env file." });
    }
    if (err.status === 429) {
      return res.status(429).json({ success: false, message: "AI is busy right now. Please try again in a moment." });
    }

    res.status(500).json({
      success: false,
      message: "AI chat error: " + err.message
    });
  }
});

/* ============================================================
   GET /api/ai/suggest
   Quick mood-based suggestions from real menu
============================================================ */
router.get("/suggest", authMiddleware, async (req, res) => {
  try {
    const { mood = "happy" } = req.query;
    const userId = req.user.id;

    // Get user's diet preference
    const [[user]] = await db.query(
      "SELECT diet_pref FROM users WHERE id = ?", [userId]
    );
    const diet = user?.diet_pref || "";

    // Map moods to tags
    const moodTagMap = {
      happy:    ["Veg", "Sweet", "Dessert", "Grilled"],
      tired:    ["Comfort", "Soup", "Rice", "Warm"],
      stressed: ["Spicy", "BBQ", "Burger", "Fried"],
      hungry:   ["Biryani", "Kottu", "Large", "Filling"],
      healthy:  ["Salad", "Veg", "Grilled", "Low-Cal"],
    };

    const tags = moodTagMap[mood] || moodTagMap.happy;

    // Build query — match by tags or diet preference
    let query = `
      SELECT m.id, m.name, m.price, m.tags, m.image, r.name AS restaurant
      FROM menu_items m
      LEFT JOIN restaurants r ON r.id = m.restaurant_id
      WHERE 1=1
    `;
    const params = [];

    if (tags.length) {
      const tagConditions = tags.map(() => "m.tags LIKE ?").join(" OR ");
      query += ` AND (${tagConditions})`;
      tags.forEach(t => params.push(`%${t}%`));
    }

    if (diet && diet !== "Any") {
      query += " AND m.tags LIKE ?";
      params.push(`%${diet}%`);
    }

    query += " ORDER BY RAND() LIMIT 4";

    const [items] = await db.query(query, params);

    // Fallback — if no matches, return random items
    if (!items.length) {
      const [fallback] = await db.query(
        "SELECT m.id, m.name, m.price, m.tags, m.image, r.name AS restaurant FROM menu_items m LEFT JOIN restaurants r ON r.id = m.restaurant_id ORDER BY RAND() LIMIT 4"
      );
      return res.json({ success: true, items: fallback, mood });
    }

    res.json({ success: true, items, mood });

  } catch (err) {
    console.error("SUGGEST ERROR:", err);
    res.status(500).json({ success: false, message: "Suggestion error" });
  }
});

/* ============================================================
   GET /api/ai/history
   Get user's recent chat context (last 5 messages)
============================================================ */
router.get("/history", authMiddleware, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT role, message, created_at FROM chat_history
       WHERE user_id = ?
       ORDER BY created_at DESC LIMIT 10`,
      [req.user.id]
    );
    res.json({ success: true, history: rows.reverse() });
  } catch (err) {
    // Table might not exist yet
    res.json({ success: true, history: [] });
  }
});

/* ============================================================
   SQL — run once in phpMyAdmin to enable chat history:

   CREATE TABLE IF NOT EXISTS chat_history (
     id         INT AUTO_INCREMENT PRIMARY KEY,
     user_id    INT NOT NULL,
     role       VARCHAR(20) NOT NULL DEFAULT 'user',
     message    TEXT NOT NULL,
     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
   );
============================================================ */


/* ============================================================
   GET /api/ai/recommend  (legacy alias for /suggest)
   Keeps backward compatibility with old frontend code
============================================================ */
router.get("/recommend", authMiddleware, async (req, res) => {
  try {
    const { mood = "happy" } = req.query;
    const userId = req.user.id;
    const [[user]] = await db.query("SELECT diet_pref FROM users WHERE id = ?", [userId]);
    const diet = user?.diet_pref || "";
    const moodTagMap = {
      happy:["Veg","Sweet","Dessert","Grilled"], tired:["Comfort","Soup","Rice","Warm"],
      stressed:["Spicy","BBQ","Burger","Fried"], hungry:["Biryani","Kottu","Large","Filling"],
      healthy:["Salad","Veg","Grilled","Low-Cal"]
    };
    const tags = moodTagMap[mood] || moodTagMap.happy;
    let query = "SELECT m.id, m.name, m.price, m.tags, m.image, r.name AS restaurant FROM menu_items m LEFT JOIN restaurants r ON r.id = m.restaurant_id WHERE 1=1";
    const params = [];
    if (tags.length) {
      query += " AND (" + tags.map(() => "m.tags LIKE ?").join(" OR ") + ")";
      tags.forEach(t => params.push(`%${t}%`));
    }
    query += " ORDER BY RAND() LIMIT 1";
    const [items] = await db.query(query, params);
    if (!items.length) {
      const [fallback] = await db.query("SELECT m.id, m.name, m.price, m.tags, m.image, r.name AS restaurant FROM menu_items m LEFT JOIN restaurants r ON r.id = m.restaurant_id ORDER BY RAND() LIMIT 1");
      return res.json({ success: true, data: fallback[0] || null });
    }
    res.json({ success: true, data: items[0] });
  } catch(err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;