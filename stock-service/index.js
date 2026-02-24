const express = require("express");
require("dotenv").config();

const app = express();
app.use(express.json());

// Health check
app.get("/health", (req, res) => {
  res.status(200).send("Stock Service OK");
});

// Example route
app.get("/stock/:item", (req, res) => {
  const item = req.params.item;

  res.json({
    item: item,
    available: true,
    quantity: 100
  });
});

app.listen(3003, () => {
  console.log("Stock Service running on port 3003");
});