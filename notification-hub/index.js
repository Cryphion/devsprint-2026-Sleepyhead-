const express = require("express");
require("dotenv").config();

const app = express();
app.use(express.json());

// Health check
app.get("/health", (req, res) => {
  res.status(200).send("Notification Hub OK");
});

// Example route
app.post("/notify", (req, res) => {
  const { user, message } = req.body;

  res.json({
    status: "Notification sent",
    user,
    message
  });
});

app.listen(3005, () => {
  console.log("Notification Hub running on port 3005");
});