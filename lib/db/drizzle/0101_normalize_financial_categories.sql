WITH financial_category_aliases(alias, canonical) AS (
  VALUES
    ('transport', 'Transporte'),
    ('transporte', 'Transporte'),
    ('accommodation', 'Hospedagem'),
    ('hospedagem', 'Hospedagem'),
    ('food', 'Alimentação'),
    ('alimentacao', 'Alimentação'),
    ('marketing', 'Marketing'),
    ('administrative', 'Administrativo'),
    ('administrativo', 'Administrativo'),
    ('commission', 'Comissão'),
    ('comissao', 'Comissão'),
    ('comissao de vendedores', 'Comissão'),
    ('comissoes de vendedores', 'Comissão'),
    ('other', 'Outro'),
    ('outro', 'Outro'),
    ('outros', 'Outro')
)
UPDATE public.expenses AS expense
SET category = alias.canonical
FROM financial_category_aliases AS alias
WHERE regexp_replace(
    translate(
      lower(btrim(expense.category)),
      'ÀÁÂÃÄÈÉÊËÌÍÎÏÒÓÔÕÖÙÚÛÜÇàáâãäèéêëìíîïòóôõöùúûüç̧̀́̂̃̈',
      'aaaaaeeeeiiiiooooouuuucaaaaaeeeeiiiiooooouuuuc'
    ),
    '[[:space:]]+',
    ' ',
    'g'
  ) = alias.alias
  AND expense.category IS DISTINCT FROM alias.canonical;
--> statement-breakpoint
WITH financial_category_aliases(alias, canonical) AS (
  VALUES
    ('transport', 'Transporte'),
    ('transporte', 'Transporte'),
    ('accommodation', 'Hospedagem'),
    ('hospedagem', 'Hospedagem'),
    ('food', 'Alimentação'),
    ('alimentacao', 'Alimentação'),
    ('marketing', 'Marketing'),
    ('administrative', 'Administrativo'),
    ('administrativo', 'Administrativo'),
    ('commission', 'Comissão'),
    ('comissao', 'Comissão'),
    ('comissao de vendedores', 'Comissão'),
    ('comissoes de vendedores', 'Comissão'),
    ('other', 'Outro'),
    ('outro', 'Outro'),
    ('outros', 'Outro')
)
UPDATE public.trip_costs AS trip_cost
SET category = alias.canonical
FROM financial_category_aliases AS alias
WHERE regexp_replace(
    translate(
      lower(btrim(trip_cost.category)),
      'ÀÁÂÃÄÈÉÊËÌÍÎÏÒÓÔÕÖÙÚÛÜÇàáâãäèéêëìíîïòóôõöùúûüç̧̀́̂̃̈',
      'aaaaaeeeeiiiiooooouuuucaaaaaeeeeiiiiooooouuuuc'
    ),
    '[[:space:]]+',
    ' ',
    'g'
  ) = alias.alias
  AND trip_cost.category IS DISTINCT FROM alias.canonical;
--> statement-breakpoint
WITH financial_category_aliases(alias, canonical) AS (
  VALUES
    ('transport', 'Transporte'),
    ('transporte', 'Transporte'),
    ('accommodation', 'Hospedagem'),
    ('hospedagem', 'Hospedagem'),
    ('food', 'Alimentação'),
    ('alimentacao', 'Alimentação'),
    ('marketing', 'Marketing'),
    ('administrative', 'Administrativo'),
    ('administrativo', 'Administrativo'),
    ('commission', 'Comissão'),
    ('comissao', 'Comissão'),
    ('comissao de vendedores', 'Comissão'),
    ('comissoes de vendedores', 'Comissão'),
    ('other', 'Outro'),
    ('outro', 'Outro'),
    ('outros', 'Outro')
),
trips_with_aliases AS (
  SELECT
    trip.id,
    CASE
      WHEN json_typeof(trip.fixed_costs) = 'array' THEN (
        SELECT COALESCE(
          jsonb_agg(
            CASE
              WHEN alias.canonical IS NULL THEN item.value
              ELSE jsonb_set(item.value, '{category}', to_jsonb(alias.canonical), false)
            END
            ORDER BY item.ordinality
          ),
          '[]'::jsonb
        )::json
        FROM jsonb_array_elements(trip.fixed_costs::jsonb)
          WITH ORDINALITY AS item(value, ordinality)
        LEFT JOIN financial_category_aliases AS alias
          ON regexp_replace(
            translate(
              lower(btrim(item.value->>'category')),
              'ÀÁÂÃÄÈÉÊËÌÍÎÏÒÓÔÕÖÙÚÛÜÇàáâãäèéêëìíîïòóôõöùúûüç̧̀́̂̃̈',
              'aaaaaeeeeiiiiooooouuuucaaaaaeeeeiiiiooooouuuuc'
            ),
            '[[:space:]]+',
            ' ',
            'g'
          ) = alias.alias
      )
      ELSE trip.fixed_costs
    END AS fixed_costs,
    CASE
      WHEN json_typeof(trip.variable_costs) = 'array' THEN (
        SELECT COALESCE(
          jsonb_agg(
            CASE
              WHEN alias.canonical IS NULL THEN item.value
              ELSE jsonb_set(item.value, '{category}', to_jsonb(alias.canonical), false)
            END
            ORDER BY item.ordinality
          ),
          '[]'::jsonb
        )::json
        FROM jsonb_array_elements(trip.variable_costs::jsonb)
          WITH ORDINALITY AS item(value, ordinality)
        LEFT JOIN financial_category_aliases AS alias
          ON regexp_replace(
            translate(
              lower(btrim(item.value->>'category')),
              'ÀÁÂÃÄÈÉÊËÌÍÎÏÒÓÔÕÖÙÚÛÜÇàáâãäèéêëìíîïòóôõöùúûüç̧̀́̂̃̈',
              'aaaaaeeeeiiiiooooouuuucaaaaaeeeeiiiiooooouuuuc'
            ),
            '[[:space:]]+',
            ' ',
            'g'
          ) = alias.alias
      )
      ELSE trip.variable_costs
    END AS variable_costs
  FROM public.trips AS trip
  WHERE CASE
    WHEN json_typeof(trip.fixed_costs) = 'array' THEN EXISTS (
      SELECT 1
      FROM jsonb_array_elements(trip.fixed_costs::jsonb) AS item(value)
      JOIN financial_category_aliases AS alias
        ON regexp_replace(
          translate(
            lower(btrim(item.value->>'category')),
            'ÀÁÂÃÄÈÉÊËÌÍÎÏÒÓÔÕÖÙÚÛÜÇàáâãäèéêëìíîïòóôõöùúûüç̧̀́̂̃̈',
            'aaaaaeeeeiiiiooooouuuucaaaaaeeeeiiiiooooouuuuc'
          ),
          '[[:space:]]+',
          ' ',
          'g'
        ) = alias.alias
      WHERE item.value->>'category' IS DISTINCT FROM alias.canonical
    )
    ELSE false
  END OR CASE
    WHEN json_typeof(trip.variable_costs) = 'array' THEN EXISTS (
      SELECT 1
      FROM jsonb_array_elements(trip.variable_costs::jsonb) AS item(value)
      JOIN financial_category_aliases AS alias
        ON regexp_replace(
          translate(
            lower(btrim(item.value->>'category')),
            'ÀÁÂÃÄÈÉÊËÌÍÎÏÒÓÔÕÖÙÚÛÜÇàáâãäèéêëìíîïòóôõöùúûüç̧̀́̂̃̈',
            'aaaaaeeeeiiiiooooouuuucaaaaaeeeeiiiiooooouuuuc'
          ),
          '[[:space:]]+',
          ' ',
          'g'
        ) = alias.alias
      WHERE item.value->>'category' IS DISTINCT FROM alias.canonical
    )
    ELSE false
  END
)
UPDATE public.trips AS trip
SET
  fixed_costs = trips_with_aliases.fixed_costs,
  variable_costs = trips_with_aliases.variable_costs
FROM trips_with_aliases
WHERE trip.id = trips_with_aliases.id;