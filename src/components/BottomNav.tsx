import {
  CalendarClock,
  Home,
  Menu,
  Plus,
  Search
} from 'lucide-react';
import React from 'react';

export type NavTab = 'dashboard' | 'consulta' | 'cadastrar' | 'vencimentos' | 'mais';

interface BottomNavProps {
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  badgeCount?: number;
}

export const BottomNav: React.FC<BottomNavProps> = ({
  activeTab,
  onTabChange,
  badgeCount = 0,
}) => {
  return (
    <nav
      id="app-bottom-nav"
      className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-200 shadow-[0_-4px_20px_rgba(0,0,0,0.06)] pb-[env(safe-area-inset-bottom,0px)]"
    >
      <div className="max-w-lg mx-auto grid grid-cols-5 h-16 px-1">
        {/* 1. Início */}
        <button
          id="nav-tab-dashboard"
          onClick={() => onTabChange('dashboard')}
          className={`flex flex-col items-center justify-center relative transition-all duration-150 active:scale-95 touch-manipulation select-none ${
            activeTab === 'dashboard'
              ? 'text-blue-700 font-black'
              : 'text-gray-400 hover:text-gray-700 font-bold'
          }`}
        >
          {activeTab === 'dashboard' && (
            <div className="absolute top-0 left-3 right-3 h-1 bg-blue-700 rounded-full" />
          )}
          <Home className={`w-5 h-5 mb-1 ${activeTab === 'dashboard' ? 'scale-110 text-blue-700 stroke-[2.5]' : 'stroke-[2]'}`} />
          <span className="text-[10px] tracking-wider leading-none uppercase">Início</span>
        </button>

        {/* 2. Consulta */}
        <button
          id="nav-tab-consulta"
          onClick={() => onTabChange('consulta')}
          className={`flex flex-col items-center justify-center relative transition-all duration-150 active:scale-95 touch-manipulation select-none ${
            activeTab === 'consulta'
              ? 'text-blue-700 font-black'
              : 'text-gray-400 hover:text-gray-700 font-bold'
          }`}
        >
          {activeTab === 'consulta' && (
            <div className="absolute top-0 left-3 right-3 h-1 bg-blue-700 rounded-full" />
          )}
          <Search className={`w-5 h-5 mb-1 ${activeTab === 'consulta' ? 'scale-110 text-blue-700 stroke-[2.5]' : 'stroke-[2]'}`} />
          <span className="text-[10px] tracking-wider leading-none uppercase">Consulta</span>
        </button>

        {/* 3. Cadastrar (Elevated Quick Action Button) */}
        <button
          id="nav-tab-cadastrar"
          onClick={() => onTabChange('cadastrar')}
          className="flex flex-col items-center justify-center -mt-3.5 touch-manipulation select-none group"
        >
          <div className="w-12 h-12 rounded-full bg-blue-700 hover:bg-blue-800 active:bg-blue-950 text-white flex items-center justify-center shadow-lg shadow-blue-700/35 group-active:scale-90 transition-transform">
            <Plus className="w-6 h-6 text-white stroke-[3]" />
          </div>
          <span className="text-[9px] tracking-wider leading-none uppercase font-black text-gray-800 mt-1">
            Cadastrar
          </span>
        </button>

        {/* 4. Validades / Vencimentos */}
        <button
          id="nav-tab-vencimentos"
          onClick={() => onTabChange('vencimentos')}
          className={`flex flex-col items-center justify-center relative transition-all duration-150 active:scale-95 touch-manipulation select-none ${
            activeTab === 'vencimentos'
              ? 'text-blue-700 font-black'
              : 'text-gray-400 hover:text-gray-700 font-bold'
          }`}
        >
          {activeTab === 'vencimentos' && (
            <div className="absolute top-0 left-3 right-3 h-1 bg-blue-700 rounded-full" />
          )}
          <div className="relative mb-1">
            <CalendarClock className={`w-5 h-5 ${activeTab === 'vencimentos' ? 'scale-110 text-blue-700 stroke-[2.5]' : 'stroke-[2]'}`} />
            {badgeCount > 0 && (
              <span className="absolute -top-1.5 -right-2.5 min-w-[18px] h-[18px] px-1 rounded-full text-[9px] font-black flex items-center justify-center leading-none text-white bg-red-600 shadow-xs">
                {badgeCount > 99 ? '99+' : badgeCount}
              </span>
            )}
          </div>
          <span className="text-[10px] tracking-wider leading-none uppercase">Validades</span>
        </button>

        {/* 5. Mais */}
        <button
          id="nav-tab-mais"
          onClick={() => onTabChange('mais')}
          className={`flex flex-col items-center justify-center relative transition-all duration-150 active:scale-95 touch-manipulation select-none ${
            activeTab === 'mais'
              ? 'text-blue-700 font-black'
              : 'text-gray-400 hover:text-gray-700 font-bold'
          }`}
        >
          {activeTab === 'mais' && (
            <div className="absolute top-0 left-3 right-3 h-1 bg-blue-700 rounded-full" />
          )}
          <Menu className={`w-5 h-5 mb-1 ${activeTab === 'mais' ? 'scale-110 text-blue-700 stroke-[2.5]' : 'stroke-[2]'}`} />
          <span className="text-[10px] tracking-wider leading-none uppercase">Mais</span>
        </button>
      </div>
    </nav>
  );
};
