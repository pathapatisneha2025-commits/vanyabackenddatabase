const express = require("express");
const router = express.Router();
const pool = require("../db"); // PostgreSQL pool
const multer = require("multer");
const { Readable } = require("stream");
const cloudinary = require("../cloudinary"); // configured Cloudinary instance

/* ================================
   MULTER MEMORY STORAGE
================================ */
const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } }); // 5MB max

/* ================================
   CLOUDINARY UPLOAD HELPER
================================ */
const uploadToCloudinary = (buffer, folder = "vanyaproducts") => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({ folder }, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
    const readable = new Readable();
    readable._read = () => {};
    readable.push(buffer);
    readable.push(null);
    readable.pipe(stream);
  });
};

/* ======================================================
   HELPER: Calculate Discount %
====================================================== */
const calculateDiscount = (price, oldPrice) => {
  price = Number(price);
  oldPrice = Number(oldPrice);
  if (!price || !oldPrice || oldPrice <= price) return 0;
  return Math.round(((oldPrice - price) / oldPrice) * 100);
};

/* ======================================================
   ADD PRODUCT
====================================================== */
router.post(
  "/add",
  upload.fields([
    { name: "img_url", maxCount: 1 },
    { name: "thumbnails", maxCount: 5 },
  ]),
  async (req, res) => {
    try {
      const { name, cat, subCategory, price, oldPrice, stock, type } = req.body; // <-- added subCategory
      const discount = calculateDiscount(price, oldPrice);

      // Upload main image
      let mainImageUrl = null;
      if (req.files?.img_url?.length) {
        const result = await uploadToCloudinary(req.files.img_url[0].buffer);
        mainImageUrl = result.secure_url;
      }

      // Upload thumbnails
      let thumbnailUrls = [];
      if (req.files?.thumbnails?.length) {
        for (const file of req.files.thumbnails) {
          const result = await uploadToCloudinary(file.buffer);
          thumbnailUrls.push(result.secure_url);
        }
      }

      // Insert into DB including subCategory
      const result = await pool.query(
        `INSERT INTO vanayaproducts 
          (name, category, sub_category, price, old_price, discount, stock, type, img_url, thumbnails, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,CURRENT_TIMESTAMP)
         RETURNING *`,
        [
          name,
          cat,
          subCategory || null, // <-- save subCategory
          Number(price),
          Number(oldPrice),
          discount,
          Number(stock),
          type || 'Regular',
          mainImageUrl,
          JSON.stringify(thumbnailUrls),
        ]
      );

      res.json({ product: result.rows[0] });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  }
);

/* ======================================================
   UPDATE PRODUCT
====================================================== */
router.put(
  "/update/:id",
  upload.fields([
    { name: "img_url", maxCount: 1 },
    { name: "thumbnails", maxCount: 5 },
  ]),
  async (req, res) => {
    try {
      const { name, cat, subCategory, price, oldPrice, stock, type, existingMainImage, existingThumbnails } = req.body; // <-- added subCategory
      const discount = calculateDiscount(price, oldPrice);

      // --- Main image ---
      let mainImageUrl = existingMainImage || null;
      if (req.files?.img_url?.length) {
        const result = await uploadToCloudinary(req.files.img_url[0].buffer);
        mainImageUrl = result.secure_url;
      }

      // --- Thumbnails ---
      let thumbnailUrls = existingThumbnails ? JSON.parse(existingThumbnails) : [];
      if (req.files?.thumbnails?.length) {
        for (const file of req.files.thumbnails) {
          const result = await uploadToCloudinary(file.buffer);
          thumbnailUrls.push(result.secure_url);
        }
      }

      // --- Update product in DB ---
      const result = await pool.query(
        `UPDATE products
         SET name=$1,
             category=$2,
             sub_category=$3,  -- <-- added subCategory column
             price=$4,
             old_price=$5,
             discount=$6,
             stock=$7,
             type=$8,
             img_url=$9,
             thumbnails=$10,
             updated_at=CURRENT_TIMESTAMP
         WHERE id=$11
         RETURNING *`,
        [
          name,
          cat,
          subCategory || null, // <-- send subCategory
          Number(price),
          Number(oldPrice),
          discount,
          Number(stock),
          type || 'Regular',
          mainImageUrl,
          JSON.stringify(thumbnailUrls),
          req.params.id,
        ]
      );

      if (!result.rows.length)
        return res.status(404).json({ error: "Product not found" });

      res.json({ product: result.rows[0] });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  }
);

/* ======================================================
   GET ALL PRODUCTS
====================================================== */
router.get("/all", async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM products ORDER BY id DESC`);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ======================================================
   GET PRODUCT BY ID
====================================================== */
router.get("/:id", async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM products WHERE id=$1`, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: "Product not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ======================================================
   DELETE PRODUCT
====================================================== */
router.delete("/delete/:id", async (req, res) => {
  try {
    const result = await pool.query(`DELETE FROM products WHERE id=$1`, [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: "Product not found" });
    res.json({ message: "Product deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;