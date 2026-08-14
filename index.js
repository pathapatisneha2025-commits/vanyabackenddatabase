const express = require("express");
const cors = require("cors");
const AddSareeProducts = require("./routes/products");
const Cart = require("./routes/cart");
const Orders = require("./routes/orders");
const AuthLogin = require("./routes/Auth");
const Reviews = require("./routes/reviews");
const Contact = require("./routes/contact");
const ScanQr = require("./routes/onlinepaymentsettings");







const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use("/products",AddSareeProducts);
app.use("/cart",Cart);
app.use("/orders",Orders);
app.use("/auth",AuthLogin);
app.use("/review",Reviews);
app.use("/contact",Contact);
app.use("/scanqr",ScanQr);




// Test Route
app.get("/", (req, res) => {
  res.send("Backend is running...");
});

// Start Server
const PORT = 5000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
