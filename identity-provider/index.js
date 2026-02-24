const express = require("express");
const app = express();

app.get("/health", (req, res) => {
  res.status(200).send("Identity Provider OK");
});

app.listen(3001, () => {
  console.log("Identity Provider running on port 3001");
});