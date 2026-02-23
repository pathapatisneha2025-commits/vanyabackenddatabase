const express = require("express");
const router = express.Router();
const pool = require("../db"); // PostgreSQL pool

/* ======================================================
   GET ALL ORDERS
====================================================== */
router.get("/all", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM orders ORDER BY created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ======================================================
   GET ORDERS BY USER EMAIL
====================================================== */
router.get("/user/:email", async (req, res) => {
  const { email } = req.params;
  try {
    const result = await pool.query(
      "SELECT * FROM orders WHERE email=$1 ORDER BY created_at DESC",
      [email]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ======================================================
   GET SINGLE ORDER BY ID
====================================================== */
router.get("/:order_id", async (req, res) => {
  const { order_id } = req.params;
  try {
    const result = await pool.query(
      "SELECT * FROM orders WHERE id=$1",
      [order_id]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ message: "Order not found" });

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ======================================================
   CREATE NEW ORDER
====================================================== */
router.post("/add", async (req, res) => {
  const { formData, cartItems, paymentMethod, totalAmount, userId } = req.body;

  if (!formData || !cartItems || cartItems.length === 0) {
    return res.status(400).json({ message: "Invalid order data" });
  }

  try {
    // Insert the order
    const insertOrderQuery = `
      INSERT INTO orders
      (full_name, phone, email, pin_code, city, state, address, payment_method, total_amount, items)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING id
    `;
    const orderValues = [
      formData.fullName,
      formData.phone,
      formData.email,
      formData.pinCode,
      formData.city,
      formData.state,
      formData.address,
      paymentMethod,
      totalAmount,
      JSON.stringify(cartItems)
    ];

    const result = await pool.query(insertOrderQuery, orderValues);
    const orderId = result.rows[0].id;

    // Clear the cart for this user
    if (userId) {
      await pool.query(`DELETE FROM cart_items WHERE user_id = $1`, [userId]);
    }

    res.status(201).json({ message: "Order placed successfully", orderId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ======================================================
   UPDATE ORDER PAYMENT METHOD OR ADDRESS
====================================================== */
router.put("/update/:order_id", async (req, res) => {
  const { order_id } = req.params;
  const { paymentMethod, formData } = req.body;

  if (!paymentMethod && !formData) {
    return res.status(400).json({ message: "Nothing to update" });
  }

  try {
    const fields = [];
    const values = [];
    let idx = 1;

    if (formData) {
      for (const key of ['fullName','phone','email','pinCode','city','state','address']) {
        if (formData[key]) {
          fields.push(`${key === 'fullName' ? 'full_name' : key}=$${idx}`);
          values.push(formData[key]);
          idx++;
        }
      }
    }

    if (paymentMethod) {
      fields.push(`payment_method=$${idx}`);
      values.push(paymentMethod);
      idx++;
    }

    if (fields.length === 0) return res.status(400).json({ message: "Nothing to update" });

    values.push(order_id);

    const result = await pool.query(
      `UPDATE orders SET ${fields.join(", ")} WHERE id=$${idx} RETURNING *`,
      values
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ======================================================
   DELETE ORDER
====================================================== */
router.delete("/delete/:order_id", async (req, res) => {
  const { order_id } = req.params;
  try {
    await pool.query("DELETE FROM orders WHERE id=$1", [order_id]);
    res.json({ message: "Order deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;