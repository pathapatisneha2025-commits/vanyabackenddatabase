const express = require("express");
const router = express.Router();

const multer = require("multer");
const cloudinary = require("../cloudinary");
const pool = require("../db");

// ============================================================
// MULTER CONFIGURATION
// ============================================================

const upload = multer({
  storage: multer.memoryStorage(),
});

// ============================================================
// HELPER: UPLOAD BUFFER TO CLOUDINARY
// ============================================================

const uploadToCloudinary = (buffer) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: "vanya/collections",
        resource_type: "image",
      },
      (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      }
    );

    uploadStream.end(buffer);
  });
};

// ============================================================
// HELPER: DELETE IMAGE FROM CLOUDINARY
// ============================================================

const deleteFromCloudinary = async (publicId) => {
  if (!publicId) return;

  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (error) {
    console.error("CLOUDINARY DELETE ERROR:", error);
  }
};

// ============================================================
// HELPER: GET PUBLIC ID FROM CLOUDINARY URL
// ============================================================

const getCloudinaryPublicId = (imageUrl) => {
  try {
    if (!imageUrl || !imageUrl.includes("res.cloudinary.com")) {
      return null;
    }

    const url = new URL(imageUrl);

    const parts = url.pathname.split("/");

    const uploadIndex = parts.indexOf("upload");

    if (uploadIndex === -1) {
      return null;
    }

    let publicIdParts = parts.slice(uploadIndex + 1);

    // Remove version like v123456789
    if (
      publicIdParts.length > 0 &&
      /^v\d+$/.test(publicIdParts[0])
    ) {
      publicIdParts.shift();
    }

    let publicId = publicIdParts.join("/");

    // Remove extension
    publicId = publicId.replace(/\.[^/.]+$/, "");

    return publicId;
  } catch (error) {
    console.error("GET CLOUDINARY PUBLIC ID ERROR:", error);
    return null;
  }
};

// ============================================================
// GET ALL COLLECTIONS
// GET /collections
// ============================================================

router.get("/", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id,
        category,
        image_url,
        created_at
      FROM collections
      ORDER BY id DESC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error("GET COLLECTIONS ERROR:", error);

    res.status(500).json({
      message: "Failed to fetch collections",
      error: error.message,
    });
  }
});

// ============================================================
// GET SINGLE COLLECTION
// GET /collections/:id
// ============================================================

router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `
      SELECT
        id,
        category,
        image_url,
        created_at
      FROM collections
      WHERE id = $1
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Collection not found",
      });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("GET COLLECTION ERROR:", error);

    res.status(500).json({
      message: "Failed to fetch collection",
      error: error.message,
    });
  }
});

// ============================================================
// CREATE COLLECTION
// POST /collections
//
// Form-data:
// category = SILK SAREES
// image = selected image
// ============================================================

router.post("/add", upload.single("image"), async (req, res) => {
  try {
    const { category } = req.body;

    if (!category || !category.trim()) {
      return res.status(400).json({
        message: "Category name is required",
      });
    }

    if (!req.file) {
      return res.status(400).json({
        message: "Collection image is required",
      });
    }

    // --------------------------------------------------------
    // CHECK DUPLICATE CATEGORY
    // --------------------------------------------------------

    const existing = await pool.query(
      `
      SELECT id
      FROM collections
      WHERE LOWER(TRIM(category)) = LOWER(TRIM($1))
      `,
      [category]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({
        message: "This category already exists",
      });
    }

    // --------------------------------------------------------
    // UPLOAD IMAGE TO CLOUDINARY
    // --------------------------------------------------------

    const cloudinaryResult = await uploadToCloudinary(
      req.file.buffer
    );

    const imageUrl = cloudinaryResult.secure_url;

    // --------------------------------------------------------
    // SAVE TO DATABASE
    // --------------------------------------------------------

    const result = await pool.query(
      `
      INSERT INTO collections
      (
        category,
        image_url
      )
      VALUES
      (
        $1,
        $2
      )
      RETURNING
        id,
        category,
        image_url,
        created_at
      `,
      [
        category.trim(),
        imageUrl,
      ]
    );

    res.status(201).json({
      message: "Collection created successfully",
      collection: result.rows[0],
    });
  } catch (error) {
    console.error("CREATE COLLECTION ERROR:", error);

    res.status(500).json({
      message: "Failed to create collection",
      error: error.message,
    });
  }
});

// ============================================================
// UPDATE COLLECTION
// PUT /collections/:id
//
// Form-data:
// category = SILK SAREES
// image = new image (optional)
// ============================================================

router.put("/update/:id", upload.single("image"), async (req, res) => {
  try {
    const { id } = req.params;
    const { category } = req.body;

    if (!category || !category.trim()) {
      return res.status(400).json({
        message: "Category name is required",
      });
    }

    // --------------------------------------------------------
    // GET EXISTING COLLECTION
    // --------------------------------------------------------

    const existingCollection = await pool.query(
      `
      SELECT
        id,
        category,
        image_url
      FROM collections
      WHERE id = $1
      `,
      [id]
    );

    if (existingCollection.rows.length === 0) {
      return res.status(404).json({
        message: "Collection not found",
      });
    }

    const oldCollection = existingCollection.rows[0];

    // --------------------------------------------------------
    // CHECK DUPLICATE CATEGORY
    // --------------------------------------------------------

    const duplicate = await pool.query(
      `
      SELECT id
      FROM collections
      WHERE LOWER(TRIM(category)) = LOWER(TRIM($1))
      AND id != $2
      `,
      [category, id]
    );

    if (duplicate.rows.length > 0) {
      return res.status(409).json({
        message: "Another category with this name already exists",
      });
    }

    // --------------------------------------------------------
    // KEEP OLD IMAGE BY DEFAULT
    // --------------------------------------------------------

    let imageUrl = oldCollection.image_url;

    // --------------------------------------------------------
    // IF NEW IMAGE WAS SELECTED
    // --------------------------------------------------------

    if (req.file) {
      const cloudinaryResult = await uploadToCloudinary(
        req.file.buffer
      );

      imageUrl = cloudinaryResult.secure_url;

      // ------------------------------------------------------
      // DELETE OLD CLOUDINARY IMAGE
      // ------------------------------------------------------

      const oldPublicId = getCloudinaryPublicId(
        oldCollection.image_url
      );

      if (oldPublicId) {
        await deleteFromCloudinary(oldPublicId);
      }
    }

    // --------------------------------------------------------
    // UPDATE DATABASE
    // --------------------------------------------------------

    const result = await pool.query(
      `
      UPDATE collections
      SET
        category = $1,
        image_url = $2
      WHERE id = $3
      RETURNING
        id,
        category,
        image_url,
        created_at
      `,
      [
        category.trim(),
        imageUrl,
        id,
      ]
    );

    res.json({
      message: "Collection updated successfully",
      collection: result.rows[0],
    });
  } catch (error) {
    console.error("UPDATE COLLECTION ERROR:", error);

    res.status(500).json({
      message: "Failed to update collection",
      error: error.message,
    });
  }
});

// ============================================================
// DELETE COLLECTION
// DELETE /collections/:id
// ============================================================

router.delete("/delete/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // --------------------------------------------------------
    // GET IMAGE BEFORE DELETE
    // --------------------------------------------------------

    const existing = await pool.query(
      `
      SELECT
        id,
        category,
        image_url
      FROM collections
      WHERE id = $1
      `,
      [id]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({
        message: "Collection not found",
      });
    }

    const collection = existing.rows[0];

    // --------------------------------------------------------
    // DELETE FROM DATABASE
    // --------------------------------------------------------

    await pool.query(
      `
      DELETE FROM collections
      WHERE id = $1
      `,
      [id]
    );

    // --------------------------------------------------------
    // DELETE IMAGE FROM CLOUDINARY
    // --------------------------------------------------------

    const publicId = getCloudinaryPublicId(
      collection.image_url
    );

    if (publicId) {
      await deleteFromCloudinary(publicId);
    }

    res.json({
      message: "Collection deleted successfully",
      collection: {
        id: collection.id,
        category: collection.category,
      },
    });
  } catch (error) {
    console.error("DELETE COLLECTION ERROR:", error);

    res.status(500).json({
      message: "Failed to delete collection",
      error: error.message,
    });
  }
});

module.exports = router;