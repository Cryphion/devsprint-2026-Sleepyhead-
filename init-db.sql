-- DevSprint 2026 — IUT Cafeteria DB init
-- Runs once on first postgres startup via docker-entrypoint-initdb.d
-- POSTGRES_DB=identity_db is already created by the env var before this runs.

-- Create the other two databases
CREATE DATABASE stock_db;
CREATE DATABASE kitchen_db;

-- ─── identity_db ──────────────────────────────────────────────
\c identity_db

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id VARCHAR(20) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role VARCHAR(10) DEFAULT 'student',
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS revoked_tokens (
    token_jti UUID PRIMARY KEY,
    revoked_at TIMESTAMP DEFAULT NOW()
);

-- ─── stock_db ─────────────────────────────────────────────────
\c stock_db

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
    version INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Seed initial menu items so the system has stock on first boot
INSERT INTO menu_items (name, price, description) VALUES
    ('Iftar Special Box', 120.00, 'Full Iftar meal for one'),
    ('Tea',               10.00,  'Hot tea'),
    ('Samosa',            15.00,  'Fried samosa (2 pcs)')
ON CONFLICT DO NOTHING;

INSERT INTO inventory (menu_item_id, quantity, version)
SELECT id, 200, 0 FROM menu_items
ON CONFLICT DO NOTHING;

-- ─── kitchen_db ───────────────────────────────────────────────
\c kitchen_db

CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key UUID UNIQUE NOT NULL,
    student_id VARCHAR(20) NOT NULL,
    menu_item_id UUID NOT NULL,
    status VARCHAR(20) DEFAULT 'PENDING',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);