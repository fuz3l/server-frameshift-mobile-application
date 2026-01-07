-- Migration: Add use_ai field to conversion_jobs table
-- Date: 2025-12-30
-- Description: Add AI enhancement flag and tracking

-- Add use_ai column (default to true for new conversions)
ALTER TABLE conversion_jobs
ADD COLUMN IF NOT EXISTS use_ai BOOLEAN NOT NULL DEFAULT true;

-- Add ai_enhancements column to track what AI fixed
ALTER TABLE conversion_jobs
ADD COLUMN IF NOT EXISTS ai_enhancements TEXT[] DEFAULT '{}';

-- Add comment
COMMENT ON COLUMN conversion_jobs.use_ai IS 'Whether AI enhancement was enabled for this conversion';
COMMENT ON COLUMN conversion_jobs.ai_enhancements IS 'Array of AI enhancements applied (e.g., abstract_user, routes, orm_queries)';

-- Update existing rows to have use_ai = true (assume old conversions would have wanted AI)
UPDATE conversion_jobs SET use_ai = true WHERE use_ai IS NULL;
