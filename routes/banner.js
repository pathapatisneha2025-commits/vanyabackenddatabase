
const express = require("express");
const multer = require("multer");
const cloudinary = require("../cloudinary");
const pool = require("../db");

const router = express.Router();

// =====================================================
// MULTER
// NO FILE SIZE LIMIT
// NO FILE TYPE RESTRICTION
// =====================================================

const storage = multer.memoryStorage();

const upload = multer({
  storage,
});

// =====================================================
// GET BANNER
// GET /banner/all
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

    return res.json(result.rows[0]);

  } catch (error) {
    console.error("Get banner error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch banner",
      error: error.message,
    });
  }
});

// =====================================================
// ADD BANNER
// POST /banner/add
// =====================================================

router.post(
  "/add",
  upload.single("image"),
  async (req, res) => {
    try {
      console.log("=================================");
      console.log("ADD BANNER");
      console.log("=================================");

      console.log(
        "File:",
        req.file
          ? {
              name: req.file.originalname,
              type: req.file.mimetype,
              size: req.file.size,
            }
          : "NO FILE"
      );

      console.log(
        "Description:",
        req.body.description
      );

      // =================================================
      // CHECK IMAGE
      // =================================================

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "Banner image is required",
        });
      }

      // =================================================
      // DESCRIPTION
      // =================================================

      const description =
        req.body.description
          ? req.body.description.trim()
          : "";

      if (!description) {
        return res.status(400).json({
          success: false,
          message: "Banner description is required",
        });
      }

      // =================================================
      // CHECK EXISTING BANNER
      // =================================================

      const existingResult = await pool.query(`
        SELECT *
        FROM hero_section
        ORDER BY id ASC
        LIMIT 1
      `);

      if (existingResult.rows.length > 0) {
        return res.status(409).json({
          success: false,
          message:
            "Banner already exists. Please use Update Banner.",
        });
      }

      // =================================================
      // UPLOAD TO CLOUDINARY
      // =================================================

      console.log(
        "Uploading banner to Cloudinary..."
      );

      const uploadResult = await new Promise(
        (resolve, reject) => {
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
                  console.error(
                    "Cloudinary upload error:",
                    error
                  );

                  reject(error);
                } else {
                  resolve(result);
                }
              }
            );

          stream.end(req.file.buffer);
        }
      );

      // =================================================
      // CLOUDINARY URL
      // =================================================

      const imageUrl =
        uploadResult.secure_url;

      console.log(
        "Cloudinary URL:",
        imageUrl
      );

      // =================================================
      // SAVE TO DATABASE
      // =================================================

      const result = await pool.query(
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
          description,
        ]
      );

      // =================================================
      // SUCCESS
      // =================================================

      return res.status(201).json({
        success: true,
        message: "Banner added successfully",
        banner: result.rows[0],
      });

    } catch (error) {
      console.error(
        "Add banner error:",
        error
      );

      return res.status(500).json({
        success: false,
        message: "Failed to add banner",
        error: error.message,
      });
    }
  }
);

// =====================================================
// UPDATE BANNER
// PUT /banner/update
// IMAGE OPTIONAL
// =====================================================

router.put(
  "/update",
  upload.single("image"),
  async (req, res) => {
    try {
      console.log("=================================");
      console.log("UPDATE BANNER");
      console.log("=================================");

      console.log(
        "File:",
        req.file
          ? {
              name: req.file.originalname,
              type: req.file.mimetype,
              size: req.file.size,
            }
          : "NO NEW FILE"
      );

      console.log(
        "Description:",
        req.body.description
      );

      // =================================================
      // GET EXISTING BANNER
      // =================================================

      const existingResult = await pool.query(`
        SELECT *
        FROM hero_section
        ORDER BY id ASC
        LIMIT 1
      `);

      if (existingResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message:
            "Banner not found. Please add a banner first.",
        });
      }

      const existingBanner =
        existingResult.rows[0];

      // =================================================
      // KEEP OLD IMAGE
      // =================================================

      let imageUrl =
        existingBanner.image_url || "";

      // =================================================
      // UPLOAD NEW IMAGE
      // =================================================

      if (req.file) {
        console.log(
          "Uploading new image to Cloudinary..."
        );

        const uploadResult = await new Promise(
          (resolve, reject) => {
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
                    console.error(
                      "Cloudinary upload error:",
                      error
                    );

                    reject(error);
                  } else {
                    resolve(result);
                  }
                }
              );

            stream.end(req.file.buffer);
          }
        );

        imageUrl =
          uploadResult.secure_url;

        console.log(
          "New Cloudinary URL:",
          imageUrl
        );
      }

      // =================================================
      // DESCRIPTION
      // =================================================

      const finalDescription =
        req.body.description !== undefined
          ? req.body.description.trim()
          : existingBanner.description || "";

      // =================================================
      // UPDATE DATABASE
      // =================================================

      const result = await pool.query(
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
          existingBanner.id,
        ]
      );

      // =================================================
      // SUCCESS
      // =================================================

      return res.json({
        success: true,
        message: "Banner updated successfully",
        banner: result.rows[0],
      });

    } catch (error) {
      console.error(
        "Update banner error:",
        error
      );

      return res.status(500).json({
        success: false,
        message: "Failed to update banner",
        error: error.message,
      });
    }
  }
);

// =====================================================
// DELETE BANNER IMAGE
// DELETE /banner/image
// =====================================================

router.delete(
  "/image",
  async (req, res) => {
    try {
      // =================================================
      // GET EXISTING BANNER
      // =================================================

      const result = await pool.query(`
        SELECT *
        FROM hero_section
        ORDER BY id ASC
        LIMIT 1
      `);

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Banner not found",
        });
      }

      const banner =
        result.rows[0];

      // =================================================
      // DELETE IMAGE FROM CLOUDINARY
      // =================================================

      if (banner.image_url) {
        try {
          const urlParts =
            banner.image_url.split("/upload/");

          if (urlParts.length > 1) {
            let publicId =
              urlParts[1];

            // Remove transformations
            const parts =
              publicId.split("/");

            if (
              parts[0] &&
              parts[0].startsWith("v")
            ) {
              parts.shift();
            }

            publicId =
              parts.join("/");

            // Remove file extension
            publicId =
              publicId.replace(
                /\.[^/.]+$/,
                ""
              );

            console.log(
              "Deleting Cloudinary public ID:",
              publicId
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

      // =================================================
      // REMOVE URL FROM DATABASE
      // =================================================

      await pool.query(
        `
        UPDATE hero_section
        SET
          image_url = '',
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        `,
        [banner.id]
      );

      // =================================================
      // SUCCESS
      // =================================================

      return res.json({
        success: true,
        message:
          "Banner image deleted successfully",
      });

    } catch (error) {
      console.error(
        "Delete banner error:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to delete banner image",
        error: error.message,
      });
    }
  }
);

module.exports = router;
