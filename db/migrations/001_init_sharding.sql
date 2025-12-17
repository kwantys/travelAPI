-- db/migrations/001_init_sharding.sql
CREATE TABLE IF NOT EXISTS travel_plans (
                                            id UUID PRIMARY KEY,
                                            title VARCHAR(200) NOT NULL,
    description TEXT,
    start_date DATE,
    end_date DATE,
    budget DECIMAL(15,2),
    currency CHAR(3),
    is_public BOOLEAN DEFAULT false,
    version INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

CREATE TABLE IF NOT EXISTS locations (
                                         id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    travel_plan_id UUID NOT NULL REFERENCES travel_plans(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    address TEXT,
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    visit_order INTEGER NOT NULL,
    arrival_date TIMESTAMP,
    departure_date TIMESTAMP,
    budget DECIMAL(15,2),
    notes TEXT,
    version INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(travel_plan_id, visit_order)
    );

CREATE INDEX IF NOT EXISTS idx_travel_plans_created_at ON travel_plans(created_at);
CREATE INDEX IF NOT EXISTS idx_travel_plans_public ON travel_plans(is_public);
CREATE INDEX IF NOT EXISTS idx_locations_travel_plan_id ON locations(travel_plan_id);
CREATE INDEX IF NOT EXISTS idx_locations_visit_order ON locations(travel_plan_id, visit_order);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at
CREATE OR REPLACE TRIGGER update_travel_plans_updated_at
    BEFORE UPDATE ON travel_plans
                         FOR EACH ROW
                         EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER update_locations_updated_at
    BEFORE UPDATE ON locations
                      FOR EACH ROW
                      EXECUTE FUNCTION update_updated_at_column();