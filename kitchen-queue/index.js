const express = require("express");
require("dotenv").config();

const app = express();
app.use(express.json());

// Health check
app.get("/health", (req, res) => {
  res.status(200).send("Kitchen Queue OK");
});

// Example route
app.post("/enqueue", (req, res) => {
  const order = req.body;

  res.json({
    message: "Order added to kitchen queue",
    order: order
  });
});

app.listen(3004, () => {
  console.log("Kitchen Queue running on port 3004");
});