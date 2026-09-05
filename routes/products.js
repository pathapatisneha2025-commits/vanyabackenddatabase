const express = require("express");
const router = express.Router();
const pool = require("../db"); // PostgreSQL pool
const multer = require("multer");
const { Readable } = require("stream");
const cloudinary = require("../cloudinary"); // configured Cloudinary instance
const csvParser = require("csv-parser");
const XLSX = require("xlsx");

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
   BULK UPLOAD PRODUCTS - CSV
   POST /products/bulk-upload-csv
====================================================== */



router.post(
  "/bulk-upload-csv",
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "CSV file is required",
        });
      }

      const products = [];

      // ==================================================
      // PARSE CSV
      // ==================================================

      const stream = Readable.from(req.file.buffer);

      stream
        .pipe(csvParser())
        .on("data", (row) => {
          products.push(row);
        })
        .on("end", async () => {
          try {
            if (!products.length) {
              return res.status(400).json({
                success: false,
                message: "CSV file is empty",
              });
            }

            const insertedProducts = [];
            const errors = [];

            // ==================================================
            // INSERT EACH PRODUCT
            // ==================================================

            for (let i = 0; i < products.length; i++) {
              const product = products[i];

              try {
                const name = product.name?.trim();
                const category =
                  product.category?.trim() ||
                  product.cat?.trim();

                const subCategory =
                  product.sub_category?.trim() ||
                  product.subCategory?.trim() ||
                  null;

                const price =
                  Number(product.price) || 0;

                const oldPrice =
                  Number(product.old_price) ||
                  Number(product.oldPrice) ||
                  0;

                const stock =
                  Number(product.stock) || 0;

                const type =
                  product.type?.trim() ||
                  "Regular";

                // ============================================
                // VALIDATION
                // ============================================

                if (!name) {
                  throw new Error("Product name is required");
                }

                if (!category) {
                  throw new Error("Category is required");
                }

                const discount = calculateDiscount(
                  price,
                  oldPrice
                );

                // ============================================
                // INSERT
                // ============================================

                const result = await pool.query(
                  `
                  INSERT INTO vanayaproducts
                  (
                    name,
                    category,
                    sub_category,
                    price,
                    old_price,
                    discount,
                    stock,
                    type,
                    img_url,
                    thumbnails,
                    variants,
                    created_at
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
                    $11::jsonb,
                    CURRENT_TIMESTAMP
                  )
                  RETURNING *
                  `,
                  [
                    name,
                    category,
                    subCategory,
                    price,
                    oldPrice,
                    discount,
                    stock,
                    type,
                    product.img_url?.trim() || null,
                    JSON.stringify([]),
                    JSON.stringify([]),
                  ]
                );

                insertedProducts.push(
                  result.rows[0]
                );
              } catch (error) {
                errors.push({
                  row: i + 2,
                  name: product.name || "",
                  error: error.message,
                });
              }
            }

            // ==================================================
            // RESPONSE
            // ==================================================

            return res.status(201).json({
              success: true,
              message: "CSV bulk upload completed",
              totalRows: products.length,
              inserted: insertedProducts.length,
              failed: errors.length,
              errors,
              products: insertedProducts,
            });
          } catch (error) {
            console.error(
              "CSV PROCESSING ERROR:",
              error
            );

            return res.status(500).json({
              success: false,
              message: "Failed to process CSV",
              error: error.message,
            });
          }
        })
        .on("error", (error) => {
          console.error(
            "CSV PARSE ERROR:",
            error
          );

          return res.status(500).json({
            success: false,
            message: "Invalid CSV file",
            error: error.message,
          });
        });
    } catch (error) {
      console.error(
        "CSV UPLOAD ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message: "Server error",
        error: error.message,
      });
    }
  }
);


/* ======================================================
   BULK UPLOAD PRODUCTS - EXCEL
   POST /products/bulk-upload-excel
====================================================== */


router.post(
  "/bulk-upload-excel",
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "Excel file is required",
        });
      }

      // ==================================================
      // READ EXCEL FILE
      // ==================================================

      const workbook = XLSX.read(
        req.file.buffer,
        {
          type: "buffer",
        }
      );

      // Get first sheet
      const sheetName =
        workbook.SheetNames[0];

      if (!sheetName) {
        return res.status(400).json({
          success: false,
          message: "Excel file contains no sheets",
        });
      }

      const worksheet =
        workbook.Sheets[sheetName];

      // Convert sheet to JSON
      const products =
        XLSX.utils.sheet_to_json(
          worksheet,
          {
            defval: "",
          }
        );

      // ==================================================
      // CHECK EMPTY FILE
      // ==================================================

      if (!products.length) {
        return res.status(400).json({
          success: false,
          message: "Excel file is empty",
        });
      }

      const insertedProducts = [];
      const errors = [];

      // ==================================================
      // INSERT PRODUCTS
      // ==================================================

      for (let i = 0; i < products.length; i++) {
        const product = products[i];

        try {
          const name =
            String(
              product.name || ""
            ).trim();

          const category =
            String(
              product.category ||
                product.cat ||
                ""
            ).trim();

          const subCategory =
            String(
              product.sub_category ||
                product.subCategory ||
                ""
            ).trim() || null;

          const price =
            Number(product.price) || 0;

          const oldPrice =
            Number(
              product.old_price ||
                product.oldPrice ||
                0
            );

          const stock =
            Number(product.stock) || 0;

          const type =
            String(
              product.type ||
                "Regular"
            ).trim();

          // ==============================================
          // VALIDATION
          // ==============================================

          if (!name) {
            throw new Error(
              "Product name is required"
            );
          }

          if (!category) {
            throw new Error(
              "Category is required"
            );
          }

          const discount =
            calculateDiscount(
              price,
              oldPrice
            );

          // ==============================================
          // INSERT
          // ==============================================

          const result =
            await pool.query(
              `
              INSERT INTO vanayaproducts
              (
                name,
                category,
                sub_category,
                price,
                old_price,
                discount,
                stock,
                type,
                img_url,
                thumbnails,
                variants,
                created_at
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
                $11::jsonb,
                CURRENT_TIMESTAMP
              )
              RETURNING *
              `,
              [
                name,
                category,
                subCategory,
                price,
                oldPrice,
                discount,
                stock,
                type,

                // Optional image URL
                String(
                  product.img_url ||
                    ""
                ).trim() || null,

                JSON.stringify([]),

                JSON.stringify([]),
              ]
            );

          insertedProducts.push(
            result.rows[0]
          );
        } catch (error) {
          errors.push({
            row: i + 2,
            name:
              product.name || "",
            error: error.message,
          });
        }
      }

      // ==================================================
      // RESPONSE
      // ==================================================

      return res.status(201).json({
        success: true,
        message:
          "Excel bulk upload completed",

        totalRows:
          products.length,

        inserted:
          insertedProducts.length,

        failed:
          errors.length,

        errors,

        products:
          insertedProducts,
      });
    } catch (error) {
      console.error(
        "EXCEL UPLOAD ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to process Excel file",
        error:
          error.message,
      });
    }
  }
);
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
const variantUploadFields = [];

for (let i = 0; i < 20; i++) {
  variantUploadFields.push(
    { name: `variant_${i}_main`, maxCount: 1 },
    { name: `variant_${i}_thumbnails`, maxCount: 5 }
  );
}

router.post(
  "/add",
  upload.fields([
    { name: "img_url", maxCount: 1 },
    { name: "thumbnails", maxCount: 5 },
    ...variantUploadFields
  ]),
  async (req, res) => {
    try {
      const {
        name,
        cat,
        subCategory,
        price,
        oldPrice,
        stock,
        type,
        variants,
        variantImageMeta
      } = req.body;

      const discount = calculateDiscount(price, oldPrice);

      // ============================================================
      // PARSE VARIANTS
      // ============================================================

      let parsedVariants = [];

      if (variants) {
        try {
          parsedVariants =
            typeof variants === "string"
              ? JSON.parse(variants)
              : variants;

          if (!Array.isArray(parsedVariants)) {
            parsedVariants = [];
          }
        } catch (error) {
          console.error("Error parsing variants:", error);
          parsedVariants = [];
        }
      }

      // ============================================================
      // UPLOAD MAIN PRODUCT IMAGE
      // ============================================================

      let mainImageUrl = null;

      if (req.files?.img_url?.length) {
        const result = await uploadToCloudinary(
          req.files.img_url[0].buffer
        );

        mainImageUrl = result.secure_url;
      }

      // ============================================================
      // UPLOAD PRODUCT THUMBNAILS
      // ============================================================

      let thumbnailUrls = [];

      if (req.files?.thumbnails?.length) {
        for (const file of req.files.thumbnails) {
          const result = await uploadToCloudinary(file.buffer);

          thumbnailUrls.push(result.secure_url);
        }
      }

      // ============================================================
      // UPLOAD VARIANT IMAGES
      // ============================================================

      for (let i = 0; i < parsedVariants.length; i++) {

        const variant = parsedVariants[i];

        // ---------------- MAIN IMAGE ----------------

        const mainField = `variant_${i}_main`;

        if (req.files?.[mainField]?.length) {

          const result = await uploadToCloudinary(
            req.files[mainField][0].buffer
          );

          variant.mainImage = result.secure_url;
        } else {

          variant.mainImage =
            variant.existingMainImage || "";
        }

        // ---------------- THUMBNAILS ----------------

        const thumbnailField =
          `variant_${i}_thumbnails`;

        let variantThumbnailUrls = [];

        if (req.files?.[thumbnailField]?.length) {

          for (
            const file of req.files[thumbnailField]
          ) {

            const result =
              await uploadToCloudinary(
                file.buffer
              );

            variantThumbnailUrls.push(
              result.secure_url
            );
          }

        } else {

          variantThumbnailUrls =
            variant.existingThumbnails || [];
        }

        variant.thumbnails =
          variantThumbnailUrls;

        // Remove temporary frontend fields

        delete variant.existingMainImage;
        delete variant.existingThumbnails;
        delete variant.mainImageField;
        delete variant.thumbnailField;
      }

      // ============================================================
      // INSERT PRODUCT
      // ============================================================

      const result = await pool.query(
        `INSERT INTO vanayaproducts
        (
          name,
          category,
          sub_category,
          price,
          old_price,
          discount,
          stock,
          type,
          img_url,
          thumbnails,
          variants,
          created_at
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
          $10::jsonb,
          $11::jsonb,
          CURRENT_TIMESTAMP
        )
        RETURNING *`,
        [
          name,
          cat,
          subCategory || null,
          Number(price) || 0,
          Number(oldPrice) || 0,
          discount,
          Number(stock) || 0,
          type || "Regular",
          mainImageUrl,
          JSON.stringify(thumbnailUrls),
          JSON.stringify(parsedVariants)
        ]
      );

      // ============================================================
      // RESPONSE
      // ============================================================

      res.status(201).json({
        success: true,
        product: result.rows[0]
      });

    } catch (err) {

      console.error(
        "ADD PRODUCT ERROR:",
        err
      );

      res.status(500).json({
        success: false,
        error: "Server error",
        message: err.message
      });
    }
  }
);

/* ======================================================
   UPDATE PRODUCT
====================================================== */
router.put(
  "/update/:id",

  // ============================================================
  // IMPORTANT
  // upload.any() allows:
  //
  // img_url
  // thumbnails
  // variant_0_main
  // variant_0_thumbnails
  // variant_1_main
  // variant_1_thumbnails
  // variant_2_main
  // variant_2_thumbnails
  //
  // etc.
  // ============================================================

  upload.any(),

  async (req, res) => {
    try {
      console.log("======================================");
      console.log("UPDATE PRODUCT REQUEST");
      console.log("Product ID:", req.params.id);
      console.log("Body:", req.body);
      console.log(
        "Files:",
        req.files?.map((file) => ({
          fieldname: file.fieldname,
          originalname: file.originalname,
        }))
      );
      console.log("======================================");

      // ============================================================
      // BASIC DATA
      // ============================================================

      const {
        name,
        cat,
        subCategory,
        price,
        oldPrice,
        stock,
        type,

        existingMainImage,
        existingThumbnails,

        variants,
        variantImageMeta,
      } = req.body;

      // ============================================================
      // HELPER
      // ============================================================

      const files = Array.isArray(req.files)
        ? req.files
        : [];

      const getFilesByField = (fieldName) => {
        return files.filter(
          (file) => file.fieldname === fieldName
        );
      };

      const getFirstFileByField = (fieldName) => {
        return files.find(
          (file) => file.fieldname === fieldName
        );
      };

      // ============================================================
      // CALCULATE PRODUCT DISCOUNT
      // ============================================================

      const discount = calculateDiscount(
        price,
        oldPrice
      );

      // ============================================================
      // PARSE VARIANTS
      // ============================================================

      let parsedVariants = [];

      if (variants) {
        try {
          parsedVariants =
            typeof variants === "string"
              ? JSON.parse(variants)
              : variants;

          if (!Array.isArray(parsedVariants)) {
            parsedVariants = [];
          }
        } catch (error) {
          console.error(
            "ERROR PARSING VARIANTS:",
            error
          );

          parsedVariants = [];
        }
      }

      // ============================================================
      // PARSE VARIANT IMAGE METADATA
      // ============================================================

      let parsedVariantImageMeta = [];

      if (variantImageMeta) {
        try {
          parsedVariantImageMeta =
            typeof variantImageMeta === "string"
              ? JSON.parse(variantImageMeta)
              : variantImageMeta;

          if (
            !Array.isArray(
              parsedVariantImageMeta
            )
          ) {
            parsedVariantImageMeta = [];
          }
        } catch (error) {
          console.error(
            "ERROR PARSING VARIANT IMAGE META:",
            error
          );

          parsedVariantImageMeta = [];
        }
      }

      // ============================================================
      // PRODUCT MAIN IMAGE
      // ============================================================

      let mainImageUrl =
        existingMainImage || null;

      const mainImageFile =
        getFirstFileByField("img_url");

      if (mainImageFile) {
        console.log(
          "Uploading new product main image..."
        );

        const result =
          await uploadToCloudinary(
            mainImageFile.buffer
          );

        mainImageUrl =
          result.secure_url;

        console.log(
          "Product main image uploaded:",
          mainImageUrl
        );
      }

      // ============================================================
      // PRODUCT THUMBNAILS
      // ============================================================

      let thumbnailUrls = [];

      // Existing product thumbnails
      if (existingThumbnails) {
        try {
          thumbnailUrls =
            typeof existingThumbnails ===
            "string"
              ? JSON.parse(
                  existingThumbnails
                )
              : existingThumbnails;

          if (
            !Array.isArray(
              thumbnailUrls
            )
          ) {
            thumbnailUrls = [];
          }
        } catch (error) {
          console.error(
            "ERROR PARSING PRODUCT THUMBNAILS:",
            error
          );

          thumbnailUrls = [];
        }
      }

      // New product thumbnails
      const productThumbnailFiles =
        getFilesByField(
          "thumbnails"
        );

      if (
        productThumbnailFiles.length
      ) {
        console.log(
          "Uploading product thumbnails:",
          productThumbnailFiles.length
        );

        for (const file of productThumbnailFiles) {
          const result =
            await uploadToCloudinary(
              file.buffer
            );

          thumbnailUrls.push(
            result.secure_url
          );
        }
      }

      // ============================================================
      // PROCESS COLOUR VARIANT IMAGES
      // ============================================================

      const finalVariants =
        [];

      for (
        let index = 0;
        index < parsedVariants.length;
        index++
      ) {
        const variant =
          parsedVariants[index];

        const meta =
          parsedVariantImageMeta.find(
            (item) =>
              Number(
                item.colourIndex
              ) === index
          ) || {};

        // ========================================================
        // BASIC VARIANT
        // ========================================================

        const cleanVariant = {
          colour:
            variant.colour || "",
        };

        // ========================================================
        // DRESS VARIANT
        // ========================================================

        if (
          Array.isArray(
            variant.sizes
          )
        ) {
          cleanVariant.sizes =
            variant.sizes.map(
              (size) => ({
                size:
                  size.size || "",

                price:
                  Number(
                    size.price || 0
                  ),

                oldPrice:
                  Number(
                    size.oldPrice ||
                      size.old_price ||
                      0
                  ),

                discount:
                  Number(
                    size.discount ||
                      0
                  ),

                stock:
                  Number(
                    size.stock || 0
                  ),
              })
            );
        }

        // ========================================================
        // SAREE VARIANT
        // ========================================================

        else {
          cleanVariant.price =
            Number(
              variant.price || 0
            );

          cleanVariant.oldPrice =
            Number(
              variant.oldPrice ||
                variant.old_price ||
                0
            );

          cleanVariant.discount =
            Number(
              variant.discount ||
                0
            );

          cleanVariant.stock =
            Number(
              variant.stock || 0
            );
        }

        // ========================================================
        // EXISTING MAIN IMAGE
        // ========================================================

        let variantMainImage =
          meta.existingMainImage ||
          variant.existingMainImage ||
          "";

        // ========================================================
        // NEW MAIN IMAGE
        //
        // Example:
        //
        // variant_0_main
        // variant_1_main
        // variant_2_main
        // ========================================================

        const mainImageField =
          meta.mainImageField ||
          variant.mainImageField ||
          "";

        if (mainImageField) {
          const variantMainFile =
            getFirstFileByField(
              mainImageField
            );

          if (variantMainFile) {
            console.log(
              `Uploading main image for variant ${index}...`
            );

            const result =
              await uploadToCloudinary(
                variantMainFile.buffer
              );

            variantMainImage =
              result.secure_url;

            console.log(
              `Variant ${index} main image:`,
              variantMainImage
            );
          }
        }

        // ========================================================
        // EXISTING VARIANT THUMBNAILS
        // ========================================================

        let variantThumbnailUrls =
          [];

        if (
          Array.isArray(
            meta.existingThumbnails
          )
        ) {
          variantThumbnailUrls =
            meta.existingThumbnails.filter(
              (url) =>
                typeof url ===
                "string" &&
                url.trim() !== ""
            );
        } else if (
          Array.isArray(
            variant.existingThumbnails
          )
        ) {
          variantThumbnailUrls =
            variant.existingThumbnails.filter(
              (url) =>
                typeof url ===
                "string" &&
                url.trim() !== ""
            );
        } else if (
          Array.isArray(
            variant.thumbnails
          )
        ) {
          variantThumbnailUrls =
            variant.thumbnails.filter(
              (url) =>
                typeof url ===
                "string" &&
                url.trim() !== ""
            );
        }

        // ========================================================
        // NEW VARIANT THUMBNAILS
        //
        // Example:
        //
        // variant_0_thumbnails
        // variant_1_thumbnails
        // ========================================================

        const thumbnailField =
          meta.thumbnailField ||
          variant.thumbnailField ||
          `variant_${index}_thumbnails`;

        const variantThumbnailFiles =
          getFilesByField(
            thumbnailField
          );

        if (
          variantThumbnailFiles.length
        ) {
          console.log(
            `Uploading ${variantThumbnailFiles.length} thumbnails for variant ${index}...`
          );

          for (
            const file of variantThumbnailFiles
          ) {
            const result =
              await uploadToCloudinary(
                file.buffer
              );

            variantThumbnailUrls.push(
              result.secure_url
            );
          }
        }

        // ========================================================
        // ADD IMAGES TO VARIANT
        // ========================================================

        cleanVariant.mainImage =
          variantMainImage;

        cleanVariant.thumbnails =
          variantThumbnailUrls;

        // ========================================================
        // DO NOT STORE TEMPORARY FRONTEND FIELDS
        //
        // We intentionally only store:
        //
        // colour
        // price / oldPrice / discount / stock
        // sizes
        // mainImage
        // thumbnails
        // ========================================================

        finalVariants.push(
          cleanVariant
        );
      }

      // ============================================================
      // DEBUG FINAL VARIANTS
      // ============================================================

      console.log(
        "======================================"
      );

      console.log(
        "FINAL VARIANTS:"
      );

      console.log(
        JSON.stringify(
          finalVariants,
          null,
          2
        )
      );

      console.log(
        "======================================"
      );

      // ============================================================
      // UPDATE DATABASE
      // ============================================================

      const result =
        await pool.query(
          `
          UPDATE vanayaproducts
          SET
            name = $1,
            category = $2,
            sub_category = $3,
            price = $4,
            old_price = $5,
            discount = $6,
            stock = $7,
            type = $8,
            img_url = $9,
            thumbnails = $10,
            variants = $11::jsonb,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = $12
          RETURNING *
          `,
          [
            name,

            cat,

            subCategory ||
              null,

            Number(price) ||
              0,

            Number(oldPrice) ||
              0,

            discount,

            Number(stock) ||
              0,

            type ||
              "Regular",

            mainImageUrl,

            JSON.stringify(
              thumbnailUrls
            ),

            JSON.stringify(
              finalVariants
            ),

            req.params.id,
          ]
        );

      // ============================================================
      // PRODUCT NOT FOUND
      // ============================================================

      if (
        !result.rows.length
      ) {
        return res.status(404).json({
          success: false,
          error:
            "Product not found",
        });
      }

      // ============================================================
      // SUCCESS
      // ============================================================

      return res.status(200).json({
        success: true,

        message:
          "Product updated successfully",

        product:
          result.rows[0],
      });
    } catch (err) {
      // ============================================================
      // ERROR
      // ============================================================

      console.error(
        "======================================"
      );

      console.error(
        "UPDATE PRODUCT ERROR:"
      );

      console.error(err);

      console.error(
        "======================================"
      );

      return res.status(500).json({
        success: false,

        error:
          "Server error",

        message:
          err.message,
      });
    }
  }
);
/* ======================================================
   GET ALL PRODUCTS
====================================================== */
router.get("/all", async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM vanayaproducts ORDER BY id DESC`);
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
    const result = await pool.query(`SELECT * FROM vanayaproducts WHERE id=$1`, [req.params.id]);
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
    const result = await pool.query(`DELETE FROM vanayaproducts WHERE id=$1`, [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: "Product not found" });
    res.json({ message: "Product deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;