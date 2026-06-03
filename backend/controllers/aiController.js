import db from "../config/db.js";

const moodTags = {
  tired: ["healthy", "light"],
  stressed: ["comfort"],
  happy: ["special"]
};

export const recommendFood = async (req, res) => {
  const { mood } = req.params;

  if (!moodTags[mood]) return res.status(400).json({ message: "Invalid mood" });

  const tags = moodTags[mood];
  const conditions = tags.map(tag => `tags LIKE '%${tag}%'`).join(" OR ");
  const sql = `SELECT * FROM menu_items WHERE ${conditions}`;

  try {
    const [foods] = await db.query(sql);
    res.json(foods);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
