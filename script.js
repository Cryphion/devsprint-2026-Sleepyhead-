const API = "http://localhost:3000/api/stocks";

async function loadStocks() {
    const res = await fetch(API);
    const data = await res.json();

    const list = document.getElementById("list");
    list.innerHTML = "";

    data.forEach(stock => {
        const li = document.createElement("li");
        li.innerHTML = `
            ${stock.name} - ${stock.quantity}
            <button onclick="deleteStock(${stock.id})">Delete</button>
        `;
        list.appendChild(li);
    });
}

async function addStock() {
    const name = document.getElementById("name").value;
    const qty = document.getElementById("qty").value;

    await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, quantity: qty })
    });

    document.getElementById("name").value = "";
    document.getElementById("qty").value = "";

    loadStocks();
}

// 🔥 Delete single item
async function deleteStock(id) {
    await fetch(`${API}/${id}`, {
        method: "DELETE"
    });
    loadStocks();
}

loadStocks();