import React from 'react';

/** Заглушка на время подгрузки экрана: те же карточки-скелетоны с бегущим бликом, что и при загрузке данных. */
export const ViewFallback: React.FC = () => (
  <div className="space-y-3" role="status" aria-label="Загрузка раздела">
    <div className="h-28 rounded-2xl border border-white/8 bg-[#111827] animate-pulse" />
    <div className="h-48 rounded-2xl border border-white/8 bg-[#111827] animate-pulse" />
    <div className="h-36 rounded-2xl border border-white/8 bg-[#111827] animate-pulse" />
  </div>
);
