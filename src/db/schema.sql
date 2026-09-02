-- FeedLink AI Database Schema
-- PostgreSQL

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('donor', 'ngo', 'admin')),
    avatar VARCHAR(500),
    phone VARCHAR(50),
    organization VARCHAR(255),
    address TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Donations table
CREATE TABLE IF NOT EXISTS donations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    donor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(500) NOT NULL,
    description TEXT,
    food_category VARCHAR(50) NOT NULL,
    quantity VARCHAR(50) NOT NULL,
    unit VARCHAR(50) NOT NULL,
    servings INTEGER,
    expiry_date TIMESTAMP WITH TIME ZONE NOT NULL,
    pickup_address TEXT NOT NULL,
    pickup_city VARCHAR(255) NOT NULL,
    pickup_instructions TEXT,
    images TEXT[],
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending', 'analyzing', 'matched', 'claimed',
        'pickup_scheduled', 'in_transit', 'delivered',
        'completed', 'expired', 'cancelled'
    )),
    urgency_level VARCHAR(20) DEFAULT 'medium' CHECK (urgency_level IN ('low', 'medium', 'high', 'critical')),
    urgency_score INTEGER CHECK (urgency_score >= 1 AND urgency_score <= 10),
    ai_analysis JSONB,
    ai_explanation TEXT,
    ai_source VARCHAR(20) DEFAULT 'deterministic',
    match_explanation TEXT,
    match_score INTEGER CHECK (match_score >= 0 AND match_score <= 100),
    matched_ngo_id UUID REFERENCES users(id),
    claimed_at TIMESTAMP WITH TIME ZONE,
    pickup_scheduled_at TIMESTAMP WITH TIME ZONE,
    delivered_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Notifications table
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    read BOOLEAN DEFAULT FALSE,
    link VARCHAR(500),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Matches table (AI matching history)
CREATE TABLE IF NOT EXISTS matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    donation_id UUID NOT NULL REFERENCES donations(id) ON DELETE CASCADE,
    ngo_id UUID NOT NULL REFERENCES users(id),
    match_score INTEGER NOT NULL CHECK (match_score >= 0 AND match_score <= 100),
    ngo_distance VARCHAR(50),
    ngo_capacity VARCHAR(50),
    match_explanation TEXT,
    match_factors JSONB,
    matched_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Impact statistics (materialized view or computed)
CREATE TABLE IF NOT EXISTS impact_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    period VARCHAR(20) NOT NULL, -- 'daily', 'weekly', 'monthly'
    total_donations INTEGER DEFAULT 0,
    total_meals_provided INTEGER DEFAULT 0,
    total_kg_redistributed DECIMAL(10,2) DEFAULT 0,
    total_co2_saved DECIMAL(10,2) DEFAULT 0,
    snapshot_date DATE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_donations_donor_id ON donations(donor_id);
CREATE INDEX IF NOT EXISTS idx_donations_status ON donations(status);
CREATE INDEX IF NOT EXISTS idx_donations_urgency_level ON donations(urgency_level);
CREATE INDEX IF NOT EXISTS idx_donations_matched_ngo_id ON donations(matched_ngo_id);
CREATE INDEX IF NOT EXISTS idx_donations_created_at ON donations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(user_id, read);
CREATE INDEX IF NOT EXISTS idx_matches_donation_id ON matches(donation_id);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Add AI columns to existing tables if they don't exist (migration-safe)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='donations' AND column_name='ai_explanation') THEN
    ALTER TABLE donations ADD COLUMN ai_explanation TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='donations' AND column_name='ai_source') THEN
    ALTER TABLE donations ADD COLUMN ai_source VARCHAR(20) DEFAULT 'deterministic';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='donations' AND column_name='match_explanation') THEN
    ALTER TABLE donations ADD COLUMN match_explanation TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='donations' AND column_name='match_score') THEN
    ALTER TABLE donations ADD COLUMN match_score INTEGER CHECK (match_score >= 0 AND match_score <= 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='matches' AND column_name='match_explanation') THEN
    ALTER TABLE matches ADD COLUMN match_explanation TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='matches' AND column_name='match_factors') THEN
    ALTER TABLE matches ADD COLUMN match_factors JSONB;
  END IF;
END $$;
