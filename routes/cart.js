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
        ci.quantity,
        p.id AS product_id,
        p.name,
        p.price,
        p.img_url,
        (ci.quantity * p.price) AS subtotal
      FROM cart_items ci
      JOIN vanayaproducts p ON ci.product_id = p.id
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
  const {
    user_id,
    product_id,
    quantity,
    colour,
    color,
    size,
    variant,
  } = req.body;

  if (!user_id || !product_id) {
    return res.status(400).json({
      error: "user_id and product_id are required",
    });
  }

  if (!quantity || Number(quantity) < 1) {
    return res.status(400).json({
      error: "Quantity must be at least 1",
    });
  }

  try {
    // ============================================================
    // SELECTED COLOUR / SIZE
    // ============================================================

    const selectedColour =
      colour ||
      color ||
      variant?.colour ||
      variant?.color ||
      null;

    const selectedSize =
      size ||
      variant?.size ||
      null;

    console.log("======================================");
    console.log("ADD TO CART");
    console.log("Product:", product_id);
    console.log("Colour:", selectedColour);
    console.log("Size:", selectedSize);
    console.log("Quantity:", quantity);
    console.log("======================================");

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
        error: "Product not found",
      });
    }

    const product = productRes.rows[0];

    // ============================================================
    // 2. GET VARIANTS
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
    // 3. FIND SELECTED COLOUR VARIANT
    // ============================================================

    let selectedVariant = null;

    if (selectedColour && variants.length > 0) {
      selectedVariant = variants.find(
        (item) =>
          String(item.colour || "")
            .trim()
            .toLowerCase() ===
          String(selectedColour)
            .trim()
            .toLowerCase()
      );
    }

    // ============================================================
    // 4. IF PRODUCT HAS VARIANTS
    // ============================================================

    if (variants.length > 0) {
      if (!selectedColour) {
        return res.status(400).json({
          error: "Please select a colour",
        });
      }

      if (!selectedVariant) {
        return res.status(400).json({
          error: `Colour "${selectedColour}" is not available`,
        });
      }

      console.log(
        "SELECTED VARIANT:",
        selectedVariant
      );
    }

    // ============================================================
    // 5. DETERMINE STOCK
    // ============================================================

    let availableStock = 0;

    if (selectedVariant) {
      // Variant stock
      availableStock = Number(
        selectedVariant.stock || 0
      );
    } else {
      // Product stock when there are no variants
      availableStock = Number(
        product.stock || 0
      );
    }

    console.log(
      "AVAILABLE STOCK:",
      availableStock
    );

    if (availableStock <= 0) {
      return res.status(400).json({
        error: selectedColour
          ? `${selectedColour} is out of stock`
          : "Product is out of stock",
      });
    }

    if (Number(quantity) > availableStock) {
      return res.status(400).json({
        error: `Only ${availableStock} item(s) available`,
      });
    }

    // ============================================================
    // 6. BUILD VARIANT DATA
    // ============================================================

    const variantData = selectedVariant
      ? {
          ...selectedVariant,

          colour: selectedVariant.colour,
          size: selectedSize || null,
        }
      : {
          colour: selectedColour || null,
          size: selectedSize || null,
        };

    // ============================================================
    // 7. CHECK EXISTING CART ITEM
    //
    // SAME PRODUCT + SAME COLOUR + SAME SIZE
    // ============================================================

    const existing = await pool.query(
      `
      SELECT *
      FROM cart_items
      WHERE user_id = $1
        AND product_id = $2
        AND LOWER(COALESCE(colour, '')) =
            LOWER(COALESCE($3, ''))
        AND LOWER(COALESCE(size, '')) =
            LOWER(COALESCE($4, ''))
      `,
      [
        user_id,
        product_id,
        selectedColour,
        selectedSize,
      ]
    );

    // ============================================================
    // 8. EXISTING CART ITEM
    // ============================================================

    if (existing.rows.length > 0) {
      const existingItem = existing.rows[0];

      const oldQuantity =
        Number(existingItem.quantity || 0);

      const newQuantity =
        oldQuantity + Number(quantity);

      if (newQuantity > availableStock) {
        return res.status(400).json({
          error: `Only ${availableStock} item(s) available for ${selectedColour || "this product"}`,
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
          JSON.stringify(variantData),
          existingItem.id,
        ]
      );

      // ==========================================================
      // REDUCE VARIANT STOCK
      // ==========================================================

      if (selectedVariant) {
        const updatedVariants = variants.map(
          (item) => {
            const sameColour =
              String(item.colour || "")
                .trim()
                .toLowerCase() ===
              String(selectedColour || "")
                .trim()
                .toLowerCase();

            if (!sameColour) {
              return item;
            }

            return {
              ...item,
              stock:
                Number(item.stock || 0) -
                Number(quantity),
            };
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
            product_id,
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
          [quantity, product_id]
        );
      }

      return res.json({
        success: true,
        message: "Cart quantity updated",
        item: updated.rows[0],
      });
    }

    // ============================================================
    // 9. INSERT NEW CART ITEM
    // ============================================================

    const newItem = await pool.query(
      `
      INSERT INTO cart_items
      (
        user_id,
        product_id,
        quantity,
        colour,
        size,
        variant
      )
      VALUES
      ($1, $2, $3, $4, $5, $6)
      RETURNING *
      `,
      [
        user_id,
        product_id,
        quantity,
        selectedColour,
        selectedSize,
        JSON.stringify(variantData),
      ]
    );

    // ============================================================
    // 10. REDUCE CORRECT STOCK
    // ============================================================

    if (selectedVariant) {
      const updatedVariants = variants.map(
        (item) => {
          const sameColour =
            String(item.colour || "")
              .trim()
              .toLowerCase() ===
            String(selectedColour || "")
              .trim()
              .toLowerCase();

          if (!sameColour) {
            return item;
          }

          return {
            ...item,
            stock:
              Number(item.stock || 0) -
              Number(quantity),
          };
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
          product_id,
        ]
      );
    } else {
      await pool.query(
        `
        UPDATE vanayaproducts
        SET stock = stock - $1
        WHERE id = $2
        `,
        [quantity, product_id]
      );
    }

    // ============================================================
    // 11. RESPONSE
    // ============================================================

    return res.json({
      success: true,
      message: "Item added to cart",
      item: newItem.rows[0],
    });

  } catch (err) {
    console.error(
      "ADD TO CART ERROR:",
      err
    );

    return res.status(500).json({
      error: "Internal server error",
      details: err.message,
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