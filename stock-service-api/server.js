const express = require("express");
const fs = require("fs");
const cors = require("cors");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

const DATA_FILE = "data.json";

// Read data
function readData() {
    if (!fs.existsSync(DATA_FILE)) {
        fs.writeFileSync(DATA_FILE, JSON.stringify([]));
    }
    return JSON.parse(fs.readFileSync(DATA_FILE));
}

// Write data
function writeData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// GET all stocks
app.get("/api/stocks", (req, res) => {
    const stocks = readData();
    res.json(stocks);
});

// POST add stock
app.post("/api/stocks", (req, res) => {
    const stocks = readData();
    const newStock = {
        id: Date.now(),
        name: req.body.name,
        quantity: req.body.quantity
    };

    stocks.push(newStock);
    writeData(stocks);

    res.json({ message: "Stock added!" });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
// Delete single stock by id
app.delete('/api/stocks/:id', (req, res) => {
    const id = req.params.id;
    let data = readData();

    data = data.filter(item => item.id != id);
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));

    res.json({ message: "Item deleted" });
});