let token = null;
let totalOrders = 0;
let services = {
    stock: true,
    kitchen: true
};

// Section Switch
function showSection(id) {
    document.querySelectorAll('.section').forEach(sec => sec.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

// Login Simulation
function login() {
    const id = document.getElementById("studentId").value;
    const pass = document.getElementById("password").value;

    if (id && pass) {
        token = "fake-jwt-token";
        document.getElementById("loginMessage").innerText = "Authenticated! JWT issued.";
    } else {
        document.getElementById("loginMessage").innerText = "Invalid credentials.";
    }
}

// Order Placement Flow
function placeOrder(item) {

    if (!token) {
        alert("401 Unauthorized. Login first.");
        return;
    }

    if (!services.stock) {
        alert("Stock Service Down!");
        return;
    }

    totalOrders++;
    document.getElementById("totalOrders").innerText = totalOrders;

    updateStatus("Pending");

    setTimeout(() => {
        updateStatus("Stock Verified");

        if (!services.kitchen) {
            updateStatus("Kitchen Service Failed ❌");
            return;
        }

        setTimeout(() => {
            updateStatus("In Kitchen");

            setTimeout(() => {
                updateStatus("Ready ✅");
                simulateLatency();
            }, 3000);

        }, 2000);

    }, 1500);
}

// Update Status
function updateStatus(status) {
    document.getElementById("orderStatus").innerText = status;
}

// Simulate Latency
function simulateLatency() {
    const latency = Math.floor(Math.random() * 1000);
    document.getElementById("latency").innerText = latency;
}

// Chaos Toggle
function toggleService(serviceName) {
    services[serviceName] = !services[serviceName];
    const el = document.getElementById(serviceName);
    el.classList.toggle("dead");
}
