import React, { useState } from 'react';
import { Download, LayoutGrid, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC<{
  compact?: boolean;
  onOpenWidgets?: () => void;
}> = ({ compact = false, onOpenWidgets }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  const handleAction = async () => {
    if (isInstallable) {
      await install();
    } else {
      setShowGuide(true);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleAction}
        className={`inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 transition-colors whitespace-nowrap shrink-0 min-h-[40px] ${
          compact ? 'px-3 py-1.5 text-xs font-medium' : 'px-4 py-2 text-sm font-medium'
        }`}
      >
        {isInstallable ? <Download className="w-4 h-4 shrink-0" /> : <Smartphone className="w-4 h-4 shrink-0" />}
        <span>{isInstallable ? 'Установить на Android' : 'Установить PWA'}</span>
      </button>

      {showGuide && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#111827] p-6 shadow-2xl">
            <div className="flex items-center justify-between gap-4">
              <h3 className="text-lg font-semibold text-white">Установка AegisQuant на смартфон</h3>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-white/5"
                aria-label="Закрыть"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {isIOS ? (
              <div className="mt-4 space-y-3 text-sm text-slate-300">
                <p>1. Нажмите кнопку <strong className="text-white">Поделиться</strong> в нижней панели Safari.</p>
                <p>2. Прокрутите вниз и выберите <strong className="text-white">На экран «Домой»</strong>.</p>
                <p>3. Подтвердите добавление — терминал откроется как отдельное приложение.</p>
              </div>
            ) : (
              <div className="mt-4 space-y-3 text-sm text-slate-300">
                <p>1. Откройте меню браузера <strong className="text-white">Chrome на Android</strong> (три точки в правом верхнем углу).</p>
                <p>2. Нажмите <strong className="text-white">Установить приложение</strong> или <strong className="text-white">Добавить на главный экран</strong>.</p>
                <p>3. При удерживании иконки на рабочем столе появятся быстрые ярлыки виджетов: График, Цена, Позиция, Доходность и Стратегии.</p>
              </div>
            )}

            <div className="mt-6 flex flex-col sm:flex-row gap-2.5">
              {onOpenWidgets && (
                <button
                  type="button"
                  onClick={() => {
                    setShowGuide(false);
                    onOpenWidgets();
                  }}
                  className="flex-1 min-h-[44px] px-3 rounded-xl border border-emerald-500/40 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-200 text-sm font-medium inline-flex items-center justify-center gap-2 transition-colors"
                >
                  <LayoutGrid className="w-4 h-4 shrink-0" />
                  <span>Виджеты Android</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="flex-1 min-h-[44px] rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-colors"
              >
                Понятно
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
