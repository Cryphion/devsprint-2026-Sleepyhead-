const express = require("express");
require("dotenv").config();

const app = express();
app.use(express.json());

// Health check
app.get("/health", (req, res) => {
  res.status(200).send("Order Gateway OK");
});

// Example route
app.post("/order", (req, res) => {
  const order = req.body;
  res.status(201).json({
    message: "Order received",
    data: order
  });
});

app.listen(3002, () => {
  console.log("Order Gateway running on port 3002");
});