const express = require("express");
const router = express.Router();
const db = require("../db"); // adjust path if needed

// ✅ Get all contact messages (optional, for admin view)
router.get("/all", async (req, res) => {
  try {
    const messages = await db.query(
      "SELECT * FROM contact_messages ORDER BY created_at DESC"
    );
    res.json(messages.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch contact messages" });
  }
});

// ✅ Add a new contact message
router.post("/add", async (req, res) => {
  try {
    const { name, email, phone, subject, message } = req.body;

    if (!name || !email || !message) {
      return res.status(400).json({ error: "Name, email, and message are required." });
    }

    const newMessage = await db.query(
      `INSERT INTO contact_messages (name, email, phone, subject, message)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name, email, phone, subject, message]
    );

    res.json(newMessage.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to add contact message" });
  }
});

module.exports = router;