import {
  AlertCircle,
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Send
} from 'lucide-react';
import React from 'react';
import { StatusVencimento } from '../types';

interface StatusBadgeProps {
  status: StatusVencimento;
  size?: 'sm' | 'md' | 'lg';
  showIcon?: boolean;
  className?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  size = 'md',
  showIcon = true,
  className = '',
}) => {
  let bg = 'bg-slate-100 text-slate-800 border-slate-300';
  let icon = <CheckCircle2 className="w-3.5 h-3.5" />;
  let label = 'NORMAL';

  switch (status) {
    case 'CRITICO':
      bg = 'bg-red-100 text-red-700 border-red-200 font-black';
      icon = <AlertCircle className="w-3.5 h-3.5 text-red-600 stroke-[2.5]" />;
      label = 'CRÍTICO';
      break;
    case 'ALERTA':
      bg = 'bg-amber-100 text-amber-800 border-amber-300 font-black';
      icon = <AlertTriangle className="w-3.5 h-3.5 text-amber-700 stroke-[2.5]" />;
      label = 'ALERTA';
      break;
    case 'ATENCAO':
      bg = 'bg-yellow-100 text-yellow-800 border-yellow-300 font-bold';
      icon = <Clock className="w-3.5 h-3.5 text-yellow-700 stroke-[2.5]" />;
      label = 'ATENÇÃO';
      break;
    case 'SAIDA_INSUFICIENTE':
      bg = 'bg-orange-100 text-orange-800 border-orange-300 font-black';
      icon = <ArrowUpRight className="w-3.5 h-3.5 text-orange-700 stroke-[2.5]" />;
      label = 'SAÍDA INSUFICIENTE';
      break;
    case 'ENVIAR_AO_COMPRADOR':
      bg = 'bg-orange-100 text-orange-950 border-orange-300 font-black';
      icon = <AlertTriangle className="w-3.5 h-3.5 text-orange-700 stroke-[2.5]" />;
      label = 'CRÍTICO (COMPRADOR)';
      break;
    case 'NORMAL':
    default:
      bg = 'bg-emerald-100 text-emerald-800 border-emerald-200 font-bold';
      icon = <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 stroke-[2.5]" />;
      label = 'NORMAL';
      break;
  }

  const sizeClasses = {
    sm: 'px-2 py-0.5 text-[10px] gap-1',
    md: 'px-2.5 py-1 text-[11px] gap-1.5',
    lg: 'px-3.5 py-1.5 text-xs gap-2',
  };

  return (
    <span
      id={`badge-${status.toLowerCase()}`}
      className={`inline-flex items-center rounded-full border uppercase tracking-wider whitespace-nowrap leading-none ${sizeClasses[size]} ${bg} ${className}`}
    >
      {showIcon && icon}
      <span>{label}</span>
    </span>
  );
};
