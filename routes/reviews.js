const express = require("express");
const router = express.Router();
const db = require("../db"); // adjust path if needed

// ✅ Get reviews for a product
router.get("/:productId", async (req, res) => {
  try {
    const { productId } = req.params;

    const reviews = await db.query(
      "SELECT * FROM reviews WHERE product_id = $1 ORDER BY created_at DESC",
      [productId]
    );

    res.json(reviews.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch reviews" });
  }
});

// ✅ Add review
router.post("/add", async (req, res) => {
  try {
    const { user_id, product_id, rating, comment } = req.body;

    const newReview = await db.query(
      "INSERT INTO vanayareviews (user_id, product_id, rating, comment) VALUES ($1,$2,$3,$4) RETURNING *",
      [user_id, product_id, rating, comment]
    );

    res.json(newReview.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to add review" });
  }
});

module.exports = router;