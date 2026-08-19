import { pool } from "@workspace/db";

async function main() {
  const client = await pool.connect();
  try {
    await client.query(`
      INSERT INTO plans (id, name, slug, description, monthly_price, annual_price, max_users, max_clients, max_trips, features, supported_features, is_active, is_featured, sort_order, trial_days, payment_required)
      VALUES
        ('plan_starter',   'Starter',    'starter',    'Para agências iniciantes',     0,   0,    3,   500,  20,  '["Até 3 usuários","500 clientes","20 viagens"]',                                       '["coupons"]',              true,  false, 1, 0,  false),
        ('plan_pro',       'Pro',        'pro',        'Para agências em crescimento', 97,  970,  10,  500, 100, '["Até 10 usuários","500 clientes","100 viagens","Suporte prioritário"]',                '["referrals","coupons","seatMap"]',  true,  true,  2, 14, true),
        ('plan_enterprise','Enterprise', 'enterprise', 'Para grandes operadoras',     397, 3970, 50, 5000, 500, '["Usuários ilimitados","5000 clientes","500 viagens","Suporte dedicado"]',              '["referrals","coupons","seatMap"]',  true,  false, 3, 14, true)
      ON CONFLICT (slug) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        monthly_price = EXCLUDED.monthly_price,
        annual_price = EXCLUDED.annual_price,
        max_users = EXCLUDED.max_users,
        max_clients = EXCLUDED.max_clients,
        max_trips = EXCLUDED.max_trips,
        features = EXCLUDED.features,
        supported_features = EXCLUDED.supported_features,
        is_active = EXCLUDED.is_active,
        is_featured = EXCLUDED.is_featured,
        sort_order = EXCLUDED.sort_order,
        trial_days = EXCLUDED.trial_days,
        payment_required = EXCLUDED.payment_required;
    `);
    console.log("Plans seeded successfully (Starter / Pro / Enterprise).");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("seed-plans failed:", err);
  process.exit(1);
});
