import { useQuery } from "@tanstack/react-query";
import api from "../api/client";

interface AccountSummary {
  account_mode: string;
  equity: number;
  cash_available: number;
  positions: Array<{ symbol: string; quantity: number; market_value: number; avg_price: number }>;
  today_orders: Array<{ order_id: string; symbol: string; status: string; price: number; quantity: number }>;
}

function useAccount(mode: "paper" | "live") {
  return useQuery({
    queryKey: ["account", mode],
    queryFn: async () => {
      const { data } = await api.get<AccountSummary>(`/accounts/${mode}`);
      return data;
    },
    retry: false
  });
}

export function AccountPage() {
  const paper = useAccount("paper");
  const live = useAccount("live");

  const accounts = [
    { label: "纸上账户", query: paper },
    { label: "实盘账户", query: live }
  ];

  return (
    <div className="space-y-12">
      <header>
        <h2 className="text-3xl font-semibold">账户信息</h2>
        <p className="text-slate-400 mt-2">查看资产情况、持仓结构以及当日成交。</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {accounts.map(({ label, query }) => (
          <div key={label} className="glass-panel p-8 rounded-3xl border border-white/5 space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-semibold">{label}</h3>
              {query.isError && <span className="text-sm text-slate-500">未配置</span>}
            </div>
            {query.isLoading && <div className="text-slate-500">加载中...</div>}
            {query.data && (
              <>
                <div className="grid grid-cols-3 gap-4 text-sm text-slate-300">
                  <div>权益：<span className="text-red-300 font-medium">{query.data.equity.toFixed(2)}</span></div>
                  <div>可用资金：<span className="text-red-300 font-medium">{query.data.cash_available.toFixed(2)}</span></div>
                  <div>持仓数：{query.data.positions.length}</div>
                </div>
                <div>
                  <h4 className="text-sm uppercase tracking-widest text-slate-400 mb-3">持仓</h4>
                  <div className="space-y-2 text-sm">
                    {query.data.positions.map((pos) => (
                      <div key={pos.symbol} className="bg-slate-900/60 px-4 py-2 rounded-xl border border-white/5 flex justify-between">
                        <span>{pos.symbol}</span>
                        <span className="text-red-300">{pos.quantity.toFixed(2)}</span>
                        <span className="text-slate-400">市值 {pos.market_value.toFixed(2)}</span>
                      </div>
                    ))}
                    {query.data.positions.length === 0 && <div className="text-slate-500">暂无持仓。</div>}
                  </div>
                </div>
                <div>
                  <h4 className="text-sm uppercase tracking-widest text-slate-400 mb-3">当日订单</h4>
                  <div className="space-y-2 text-sm">
                    {query.data.today_orders.map((order) => (
                      <div key={order.order_id} className="bg-slate-900/60 px-4 py-2 rounded-xl border border-white/5 flex justify-between">
                        <span>{order.symbol}</span>
                        <span className={order.status === "Filled" ? "text-red-300" : "text-green-300"}>{order.status}</span>
                        <span>{order.price.toFixed(2)}</span>
                        <span className="text-slate-500">{order.quantity.toFixed(2)}</span>
                      </div>
                    ))}
                    {query.data.today_orders.length === 0 && <div className="text-slate-500">暂无订单。</div>}
                  </div>
                </div>
              </>
            )}
            {query.isError && <div className="text-slate-500 text-sm">暂未配置该账户或访问失败。</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

