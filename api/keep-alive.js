// api/keep-alive.js
const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.REACT_APP_SUPABASE_URL ||
  'https://dyttovrxxhralwgvzjab.supabase.co';

const ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY;

module.exports = async (req, res) => {
  if (!ANON_KEY) {
    return res.status(500).json({ ok: false, erro: 'Falta SUPABASE_ANON_KEY' });
  }
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/keep_alive`, {
      method: 'POST',
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${ANON_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: '{}',
    });
    if (!r.ok) {
      const detalhe = await r.text();
      return res.status(502).json({ ok: false, status: r.status, detalhe });
    }
    return res.status(200).json({ ok: true, em: new Date().toISOString() });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: String(e) });
  }
};
