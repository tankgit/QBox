import { NavLink, Route, Routes } from "react-router-dom";
import { DataManagementPage } from "./pages/DataManagementPage";
import { StrategyManagementPage } from "./pages/StrategyManagementPage";
import { BacktestManagementPage } from "./pages/BacktestManagementPage";
import { QuantTradingPage } from "./pages/QuantTradingPage";
import { AccountPage } from "./pages/AccountPage";

const navigation = [
  { to: "/data", label: "数据管理" },
  { to: "/strategies", label: "策略管理" },
  { to: "/backtests", label: "回测管理" },
  { to: "/quant", label: "量化交易" },
  { to: "/accounts", label: "账户信息" }
];

export default function App() {
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
    </div>
  );
}

