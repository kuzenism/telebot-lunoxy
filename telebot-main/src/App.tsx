import { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Terminal,
  Settings,
  Zap,
  Plus,
  Users,
  MessageSquare,
  Activity,
  X,
  Moon,
  Sun,
  LogOut,
} from "lucide-react";
import { io } from "socket.io-client";
import { motion, AnimatePresence } from "motion/react";
import AccountProfile from "./components/AccountProfile";
import LoginPage from "./components/LoginPage";

interface Log {
  message: string;
  type: string;
  timestamp: string;
}

interface AccountStatus {
  accountId: string;
  connected: boolean;
  hasSession: boolean;
  isActive: boolean;
}

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();

  const [isConnected, setIsConnected] = useState(false);
  const [accounts, setAccounts] = useState<AccountStatus[]>([]);
  const [isToggling, setIsToggling] = useState(false);
  const [logs, setLogs] = useState<Log[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);

  // Auth form state
  const [accountId, setAccountId] = useState("");
  const [apiId, setApiId] = useState("");
  const [apiHash, setApiHash] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [pendingAccountId, setPendingAccountId] = useState("");
  const [step, setStep] = useState<1 | 2>(1);
  const [authError, setAuthError] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isAuthed, setIsAuthed] = useState(
    () =>
      sessionStorage.getItem("tele-auth") === "1" ||
      localStorage.getItem("tele-auth") === "1"
  );
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    localStorage.getItem("teleoffer-theme") === "dark" ? "dark" : "light"
  );

  const logsEndRef = useRef<HTMLDivElement>(null);

  // Derive current page from URL
  const accountMatch = location.pathname.match(/^\/account\/(.+)$/);
  const selectedAccountId = accountMatch
    ? decodeURIComponent(accountMatch[1])
    : null;

  const activePage = selectedAccountId
    ? "account"
    : location.pathname === "/logs"
    ? "logs"
    : location.pathname === "/settings"
    ? "settings"
    : "dash";

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("teleoffer-theme", theme);
  }, [theme]);

  const loadConfig = async () => {
    try {
      const data = await fetch("/api/config").then((r) => r.json());
      setIsConnected(Boolean(data.connected));
      setAccounts(Array.isArray(data.accounts) ? data.accounts : []);
    } catch {}
  };

  useEffect(() => {
    loadConfig();

    fetch("/api/logs")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data?.logs)) setLogs(data.logs.slice(0, 100));
      })
      .catch(() => {});

    const socket = io();
    socket.on("bot-log", (log) => {
      setLogs((prev) => {
        const exists = prev.some(
          (e) => e.timestamp === log.timestamp && e.message === log.message
        );
        if (exists) return prev;
        return [log, ...prev].slice(0, 100);
      });
    });

    const refreshInterval = setInterval(loadConfig, 5000);

    return () => {
      socket.disconnect();
      clearInterval(refreshInterval);
    };
  }, []);

  const resetForm = () => {
    setAccountId("");
    setApiId("");
    setApiHash("");
    setPhone("");
    setCode("");
    setPassword("");
    setAuthError("");
    setStep(1);
  };

  const connect = async () => {
    setAuthError("");
    if (!accountId.trim() || !apiId || !apiHash || !phone) {
      setAuthError("Semua field wajib diisi");
      return;
    }
    if (!Number.isFinite(Number(apiId))) {
      setAuthError("API ID harus berupa angka");
      return;
    }
    setIsConnecting(true);
    try {
      const r = await fetch("/api/tg/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: accountId.trim(), apiId, apiHash, phone }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setAuthError(d?.error || "Gagal mengirim kode");
        return;
      }
      setPendingAccountId(accountId.trim());
      setStep(2);
    } finally {
      setIsConnecting(false);
    }
  };

  const verify = async () => {
    setAuthError("");
    setIsVerifying(true);
    try {
      const r = await fetch("/api/tg/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: pendingAccountId, phone, code, password }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setAuthError(d?.error || "Verifikasi gagal");
        return;
      }
      setIsConnected(true);
      await loadConfig();
      setShowAddForm(false);
      resetForm();
    } finally {
      setIsVerifying(false);
    }
  };

  const removeAccount = async (id: string) => {
    await fetch(`/api/accounts/${encodeURIComponent(id)}`, { method: "DELETE" });
    await loadConfig();
  };

  // Mengecek apakah SEMUA bot sedang aktif
  const isAllActive = accounts.length > 0 && accounts.every((acc) => acc.isActive);

  const handleToggleAll = async () => {
    setIsToggling(true);
    try {
      if (isAllActive) {
        await fetch("/api/accounts/stop-all", { method: "POST" });
      } else {
        await fetch("/api/accounts/start-all", { method: "POST" });
      }
      await loadConfig();
    } finally {
      setIsToggling(false);
    }
  };

  const connectedCount = accounts.filter((a) => a.connected).length;

  const logout = () => {
    sessionStorage.removeItem("tele-auth");
    localStorage.removeItem("tele-auth");
    setIsAuthed(false);
  };
  
  if (!isAuthed) {
    return <LoginPage onLogin={() => setIsAuthed(true)} />;
  }

  const navItems = [
    { page: "dash", path: "/", icon: <LayoutDashboard size={17} />, label: "Dashboard" },
    { page: "logs", path: "/logs", icon: <Terminal size={17} />, label: "Logs" },
    { page: "settings", path: "/settings", icon: <Settings size={17} />, label: "Settings" },
  ] as const;

  return (
    <div className="min-h-screen bg-main flex">
      {/* Sidebar */}
      <aside className="w-[60px] bg-[#1C1F2E] flex flex-col items-center py-5 gap-1 fixed left-0 top-0 h-full z-40">
        <div className="w-9 h-9 bg-indigo-500 rounded-xl flex items-center justify-center mb-5 shrink-0">
          <Zap className="w-[18px] h-[18px] text-white fill-current" />
        </div>

        {navItems.map(({ page, path, icon, label }) => (
          <button
            key={page}
            onClick={() => navigate(path)}
            title={label}
            className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${
              activePage === page || (page === "settings" && activePage === "account")
                ? "bg-indigo-500 text-white"
                : "text-slate-500 hover:text-slate-300 hover:bg-white/5"
            }`}
          >
            {icon}
          </button>
        ))}

        <div className="mt-auto flex flex-col items-center gap-3 mb-1">
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            title={theme === "dark" ? "Mode Terang" : "Mode Gelap"}
            className="w-10 h-10 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-200 hover:bg-white/5 transition-all"
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button
            onClick={logout}
            title="Logout"
            className="w-10 h-10 rounded-xl flex items-center justify-center text-slate-500 hover:text-rose-400 hover:bg-white/5 transition-all"
          >
            <LogOut size={16} />
          </button>
          <div
            title={isConnected ? "Ada akun aktif" : "Tidak ada akun aktif"}
            className={`w-2 h-2 rounded-full transition-colors ${
              isConnected ? "bg-emerald-400" : "bg-rose-500"
            }`}
          />
        </div>
      </aside>

      {/* Main Content */}
      <main className="ml-[60px] flex-1 min-h-screen">
        <AnimatePresence mode="wait">
          {/* ── ACCOUNT PROFILE PAGE ── */}
          {activePage === "account" && selectedAccountId && (
            <motion.div
              key="account"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.18 }}
            >
              <AccountProfile
                key={selectedAccountId}
                account={accounts.find((a) => a.accountId === selectedAccountId)}
                onBack={() => navigate(-1)}
                onDelete={(id) => {
                  removeAccount(id);
                  navigate("/");
                }}
                onRename={(newId) => {
                  navigate(`/account/${encodeURIComponent(newId)}`);
                  loadConfig();
                }}
                onRefresh={loadConfig}
              />
            </motion.div>
          )}

          {/* ── DASHBOARD ── */}
          {activePage === "dash" && (
            <motion.div
              key="dash"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              transition={{ duration: 0.18 }}
              className="max-w-5xl mx-auto p-7"
            >
              <div className="space-y-7">
                <div className="flex items-center justify-between">
                  <div>
                    <h1 className="text-xl font-bold text-slate-900">Dashboard</h1>
                    <p className="text-sm text-slate-500 mt-0.5">
                      {connectedCount} dari {accounts.length} akun terhubung
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      resetForm();
                      setShowAddForm(true);
                    }}
                    className="flex items-center gap-2 px-4 py-2 bg-indigo-500 text-white text-sm font-semibold rounded-xl hover:bg-indigo-600 transition shadow-sm shadow-indigo-200"
                  >
                    <Plus size={15} />
                    Tambah Akun
                  </button>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-4">
                  <StatCard icon={<Users size={17} />} label="Total Akun" value={accounts.length} accent="indigo" />
                  <StatCard icon={<Activity size={17} />} label="Terhubung" value={connectedCount} accent="emerald" />
                  <StatCard icon={<MessageSquare size={17} />} label="Log Masuk" value={logs.length} accent="violet" />
                </div>

                {/* Account list */}
                {accounts.length > 0 ? (
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                        Akun Anda
                      </h2>
                      {/* Tombol Toggle All Animasi */}
                      {accounts.length > 0 && (
                        <button
                          onClick={handleToggleAll}
                          disabled={isToggling}
                          className={`relative flex items-center justify-center px-4 py-1.5 overflow-hidden text-xs font-semibold rounded-lg transition-all duration-300 ease-in-out ${
                            isAllActive
                              ? "bg-rose-500/10 text-rose-600 hover:bg-rose-500/20"
                              : "bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20"
                          } ${
                            isToggling 
                              ? "opacity-70 cursor-not-allowed" 
                              : "hover:scale-105 active:scale-95"
                          }`}
                        >
                          {/* Teks Tombol */}
                          <span
                            className={`flex items-center gap-1.5 transition-transform duration-300 ${
                              isToggling ? "scale-0 opacity-0" : "scale-100 opacity-100"
                            }`}
                          >
                            {isAllActive ? "■ Stop All" : "▶ Start All"}
                          </span>

                          {/* Animasi Loading */}
                          {isToggling && (
                            <span className="absolute inset-0 flex items-center justify-center">
                              <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                              </svg>
                            </span>
                          )}
                        </button>
                      )}
                    </div>
                    
                    {/* Daftar Kotak Akun (Ini yang tadi terhapus) */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {accounts.map((acc) => (
                        <AccountCard
                          key={acc.accountId}
                          account={acc}
                          onClick={() => navigate(`/account/${encodeURIComponent(acc.accountId)}`)}
                        />
                      ))}
                    </div>
                  </div>
                ) : (
                  <EmptyState onAdd={() => { resetForm(); setShowAddForm(true); }} />
                )}
              </div>

              <footer className="pt-10 pb-5">
                <p className="text-[11px] text-slate-400 text-center">
                  © {new Date().getFullYear()} raditdev
                </p>
              </footer>
            </motion.div>
          )}

          {/* ── LOGS ── */}
          {activePage === "logs" && (
            <motion.div
              key="logs"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              transition={{ duration: 0.18 }}
              className="max-w-5xl mx-auto p-7"
            >
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h1 className="text-xl font-bold text-slate-900">Console</h1>
                  <button
                    onClick={() => setLogs([])}
                    className="text-xs font-medium text-slate-400 hover:text-slate-600 transition"
                  >
                    Clear
                  </button>
                </div>
                <div className="bg-[#0D1117] rounded-2xl overflow-hidden">
                  <div className="flex items-center gap-1.5 px-4 py-3 border-b border-white/5">
                    <div className="w-2.5 h-2.5 rounded-full bg-rose-500/70" />
                    <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/70" />
                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/70" />
                    <span className="ml-2 text-[10px] text-slate-600 font-mono">teleoffer — log</span>
                  </div>
                  <div className="h-[580px] overflow-y-auto p-4 font-mono text-[11px] space-y-1 scrollbar-thin scrollbar-thumb-white/10">
                    {logs.map((l, i) => (
                      <div key={i} className="flex gap-3">
                        <span className="text-slate-600 shrink-0 select-none">{l.timestamp}</span>
                        <span
                          className={
                            l.type === "success"
                              ? "text-emerald-400"
                              : l.type === "error"
                              ? "text-rose-400"
                              : l.type === "bot"
                              ? "text-indigo-400 font-semibold"
                              : "text-slate-400"
                          }
                        >
                          {l.message}
                        </span>
                      </div>
                    ))}
                    {logs.length === 0 && (
                      <p className="text-slate-700 text-center pt-10 italic">Console kosong...</p>
                    )}
                    <div ref={logsEndRef} />
                  </div>
                </div>
              </div>

              <footer className="pt-6 pb-5">
                <p className="text-[11px] text-slate-400 text-center">
                  © {new Date().getFullYear()} raditdev
                </p>
              </footer>
            </motion.div>
          )}

          {/* ── SETTINGS ── */}
          {activePage === "settings" && (
            <motion.div
              key="settings"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              transition={{ duration: 0.18 }}
              className="max-w-5xl mx-auto p-7"
            >
              <div className="space-y-5 max-w-md">
                <h1 className="text-xl font-bold text-slate-900">Pengaturan</h1>
                {accounts.length === 0 ? (
                  <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center">
                    <p className="text-sm text-slate-400">Belum ada akun tersimpan.</p>
                  </div>
                ) : (
                  <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden divide-y divide-slate-100">
                    {accounts.map((acc) => (
                      <button
                        key={acc.accountId}
                        onClick={() => navigate(`/account/${encodeURIComponent(acc.accountId)}`)}
                        className="w-full flex items-center gap-3 px-5 py-4 hover:bg-slate-50 transition text-left"
                      >
                        <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-600 font-bold text-sm shrink-0">
                          {acc.accountId.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-800 truncate">{acc.accountId}</p>
                          <div className="flex items-center gap-2.5 mt-0.5 flex-wrap">
                            <div className="flex items-center gap-1.5">
                              <div className={`w-1.5 h-1.5 rounded-full ${acc.connected ? "bg-emerald-500" : "bg-slate-300"}`} />
                              <span className={`text-xs ${acc.connected ? "text-emerald-600" : "text-slate-400"}`}>
                                {acc.connected ? "Connected" : "Offline"}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <div className={`w-1.5 h-1.5 rounded-full ${acc.isActive ? "bg-indigo-500 animate-pulse" : "bg-slate-300"}`} />
                              <span className={`text-xs ${acc.isActive ? "text-indigo-500" : "text-slate-400"}`}>
                                {acc.isActive ? "Bot Aktif" : "Bot Mati"}
                              </span>
                            </div>
                          </div>
                        </div>
                        <span className="text-slate-300 text-sm">›</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <footer className="pt-10 pb-5">
                <p className="text-[11px] text-slate-400 text-center">
                  © {new Date().getFullYear()} raditdev
                </p>
              </footer>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* ── Add Account Modal ── */}
      <AnimatePresence>
        {showAddForm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setShowAddForm(false);
                resetForm();
              }
            }}
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0, y: 8 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.96, opacity: 0, y: 8 }}
              transition={{ duration: 0.18 }}
              className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden"
            >
              <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-100">
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    {step === 1 ? "Tambah Akun Telegram" : "Verifikasi OTP"}
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {step === 1
                      ? "Masukkan kredensial Telegram kamu"
                      : `Kode OTP dikirim ke ${phone}`}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex gap-1.5">
                    <div className={`w-1.5 h-1.5 rounded-full ${step >= 1 ? "bg-indigo-500" : "bg-slate-200"}`} />
                    <div className={`w-1.5 h-1.5 rounded-full ${step >= 2 ? "bg-indigo-500" : "bg-slate-200"}`} />
                  </div>
                  <button
                    onClick={() => { setShowAddForm(false); resetForm(); }}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
                  >
                    <X size={15} />
                  </button>
                </div>
              </div>

              <div className="px-6 py-5 space-y-3">
                {step === 1 ? (
                  <>
                    <Field label="Account ID" value={accountId} onChange={setAccountId} placeholder="contoh: akun-1" />
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="API ID" value={apiId} onChange={setApiId} placeholder="12345678" />
                      <Field label="API Hash" value={apiHash} onChange={setApiHash} placeholder="a1b2c3d4..." />
                    </div>
                    <Field label="Nomor HP" value={phone} onChange={setPhone} placeholder="+62812345678" />
                    <p className="text-[11px] text-slate-400">
                      API ID & Hash bisa didapat dari{" "}
                      <span className="font-semibold text-slate-600">my.telegram.org</span>
                    </p>
                    {authError && (
                      <p className="text-xs text-rose-600 font-medium bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                        {authError}
                      </p>
                    )}
                    <button
                      onClick={connect}
                      disabled={isConnecting}
                      className="w-full h-11 bg-indigo-500 text-white font-semibold rounded-xl text-sm hover:bg-indigo-600 disabled:opacity-60 transition"
                    >
                      {isConnecting ? "Mengirim kode..." : "Kirim Kode OTP →"}
                    </button>
                  </>
                ) : (
                  <>
                    <div className="px-3 py-2 bg-indigo-50 border border-indigo-100 rounded-lg">
                      <p className="text-xs text-indigo-600">
                        Akun: <span className="font-bold text-indigo-800">{pendingAccountId}</span>
                      </p>
                    </div>
                    <Field label="Kode OTP" value={code} onChange={setCode} placeholder="12345" />
                    <Field
                      label="Password 2FA (kosongkan jika tidak ada)"
                      value={password}
                      onChange={setPassword}
                      type="password"
                      placeholder="••••••••"
                    />
                    {authError && (
                      <p className="text-xs text-rose-600 font-medium bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                        {authError}
                      </p>
                    )}
                    <button
                      onClick={verify}
                      disabled={isVerifying}
                      className="w-full h-11 bg-indigo-500 text-white font-semibold rounded-xl text-sm hover:bg-indigo-600 disabled:opacity-60 transition"
                    >
                      {isVerifying ? "Memverifikasi..." : "Verifikasi & Sambungkan →"}
                    </button>
                    <button
                      onClick={() => setStep(1)}
                      className="w-full h-10 bg-slate-100 text-slate-600 font-medium rounded-xl text-sm hover:bg-slate-200 transition"
                    >
                      ← Kembali
                    </button>
                  </>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  accent: "indigo" | "emerald" | "violet";
}) {
  const styles = {
    indigo: "bg-indigo-50 text-indigo-600 border-indigo-100",
    emerald: "bg-emerald-50 text-emerald-600 border-emerald-100",
    violet: "bg-violet-50 text-violet-600 border-violet-100",
  };
  return (
    <div className={`bg-white rounded-2xl border p-5 ${styles[accent]}`}>
      <div className="flex items-center gap-2 mb-3 opacity-60 text-xs font-semibold uppercase tracking-wide">
        {icon}
        <span>{label}</span>
      </div>
      <p className="text-3xl font-bold text-slate-900">{value}</p>
    </div>
  );
}

function AccountCard({
  account,
  onClick,
}: {
  account: AccountStatus;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="bg-white border border-slate-200 rounded-2xl p-4 text-left hover:border-indigo-300 hover:shadow-md hover:shadow-indigo-50 transition-all group"
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-600 font-bold text-sm group-hover:bg-indigo-50 group-hover:text-indigo-600 transition shrink-0">
          {account.accountId.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-900 truncate">{account.accountId}</p>
          <div className="flex items-center gap-2.5 mt-0.5 flex-wrap">
            <div className="flex items-center gap-1.5">
              <div className={`w-1.5 h-1.5 rounded-full ${account.connected ? "bg-emerald-500" : "bg-slate-300"}`} />
              <span className={`text-xs ${account.connected ? "text-emerald-600" : "text-slate-400"}`}>
                {account.connected ? "Connected" : "Offline"}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className={`w-1.5 h-1.5 rounded-full ${account.isActive ? "bg-indigo-500 animate-pulse" : "bg-slate-300"}`} />
              <span className={`text-xs ${account.isActive ? "text-indigo-500" : "text-slate-400"}`}>
                {account.isActive ? "Bot Aktif" : "Bot Mati"}
              </span>
            </div>
          </div>
        </div>
        <span className="text-slate-300 group-hover:text-indigo-400 transition text-lg leading-none">›</span>
      </div>
    </button>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="text-center py-20">
      <div className="w-14 h-14 bg-white border border-slate-200 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-sm">
        <Zap className="w-7 h-7 text-indigo-400" />
      </div>
      <h3 className="text-base font-semibold text-slate-700 mb-1">Belum ada akun</h3>
      <p className="text-sm text-slate-400 mb-5">
        Tambahkan akun Telegram untuk mulai menggunakan bot.
      </p>
      <button
        onClick={onAdd}
        className="px-5 py-2.5 bg-indigo-500 text-white text-sm font-semibold rounded-xl hover:bg-indigo-600 transition shadow-sm shadow-indigo-200"
      >
        Tambah Akun Pertama
      </button>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="text-xs font-semibold text-slate-500 mb-1.5 block">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full h-10 border border-slate-200 rounded-xl px-3 text-sm text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition placeholder:text-slate-300"
      />
    </div>
  );
}
