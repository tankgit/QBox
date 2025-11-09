import { useQuery } from "@tanstack/react-query";
import api from "../api/client";

interface StrategyParameter {
  name: string;
  description: string;
  parameter_type: string;
  default: unknown;
  minimum?: number;
  maximum?: number;
}

interface StrategyMetadata {
  strategy_id: string;
  name: string;
  description: string;
  parameters: StrategyParameter[];
}

export function StrategyManagementPage() {
  const { data } = useQuery({
    queryKey: ["strategies"],
    queryFn: async () => {
      const response = await api.get<StrategyMetadata[]>("/strategies");
      return response.data;
    }
  });

  const strategies = data ?? [];

  return (
    <div className="space-y-10">
      <header>
        <h2 className="text-3xl font-semibold">策略管理</h2>
        <p className="text-slate-400 mt-2">统一管理策略库，浏览策略逻辑与参数说明。</p>
      </header>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {strategies.map((strategy) => (
          <div key={strategy.strategy_id} className="glass-panel p-8 rounded-3xl border border-white/5 card-hover space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xl font-semibold tracking-wide">{strategy.name}</h3>
                <p className="text-slate-500 text-sm mt-2">{strategy.strategy_id}</p>
              </div>
              <span className="status-chip bg-blue-500/20 text-blue-200">内置</span>
            </div>
            <p className="text-slate-300 leading-relaxed">{strategy.description}</p>
            <div className="space-y-3">
              <h4 className="text-sm uppercase tracking-widest text-slate-400">参数</h4>
              {strategy.parameters.map((param) => (
                <div key={param.name} className="bg-slate-900/50 rounded-2xl p-4 border border-white/5">
                  <p className="text-sm font-medium text-slate-200">{param.name}</p>
                  <p className="text-xs text-slate-400 mt-1">{param.description}</p>
                  <p className="text-xs text-slate-500 mt-2">
                    类型：{param.parameter_type} · 默认值：{String(param.default)}
                    {param.minimum !== undefined && ` · 最小值：${param.minimum}`}
                    {param.maximum !== undefined && ` · 最大值：${param.maximum}`}
                  </p>
                </div>
              ))}
            </div>
          </div>
        ))}
        {strategies.length === 0 && <div className="text-slate-500">暂无可用策略。</div>}
      </div>
    </div>
  );
}

