import { useCallback, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { STRATEGY_CATALOG } from '../data/strategies';
import { auth, db, googleProvider, handleFirestoreError } from '../lib/firebase';
import {
  OperationType,
  type AnalysisRecord,
  type AnalysisResultPayload,
  type MarketType,
  type PlanTier,
  type PriceAlertCondition,
  type PriceAlertRecord,
  type PushSubscriptionRecord,
  type SecurityAuditLog,
  type SessionDeviceType,
  type StrategyConfig,
  type UserPrivateSecurity,
  type UserProfile,
  type UserSessionRecord,
} from '../types/domain';

function nextWeekIso(): string {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
}

function getDeviceLabel(): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/android/i.test(ua)) return 'Android Mobile PWA';
  if (/iphone|ipad/i.test(ua)) return 'iOS Mobile Safari';
  if (/mac/i.test(ua)) return 'macOS Terminal';
  if (/win/i.test(ua)) return 'Windows Terminal';
  return 'Linux / Web Terminal';
}

function sanitizeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
}

function hashEndpointToSubId(endpoint: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < endpoint.length; i += 1) {
    const c = endpoint.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= c + i;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return `push_${(h1 >>> 0).toString(36)}_${(h2 >>> 0).toString(36)}`.slice(0, 60);
}

const SESSION_STORAGE_KEY = 'aegisquant_session_id';

function createFreshSessionId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return sanitizeId(`sess_${ts}_${rand}`);
}

function getOrCreateLocalSessionId(): string {
  if (typeof window === 'undefined') return createFreshSessionId();
  try {
    const existing = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (existing && /^[a-zA-Z0-9_-]{8,64}$/.test(existing)) {
      return existing;
    }
    const created = createFreshSessionId();
    window.localStorage.setItem(SESSION_STORAGE_KEY, created);
    return created;
  } catch {
    return createFreshSessionId();
  }
}

function rotateLocalSessionId(): string {
  const fresh = createFreshSessionId();
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(SESSION_STORAGE_KEY, fresh);
    } catch {
      // Non-fatal in private mode
    }
  }
  return fresh;
}

function detectSessionMetadata(): {
  deviceLabel: string;
  deviceType: SessionDeviceType;
  browserLabel: string;
} {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isStandalone =
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(display-mode: standalone)').matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true);

  const isMobileUa = /android|iphone|ipad|ipod|mobile/i.test(ua);
  const deviceType: SessionDeviceType = isStandalone ? 'pwa' : isMobileUa ? 'mobile' : 'desktop';

  let browserLabel = 'Веб-браузер';
  if (isStandalone) browserLabel = 'Установленное PWA';
  else if (/edg/i.test(ua)) browserLabel = 'Microsoft Edge';
  else if (/chrome|crios/i.test(ua)) browserLabel = isMobileUa ? 'Chrome Mobile' : 'Google Chrome';
  else if (/firefox|fxios/i.test(ua)) browserLabel = 'Mozilla Firefox';
  else if (/safari/i.test(ua)) browserLabel = 'Safari';

  return {
    deviceLabel: getDeviceLabel().slice(0, 120),
    deviceType,
    browserLabel: browserLabel.slice(0, 80),
  };
}

export function useAuthAndVault() {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [privateSecurity, setPrivateSecurity] = useState<UserPrivateSecurity | null>(null);
  const [strategies, setStrategies] = useState<StrategyConfig[]>([]);
  const [analyses, setAnalyses] = useState<AnalysisRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<SecurityAuditLog[]>([]);
  const [pushSubscriptions, setPushSubscriptions] = useState<PushSubscriptionRecord[]>([]);
  const [sessions, setSessions] = useState<UserSessionRecord[]>([]);
  const [priceAlerts, setPriceAlerts] = useState<PriceAlertRecord[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>(() => getOrCreateLocalSessionId());

  const [isLocked, setIsLocked] = useState(false);
  const lastActivityRef = useRef<number>(Date.now());
  const explicitLoginRef = useRef<boolean>(false);
  const selfSignOutRef = useRef<boolean>(false);

  const writeAuditLog = useCallback(
    async (
      uid: string,
      eventType: string,
      description: string,
      status: 'SUCCESS' | 'BLOCKED' | 'WARNING' = 'SUCCESS'
    ) => {
      const logId = sanitizeId(`log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
      const path = `users/${uid}/auditLogs`;
      try {
        await setDoc(doc(db, path, logId), {
          id: logId,
          userId: uid,
          eventType: eventType.slice(0, 64),
          description: description.slice(0, 300),
          deviceLabel: getDeviceLabel().slice(0, 120),
          status,
          createdAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `${path}/${logId}`);
      }
    },
    []
  );

  // Initialize user documents on first login + verify weekly free credit reset
  const bootstrapUserAccount = useCallback(
    async (user: User) => {
      const uid = user.uid;
      const userPath = `users/${uid}`;
      const userRef = doc(db, 'users', uid);

      let snap;
      try {
        snap = await getDoc(userRef);
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, userPath);
      }

      if (!snap.exists()) {
        const displayName = (user.displayName || user.email?.split('@')[0] || 'Trader').slice(0, 120);
        try {
          await setDoc(userRef, {
            uid,
            displayName,
            plan: 'free',
            creditsRemaining: 10,
            weeklyQuota: 10,
            nextResetAt: nextWeekIso(),
            twoFactorEnabled: false,
            autoLockMinutes: 15,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, userPath);
        }

        const privPath = `users/${uid}/private/security`;
        try {
          await setDoc(doc(db, 'users', uid, 'private', 'security'), {
            uid,
            email: (user.email || 'user@aegisquant.app').slice(0, 200),
            totpEncryptedSecret: '',
            totpPendingSecret: '',
            backupCodeHashes: [],
            last2faVerifiedAt: '',
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, privPath);
        }

        // Seed default Spot & Futures strategies
        for (const tpl of STRATEGY_CATALOG) {
          const stratId = sanitizeId(`strat_${tpl.key}`);
          const stratPath = `users/${uid}/strategies/${stratId}`;
          try {
            await setDoc(doc(db, 'users', uid, 'strategies', stratId), {
              id: stratId,
              userId: uid,
              marketType: tpl.marketType,
              strategyKey: tpl.key,
              name: tpl.name.slice(0, 120),
              enabled: tpl.key === 'spot_trend_breakout' || tpl.key === 'futures_momentum_atr',
              dailySignalLimit: 1,
              minConfidence: 70,
              riskPerTradePct: tpl.defaultRiskPct,
              leverage: tpl.defaultLeverage,
              pairs: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          } catch (err) {
            handleFirestoreError(err, OperationType.CREATE, stratPath);
          }
        }

        await writeAuditLog(uid, 'ACCOUNT_INIT', 'Создан профиль и начислены 10 еженедельных кредитов.', 'SUCCESS');
      } else {
        const data = snap.data() as UserProfile;
        if (data.plan === 'free' && data.nextResetAt && Date.now() >= new Date(data.nextResetAt).getTime()) {
          try {
            await updateDoc(userRef, {
              creditsRemaining: 10,
              nextResetAt: nextWeekIso(),
              updatedAt: serverTimestamp(),
            });
            await writeAuditLog(uid, 'WEEKLY_CREDIT_RESET', 'Еженедельное пополнение квоты: 10 кредитов.', 'SUCCESS');
          } catch (err) {
            handleFirestoreError(err, OperationType.UPDATE, userPath);
          }
        }
      }

      // Resolve current IP geolocation for security session map
      let geoFields = {
        ipAddress: 'Определяется',
        city: 'Неизвестно',
        country: 'Не определена',
        countryCode: 'XX',
        latitude: 51.5074,
        longitude: -0.1278,
      };
      try {
        const geoRes = await fetch('/api/security/session-geo');
        if (geoRes.ok) {
          const geoJson = (await geoRes.json()) as {
            ipAddress?: string;
            city?: string;
            country?: string;
            countryCode?: string;
            latitude?: number;
            longitude?: number;
          };
          geoFields = {
            ipAddress: String(geoJson.ipAddress || 'Не определён').slice(0, 64),
            city: String(geoJson.city || 'Неизвестно').slice(0, 80),
            country: String(geoJson.country || 'Не определена').slice(0, 80),
            countryCode: String(geoJson.countryCode || 'XX').slice(0, 8),
            latitude: typeof geoJson.latitude === 'number' ? geoJson.latitude : 51.5074,
            longitude: typeof geoJson.longitude === 'number' ? geoJson.longitude : -0.1278,
          };
        }
      } catch {
        // Non-blocking fallback if geo endpoint is momentarily unavailable
      }

      // Register or refresh current device session record
      let sid = getOrCreateLocalSessionId();
      const sessionMeta = detectSessionMetadata();
      const isExplicitLogin = explicitLoginRef.current;
      explicitLoginRef.current = false;

      try {
        const existingSessionSnap = await getDoc(doc(db, 'users', uid, 'sessions', sid));
        if (existingSessionSnap.exists()) {
          const existingData = existingSessionSnap.data() as UserSessionRecord;
          if (existingData.status === 'revoked') {
            sid = rotateLocalSessionId();
            setCurrentSessionId(sid);
            await setDoc(doc(db, 'users', uid, 'sessions', sid), {
              id: sid,
              userId: uid,
              ...sessionMeta,
              ...geoFields,
              isSuspicious: false,
              status: 'active',
              lastLoginAt: serverTimestamp(),
              lastActiveAt: serverTimestamp(),
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          } else {
            setCurrentSessionId(sid);
            await updateDoc(doc(db, 'users', uid, 'sessions', sid), {
              ...sessionMeta,
              ...geoFields,
              ...(isExplicitLogin ? { lastLoginAt: serverTimestamp() } : {}),
              lastActiveAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
        } else {
          setCurrentSessionId(sid);
          await setDoc(doc(db, 'users', uid, 'sessions', sid), {
            id: sid,
            userId: uid,
            ...sessionMeta,
            ...geoFields,
            isSuspicious: false,
            status: 'active',
            lastLoginAt: serverTimestamp(),
            lastActiveAt: serverTimestamp(),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `users/${uid}/sessions/${sid}`);
      }
    },
    [writeAuditLog]
  );

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      setAuthReady(true);
      if (!user) {
        setProfile(null);
        setPrivateSecurity(null);
        setStrategies([]);
        setAnalyses([]);
        setAuditLogs([]);
        setPushSubscriptions([]);
        setSessions([]);
        setPriceAlerts([]);
        setIsLocked(false);
        selfSignOutRef.current = false;
      } else {
        void bootstrapUserAccount(user).catch((err) => {
          setAuthError(err instanceof Error ? err.message : 'Ошибка инициализации профиля');
        });
      }
    });
    return () => unsub();
  }, [bootstrapUserAccount]);

  // Real-time Firestore listeners once authenticated
  useEffect(() => {
    if (!authReady || !firebaseUser) return;
    const uid = firebaseUser.uid;

    const unsubProfile = onSnapshot(
      doc(db, 'users', uid),
      (snap) => {
        if (snap.exists()) setProfile(snap.data() as UserProfile);
      },
      (err) => handleFirestoreError(err, OperationType.GET, `users/${uid}`)
    );

    const unsubPrivate = onSnapshot(
      doc(db, 'users', uid, 'private', 'security'),
      (snap) => {
        if (snap.exists()) setPrivateSecurity(snap.data() as UserPrivateSecurity);
      },
      (err) => handleFirestoreError(err, OperationType.GET, `users/${uid}/private/security`)
    );

    const stratQuery = query(collection(db, 'users', uid, 'strategies'), where('userId', '==', uid));
    const unsubStrategies = onSnapshot(
      stratQuery,
      (snap) => {
        setStrategies(snap.docs.map((d) => d.data() as StrategyConfig));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `users/${uid}/strategies`)
    );

    const analysisQuery = query(
      collection(db, 'users', uid, 'analyses'),
      where('userId', '==', uid),
      limit(30)
    );
    const unsubAnalyses = onSnapshot(
      analysisQuery,
      (snap) => {
        const docs = snap.docs.map((d) => d.data() as AnalysisRecord);
        docs.sort((a, b) => {
          const tsA = (a.createdAt as { seconds?: number } | undefined)?.seconds ?? 0;
          const tsB = (b.createdAt as { seconds?: number } | undefined)?.seconds ?? 0;
          return tsB - tsA;
        });
        setAnalyses(docs.slice(0, 15));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `users/${uid}/analyses`)
    );

    const logQuery = query(
      collection(db, 'users', uid, 'auditLogs'),
      where('userId', '==', uid),
      limit(100)
    );
    const unsubLogs = onSnapshot(
      logQuery,
      (snap) => {
        const docs = snap.docs.map((d) => d.data() as SecurityAuditLog);
        docs.sort((a, b) => {
          const tsA = (a.createdAt as { seconds?: number } | undefined)?.seconds ?? 0;
          const tsB = (b.createdAt as { seconds?: number } | undefined)?.seconds ?? 0;
          return tsB - tsA;
        });
        setAuditLogs(docs.slice(0, 100));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `users/${uid}/auditLogs`)
    );

    const pushQuery = query(
      collection(db, 'users', uid, 'pushSubscriptions'),
      where('userId', '==', uid),
      limit(10)
    );
    const unsubPush = onSnapshot(
      pushQuery,
      (snap) => {
        setPushSubscriptions(snap.docs.map((d) => d.data() as PushSubscriptionRecord));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `users/${uid}/pushSubscriptions`)
    );

    const sessionQuery = query(
      collection(db, 'users', uid, 'sessions'),
      where('userId', '==', uid),
      limit(25)
    );
    const unsubSessions = onSnapshot(
      sessionQuery,
      (snap) => {
        const docs = snap.docs.map((d) => d.data() as UserSessionRecord);
        const activeSid = getOrCreateLocalSessionId();
        const mine = docs.find((s) => s.id === activeSid);
        if (mine && mine.status === 'revoked' && !selfSignOutRef.current) {
          selfSignOutRef.current = true;
          const nextSid = rotateLocalSessionId();
          setCurrentSessionId(nextSid);
          setAuthError('Текущая сессия была завершена с другого устройства. Выполните повторный вход.');
          void signOut(auth);
          return;
        }

        docs.sort((a, b) => {
          if (a.id === activeSid) return -1;
          if (b.id === activeSid) return 1;
          if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
          const tsA = (a.lastLoginAt as { seconds?: number } | undefined)?.seconds ?? 0;
          const tsB = (b.lastLoginAt as { seconds?: number } | undefined)?.seconds ?? 0;
          return tsB - tsA;
        });
        setSessions(docs);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `users/${uid}/sessions`)
    );

    const priceAlertsQuery = query(
      collection(db, 'users', uid, 'priceAlerts'),
      where('userId', '==', uid),
      limit(30)
    );
    const unsubPriceAlerts = onSnapshot(
      priceAlertsQuery,
      (snap) => {
        const docs = snap.docs.map((d) => d.data() as PriceAlertRecord);
        docs.sort((a, b) => {
          if (a.active !== b.active) return a.active ? -1 : 1;
          const tsA = (a.createdAt as { seconds?: number } | undefined)?.seconds ?? 0;
          const tsB = (b.createdAt as { seconds?: number } | undefined)?.seconds ?? 0;
          return tsB - tsA;
        });
        setPriceAlerts(docs);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `users/${uid}/priceAlerts`)
    );

    return () => {
      unsubProfile();
      unsubPrivate();
      unsubStrategies();
      unsubAnalyses();
      unsubLogs();
      unsubPush();
      unsubSessions();
      unsubPriceAlerts();
    };
  }, [authReady, firebaseUser]);

  // Idle auto-lock watcher when 2FA is active
  useEffect(() => {
    if (!profile?.twoFactorEnabled) return;

    const bumpActivity = () => {
      lastActivityRef.current = Date.now();
    };
    window.addEventListener('pointerdown', bumpActivity);
    window.addEventListener('keydown', bumpActivity);

    const timer = setInterval(() => {
      const limitMs = (profile.autoLockMinutes || 15) * 60 * 1000;
      if (Date.now() - lastActivityRef.current > limitMs) {
        setIsLocked(true);
      }
    }, 15_000);

    return () => {
      clearInterval(timer);
      window.removeEventListener('pointerdown', bumpActivity);
      window.removeEventListener('keydown', bumpActivity);
    };
  }, [profile?.twoFactorEnabled, profile?.autoLockMinutes]);

  const loginWithGoogle = async (): Promise<string | null> => {
    setAuthError(null);
    explicitLoginRef.current = true;
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      if (cred.user) {
        await bootstrapUserAccount(cred.user);
        await writeAuditLog(cred.user.uid, 'LOGIN_SUCCESS', 'Успешный вход через Google OAuth.', 'SUCCESS');
        return cred.user.uid;
      }
      explicitLoginRef.current = false;
      return null;
    } catch (err) {
      explicitLoginRef.current = false;
      setAuthError(err instanceof Error ? err.message : 'Не удалось выполнить вход');
      return null;
    }
  };

  const logout = async () => {
    selfSignOutRef.current = true;
    if (firebaseUser) {
      const uid = firebaseUser.uid;
      const activeSid = getOrCreateLocalSessionId();
      const mine = sessions.find((s) => s.id === activeSid);
      if (mine && mine.status === 'active') {
        try {
          await updateDoc(doc(db, 'users', uid, 'sessions', activeSid), {
            status: 'revoked',
            updatedAt: serverTimestamp(),
          });
        } catch {
          // Non-blocking session close during logout
        }
      }
      await writeAuditLog(uid, 'LOGOUT', 'Завершение сессии пользователем.', 'SUCCESS');
    }
    const freshSid = rotateLocalSessionId();
    setCurrentSessionId(freshSid);
    await signOut(auth);
  };

  const consumeCreditAndSaveAnalysis = async (params: {
    symbol: string;
    marketType: MarketType;
    timeframe: string;
    strategyKey: string;
    strategyName: string;
    result: AnalysisResultPayload;
  }) => {
    if (!firebaseUser || !profile) return;
    const uid = firebaseUser.uid;
    if (profile.plan === 'free') {
      if (profile.creditsRemaining <= 0) {
        throw new Error('Еженедельные кредиты исчерпаны. Перейдите на PRO или дождитесь сброса квоты.');
      }
      try {
        await updateDoc(doc(db, 'users', uid), {
          creditsRemaining: Math.max(0, profile.creditsRemaining - 1),
          nextResetAt: profile.nextResetAt,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `users/${uid}`);
      }
    }

    const analysisId = sanitizeId(`an_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
    const path = `users/${uid}/analyses/${analysisId}`;
    try {
      await setDoc(doc(db, 'users', uid, 'analyses', analysisId), {
        id: analysisId,
        userId: uid,
        symbol: params.symbol.slice(0, 24),
        marketType: params.marketType,
        timeframe: params.timeframe.slice(0, 12),
        strategyKey: params.strategyKey.slice(0, 64),
        strategyName: params.strategyName.slice(0, 120),
        direction: params.result.direction,
        confidence: Math.round(params.result.confidence),
        entryZone: params.result.entryZone.slice(0, 80),
        stopLoss: params.result.stopLoss.slice(0, 40),
        takeProfits: params.result.takeProfits.slice(0, 3).map((t) => String(t).slice(0, 40)),
        riskReward: params.result.riskReward.slice(0, 24),
        summary: params.result.summary.slice(0, 2400),
        newsSentiment: params.result.newsSentiment,
        newsSourcesCount: Math.min(50, Math.max(0, params.result.newsSourcesCount)),
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, path);
    }
  };

  const updatePlan = async (targetPlan: PlanTier) => {
    if (!firebaseUser || !profile) return;
    const uid = firebaseUser.uid;
    try {
      await updateDoc(doc(db, 'users', uid), {
        plan: targetPlan,
        creditsRemaining: targetPlan === 'pro' ? 100 : Math.min(10, profile.creditsRemaining),
        updatedAt: serverTimestamp(),
      });
      await writeAuditLog(
        uid,
        'PLAN_CHANGE',
        targetPlan === 'pro' ? 'Активирована подписка PRO (безлимитный анализ и сигналы).' : 'Переход на базовый бесплатный тариф.',
        'SUCCESS'
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${uid}`);
    }
  };

  const updateStrategySettings = async (
    strategyId: string,
    updates: {
      enabled: boolean;
      dailySignalLimit: number;
      minConfidence: number;
      riskPerTradePct: number;
      leverage: number;
      pairs: string[];
    }
  ) => {
    if (!firebaseUser || !profile) return;
    const uid = firebaseUser.uid;
    const cappedLimit = profile.plan === 'pro' ? Math.min(20, Math.max(1, updates.dailySignalLimit)) : 1;
    const path = `users/${uid}/strategies/${strategyId}`;
    try {
      await updateDoc(doc(db, 'users', uid, 'strategies', strategyId), {
        enabled: updates.enabled,
        dailySignalLimit: cappedLimit,
        minConfidence: Math.min(95, Math.max(50, Math.round(updates.minConfidence))),
        riskPerTradePct: Math.min(10, Math.max(0.25, Number(updates.riskPerTradePct))),
        leverage: Math.min(20, Math.max(1, Math.round(updates.leverage))),
        pairs: updates.pairs.slice(0, 10),
        updatedAt: serverTimestamp(),
      });
      await writeAuditLog(
        uid,
        'STRATEGY_UPDATED',
        `Обновлена стратегия ${strategyId}: лимит ${cappedLimit} сигн./день, риск ${updates.riskPerTradePct}%.`,
        'SUCCESS'
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  };

  const savePendingTotp = async (encryptedPendingSecret: string) => {
    if (!firebaseUser) return;
    const uid = firebaseUser.uid;
    const path = `users/${uid}/private/security`;
    try {
      await updateDoc(doc(db, 'users', uid, 'private', 'security'), {
        totpPendingSecret: encryptedPendingSecret.slice(0, 512),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  };

  const activateTotp = async (encryptedSecret: string, backupCodeHashes: string[]) => {
    if (!firebaseUser) return;
    const uid = firebaseUser.uid;
    const nowIso = new Date().toISOString();
    try {
      await updateDoc(doc(db, 'users', uid, 'private', 'security'), {
        totpEncryptedSecret: encryptedSecret.slice(0, 512),
        totpPendingSecret: '',
        backupCodeHashes: backupCodeHashes.slice(0, 8),
        last2faVerifiedAt: nowIso,
        updatedAt: serverTimestamp(),
      });
      await updateDoc(doc(db, 'users', uid), {
        twoFactorEnabled: true,
        autoLockMinutes: profile?.autoLockMinutes || 15,
        updatedAt: serverTimestamp(),
      });
      await writeAuditLog(uid, '2FA_ENABLED', 'Активирована двухфакторная аутентификация TOTP и выпущены резервные коды.', 'SUCCESS');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${uid}`);
    }
  };

  const disableTotp = async () => {
    if (!firebaseUser) return;
    const uid = firebaseUser.uid;
    try {
      await updateDoc(doc(db, 'users', uid, 'private', 'security'), {
        totpEncryptedSecret: '',
        totpPendingSecret: '',
        backupCodeHashes: [],
        last2faVerifiedAt: '',
        updatedAt: serverTimestamp(),
      });
      await updateDoc(doc(db, 'users', uid), {
        twoFactorEnabled: false,
        autoLockMinutes: profile?.autoLockMinutes || 15,
        updatedAt: serverTimestamp(),
      });
      await writeAuditLog(uid, '2FA_DISABLED', 'Двухфакторная аутентификация отключена пользователем.', 'WARNING');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${uid}`);
    }
  };

  const updateAutoLockMinutes = async (minutes: number) => {
    if (!firebaseUser || !profile) return;
    const uid = firebaseUser.uid;
    try {
      await updateDoc(doc(db, 'users', uid), {
        twoFactorEnabled: profile.twoFactorEnabled,
        autoLockMinutes: Math.min(60, Math.max(1, minutes)),
        updatedAt: serverTimestamp(),
      });
      await writeAuditLog(uid, 'AUTOLOCK_UPDATED', `Установлен таймер автоблокировки: ${minutes} мин.`, 'SUCCESS');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${uid}`);
    }
  };

  const record2faVerification = async (consumedBackupHash: string | null) => {
    if (!firebaseUser || !privateSecurity) return;
    const uid = firebaseUser.uid;
    const nowIso = new Date().toISOString();
    try {
      if (consumedBackupHash) {
        const remaining = privateSecurity.backupCodeHashes.filter((h) => h !== consumedBackupHash);
        await updateDoc(doc(db, 'users', uid, 'private', 'security'), {
          backupCodeHashes: remaining,
          last2faVerifiedAt: nowIso,
          updatedAt: serverTimestamp(),
        });
        await writeAuditLog(
          uid,
          '2FA_BACKUP_USED',
          `Использован одноразовый резервный код. Осталось кодов: ${remaining.length}.`,
          'WARNING'
        );
      } else {
        await updateDoc(doc(db, 'users', uid, 'private', 'security'), {
          last2faVerifiedAt: nowIso,
          updatedAt: serverTimestamp(),
        });
      }
      setIsLocked(false);
      lastActivityRef.current = Date.now();
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${uid}/private/security`);
    }
  };

  const savePushSubscriptionRecord = useCallback(
    async (params: {
      endpoint: string;
      p256dh: string;
      auth: string;
      notifySignals: boolean;
      notifyMarketMoves: boolean;
      notifyNews: boolean;
      notifyAuthLogins: boolean;
      notifyStrategyChanges: boolean;
      notifySignalLimits: boolean;
      enabled: boolean;
      logAudit?: boolean;
    }) => {
      if (!firebaseUser) return;
      const uid = firebaseUser.uid;
      const subId = hashEndpointToSubId(params.endpoint);
      const subPath = `users/${uid}/pushSubscriptions/${subId}`;
      const subRef = doc(db, 'users', uid, 'pushSubscriptions', subId);
      const payload = {
        endpoint: params.endpoint.slice(0, 600),
        p256dh: params.p256dh.slice(0, 256),
        auth: params.auth.slice(0, 128),
        notifySignals: params.notifySignals,
        notifyMarketMoves: params.notifyMarketMoves,
        notifyNews: params.notifyNews,
        notifyAuthLogins: params.notifyAuthLogins,
        notifyStrategyChanges: params.notifyStrategyChanges,
        notifySignalLimits: params.notifySignalLimits,
        enabled: params.enabled,
        deviceLabel: getDeviceLabel().slice(0, 120),
        updatedAt: serverTimestamp(),
      };
      try {
        const existingSnap = await getDoc(subRef);
        if (existingSnap.exists()) {
          await updateDoc(subRef, payload);
        } else {
          await setDoc(subRef, {
            id: subId,
            userId: uid,
            ...payload,
            createdAt: serverTimestamp(),
          });
        }
        if (params.logAudit) {
          await writeAuditLog(
            uid,
            params.enabled ? 'PUSH_ENABLED' : 'PUSH_DISABLED',
            params.enabled
              ? 'Включены фоновые Web Push-уведомления для устройства.'
              : 'Фоновые Web Push-уведомления приостановлены пользователем.',
            params.enabled ? 'SUCCESS' : 'WARNING'
          );
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, subPath);
      }
    },
    [firebaseUser, writeAuditLog]
  );

  const deletePushSubscriptionRecord = useCallback(
    async (endpoint: string) => {
      if (!firebaseUser || !endpoint) return;
      const uid = firebaseUser.uid;
      const subId = hashEndpointToSubId(endpoint);
      const subPath = `users/${uid}/pushSubscriptions/${subId}`;
      try {
        await deleteDoc(doc(db, 'users', uid, 'pushSubscriptions', subId));
        await writeAuditLog(
          uid,
          'PUSH_DISABLED',
          'Подписка на фоновые Push-уведомления удалена с устройства.',
          'WARNING'
        );
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, subPath);
      }
    },
    [firebaseUser, writeAuditLog]
  );

  const revokeOtherSessions = useCallback(async (): Promise<number> => {
    if (!firebaseUser) return 0;
    const uid = firebaseUser.uid;
    const targets = sessions.filter((s) => s.status === 'active' && s.id !== currentSessionId);
    if (targets.length === 0) return 0;

    try {
      const batch = writeBatch(db);
      for (const s of targets) {
        batch.update(doc(db, 'users', uid, 'sessions', s.id), {
          status: 'revoked',
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
      await writeAuditLog(
        uid,
        'REVOKE_OTHER_SESSIONS',
        `Завершены все остальные активные сессии (${targets.length}).`,
        'WARNING'
      );
      return targets.length;
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${uid}/sessions`);
      return 0;
    }
  }, [firebaseUser, sessions, currentSessionId, writeAuditLog]);

  const revokeSessionById = useCallback(
    async (sessionId: string) => {
      if (!firebaseUser || !sessionId || sessionId === currentSessionId) return;
      const uid = firebaseUser.uid;
      const target = sessions.find((s) => s.id === sessionId);
      if (!target || target.status !== 'active') return;
      const path = `users/${uid}/sessions/${sessionId}`;
      try {
        await updateDoc(doc(db, 'users', uid, 'sessions', sessionId), {
          status: 'revoked',
          isSuspicious: true,
          updatedAt: serverTimestamp(),
        });
        await writeAuditLog(
          uid,
          'REVOKE_SINGLE_SESSION',
          `Принудительно завершена сессия ${target.deviceLabel} (${target.ipAddress || sessionId}).`,
          'WARNING'
        );
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, path);
      }
    },
    [firebaseUser, currentSessionId, sessions, writeAuditLog]
  );

  const toggleSessionSuspicious = useCallback(
    async (sessionId: string, nextSuspicious: boolean) => {
      if (!firebaseUser || !sessionId) return;
      const uid = firebaseUser.uid;
      const target = sessions.find((s) => s.id === sessionId);
      if (!target || target.status !== 'active') return;
      const path = `users/${uid}/sessions/${sessionId}`;
      try {
        await updateDoc(doc(db, 'users', uid, 'sessions', sessionId), {
          isSuspicious: nextSuspicious,
          updatedAt: serverTimestamp(),
        });
        await writeAuditLog(
          uid,
          nextSuspicious ? 'SESSION_FLAGGED_SUSPICIOUS' : 'SESSION_VERIFIED',
          nextSuspicious
            ? `Сессия ${target.ipAddress || target.deviceLabel} отмечена как подозрительная.`
            : `Вход ${target.ipAddress || target.deviceLabel} подтверждён пользователем.`,
          nextSuspicious ? 'WARNING' : 'SUCCESS'
        );
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, path);
      }
    },
    [firebaseUser, sessions, writeAuditLog]
  );

  const applyServerTriggeredAlerts = useCallback(
    async (
      uid: string,
      triggered: Array<{
        id: string;
        symbol: string;
        triggeredAt: string;
        triggeredPrice: number;
      }>
    ) => {
      if (!triggered || triggered.length === 0) return;
      for (const item of triggered) {
        try {
          await updateDoc(doc(db, 'users', uid, 'priceAlerts', item.id), {
            active: false,
            triggeredAt: item.triggeredAt.slice(0, 64),
            triggeredPrice: Number(item.triggeredPrice),
            updatedAt: serverTimestamp(),
          });
          await writeAuditLog(
            uid,
            'PRICE_ALERT_TRIGGERED',
            `Сработал ценовой алерт ${item.symbol} на отметке $${item.triggeredPrice}.`,
            'SUCCESS'
          );
        } catch {
          // Non-fatal if alert was already deleted or updated concurrently
        }
      }
    },
    [writeAuditLog]
  );

  // Sync user's price alerts to server background monitor & reconcile any background triggers
  useEffect(() => {
    if (!authReady || !firebaseUser) return;
    const uid = firebaseUser.uid;
    let cancelled = false;

    const syncToServer = async () => {
      try {
        const res = await fetch('/api/push/price-alerts/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            uid,
            alerts: priceAlerts.map((a) => ({
              id: a.id,
              symbol: a.symbol,
              marketType: a.marketType,
              condition: a.condition,
              targetPrice: a.targetPrice,
              active: a.active,
              updatedAtMs:
                typeof (a.updatedAt as { seconds?: number } | undefined)?.seconds === 'number'
                  ? ((a.updatedAt as { seconds: number }).seconds * 1000)
                  : undefined,
            })),
          }),
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          triggered?: Array<{
            id: string;
            symbol: string;
            triggeredAt: string;
            triggeredPrice: number;
          }>;
        };
        if (data.triggered && data.triggered.length > 0 && !cancelled) {
          await applyServerTriggeredAlerts(uid, data.triggered);
        }
      } catch {
        // Non-blocking background sync
      }
    };

    void syncToServer();
    return () => {
      cancelled = true;
    };
  }, [authReady, firebaseUser, priceAlerts, applyServerTriggeredAlerts]);

  const checkPriceAlertsNow = useCallback(async (): Promise<{
    checkedAlerts: number;
    alertsSent: number;
    triggeredCount: number;
  }> => {
    if (!firebaseUser) {
      return { checkedAlerts: 0, alertsSent: 0, triggeredCount: 0 };
    }
    const uid = firebaseUser.uid;
    const res = await fetch('/api/push/price-alerts/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid }),
    });
    const data = (await res.json()) as {
      checkedAlerts?: number;
      alertsSent?: number;
      triggered?: Array<{
        id: string;
        symbol: string;
        triggeredAt: string;
        triggeredPrice: number;
      }>;
      error?: string;
    };
    if (!res.ok) {
      throw new Error(data.error || 'Не удалось проверить ценовые алерты.');
    }
    if (data.triggered && data.triggered.length > 0) {
      await applyServerTriggeredAlerts(uid, data.triggered);
    }
    return {
      checkedAlerts: data.checkedAlerts ?? 0,
      alertsSent: data.alertsSent ?? 0,
      triggeredCount: data.triggered?.length ?? 0,
    };
  }, [firebaseUser, applyServerTriggeredAlerts]);

  // Periodically check active price alerts while app is open so Firestore status updates smoothly
  useEffect(() => {
    if (!authReady || !firebaseUser) return;
    if (!priceAlerts.some((a) => a.active)) return;

    const timer = setInterval(() => {
      void checkPriceAlertsNow().catch(() => {
        // Non-blocking periodic check
      });
    }, 45_000);

    return () => clearInterval(timer);
  }, [authReady, firebaseUser, priceAlerts, checkPriceAlertsNow]);

  const createPriceAlert = useCallback(
    async (params: {
      symbol: string;
      marketType: MarketType;
      condition: PriceAlertCondition;
      targetPrice: number;
    }) => {
      if (!firebaseUser) return;
      const uid = firebaseUser.uid;
      const cleanSymbol = params.symbol.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 24);
      const safeTarget = Number(params.targetPrice);
      if (!cleanSymbol || !Number.isFinite(safeTarget) || safeTarget <= 0 || safeTarget > 100_000_000) {
        throw new Error('Укажите корректную пороговую цену больше 0.');
      }

      const alertId = sanitizeId(`pa_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
      const path = `users/${uid}/priceAlerts/${alertId}`;
      try {
        await setDoc(doc(db, 'users', uid, 'priceAlerts', alertId), {
          id: alertId,
          userId: uid,
          symbol: cleanSymbol,
          marketType: params.marketType,
          condition: params.condition,
          targetPrice: safeTarget,
          active: true,
          triggeredAt: '',
          triggeredPrice: 0,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        await writeAuditLog(
          uid,
          'PRICE_ALERT_CREATED',
          `Создан ценовой алерт ${cleanSymbol} (${params.condition === 'above' ? '≥' : '≤'} $${safeTarget}).`,
          'SUCCESS'
        );
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, path);
      }
    },
    [firebaseUser, writeAuditLog]
  );

  const togglePriceAlert = useCallback(
    async (alertId: string, nextActive: boolean) => {
      if (!firebaseUser) return;
      const uid = firebaseUser.uid;
      const path = `users/${uid}/priceAlerts/${alertId}`;
      try {
        await updateDoc(doc(db, 'users', uid, 'priceAlerts', alertId), {
          active: nextActive,
          ...(nextActive ? { triggeredAt: '', triggeredPrice: 0 } : {}),
          updatedAt: serverTimestamp(),
        });
        await writeAuditLog(
          uid,
          nextActive ? 'PRICE_ALERT_RESUMED' : 'PRICE_ALERT_PAUSED',
          nextActive ? `Активирован мониторинг ценового алерта ${alertId}.` : `Приостановлен ценовой алерт ${alertId}.`,
          'SUCCESS'
        );
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, path);
      }
    },
    [firebaseUser, writeAuditLog]
  );

  const deletePriceAlert = useCallback(
    async (alertId: string) => {
      if (!firebaseUser) return;
      const uid = firebaseUser.uid;
      const path = `users/${uid}/priceAlerts/${alertId}`;
      try {
        await deleteDoc(doc(db, 'users', uid, 'priceAlerts', alertId));
        await writeAuditLog(uid, 'PRICE_ALERT_DELETED', `Удалён ценовой алерт ${alertId}.`, 'SUCCESS');
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, path);
      }
    },
    [firebaseUser, writeAuditLog]
  );

  return {
    firebaseUser,
    authReady,
    authError,
    profile,
    privateSecurity,
    strategies,
    analyses,
    auditLogs,
    pushSubscriptions,
    sessions,
    priceAlerts,
    currentSessionId,
    isLocked,
    setIsLocked,
    loginWithGoogle,
    logout,
    consumeCreditAndSaveAnalysis,
    updatePlan,
    updateStrategySettings,
    savePendingTotp,
    activateTotp,
    disableTotp,
    updateAutoLockMinutes,
    record2faVerification,
    savePushSubscriptionRecord,
    deletePushSubscriptionRecord,
    revokeOtherSessions,
    revokeSessionById,
    toggleSessionSuspicious,
    createPriceAlert,
    togglePriceAlert,
    deletePriceAlert,
    checkPriceAlertsNow,
    writeAuditLog,
  };
}
