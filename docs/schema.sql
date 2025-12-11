CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Таблиця TravelPlans
CREATE TABLE travel_plans (
                              id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
                              title VARCHAR(200) NOT NULL CHECK (length(title) > 0),
                              description TEXT NULL,
                              start_date DATE NULL,
                              end_date DATE NULL CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date),
                              budget DECIMAL(10, 2) NULL CHECK (budget IS NULL OR budget >= 0),
                              currency VARCHAR(3) DEFAULT 'USD' CHECK (length(currency) = 3),
                              is_public BOOLEAN DEFAULT FALSE,
                              version INTEGER DEFAULT 1 CHECK (version >= 1), -- Для Optimistic Locking (Проблема 1)
                              created_at TIMESTAMPTZ DEFAULT NOW(),
                              updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Тригерна функція для оновлення updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = NOW();
RETURN NEW;
END;
$$ language 'plpgsql';

-- Тригер для travel_plans
CREATE TRIGGER update_travel_plans_updated_at
    BEFORE UPDATE ON travel_plans
    FOR EACH ROW
    EXECUTE PROCEDURE update_updated_at_column();


-- Таблиця Locations
-- УВАГА: Для повного рішення Проблеми 3 (Optimistic Locking)
-- потрібно додати колонку version до locations, але ми залишаємо як у першій версії схеми.
CREATE TABLE locations (
                           id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
                           travel_plan_id uuid NOT NULL REFERENCES travel_plans(id) ON DELETE CASCADE,
                           name VARCHAR(200) NOT NULL CHECK (length(name) > 0),
                           address TEXT NULL,
                           latitude DECIMAL(11, 6) NULL CHECK (latitude BETWEEN -90 AND 90),
                           longitude DECIMAL(11, 6) NULL CHECK (longitude BETWEEN -180 AND 180),
                           visit_order INTEGER NOT NULL CHECK (visit_order >= 1),
                           arrival_date TIMESTAMPTZ NULL,
                           departure_date TIMESTAMPTZ NULL CHECK (departure_date IS NULL OR arrival_date IS NULL OR departure_date >= arrival_date),
                           budget DECIMAL(10, 2) NULL CHECK (budget IS NULL OR budget >= 0),
                           notes TEXT NULL,
                           version INTEGER DEFAULT 1 CHECK (version >= 1),
                           created_at TIMESTAMPTZ DEFAULT NOW(),
                           updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Обмеження для консистентності порядку (Проблема 2)
                           UNIQUE (travel_plan_id, visit_order)
);

-- Тригер для locations
CREATE TRIGGER update_locations_updated_at
    BEFORE UPDATE ON locations
    FOR EACH ROW
    EXECUTE PROCEDURE update_updated_at_column();