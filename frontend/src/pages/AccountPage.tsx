import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import api from "../api/client";

interface CashInfo {
  withdraw_cash: number;
  available_cash: number;
  frozen_cash: number;
  settling_cash: number;
  currency: string;
}

interface FrozenTransactionFee {
  currency: string;
  frozen_transaction_fee: number;
}

interface AccountBalance {
  total_cash: number;
  max_finance_amount: number;
  remaining_finance_amount: number;
  risk_level: number;
  margin_call: number;
  currency: string;
  cash_infos: CashInfo[];
  net_assets: number;
  init_margin: number;
  maintenance_margin: number;
  buy_power: number;
  frozen_transaction_fees: FrozenTransactionFee | null;
}

interface StockPosition {
  type: "stock";
  symbol: string;
  symbol_name: string;
  quantity: number;
  available_quantity: number;
  currency: string;
  cost_price: number;
  market: string;
  init_quantity: number | null;
  estimated_market_value: number;
}

interface FundPosition {
  type: "fund";
  symbol: string;
  symbol_name: string;
  holding_units: number;
  currency: string;
  current_net_asset_value: number;
  cost_net_asset_value: number;
  net_asset_value_day: string;
  estimated_market_value: number;
}

interface AccountSummary {
  account_mode: string;
  balances: AccountBalance[];
  positions: Array<StockPosition | FundPosition>;
  today_orders: Array<{ order_id: string; symbol: string; status: string; price: number; quantity: number }>;
}

function useAccount(mode: "paper" | "live", currency: "HKD" | "USD" | null) {
  return useQuery({
    queryKey: ["account", mode, currency],
    queryFn: async () => {
      const params = currency ? { currency } : {};
      const { data } = await api.get<AccountSummary>(`/accounts/${mode}`, { params });
      return data;
    },
    retry: false
  });
}

export function AccountPage() {
  const [paperCurrency, setPaperCurrency] = useState<"HKD" | "USD">("HKD");
  const [liveCurrency, setLiveCurrency] = useState<"HKD" | "USD">("HKD");
  const paper = useAccount("paper", paperCurrency);
  const live = useAccount("live", liveCurrency);

  const accounts = [
    { label: "纸上账户", query: paper, currency: paperCurrency, setCurrency: setPaperCurrency },
    { label: "实盘账户", query: live, currency: liveCurrency, setCurrency: setLiveCurrency }
  ];

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <header className="flex-shrink-0 mb-8">
        <h2 className="text-3xl font-semibold">账户信息</h2>
        <p className="text-slate-400 mt-2">查看资产情况、持仓结构以及当日成交。</p>
      </header>

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 gap-6 overflow-hidden">
        {accounts.map(({ label, query, currency, setCurrency }) => (
          <div key={label} className="glass-panel rounded-3xl border border-white/5 flex flex-col h-full overflow-hidden">
            <div className="flex-shrink-0 p-8 pb-4 border-b border-white/5">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-semibold">{label}</h3>
                <div className="flex items-center gap-2">
                  {query.isError && <span className="text-sm text-slate-500">未配置</span>}
                  {!query.isError && (
                    <div className="flex items-center gap-2 bg-slate-900/60 px-2 py-1.5 rounded-lg border border-white/5">
                      <button
                        onClick={() => setCurrency("HKD")}
                        className={`px-3 py-1 rounded text-xs font-medium transition-all ${
                          currency === "HKD"
                            ? "bg-red-500/20 text-red-300 border border-red-500/30"
                            : "text-slate-400 hover:text-slate-300"
                        }`}
                      >
                        HKD
                      </button>
                      <button
                        onClick={() => setCurrency("USD")}
                        className={`px-3 py-1 rounded text-xs font-medium transition-all ${
                          currency === "USD"
                            ? "bg-red-500/20 text-red-300 border border-red-500/30"
                            : "text-slate-400 hover:text-slate-300"
                        }`}
                      >
                        USD
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-8 pt-6 space-y-6">
              {query.isLoading && <div className="text-slate-500">加载中...</div>}
              {query.data && (
                <>
                {query.data.balances.length > 0 ? (
                  <div className="space-y-4">
                    {query.data.balances.map((balance, idx) => (
                      <div key={idx} className="bg-slate-900/60 p-4 rounded-xl border border-white/5 space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="text-sm font-semibold text-slate-300">账户余额 ({balance.currency})</h4>
                          <span className="text-xs text-slate-500">风险等级: {balance.risk_level}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-3 text-sm">
                          <div>
                            <span className="text-slate-400">净资产：</span>
                            <span className="text-red-300 font-medium ml-2">{balance.net_assets.toFixed(2)}</span>
                          </div>
                          <div>
                            <span className="text-slate-400">总现金：</span>
                            <span className="text-red-300 font-medium ml-2">{balance.total_cash.toFixed(2)}</span>
                          </div>
                          <div>
                            <span className="text-slate-400">购买力：</span>
                            <span className="text-green-300 font-medium ml-2">{balance.buy_power.toFixed(2)}</span>
                          </div>
                          <div>
                            <span className="text-slate-400">最大融资额度：</span>
                            <span className="text-slate-300 ml-2">{balance.max_finance_amount.toFixed(2)}</span>
                          </div>
                          <div>
                            <span className="text-slate-400">剩余融资额度：</span>
                            <span className="text-slate-300 ml-2">{balance.remaining_finance_amount.toFixed(2)}</span>
                          </div>
                          <div>
                            <span className="text-slate-400">保证金追缴：</span>
                            <span className={balance.margin_call > 0 ? "text-red-300" : "text-slate-300"}>{balance.margin_call.toFixed(2)}</span>
                          </div>
                          <div>
                            <span className="text-slate-400">初始保证金：</span>
                            <span className="text-slate-300 ml-2">{balance.init_margin.toFixed(2)}</span>
                          </div>
                          <div>
                            <span className="text-slate-400">维持保证金：</span>
                            <span className="text-slate-300 ml-2">{balance.maintenance_margin.toFixed(2)}</span>
                          </div>
                        </div>
                        {balance.cash_infos.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-white/5">
                            <h5 className="text-xs uppercase tracking-widest text-slate-400 mb-3">现金详情</h5>
                            <div className="grid grid-cols-2 gap-3">
                              {balance.cash_infos.map((cash, cashIdx) => (
                                <div key={cashIdx} className="bg-slate-800/40 p-3 rounded-lg border border-white/5 space-y-2">
                                  <div className="text-xs font-semibold text-slate-300 mb-2">
                                    现金信息 ({cash.currency})
                                  </div>
                                  <div className="space-y-1.5 text-xs">
                                    <div className="flex justify-between">
                                      <span className="text-slate-500">可用现金：</span>
                                      <span className="text-green-300 font-medium">{cash.available_cash.toFixed(2)}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-slate-500">可取现金：</span>
                                      <span className="text-slate-300">{cash.withdraw_cash.toFixed(2)}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-slate-500">冻结现金：</span>
                                      <span className="text-yellow-300">{cash.frozen_cash.toFixed(2)}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-slate-500">待结算现金：</span>
                                      <span className="text-slate-300">{cash.settling_cash.toFixed(2)}</span>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {balance.frozen_transaction_fees && (
                          <div className="mt-2 text-xs text-slate-400">
                            <span>冻结交易费用 ({balance.frozen_transaction_fees.currency})：</span>
                            <span className="text-yellow-300 ml-1">{balance.frozen_transaction_fees.frozen_transaction_fee.toFixed(2)}</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="bg-slate-900/60 p-6 rounded-xl border border-white/5 text-center">
                    <div className="text-slate-500 text-sm">
                      暂无 {currency} 货币的账户余额信息
                    </div>
                  </div>
                )}
                <div className="text-sm text-slate-300 mt-4">
                  <span>持仓数：</span>
                  <span className="text-red-300 font-medium">{query.data.positions.length}</span>
                </div>
                <div>
                  <h4 className="text-sm uppercase tracking-widest text-slate-400 mb-3">持仓</h4>
                  <div className="space-y-2 text-sm">
                    {query.data.positions.map((pos) => (
                      <div key={pos.symbol} className="bg-slate-900/60 px-4 py-3 rounded-xl border border-white/5 space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{pos.symbol}</span>
                            <span className="text-xs px-2 py-0.5 rounded bg-slate-800/60 text-slate-400">
                              {pos.type === "stock" ? "股票" : "基金"}
                            </span>
                          </div>
                          <span className="text-red-300 font-medium">
                            {pos.estimated_market_value.toFixed(2)} {pos.currency}
                          </span>
                        </div>
                        <div className="text-xs text-slate-400">
                          {pos.symbol_name}
                        </div>
                        {pos.type === "stock" ? (
                          <div className="grid grid-cols-2 gap-2 text-xs text-slate-500 pt-1 border-t border-white/5">
                            <div>
                              <span>持仓数量：</span>
                              <span className="text-slate-300">{pos.quantity.toFixed(2)}</span>
                            </div>
                            <div>
                              <span>可用数量：</span>
                              <span className="text-slate-300">{pos.available_quantity.toFixed(2)}</span>
                            </div>
                            <div>
                              <span>成本价：</span>
                              <span className="text-slate-300">{pos.cost_price.toFixed(4)}</span>
                            </div>
                            <div>
                              <span>市场：</span>
                              <span className="text-slate-300">{pos.market || "-"}</span>
                            </div>
                            {pos.init_quantity !== null && (
                              <div>
                                <span>初始持仓：</span>
                                <span className="text-slate-300">{pos.init_quantity.toFixed(2)}</span>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="grid grid-cols-2 gap-2 text-xs text-slate-500 pt-1 border-t border-white/5">
                            <div>
                              <span>持有份额：</span>
                              <span className="text-slate-300">{pos.holding_units.toFixed(4)}</span>
                            </div>
                            <div>
                              <span>当前净值：</span>
                              <span className="text-slate-300">{pos.current_net_asset_value.toFixed(4)}</span>
                            </div>
                            <div>
                              <span>成本净值：</span>
                              <span className="text-slate-300">{pos.cost_net_asset_value.toFixed(4)}</span>
                            </div>
                            <div>
                              <span>净值日期：</span>
                              <span className="text-slate-300">{pos.net_asset_value_day || "-"}</span>
                            </div>
                          </div>
                        )}
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
          </div>
        ))}
      </div>
    </div>
  );
}

