// Points to stock-service on port 3002 (NOT order-gateway on 3000)
const API = "http://localhost:3002/api/stocks";

async function loadStocks() {
  const res = await fetch(API);
  if (!res.ok) {
    console.error("Failed to load stocks:", res.status);
    return;
  }
  const data = await res.json();

  const list = document.getElementById("list");
  list.innerHTML = "";

  data.forEach((stock) => {
    const li = document.createElement("li");
    li.innerHTML = `
      ${stock.name} — Qty: <strong>${stock.quantity}</strong>
      <button onclick="deleteStock(${stock.id})">Delete</button>
    `;
    list.appendChild(li);
  });
}

async function addStock() {
  const name = document.getElementById("name").value.trim();
  const qty = document.getElementById("qty").value;

  if (!name || qty === "") {
    alert("Please enter both a name and quantity.");
    return;
  }

  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, quantity: parseInt(qty) }),
  });

  if (!res.ok) {
    const err = await res.json();
    alert("Error: " + (err.error || "Unknown error"));
    return;
  }

  document.getElementById("name").value = "";
  document.getElementById("qty").value = "";
  loadStocks();
}

async function deleteStock(id) {
  await fetch(`${API}/${id}`, { method: "DELETE" });
  loadStocks();
}

loadStocks();