const express = require("express");
const router = express.Router();
const pool = require("../db"); // PostgreSQL pool

/* ======================================================
   GET CART ITEMS FOR A USER
====================================================== */

/* ======================================================
   GET CART ITEMS FOR A SPECIFIC USER
====================================================== */
router.get("/:user_id", async (req, res) => {
  const { user_id } = req.params;

  try {
    const result = await pool.query(
      `
      SELECT 
        ci.id AS cart_id,
        ci.user_id,
        ci.quantity,

        p.id AS product_id,
        p.name,
        p.category,
        p.sub_category,
        p.price AS product_price,
        p.img_url AS product_img_url,

        -- SELECTED VARIANT
        ci.variant

      FROM cart_items ci

      JOIN vanayaproducts p
        ON ci.product_id = p.id

      WHERE ci.user_id = $1

      ORDER BY ci.id ASC
      `,
      [user_id]
    );

    // ======================================================
    // FORMAT CART ITEMS
    // ======================================================

    const cartItems = result.rows.map((row) => {

      // ====================================================
      // VARIANT JSONB
      // ====================================================

      const variant =
        row.variant &&
        typeof row.variant === "object"
          ? row.variant
          : {};

      // ====================================================
      // SELECTED VARIANT PRICE
      // ====================================================

      const price = Number(
        variant.price ??
        row.product_price ??
        0
      );

      // ====================================================
      // QUANTITY
      // ====================================================

      const quantity = Number(
        row.quantity || 0
      );

      // ====================================================
      // SELECTED VARIANT IMAGE
      // ====================================================

      const imgUrl =
        variant.mainImage ||
        variant.main_image ||
        variant.img_url ||
        variant.image ||
        variant.image_url ||
        row.product_img_url ||
        null;

      // ====================================================
      // COLOUR
      // ====================================================

      const colour =
        variant.colour ??
        variant.color ??
        null;

      // ====================================================
      // SIZE
      // ====================================================

      const size =
        variant.size ??
        null;

      // ====================================================
      // OLD PRICE
      // ====================================================

      const oldPrice =
        variant.oldPrice ??
        variant.old_price ??
        null;

      // ====================================================
      // DISCOUNT
      // ====================================================

      const discount =
        variant.discount ??
        null;

      // ====================================================
      // STOCK
      // ====================================================

      const stock =
        variant.stock ??
        null;

      // ====================================================
      // SUBTOTAL
      // ====================================================

      const subtotal =
        price * quantity;

      // ====================================================
      // RESPONSE
      // ====================================================

      return {

        // Cart row ID
        id: row.cart_id,

        // User ID
        user_id: row.user_id,

        // Product ID
        product_id: row.product_id,

        // Product information
        name: row.name,

        category: row.category,

        sub_category: row.sub_category,

        // ==================================================
        // COMPLETE SELECTED VARIANT
        // ==================================================

        variant: variant,

        // ==================================================
        // SELECTED VARIANT DETAILS
        // ==================================================

        colour: colour,

        size: size,

        price: price,

        oldPrice:
          oldPrice !== null
            ? Number(oldPrice)
            : null,

        discount:
          discount !== null
            ? Number(discount)
            : null,

        stock:
          stock !== null
            ? Number(stock)
            : null,

        // ==================================================
        // IMAGE
        // ==================================================

        img_url: imgUrl,

        // ==================================================
        // QUANTITY
        // ==================================================

        quantity: quantity,

        // ==================================================
        // SUBTOTAL
        // ==================================================

        subtotal: subtotal
      };
    });

    // ======================================================
    // TOTAL
    // ======================================================

    const total = cartItems.reduce(
      (acc, item) =>
        acc + Number(item.subtotal || 0),
      0
    );

    // ======================================================
    // RESPONSE
    // ======================================================

    res.json({
      items: cartItems,
      total: total
    });

  } catch (err) {

    console.error(
      "GET USER CART ERROR:",
      err
    );

    res.status(500).json({
      error: "Internal server error",
      message: err.message
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
        row.variant || {};

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

  const requestedQuantity = Number(quantity);

  if (!requestedQuantity || requestedQuantity < 1) {
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
    // 2. GET PRODUCT VARIANTS
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
    // 3. PARSE SELECTED VARIANT FROM FRONTEND
    // ============================================================

    let selectedVariant = variant || null;

    if (typeof selectedVariant === "string") {
      try {
        selectedVariant = JSON.parse(selectedVariant);
      } catch (err) {
        selectedVariant = null;
      }
    }

    // ============================================================
    // 4. FIND ACTUAL VARIANT FROM DATABASE
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
    // 5. FIND SELECTED SIZE
    // ============================================================

    let selectedSizeData = null;

    if (
      productVariant &&
      Array.isArray(productVariant.sizes) &&
      productVariant.sizes.length > 0
    ) {
      if (!selectedVariant?.size) {
        return res.status(400).json({
          error: "Please select a size"
        });
      }

      selectedSizeData =
        productVariant.sizes.find(
          (sizeItem) =>
            String(sizeItem.size || "")
              .trim()
              .toLowerCase() ===
            String(selectedVariant.size || "")
              .trim()
              .toLowerCase()
        ) || null;

      if (!selectedSizeData) {
        return res.status(400).json({
          error: "Selected size is not available"
        });
      }
    }

    // ============================================================
    // 6. GET ACTUAL STOCK FROM DATABASE
    // ============================================================

    let currentStock = 0;

    // ------------------------------------------------------------
    // DRESS MATERIAL / SIZE BASED VARIANT
    // ------------------------------------------------------------

    if (selectedSizeData) {
      currentStock = Number(
        selectedSizeData.stock || 0
      );
    }

    // ------------------------------------------------------------
    // NORMAL COLOUR VARIANT
    // ------------------------------------------------------------

    else if (productVariant) {
      currentStock = Number(
        productVariant.stock ??
        product.stock ??
        0
      );
    }

    // ------------------------------------------------------------
    // NORMAL PRODUCT WITHOUT VARIANT
    // ------------------------------------------------------------

    else {
      currentStock = Number(
        product.stock || 0
      );
    }

    console.log("====================================");
    console.log("ADD TO CART STOCK CHECK");
    console.log("Product ID:", product_id);
    console.log("Colour:", selectedVariant?.colour);
    console.log("Size:", selectedVariant?.size);
    console.log("Available Stock:", currentStock);
    console.log("Requested Quantity:", requestedQuantity);
    console.log("====================================");

    if (currentStock <= 0) {
      return res.status(400).json({
        error: "Selected item is out of stock"
      });
    }

    if (requestedQuantity > currentStock) {
      return res.status(400).json({
        error: `Only ${currentStock} item(s) available for the selected variant`
      });
    }

    // ============================================================
    // 7. CREATE COMPLETE SERVER-SIDE VARIANT
    // ============================================================

    let variantToSave;

    if (productVariant) {

      // ----------------------------------------------------------
      // SIZE BASED VARIANT
      // ----------------------------------------------------------

      if (selectedSizeData) {

        variantToSave = {
          ...productVariant,

          colour:
            String(
              productVariant.colour || ""
            ).trim(),

          size:
            String(
              selectedSizeData.size || ""
            ).trim(),

          price:
            Number(
              selectedSizeData.price ??
              productVariant.price ??
              product.price ??
              0
            ),

          oldPrice:
            Number(
              selectedSizeData.oldPrice ??
              selectedSizeData.old_price ??
              productVariant.oldPrice ??
              productVariant.old_price ??
              product.old_price ??
              0
            ),

          discount:
            Number(
              selectedSizeData.discount ??
              productVariant.discount ??
              product.discount ??
              0
            ),

          stock:
            Number(
              selectedSizeData.stock || 0
            ),

          // Keep all sizes as well
          sizes:
            Array.isArray(
              productVariant.sizes
            )
              ? productVariant.sizes
              : []
        };
      }

      // ----------------------------------------------------------
      // NORMAL COLOUR VARIANT
      // ----------------------------------------------------------

      else {

        variantToSave = {
          ...productVariant,

          colour:
            String(
              productVariant.colour || ""
            ).trim(),

          size:
            selectedVariant?.size || null,

          price:
            Number(
              productVariant.price ??
              product.price ??
              0
            ),

          oldPrice:
            Number(
              productVariant.oldPrice ??
              productVariant.old_price ??
              product.old_price ??
              0
            ),

          discount:
            Number(
              productVariant.discount ??
              product.discount ??
              0
            ),

          stock: currentStock
        };
      }

    } else {

      // ----------------------------------------------------------
      // PRODUCT WITHOUT VARIANT
      // ----------------------------------------------------------

      variantToSave = {
        colour: null,
        size: null,

        price:
          Number(
            product.price || 0
          ),

        oldPrice:
          Number(
            product.old_price || 0
          ),

        discount:
          Number(
            product.discount || 0
          ),

        stock: currentStock,

        mainImage:
          product.img_url || null,

        img_url:
          product.img_url || null,

        thumbnails:
          Array.isArray(
            product.thumbnails
          )
            ? product.thumbnails
            : []
      };
    }

    // ============================================================
    // 8. CHECK EXISTING CART ITEMS
    // ============================================================

    const existingRes = await pool.query(
      `
      SELECT *
      FROM cart_items
      WHERE user_id = $1
        AND product_id = $2
      `,
      [
        user_id,
        product_id
      ]
    );

    // ============================================================
    // 9. FIND SAME COLOUR + SAME SIZE
    // ============================================================

    let existingItem = null;

    if (existingRes.rows.length > 0) {

      existingItem =
        existingRes.rows.find(
          (item) => {

            let oldVariant =
              item.variant || {};

            if (
              typeof oldVariant === "string"
            ) {
              try {
                oldVariant =
                  JSON.parse(
                    oldVariant
                  );
              } catch (err) {
                oldVariant = {};
              }
            }

            const oldColour =
              String(
                oldVariant.colour ||
                item.colour ||
                ""
              )
                .trim()
                .toLowerCase();

            const newColour =
              String(
                variantToSave?.colour ||
                ""
              )
                .trim()
                .toLowerCase();

            const oldSize =
              String(
                oldVariant.size ||
                item.size ||
                ""
              )
                .trim()
                .toLowerCase();

            const newSize =
              String(
                variantToSave?.size ||
                ""
              )
                .trim()
                .toLowerCase();

            return (
              oldColour === newColour &&
              oldSize === newSize
            );
          }
        );
    }

    // ============================================================
    // 10. EXISTING CART ITEM
    // ============================================================

    if (existingItem) {

      const oldQuantity =
        Number(
          existingItem.quantity || 0
        );

      const newQuantity =
        oldQuantity +
        requestedQuantity;

      // Important:
      // Check against CURRENT available stock.
      if (newQuantity > currentStock) {
        return res.status(400).json({
          error: `Only ${currentStock} item(s) available for the selected variant`
        });
      }

      const updated =
        await pool.query(
          `
          UPDATE cart_items
          SET
            quantity = $1,
            variant = $2::jsonb,
            updated_at = NOW()
          WHERE id = $3
          RETURNING *
          `,
          [
            newQuantity,

            JSON.stringify(
              variantToSave
            ),

            existingItem.id
          ]
        );

      // ==========================================================
      // REDUCE STOCK
      // ==========================================================

      if (
        productVariant &&
        selectedSizeData
      ) {

        // --------------------------------------------------------
        // REDUCE SELECTED SIZE STOCK
        // --------------------------------------------------------

        const updatedVariants =
          variants.map(
            (item) => {

              const sameColour =
                String(
                  item.colour || ""
                )
                  .trim()
                  .toLowerCase() ===
                String(
                  productVariant.colour || ""
                )
                  .trim()
                  .toLowerCase();

              if (
                !sameColour ||
                !Array.isArray(
                  item.sizes
                )
              ) {
                return item;
              }

              return {
                ...item,

                sizes:
                  item.sizes.map(
                    (sizeItem) => {

                      const sameSize =
                        String(
                          sizeItem.size || ""
                        )
                          .trim()
                          .toLowerCase() ===
                        String(
                          selectedSizeData.size || ""
                        )
                          .trim()
                          .toLowerCase();

                      if (!sameSize) {
                        return sizeItem;
                      }

                      return {
                        ...sizeItem,

                        stock:
                          Math.max(
                            0,
                            Number(
                              sizeItem.stock || 0
                            ) -
                            requestedQuantity
                          )
                      };
                    }
                  )
              };
            }
          );

        await pool.query(
          `
          UPDATE vanayaproducts
          SET variants = $1::jsonb
          WHERE id = $2
          `,
          [
            JSON.stringify(
              updatedVariants
            ),
            product_id
          ]
        );

      }

      // ----------------------------------------------------------
      // NORMAL VARIANT STOCK
      // ----------------------------------------------------------

      else if (productVariant) {

        const updatedVariants =
          variants.map(
            (item) => {

              const sameColour =
                String(
                  item.colour || ""
                )
                  .trim()
                  .toLowerCase() ===
                String(
                  productVariant.colour || ""
                )
                  .trim()
                  .toLowerCase();

              if (!sameColour) {
                return item;
              }

              return {
                ...item,

                stock:
                  Math.max(
                    0,
                    Number(
                      item.stock || 0
                    ) -
                    requestedQuantity
                  )
              };
            }
          );

        await pool.query(
          `
          UPDATE vanayaproducts
          SET variants = $1::jsonb
          WHERE id = $2
          `,
          [
            JSON.stringify(
              updatedVariants
            ),
            product_id
          ]
        );
      }

      // ----------------------------------------------------------
      // NORMAL PRODUCT STOCK
      // ----------------------------------------------------------

      else {

        await pool.query(
          `
          UPDATE vanayaproducts
          SET stock = GREATEST(
            0,
            stock - $1
          )
          WHERE id = $2
          `,
          [
            requestedQuantity,
            product_id
          ]
        );
      }

      return res.json({
        success: true,
        message: "Cart quantity updated",
        item: updated.rows[0]
      });
    }

    // ============================================================
    // 11. INSERT NEW CART ITEM
    // ============================================================

    const newItem =
      await pool.query(
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
          requestedQuantity,
          JSON.stringify(
            variantToSave
          )
        ]
      );

    // ============================================================
    // 12. REDUCE STOCK FOR NEW CART ITEM
    // ============================================================

    if (
      productVariant &&
      selectedSizeData
    ) {

      // ----------------------------------------------------------
      // DRESS MATERIAL
      // REDUCE ONLY SELECTED SIZE STOCK
      // ----------------------------------------------------------

      const updatedVariants =
        variants.map(
          (item) => {

            const sameColour =
              String(
                item.colour || ""
              )
                .trim()
                .toLowerCase() ===
              String(
                productVariant.colour || ""
              )
                .trim()
                .toLowerCase();

            if (
              !sameColour ||
              !Array.isArray(
                item.sizes
              )
            ) {
              return item;
            }

            return {
              ...item,

              sizes:
                item.sizes.map(
                  (sizeItem) => {

                    const sameSize =
                      String(
                        sizeItem.size || ""
                      )
                        .trim()
                        .toLowerCase() ===
                      String(
                        selectedSizeData.size || ""
                      )
                        .trim()
                        .toLowerCase();

                    if (!sameSize) {
                      return sizeItem;
                    }

                    return {
                      ...sizeItem,

                      stock:
                        Math.max(
                          0,
                          Number(
                            sizeItem.stock || 0
                          ) -
                          requestedQuantity
                        )
                    };
                  }
                )
            };
          }
        );

      await pool.query(
        `
        UPDATE vanayaproducts
        SET variants = $1::jsonb
        WHERE id = $2
        `,
        [
          JSON.stringify(
            updatedVariants
          ),
          product_id
        ]
      );
    }

    // ------------------------------------------------------------
    // NORMAL COLOUR VARIANT
    // ------------------------------------------------------------

    else if (productVariant) {

      const updatedVariants =
        variants.map(
          (item) => {

            const sameColour =
              String(
                item.colour || ""
              )
                .trim()
                .toLowerCase() ===
              String(
                productVariant.colour || ""
              )
                .trim()
                .toLowerCase();

            if (!sameColour) {
              return item;
            }

            return {
              ...item,

              stock:
                Math.max(
                  0,
                  Number(
                    item.stock || 0
                  ) -
                  requestedQuantity
                )
            };
          }
        );

      await pool.query(
        `
        UPDATE vanayaproducts
        SET variants = $1::jsonb
        WHERE id = $2
        `,
        [
          JSON.stringify(
            updatedVariants
          ),
          product_id
        ]
      );
    }

    // ------------------------------------------------------------
    // NORMAL PRODUCT WITHOUT VARIANT
    // ------------------------------------------------------------

    else {

      await pool.query(
        `
        UPDATE vanayaproducts
        SET stock = GREATEST(
          0,
          stock - $1
        )
        WHERE id = $2
        `,
        [
          requestedQuantity,
          product_id
        ]
      );
    }

    // ============================================================
    // 13. RESPONSE
    // ============================================================

    return res.json({
      success: true,
      message: "Item added to cart",
      item: newItem.rows[0]
    });

  } catch (err) {

    console.error(
      "ADD TO CART ERROR:",
      err
    );

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