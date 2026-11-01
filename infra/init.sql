CREATE EXTENSION IF NOT EXISTS pg_trgm;
SELECT 'CREATE DATABASE khronist_test'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'khronist_test')\gexec
\c khronist_test
CREATE EXTENSION IF NOT EXISTS pg_trgm;
