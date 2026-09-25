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
        p.category,
        p.sub_category,
        p.price,
        p.img_url,

        (ci.quantity * p.price) AS subtotal

      FROM cart_items ci

      JOIN vanayaproducts p 
      ON ci.product_id = p.id

      WHERE ci.user_id = $1

      ORDER BY ci.id ASC

    `, [user_id]);


    const cartItems = result.rows.map(row => ({
      id: row.cart_id,

      // Product ID for product coupon
      product_id: row.product_id,

      name: row.name,

      // Category for category coupon
      category: row.category,

      sub_category: row.sub_category,

      price: Number(row.price),

      img_url: row.img_url,

      quantity: row.quantity,

      subtotal: Number(row.subtotal)
    }));


    const total = cartItems.reduce(
      (acc, item) => acc + item.subtotal,
      0
    );


    res.json({
      items: cartItems,
      total
    });


  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: "Internal server error"
    });

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
        ci.product_id,
        ci.quantity,

        p.name AS product_name,
        p.price AS product_price,
        p.img_url AS product_img_url,

        ci.variant

      FROM cart_items ci

      JOIN vanayaproducts p
        ON ci.product_id = p.id

      ORDER BY ci.id ASC
    `);

    const cartItems = result.rows.map((row) => {

      // =====================================================
      // VARIANT JSONB
      // =====================================================

      const variant =
        row.variant_data || {};

      // =====================================================
      // SELECTED VARIANT PRICE
      // =====================================================

      const price = Number(
        variant.price ??
        row.product_price ??
        0
      );

      // =====================================================
      // QUANTITY
      // =====================================================

      const quantity = Number(
        row.quantity || 0
      );

      // =====================================================
      // SELECTED VARIANT IMAGE
      // =====================================================

      const imgUrl =
        variant.mainImage ||
        variant.main_image ||
        variant.img_url ||
        variant.image ||
        variant.image_url ||
        row.product_img_url ||
        null;

      // =====================================================
      // RESPONSE
      // =====================================================

      return {
        id: row.cart_id,

        user_id: row.user_id,

        product_id: row.product_id,

        name: row.product_name,

        // ===================================================
        // COMPLETE SELECTED VARIANT
        // ===================================================

        variant: variant,

        // ===================================================
        // CONVENIENCE VALUES
        // ===================================================

        colour: variant.colour || null,

        size: variant.size || null,

        price: price,

        img_url: imgUrl,

        quantity: quantity,

        subtotal: price * quantity
      };
    });

    res.json(cartItems);

  } catch (err) {

    console.error(
      "GET CART ERROR:",
      err
    );

    res.status(500).json({
      error: "Internal server error",
      message: err.message
    });
  }
});
/* ======================================================
   ADD ITEM TO CART
   - increments quantity if already exists
====================================================== */
router.post("/add", async (req, res) => {
  const {
    user_id,
    product_id,
    quantity,
    variant
  } = req.body;

  if (!quantity || Number(quantity) < 1) {
    return res.status(400).json({
      error: "Quantity must be at least 1"
    });
  }

  try {
    // ============================================================
    // 1. GET PRODUCT
    // ============================================================

    const productRes = await pool.query(
      `
      SELECT *
      FROM vanayaproducts
      WHERE id = $1
      `,
      [product_id]
    );

    if (productRes.rows.length === 0) {
      return res.status(404).json({
        error: "Product not found"
      });
    }

    const product = productRes.rows[0];

    // ============================================================
    // 2. GET VARIANTS JSONB
    // ============================================================

    let variants = product.variants || [];

    if (typeof variants === "string") {
      try {
        variants = JSON.parse(variants);
      } catch (err) {
        variants = [];
      }
    }

    if (!Array.isArray(variants)) {
      variants = [];
    }

    // ============================================================
    // 3. SELECTED VARIANT FROM FRONTEND
    // ============================================================

    let selectedVariant = variant || null;

    // If variant is sent as a JSON string
    if (typeof selectedVariant === "string") {
      try {
        selectedVariant = JSON.parse(selectedVariant);
      } catch (err) {
        selectedVariant = null;
      }
    }

    // ============================================================
    // 4. FIND ACTUAL VARIANT FROM PRODUCT VARIANTS
    // ============================================================

    let productVariant = null;

    if (variants.length > 0) {

      if (!selectedVariant || !selectedVariant.colour) {
        return res.status(400).json({
          error: "Please select a colour"
        });
      }

      productVariant = variants.find(
        (item) =>
          String(item.colour || "")
            .trim()
            .toLowerCase() ===
          String(selectedVariant.colour || "")
            .trim()
            .toLowerCase()
      );

      if (!productVariant) {
        return res.status(400).json({
          error: "Selected colour is not available"
        });
      }
    }

    // ============================================================
    // 5. CHECK STOCK
    // ============================================================

    let currentStock;

    if (productVariant) {
      // Stock from selected JSONB variant
      currentStock = Number(productVariant.stock || 0);
    } else {
      // Normal product stock
      currentStock = Number(product.stock || 0);
    }

    if (currentStock < Number(quantity)) {
      return res.status(400).json({
        error: "Not enough stock"
      });
    }

    // ============================================================
    // 6. SAVE COMPLETE VARIANT JSONB
    // ============================================================

    const variantToSave = productVariant
      ? {
          ...productVariant,

          // Keep selected size if your frontend sends it
          size: selectedVariant?.size || null
        }
      : selectedVariant || null;

    // ============================================================
    // 7. CHECK EXISTING CART ITEMS
    // ============================================================

    const existingRes = await pool.query(
      `
      SELECT *
      FROM cart_items
      WHERE user_id = $1
        AND product_id = $2
      `,
      [user_id, product_id]
    );

    // ============================================================
    // 8. CHECK WHETHER SAME VARIANT ALREADY EXISTS
    // ============================================================

    let existingItem = null;

    if (existingRes.rows.length > 0) {
      existingItem = existingRes.rows.find((item) => {

        const oldVariant = item.variant || {};

        const oldColour = String(
          oldVariant.colour || ""
        )
          .trim()
          .toLowerCase();

        const newColour = String(
          variantToSave?.colour || ""
        )
          .trim()
          .toLowerCase();

        const oldSize = String(
          oldVariant.size || ""
        )
          .trim()
          .toLowerCase();

        const newSize = String(
          variantToSave?.size || ""
        )
          .trim()
          .toLowerCase();

        return (
          oldColour === newColour &&
          oldSize === newSize
        );
      });
    }

    // ============================================================
    // 9. UPDATE EXISTING SAME VARIANT
    // ============================================================

    if (existingItem) {

      const newQuantity =
        Number(existingItem.quantity || 0) +
        Number(quantity);

      if (newQuantity > currentStock) {
        return res.status(400).json({
          error: "Not enough stock"
        });
      }

      const updated = await pool.query(
        `
        UPDATE cart_items
        SET
          quantity = $1,
          variant = $2,
          updated_at = NOW()
        WHERE id = $3
        RETURNING *
        `,
        [
          newQuantity,
          JSON.stringify(variantToSave),
          existingItem.id
        ]
      );

      // ==========================================================
      // REDUCE VARIANT STOCK
      // ==========================================================

      if (productVariant) {

        const updatedVariants = variants.map(
          (item) => {

            if (
              String(item.colour || "")
                .trim()
                .toLowerCase() ===
              String(productVariant.colour || "")
                .trim()
                .toLowerCase()
            ) {
              return {
                ...item,
                stock:
                  Number(item.stock || 0) -
                  Number(quantity)
              };
            }

            return item;
          }
        );

        await pool.query(
          `
          UPDATE vanayaproducts
          SET variants = $1
          WHERE id = $2
          `,
          [
            JSON.stringify(updatedVariants),
            product_id
          ]
        );

      } else {

        // Normal product without variants
        await pool.query(
          `
          UPDATE vanayaproducts
          SET stock = stock - $1
          WHERE id = $2
          `,
          [
            quantity,
            product_id
          ]
        );
      }

      return res.json(updated.rows[0]);
    }

    // ============================================================
    // 10. INSERT NEW CART ITEM
    // ============================================================

    const newItem = await pool.query(
      `
      INSERT INTO cart_items
      (
        user_id,
        product_id,
        quantity,
        variant
      )
      VALUES
      ($1, $2, $3, $4::jsonb)
      RETURNING *
      `,
      [
        user_id,
        product_id,
        quantity,
        JSON.stringify(variantToSave)
      ]
    );

    // ============================================================
    // 11. REDUCE STOCK
    // ============================================================

    if (productVariant) {

      const updatedVariants = variants.map(
        (item) => {

          if (
            String(item.colour || "")
              .trim()
              .toLowerCase() ===
            String(productVariant.colour || "")
              .trim()
              .toLowerCase()
          ) {
            return {
              ...item,
              stock:
                Number(item.stock || 0) -
                Number(quantity)
            };
          }

          return item;
        }
      );

      await pool.query(
        `
        UPDATE vanayaproducts
        SET variants = $1
        WHERE id = $2
        `,
        [
          JSON.stringify(updatedVariants),
          product_id
        ]
      );

    } else {

      // Normal product without variants
      await pool.query(
        `
        UPDATE vanayaproducts
        SET stock = stock - $1
        WHERE id = $2
        `,
        [
          quantity,
          product_id
        ]
      );
    }

    // ============================================================
    // 12. RESPONSE
    // ============================================================

    return res.json({
      success: true,
      message: "Item added to cart",
      item: newItem.rows[0]
    });

  } catch (err) {

    console.error("ADD TO CART ERROR:", err);

    return res.status(500).json({
      error: "Internal server error",
      details: err.message
    });
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



// Admin adds a coupon
router.post("/add/coupons", async (req, res) => {
  const {
    code,
    discount_type,
    discount_value,
    apply_type,
    category_name,
    product_id,
    min_amount,
    expiry_date,
    is_active
  } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO vanyacoupons
      (code, discount_type, discount_value, apply_type, category_name, product_id, min_amount, expiry_date, is_active)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        code,
        discount_type,
        discount_value,
        apply_type,
        category_name || null,
        product_id || null,
        min_amount || 0,
        expiry_date || null,
        is_active !== undefined ? is_active : true
      ]
    );

    res.json({ success: true, coupon: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to add coupon" });
  }
});


router.post("/coupon/apply", async (req, res) => {
  const { code, cartItems, subtotal } = req.body;

  try {
    const [rows] = await db.query(
      "SELECT * FROM vanyacoupons WHERE code = ? AND is_active = TRUE",
      [code]
    );

    if (rows.length === 0) {
      return res.status(400).json({ message: "Invalid coupon code" });
    }

    const coupon = rows[0];

    // Expiry check
    if (coupon.expiry_date && new Date(coupon.expiry_date) < new Date()) {
      return res.status(400).json({ message: "Coupon expired" });
    }

    let eligibleAmount = subtotal;

    // CATEGORY COUPON
    if (coupon.apply_type === "category") {
      eligibleAmount = cartItems
        .filter(item => item.category === coupon.category_name)
        .reduce((acc, item) => acc + item.price * item.quantity, 0);

      if (eligibleAmount === 0) {
        return res.status(400).json({
          message: `Coupon valid only for ${coupon.category_name}`
        });
      }
    }

    // PRODUCT COUPON
    if (coupon.apply_type === "product") {
      eligibleAmount = cartItems
        .filter(item => item.id === coupon.product_id)
        .reduce((acc, item) => acc + item.price * item.quantity, 0);

      if (eligibleAmount === 0) {
        return res.status(400).json({
          message: "Coupon not valid for selected products"
        });
      }
    }

    // Minimum amount check
    if (eligibleAmount < coupon.min_amount) {
      return res.status(400).json({
        message: `Minimum ₹${coupon.min_amount} required`
      });
    }

    let discount = 0;

    if (coupon.discount_type === "percentage") {
      discount = (eligibleAmount * coupon.discount_value) / 100;
    } else {
      discount = coupon.discount_value;
    }

    const finalTotal = subtotal - discount;

    res.json({
      success: true,
      discount,
      finalTotal
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/coupons/all", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM vanyacoupons ORDER BY id DESC");
    res.json({ success: true, coupons: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to fetch coupons" });
  }
});

module.exports = router;