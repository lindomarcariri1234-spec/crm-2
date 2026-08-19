UPDATE trips
SET available_seats = GREATEST(
  0,
  total_capacity
    - reserved_seats
    - confirmed_seats
    - jsonb_array_length((free_passengers::jsonb))
)
WHERE free_passengers IS NOT NULL
  AND free_passengers::text NOT IN ('null', '[]', '')
  AND free_passengers::text LIKE '[%';
