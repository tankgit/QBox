import { useEffect, useMemo, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { Dialog } from "./components/Dialog";
import { DataManagementPage } from "./pages/DataManagementPage";
import { StrategyManagementPage } from "./pages/StrategyManagementPage";
import { BacktestManagementPage } from "./pages/BacktestManagementPage";
import { QuantTradingPage } from "./pages/QuantTradingPage";
import { AccountPage } from "./pages/AccountPage";
import {
  getHkSessionSnapshot,
  getUsSessionSnapshot,
  listSessionsByMarket,
  SessionSnapshot,
} from "./utils/tradingSessions";

const navigation = [
  { to: "/data", label: "数据管理" },
  { to: "/strategies", label: "策略管理" },
  { to: "/backtests", label: "回测管理" },
  { to: "/quant", label: "量化交易" },
  { to: "/accounts", label: "账户信息" }
];

const QuestionMarkIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    className="h-5 w-5"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.75-1.5 2.25-2.5 3.25-.5.5-.5 1.25-.5 1.75"
    />
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 17h.01" />
    <circle cx="12" cy="12" r="9" />
  </svg>
);

interface SessionCardRowProps {
  label: string;
  timezoneLabel: string;
  snapshot: SessionSnapshot;
  borderClass: string;
  accentTextClass: string;
  showDst?: boolean;
}

const SessionCardRow = ({
  label,
  timezoneLabel,
  snapshot,
  borderClass,
  accentTextClass,
  showDst = false,
}: SessionCardRowProps) => {
  const status = snapshot.current?.name ?? "休市";
  const dstDisplay = snapshot.dstLabel.replace(/(夏令时|冬令时).*/, "$1");
  return (
    <div className={`rounded-2xl border ${borderClass} bg-slate-900/40 px-4 py-3 transition`}>
      <div className="flex items-start justify-between text-sm text-slate-300">
        <div className="space-y-1">
          <span className="block text-xs font-semibold text-white/80 uppercase tracking-[0.28em]">
            {label}
          </span>
          <span
            className={`block text-xl font-semibold ${
              status === "休市" ? "text-slate-400" : accentTextClass
            }`}
          >
            {status}
          </span>
          
        </div>
      </div>
      <p className="mt-4 text-xs font-medium text-slate-400">

      <span className="block text-xs text-slate-500">{timezoneLabel}</span>
        {snapshot.localTime}
        {showDst ? `（${dstDisplay}）` : ""}
      </p>
    </div>
  );
};

export default function App() {
  const [now, setNow] = useState(() => new Date());
  const [sessionDialogOpen, setSessionDialogOpen] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const usSnapshot = useMemo(() => getUsSessionSnapshot(now), [now]);
  const hkSnapshot = useMemo(() => getHkSessionSnapshot(now), [now]);
  const usSessions = useMemo(() => listSessionsByMarket("us"), []);
  const hkSessions = useMemo(() => listSessionsByMarket("hk"), []);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 relative">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute left-[10%] top-[18%] w-[18rem] h-[18rem] rounded-full bg-blue-500/14 blur-[70px]" />
        <div className="absolute right-[12%] top-[28%] w-[20rem] h-[20rem] rounded-full bg-purple-500/12 blur-[80px]" />
        <div className="absolute left-1/2 top-[55%] w-[16rem] h-[16rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-400/12 blur-[70px]" />
      </div>

      <aside className="fixed top-6 bottom-6 left-6 w-72 glass-panel glass-nav p-8 flex flex-col gap-8 overflow-hidden z-20">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-widest">QBox</h1>
          <p className="text-sm text-slate-300/80">专业的量化交易工具箱</p>
        </div>
        <nav className="flex flex-col gap-2">
          {navigation.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => `nav-link ${isActive ? "nav-link-active" : ""}`}>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Market Clocks</p>
              <p className="text-sm text-slate-200">当前交易时段</p>
            </div>
            <button
              type="button"
              aria-label="查看交易时段说明"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-200 transition hover:bg-white/10 hover:text-white"
              onClick={() => setSessionDialogOpen(true)}
            >
              <QuestionMarkIcon />
            </button>
          </div>
          <div className="space-y-3">
            <SessionCardRow
              label="美股"
              timezoneLabel="美东时间 (ET)"
              snapshot={usSnapshot}
              borderClass="border-orange-400/60"
              accentTextClass="text-orange-300"
              showDst
            />
            <SessionCardRow
              label="港股"
              timezoneLabel="香港时间 (HKT)"
              snapshot={hkSnapshot}
              borderClass="border-purple-400/60"
              accentTextClass="text-purple-300"
            />
          </div>
        </div>
      </aside>

      <main className="relative z-10 ml-[22rem] mr-8 py-12">
        <div className="glass-panel content-shell px-12 py-12 min-h-[calc(100vh-6rem)]">
          <Routes>
            <Route path="/" element={<DataManagementPage />} />
            <Route path="/data/*" element={<DataManagementPage />} />
            <Route path="/strategies" element={<StrategyManagementPage />} />
            <Route path="/backtests/*" element={<BacktestManagementPage />} />
            <Route path="/quant/*" element={<QuantTradingPage />} />
            <Route path="/accounts" element={<AccountPage />} />
          </Routes>
        </div>
      </main>

      <Dialog
        open={sessionDialogOpen}
        title="美股 / 港股 交易时段说明"
        onClose={() => setSessionDialogOpen(false)}
      >
        <div className="space-y-8 text-sm text-slate-200">
          {(() => {
            const currentUsSession = usSnapshot.current?.name;
            const currentHkSession = hkSnapshot.current?.name;
            return (
              <>
                <section>
                  <h3 className="text-lg font-semibold text-white">美股时段 (美东时间)</h3>
                  <p className="mt-1 text-xs text-orange-300/90">当前时制：{usSnapshot.dstLabel}</p>
                  <ul className="mt-3 space-y-3">
                    {usSessions.map((session) => {
                      const isActive = session.name === currentUsSession;
                      return (
                        <li
                          key={session.name}
                          className={`rounded-2xl border px-4 py-3 transition ${
                            isActive
                              ? "border-orange-400/70 bg-orange-500/5 shadow-[0_0_20px_rgba(251,146,60,0.25)]"
                              : "border-white/10 bg-slate-900/50"
                          }`}
                        >
                          <p className="text-base font-semibold text-white">{session.name}</p>
                          <p className="mt-1 text-xs text-slate-300">
                            时段：{session.windows.map((window) => `${window.start} - ${window.end}`).join(" / ")}
                          </p>
                          {session.description && (
                            <p className="mt-1 text-xs text-slate-400">{session.description}</p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>

                <section>
                  <h3 className="text-lg font-semibold text-white">港股时段 (香港时间)</h3>
                  <p className="mt-1 text-xs text-purple-300/90">当前时制：{hkSnapshot.dstLabel}</p>
                  <ul className="mt-3 space-y-3">
                    {hkSessions.map((session) => {
                      const isActive = session.name === currentHkSession;
                      return (
                        <li
                          key={session.name}
                          className={`rounded-2xl border px-4 py-3 transition ${
                            isActive
                              ? "border-purple-400/70 bg-purple-500/5 shadow-[0_0_20px_rgba(168,85,247,0.25)]"
                              : "border-white/10 bg-slate-900/50"
                          }`}
                        >
                          <p className="text-base font-semibold text-white">{session.name}</p>
                          <p className="mt-1 text-xs text-slate-300">
                            时段：{session.windows.map((window) => `${window.start} - ${window.end}`).join(" / ")}
                          </p>
                          {session.description && (
                            <p className="mt-1 text-xs text-slate-400">{session.description}</p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              </>
            );
          })()}
        </div>
      </Dialog>
    </div>
  );
}

