const express = require("express");
const router = express.Router();
const pool = require("../db");

const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("cloudinary").v2;

/* ======================================================
   CLOUDINARY CONFIGURATION
====================================================== */

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/* ======================================================
   CLOUDINARY PAYMENT SCREENSHOT STORAGE
====================================================== */

const paymentScreenshotStorage =
  new CloudinaryStorage({
    cloudinary: cloudinary,

    params: {
      folder: "vanya/payment-screenshots",

      allowed_formats: [
        "jpg",
        "jpeg",
        "png",
        "webp",
      ],

      resource_type: "image",
    },
  });

/* ======================================================
   MULTER
====================================================== */

const uploadPaymentScreenshot = multer({
  storage: paymentScreenshotStorage,

  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB
  },

  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "Only image files are allowed for payment screenshots."
        )
      );
    }
  },
});

/* ======================================================
   GET ALL ORDERS
====================================================== */

router.get("/all", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM vanyaorders
      ORDER BY created_at DESC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error(
      "GET ALL ORDERS ERROR:",
      err
    );

    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/* ======================================================
   GET ORDERS BY USER ID
   IMPORTANT:
   This route MUST come before /:order_id
====================================================== */

router.get(
  "/user/:user_id",
  async (req, res) => {
    const { user_id } = req.params;

    try {
      const result = await pool.query(
        `
        SELECT *
        FROM vanyaorders
        WHERE user_id = $1
        ORDER BY created_at DESC
        `,
        [user_id]
      );

      res.json(result.rows);
    } catch (err) {
      console.error(
        "GET USER ORDERS ERROR:",
        err
      );

      res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  }
);

/* ======================================================
   GET SINGLE ORDER BY ID
====================================================== */

router.get(
  "/:order_id",
  async (req, res) => {
    const { order_id } = req.params;

    try {
      const result = await pool.query(
        `
        SELECT *
        FROM vanyaorders
        WHERE id = $1
        `,
        [order_id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Order not found",
        });
      }

      res.json(result.rows[0]);
    } catch (err) {
      console.error(
        "GET SINGLE ORDER ERROR:",
        err
      );

      res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  }
);

/* ======================================================
   CREATE NEW ORDER

   Supports:

   COD:
   application/json

   UPI:
   multipart/form-data
   with paymentScreenshot
====================================================== */

router.post(
  "/add",

  uploadPaymentScreenshot.single(
    "paymentScreenshot"
  ),

  async (req, res) => {
    console.log(
      "===================================="
    );

    console.log(
      "CREATE ORDER REQUEST"
    );

    console.log(
      "REQ BODY:",
      req.body
    );

    console.log(
      "PAYMENT SCREENSHOT:",
      req.file
    );

    console.log(
      "===================================="
    );

    try {
      let {
        formData,
        cartItems,
        paymentMethod,
        totalAmount,
        user_id,
        payment_status,
        order_status,
      } = req.body;

      /* ==================================================
         PARSE FORMDATA JSON
      ================================================== */

      if (
        typeof formData === "string"
      ) {
        try {
          formData =
            JSON.parse(formData);
        } catch (err) {
          console.error(
            "FORM DATA PARSE ERROR:",
            err
          );

          return res.status(400).json({
            success: false,
            message:
              "Invalid formData",
          });
        }
      }

      /* ==================================================
         PARSE CART ITEMS JSON
      ================================================== */

      if (
        typeof cartItems === "string"
      ) {
        try {
          cartItems =
            JSON.parse(cartItems);
        } catch (err) {
          console.error(
            "CART ITEMS PARSE ERROR:",
            err
          );

          return res.status(400).json({
            success: false,
            message:
              "Invalid cartItems",
          });
        }
      }

      /* ==================================================
         VALIDATE FORM DATA
      ================================================== */

      if (
        !formData ||
        typeof formData !==
          "object"
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid delivery address data",
        });
      }

      /* ==================================================
         VALIDATE CART
      ================================================== */

      if (
        !Array.isArray(cartItems) ||
        cartItems.length === 0
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Your cart is empty",
        });
      }

      /* ==================================================
         VALIDATE USER
      ================================================== */

      if (!user_id) {
        return res.status(400).json({
          success: false,
          message:
            "User ID is required",
        });
      }

      /* ==================================================
         VALIDATE PAYMENT METHOD
      ================================================== */

      if (!paymentMethod) {
        return res.status(400).json({
          success: false,
          message:
            "Payment method is required",
        });
      }

      /* ==================================================
         PAYMENT SCREENSHOT
      ================================================== */

      let paymentScreenshotUrl =
        null;

      let paymentScreenshotPublicId =
        null;

      if (req.file) {
        paymentScreenshotUrl =
          req.file.path;

        paymentScreenshotPublicId =
          req.file.filename;

        console.log(
          "CLOUDINARY URL:",
          paymentScreenshotUrl
        );

        console.log(
          "CLOUDINARY PUBLIC ID:",
          paymentScreenshotPublicId
        );
      }

      /* ==================================================
         PAYMENT STATUS

         UPI:
         pending

         COD:
         pending
      ================================================== */

      const finalPaymentStatus =
        payment_status ||
        "pending";

      /* ==================================================
         ORDER STATUS

         UPI:
         payment_pending

         COD:
         confirmed
      ================================================== */

      const finalOrderStatus =
        order_status ||
        (
          paymentMethod ===
          "upi"
            ? "payment_pending"
            : "confirmed"
        );

      /* ==================================================
         VALIDATE UPI SCREENSHOT

         If UPI is selected, screenshot
         should be uploaded.
      ================================================== */

      if (
        paymentMethod === "upi" &&
        !req.file
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Payment screenshot is required for UPI payment",
        });
      }

      /* ==================================================
         DATABASE CONNECTION
      ================================================== */

      const client =
        await pool.connect();

      try {
        await client.query(
          "BEGIN"
        );

        /* ==================================================
           INSERT ORDER
        ================================================== */

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
            order_status,
            payment_screenshot
          )
          VALUES
          (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            $8,
            $9,
            $10,
            $11,
            $12,
            $13,
            $14
          )
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
          Number(totalAmount),
          JSON.stringify(
            cartItems
          ),
          user_id,
          finalPaymentStatus,
          finalOrderStatus,
          paymentScreenshotUrl,
        ];

        const result =
          await client.query(
            insertOrderQuery,
            orderValues
          );

        const orderId =
          result.rows[0].id;

        /* ==================================================
           DELETE CART ITEMS
        ================================================== */

        if (user_id) {
          await client.query(
            `
            DELETE FROM cart_items
            WHERE user_id = $1
            `,
            [user_id]
          );
        }

        /* ==================================================
           COMMIT
        ================================================== */

        await client.query(
          "COMMIT"
        );

        console.log(
          "ORDER CREATED SUCCESSFULLY:",
          orderId
        );

        /* ==================================================
           RESPONSE
        ================================================== */

        return res.status(201).json({
          success: true,

          message:
            paymentMethod ===
            "upi"
              ? "Payment screenshot submitted successfully. Waiting for admin verification."
              : "Order placed successfully",

          orderId,

          paymentStatus:
            finalPaymentStatus,

          orderStatus:
            finalOrderStatus,

          paymentScreenshot:
            paymentScreenshotUrl,
        });

      } catch (dbError) {
        /* ==================================================
           ROLLBACK
        ================================================== */

        await client.query(
          "ROLLBACK"
        );

        console.error(
          "CREATE ORDER DATABASE ERROR:",
          dbError
        );

        /* ==================================================
           DELETE CLOUDINARY IMAGE IF DATABASE FAILED

           This prevents an unused screenshot from
           remaining in Cloudinary.
        ================================================== */

        if (
          req.file &&
          req.file.filename
        ) {
          try {
            await cloudinary.uploader.destroy(
              req.file.filename,
              {
                resource_type:
                  "image",
              }
            );

            console.log(
              "Cloudinary screenshot deleted after DB failure"
            );
          } catch (
            cloudinaryDeleteError
          ) {
            console.error(
              "CLOUDINARY DELETE ERROR:",
              cloudinaryDeleteError
            );
          }
        }

        return res.status(500).json({
          success: false,

          message:
            "Failed to create order",

          error:
            dbError.message,
        });

      } finally {
        client.release();
      }

    } catch (error) {
      console.error(
        "CREATE ORDER ERROR:",
        error
      );

      return res.status(500).json({
        success: false,

        message:
          error.message ||
          "Internal server error",
      });
    }
  }
);

/* ======================================================
   UPDATE ORDER PAYMENT METHOD OR ADDRESS
====================================================== */

router.put(
  "/update/:order_id",
  async (req, res) => {
    const { order_id } =
      req.params;

    const {
      paymentMethod,
      formData,
    } = req.body;

    if (
      !paymentMethod &&
      !formData
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Nothing to update",
      });
    }

    try {
      const fields = [];
      const values = [];

      let idx = 1;

      /* ==================================================
         UPDATE ADDRESS
      ================================================== */

      if (formData) {
        const addressFields = [
          "fullName",
          "phone",
          "email",
          "pinCode",
          "city",
          "state",
          "address",
        ];

        for (
          const key of addressFields
        ) {
          if (
            formData[key] !==
              undefined &&
            formData[key] !== null &&
            formData[key] !== ""
          ) {
            const dbColumn =
              key === "fullName"
                ? "full_name"
                : key === "pinCode"
                ? "pin_code"
                : key;

            fields.push(
              `${dbColumn}=$${idx}`
            );

            values.push(
              formData[key]
            );

            idx++;
          }
        }
      }

      /* ==================================================
         UPDATE PAYMENT METHOD
      ================================================== */

      if (paymentMethod) {
        fields.push(
          `payment_method=$${idx}`
        );

        values.push(
          paymentMethod
        );

        idx++;
      }

      if (
        fields.length === 0
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Nothing to update",
        });
      }

      /* ==================================================
         ORDER ID
      ================================================== */

      values.push(order_id);

      /* ==================================================
         UPDATE
      ================================================== */

      const result =
        await pool.query(
          `
          UPDATE vanyaorders
          SET ${fields.join(
            ", "
          )}
          WHERE id=$${idx}
          RETURNING *
          `,
          values
        );

      if (
        result.rows.length === 0
      ) {
        return res.status(404).json({
          success: false,
          message:
            "Order not found",
        });
      }

      res.json({
        success: true,
        order:
          result.rows[0],
      });

    } catch (err) {
      console.error(
        "UPDATE ORDER ERROR:",
        err
      );

      res.status(500).json({
        success: false,
        error:
          "Internal server error",
      });
    }
  }
);

/* ======================================================
   DELETE ORDER
====================================================== */

router.delete(
  "/delete/:order_id",
  async (req, res) => {
    const { order_id } =
      req.params;

    try {

      /* ==================================================
         GET SCREENSHOT BEFORE DELETE
      ================================================== */

      const orderResult =
        await pool.query(
          `
          SELECT payment_screenshot
          FROM vanyaorders
          WHERE id = $1
          `,
          [order_id]
        );

      if (
        orderResult.rows.length ===
        0
      ) {
        return res.status(404).json({
          success: false,
          message:
            "Order not found",
        });
      }

      const screenshotUrl =
        orderResult.rows[0]
          .payment_screenshot;

      /* ==================================================
         DELETE ORDER
      ================================================== */

      await pool.query(
        `
        DELETE FROM vanyaorders
        WHERE id=$1
        `,
        [order_id]
      );

      /* ==================================================
         DELETE CLOUDINARY IMAGE

         Extract public ID from URL.
      ================================================== */

      if (screenshotUrl) {
        try {

          const uploadIndex =
            screenshotUrl.indexOf(
              "/upload/"
            );

          if (
            uploadIndex !== -1
          ) {

            let publicId =
              screenshotUrl.substring(
                uploadIndex +
                  "/upload/"
                    .length
              );

            /*
             * Remove version:
             *
             * v123456/
             */

            publicId =
              publicId.replace(
                /^v\d+\//,
                ""
              );

            /*
             * Remove extension
             */

            publicId =
              publicId.replace(
                /\.[^/.]+$/,
                ""
              );

            await cloudinary.uploader.destroy(
              publicId,
              {
                resource_type:
                  "image",
              }
            );

            console.log(
              "Cloudinary screenshot deleted:",
              publicId
            );
          }

        } catch (
          cloudinaryError
        ) {
          console.error(
            "CLOUDINARY DELETE ERROR:",
            cloudinaryError
          );
        }
      }

      res.json({
        success: true,
        message:
          "Order deleted successfully",
      });

    } catch (err) {
      console.error(
        "DELETE ORDER ERROR:",
        err
      );

      res.status(500).json({
        success: false,
        error:
          "Internal server error",
      });
    }
  }
);

/* ======================================================
   MULTER / CLOUDINARY ERROR HANDLER

   Keep this AFTER all routes.
====================================================== */

router.use(
  (err, req, res, next) => {

    console.error(
      "ORDER UPLOAD ERROR:",
      err
    );

    if (
      err instanceof multer.MulterError
    ) {

      if (
        err.code ===
        "LIMIT_FILE_SIZE"
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Payment screenshot must be less than 5 MB.",
        });
      }

      return res.status(400).json({
        success: false,
        message:
          err.message,
      });
    }

    if (err) {
      return res.status(400).json({
        success: false,
        message:
          err.message ||
          "Payment screenshot upload failed",
      });
    }

    next();
  }
);

// ============================================================
// APPROVE ONLINE PAYMENT
// PUT /orders/payment/approve/:id
// ============================================================
router.put("/payment/approve/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // If you have admin authentication, replace this with
    // req.user.id or your actual admin ID.
    const paymentVerifiedBy =
      req.body.payment_verified_by || null;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Order ID is required",
      });
    }

    // --------------------------------------------------------
    // Get order
    // --------------------------------------------------------
    const [orders] = await db.query(
      `
      SELECT
        id,
        payment_method,
        payment_status,
        payment_screenshot,
        order_status
      FROM orders
      WHERE id = ?
      LIMIT 1
      `,
      [id]
    );

    if (orders.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    const order = orders[0];

    // --------------------------------------------------------
    // Only online/UPI payments should be manually approved
    // --------------------------------------------------------
    if (
      order.payment_method !== "upi" &&
      order.payment_method !== "online"
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Payment approval is only available for online/UPI orders",
      });
    }

    // --------------------------------------------------------
    // Screenshot is required before approval
    // --------------------------------------------------------
    if (!order.payment_screenshot) {
      return res.status(400).json({
        success: false,
        message:
          "Payment screenshot has not been uploaded by the customer",
      });
    }

    // --------------------------------------------------------
    // Prevent approving an already verified payment
    // --------------------------------------------------------
    if (order.payment_status === "verified") {
      return res.status(400).json({
        success: false,
        message: "Payment is already approved",
      });
    }

    // --------------------------------------------------------
    // Update payment + order status
    // --------------------------------------------------------
    await db.query(
      `
      UPDATE orders
      SET
        payment_status = 'verified',
        order_status = 'confirmed',
        payment_verified_at = NOW(),
        payment_verified_by = ?,
        payment_rejected_reason = NULL
      WHERE id = ?
      `,
      [paymentVerifiedBy, id]
    );

    // --------------------------------------------------------
    // Get updated order
    // --------------------------------------------------------
    const [updatedOrders] = await db.query(
      `
      SELECT *
      FROM orders
      WHERE id = ?
      LIMIT 1
      `,
      [id]
    );

    return res.status(200).json({
      success: true,
      message: "Payment approved successfully",
      order: updatedOrders[0],
    });
  } catch (error) {
    console.error("Approve payment error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to approve payment",
      error: error.message,
    });
  }
});


// ============================================================
// REJECT ONLINE PAYMENT
// PUT /orders/payment/reject/:id
// ============================================================
router.put("/payment/reject/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const {
      payment_rejected_reason,
    } = req.body;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Order ID is required",
      });
    }

    // --------------------------------------------------------
    // Rejection reason is required
    // --------------------------------------------------------
    if (
      !payment_rejected_reason ||
      !payment_rejected_reason.trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "Payment rejection reason is required",
      });
    }

    // --------------------------------------------------------
    // Get order
    // --------------------------------------------------------
    const [orders] = await db.query(
      `
      SELECT
        id,
        payment_method,
        payment_status,
        payment_screenshot,
        order_status
      FROM orders
      WHERE id = ?
      LIMIT 1
      `,
      [id]
    );

    if (orders.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    const order = orders[0];

    // --------------------------------------------------------
    // Only online/UPI payments
    // --------------------------------------------------------
    if (
      order.payment_method !== "upi" &&
      order.payment_method !== "online"
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Payment rejection is only available for online/UPI orders",
      });
    }

    // --------------------------------------------------------
    // Prevent rejecting an already verified payment
    // --------------------------------------------------------
    if (order.payment_status === "verified") {
      return res.status(400).json({
        success: false,
        message:
          "A verified payment cannot be rejected",
      });
    }

    // --------------------------------------------------------
    // Update payment + order status
    // --------------------------------------------------------
    await db.query(
      `
      UPDATE orders
      SET
        payment_status = 'rejected',
        order_status = 'payment_rejected',
        payment_rejected_reason = ?,
        payment_verified_at = NULL,
        payment_verified_by = NULL
      WHERE id = ?
      `,
      [
        payment_rejected_reason.trim(),
        id,
      ]
    );

    // --------------------------------------------------------
    // Get updated order
    // --------------------------------------------------------
    const [updatedOrders] = await db.query(
      `
      SELECT *
      FROM orders
      WHERE id = ?
      LIMIT 1
      `,
      [id]
    );

    return res.status(200).json({
      success: true,
      message: "Payment rejected successfully",
      order: updatedOrders[0],
    });
  } catch (error) {
    console.error("Reject payment error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to reject payment",
      error: error.message,
    });
  }
});

module.exports = router;