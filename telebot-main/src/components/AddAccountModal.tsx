import React from "react";
import { Key } from "lucide-react";

export default function AddAccountModal(props: any) {
  const {
    open,
    onClose,
    accountId,
    setAccountId,
    apiId,
    setApiId,
    apiHash,
    setApiHash,
    phone,
    setPhone,
    connect,
    isConnecting,
    step,
    setStep,
    pendingAccountId,
    code,
    setCode,
    password,
    setPassword,
    verify,
    isVerifying,
    authError,
  } = props;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/40 p-6">
      <div className="max-w-lg w-full bg-white rounded-3xl p-8 relative border border-slate-100">
        <button onClick={onClose} className="absolute right-4 top-4 text-slate-300 hover:text-slate-500">✕</button>

        <div className="text-center mb-6">
          <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center mx-auto mb-3 border border-slate-100">
            <Key className="w-6 h-6 text-indigo-600" />
          </div>
          <h3 className="text-lg font-black text-slate-900">Connect New Account</h3>
          <p className="text-xs text-slate-400 mt-1">Gunakan API ID & API Hash dari my.telegram.org</p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase">Account Label (Private)</label>
            <input value={accountId} onChange={(e) => setAccountId(e.target.value)} placeholder="Ex: Account Jualan 1" className="w-full h-11 bg-white border border-slate-200 rounded-xl px-4 text-xs font-bold" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase">API ID</label>
              <input value={apiId} onChange={(e) => setApiId(e.target.value)} className="w-full h-11 bg-white border border-slate-200 rounded-xl px-4 text-xs font-bold" />
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase">API HASH</label>
              <input value={apiHash} onChange={(e) => setApiHash(e.target.value)} className="w-full h-11 bg-white border border-slate-200 rounded-xl px-4 text-xs font-bold" />
            </div>
          </div>

          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase">Phone Number</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+628..." className="w-full h-11 bg-white border border-slate-200 rounded-xl px-4 text-xs font-bold" />
          </div>

          {authError && <p className="text-[11px] text-rose-600 font-semibold">{authError}</p>}

          {step === 1 ? (
            <button onClick={connect} disabled={isConnecting} className="w-full h-12 bg-slate-900 text-white font-bold rounded-xl text-sm uppercase tracking-widest disabled:opacity-60">{isConnecting ? "Requesting..." : "Request Access Code"}</button>
          ) : (
            <div className="space-y-3">
              <p className="text-[11px] text-slate-500">Account: <span className="font-bold text-slate-800">{pendingAccountId}</span></p>
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Verification Code" className="w-full h-11 bg-white border border-slate-200 rounded-xl px-4 text-xs font-bold" />
              <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password (2FA)" type="password" className="w-full h-11 bg-white border border-slate-200 rounded-xl px-4 text-xs font-bold" />
              <div className="flex gap-2">
                <button onClick={verify} disabled={isVerifying} className="flex-1 h-11 bg-indigo-600 text-white rounded-xl font-bold">{isVerifying ? "Verifying..." : "Confirm Session"}</button>
                <button onClick={() => setStep(1)} className="flex-1 h-11 bg-white border border-slate-200 rounded-xl font-bold">Back</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
