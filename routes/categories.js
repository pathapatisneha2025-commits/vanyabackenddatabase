const express = require("express");
const router = express.Router();

const pool = require("../db");

// ============================================================
// GET ALL COLLECTIONS
// GET /collections
// ============================================================

router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT
        id,
        category,
        image_url,
        created_at
      FROM collections
      ORDER BY id DESC
      `
    );

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
// ============================================================

router.post("/", async (req, res) => {
  try {
    const { category, image_url } = req.body;

    if (!category || !category.trim()) {
      return res.status(400).json({
        message: "Category name is required",
      });
    }

    if (!image_url || !image_url.trim()) {
      return res.status(400).json({
        message: "Collection image is required",
      });
    }

    // Check if category already exists
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
        image_url.trim(),
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
// ============================================================

router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { category, image_url } = req.body;

    if (!category || !category.trim()) {
      return res.status(400).json({
        message: "Category name is required",
      });
    }

    if (!image_url || !image_url.trim()) {
      return res.status(400).json({
        message: "Collection image is required",
      });
    }

    const existing = await pool.query(
      `
      SELECT id
      FROM collections
      WHERE LOWER(TRIM(category)) = LOWER(TRIM($1))
      AND id != $2
      `,
      [category, id]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({
        message: "Another category with this name already exists",
      });
    }

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
        image_url.trim(),
        id,
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Collection not found",
      });
    }

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

router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `
      DELETE FROM collections
      WHERE id = $1
      RETURNING id, category
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Collection not found",
      });
    }

    res.json({
      message: "Collection deleted successfully",
      collection: result.rows[0],
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