import React, { createContext, useContext } from 'react';
import type { PlanTier } from '../types/domain';

export type AccessPlan = 'FREE' | 'PRO' | 'MAX';

export interface PlanContextValue {
  /** Единый уровень доступа в приложении: FREE | PRO | MAX */
  plan: AccessPlan;
  /** Нижний регистр для совместимости с доменными типами */
  planTier: PlanTier;
  maxMultiplier: 10 | 20;
  isPro: boolean;
  isMax: boolean;
  isDemoOverride: boolean;
  privacyMode: boolean;
  /** Маскирует денежные суммы при включённом Privacy Mode */
  maskValue: (formatted: string) => string;
  /** Мгновенное переключение демо-тарифа без перезагрузки */
  setDemoPlan: (plan: AccessPlan | null, maxMultiplier?: 10 | 20) => void;
  /** Открытие модального окна подписок VERNIER */
  openUpgradeModal: (targetTier?: 'pro' | 'max', maxMultiplier?: 10 | 20) => void;
}

const PlanContext = createContext<PlanContextValue>({
  plan: 'FREE',
  planTier: 'free',
  maxMultiplier: 10,
  isPro: false,
  isMax: false,
  isDemoOverride: false,
  privacyMode: false,
  maskValue: (v) => v,
  setDemoPlan: () => undefined,
  openUpgradeModal: () => undefined,
});

export const PlanProvider: React.FC<{
  value: PlanContextValue;
  children: React.ReactNode;
}> = ({ value, children }) => {
  return <PlanContext.Provider value={value}>{children}</PlanContext.Provider>;
};

export function usePlan(): PlanContextValue {
  return useContext(PlanContext);
}

export function planTierToAccessPlan(tier: PlanTier): AccessPlan {
  if (tier === 'max') return 'MAX';
  if (tier === 'pro') return 'PRO';
  return 'FREE';
}

export function accessPlanToPlanTier(plan: AccessPlan): PlanTier {
  if (plan === 'MAX') return 'max';
  if (plan === 'PRO') return 'pro';
  return 'free';
}
