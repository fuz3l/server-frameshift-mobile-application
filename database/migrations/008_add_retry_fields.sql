-- Add retry functionality fields to conversion_jobs table
ALTER TABLE conversion_jobs
ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS failed_files JSONB,
ADD COLUMN IF NOT EXISTS last_retry_at TIMESTAMP;

-- Add index for efficient retry queries
CREATE INDEX IF NOT EXISTS idx_conversion_jobs_retry
ON conversion_jobs(retry_count)
WHERE status = 'failed';

-- Add comment
COMMENT ON COLUMN conversion_jobs.retry_count IS 'Number of times this conversion has been retried';
COMMENT ON COLUMN conversion_jobs.failed_files IS 'JSON array of files that failed during conversion';
COMMENT ON COLUMN conversion_jobs.last_retry_at IS 'Timestamp of the last retry attempt';
