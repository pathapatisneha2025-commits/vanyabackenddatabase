const express = require("express");
const router = express.Router();
const pool = require("../db"); // PostgreSQL pool

/* ======================================================
   GET ALL ORDERS
====================================================== */
router.get("/all", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM vanyaorders ORDER BY created_at DESC
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
// router.get("/user/:email", async (req, res) => {
//   const { email } = req.params;
//   try {
//     const result = await pool.query(
//       "SELECT * FROM orders WHERE email=$1 ORDER BY created_at DESC",
//       [email]
//     );
//     res.json(result.rows);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: "Internal server error" });
//   }
// });

/* ======================================================
   GET SINGLE ORDER BY ID
====================================================== */
router.get("/:order_id", async (req, res) => {
  const { order_id } = req.params;
  try {
    const result = await pool.query(
      "SELECT * FROM vanyaorders WHERE id=$1",
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
   GET ORDERS BY USER ID
====================================================== */
/* ======================================================
   GET ORDERS BY USER ID
====================================================== */
router.get("/user/:user_id", async (req, res) => {
  const { user_id } = req.params;
  try {
    const result = await pool.query(
      "SELECT * FROM vanyaorders WHERE user_id = $1",
      [user_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});
/* ======================================================
   CREATE NEW ORDER
====================================================== */
router.post("/add", async (req, res) => {
  try {
    const {
      formData,
      cartItems,
      paymentMethod,
      totalAmount,
      user_id,
      paymentStatus
    } = req.body || {};

    if (!formData || !Array.isArray(cartItems) || cartItems.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid order data"
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const insertOrderQuery = `
        INSERT INTO vanyaorders
        (
          full_name,
          phone,
          email,
          pin_code,
          city,
          state,
          address,
          payment_method,
          total_amount,
          items,
          user_id,
          payment_status,
          order_status
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
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
        JSON.stringify(cartItems),
        user_id,
        paymentStatus || "pending",
        paymentMethod === "cod"
          ? "confirmed"
          : "payment_pending"
      ];

      const result = await client.query(
        insertOrderQuery,
        orderValues
      );

      const orderId = result.rows[0].id;

      if (user_id) {
        await client.query(
          `DELETE FROM cart_items WHERE user_id = $1`,
          [user_id]
        );
      }

      await client.query("COMMIT");

      return res.status(201).json({
        success: true,
        message:
          paymentMethod === "upi"
            ? "Payment proof submitted. Waiting for admin approval."
            : "Order placed successfully",
        orderId
      });

    } catch (err) {
      await client.query("ROLLBACK");
      console.error("ORDER INSERT ERROR:", err);

      return res.status(500).json({
        success: false,
        message: "Internal server error"
      });
    } finally {
      client.release();
    }

  } catch (err) {
    console.error("REQUEST ERROR:", err);

    return res.status(500).json({
      success: false,
      message: "Invalid request"
    });
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
      `UPDATE vanyaorders SET ${fields.join(", ")} WHERE id=$${idx} RETURNING *`,
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
    await pool.query("DELETE FROM vanyaorders WHERE id=$1", [order_id]);
    res.json({ message: "Order deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;