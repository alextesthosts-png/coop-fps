// Player save storage: Postgres when DATABASE_URL is set (Railway), JSON file otherwise (local dev).
const fs = require('fs');
const path = require('path');

const DEFAULTS = { credits: 500, bank: 0, kills: 0, best_wave: 0, games: 0, playtime: 0, escapes: 0, weapons: ['rifle', 'pistol'] };

function rowToProfile(r) {
  let weapons = DEFAULTS.weapons;
  try { const w = JSON.parse(r.weapons); if (Array.isArray(w) && w.length) weapons = w; } catch {}
  return {
    token: r.token, name: r.name, credits: r.credits | 0, bank: r.bank | 0, kills: r.kills | 0,
    best_wave: r.best_wave | 0, games: r.games | 0, playtime: r.playtime | 0, escapes: r.escapes | 0, weapons,
  };
}

let impl;

if (process.env.DATABASE_URL) {
  const { Pool } = require('pg');
  const url = process.env.DATABASE_URL;
  const pool = new Pool({
    connectionString: url,
    ssl: /railway\.internal|localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false },
    max: 5,
  });
  pool.on('error', e => console.error('[db] pool error', e.message));
  const ready = (async () => {
    for (let i = 0; i < 10; i++) {
      try {
        await pool.query(`CREATE TABLE IF NOT EXISTS profiles (
          token TEXT PRIMARY KEY,
          name TEXT NOT NULL DEFAULT '',
          credits INTEGER NOT NULL DEFAULT 500,
          bank INTEGER NOT NULL DEFAULT 0,
          kills INTEGER NOT NULL DEFAULT 0,
          best_wave INTEGER NOT NULL DEFAULT 0,
          games INTEGER NOT NULL DEFAULT 0,
          playtime INTEGER NOT NULL DEFAULT 0,
          weapons TEXT NOT NULL DEFAULT '["rifle","pistol"]',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
        await pool.query('ALTER TABLE profiles ADD COLUMN IF NOT EXISTS escapes INTEGER NOT NULL DEFAULT 0');
        console.log('[db] Postgres ready');
        return true;
      } catch (e) {
        console.error(`[db] connect attempt ${i + 1} failed: ${e.message}`);
        await new Promise(r => setTimeout(r, 3000));
      }
    }
    return false;
  })();

  impl = {
    kind: 'postgres',
    async load(token) {
      if (!(await ready)) return null;
      const { rows } = await pool.query('SELECT * FROM profiles WHERE token = $1', [token]);
      return rows[0] ? rowToProfile(rows[0]) : null;
    },
    async save(p) {
      if (!(await ready)) return;
      await pool.query(
        `INSERT INTO profiles (token, name, credits, bank, kills, best_wave, games, playtime, weapons, escapes, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
         ON CONFLICT (token) DO UPDATE SET name=$2, credits=$3, bank=$4, kills=$5, best_wave=$6,
           games=$7, playtime=$8, weapons=$9, escapes=$10, updated_at=now()`,
        [p.token, p.name, p.credits, p.bank, p.kills, p.best_wave, p.games, p.playtime, JSON.stringify(p.weapons), p.escapes | 0]
      );
    },
    async top(n = 5) {
      if (!(await ready)) return [];
      const { rows } = await pool.query('SELECT name, best_wave, kills, escapes FROM profiles WHERE best_wave > 0 ORDER BY escapes DESC, best_wave DESC, kills DESC LIMIT $1', [n]);
      return rows;
    },
  };
} else {
  const file = path.join(__dirname, 'data', 'profiles.json');
  let data = {};
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  let writeTimer = null;
  const persist = () => {
    clearTimeout(writeTimer);
    writeTimer = setTimeout(() => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(data, null, 1));
    }, 200);
  };
  console.log('[db] DATABASE_URL not set — saving to data/profiles.json');
  impl = {
    kind: 'file',
    async load(token) { return data[token] ? rowToProfile({ ...data[token], weapons: JSON.stringify(data[token].weapons) }) : null; },
    async save(p) { data[p.token] = { ...p }; persist(); },
    async top(n = 5) {
      return Object.values(data).filter(p => p.best_wave > 0)
        .sort((a, b) => (b.escapes | 0) - (a.escapes | 0) || b.best_wave - a.best_wave || b.kills - a.kills).slice(0, n)
        .map(({ name, best_wave, kills, escapes }) => ({ name, best_wave, kills, escapes: escapes | 0 }));
    },
  };
}

module.exports = { ...impl, DEFAULTS };
