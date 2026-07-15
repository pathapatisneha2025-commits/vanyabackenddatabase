const express = require("express");
const router = express.Router();
const db = require("../db"); // adjust path if needed

// ✅ Get reviews for a product
router.get("/:productId", async (req, res) => {
  try {
    const { productId } = req.params;

    const reviews = await db.query(
      "SELECT * FROM reviews WHERE product_id = $1 ORDER BY created_at DESC",
      [productId]
    );

    res.json(reviews.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch reviews" });
  }
});

// ✅ Add review
router.post("/add", async (req, res) => {
  try {
    const { user_id, product_id, rating, comment } = req.body;

    const newReview = await db.query(
      "INSERT INTO vanayareviews (user_id, product_id, rating, comment) VALUES ($1,$2,$3,$4) RETURNING *",
      [user_id, product_id, rating, comment]
    );

    res.json(newReview.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to add review" });
  }
});
// Add wishlist
router.post("/wishlist/add", async(req,res)=>{

try{

const {user_id,product_id}=req.body;


const result = await db.query(
`
INSERT INTO wishlist(user_id,product_id)
VALUES($1,$2)
RETURNING *
`,
[
user_id,
product_id
]
);


res.json({
success:true,
wishlist:result.rows[0]
});


}
catch(err){

console.log(err);

res.status(500).json({
success:false,
error:"Wishlist add failed"
});

}

});


// Get wishlist by user_id
router.get("/wishlist/:user_id", async(req,res)=>{

try{

const {user_id}=req.params;


const result = await db.query(
`
SELECT 
    w.id AS wishlist_id,
    w.created_at,
    p.*
FROM wishlist w
JOIN products p
ON w.product_id = p.id
WHERE w.user_id=$1
ORDER BY w.created_at DESC
`,
[
user_id
]
);


res.json({
success:true,
wishlist:result.rows
});


}
catch(err){

console.log(err);

res.status(500).json({
success:false,
error:"Failed to fetch wishlist"
});

}

});

module.exports = router;