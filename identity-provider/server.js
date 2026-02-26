const express = require("express");
const jwt = require("jsonwebtoken");
const dotenv = require("dotenv");
const bcrypt = require("bcryptjs");
const cors = require("cors");

dotenv.config();
process.env.JWT_SECRET = process.env.JWT_SECRET || 'iut_iftar_secret_key';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

app.get("/", (req, res) => {
  res.send("Server is running 🚀");
});

const users = [
  {
    id: 1,
    name: "Tonoy",
    email: "tonoy@iut-dhaka.edu",
    password: bcrypt.hashSync("tonoy123", 10)
  },
  {
    id: 2,
    name: "Sabin",
    email: "sabin@iut-dhaka.edu",
    password: bcrypt.hashSync("sabin123", 10)
  },
  {
    id: 3,
    name: "Sakib",
    email: "sakib@iut-dhaka.edu",
    password: bcrypt.hashSync("sakib123", 10)
  }
];

app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ message: "Email and password required" });

  const user = users.find(u => u.email === email);
  if (!user) return res.status(401).json({ message: "Invalid credentials" });

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) return res.status(401).json({ message: "Invalid credentials" });

  const token = jwt.sign(
    { id: user.id, email: user.email, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );

  res.json({ message: "Login successful", token, name: user.name });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});