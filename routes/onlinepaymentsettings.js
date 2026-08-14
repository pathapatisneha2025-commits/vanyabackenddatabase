const pool = require("../db");

const express = require("express");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;

const router = express.Router();

/*
================================================
CLOUDINARY
================================================
*/

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});


/*
================================================
MULTER
================================================
*/

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024
  },
  fileFilter: function (req, file, cb) {

    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed"));
    }

    cb(null, true);
  }
});


/*
================================================
GET PAYMENT SETTINGS
================================================
*/

router.get("/settings", async function (req, res) {

  try {

    const result = await pool.query(
      `
      SELECT
        id,
        upi_id,
        qr_image_url,
        created_at,
        updated_at
      FROM online_payment_settings
      ORDER BY id DESC
      LIMIT 1
      `
    );

    if (result.rows.length === 0) {

      return res.json({
        success: true,
        settings: null
      });

    }

    return res.json({
      success: true,
      settings: result.rows[0]
    });

  } catch (error) {

    console.error(
      "GET payment settings error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Failed to load payment settings"
    });

  }

});


/*
================================================
POST PAYMENT SETTINGS
================================================
*/

router.post(
  "/add",
  upload.single("qrImage"),
  async function (req, res) {

    try {

      const upiId = req.body.upiId;


      /*
      ============================================
      VALIDATE UPI
      ============================================
      */

      if (!upiId || !upiId.trim()) {

        return res.status(400).json({
          success: false,
          message: "UPI ID is required"
        });

      }


      /*
      ============================================
      VALIDATE IMAGE
      ============================================
      */

      if (!req.file) {

        return res.status(400).json({
          success: false,
          message: "QR image is required"
        });

      }


      /*
      ============================================
      UPLOAD TO CLOUDINARY
      ============================================
      */

      const cloudinaryResult =
        await new Promise(function (resolve, reject) {

          const stream =
            cloudinary.uploader.upload_stream(
              {
                folder: "online-payment-qr",
                resource_type: "image"
              },
              function (error, result) {

                if (error) {
                  reject(error);
                  return;
                }

                resolve(result);

              }
            );

          stream.end(req.file.buffer);

        });


      const qrImageUrl =
        cloudinaryResult.secure_url;


      /*
      ============================================
      CHECK EXISTING RECORD
      ============================================
      */

      const existing =
        await pool.query(
          `
          SELECT id
          FROM online_payment_settings
          ORDER BY id DESC
          LIMIT 1
          `
        );


      let result;


      /*
      ============================================
      UPDATE
      ============================================
      */

      if (existing.rows.length > 0) {

        result =
          await pool.query(
            `
            UPDATE online_payment_settings
            SET
              upi_id = $1,
              qr_image_url = $2,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = $3
            RETURNING *
            `,
            [
              upiId.trim(),
              qrImageUrl,
              existing.rows[0].id
            ]
          );

      }


      /*
      ============================================
      INSERT
      ============================================
      */

      else {

        result =
          await pool.query(
            `
            INSERT INTO online_payment_settings
            (
              upi_id,
              qr_image_url
            )
            VALUES
            (
              $1,
              $2
            )
            RETURNING *
            `,
            [
              upiId.trim(),
              qrImageUrl
            ]
          );

      }


      /*
      ============================================
      RESPONSE
      ============================================
      */

      return res.json({
        success: true,
        message: "Payment QR saved successfully",
        qrImageUrl: qrImageUrl,
        settings: result.rows[0]
      });


    } catch (error) {

      console.error(
        "POST payment settings error:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          error.message ||
          "Failed to save payment settings"
      });

    }

  }
);


module.exports = router;