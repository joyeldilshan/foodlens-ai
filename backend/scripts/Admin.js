import bcrypt from "bcryptjs";
import db from "../config/db.js";

async function createAdmin() {
  try {
    const password = "Jack@200014"; // Admin password
    const hashedPassword = await bcrypt.hash(password, 10);

    await db.query(
      "INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)",
      ["Admin User", "jack@gmail.com", hashedPassword, "admin"]
    );

    console.log("✅ Admin account created!");
    console.log("Email: admin@example.com | Password: admin123");
    process.exit();
  } catch (err) {
    console.error("Error creating admin:", err);
  }
}

createAdmin();
