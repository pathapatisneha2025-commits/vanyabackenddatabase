const express = require("express");
const router = express.Router();
const pool = require("../db"); // PostgreSQL pool

/* ======================================================
   GET CART ITEMS FOR A USER
====================================================== */
router.get("/:user_id", async (req, res) => {
  const { user_id } = req.params;
  try {
    const result = await pool.query(`
      SELECT 
        ci.id AS cart_id,
        ci.quantity,
        p.id AS product_id,
        p.name,
        p.price,
        p.img_url,
        (ci.quantity * p.price) AS subtotal
      FROM cart_items ci
      JOIN products p ON ci.product_id = p.id
      WHERE ci.user_id = $1
      ORDER BY ci.id ASC
    `, [user_id]);

    const cartItems = result.rows.map(row => ({
      id: row.cart_id,
      product_id: row.product_id,
      name: row.name,
      price: parseFloat(row.price),
      img_url: row.img_url,
      quantity: row.quantity,
      subtotal: parseFloat(row.subtotal)
    }));

    const total = cartItems.reduce((acc, item) => acc + item.subtotal, 0);

    res.json({ items: cartItems, total });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});
/* ======================================================
   GET ALL CART ITEMS (ALL USERS)
====================================================== */
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        ci.id AS cart_id,
        ci.user_id,
        ci.quantity,
        p.id AS product_id,
        p.name,
        p.price,
        p.img_url,
        (ci.quantity * p.price) AS subtotal
      FROM cart_items ci
      JOIN products p ON ci.product_id = p.id
      ORDER BY ci.id ASC
    `);

    const cartItems = result.rows.map(row => ({
      id: row.cart_id,
      user_id: row.user_id,
      product_id: row.product_id,
      name: row.name,
      price: parseFloat(row.price),
      img_url: row.img_url,
      quantity: row.quantity,
      subtotal: parseFloat(row.subtotal)
    }));

    res.json(cartItems);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ======================================================
   ADD ITEM TO CART
   - increments quantity if already exists
====================================================== */
router.post("/add", async (req, res) => {
  const { user_id, product_id, quantity } = req.body;
  if (!quantity || quantity < 1) return res.status(400).json({ error: "Quantity must be at least 1" });

  try {
    const existing = await pool.query(
      "SELECT * FROM cart_items WHERE user_id=$1 AND product_id=$2",
      [user_id, product_id]
    );

    if (existing.rows.length > 0) {
      const updated = await pool.query(
        "UPDATE cart_items SET quantity = quantity + $1, updated_at = NOW() WHERE user_id=$2 AND product_id=$3 RETURNING *",
        [quantity, user_id, product_id]
      );
      return res.json(updated.rows[0]);
    }

    const newItem = await pool.query(
      "INSERT INTO cart_items (user_id, product_id, quantity) VALUES ($1,$2,$3) RETURNING *",
      [user_id, product_id, quantity]
    );

    res.json(newItem.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ======================================================
   UPDATE CART ITEM QUANTITY
====================================================== */
router.put("/update/:cart_id", async (req, res) => {
  const { cart_id } = req.params;
  const { quantity } = req.body;
  if (!quantity || quantity < 1) return res.status(400).json({ error: "Quantity must be at least 1" });

  try {
    const result = await pool.query(
      "UPDATE cart_items SET quantity=$1, updated_at=NOW() WHERE id=$2 RETURNING *",
      [quantity, cart_id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ======================================================
   REMOVE ITEM FROM CART
====================================================== */
router.delete("/delete/:cart_id", async (req, res) => {
  const { cart_id } = req.params;
  try {
    await pool.query("DELETE FROM cart_items WHERE id=$1", [cart_id]);
    res.json({ message: "Item removed from cart" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;