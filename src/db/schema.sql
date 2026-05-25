-- =============================================
-- LEXORA DATABASE SCHEMA
-- Jalankan: node src/db/migrate.js
-- =============================================

-- Extension untuk UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================
-- TABEL USERS (Klien)
-- =============================================
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          VARCHAR(255) NOT NULL,
  email         VARCHAR(255) UNIQUE,
  phone         VARCHAR(20) UNIQUE,
  password_hash VARCHAR(255),           -- NULL jika login via Google/Phone OTP
  nik           VARCHAR(16),
  address       TEXT,
  photo_url     VARCHAR(500),
  firebase_uid  VARCHAR(128) UNIQUE,    -- UID dari Firebase Auth
  auth_provider VARCHAR(50) DEFAULT 'email', -- 'email' | 'google' | 'phone'
  is_verified   BOOLEAN DEFAULT FALSE,
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================
-- TABEL ADVOCATES (Advokat)
-- =============================================
CREATE TABLE IF NOT EXISTS advocates (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name             VARCHAR(255) NOT NULL,
  email            VARCHAR(255) UNIQUE NOT NULL,
  phone            VARCHAR(20),
  password_hash    VARCHAR(255),
  firebase_uid     VARCHAR(128) UNIQUE,
  photo_url        VARCHAR(500),
  title            VARCHAR(100),           -- 'Senior Partner', 'Associate', dll
  firm_name        VARCHAR(255),
  bio              TEXT,
  license_number   VARCHAR(100),           -- No. lisensi PERADI
  location         VARCHAR(255),
  experience_years INTEGER DEFAULT 0,
  consultation_fee INTEGER,               -- dalam Rupiah, NULL = gratis
  is_available     BOOLEAN DEFAULT TRUE,
  is_verified      BOOLEAN DEFAULT FALSE,
  rating           DECIMAL(3,2) DEFAULT 0.00,
  total_reviews    INTEGER DEFAULT 0,
  total_cases      INTEGER DEFAULT 0,
  is_active        BOOLEAN DEFAULT TRUE,
  created_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================
-- TABEL ADVOCATE SPECIALIZATIONS
-- =============================================
CREATE TABLE IF NOT EXISTS advocate_specializations (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  advocate_id  UUID NOT NULL REFERENCES advocates(id) ON DELETE CASCADE,
  name         VARCHAR(100) NOT NULL,
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================
-- TABEL COMPLAINTS (Pengaduan)
-- =============================================
CREATE TYPE complaint_status AS ENUM (
  'pending', 'review', 'in_progress', 'resolved', 'rejected'
);

CREATE TYPE complaint_category AS ENUM (
  'pidana', 'perdata', 'keluarga', 'bisnis',
  'properti', 'tenaga_kerja', 'konsumen', 'lainnya'
);

CREATE TABLE IF NOT EXISTS complaints (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  advocate_id     UUID REFERENCES advocates(id) ON DELETE SET NULL,
  title           VARCHAR(500) NOT NULL,
  description     TEXT NOT NULL,
  category        complaint_category NOT NULL DEFAULT 'lainnya',
  status          complaint_status NOT NULL DEFAULT 'pending',
  response_note   TEXT,                    -- Catatan balasan dari advokat
  attachments     TEXT[],                  -- Array URL file lampiran
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================
-- TABEL CHAT ROOMS
-- =============================================
CREATE TABLE IF NOT EXISTS chat_rooms (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  advocate_id  UUID NOT NULL REFERENCES advocates(id) ON DELETE CASCADE,
  complaint_id UUID REFERENCES complaints(id) ON DELETE SET NULL,
  is_active    BOOLEAN DEFAULT TRUE,
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, advocate_id)             -- 1 room per pasangan user-advokat
);

-- =============================================
-- TABEL MESSAGES (Pesan Chat)
-- =============================================
CREATE TYPE message_type AS ENUM ('text', 'image', 'document', 'audio');

CREATE TABLE IF NOT EXISTS messages (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id      UUID NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  sender_id    UUID NOT NULL,
  sender_type  VARCHAR(20) NOT NULL,       -- 'user' | 'advocate'
  content      TEXT,
  file_url     VARCHAR(500),
  file_name    VARCHAR(255),
  message_type message_type DEFAULT 'text',
  is_read      BOOLEAN DEFAULT FALSE,
  read_at      TIMESTAMP WITH TIME ZONE,
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================
-- TABEL REVIEWS (Ulasan)
-- =============================================
CREATE TABLE IF NOT EXISTS reviews (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  advocate_id UUID NOT NULL REFERENCES advocates(id) ON DELETE CASCADE,
  rating      INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment     TEXT,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, advocate_id)
);

-- =============================================
-- TABEL REFRESH TOKENS
-- =============================================
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
  advocate_id UUID REFERENCES advocates(id) ON DELETE CASCADE,
  token      VARCHAR(500) NOT NULL UNIQUE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================
-- INDEXES untuk performa query
-- =============================================
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_users_firebase_uid ON users(firebase_uid);
CREATE INDEX IF NOT EXISTS idx_advocates_email ON advocates(email);
CREATE INDEX IF NOT EXISTS idx_advocates_is_available ON advocates(is_available);
CREATE INDEX IF NOT EXISTS idx_complaints_user_id ON complaints(user_id);
CREATE INDEX IF NOT EXISTS idx_complaints_advocate_id ON complaints(advocate_id);
CREATE INDEX IF NOT EXISTS idx_complaints_status ON complaints(status);
CREATE INDEX IF NOT EXISTS idx_messages_room_id ON messages(room_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_chat_rooms_user_id ON chat_rooms(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_rooms_advocate_id ON chat_rooms(advocate_id);

-- =============================================
-- TRIGGER: auto-update updated_at
-- =============================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER advocates_updated_at
  BEFORE UPDATE ON advocates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER complaints_updated_at
  BEFORE UPDATE ON complaints
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER chat_rooms_updated_at
  BEFORE UPDATE ON chat_rooms
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
