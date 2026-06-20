import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  LayoutDashboard, Users, FolderKanban, Clock, FileText, CalendarCheck,
  Settings, Plus, X, Pencil, Trash2, Check, Play, Square, Search,
  Download, Upload, CalendarDays, ChevronLeft, ChevronRight, LogOut, WifiOff, Menu
} from 'lucide-react';
import { createClient } from '@supabase/supabase-js';

/* ============================================================
   ATELIER — Supabase + Google OAuth + online-first
   Gestão pessoal para arquitecto (PT)

   Modo offline (online-first robusto):
   - Online: tudo sincroniza em tempo real entre dispositivos
   - Offline: vê os dados em cache, mas a edição fica bloqueada
     até a ligação voltar (evita escritas perdidas/corrompidas)
   ============================================================ */

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL || 'https://xxxxx.supabase.co';
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY || 'eyXXXXX...';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---------- IndexedDB (cache de leitura offline) ----------
const DB_NAME = 'atelier_local';
const DB_VERSION = 2;
const STORES = ['clients', 'projects', 'hours', 'invoices', 'obligations', 'events', 'settings', 'tranches'];

const openDB = () => new Promise((resolve, reject) => {
  const req = indexedDB.open(DB_NAME, DB_VERSION);
  req.onerror = () => reject(req.error);
  req.onsuccess = () => resolve(req.result);
  req.onupgradeneeded = (e) => {
    const db = e.target.result;
    STORES.forEach(s => { if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' }); });
  };
});

const cacheWrite = async (store, items) => {
  try {
    const db = await openDB();
    const tx = db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    os.clear();
    (items || []).forEach(it => os.put(it));
    return new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
  } catch { /* cache é best-effort */ }
};

const cacheReadAll = async (store) => {
  try {
    const db = await openDB();
    return await new Promise((res, rej) => {
      const r = db.transaction(store).objectStore(store).getAll();
      r.onsuccess = () => res(r.result || []);
      r.onerror = () => rej(r.error);
    });
  } catch { return []; }
};

// ---------- Constants ----------
const PHASES = ['Programa preliminar', 'Estudo prévio', 'Anteprojecto', 'Projecto base', 'Projecto de execução', 'Assistência técnica'];
const PROJECT_STATUS = ['Activo', 'Em pausa', 'Concluído', 'Cancelado'];
const INVOICE_STATUS = ['Emitida', 'Paga', 'Vencida'];
const OBLIGATION_PRESETS = [
  { id: 'iva-trim', label: 'IVA trimestral', recurrence: 'quarterly' },
  { id: 'iva-mensal', label: 'IVA mensal', recurrence: 'monthly' },
  { id: 'ss', label: 'Segurança Social', recurrence: 'monthly' },
  { id: 'irs-ret', label: 'Retenção IRS', recurrence: 'quarterly' },
  { id: 'irs-anual', label: 'IRS anual (Modelo 3)', recurrence: 'annual' },
  { id: 'ies', label: 'IES / Declaração anual', recurrence: 'annual' },
  { id: 'outro', label: 'Outro', recurrence: 'custom' }
];
const EVENT_TYPES = [
  { id: 'reuniao', label: 'Reunião', color: '#1D3557' },
  { id: 'visita', label: 'Visita de obra', color: '#3F6B3F' },
  { id: 'entrega', label: 'Entrega / prazo', color: '#A85420' },
  { id: 'licenciamento', label: 'Licenciamento', color: '#6A4C93' },
  { id: 'outro', label: 'Outro', color: '#6C6E68' }
];
const MONTH_NAMES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const WEEKDAY_NAMES = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

const DEFAULT_SETTINGS = { name: '', nif: '', hourlyRate: 35, ivaRate: 23, irsRetention: 25, paymentDueDays: 30 };

const T = {
  bg: '#E4E2D7', card: '#F5F4EE', cardSoft: '#EEECE3',
  ink: '#16181A', inkSoft: '#6C6E68', inkMuted: '#9A9A92',
  rule: '#C7C5BB', ruleSoft: '#D8D6CC',
  accent: '#1D3557', accentBg: '#DDE5ED',
  positive: '#3F6B3F', positiveBg: '#DCE7CE',
  alert: '#A85420', alertBg: '#EFDDC8',
  white: '#FFFFFF'
};

// ---------- Utils ----------
const fmtEUR = (n) => new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(Number(n) || 0);
const fmtNum = (n, d = 2) => Number(n || 0).toLocaleString('pt-PT', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('pt-PT') : '—';
const fmtDateShort = (d) => d ? new Date(d).toLocaleDateString('pt-PT', { day: '2-digit', month: 'short' }) : '—';
const todayISO = () => new Date().toISOString().split('T')[0];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const daysUntil = (d) => Math.ceil((new Date(d).setHours(0,0,0,0) - new Date().setHours(0,0,0,0)) / 86400000);
const addDays = (date, days) => { const d = new Date(date); d.setDate(d.getDate() + days); return d.toISOString().split('T')[0]; };
const addMonths = (date, months) => { const d = new Date(date); d.setMonth(d.getMonth() + months); return d.toISOString().split('T')[0]; };

// rate guardada = valor LÍQUIDO desejado/hora. Devolve os 3 níveis: líquido, bruto (p/ factura), bruto+IVA.
const calcRateTiers = (netRate, irsRate = 0, ivaRate = 0) => {
  const net = Number(netRate) || 0;
  const gross = irsRate > 0 ? net / (1 - irsRate / 100) : net;
  const grossWithIva = gross * (1 + (ivaRate || 0) / 100);
  return { net, gross, grossWithIva };
};

// ---------- Online detection hook ----------
function useOnline() {
  const [online, setOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}

// ============================================================
// Main App
// ============================================================
export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('dashboard');
  const [data, setData] = useState({ clients: [], projects: [], hours: [], invoices: [], obligations: [], events: [], tranches: [] });
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [timer, setTimer] = useState(null);
  const [syncStatus, setSyncStatus] = useState('synced'); // syncing | synced | error
  const [menuOpen, setMenuOpen] = useState(false);
  const online = useOnline();

  // Auth
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setUser(session?.user || null);
      setLoading(false);
    })();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => setUser(session?.user || null));
    return () => subscription?.unsubscribe();
  }, []);

  // Pull everything from Supabase (or cache when offline)
  const refresh = useCallback(async () => {
    if (!user) return;
    if (!online) {
      // offline: ler da cache
      const [clients, projects, hours, invoices, obligations, events, tranches] = await Promise.all(
        ['clients', 'projects', 'hours', 'invoices', 'obligations', 'events', 'tranches'].map(cacheReadAll)
      );
      setData({ clients, projects, hours, invoices, obligations, events, tranches });
      const cs = await cacheReadAll('settings');
      if (cs[0]) setSettings(cs[0]);
      return;
    }
    setSyncStatus('syncing');
    try {
      const [c, p, h, i, o, e, s, t] = await Promise.all([
        supabase.from('clients').select('*').eq('user_id', user.id),
        supabase.from('projects').select('*').eq('user_id', user.id),
        supabase.from('hours').select('*').eq('user_id', user.id),
        supabase.from('invoices').select('*').eq('user_id', user.id),
        supabase.from('obligations').select('*').eq('user_id', user.id),
        supabase.from('events').select('*').eq('user_id', user.id),
        supabase.from('settings').select('*').eq('user_id', user.id).maybeSingle(),
        supabase.from('project_tranches').select('*').eq('user_id', user.id)
      ]);
      const err = [c, p, h, i, o, e, t].find(r => r.error);
      if (err) throw err.error;
      const next = {
        clients: c.data || [], projects: p.data || [], hours: h.data || [],
        invoices: i.data || [], obligations: o.data || [], events: e.data || [],
        tranches: t.data || []
      };
      setData(next);
      if (s.data) setSettings(mapSettingsFromDb(s.data));
      // actualizar cache
      Object.entries(next).forEach(([k, v]) => cacheWrite(k, v));
      if (s.data) cacheWrite('settings', [{ id: 'me', ...mapSettingsFromDb(s.data) }]);
      setSyncStatus('synced');
    } catch (err) {
      setSyncStatus('error');
    }
  }, [user, online]);

  useEffect(() => { refresh(); }, [refresh]);

  // Realtime: qualquer alteração nas tabelas repuxa os dados
  useEffect(() => {
    if (!user || !online) return;
    const tables = ['clients', 'projects', 'hours', 'invoices', 'obligations', 'events', 'settings', 'project_tranches'];
    const channels = tables.map(t =>
      supabase.channel(`${t}:${user.id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: t, filter: `user_id=eq.${user.id}` }, () => refresh())
        .subscribe()
    );
    return () => channels.forEach(ch => supabase.removeChannel(ch));
  }, [user, online, refresh]);

  // Backup diário automático no servidor
  useEffect(() => {
    if (!user || !online) return;
    const doBackup = async () => {
      const last = localStorage.getItem('atelier_last_backup');
      const today = todayISO();
      if (last === today) return;
      await supabase.from('backups').insert({ user_id: user.id, backup_data: { ...data, settings, createdAt: new Date().toISOString() } });
      localStorage.setItem('atelier_last_backup', today);
    };
    doBackup();
  }, [user, online, data, settings]);

  const login = async () => {
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
    if (error) alert('Erro ao entrar: ' + error.message);
  };
  const logout = async () => { await supabase.auth.signOut(); setUser(null); };

  // ---- CRUD helper passado às views ----
  // Bloqueia escrita quando offline; aplica optimistic update + persiste no Supabase
  const makeCrud = (table, key) => ({
    insert: async (row) => {
      if (!online) { alert('Está offline. A edição fica disponível assim que a ligação voltar.'); return false; }
      const record = { ...row, user_id: user.id };
      setData(d => ({ ...d, [key]: [record, ...d[key]] }));
      const { error } = await supabase.from(table).insert([record]);
      if (error) { alert('Erro ao guardar: ' + error.message); refresh(); return false; }
      return true;
    },
    update: async (id, patch) => {
      if (!online) { alert('Está offline. A edição fica disponível assim que a ligação voltar.'); return false; }
      setData(d => ({ ...d, [key]: d[key].map(x => x.id === id ? { ...x, ...patch } : x) }));
      const { error } = await supabase.from(table).update(patch).eq('id', id).eq('user_id', user.id);
      if (error) { alert('Erro ao actualizar: ' + error.message); refresh(); return false; }
      return true;
    },
    remove: async (id) => {
      if (!online) { alert('Está offline. A edição fica disponível assim que a ligação voltar.'); return false; }
      setData(d => ({ ...d, [key]: d[key].filter(x => x.id !== id) }));
      const { error } = await supabase.from(table).delete().eq('id', id).eq('user_id', user.id);
      if (error) { alert('Erro ao eliminar: ' + error.message); refresh(); return false; }
      return true;
    }
  });

  if (loading) return <Splash text="a carregar…" />;
  if (!user) return <LoginScreen onLogin={login} />;

  const { clients, projects, hours, invoices, obligations, events, tranches } = data;

  const closeMenu = () => setMenuOpen(false);

  return (
    <>
      <GlobalStyles />
      <div className="sans" style={{ background: T.bg, color: T.ink, minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        <TopBar
          view={view} timer={timer} setTimer={setTimer}
          projects={projects} settings={settings}
          online={online} crud={makeCrud}
          menuOpen={menuOpen} setMenuOpen={setMenuOpen}
        />
        <div style={{ display: 'flex', flex: 1, minWidth: 0 }}>
          <Sidebar 
            view={view} setView={setView} user={user} onLogout={logout} 
            syncStatus={syncStatus} online={online}
            menuOpen={menuOpen} closeMenu={closeMenu}
          />
          <div className="main-content" style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            {!online && <OfflineBanner />}
            <main style={{ padding: '28px 32px', maxWidth: 1400, flex: 1, overflowY: 'auto' }}>
              {view === 'dashboard' && <Dashboard {...{ clients, projects, hours, invoices, obligations, setView }} />}
              {view === 'clients' && <ClientsView crud={makeCrud('clients', 'clients')} {...{ clients, projects, invoices, user, online }} />}
              {view === 'projects' && <ProjectsView crud={makeCrud('projects', 'projects')} tranchesCrud={makeCrud('project_tranches', 'tranches')} invoicesCrud={makeCrud('invoices', 'invoices')} {...{ projects, clients, hours, invoices, tranches, settings, user, online }} />}
              {view === 'hours' && <HoursView crud={makeCrud('hours', 'hours')} {...{ hours, projects, settings, user, online }} />}
              {view === 'invoices' && <InvoicesView crud={makeCrud('invoices', 'invoices')} {...{ invoices, clients, projects, settings, user, online }} />}
              {view === 'fiscal' && <FiscalView crud={makeCrud('obligations', 'obligations')} {...{ obligations, user, online }} />}
              {view === 'agenda' && <AgendaView crud={makeCrud('events', 'events')} {...{ obligations, invoices, projects, clients, events, user, online }} />}
              {view === 'settings' && <SettingsView {...{ settings, setSettings, data, user, online, supabaseClient: supabase, onRefresh: refresh }} />}
            </main>
          </div>
        </div>
        {menuOpen && <div className="mobile-menu-overlay" onClick={closeMenu} style={{ position: 'fixed', inset: 0, background: 'rgba(22,24,26,0.3)', zIndex: 40 }} />}
      </div>
    </>
  );
}

// settings vem da BD em snake_case
function mapSettingsFromDb(s) {
  return {
    name: s.name || '', nif: s.nif || '',
    hourlyRate: s.hourly_rate ?? 35, ivaRate: s.iva_rate ?? 23,
    irsRetention: s.irs_retention ?? 25, paymentDueDays: s.payment_due_days ?? 30
  };
}

function Splash({ text }) {
  return <div style={{ background: T.bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.inkSoft, fontFamily: 'Inter, system-ui, sans-serif' }}>{text}</div>;
}

function OfflineBanner() {
  return (
    <div style={{ background: T.alertBg, borderBottom: `1px solid ${T.alert}`, padding: '10px 32px', display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: T.alert }} className="sans">
      <WifiOff size={15} />
      <span><strong>Sem ligação.</strong> Pode consultar os seus dados, mas a edição está bloqueada até a internet voltar — para não perder alterações.</span>
    </div>
  );
}

// ============================================================
// Global styles
// ============================================================
function GlobalStyles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');
      * { box-sizing: border-box; }
      body { margin: 0; }
      @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
      .mono { font-family: 'JetBrains Mono', ui-monospace, monospace; font-variant-numeric: tabular-nums; }
      .sans { font-family: 'Inter', system-ui, sans-serif; }
      .ruler { background-image: linear-gradient(to right, ${T.rule} 1px, transparent 1px); background-size: 8px 100%; height: 6px; opacity: 0.4; }
      button { cursor: pointer; font-family: inherit; }
      button:disabled { opacity: 0.4; cursor: not-allowed; }
      input, select, textarea { font-family: inherit; }
      .btn-primary { background: ${T.ink}; color: ${T.card}; border: 1px solid ${T.ink}; padding: 8px 14px; font-size: 13px; font-weight: 500; transition: background 0.1s; }
      .btn-primary:hover:not(:disabled) { background: #2A2D30; }
      .btn-secondary { background: transparent; color: ${T.ink}; border: 1px solid ${T.rule}; padding: 8px 14px; font-size: 13px; font-weight: 500; transition: background 0.1s; }
      .btn-secondary:hover:not(:disabled) { background: ${T.cardSoft}; }
      .btn-danger { background: transparent; color: ${T.alert}; border: 1px solid ${T.alert}; padding: 6px 12px; font-size: 12px; }
      .btn-danger:hover:not(:disabled) { background: ${T.alertBg}; }
      .btn-icon { background: transparent; border: none; padding: 6px; color: ${T.inkSoft}; display: inline-flex; align-items: center; justify-content: center; transition: color 0.1s; }
      .btn-icon:hover:not(:disabled) { color: ${T.ink}; }
      .input { background: ${T.white}; border: 1px solid ${T.rule}; padding: 8px 10px; font-size: 13px; color: ${T.ink}; width: 100%; }
      .input:focus { outline: none; border-color: ${T.ink}; }
      .label { font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: ${T.inkSoft}; display: block; margin-bottom: 6px; }
      .table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
      table { width: 100%; border-collapse: collapse; font-size: 13px; }
      th { text-align: left; font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: ${T.inkSoft}; padding: 10px 12px; border-bottom: 1px solid ${T.rule}; background: ${T.cardSoft}; white-space: nowrap; }
      td { padding: 12px; border-bottom: 1px solid ${T.ruleSoft}; vertical-align: middle; }
      tr:hover td { background: ${T.cardSoft}; }
      .nav-item { display: flex; align-items: center; gap: 10px; padding: 10px 16px; color: ${T.inkSoft}; font-size: 13px; font-weight: 500; border-left: 2px solid transparent; cursor: pointer; transition: all 0.1s; }
      .nav-item:hover { color: ${T.ink}; background: ${T.cardSoft}; }
      .nav-item.active { color: ${T.ink}; background: ${T.cardSoft}; border-left-color: ${T.ink}; }
      .badge { display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; font-size: 11px; font-weight: 500; border: 1px solid; }
      .modal-bg { position: fixed; inset: 0; background: rgba(22,24,26,0.45); display: flex; align-items: center; justify-content: center; z-index: 50; padding: 20px; }
      .modal { background: ${T.card}; max-width: 560px; width: 100%; max-height: 90vh; overflow-y: auto; border: 1px solid ${T.rule}; }
      .modal-header { display: flex; justify-content: space-between; align-items: center; padding: 18px 20px; border-bottom: 1px solid ${T.rule}; }
      .modal-body { padding: 20px; }
      .modal-footer { padding: 14px 20px; border-top: 1px solid ${T.rule}; display: flex; justify-content: flex-end; gap: 8px; background: ${T.cardSoft}; }
      .empty { padding: 60px 20px; text-align: center; color: ${T.inkSoft}; }
      .empty-title { font-size: 14px; color: ${T.ink}; margin-bottom: 4px; font-weight: 500; }
      .empty-sub { font-size: 13px; color: ${T.inkSoft}; }
      
      /* Sidebar transform: default closed (off-canvas), opened via class, always open on desktop */
      .sidebar { transform: translateX(-100%); }
      .sidebar.sidebar-open { transform: translateX(0); }
      
      /* Desktop: sidebar always visible, content offset by its width */
      @media (min-width: 769px) {
        .sidebar { transform: translateX(0); }
        .main-content { margin-left: 220px; }
      }
      
      /* Mobile responsive */
      @media (max-width: 768px) {
        .sidebar { width: 80vw; max-width: 280px; }
        .mobile-menu-btn { display: inline-flex !important; }
        header { flex-direction: column; align-items: flex-start; }
        main { padding: 20px 16px !important; }
        .input { font-size: 16px; } /* Prevent mobile zoom on input focus */
        .table-wrap {
          position: relative;
          background:
            linear-gradient(to right, ${T.card} 0%, transparent 4%) 0 0,
            linear-gradient(to right, transparent 96%, ${T.card} 100%) 0 0,
            linear-gradient(to right, rgba(22,24,26,0.08), transparent 8px) 0 0,
            linear-gradient(to left, rgba(22,24,26,0.08), transparent 8px) 100% 0;
          background-repeat: no-repeat;
          background-size: 24px 100%, 24px 100%, 24px 100%, 24px 100%;
          background-attachment: local, local, scroll, scroll;
        }
        table { min-width: 560px; }
        .toolbar-mobile-stack { flex-direction: column; align-items: stretch !important; }
        .toolbar-mobile-stack > * { max-width: 100% !important; width: 100%; }
      }
    `}</style>
  );
}

// ============================================================
// Login
// ============================================================
function LoginScreen({ onLogin }) {
  return (
    <>
      <GlobalStyles />
      <div className="sans" style={{ background: T.bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 28, padding: 40 }}>
        <div style={{ maxWidth: 420, textAlign: 'center' }}>
          <div className="mono" style={{ fontSize: 11, color: T.inkSoft, letterSpacing: '0.12em', marginBottom: 18 }}>ATL · 001</div>
          <h1 style={{ fontSize: 38, fontWeight: 700, color: T.ink, margin: '0 0 12px' }}>Atelier</h1>
          <p style={{ fontSize: 15, color: T.inkSoft, lineHeight: 1.6, margin: 0 }}>
            Clientes, projectos, horas, facturas e impostos — num só sítio, sincronizado em todos os seus dispositivos.
          </p>
        </div>
        <button className="btn-primary" onClick={onLogin} style={{ padding: '12px 28px', fontSize: 14, fontWeight: 600 }}>
          Entrar com Google
        </button>
        <div style={{ maxWidth: 380, fontSize: 12, color: T.inkMuted, lineHeight: 1.7, textAlign: 'center' }}>
          Os dados ficam na sua conta privada. Acede de qualquer lugar com a mesma conta Google.
        </div>
      </div>
    </>
  );
}

// ============================================================
// Sidebar
// ============================================================
function Sidebar({ view, setView, user, onLogout, syncStatus, online, menuOpen, closeMenu }) {
  const items = [
    { id: 'dashboard', label: 'Painel', icon: LayoutDashboard },
    { id: 'clients', label: 'Clientes', icon: Users },
    { id: 'projects', label: 'Projectos', icon: FolderKanban },
    { id: 'hours', label: 'Registo de horas', icon: Clock },
    { id: 'invoices', label: 'Facturas', icon: FileText },
    { id: 'fiscal', label: 'Obrigações fiscais', icon: CalendarCheck },
    { id: 'agenda', label: 'Agenda', icon: CalendarDays },
    { id: 'settings', label: 'Definições', icon: Settings }
  ];
  const dot = !online ? T.alert : syncStatus === 'synced' ? T.positive : syncStatus === 'syncing' ? T.accent : T.alert;
  const dotLabel = !online ? 'Offline' : syncStatus === 'synced' ? 'Sincronizado' : syncStatus === 'syncing' ? 'A sincronizar…' : 'Erro de sync';
  
  const handleNavClick = (id) => {
    setView(id);
    closeMenu();
  };

  return (
    <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`} style={{ width: 220, background: T.card, borderRight: `1px solid ${T.rule}`, position: 'fixed', top: 0, bottom: 0, left: 0, display: 'flex', flexDirection: 'column', zIndex: 50, transition: 'transform 0.3s ease', paddingTop: 64 }}>
      <div style={{ padding: '22px 18px 16px', borderBottom: `1px solid ${T.rule}` }}>
        <div className="mono" style={{ fontSize: 11, color: T.inkSoft, letterSpacing: '0.12em' }}>ATL · 001</div>
        <div style={{ fontSize: 18, fontWeight: 600, marginTop: 2 }}>Atelier</div>
        <div className="ruler" style={{ marginTop: 12 }} />
      </div>
      <nav style={{ flex: 1, padding: '10px 0', overflowY: 'auto' }}>
        {items.map(item => {
          const Icon = item.icon;
          return (
            <div key={item.id} className={`nav-item ${view === item.id ? 'active' : ''}`} onClick={() => handleNavClick(item.id)}>
              <Icon size={15} strokeWidth={1.75} /><span>{item.label}</span>
            </div>
          );
        })}
      </nav>
      <div style={{ padding: '10px 14px', borderTop: `1px solid ${T.rule}` }} className="mono">
        <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: T.inkSoft }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: dot }} />{dotLabel}
        </div>
        {user?.email && <div style={{ fontSize: 10, color: T.inkMuted, marginBottom: 8, wordBreak: 'break-all' }}>{user.email}</div>}
        <button className="btn-secondary" onClick={onLogout} style={{ width: '100%', padding: '5px 8px', fontSize: 11 }}>
          <LogOut size={11} style={{ display: 'inline', marginRight: 4 }} /> Sair
        </button>
      </div>
    </aside>
  );
}

// ============================================================
// TopBar + timer
// ============================================================
function TopBar({ view, timer, setTimer, projects, settings, online, crud, menuOpen, setMenuOpen }) {
  const [, setTick] = useState(0);
  const [showStart, setShowStart] = useState(false);
  useEffect(() => {
    if (!timer) return;
    const i = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(i);
  }, [timer]);

  const titles = { dashboard: 'Painel', clients: 'Clientes', projects: 'Projectos', hours: 'Registo de horas', invoices: 'Facturas', fiscal: 'Obrigações fiscais', agenda: 'Agenda', settings: 'Definições' };
  const activeProjects = projects.filter(p => p.status === 'Activo');
  const elapsedMs = timer ? Date.now() - timer.startedAt : 0;
  const eH = Math.floor(elapsedMs / 3600000), eM = Math.floor((elapsedMs % 3600000) / 60000), eS = Math.floor((elapsedMs % 60000) / 1000);
  const timerProject = timer && projects.find(p => p.id === timer.projectId);
  const hoursCrud = crud('hours', 'hours');

  const startTimer = (projectId, description) => { setTimer({ projectId, description: description || '', startedAt: Date.now() }); setShowStart(false); };

  const stopTimer = async () => {
    if (!timer) return;
    const totalHours = elapsedMs / 3600000;
    if (totalHours < 0.005) { if (!confirm('Menos de 30 segundos. Descartar?')) return; setTimer(null); return; }
    const project = projects.find(p => p.id === timer.projectId);
    const rate = project?.hourly_rate || settings.hourlyRate;
    const ok = await hoursCrud.insert({
      id: uid(), date: todayISO(), project_id: timer.projectId, description: timer.description || '',
      hours: Math.round(totalHours * 100) / 100, rate, iva_rate: settings.ivaRate, billed: false
    });
    if (ok !== false) setTimer(null);
  };

  return (
    <header style={{ background: T.card, borderBottom: `1px solid ${T.rule}`, padding: '16px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 64, zIndex: 30, position: 'relative', gap: 16, flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1 }}>
        <button 
          className="btn-icon mobile-menu-btn"
          onClick={() => setMenuOpen(!menuOpen)}
          style={{ display: 'none' }}
          aria-label="Menu"
        >
          <Menu size={20} />
        </button>
        <div style={{ minWidth: 0 }}>
          <div className="mono" style={{ fontSize: 10, color: T.inkMuted, letterSpacing: '0.15em' }}>{todayISO().toUpperCase()}</div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{titles[view]}</h1>
        </div>
      </div>
      {timer ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: T.accentBg, border: `1px solid ${T.accent}`, padding: '8px 14px' }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: T.accent, animation: 'pulse 1.5s infinite' }} />
          <div>
            <div className="mono" style={{ fontSize: 16, fontWeight: 600, color: T.accent }}>
              {String(eH).padStart(2, '0')}:{String(eM).padStart(2, '0')}:{String(eS).padStart(2, '0')}
            </div>
            <div style={{ fontSize: 11, color: T.inkSoft, marginTop: -2 }}>{timerProject?.name || 'sem projecto'}</div>
          </div>
          <button className="btn-secondary" onClick={stopTimer} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Square size={12} fill="currentColor" /> Parar
          </button>
        </div>
      ) : (
        <button className="btn-secondary" onClick={() => setShowStart(true)} disabled={!online} style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
          <Play size={13} fill="currentColor" /> Iniciar cronómetro
        </button>
      )}
      {showStart && <StartTimerModal projects={activeProjects.length ? activeProjects : projects} onStart={startTimer} onClose={() => setShowStart(false)} />}
    </header>
  );
}

function StartTimerModal({ projects, onStart, onClose }) {
  const [projectId, setProjectId] = useState(projects[0]?.id || '');
  const [description, setDescription] = useState('');
  return (
    <Modal title="Iniciar cronómetro" onClose={onClose}>
      <div style={{ display: 'grid', gap: 14 }}>
        <Field label="Projecto">
          <select className="input" value={projectId} onChange={e => setProjectId(e.target.value)} autoFocus>
            <option value="">— sem projecto —</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Descrição (opcional)">
          <input className="input" value={description} onChange={e => setDescription(e.target.value)} placeholder="ex: pormenores construtivos" />
        </Field>
        <div style={{ fontSize: 12, color: T.inkSoft, padding: 12, background: T.cardSoft, border: `1px solid ${T.ruleSoft}` }}>
          Ao parar, as horas decorridas são registadas neste projecto. Pode editar ou apagar depois.
        </div>
      </div>
      <div className="modal-footer">
        <button className="btn-secondary" onClick={onClose}>Cancelar</button>
        <button className="btn-primary" onClick={() => onStart(projectId, description)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Play size={12} fill="currentColor" /> Iniciar
        </button>
      </div>
    </Modal>
  );
}

// ============================================================
// Dashboard
// ============================================================
function Dashboard({ clients, projects, hours, invoices, obligations, setView }) {
  const stats = useMemo(() => {
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const mh = hours.filter(h => new Date(h.date) >= monthStart);
    return {
      monthHours: mh.reduce((s, h) => s + (h.hours || 0), 0),
      monthEarnings: mh.reduce((s, h) => s + (h.hours * (h.rate || 0)), 0),
      openInvoices: invoices.filter(i => i.status !== 'Paga').reduce((s, i) => s + (i.total_amount || 0), 0),
      overdueInvoices: invoices.filter(i => i.status === 'Vencida').reduce((s, i) => s + (i.total_amount || 0), 0),
      activeProjects: projects.filter(p => p.status === 'Activo').length
    };
  }, [hours, invoices, projects]);

  const upcoming = useMemo(() => [...obligations].filter(o => !o.done).sort((a, b) => new Date(a.due_date) - new Date(b.due_date)).slice(0, 5), [obligations]);

  const activeList = useMemo(() => projects.filter(p => p.status === 'Activo').map(p => {
    const hrs = hours.filter(h => h.project_id === p.id);
    const totalHours = hrs.reduce((s, h) => s + (h.hours || 0), 0);
    const hoursNet = hrs.reduce((s, h) => s + (h.hours * (h.rate || 0)), 0);
    const isFixed = p.billing_type === 'fixed';
    const earned = isFixed ? (p.fixed_net_amount || 0) : hoursNet;
    const budget = isFixed ? (p.fixed_net_amount || 0) : p.budget;
    return { ...p, totalHours, earned, budget, progress: budget ? (earned / budget) * 100 : 0, clientName: clients.find(c => c.id === p.client_id)?.name || '—' };
  }).sort((a, b) => b.progress - a.progress).slice(0, 6), [projects, hours, clients]);

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 1, background: T.rule, border: `1px solid ${T.rule}`, marginBottom: 32 }}>
        <Stat label="Horas este mês" value={fmtNum(stats.monthHours, 1)} suffix="h" hint={fmtEUR(stats.monthEarnings) + ' valor de trabalho'} />
        <Stat label="Por receber" value={fmtEUR(stats.openInvoices)} tone={stats.overdueInvoices > 0 ? 'alert' : 'neutral'} hint={stats.overdueInvoices > 0 ? fmtEUR(stats.overdueInvoices) + ' vencido' : 'em dia'} />
        <Stat label="Projectos activos" value={stats.activeProjects} hint={`${projects.length} total`} />
        <Stat label="Clientes" value={clients.length} hint={projects.length + ' projectos'} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 24 }}>
        <Card title="Próximas obrigações fiscais" action={{ label: 'Ver todas →', onClick: () => setView('fiscal') }}>
          {upcoming.length === 0 ? <div className="empty"><div className="empty-title">Sem obrigações pendentes</div></div> : upcoming.map(o => {
            const d = daysUntil(o.due_date), over = d < 0, soon = d >= 0 && d <= 7;
            return (
              <div key={o.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 0', borderBottom: `1px solid ${T.ruleSoft}` }}>
                <div><div style={{ fontWeight: 500, fontSize: 13 }}>{o.label}</div><div className="mono" style={{ fontSize: 11, color: T.inkSoft, marginTop: 2 }}>{fmtDate(o.due_date)} {o.amount > 0 && '· ' + fmtEUR(o.amount)}</div></div>
                <div className="mono" style={{ fontSize: 12, fontWeight: 600, color: over || soon ? T.alert : T.inkSoft }}>{over ? `${Math.abs(d)}d atrasado` : d === 0 ? 'hoje' : `em ${d}d`}</div>
              </div>
            );
          })}
        </Card>
        <Card title="Projectos em curso" action={{ label: 'Ver todos →', onClick: () => setView('projects') }}>
          {activeList.length === 0 ? <div className="empty"><div className="empty-title">Sem projectos activos</div></div> : activeList.map(p => (
            <div key={p.id} style={{ padding: '14px 0', borderBottom: `1px solid ${T.ruleSoft}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <div><div style={{ fontWeight: 500, fontSize: 13 }}>{p.name}</div><div style={{ fontSize: 11, color: T.inkSoft, marginTop: 2 }}>{p.clientName} · {p.phase || 'sem fase'}</div></div>
                <div style={{ textAlign: 'right' }} className="mono"><div style={{ fontSize: 12, fontWeight: 600 }}>{fmtNum(p.totalHours, 1)}h</div>{p.budget > 0 && <div style={{ fontSize: 10, color: T.inkSoft }}>{fmtEUR(p.earned)} / {fmtEUR(p.budget)}</div>}</div>
              </div>
              {p.budget > 0 && <div style={{ marginTop: 8, height: 3, background: T.ruleSoft, position: 'relative' }}><div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${Math.min(p.progress, 100)}%`, background: p.progress > 90 ? T.alert : T.accent }} /></div>}
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value, suffix, hint, tone = 'neutral' }) {
  return (
    <div style={{ background: T.card, padding: '20px 22px' }}>
      <div className="label">{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
        <div className="mono" style={{ fontSize: 28, fontWeight: 600, color: tone === 'alert' ? T.alert : T.ink, lineHeight: 1.1 }}>{value}</div>
        {suffix && <span className="mono" style={{ fontSize: 14, color: T.inkSoft }}>{suffix}</span>}
      </div>
      {hint && <div style={{ fontSize: 11, color: T.inkSoft, marginTop: 6 }}>{hint}</div>}
    </div>
  );
}

function Card({ title, children, action }) {
  return (
    <section style={{ background: T.card, border: `1px solid ${T.rule}` }}>
      <header style={{ padding: '14px 20px', borderBottom: `1px solid ${T.rule}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{title}</h3>
        {action && <button className="btn-icon" onClick={action.onClick} style={{ fontSize: 11, color: T.inkSoft }}>{action.label}</button>}
      </header>
      <div style={{ padding: '4px 20px 16px' }}>{children}</div>
    </section>
  );
}

// ============================================================
// CLIENTS
// ============================================================
function ClientsView({ crud, clients, projects, invoices, online }) {
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState('');

  const rows = useMemo(() => clients.map(c => {
    const cInv = invoices.filter(i => i.client_id === c.id);
    return {
      ...c,
      projectCount: projects.filter(p => p.client_id === c.id).length,
      billed: cInv.reduce((s, i) => s + (i.total_amount || 0), 0),
      open: cInv.filter(i => i.status !== 'Paga').reduce((s, i) => s + (i.total_amount || 0), 0)
    };
  }).filter(c => !search || c.name.toLowerCase().includes(search.toLowerCase()) || (c.nif || '').includes(search)), [clients, projects, invoices, search]);

  const save = async (form) => {
    const ok = editing ? await crud.update(editing.id, form) : await crud.insert({ id: uid(), ...form });
    if (ok !== false) { setModal(false); setEditing(null); }
  };
  const remove = async (id) => {
    if (projects.some(p => p.client_id === id) && !confirm('Cliente tem projectos associados. Eliminar mesmo assim?')) return;
    if (!projects.some(p => p.client_id === id) && !confirm('Eliminar cliente?')) return;
    crud.remove(id);
  };

  return (
    <div>
      <Toolbar>
        <SearchInput value={search} onChange={setSearch} placeholder="Procurar por nome ou NIF…" />
        <button className="btn-primary" onClick={() => { setEditing(null); setModal(true); }} disabled={!online}><Plus size={14} style={{ display: 'inline', marginRight: 6, verticalAlign: '-2px' }} />Novo cliente</button>
      </Toolbar>
      <div style={{ background: T.card, border: `1px solid ${T.rule}` }}>
        {rows.length === 0 ? <div className="empty"><div className="empty-title">{search ? 'Nenhum cliente encontrado' : 'Ainda não tem clientes'}</div></div> : (
          <div className="table-wrap">
          <table>
            <thead><tr><th>Nome</th><th>NIF</th><th>Contacto</th><th style={{ textAlign: 'right' }}>Projectos</th><th style={{ textAlign: 'right' }}>Facturado</th><th style={{ textAlign: 'right' }}>Em aberto</th><th style={{ width: 80 }}></th></tr></thead>
            <tbody>
              {rows.map(c => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 500 }}>{c.name}</td>
                  <td className="mono" style={{ color: T.inkSoft }}>{c.nif || '—'}</td>
                  <td style={{ fontSize: 12, color: T.inkSoft }}>{c.email && <div>{c.email}</div>}{c.phone && <div className="mono">{c.phone}</div>}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{c.projectCount}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{fmtEUR(c.billed)}</td>
                  <td className="mono" style={{ textAlign: 'right', color: c.open > 0 ? T.alert : T.inkSoft }}>{c.open > 0 ? fmtEUR(c.open) : '—'}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn-icon" onClick={() => { setEditing(c); setModal(true); }} disabled={!online}><Pencil size={14} /></button>
                    <button className="btn-icon" onClick={() => remove(c.id)} disabled={!online}><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
      {modal && <ClientModal client={editing} onSave={save} onClose={() => { setModal(false); setEditing(null); }} />}
    </div>
  );
}

function ClientModal({ client, onSave, onClose }) {
  const [f, setF] = useState(client
    ? { name: client.name || '', nif: client.nif || '', email: client.email || '', phone: client.phone || '', address: client.address || '', notes: client.notes || '' }
    : { name: '', nif: '', email: '', phone: '', address: '', notes: '' });
  return (
    <Modal title={client ? 'Editar cliente' : 'Novo cliente'} onClose={onClose}>
      <div style={{ display: 'grid', gap: 14 }}>
        <Field label="Nome"><input className="input" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} autoFocus /></Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <Field label="NIF"><input className="input mono" value={f.nif} onChange={e => setF({ ...f, nif: e.target.value })} /></Field>
          <Field label="Telefone"><input className="input mono" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} /></Field>
        </div>
        <Field label="Email"><input className="input" type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Morada"><input className="input" value={f.address} onChange={e => setF({ ...f, address: e.target.value })} /></Field>
        <Field label="Notas"><textarea className="input" rows={3} value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
      <ModalFooter onCancel={onClose} onSave={() => f.name && onSave(f)} />
    </Modal>
  );
}

// ============================================================
// PROJECTS
// ============================================================
function ProjectsView({ crud, tranchesCrud, invoicesCrud, projects, clients, hours, invoices, tranches, settings, online }) {
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [filter, setFilter] = useState('Activo');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(null);

  const rows = useMemo(() => projects.map(p => {
    const hrs = hours.filter(h => h.project_id === p.id);
    const totalHours = hrs.reduce((s, h) => s + (h.hours || 0), 0);
    const irsRate = settings.irsRetention || 0;
    const ivaRate = settings.ivaRate || 0;
    const isFixed = p.billing_type === 'fixed';
    // soma do líquido desejado por entrada (cada h.rate é o líquido/hora dessa entrada)
    const hoursNet = hrs.reduce((s, h) => s + (h.hours * (h.rate || 0)), 0);
    const netEarned = isFixed ? (p.fixed_net_amount || 0) : hoursNet;
    const grossEarned = irsRate > 0 ? netEarned / (1 - irsRate / 100) : netEarned;
    const grossWithIvaEarned = grossEarned * (1 + ivaRate / 100);
    // em projectos fixos, as horas registadas são "extra" (não contam para o valor fixo)
    const extraNet = isFixed ? hoursNet : 0;
    const extraGross = isFixed ? (irsRate > 0 ? extraNet / (1 - irsRate / 100) : extraNet) : 0;
    const extraGrossWithIva = extraGross * (1 + ivaRate / 100);
    const projectTranches = tranches.filter(t => t.project_id === p.id).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    return {
      ...p,
      totalHours,
      earned: netEarned, // mantém compat: "earned" = líquido (usado no cálculo de % consumo de orçamento)
      netEarned, grossEarned, grossWithIvaEarned,
      extraNet, extraGross, extraGrossWithIva,
      projectTranches,
      clientName: clients.find(c => c.id === p.client_id)?.name || '—'
    };
  }).filter(p => (filter === 'Todos' || p.status === filter) && (!search || p.name.toLowerCase().includes(search.toLowerCase()) || p.clientName.toLowerCase().includes(search.toLowerCase()))), [projects, hours, clients, tranches, filter, search, settings.irsRetention, settings.ivaRate]);

  const save = async (form) => {
    const ok = editing ? await crud.update(editing.id, form) : await crud.insert({ id: uid(), ...form });
    if (ok !== false) { setModal(false); setEditing(null); }
  };
  const remove = async (id) => {
    if (hours.some(h => h.project_id === id) && !confirm('Projecto tem horas registadas. Eliminar mesmo assim?')) return;
    if (!hours.some(h => h.project_id === id) && !confirm('Eliminar projecto?')) return;
    crud.remove(id);
  };

  return (
    <div>
      <Toolbar>
        <SearchInput value={search} onChange={setSearch} placeholder="Procurar projecto ou cliente…" />
        <select className="input" style={{ width: 'auto', maxWidth: 160 }} value={filter} onChange={e => setFilter(e.target.value)}>
          <option value="Todos">Todos os estados</option>{PROJECT_STATUS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <button className="btn-primary" onClick={() => { setEditing(null); setModal(true); }} disabled={!online}><Plus size={14} style={{ display: 'inline', marginRight: 6, verticalAlign: '-2px' }} />Novo projecto</button>
      </Toolbar>
      <div style={{ background: T.card, border: `1px solid ${T.rule}` }}>
        {rows.length === 0 ? <div className="empty"><div className="empty-title">Sem projectos</div></div> : (
          <div className="table-wrap">
          <table>
            <thead><tr><th>Projecto</th><th>Cliente</th><th>Fase</th><th>Tipo</th><th>Estado</th><th style={{ textAlign: 'right' }}>Horas</th><th style={{ textAlign: 'right' }}>Valor líquido</th><th style={{ textAlign: 'right' }}>Consumo</th><th style={{ width: 80 }}></th></tr></thead>
            <tbody>
              {rows.map(p => {
                const isFixed = p.billing_type === 'fixed';
                const pct = isFixed ? (p.netEarned ? 100 : 0) : (p.budget ? (p.earned / p.budget) * 100 : null);
                const isOpen = expanded === p.id;
                return (
                  <React.Fragment key={p.id}>
                  <tr onClick={() => setExpanded(isOpen ? null : p.id)} style={{ cursor: 'pointer' }}>
                    <td><div style={{ fontWeight: 500 }}>{p.name}</div>{p.code && <div className="mono" style={{ fontSize: 11, color: T.inkSoft, marginTop: 2 }}>{p.code}</div>}</td>
                    <td style={{ color: T.inkSoft }}>{p.clientName}</td>
                    <td style={{ fontSize: 12, color: T.inkSoft }}>{p.phase || '—'}</td>
                    <td><span className="badge" style={{ background: isFixed ? T.accentBg : T.cardSoft, color: isFixed ? T.accent : T.inkSoft, borderColor: isFixed ? T.accent : T.rule }}>{isFixed ? 'Orçamento' : 'À hora'}</span></td>
                    <td><StatusBadge status={p.status} /></td>
                    <td className="mono" style={{ textAlign: 'right' }}>{fmtNum(p.totalHours, 1)}h{isFixed && p.totalHours > 0 && <div style={{ fontSize: 10, color: T.accent }}>extra</div>}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{fmtEUR(p.netEarned)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{pct !== null ? <span style={{ color: pct > 90 ? T.alert : T.ink }}>{fmtNum(pct, 0)}%</span> : '—'}</td>
                    <td style={{ textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                      <button className="btn-icon" onClick={() => { setEditing(p); setModal(true); }} disabled={!online}><Pencil size={14} /></button>
                      <button className="btn-icon" onClick={() => remove(p.id)} disabled={!online}><Trash2 size={14} /></button>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={9} style={{ background: T.cardSoft, padding: 0 }}>
                        <div style={{ padding: 16 }}>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1, marginBottom: isFixed ? 16 : 0 }}>
                            <div style={{ padding: '10px 14px', background: T.card, border: `1px solid ${T.ruleSoft}` }}>
                              <div className="label" style={{ marginBottom: 4 }}>Líquido (s/ IRS)</div>
                              <div className="mono" style={{ fontSize: 18, fontWeight: 600 }}>{fmtEUR(p.netEarned)}</div>
                            </div>
                            <div style={{ padding: '10px 14px', background: T.card, border: `1px solid ${T.ruleSoft}` }}>
                              <div className="label" style={{ marginBottom: 4 }}>Bruto (c/ IRS, p/ factura)</div>
                              <div className="mono" style={{ fontSize: 18, fontWeight: 600 }}>{fmtEUR(p.grossEarned)}</div>
                            </div>
                            <div style={{ padding: '10px 14px', background: T.card, border: `1px solid ${T.ruleSoft}` }}>
                              <div className="label" style={{ marginBottom: 4 }}>Bruto c/ IRS e IVA</div>
                              <div className="mono" style={{ fontSize: 18, fontWeight: 600 }}>{fmtEUR(p.grossWithIvaEarned)}</div>
                            </div>
                          </div>
                          {isFixed && p.totalHours > 0 && (
                            <div style={{ display: 'flex', gap: 14, marginBottom: 16, padding: '10px 14px', background: T.accentBg, border: `1px solid ${T.accent}`, fontSize: 12 }}>
                              <span style={{ color: T.accent, fontWeight: 600 }}>Trabalho extra registado:</span>
                              <span className="mono">{fmtNum(p.totalHours, 1)}h líquido {fmtEUR(p.extraNet)} · bruto {fmtEUR(p.extraGross)} · c/IVA {fmtEUR(p.extraGrossWithIva)}</span>
                            </div>
                          )}
                          {isFixed && (
                            <TranchesManager project={p} tranches={p.projectTranches} tranchesCrud={tranchesCrud} invoicesCrud={invoicesCrud} clients={clients} settings={settings} online={online} />
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
      </div>
      {modal && <ProjectModal project={editing} clients={clients} settings={settings} onSave={save} onClose={() => { setModal(false); setEditing(null); }} />}
    </div>
  );
}

// ---- Gestor de tranches (projectos com orçamento fixo) ----
function TranchesManager({ project, tranches, tranchesCrud, invoicesCrud, clients, settings, online }) {
  const [editingTranches, setEditingTranches] = useState(false);
  const [draft, setDraft] = useState(tranches.length ? tranches.map(t => ({ ...t })) : [{ id: uid(), name: 'Sinal', percentage: 50 }, { id: uid(), name: 'Final', percentage: 50 }]);
  const [invoiceModalFor, setInvoiceModalFor] = useState(null);

  const totalPct = draft.reduce((s, t) => s + (Number(t.percentage) || 0), 0);
  const pctOk = Math.abs(totalPct - 100) < 0.01;

  const tiers = (pct) => {
    const net = (project.netEarned || 0) * (pct / 100);
    const irsRate = settings.irsRetention || 0;
    const ivaRate = settings.ivaRate || 0;
    const gross = irsRate > 0 ? net / (1 - irsRate / 100) : net;
    const grossWithIva = gross * (1 + ivaRate / 100);
    return { net, gross, grossWithIva };
  };

  const addRow = () => setDraft(d => [...d, { id: uid(), name: '', percentage: 0 }]);
  const removeRow = (id) => setDraft(d => d.filter(t => t.id !== id));
  const updateRow = (id, patch) => setDraft(d => d.map(t => t.id === id ? { ...t, ...patch } : t));

  const saveTranches = async () => {
    if (!pctOk) { alert('As percentagens têm de somar 100%.'); return; }
    // remove tranches antigas que já não existem no draft, grava as novas/alteradas
    const draftIds = new Set(draft.map(t => t.id));
    for (const old of tranches) { if (!draftIds.has(old.id)) await tranchesCrud.remove(old.id); }
    for (let i = 0; i < draft.length; i++) {
      const t = draft[i];
      const existing = tranches.find(x => x.id === t.id);
      const payload = { project_id: project.id, name: t.name, percentage: Number(t.percentage) || 0, sort_order: i };
      if (existing) await tranchesCrud.update(t.id, payload);
      else await tranchesCrud.insert({ id: t.id, invoiced: false, ...payload });
    }
    setEditingTranches(false);
  };

  if (editingTranches) {
    return (
      <div style={{ background: T.card, border: `1px solid ${T.rule}`, padding: 14 }}>
        <div className="label" style={{ marginBottom: 10 }}>Tranches de pagamento</div>
        <div style={{ display: 'grid', gap: 8 }}>
          {draft.map(t => (
            <div key={t.id} style={{ display: 'grid', gridTemplateColumns: '1fr 100px 32px', gap: 8, alignItems: 'center' }}>
              <input className="input" placeholder="Nome (ex: Sinal)" value={t.name} onChange={e => updateRow(t.id, { name: e.target.value })} />
              <input className="input mono" type="number" step="1" value={t.percentage === 0 ? '' : t.percentage} onChange={e => updateRow(t.id, { percentage: e.target.value === '' ? '' : parseFloat(e.target.value) })} onBlur={e => updateRow(t.id, { percentage: parseFloat(e.target.value) || 0 })} placeholder="%" />
              <button className="btn-icon" onClick={() => removeRow(t.id)}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
          <button className="btn-secondary" onClick={addRow} style={{ fontSize: 12 }}><Plus size={12} style={{ display: 'inline', marginRight: 4 }} />Adicionar tranche</button>
          <span className="mono" style={{ fontSize: 13, color: pctOk ? T.positive : T.alert, fontWeight: 600 }}>Total: {fmtNum(totalPct, 0)}%</span>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
          <button className="btn-secondary" onClick={() => { setDraft(tranches.length ? tranches.map(t => ({ ...t })) : [{ id: uid(), name: 'Sinal', percentage: 50 }, { id: uid(), name: 'Final', percentage: 50 }]); setEditingTranches(false); }}>Cancelar</button>
          <button className="btn-primary" onClick={saveTranches} disabled={!online}>Guardar tranches</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: T.card, border: `1px solid ${T.rule}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: `1px solid ${T.ruleSoft}` }}>
        <div className="label" style={{ margin: 0 }}>Tranches de pagamento</div>
        <button className="btn-icon" onClick={() => setEditingTranches(true)} disabled={!online}><Pencil size={13} /></button>
      </div>
      {tranches.length === 0 ? (
        <div style={{ padding: 14, fontSize: 13, color: T.inkSoft }}>Sem tranches definidas. <span style={{ textDecoration: 'underline', cursor: 'pointer' }} onClick={() => setEditingTranches(true)}>Configurar</span></div>
      ) : (
        <div>
          {tranches.map(t => {
            const v = tiers(t.percentage);
            return (
              <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: `1px solid ${T.ruleSoft}` }}>
                <div>
                  <div style={{ fontWeight: 500, fontSize: 13 }}>{t.name} <span className="mono" style={{ color: T.inkSoft, fontWeight: 400 }}>({fmtNum(t.percentage, 0)}%)</span></div>
                  <div className="mono" style={{ fontSize: 11, color: T.inkSoft, marginTop: 2 }}>líq. {fmtEUR(v.net)} · bruto {fmtEUR(v.gross)} · c/IVA {fmtEUR(v.grossWithIva)}</div>
                </div>
                {t.invoiced ? (
                  <span className="badge" style={{ background: T.positiveBg, color: T.positive, borderColor: T.positive }}>Facturada</span>
                ) : (
                  <button className="btn-secondary" style={{ fontSize: 12 }} onClick={() => setInvoiceModalFor(t)} disabled={!online}>Marcar facturada</button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {invoiceModalFor && (
        <InvoiceModal
          invoice={null}
          clients={clients}
          projects={[project]}
          settings={settings}
          prefill={{
            client_id: project.client_id,
            project_id: project.id,
            subtotal: tiers(invoiceModalFor.percentage).gross,
            iva_rate: settings.ivaRate,
            irs_retention: settings.irsRetention
          }}
          onSave={async (form) => {
            const ok = await invoicesCrud.insert({ id: uid(), ...form });
            if (ok !== false) {
              await tranchesCrud.update(invoiceModalFor.id, { invoiced: true });
              setInvoiceModalFor(null);
            }
          }}
          onClose={() => setInvoiceModalFor(null)}
        />
      )}
    </div>
  );
}

function ProjectModal({ project, clients, settings, onSave, onClose }) {
  const [f, setF] = useState(project
    ? { name: project.name || '', code: project.code || '', client_id: project.client_id || clients[0]?.id || '', phase: project.phase || PHASES[0], status: project.status || 'Activo', budget: project.budget || 0, hourly_rate: project.hourly_rate || settings.hourlyRate, billing_type: project.billing_type || 'hourly', fixed_net_amount: project.fixed_net_amount || 0, start_date: project.start_date || todayISO(), notes: project.notes || '' }
    : { name: '', code: '', client_id: clients[0]?.id || '', phase: PHASES[0], status: 'Activo', budget: 0, hourly_rate: settings.hourlyRate, billing_type: 'hourly', fixed_net_amount: 0, start_date: todayISO(), notes: '' });
  const isEditingExisting = !!project;
  return (
    <Modal title={project ? 'Editar projecto' : 'Novo projecto'} onClose={onClose}>
      <div style={{ display: 'grid', gap: 14 }}>
        <Field label="Nome"><input className="input" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} autoFocus /></Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <Field label="Código"><input className="input mono" placeholder="ex: 2026-001" value={f.code || ''} onChange={e => setF({ ...f, code: e.target.value })} /></Field>
          <Field label="Cliente"><select className="input" value={f.client_id} onChange={e => setF({ ...f, client_id: e.target.value })}><option value="">— sem cliente —</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <Field label="Fase"><select className="input" value={f.phase} onChange={e => setF({ ...f, phase: e.target.value })}>{PHASES.map(p => <option key={p} value={p}>{p}</option>)}</select></Field>
          <Field label="Estado"><select className="input" value={f.status} onChange={e => setF({ ...f, status: e.target.value })}>{PROJECT_STATUS.map(s => <option key={s} value={s}>{s}</option>)}</select></Field>
        </div>
        <Field label="Tipo de facturação">
          <select className="input" value={f.billing_type} onChange={e => setF({ ...f, billing_type: e.target.value })} disabled={isEditingExisting}>
            <option value="hourly">À hora</option>
            <option value="fixed">Orçamento fixo</option>
          </select>
          {isEditingExisting && <div style={{ fontSize: 11, color: T.inkSoft, marginTop: 4 }}>O tipo de facturação não pode ser alterado após a criação do projecto.</div>}
        </Field>
        {f.billing_type === 'hourly' ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label="Orçamento (€) — opcional, referência"><input className="input mono" type="number" step="0.01" value={f.budget === 0 ? '' : f.budget} onChange={e => setF({ ...f, budget: e.target.value === '' ? '' : parseFloat(e.target.value) })} onBlur={e => setF(x => ({ ...x, budget: parseFloat(e.target.value) || 0 }))} /></Field>
            <Field label="Taxa hora líquida desejada (€)"><input className="input mono" type="number" step="0.01" value={f.hourly_rate === 0 ? '' : f.hourly_rate} onChange={e => setF({ ...f, hourly_rate: e.target.value === '' ? '' : parseFloat(e.target.value) })} onBlur={e => setF(x => ({ ...x, hourly_rate: parseFloat(e.target.value) || 0 }))} /></Field>
          </div>
        ) : (
          <Field label="Valor líquido desejado total (€)">
            <input className="input mono" type="number" step="0.01" value={f.fixed_net_amount === 0 ? '' : f.fixed_net_amount} onChange={e => setF({ ...f, fixed_net_amount: e.target.value === '' ? '' : parseFloat(e.target.value) })} onBlur={e => setF(x => ({ ...x, fixed_net_amount: parseFloat(e.target.value) || 0 }))} />
          </Field>
        )}
        <Field label="Data de início"><input className="input mono" type="date" value={f.start_date || ''} onChange={e => setF({ ...f, start_date: e.target.value })} /></Field>
        <Field label="Notas"><textarea className="input" rows={3} value={f.notes || ''} onChange={e => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
      <ModalFooter onCancel={onClose} onSave={() => f.name && onSave(f)} />
    </Modal>
  );
}

// ============================================================
// HOURS
// ============================================================
function HoursView({ crud, hours, projects, settings, online }) {
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [fProject, setFProject] = useState('all');
  const [fMonth, setFMonth] = useState('all');
  const [fBilled, setFBilled] = useState('all');

  const months = useMemo(() => {
    const set = new Set();
    hours.forEach(h => { const d = new Date(h.date); set.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); });
    return [...set].sort().reverse();
  }, [hours]);

  const rows = useMemo(() => {
    let r = [...hours];
    if (fProject !== 'all') r = r.filter(h => h.project_id === fProject);
    if (fMonth !== 'all') { const [y, m] = fMonth.split('-'); r = r.filter(h => { const d = new Date(h.date); return d.getFullYear() === +y && d.getMonth() === +m - 1; }); }
    if (fBilled === 'billed') r = r.filter(h => h.billed);
    if (fBilled === 'unbilled') r = r.filter(h => !h.billed);
    return r.sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [hours, fProject, fMonth, fBilled]);

  const totals = useMemo(() => {
    const totalHours = rows.reduce((s, h) => s + (h.hours || 0), 0);
    const netValue = rows.reduce((s, h) => s + (h.hours * (h.rate || 0)), 0);
    const irsRate = settings.irsRetention || 0;
    const ivaRate = settings.ivaRate || 0;
    const grossValue = irsRate > 0 ? netValue / (1 - irsRate / 100) : netValue;
    const grossWithIva = grossValue * (1 + ivaRate / 100);
    return { hours: totalHours, net: netValue, gross: grossValue, grossWithIva };
  }, [rows, settings.irsRetention, settings.ivaRate]);

  const save = async (form) => {
    const ok = editing ? await crud.update(editing.id, form) : await crud.insert({ id: uid(), billed: false, ...form });
    if (ok !== false) { setModal(false); setEditing(null); }
  };
  const remove = (id) => { if (confirm('Eliminar registo?')) crud.remove(id); };

  return (
    <div>
      <Toolbar>
        <select className="input" style={{ width: 'auto', minWidth: 160 }} value={fProject} onChange={e => setFProject(e.target.value)}><option value="all">Todos os projectos</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <select className="input" style={{ width: 'auto' }} value={fMonth} onChange={e => setFMonth(e.target.value)}><option value="all">Todos os meses</option>{months.map(m => { const [y, mo] = m.split('-'); return <option key={m} value={m}>{new Date(+y, +mo - 1).toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' })}</option>; })}</select>
        <select className="input" style={{ width: 'auto' }} value={fBilled} onChange={e => setFBilled(e.target.value)}><option value="all">Todos</option><option value="unbilled">Por facturar</option><option value="billed">Facturados</option></select>
        <button className="btn-primary" onClick={() => { setEditing(null); setModal(true); }} disabled={!online}><Plus size={14} style={{ display: 'inline', marginRight: 6, verticalAlign: '-2px' }} />Novo registo</button>
      </Toolbar>
      <div style={{ background: T.card, border: `1px solid ${T.rule}`, borderBottom: 'none', padding: '14px 20px', display: 'flex', gap: 32, flexWrap: 'wrap' }}>
        <div><div className="label">Total horas</div><div className="mono" style={{ fontSize: 20, fontWeight: 600 }}>{fmtNum(totals.hours, 1)}h</div></div>
        <div><div className="label">Líquido (s/ IRS)</div><div className="mono" style={{ fontSize: 20, fontWeight: 600 }}>{fmtEUR(totals.net)}</div></div>
        <div><div className="label">Bruto (c/ IRS)</div><div className="mono" style={{ fontSize: 20, fontWeight: 600, color: T.inkSoft }}>{fmtEUR(totals.gross)}</div></div>
        <div><div className="label">Bruto c/ IRS e IVA</div><div className="mono" style={{ fontSize: 20, fontWeight: 600, color: T.inkSoft }}>{fmtEUR(totals.grossWithIva)}</div></div>
      </div>
      <div style={{ background: T.card, border: `1px solid ${T.rule}` }}>
        {rows.length === 0 ? <div className="empty"><div className="empty-title">Sem registos</div><div className="empty-sub">Use o cronómetro ou "Novo registo"</div></div> : (
          <div className="table-wrap">
          <table>
            <thead><tr><th>Data</th><th>Projecto</th><th>Descrição</th><th style={{ textAlign: 'right' }}>Horas</th><th style={{ textAlign: 'right' }}>Taxa (líq.)</th><th style={{ textAlign: 'right' }}>Valor (líq.)</th><th style={{ textAlign: 'right' }}>IVA</th><th>Estado</th><th style={{ width: 80 }}></th></tr></thead>
            <tbody>
              {rows.map(h => {
                const p = projects.find(pr => pr.id === h.project_id);
                return (
                  <tr key={h.id}>
                    <td className="mono">{fmtDateShort(h.date)}</td>
                    <td>{p?.name || <span style={{ color: T.inkMuted }}>—</span>}</td>
                    <td style={{ fontSize: 12, color: T.inkSoft }}>{h.description || '—'}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{fmtNum(h.hours, 2)}h</td>
                    <td className="mono" style={{ textAlign: 'right', color: T.inkSoft }}>{fmtEUR(h.rate)}</td>
                    <td className="mono" style={{ textAlign: 'right', fontWeight: 500 }}>{fmtEUR(h.hours * (h.rate || 0))}</td>
                    <td className="mono" style={{ textAlign: 'right', color: T.inkSoft, fontSize: 12 }}>{h.iva_rate || 0}%</td>
                    <td>{h.billed ? <span className="badge" style={{ background: T.positiveBg, color: T.positive, borderColor: T.positive }}>Facturado</span> : <span className="badge" style={{ background: T.cardSoft, color: T.inkSoft, borderColor: T.rule }}>Por facturar</span>}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn-icon" onClick={() => { setEditing(h); setModal(true); }} disabled={!online}><Pencil size={14} /></button>
                      <button className="btn-icon" onClick={() => remove(h.id)} disabled={!online}><Trash2 size={14} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
      </div>
      {modal && <HoursModal entry={editing} projects={projects} settings={settings} onSave={save} onClose={() => { setModal(false); setEditing(null); }} />}
    </div>
  );
}

function HoursModal({ entry, projects, settings, onSave, onClose }) {
  const [f, setF] = useState(entry || { date: todayISO(), project_id: projects.find(p => p.status === 'Activo')?.id || projects[0]?.id || '', description: '', hours: 1, rate: settings.hourlyRate, iva_rate: settings.ivaRate, billed: false });
  useEffect(() => {
    if (entry) return; // não aplicar em edição de registo existente
    const p = projects.find(pr => pr.id === f.project_id);
    setF(x => ({ ...x, rate: p?.hourly_rate || settings.hourlyRate }));
  }, [f.project_id]);
  return (
    <Modal title={entry ? 'Editar registo' : 'Novo registo de horas'} onClose={onClose}>
      <div style={{ display: 'grid', gap: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 14 }}>
          <Field label="Data"><input className="input mono" type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Projecto"><select className="input" value={f.project_id} onChange={e => setF({ ...f, project_id: e.target.value })}><option value="">— escolher —</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        </div>
        <Field label="Descrição da tarefa"><input className="input" value={f.description} onChange={e => setF({ ...f, description: e.target.value })} placeholder="ex: desenho técnico do piso 1" /></Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
          <Field label="Horas"><input className="input mono" type="number" step="0.25" value={f.hours} onChange={e => setF({ ...f, hours: e.target.value === '' ? '' : parseFloat(e.target.value) })} onBlur={e => setF(x => ({ ...x, hours: parseFloat(e.target.value) || 0 }))} /></Field>
          <Field label="Taxa líquida (€/h)"><input className="input mono" type="number" step="0.01" value={f.rate} onChange={e => setF({ ...f, rate: e.target.value === '' ? '' : parseFloat(e.target.value) })} onBlur={e => setF(x => ({ ...x, rate: parseFloat(e.target.value) || 0 }))} /></Field>
          <Field label="IVA (%)"><input className="input mono" type="number" step="1" value={f.iva_rate} onChange={e => setF({ ...f, iva_rate: e.target.value === '' ? '' : parseFloat(e.target.value) })} onBlur={e => setF(x => ({ ...x, iva_rate: parseFloat(e.target.value) || 0 }))} /></Field>
        </div>
        <div style={{ padding: '12px 14px', background: T.cardSoft, border: `1px solid ${T.ruleSoft}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span style={{ color: T.inkSoft }}>Líquido (s/ IRS)</span><span className="mono">{fmtEUR(f.hours * f.rate)}</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginTop: 4 }}><span style={{ color: T.inkSoft }}>Bruto p/ factura (c/ IRS)</span><span className="mono">{fmtEUR(settings.irsRetention > 0 ? (f.hours * f.rate) / (1 - settings.irsRetention / 100) : f.hours * f.rate)}</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 600, marginTop: 8, paddingTop: 8, borderTop: `1px solid ${T.rule}` }}><span>Bruto c/ IRS e IVA ({f.iva_rate}%)</span><span className="mono">{fmtEUR((settings.irsRetention > 0 ? (f.hours * f.rate) / (1 - settings.irsRetention / 100) : f.hours * f.rate) * (1 + f.iva_rate / 100))}</span></div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}><input type="checkbox" checked={f.billed} onChange={e => setF({ ...f, billed: e.target.checked })} />Já facturado</label>
      </div>
      <ModalFooter onCancel={onClose} onSave={() => f.hours > 0 && onSave(f)} />
    </Modal>
  );
}

// ============================================================
// INVOICES
// ============================================================
function InvoicesView({ crud, invoices, clients, projects, settings, online }) {
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [filter, setFilter] = useState('all');

  // Auto-flag vencidas
  useEffect(() => {
    invoices.forEach(inv => {
      if (inv.status === 'Emitida' && new Date(inv.due_date) < new Date()) {
        crud.update(inv.id, { status: 'Vencida' });
      }
    });
  }, [invoices]);

  const rows = useMemo(() => {
    let r = [...invoices];
    if (filter !== 'all') r = r.filter(i => i.status === filter);
    return r.sort((a, b) => new Date(b.emission_date) - new Date(a.emission_date));
  }, [invoices, filter]);

  const totals = useMemo(() => ({
    total: rows.reduce((s, i) => s + (i.total_amount || 0), 0),
    open: rows.filter(i => i.status !== 'Paga').reduce((s, i) => s + (i.total_amount || 0), 0),
    overdue: rows.filter(i => i.status === 'Vencida').reduce((s, i) => s + (i.total_amount || 0), 0),
  }), [rows]);

  const save = async (form) => {
    const ok = editing ? await crud.update(editing.id, form) : await crud.insert({ id: uid(), ...form });
    if (ok !== false) { setModal(false); setEditing(null); }
  };
  const remove = (id) => { if (confirm('Eliminar factura?')) crud.remove(id); };

  const statusColor = (s) => s === 'Paga' ? { bg: T.positiveBg, color: T.positive, border: T.positive } : s === 'Vencida' ? { bg: T.alertBg, color: T.alert, border: T.alert } : { bg: T.accentBg, color: T.accent, border: T.accent };

  return (
    <div>
      <Toolbar>
        <select className="input" style={{ width: 'auto' }} value={filter} onChange={e => setFilter(e.target.value)}>
          <option value="all">Todas</option>
          {INVOICE_STATUS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <button className="btn-primary" onClick={() => { setEditing(null); setModal(true); }} disabled={!online}>
          <Plus size={14} style={{ display: 'inline', marginRight: 6, verticalAlign: '-2px' }} />Nova factura
        </button>
      </Toolbar>
      <div style={{ background: T.card, border: `1px solid ${T.rule}`, borderBottom: 'none', padding: '14px 20px', display: 'flex', gap: 32 }}>
        <div><div className="label">Total período</div><div className="mono" style={{ fontSize: 20, fontWeight: 600 }}>{fmtEUR(totals.total)}</div></div>
        <div><div className="label">Por receber</div><div className="mono" style={{ fontSize: 20, fontWeight: 600, color: totals.open > 0 ? T.accent : T.inkSoft }}>{fmtEUR(totals.open)}</div></div>
        {totals.overdue > 0 && <div><div className="label">Vencido</div><div className="mono" style={{ fontSize: 20, fontWeight: 600, color: T.alert }}>{fmtEUR(totals.overdue)}</div></div>}
      </div>
      <div style={{ background: T.card, border: `1px solid ${T.rule}` }}>
        {rows.length === 0 ? <div className="empty"><div className="empty-title">Sem facturas</div></div> : (
          <div className="table-wrap">
          <table>
            <thead><tr><th>Nº</th><th>Cliente</th><th>Projecto</th><th>Emissão</th><th>Vencimento</th><th style={{ textAlign: 'right' }}>Subtotal</th><th style={{ textAlign: 'right' }}>IVA</th><th style={{ textAlign: 'right' }}>Retenção</th><th style={{ textAlign: 'right' }}>A receber</th><th>Estado</th><th style={{ width: 80 }}></th></tr></thead>
            <tbody>
              {rows.map(inv => {
                const sc = statusColor(inv.status);
                const d = daysUntil(inv.due_date);
                return (
                  <tr key={inv.id}>
                    <td className="mono" style={{ fontWeight: 500 }}>{inv.invoice_number || '—'}</td>
                    <td>{clients.find(c => c.id === inv.client_id)?.name || '—'}</td>
                    <td style={{ fontSize: 12, color: T.inkSoft }}>{projects.find(p => p.id === inv.project_id)?.name || '—'}</td>
                    <td className="mono">{fmtDate(inv.emission_date)}</td>
                    <td className="mono" style={{ color: inv.status === 'Vencida' ? T.alert : T.ink }}>
                      {fmtDate(inv.due_date)}
                      {inv.status === 'Emitida' && d >= 0 && d <= 7 && <div style={{ fontSize: 10, color: T.alert }}>em {d}d</div>}
                    </td>
                    <td className="mono" style={{ textAlign: 'right' }}>{fmtEUR(inv.subtotal)}</td>
                    <td className="mono" style={{ textAlign: 'right', color: T.inkSoft }}>{fmtEUR(inv.iva_amount)}</td>
                    <td className="mono" style={{ textAlign: 'right', color: T.inkSoft }}>−{fmtEUR(inv.irs_amount)}</td>
                    <td className="mono" style={{ textAlign: 'right', fontWeight: 600 }}>{fmtEUR(inv.total_amount)}</td>
                    <td>
                      <span className="badge" style={{ background: sc.bg, color: sc.color, borderColor: sc.border }}>{inv.status}</span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn-icon" onClick={() => { setEditing(inv); setModal(true); }} disabled={!online}><Pencil size={14} /></button>
                      <button className="btn-icon" onClick={() => remove(inv.id)} disabled={!online}><Trash2 size={14} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
      </div>
      {modal && <InvoiceModal invoice={editing} clients={clients} projects={projects} settings={settings} onSave={save} onClose={() => { setModal(false); setEditing(null); }} />}
    </div>
  );
}

function InvoiceModal({ invoice, clients, projects, settings, prefill, onSave, onClose }) {
  const today = todayISO();
  const [f, setF] = useState(invoice || (prefill ? (() => {
    const sub = Number(prefill.subtotal) || 0;
    const ivaR = Number(prefill.iva_rate) || 0;
    const irsR = Number(prefill.irs_retention) || 0;
    const iva_amount = (sub * ivaR) / 100;
    const irs_amount = (sub * irsR) / 100;
    return {
      invoice_number: '', emission_date: today,
      due_date: addDays(today, settings.paymentDueDays || 30),
      client_id: prefill.client_id || '', project_id: prefill.project_id || '', subtotal: sub,
      iva_rate: ivaR, iva_amount,
      irs_retention: irsR, irs_amount,
      total_amount: sub + iva_amount - irs_amount, status: 'Emitida', notes: ''
    };
  })() : {
    invoice_number: '', emission_date: today,
    due_date: addDays(today, settings.paymentDueDays || 30),
    client_id: '', project_id: '', subtotal: 0,
    iva_rate: settings.ivaRate, iva_amount: 0,
    irs_retention: settings.irsRetention, irs_amount: 0,
    total_amount: 0, status: 'Emitida', notes: ''
  }));

  const recalc = (patch) => {
    const next = { ...f, ...patch };
    const sub = Number(next.subtotal) || 0;
    const ivaR = Number(next.iva_rate) || 0;
    const irsR = Number(next.irs_retention) || 0;
    next.iva_amount = (sub * ivaR) / 100;
    next.irs_amount = (sub * irsR) / 100;
    next.total_amount = sub + next.iva_amount - next.irs_amount;
    setF(next);
  };

  return (
    <Modal title={invoice ? 'Editar factura' : 'Nova factura'} onClose={onClose} wide>
      <div style={{ display: 'grid', gap: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
          <Field label="Nº factura"><input className="input mono" value={f.invoice_number} onChange={e => setF({ ...f, invoice_number: e.target.value })} placeholder="ex: 2026/001" /></Field>
          <Field label="Data emissão"><input className="input mono" type="date" value={f.emission_date} onChange={e => setF({ ...f, emission_date: e.target.value })} /></Field>
          <Field label="Data vencimento"><input className="input mono" type="date" value={f.due_date} onChange={e => setF({ ...f, due_date: e.target.value })} /></Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <Field label="Cliente"><select className="input" value={f.client_id} onChange={e => setF({ ...f, client_id: e.target.value })}><option value="">— escolher —</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <Field label="Projecto"><select className="input" value={f.project_id} onChange={e => setF({ ...f, project_id: e.target.value })}><option value="">— escolher —</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
          <Field label="Subtotal (€)"><input className="input mono" type="number" step="0.01" value={f.subtotal} onChange={e => recalc({ subtotal: e.target.value === '' ? '' : parseFloat(e.target.value) })} onBlur={e => recalc({ subtotal: parseFloat(e.target.value) || 0 })} autoFocus /></Field>
          <Field label="IVA (%)"><input className="input mono" type="number" step="1" value={f.iva_rate} onChange={e => recalc({ iva_rate: e.target.value === '' ? '' : parseFloat(e.target.value) })} onBlur={e => recalc({ iva_rate: parseFloat(e.target.value) || 0 })} /></Field>
          <Field label="Retenção IRS (%)"><input className="input mono" type="number" step="1" value={f.irs_retention} onChange={e => recalc({ irs_retention: e.target.value === '' ? '' : parseFloat(e.target.value) })} onBlur={e => recalc({ irs_retention: parseFloat(e.target.value) || 0 })} /></Field>
        </div>
        <div style={{ padding: '14px', background: T.cardSoft, border: `1px solid ${T.ruleSoft}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}><span style={{ color: T.inkSoft }}>Subtotal</span><span className="mono">{fmtEUR(f.subtotal)}</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}><span style={{ color: T.inkSoft }}>IVA ({f.iva_rate}%)</span><span className="mono">+ {fmtEUR(f.iva_amount)}</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}><span style={{ color: T.inkSoft }}>Retenção IRS ({f.irs_retention}%)</span><span className="mono">− {fmtEUR(f.irs_amount)}</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 16, fontWeight: 700, paddingTop: 8, borderTop: `1px solid ${T.rule}` }}><span>A receber</span><span className="mono">{fmtEUR(f.total_amount)}</span></div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <Field label="Estado"><select className="input" value={f.status} onChange={e => setF({ ...f, status: e.target.value })}>{INVOICE_STATUS.map(s => <option key={s} value={s}>{s}</option>)}</select></Field>
          <Field label="Notas"><input className="input" value={f.notes || ''} onChange={e => setF({ ...f, notes: e.target.value })} /></Field>
        </div>
      </div>
      <ModalFooter onCancel={onClose} onSave={() => f.subtotal >= 0 && onSave(f)} />
    </Modal>
  );
}

// ============================================================
// FISCAL OBLIGATIONS
// ============================================================
function FiscalView({ crud, obligations, online }) {
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [showDone, setShowDone] = useState(false);

  const rows = useMemo(() => {
    let r = [...obligations];
    if (!showDone) r = r.filter(o => !o.done);
    return r.sort((a, b) => new Date(a.due_date) - new Date(b.due_date));
  }, [obligations, showDone]);

  const save = async (form) => {
    const ok = editing ? await crud.update(editing.id, form) : await crud.insert({ id: uid(), done: false, ...form });
    if (ok !== false) { setModal(false); setEditing(null); }
  };

  const markDone = async (o) => {
    await crud.update(o.id, { done: true });
    // criar próxima ocorrência automática
    let nextDate = null;
    if (o.recurrence === 'monthly') nextDate = addMonths(o.due_date, 1);
    else if (o.recurrence === 'quarterly') nextDate = addMonths(o.due_date, 3);
    else if (o.recurrence === 'annual') nextDate = addMonths(o.due_date, 12);
    if (nextDate) {
      await crud.insert({ id: uid(), label: o.label, due_date: nextDate, amount: o.amount, recurrence: o.recurrence, reference: o.reference, done: false });
    }
  };

  const remove = (id) => { if (confirm('Eliminar obrigação?')) crud.remove(id); };

  return (
    <div>
      <Toolbar>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: T.inkSoft, cursor: 'pointer' }}>
          <input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} />
          Mostrar concluídas
        </label>
        <button className="btn-primary" onClick={() => { setEditing(null); setModal(true); }} disabled={!online}>
          <Plus size={14} style={{ display: 'inline', marginRight: 6, verticalAlign: '-2px' }} />Nova obrigação
        </button>
      </Toolbar>
      <div style={{ background: T.card, border: `1px solid ${T.rule}` }}>
        {rows.length === 0 ? (
          <div className="empty">
            <div className="empty-title">{showDone ? 'Sem obrigações' : 'Sem obrigações pendentes'}</div>
            <div className="empty-sub">Adicione prazos fiscais para os acompanhar aqui e na Agenda</div>
          </div>
        ) : (
          <div className="table-wrap">
          <table>
            <thead><tr><th>Obrigação</th><th>Prazo</th><th>Dias</th><th style={{ textAlign: 'right' }}>Valor estimado</th><th>Periodicidade</th><th>Referência</th><th>Estado</th><th style={{ width: 100 }}></th></tr></thead>
            <tbody>
              {rows.map(o => {
                const d = daysUntil(o.due_date);
                const over = d < 0, soon = d >= 0 && d <= 7;
                return (
                  <tr key={o.id} style={{ opacity: o.done ? 0.5 : 1 }}>
                    <td style={{ fontWeight: 500 }}>{o.label}</td>
                    <td className="mono">{fmtDate(o.due_date)}</td>
                    <td className="mono" style={{ fontWeight: 600, color: o.done ? T.inkMuted : over ? T.alert : soon ? T.alert : T.inkSoft }}>
                      {o.done ? '—' : over ? `${Math.abs(d)}d atraso` : d === 0 ? 'hoje' : `${d}d`}
                    </td>
                    <td className="mono" style={{ textAlign: 'right' }}>{o.amount > 0 ? fmtEUR(o.amount) : '—'}</td>
                    <td style={{ fontSize: 12, color: T.inkSoft }}>
                      {{ monthly: 'Mensal', quarterly: 'Trimestral', annual: 'Anual', custom: 'Única' }[o.recurrence] || '—'}
                    </td>
                    <td style={{ fontSize: 12, color: T.inkSoft }}>{o.reference || '—'}</td>
                    <td>
                      {o.done
                        ? <span className="badge" style={{ background: T.positiveBg, color: T.positive, borderColor: T.positive }}>Concluída</span>
                        : <span className="badge" style={{ background: T.cardSoft, color: T.inkSoft, borderColor: T.rule }}>Pendente</span>
                      }
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {!o.done && <button className="btn-icon" title="Marcar concluída" onClick={() => markDone(o)} disabled={!online}><Check size={14} /></button>}
                      <button className="btn-icon" onClick={() => { setEditing(o); setModal(true); }} disabled={!online}><Pencil size={14} /></button>
                      <button className="btn-icon" onClick={() => remove(o.id)} disabled={!online}><Trash2 size={14} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
      </div>
      {modal && <ObligationModal obligation={editing} onSave={save} onClose={() => { setModal(false); setEditing(null); }} />}
    </div>
  );
}

function ObligationModal({ obligation, onSave, onClose }) {
  const [f, setF] = useState(obligation || { label: '', due_date: todayISO(), amount: 0, recurrence: 'quarterly', reference: '', done: false });
  const preset = OBLIGATION_PRESETS.find(p => p.label === f.label);
  return (
    <Modal title={obligation ? 'Editar obrigação' : 'Nova obrigação fiscal'} onClose={onClose}>
      <div style={{ display: 'grid', gap: 14 }}>
        <Field label="Tipo de obrigação">
          <select className="input" value={f.label} onChange={e => { const p = OBLIGATION_PRESETS.find(x => x.label === e.target.value); setF({ ...f, label: e.target.value, recurrence: p?.recurrence || f.recurrence }); }}>
            <option value="">— escolher —</option>
            {OBLIGATION_PRESETS.map(p => <option key={p.id} value={p.label}>{p.label}</option>)}
          </select>
        </Field>
        {f.label === 'Outro' && <Field label="Descrição"><input className="input" value={f.reference || ''} onChange={e => setF({ ...f, reference: e.target.value })} placeholder="Descreva a obrigação" /></Field>}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <Field label="Data limite"><input className="input mono" type="date" value={f.due_date} onChange={e => setF({ ...f, due_date: e.target.value })} /></Field>
          <Field label="Valor estimado (€)"><input className="input mono" type="number" step="0.01" value={f.amount === 0 ? '' : f.amount} onChange={e => setF({ ...f, amount: e.target.value === '' ? '' : parseFloat(e.target.value) })} onBlur={e => setF(x => ({ ...x, amount: parseFloat(e.target.value) || 0 }))} placeholder="opcional" /></Field>
        </div>
        <Field label="Periodicidade">
          <select className="input" value={f.recurrence} onChange={e => setF({ ...f, recurrence: e.target.value })}>
            <option value="monthly">Mensal</option>
            <option value="quarterly">Trimestral</option>
            <option value="annual">Anual</option>
            <option value="custom">Única (não repete)</option>
          </select>
        </Field>
        <div style={{ fontSize: 12, color: T.inkSoft, padding: 12, background: T.cardSoft, border: `1px solid ${T.ruleSoft}` }}>
          Ao marcar como concluída, {f.recurrence !== 'custom' ? 'a próxima ocorrência é criada automaticamente.' : 'a obrigação fica arquivada.'}
        </div>
      </div>
      <ModalFooter onCancel={onClose} onSave={() => f.label && f.due_date && onSave(f)} />
    </Modal>
  );
}

// ============================================================
// AGENDA
// ============================================================
function AgendaView({ crud, obligations, invoices, projects, clients, events, online }) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedDay, setSelectedDay] = useState(null);
  const [modal, setModal] = useState(false);
  const [filter, setFilter] = useState({ fiscal: true, invoices: true, projects: true, events: true });

  const prevMonth = () => { if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1); };

  // Agregar todos os eventos do mês
  const allItems = useMemo(() => {
    const items = [];
    if (filter.fiscal) obligations.filter(o => !o.done).forEach(o => items.push({ id: o.id, date: o.due_date, label: o.label, type: 'fiscal', color: T.alert }));
    if (filter.invoices) invoices.filter(i => i.status !== 'Paga').forEach(i => items.push({ id: i.id, date: i.due_date, label: `Factura ${i.invoice_number || ''} — ${clients.find(c => c.id === i.client_id)?.name || ''}`, type: 'invoice', color: T.accent }));
    if (filter.projects) projects.filter(p => p.start_date).forEach(p => items.push({ id: p.id, date: p.start_date, label: p.name, type: 'project', color: T.positive }));
    if (filter.events) events.forEach(e => items.push({ id: e.id, date: e.date, label: e.title, type: 'event', color: EVENT_TYPES.find(t => t.id === e.type)?.color || T.inkSoft, eventObj: e }));
    return items;
  }, [obligations, invoices, projects, events, clients, filter]);

  const byDate = useMemo(() => {
    const map = {};
    allItems.forEach(item => { if (!map[item.date]) map[item.date] = []; map[item.date].push(item); });
    return map;
  }, [allItems]);

  // Construir grelha do mês
  const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const gridStart = (firstDay === 0 ? 6 : firstDay - 1); // ajustar para Seg=0
  const cells = [];
  for (let i = 0; i < gridStart; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const dayItems = selectedDay ? (byDate[`${year}-${String(month + 1).padStart(2, '0')}-${String(selectedDay).padStart(2, '0')}`] || []) : [];

  const saveEvent = async (form) => {
    const ok = await crud.insert({ id: uid(), ...form });
    if (ok !== false) setModal(false);
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 24, alignItems: 'start' }}>
      <div>
        {/* Header navegação */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, background: T.card, border: `1px solid ${T.rule}`, padding: '12px 20px' }}>
          <button className="btn-icon" onClick={prevMonth}><ChevronLeft size={18} /></button>
          <div style={{ fontWeight: 600, fontSize: 16 }}>{MONTH_NAMES[month]} {year}</div>
          <button className="btn-icon" onClick={nextMonth}><ChevronRight size={18} /></button>
        </div>

        {/* Filtros */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          {[['fiscal', T.alert, 'Fiscais'], ['invoices', T.accent, 'Facturas'], ['projects', T.positive, 'Projectos'], ['events', T.inkSoft, 'Eventos']].map(([key, color, label]) => (
            <button key={key} onClick={() => setFilter(f => ({ ...f, [key]: !f[key] }))}
              style={{ padding: '4px 12px', fontSize: 12, fontWeight: 500, border: `1px solid ${filter[key] ? color : T.rule}`, background: filter[key] ? color + '22' : T.card, color: filter[key] ? color : T.inkMuted, cursor: 'pointer' }}>
              {label}
            </button>
          ))}
        </div>

        {/* Grelha */}
        <div style={{ background: T.card, border: `1px solid ${T.rule}` }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: `1px solid ${T.rule}` }}>
            {WEEKDAY_NAMES.map(d => <div key={d} style={{ padding: '8px 4px', textAlign: 'center', fontSize: 11, fontWeight: 600, color: T.inkSoft, letterSpacing: '0.06em' }}>{d}</div>)}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
            {cells.map((day, i) => {
              if (!day) return <div key={`e${i}`} style={{ borderRight: `1px solid ${T.ruleSoft}`, borderBottom: `1px solid ${T.ruleSoft}`, minHeight: 80 }} />;
              const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const items = byDate[iso] || [];
              const isToday = year === today.getFullYear() && month === today.getMonth() && day === today.getDate();
              const isSelected = day === selectedDay;
              return (
                <div key={day} onClick={() => setSelectedDay(day === selectedDay ? null : day)}
                  style={{ borderRight: `1px solid ${T.ruleSoft}`, borderBottom: `1px solid ${T.ruleSoft}`, minHeight: 80, padding: 6, cursor: 'pointer', background: isSelected ? T.accentBg : 'transparent', transition: 'background 0.1s' }}>
                  <div style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', background: isToday ? T.ink : 'transparent', color: isToday ? T.card : T.ink, fontSize: 13, fontWeight: isToday ? 700 : 400, marginBottom: 4 }}>{day}</div>
                  {items.slice(0, 3).map((item, idx) => (
                    <div key={idx} style={{ fontSize: 10, padding: '2px 4px', marginBottom: 2, background: item.color + '22', color: item.color, borderLeft: `2px solid ${item.color}`, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{item.label}</div>
                  ))}
                  {items.length > 3 && <div style={{ fontSize: 10, color: T.inkMuted }}>+{items.length - 3}</div>}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Painel lateral */}
      <div style={{ position: 'sticky', top: 24 }}>
        <div style={{ background: T.card, border: `1px solid ${T.rule}` }}>
          <div style={{ padding: '14px 16px', borderBottom: `1px solid ${T.rule}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>
              {selectedDay ? `${selectedDay} de ${MONTH_NAMES[month]}` : 'Seleccione um dia'}
            </div>
            {selectedDay && <button className="btn-primary" style={{ padding: '5px 10px', fontSize: 12 }} onClick={() => setModal(true)} disabled={!online}><Plus size={12} style={{ display: 'inline', marginRight: 4 }} />Evento</button>}
          </div>
          <div style={{ padding: '8px 0', minHeight: 200 }}>
            {!selectedDay && <div className="empty"><div className="empty-sub">Clique num dia para ver os eventos</div></div>}
            {selectedDay && dayItems.length === 0 && <div className="empty"><div className="empty-sub">Sem eventos neste dia</div></div>}
            {dayItems.map((item, i) => (
              <div key={i} style={{ padding: '10px 16px', borderBottom: `1px solid ${T.ruleSoft}`, borderLeft: `3px solid ${item.color}`, marginLeft: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: item.color, marginBottom: 2 }}>
                  {{ fiscal: 'Fiscal', invoice: 'Factura', project: 'Projecto', event: 'Evento' }[item.type]}
                </div>
                <div style={{ fontSize: 13, color: T.ink }}>{item.label}</div>
                {item.eventObj?.notes && <div style={{ fontSize: 11, color: T.inkSoft, marginTop: 4 }}>{item.eventObj.notes}</div>}
                {item.type === 'event' && item.eventObj && (
                  <button className="btn-icon" style={{ marginTop: 4, color: T.alert }} onClick={() => crud.remove(item.eventObj.id)} disabled={!online}><Trash2 size={12} /></button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {modal && selectedDay && (
        <EventModal
          defaultDate={`${year}-${String(month + 1).padStart(2, '0')}-${String(selectedDay).padStart(2, '0')}`}
          projects={projects} onSave={saveEvent} onClose={() => setModal(false)}
        />
      )}
    </div>
  );
}

function EventModal({ defaultDate, projects, onSave, onClose }) {
  const [f, setF] = useState({ title: '', type: 'reuniao', date: defaultDate, time: '', project_id: '', notes: '' });
  return (
    <Modal title="Novo evento" onClose={onClose}>
      <div style={{ display: 'grid', gap: 14 }}>
        <Field label="Título"><input className="input" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} autoFocus /></Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <Field label="Tipo"><select className="input" value={f.type} onChange={e => setF({ ...f, type: e.target.value })}>{EVENT_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</select></Field>
          <Field label="Projecto"><select className="input" value={f.project_id} onChange={e => setF({ ...f, project_id: e.target.value })}><option value="">— sem projecto —</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <Field label="Data"><input className="input mono" type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Hora (opcional)"><input className="input mono" type="time" value={f.time} onChange={e => setF({ ...f, time: e.target.value })} /></Field>
        </div>
        <Field label="Notas"><textarea className="input" rows={2} value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
      <ModalFooter onCancel={onClose} onSave={() => f.title && f.date && onSave(f)} />
    </Modal>
  );
}

// ============================================================
// SETTINGS
// ============================================================
function SettingsView({ settings, setSettings, data, user, online, supabaseClient, onRefresh }) {
  const [f, setF] = useState(settings);
  const [saved, setSaved] = useState(false);
  const [importing, setImporting] = useState(false);

  const saveSettings = async () => {
    if (!online) { alert('Está offline.'); return; }
    const record = {
      id: user.id, user_id: user.id,
      name: f.name, nif: f.nif,
      hourly_rate: f.hourlyRate, iva_rate: f.ivaRate,
      irs_retention: f.irsRetention, payment_due_days: f.paymentDueDays
    };
    const { error } = await supabaseClient.from('settings').upsert([record]);
    if (error) { alert('Erro ao guardar: ' + error.message); return; }
    setSettings(f);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const exportBackup = () => {
    const blob = new Blob([JSON.stringify({ ...data, settings, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `atelier-backup-${todayISO()}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  const importBackup = (e) => {
    const file = e.target.files[0]; if (!file) return;
    if (!online) { alert('Está offline. Importe com ligação activa.'); return; }
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const backup = JSON.parse(ev.target.result);
        if (!confirm(`Importar ${backup.clients?.length || 0} clientes, ${backup.projects?.length || 0} projectos, ${backup.hours?.length || 0} horas?\n\nAtenção: isto vai SUBSTITUIR todos os dados actuais.`)) return;
        setImporting(true);
        const tables = [['clients', backup.clients], ['projects', backup.projects], ['hours', backup.hours], ['invoices', backup.invoices], ['obligations', backup.obligations], ['events', backup.events]];
        for (const [table, rows] of tables) {
          if (!rows?.length) continue;
          await supabaseClient.from(table).delete().eq('user_id', user.id);
          const withUserId = rows.map(r => ({ ...r, user_id: user.id }));
          await supabaseClient.from(table).insert(withUserId);
        }
        await onRefresh();
        setImporting(false);
        alert('Importação concluída!');
      } catch (err) { setImporting(false); alert('Erro ao importar: ' + err.message); }
    };
    reader.readAsText(file);
  };

  return (
    <div style={{ maxWidth: 640 }}>
      <section style={{ background: T.card, border: `1px solid ${T.rule}`, marginBottom: 24 }}>
        <div style={{ padding: '14px 20px', borderBottom: `1px solid ${T.rule}` }}>
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Perfil profissional</h3>
        </div>
        <div style={{ padding: 20, display: 'grid', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label="Nome / Atelier"><input className="input" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="NIF"><input className="input mono" value={f.nif} onChange={e => setF({ ...f, nif: e.target.value })} /></Field>
          </div>
        </div>
      </section>

      <section style={{ background: T.card, border: `1px solid ${T.rule}`, marginBottom: 24 }}>
        <div style={{ padding: '14px 20px', borderBottom: `1px solid ${T.rule}` }}>
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Valores por defeito</h3>
          <div style={{ fontSize: 12, color: T.inkSoft, marginTop: 2 }}>Usados em novos projectos, facturas e registos de horas</div>
        </div>
        <div style={{ padding: 20, display: 'grid', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
            <Field label="Taxa hora líquida desejada (€)"><input className="input mono" type="number" step="0.01" value={f.hourlyRate} onChange={e => setF({ ...f, hourlyRate: e.target.value === '' ? '' : parseFloat(e.target.value) })} onBlur={e => setF(x => ({ ...x, hourlyRate: parseFloat(e.target.value) || 0 }))} /></Field>
            <Field label="IVA (%)"><input className="input mono" type="number" step="1" value={f.ivaRate} onChange={e => setF({ ...f, ivaRate: e.target.value === '' ? '' : parseFloat(e.target.value) })} onBlur={e => setF(x => ({ ...x, ivaRate: parseFloat(e.target.value) || 0 }))} /></Field>
            <Field label="Retenção IRS (%)"><input className="input mono" type="number" step="1" value={f.irsRetention} onChange={e => setF({ ...f, irsRetention: e.target.value === '' ? '' : parseFloat(e.target.value) })} onBlur={e => setF(x => ({ ...x, irsRetention: parseFloat(e.target.value) || 0 }))} /></Field>
          </div>
          <Field label="Prazo de pagamento (dias)"><input className="input mono" type="number" step="1" value={f.paymentDueDays} onChange={e => setF({ ...f, paymentDueDays: parseInt(e.target.value) || 30 })} style={{ maxWidth: 120 }} /></Field>
        </div>
      </section>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginBottom: 32 }}>
        {saved && <span style={{ alignSelf: 'center', fontSize: 13, color: T.positive }}>✓ Guardado</span>}
        <button className="btn-primary" onClick={saveSettings} disabled={!online}>Guardar definições</button>
      </div>

      <section style={{ background: T.card, border: `1px solid ${T.rule}`, marginBottom: 24 }}>
        <div style={{ padding: '14px 20px', borderBottom: `1px solid ${T.rule}` }}>
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Cópias de segurança</h3>
          <div style={{ fontSize: 12, color: T.inkSoft, marginTop: 2 }}>O Supabase faz backup automático diário. Pode também exportar manualmente.</div>
        </div>
        <div style={{ padding: 20, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button className="btn-secondary" onClick={exportBackup} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Download size={14} /> Exportar JSON
          </button>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', fontSize: 13, fontWeight: 500, border: `1px solid ${T.rule}`, cursor: 'pointer', color: T.ink, background: 'transparent' }}>
            <Upload size={14} /> {importing ? 'A importar…' : 'Importar JSON'}
            <input type="file" accept=".json" style={{ display: 'none' }} onChange={importBackup} disabled={importing || !online} />
          </label>
        </div>
        <div style={{ padding: '10px 20px 16px', fontSize: 12, color: T.inkSoft }}>
          Conta: <span className="mono">{user.email}</span>
        </div>
      </section>
    </div>
  );
}

// ============================================================
// Shared UI Components
// ============================================================
function Modal({ title, children, onClose, wide }) {
  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="modal-bg" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: wide ? 700 : 560 }}>
        <div className="modal-header">
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{title}</h2>
          <button className="btn-icon" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

function ModalFooter({ onCancel, onSave, saveLabel = 'Guardar' }) {
  return (
    <div className="modal-footer">
      <button className="btn-secondary" onClick={onCancel}>Cancelar</button>
      <button className="btn-primary" onClick={onSave}>{saveLabel}</button>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

function Toolbar({ children }) {
  return (
    <div className="toolbar-mobile-stack" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
      {children}
    </div>
  );
}

function SearchInput({ value, onChange, placeholder }) {
  return (
    <div style={{ position: 'relative', flex: 1, maxWidth: 320 }}>
      <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: T.inkMuted }} />
      <input className="input" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={{ paddingLeft: 32 }} />
    </div>
  );
}

function StatusBadge({ status }) {
  const colors = {
    'Activo': { bg: T.positiveBg, color: T.positive, border: T.positive },
    'Em pausa': { bg: T.alertBg, color: T.alert, border: T.alert },
    'Concluído': { bg: T.cardSoft, color: T.inkSoft, border: T.rule },
    'Cancelado': { bg: T.cardSoft, color: T.inkMuted, border: T.ruleSoft }
  };
  const c = colors[status] || colors['Concluído'];
  return <span className="badge" style={{ background: c.bg, color: c.color, borderColor: c.border }}>{status}</span>;
}
