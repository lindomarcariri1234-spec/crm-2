-- Fix trip departure/return dates that were stored at UTC midnight
-- due to `new Date("YYYY-MM-DD")` being interpreted as UTC midnight.
-- Brazil is UTC-3, so UTC midnight = 21:00 the previous day in Brazil,
-- causing dates to display one day behind.
-- Shift affected records forward 15 hours → UTC 15:00 = Brazil noon.

UPDATE trips
SET departure_date = departure_date + INTERVAL '15 hours'
WHERE EXTRACT(HOUR FROM departure_date AT TIME ZONE 'UTC') = 0
  AND EXTRACT(MINUTE FROM departure_date AT TIME ZONE 'UTC') = 0
  AND EXTRACT(SECOND FROM departure_date AT TIME ZONE 'UTC') = 0;

UPDATE trips
SET return_date = return_date + INTERVAL '15 hours'
WHERE return_date IS NOT NULL
  AND EXTRACT(HOUR FROM return_date AT TIME ZONE 'UTC') = 0
  AND EXTRACT(MINUTE FROM return_date AT TIME ZONE 'UTC') = 0
  AND EXTRACT(SECOND FROM return_date AT TIME ZONE 'UTC') = 0;
