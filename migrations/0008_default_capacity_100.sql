-- Change default total_capacity from 10 to 100.
-- Update existing accounts that still have the old default of 10.
UPDATE accounts SET total_capacity = 100 WHERE total_capacity = 10;
