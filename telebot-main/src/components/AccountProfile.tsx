import { useState, useEffect } from "react";
import {
  ArrowLeft,
  Trash2,
  Plus,
  Search,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Power,
  Settings,
  MessageSquare,
  Target,
  Hash,
  Pencil,
  Check,
  X,
  Phone,
  AtSign,
  User,
  ShieldAlert,
} from "lucide-react";

interface BotSettings {
  isActive: boolean;
  autoDetect: boolean;
  targetGroups: string[];
  responses: { keyword: string; response: string }[];
  antiSpamDelay: number;
  requireEmojiPrefix: boolean;
  filterWords: string[]; // <-- Fitur Kata Terlarang
}

interface ResolvedTarget {
  id: string;
  rawId: string;
  title: string;
  type: string;
  username: string | null;
  membersCount: number | null;
}

interface AccountInfo {
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  phone: string | null;
}

interface AccountStatus {
  accountId: string;
  connected: boolean;
  hasSession: boolean;
}

const defaultSettings: BotSettings = {
  isActive: false,
  autoDetect: false,
  targetGroups: [],
  responses: [],
  antiSpamDelay: 2000,
  requireEmojiPrefix: false,
  filterWords: [],
};

export default function AccountProfile({
  account,
  onBack,
  onDelete,
  onRename,
  onRefresh,
}: {
  account: AccountStatus | undefined;
  onBack: () => void;
  onDelete: (id: string) => void;
  onRename: (newId: string) => void;
  onRefresh?: () => void;
}) {
  const [settings, setSettings] = useState<BotSettings>(defaultSettings);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  // Account info
  const [accountInfo, setAccountInfo] = useState<AccountInfo | null>(null);

  // Rename state
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameInput, setRenameInput] = useState("");
  const [renameError, setRenameError] = useState("");
  const [isRenameSaving, setIsRenameSaving] = useState(false);

  // Target resolver state
  const [targetInput, setTargetInput] = useState("");
  const [resolving, setResolving] = useState(false);
  const [resolved, setResolved] = useState<ResolvedTarget | null>(null);
  const [resolveError, setResolveError] = useState("");

  // Response form state
  const [kw, setKw] = useState("");
  const [res, setRes] = useState("");

  // Filter Words local state (Biar enak ngetiknya pakai koma)
  const [filterInput, setFilterInput] = useState("");

  const accountId = account?.accountId;

  useEffect(() => {
    if (!accountId) return;

    fetch(`/api/account/${encodeURIComponent(accountId)}/settings`)
      .then((r) => r.json())
      .then((data) => { 
        if (data && typeof data === "object") {
          setSettings(data); 
          setFilterInput((data.filterWords || []).join(", "));
        }
      })
      .catch(() => {});

    fetch(`/api/account/${encodeURIComponent(accountId)}/info`)
      .then((r) => r.json())
      .then((data) => { if (data) setAccountInfo(data); })
      .catch(() => {});
  }, [accountId]);

  const saveSetting = async (newSetting: BotSettings) => {
    if (!accountId) return;
    setIsSaving(true);
    setSaveError("");
    try {
      const r = await fetch(`/api/account/${encodeURIComponent(accountId)}/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newSetting),
      });
      if (r.ok) {
        const updated = await r.json().catch(() => newSetting);
        setSettings(updated);
        onRefresh?.();
      } else {
        const d = await r.json().catch(() => ({}));
        setSaveError(d?.error || "Gagal menyimpan pengaturan");
      }
    } catch {
      setSaveError("Tidak bisa terhubung ke server");
    } finally {
      setIsSaving(false);
    }
  };

  const doRename = async () => {
    if (!accountId) return;
    const newId = renameInput.trim();
    if (!newId || newId === accountId) { setIsRenaming(false); return; }
    setIsRenameSaving(true);
    setRenameError("");
    try {
      const r = await fetch(`/api/accounts/${encodeURIComponent(accountId)}/rename`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newId }),
      });
      if (r.ok) {
        setIsRenaming(false);
        onRename(newId);
      } else {
        const d = await r.json().catch(() => ({}));
        setRenameError(d?.error || "Gagal rename");
      }
    } catch {
      setRenameError("Tidak bisa terhubung ke server");
    } finally {
      setIsRenameSaving(false);
    }
  };

  const resolveTarget = async () => {
    if (!targetInput.trim() || !accountId) return;
    setResolving(true);
    setResolved(null);
    setResolveError("");
    try {
      const r = await fetch(`/api/account/${encodeURIComponent(accountId)}/resolve-target`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: targetInput.trim() }),
      });
      if (r.ok) {
        setResolved(await r.json());
      } else {
        const d = await r.json().catch(() => ({}));
        setResolveError(d?.error || "Gagal resolve target");
      }
    } catch {
      setResolveError("Tidak bisa terhubung ke server");
    } finally {
      setResolving(false);
    }
  };

  const confirmAddTarget = async () => {
    const id = resolved?.id || targetInput.trim();
    if (!id) return;
    if ((settings.targetGroups || []).includes(id)) {
      setResolveError("Target sudah ada di daftar");
      return;
    }
    await saveSetting({ ...settings, targetGroups: [...(settings.targetGroups || []), id] });
    setTargetInput("");
    setResolved(null);
    setResolveError("");
  };

  const removeTarget = (t: string) =>
    saveSetting({ ...settings, targetGroups: (settings.targetGroups || []).filter((x) => x !== t) });

  const addResponse = () => {
    if (!kw.trim() || !res.trim()) return;
    saveSetting({
      ...settings,
      responses: [...(settings.responses || []), { keyword: kw.trim(), response: res.trim() }],
    });
    setKw(""); setRes("");
  };

  const removeResponse = (index: number) =>
    saveSetting({ ...settings, responses: (settings.responses || []).filter((_, i) => i !== index) });

  // Fungsi khusus simpan Filter Words saat kotak input ditinggalkan (onBlur)
  const saveFilterWords = () => {
    const words = filterInput.split(",").map(w => w.trim()).filter(Boolean);
    saveSetting({ ...settings, filterWords: words });
  };

  if (!account) {
    return (
      <div className="min-h-screen bg-main flex items-center justify-center">
        <div className="text-center">
          <p className="text-slate-500 mb-4">Akun tidak ditemukan</p>
          <button onClick={onBack} className="flex items-center gap-2 text-sm text-indigo-500 hover:underline mx-auto">
            <ArrowLeft size={14} /> Kembali
          </button>
        </div>
      </div>
    );
  }

  const displayName = accountInfo?.firstName
    ? [accountInfo.firstName, accountInfo.lastName].filter(Boolean).join(" ")
    : null;

  return (
    <div className="min-h-screen bg-main">
      {/* Top bar */}
      <div className="bg-card border-b border-line sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-7 py-3 flex items-center gap-3">
          <button onClick={onBack} className="p-2 hover:bg-hover rounded-xl transition text-secondary">
            <ArrowLeft size={17} />
          </button>

          <div className="w-8 h-8 rounded-lg bg-hover flex items-center justify-center font-bold text-secondary text-sm shrink-0">
            {account.accountId.charAt(0).toUpperCase()}
          </div>

          {/* Name + rename */}
          <div className="flex-1 min-w-0">
            {isRenaming ? (
              <div className="flex items-center gap-1.5">
                <input
                  value={renameInput}
                  onChange={(e) => setRenameInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") doRename();
                    if (e.key === "Escape") { setIsRenaming(false); setRenameError(""); }
                  }}
                  className="h-7 border border-indigo-400 rounded-lg px-2 text-sm font-semibold outline-none bg-card text-primary w-36"
                  autoFocus
                />
                <button
                  onClick={doRename}
                  disabled={isRenameSaving}
                  className="p-1.5 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 disabled:opacity-60"
                >
                  {isRenameSaving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                </button>
                <button
                  onClick={() => { setIsRenaming(false); setRenameError(""); }}
                  className="p-1.5 bg-hover text-secondary rounded-lg hover:bg-hover"
                >
                  <X size={11} />
                </button>
                {renameError && <span className="text-xs text-rose-500">{renameError}</span>}
              </div>
            ) : (
              <div className="flex items-center gap-1.5 min-w-0">
                <p className="text-sm font-bold text-primary truncate">{account.accountId}</p>
                <button
                  onClick={() => { setRenameInput(account.accountId); setIsRenaming(true); }}
                  className="p-1 text-slate-400 hover:text-indigo-500 transition shrink-0"
                  title="Rename akun"
                >
                  <Pencil size={12} />
                </button>
              </div>
            )}
            <div className="flex items-center gap-1.5 mt-0.5">
              <div className={`w-1.5 h-1.5 rounded-full ${account.connected ? "bg-emerald-500" : "bg-slate-300"}`} />
              <span className={`text-xs ${account.connected ? "text-emerald-600" : "text-slate-400"}`}>
                {account.connected ? "Connected" : "Offline"}
              </span>
            </div>
          </div>

          <button
            onClick={() => saveSetting({ ...settings, isActive: !settings.isActive })}
            disabled={isSaving}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition disabled:opacity-60 ${
              settings.isActive
                ? "bg-rose-50 text-rose-600 hover:bg-rose-100 border border-rose-200"
                : "bg-emerald-50 text-emerald-600 hover:bg-emerald-100 border border-emerald-200"
            }`}
          >
            <Power size={13} />
            {settings.isActive ? "Stop Bot" : "Start Bot"}
          </button>

          <button
            onClick={() => { if (confirm(`Hapus akun "${account.accountId}"?`)) onDelete(account.accountId); }}
            className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition"
          >
            <Trash2 size={15} />
          </button>
        </div>

        {/* Account info bar */}
        {accountInfo && (accountInfo.phone || accountInfo.username || displayName) && (
          <div className="max-w-5xl mx-auto px-7 pb-2.5 flex items-center gap-4 flex-wrap">
            {displayName && (
              <div className="flex items-center gap-1.5 text-xs text-secondary">
                <User size={11} className="text-indigo-400" />
                <span>{displayName}</span>
              </div>
            )}
            {accountInfo.username && (
              <div className="flex items-center gap-1.5 text-xs text-secondary">
                <AtSign size={11} className="text-indigo-400" />
                <span>{accountInfo.username}</span>
              </div>
            )}
            {accountInfo.phone && (
              <div className="flex items-center gap-1.5 text-xs text-secondary">
                <Phone size={11} className="text-indigo-400" />
                <span>+{accountInfo.phone}</span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="max-w-5xl mx-auto px-7 py-6 space-y-5">
        {saveError && (
          <div className="flex items-center gap-2 px-4 py-3 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-600">
            <AlertCircle size={14} className="shrink-0" /> {saveError}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* ── Target Groups ── */}
          <div className="bg-card rounded-2xl border border-line overflow-hidden">
            <div className="px-5 py-4 border-b border-line flex items-center gap-2">
              <Target size={15} className="text-indigo-500" />
              <h3 className="text-sm font-bold text-primary">Target Groups</h3>
              <span className="ml-auto text-xs text-secondary bg-hover px-2 py-0.5 rounded-full">
                {(settings.targetGroups || []).length}
              </span>
            </div>

            <div className="p-5 space-y-3">
              <div className="flex gap-2">
                <input
                  value={targetInput}
                  onChange={(e) => { setTargetInput(e.target.value); setResolved(null); setResolveError(""); }}
                  onKeyDown={(e) => { if (e.key === "Enter") resolveTarget(); }}
                  placeholder="@username atau -100123456789"
                  className="flex-1 h-9 border border-line rounded-xl px-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition placeholder:text-slate-300 bg-card text-primary"
                />
                <button
                  onClick={resolveTarget}
                  disabled={!targetInput.trim() || resolving || !account.connected}
                  title={!account.connected ? "Akun harus terkoneksi" : "Cek target"}
                  className="w-9 h-9 flex items-center justify-center bg-hover text-secondary rounded-xl hover:bg-indigo-100 hover:text-indigo-600 disabled:opacity-40 transition"
                >
                  {resolving ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                </button>
              </div>

              {!account.connected && (
                <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  Akun offline — verifikasi target tidak tersedia. ID bisa diinput manual.
                </p>
              )}

              {resolved && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2">
                      <CheckCircle2 size={14} className="text-emerald-600 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs font-bold text-emerald-800">{resolved.title}</p>
                        <p className="text-[11px] text-emerald-600 mt-0.5">
                          {resolved.id}{resolved.type ? ` · ${resolved.type}` : ""}
                          {resolved.username ? ` · @${resolved.username}` : ""}
                          {resolved.membersCount ? ` · ${resolved.membersCount.toLocaleString()} anggota` : ""}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={confirmAddTarget}
                      disabled={isSaving}
                      className="px-3 py-1 bg-emerald-500 text-white text-xs font-semibold rounded-lg hover:bg-emerald-600 transition shrink-0 disabled:opacity-60"
                    >
                      + Tambah
                    </button>
                  </div>
                </div>
              )}

              {resolveError && (
                <div className="flex items-center gap-2 px-3 py-2 bg-rose-50 border border-rose-200 rounded-xl">
                  <AlertCircle size={12} className="text-rose-500 shrink-0" />
                  <p className="text-xs text-rose-600">{resolveError}</p>
                </div>
              )}

              {!resolved && !resolveError && targetInput.trim() && !resolving && (
                <button
                  onClick={confirmAddTarget}
                  disabled={isSaving}
                  className="w-full h-8 border border-dashed border-slate-300 text-secondary text-xs rounded-xl hover:border-indigo-400 hover:text-indigo-500 transition disabled:opacity-50"
                >
                  Tambah "{targetInput.trim()}" tanpa verifikasi
                </button>
              )}

              <div className="space-y-1.5 mt-1">
                {(settings.targetGroups || []).map((t) => (
                  <div key={t} className="flex items-center justify-between px-3 py-2 bg-hover border border-line rounded-xl">
                    <div className="flex items-center gap-2 min-w-0">
                      <Hash size={12} className="text-slate-400 shrink-0" />
                      <span className="text-xs font-mono text-primary truncate">{t}</span>
                    </div>
                    <button onClick={() => removeTarget(t)} disabled={isSaving} className="text-slate-400 hover:text-rose-500 transition disabled:opacity-50 shrink-0 ml-2">
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
                {(settings.targetGroups || []).length === 0 && (
                  <p className="text-xs text-secondary text-center py-5">Belum ada target grup</p>
                )}
              </div>
            </div>
          </div>

          {/* ── Auto Reply Rules ── */}
          <div className="bg-card rounded-2xl border border-line overflow-hidden">
            <div className="px-5 py-4 border-b border-line flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MessageSquare size={15} className="text-indigo-500" />
                <h3 className="text-sm font-bold text-primary">Auto Reply Rules</h3>
              </div>
              <span className="text-xs text-secondary bg-hover px-2 py-0.5 rounded-full">
                {(settings.responses || []).length}
              </span>
            </div>

            {/* 🔥 KOTAK INPUT FILTER WORDS 🔥 */}
            <div className="p-5 border-b border-line bg-rose-500/5">
              <div className="flex items-center gap-2 mb-2">
                <ShieldAlert size={14} className="text-rose-500" />
                <label className="text-xs font-bold text-rose-600 uppercase tracking-wide">
                  Filter Words / Kata Terlarang
                </label>
              </div>
              <p className="text-[11px] text-slate-500 mb-2.5 leading-relaxed">
                Abaikan pesan jika mengandung kata-kata di bawah ini (pisahkan dengan koma). Otomatis tersimpan saat kamu klik di luar kotak.
              </p>
              <input
                value={filterInput}
                onChange={(e) => setFilterInput(e.target.value)}
                onBlur={saveFilterWords}
                disabled={isSaving}
                placeholder="contoh: scam, nipu, orang miskin"
                className="w-full h-9 border border-rose-200 rounded-xl px-3 text-sm outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100 transition placeholder:text-slate-300 bg-white text-primary"
              />
            </div>

            <div className="p-5 space-y-3">
              <input
                value={kw}
                onChange={(e) => setKw(e.target.value)}
                placeholder="Keyword — pisahkan dengan koma: wtb, jual, roblox"
                className="w-full h-9 border border-line rounded-xl px-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition placeholder:text-slate-300 bg-card text-primary"
              />
              <textarea
                value={res}
                onChange={(e) => setRes(e.target.value)}
                placeholder="Pesan balasan otomatis..."
                rows={3}
                className="w-full border border-line rounded-xl px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition resize-none placeholder:text-slate-300 bg-card text-primary"
              />
              <button
                onClick={addResponse}
                disabled={isSaving || !kw.trim() || !res.trim()}
                className="w-full h-9 bg-slate-900 text-white text-xs font-semibold rounded-xl hover:bg-black disabled:opacity-40 transition flex items-center justify-center gap-1.5"
              >
                <Plus size={13} /> Tambah Rule
              </button>

              <div className="space-y-2 max-h-[260px] overflow-y-auto mt-1">
                {(settings.responses || []).map((r, i) => (
                  <div key={i} className="flex items-start justify-between gap-2 p-3 bg-hover border border-line rounded-xl">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-primary mb-0.5">"{r.keyword}"</p>
                      <p className="text-xs text-secondary line-clamp-2 leading-relaxed">{r.response}</p>
                    </div>
                    <button onClick={() => removeResponse(i)} disabled={isSaving} className="text-slate-400 hover:text-rose-500 transition shrink-0 disabled:opacity-50">
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
                {(settings.responses || []).length === 0 && (
                  <p className="text-xs text-secondary text-center py-5">Belum ada rule balasan</p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Advanced ── */}
        <div className="bg-card rounded-2xl border border-line overflow-hidden max-w-sm">
          <div className="px-5 py-4 border-b border-line flex items-center gap-2">
            <Settings size={15} className="text-indigo-500" />
            <h3 className="text-sm font-bold text-primary">Advanced</h3>
          </div>
          <div className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-primary">Anti-Spam Delay</p>
                <p className="text-xs text-secondary mt-0.5">Jeda antar pesan (ms)</p>
              </div>
              <input
                type="number" step="500" min="500"
                value={settings.antiSpamDelay || 2000}
                onChange={(e) => saveSetting({ ...settings, antiSpamDelay: Number(e.target.value) })}
                disabled={isSaving}
                className="w-24 h-9 text-center text-sm font-semibold border border-line rounded-xl disabled:opacity-60 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none bg-card text-primary"
              />
            </div>
            
            <div className="h-px bg-line" />
            
            <label className="flex items-center gap-3 cursor-pointer select-none">
              <div className="relative">
                <input
                  type="checkbox"
                  checked={settings.autoDetect || false}
                  onChange={(e) => saveSetting({ ...settings, autoDetect: e.target.checked })}
                  disabled={isSaving}
                  className="sr-only peer"
                />
                <div className="w-10 h-5 bg-slate-200 rounded-full peer-checked:bg-indigo-500 transition-colors peer-disabled:opacity-60" />
                <div className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform peer-checked:translate-x-5" />
              </div>
              <div>
                <p className="text-sm font-medium text-primary">Global Auto-Detect</p>
                <p className="text-xs text-secondary">Balas semua pesan masuk dari target</p>
              </div>
            </label>

            <div className="h-px bg-line" />
            
            <label className="flex items-center gap-3 cursor-pointer select-none">
              <div className="relative">
                <input
                  type="checkbox"
                  checked={settings.requireEmojiPrefix || false}
                  onChange={(e) => saveSetting({ ...settings, requireEmojiPrefix: e.target.checked })}
                  disabled={isSaving}
                  className="sr-only peer"
                />
                <div className="w-10 h-5 bg-slate-200 rounded-full peer-checked:bg-indigo-500 transition-colors peer-disabled:opacity-60" />
                <div className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform peer-checked:translate-x-5" />
              </div>
              <div>
                <p className="text-sm font-medium text-primary">Filter Paid Promote (Wajib Emoji)</p>
                <p className="text-xs text-secondary">Abaikan pesan yang depannya huruf/bukan emoji</p>
              </div>
            </label>

          </div>
        </div>
      </div>
    </div>
  );
}
