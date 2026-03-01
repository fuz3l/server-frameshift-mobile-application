-- Add role column to users table for RBAC
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'user' NOT NULL;

-- Create index for quick role lookups
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- Set first user as admin (optional, for development)
-- UPDATE users SET role = 'admin' WHERE id = (SELECT id FROM users ORDER BY created_at ASC LIMIT 1);
