-- Migration: Add AI enhancement fields to conversion_jobs table
-- Date: 2025-12-30
-- Description: Add use_ai flag and ai_enhancements tracking for AI-powered conversion

-- Add use_ai column (default to true for new conversions)
ALTER TABLE conversion_jobs
ADD COLUMN IF NOT EXISTS use_ai BOOLEAN NOT NULL DEFAULT true;

-- Add ai_enhancements column to track what AI fixed
ALTER TABLE conversion_jobs
ADD COLUMN IF NOT EXISTS ai_enhancements TEXT[] DEFAULT '{}';

-- Add comments for documentation
COMMENT ON COLUMN conversion_jobs.use_ai IS 'Whether AI enhancement was enabled for this conversion (Gemini API)';
COMMENT ON COLUMN conversion_jobs.ai_enhancements IS 'Array of AI enhancements applied (e.g., abstract_user:models.py, routes:account/routes.py)';
