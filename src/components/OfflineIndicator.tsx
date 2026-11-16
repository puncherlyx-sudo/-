import React from 'react';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="fixed bottom-20 md:bottom-5 left-4 z-50 flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-950/90 px-3.5 py-2 text-xs font-medium text-amber-200 shadow-lg backdrop-blur-md">
      <WifiOff className="w-4 h-4 text-amber-400 shrink-0" />
      <span>Автономный режим — доступны кэшированные графики и стратегии</span>
    </div>
  );
};
