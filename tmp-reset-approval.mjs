import fs from 'fs';
import pg from 'pg';

const env = Object.fromEntries(
  fs
    .readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const i = line.indexOf('=');
      return [line.slice(0, i), line.slice(i + 1).replace(/^["']|["']$/g, '')];
    }),
);

const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
const updated = await pool.query(`
  UPDATE "StrategyLog" s
  SET "isApproved" = false
  WHERE s."isApproved" = true
    AND s.decision = 'BUY'
    AND s."analyzedAt" >= (timezone('Asia/Seoul', now())::date)::timestamp AT TIME ZONE 'Asia/Seoul'
    AND NOT EXISTS (
      SELECT 1 FROM "TradeHistory" t WHERE t."strategyId" = s.id
    )
  RETURNING s.id, s.symbol
`);
console.log(JSON.stringify(updated.rows));
await pool.end();
