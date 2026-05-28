import { Pool } from 'pg';

const pool = new Pool({
  user: 'postgres',
  host: "171.244.141.14",
  database: 'Recloser app',
   password: '1122',
  port: 5432,
});

async function testConnection() {
  try {
    const res = await pool.query('SELECT NOW()');
    console.log('✅ DB connected! Server time:', res.rows[0].now);
  } catch (err) {
    console.error('❌ DB connection failed:', err);
  } finally {
    await pool.end();
  }
}
testConnection();
