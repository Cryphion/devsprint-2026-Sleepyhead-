CREATE DATABASE stock_db;
CREATE DATABASE kitchen_db;
-- identity_db already created by POSTGRES_DB env var
\c identity_db;

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id VARCHAR(20) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role VARCHAR(10) DEFAULT 'student',  -- 'student' or 'admin'
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS revoked_tokens (
    token_jti UUID PRIMARY KEY,
    revoked_at TIMESTAMP DEFAULT NOW()
);

-- ─────────────────────────────────────────
\c stock_db;

CREATE TABLE IF NOT EXISTS menu_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    price NUMERIC(10,2) NOT NULL,
    description TEXT,
    image_url TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    menu_item_id UUID REFERENCES menu_items(id),
    quantity INT NOT NULL DEFAULT 0,
    version INT NOT NULL DEFAULT 0,  -- optimistic locking
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ─────────────────────────────────────────
\c kitchen_db;

CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key UUID UNIQUE NOT NULL,  -- prevents duplicate orders
    student_id VARCHAR(20) NOT NULL,
    menu_item_id UUID NOT NULL,
    status VARCHAR(20) DEFAULT 'PENDING', -- PENDING → STOCK_VERIFIED → IN_KITCHEN → READY
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);