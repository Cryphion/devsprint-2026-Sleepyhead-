# IUT Cafeteria — DevSprint 2026
### Team SleepyHeads | Islamic University of Technology

A cloud-native, microservices-based cafeteria ordering system built for the Ramadan Iftar rush. Handles concurrent orders, real-time kitchen updates, and graceful failure recovery.

---

## Architecture Overview

```
Client (Browser)
      │
      ▼
┌─────────────────┐
│  Order Gateway  │  ← JWT Auth + Redis Cache + Rate Limiting
│   (Port 3000)   │
└────────┬────────┘
         │
    ┌────┴────────────────────┐
    │                         │
    ▼                         ▼
┌──────────────┐     ┌──────────────────┐
│ Stock Service│     │ Identity Provider│
│  (Port 3002) │     │   (Port 3001)    │
│ PostgreSQL + │     │ PostgreSQL + JWT │
│    Redis     │     └──────────────────┘
└──────┬───────┘
       │
       ▼
┌──────────────────┐
│  Kitchen Queue   │  ← RabbitMQ async processing
│   (Port 3003)    │
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│ Notification Hub │  ← WebSocket real-time updates
│   (Port 3004)    │
└──────────────────┘
```

---

## Services

| Service | Port | Responsibility |
|---|---|---|
| **Identity Provider** | 3001 | Login, JWT signing, rate limiting |
| **Order Gateway** | 3000 | Auth validation, Redis cache, request routing |
| **Stock Service** | 3002 | Inventory management with optimistic locking |
| **Kitchen Queue** | 3003 | Async order processing via RabbitMQ |
| **Notification Hub** | 3004 | Real-time WebSocket status updates |

---

## Tech Stack

- **Runtime:** Node.js + Express
- **Database:** PostgreSQL (with optimistic locking)
- **Cache:** Redis
- **Message Queue:** RabbitMQ
- **Auth:** JWT (jsonwebtoken + bcryptjs)
- **Real-time:** WebSocket (Socket.io)
- **Containerization:** Docker + Docker Compose
- **CI/CD:** GitHub Actions
- **Testing:** Jest

---

## Quick Start

### Prerequisites
- Docker & Docker Compose installed
- Git

### Run Everything

```bash
git clone https://github.com/your-username/devsprint-2026.git
cd devsprint-2026

docker compose up --build
```

That's it! All services, databases, and queues spin up automatically.

### Access Points

| Interface | URL |
|---|---|
| Frontend Dashboard | `http://localhost:8080` |
| Order Gateway API | `http://localhost:3000` |
| Identity Provider | `http://localhost:3001` |
| Stock Service | `http://localhost:3002` |

---

## Default Credentials

| Student ID | Password | Role |
|---|---|---|
| `240041130` | `tonoy123` | Student |
| `240041132` | `sabin123` | Student |
| `240041121` | `sakib123` | Student |
| `admin001` | `admin123` | Admin |

---

## API Reference

### Identity Provider (`/`)

```
POST /login          → { student_id, password } → JWT token
GET  /health         → Service health status
GET  /metrics        → Login success/failure counters
POST /register       → Register new student (admin use)
```

### Order Gateway (`/`)

```
POST /orders         → Place an order (requires Bearer token)
GET  /health         → Checks Redis + Stock + Kitchen health
GET  /metrics        → Prometheus-style metrics
```

### Stock Service (`/api/stocks`)

```
GET    /api/stocks          → List all items
GET    /api/stocks/:id      → Single item
POST   /api/stocks          → Add item
PUT    /api/stocks/:id      → Update quantity
PATCH  /api/stocks/:id/deduct → Deduct stock (optimistic locking)
DELETE /api/stocks/:id      → Remove item
```

---

## Key Features

### Concurrency Control — Optimistic Locking
Prevents overselling during peak rush. Stock updates only succeed if the version number matches, eliminating race conditions without locking the entire table.

```sql
UPDATE stocks
SET quantity = quantity - $1, version = version + 1
WHERE id = $2 AND version = $3 AND quantity >= $1
```

### Redis Caching
Order Gateway checks Redis before hitting the Stock Service. Cache TTL of 30 seconds drastically reduces DB load during Iftar rush.

### Rate Limiting
Identity Provider limits login attempts to **3 per minute per student ID**, preventing brute-force attacks.

### Idempotency
Kitchen Queue uses Redis to track processed order IDs — duplicate RabbitMQ deliveries are safely ignored.

### Fault Tolerance
- Redis down → cache skipped, orders continue
- Kitchen Queue down → order still confirmed to student, kitchen retries via RabbitMQ
- Notification Hub down → everything else keeps working

---

## Running Tests

```bash
# Kitchen Queue unit tests
cd kitchen-service
npm test

# Tests cover:
# - Idempotency (duplicate order prevention)
# - Metrics accuracy
# - Order validation (bad payloads rejected)
```

---

## Monitoring

Each service exposes:
- `GET /health` — liveness check (returns 200 or 503)
- `GET /metrics` — request counts, latency, failures

The Admin Dashboard aggregates all service metrics in real-time.

---

## Docker Compose Services

```yaml
services:
  identity-provider   # Port 3001
  order-gateway       # Port 3000
  stock-service       # Port 3002
  kitchen-queue       # Port 3003
  notification-hub    # Port 3004
  postgres            # Database
  redis               # Cache + Idempotency store
  rabbitmq            # Message broker
```

---

## Order Flow

```
1. Student logs in → gets JWT token
2. Places order → Gateway validates JWT
3. Gateway checks Redis cache for stock
4. Gateway calls Stock Service → optimistic lock deduction
5. Stock confirmed → order sent to Kitchen Queue (RabbitMQ)
6. Gateway responds "Order Accepted" in < 2 seconds
7. Kitchen processes asynchronously (3–7 seconds)
8. Notification Hub pushes "Ready" via WebSocket
```

---

## AI Usage Disclosure

As required by DevSprint 2026 rules — AI tools (Claude by Anthropic) were used to assist with:
- Architecture planning and design decisions
- Boilerplate code generation and debugging
- README and documentation drafting

All code was reviewed, understood, and tested by the team.

---

## Team SleepyHeads

| Name | Student ID |
|---|---|
| Tonoy | 240041130 |
| Sabin | 240041132 |
| Sakib | 240041121 |

**Islamic University of Technology (IUT)**
DevSprint 2026
