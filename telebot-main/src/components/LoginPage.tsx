import { useState } from "react";
import { Zap, Eye, EyeOff } from "lucide-react";

export default function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    setTimeout(() => {
      if (username === "admin@admin123" && password === "admin123") {
        if (rememberMe) {
          localStorage.setItem("tele-auth", "1");
        } else {
          sessionStorage.setItem("tele-auth", "1");
        }
        onLogin();
      } else {
        setError("Username atau password salah.");
      }
      setLoading(false);
    }, 400);
  };

  return (
    <div className="min-h-screen bg-[#F0F2F5] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 bg-indigo-500 rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-indigo-200">
            <Zap className="w-6 h-6 text-white fill-current" />
          </div>
          <h1 className="text-xl font-bold text-slate-900">TeleOffer</h1>
          <p className="text-sm text-slate-400 mt-1">Masuk untuk melanjutkan</p>
        </div>

        {/* Card */}
        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-2xl border border-slate-200 shadow-sm p-7 space-y-4"
        >
          {/* Username */}
          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1.5 block">
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => { setUsername(e.target.value); setError(""); }}
              placeholder="Username"
              autoComplete="username"
              className="w-full h-10 border border-slate-200 rounded-xl px-3 text-sm text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition placeholder:text-slate-300"
            />
          </div>

          {/* Password */}
          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1.5 block">
              Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(""); }}
                placeholder="••••••••"
                autoComplete="current-password"
                className="w-full h-10 border border-slate-200 rounded-xl px-3 pr-10 text-sm text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition placeholder:text-slate-300"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition"
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          {/* Remember me */}
          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <div className="relative shrink-0">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-4 h-4 rounded border border-slate-300 peer-checked:bg-indigo-500 peer-checked:border-indigo-500 transition-colors flex items-center justify-center">
                {rememberMe && (
                  <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 10 8">
                    <path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </div>
            </div>
            <span className="text-xs text-slate-500">Ingat saya di perangkat ini</span>
          </label>

          {/* Error */}
          {error && (
            <p className="text-xs text-rose-600 font-medium bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading || !username || !password}
            className="w-full h-11 bg-indigo-500 text-white font-semibold rounded-xl text-sm hover:bg-indigo-600 disabled:opacity-60 transition shadow-sm shadow-indigo-200"
          >
            {loading ? "Memverifikasi..." : "Masuk →"}
          </button>
        </form>
      </div>
    </div>
  );
}
