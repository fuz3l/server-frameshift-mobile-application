-- Add file_diffs column to reports table
-- This column stores the diff data for each converted file

ALTER TABLE reports
ADD COLUMN IF NOT EXISTS file_diffs JSONB DEFAULT '[]'::jsonb;

-- Add comment to document the column
COMMENT ON COLUMN reports.file_diffs IS 'Array of file diffs with metadata, statistics, and diff hunks';

-- Create index for JSONB operations (optional, for performance)
CREATE INDEX IF NOT EXISTS idx_reports_file_diffs_gin ON reports USING GIN (file_diffs);
