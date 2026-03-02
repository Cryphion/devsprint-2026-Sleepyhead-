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
\c stock_db;

CREATE TABLE IF NOT EXISTS stocks (
  id       VARCHAR(10) PRIMARY KEY,
  name     VARCHAR(255) UNIQUE NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity >= 0),
  price    INTEGER NOT NULL DEFAULT 0,
  version  INTEGER NOT NULL DEFAULT 0
);

INSERT INTO stocks (id, name, quantity, price) VALUES
  ('i01', 'Beguni (Eggplant Fritter)',      150, 10),
  ('i02', 'Piyaju (Lentil Onion Fritter)',  150, 10),
  ('i03', 'Aloo Chop (Potato Fritter)',     120, 20),
  ('i04', 'Chicken Tikka',                   80, 100),
  ('i05', 'Beef Tikka',                      60, 120),
  ('i06', 'Samosa',                         100, 10),
  ('i07', 'Singara',                         80, 10),
  ('i08', 'Vegetable Roll',                  70, 40),
  ('i09', 'Chicken Roll',                    75, 60),
  ('i10', 'Shami Kebab (Beef/Chicken)',       60, 40),
  ('i11', 'Chicken Nuggets',                 90, 30),
  ('i12', 'Beef Seekh Kebab',                50, 80),
  ('i13', 'Jali Kabab',                      55, 20),
  ('i14', 'Chicken Spring Roll',             65, 40),
  ('i15', 'Chicken Fry',                     80, 60),
  ('i16', 'Chicken Hot Dog',                120, 100),
  ('i17', 'Jilapi',                         100, 20),
  ('i18', 'Fruit Juice',                     60, 50),
  ('i19', 'Lemonade',                        70, 30),
  ('i20', 'Date / Khajur (per piece)',       200, 5)
ON CONFLICT (id) DO NOTHING;

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