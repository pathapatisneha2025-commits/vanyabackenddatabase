const express = require("express");
const multer = require("multer");
const { v2: cloudinary } = require("cloudinary");
const pool = require("../db");

const router = express.Router();

// =====================================================
// CLOUDINARY CONFIG
// =====================================================

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// =====================================================
// MULTER
// Store image temporarily in memory
// =====================================================

const storage = multer.memoryStorage();

const upload = multer({
  storage: storage,

  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB
  },

  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/webp",
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "Only JPG, JPEG, PNG and WEBP images are allowed"
        )
      );
    }
  },
});

// =====================================================
// CREATE TABLE
// =====================================================

router.post("/add", async (req, res) => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hero_section (
        id SERIAL PRIMARY KEY,
        image_url TEXT,
        description TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    res.json({
      success: true,
      message: "Hero table created successfully",
    });
  } catch (error) {
    console.error("Create hero table error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to create hero table",
      error: error.message,
    });
  }
});

// =====================================================
// GET HERO
// =====================================================

router.get("/all", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id,
        image_url,
        description,
        updated_at
      FROM hero_section
      ORDER BY id ASC
      LIMIT 1
    `);

    if (result.rows.length === 0) {
      return res.json({
        id: null,
        image_url: "",
        description: "",
      });
    }

    res.json(result.rows[0]);

  } catch (error) {
    console.error("Get hero error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch hero section",
      error: error.message,
    });
  }
});

// =====================================================
// UPDATE HERO
// IMAGE OPTIONAL
// DESCRIPTION OPTIONAL
// =====================================================

router.put(
  "/update",
  upload.single("image"),
  async (req, res) => {

    try {

      const { description } = req.body;

      // =================================================
      // GET EXISTING HERO
      // =================================================

      const existingResult = await pool.query(`
        SELECT *
        FROM hero_section
        ORDER BY id ASC
        LIMIT 1
      `);

      let existingHero = null;

      if (existingResult.rows.length > 0) {
        existingHero = existingResult.rows[0];
      }

      // =================================================
      // IMAGE URL
      // =================================================

      let imageUrl = existingHero?.image_url || "";

      // =================================================
      // UPLOAD NEW IMAGE TO CLOUDINARY
      // =================================================

      if (req.file) {

        console.log("Uploading image to Cloudinary...");

        const uploadResult =
          await new Promise((resolve, reject) => {

            const stream =
              cloudinary.uploader.upload_stream(
                {
                  folder: "vanya/hero",
                  resource_type: "image",
                  transformation: [
                    {
                      quality: "auto",
                      fetch_format: "auto",
                    },
                  ],
                },

                (error, result) => {

                  if (error) {
                    reject(error);
                  } else {
                    resolve(result);
                  }

                }
              );

            stream.end(req.file.buffer);

          });

        imageUrl = uploadResult.secure_url;

        console.log(
          "Cloudinary image uploaded:",
          imageUrl
        );
      }

      // =================================================
      // DESCRIPTION
      // =================================================

      const finalDescription =
        description !== undefined
          ? description.trim()
          : existingHero?.description || "";

      // =================================================
      // INSERT / UPDATE DATABASE
      // =================================================

      let result;

      if (existingHero) {

        result = await pool.query(
          `
          UPDATE hero_section
          SET
            image_url = $1,
            description = $2,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = $3
          RETURNING *
          `,
          [
            imageUrl,
            finalDescription,
            existingHero.id,
          ]
        );

      } else {

        result = await pool.query(
          `
          INSERT INTO hero_section
          (
            image_url,
            description,
            updated_at
          )
          VALUES
          (
            $1,
            $2,
            CURRENT_TIMESTAMP
          )
          RETURNING *
          `,
          [
            imageUrl,
            finalDescription,
          ]
        );

      }

      // =================================================
      // RESPONSE
      // =================================================

      res.json({
        success: true,
        message: "Hero section updated successfully",
        hero: result.rows[0],
      });

    } catch (error) {

      console.error(
        "Update hero error:",
        error
      );

      res.status(500).json({
        success: false,
        message: "Failed to update hero section",
        error: error.message,
      });

    }
  }
);

// =====================================================
// DELETE HERO IMAGE FROM CLOUDINARY
// =====================================================

router.delete("/image", async (req, res) => {

  try {

    const result = await pool.query(`
      SELECT *
      FROM hero_section
      ORDER BY id ASC
      LIMIT 1
    `);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Hero section not found",
      });
    }

    const hero = result.rows[0];

    // -----------------------------------------------
    // Extract Cloudinary public ID
    // -----------------------------------------------

    if (hero.image_url) {

      try {

        const urlParts =
          hero.image_url.split("/upload/");

        if (urlParts.length > 1) {

          let publicId =
            urlParts[1];

          // Remove transformation if present
          if (publicId.includes("/")) {
            const parts =
              publicId.split("/");

            if (
              parts[0].startsWith("v")
            ) {
              parts.shift();
            }

            publicId =
              parts.join("/");
          }

          // Remove extension
          publicId =
            publicId.replace(
              /\.[^/.]+$/,
              ""
            );

          await cloudinary.uploader.destroy(
            publicId,
            {
              resource_type: "image",
            }
          );

        }

      } catch (cloudinaryError) {

        console.error(
          "Cloudinary delete error:",
          cloudinaryError
        );

      }

    }

    // -----------------------------------------------
    // Remove URL from database
    // -----------------------------------------------

    await pool.query(
      `
      UPDATE hero_section
      SET
        image_url = '',
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      `,
      [hero.id]
    );

    res.json({
      success: true,
      message: "Hero image deleted successfully",
    });

  } catch (error) {

    console.error(
      "Delete hero image error:",
      error
    );

    res.status(500).json({
      success: false,
      message: "Failed to delete hero image",
      error: error.message,
    });

  }

});

module.exports = router;