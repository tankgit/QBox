import { ReactNode } from "react";

interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  size?: "md" | "lg";
}

export function Dialog({ open, title, onClose, children, size = "md" }: DialogProps) {
  if (!open) return null;
  const sizeClass = size === "lg" ? "max-w-5xl" : "max-w-2xl";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-soft px-6 py-12">
      <div className={`glass-panel border border-white/10 rounded-3xl ${sizeClass} w-full p-8 relative max-h-[85vh] overflow-y-auto shadow-[0_35px_85px_rgba(15,23,42,0.65)]`}>
        <button
          className="absolute top-4 right-4 text-slate-400 hover:text-white transition"
          type="button"
          onClick={onClose}
        >
          ✕
        </button>
        <h2 className="text-xl font-semibold mb-6">{title}</h2>
        {children}
      </div>
    </div>
  );
}

