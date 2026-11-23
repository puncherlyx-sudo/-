import { useCallback, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  CREDIT_COSTS,
  FREE_DAILY_SIGNAL_LIMIT,
  FREE_MAX_LEVERAGE,
  FREE_WEEKLY_QUOTA,
  PRO_MONTHLY_QUOTA,
  STRATEGY_CATALOG,
  countTodayStrategySignals,
  getActivePlanTier,
  getCreditQuotaForProfile,
  getTierDisplayName,
  isMaxOnlyStrategy,
  isMaxSubscriptionActive,
  isProOnlyStrategy,
  isProSubscriptionActive,
} from '../data/strategies';
import { auth, db, googleProvider, handleFirestoreError, isFirestoreOfflineError } from '../lib/firebase';
import {
  OperationType,
  type AnalysisRecord,
  type AnalysisResultPayload,
  type ExchangeId,
  type ExchangeKeyPermissions,
  type ExchangeKeyRecord,
  type ExchangeOrderResult,
  type ExchangeSyncResult,
  type MarketType,
  type PlanTier,
  type PortfolioTargetRecord,
  type PriceAlertCondition,
  type PriceAlertRecord,
  type PushSubscriptionRecord,
  type SecurityAuditLog,
  type SessionDeviceType,
  type StrategyConfig,
  type SupportTicketCategory,
  type SupportTicketRecord,
  type UserPrivateSecurity,
  type UserProfile,
  type UserSessionRecord,
} from '../types/domain';
import { playAlertChime } from '../lib/alertSound';
import { authFetch } from '../lib/authFetch';
import { ExchangeSyncClientError } from '../lib/exchangeSyncErrorLog';
import {
  buildCachedExchangeSyncEntry,
  pruneExchangeSyncCache,
  readExchangeSyncCache,
  removeExchangeSyncCacheEntry,
  writeExchangeSyncCacheEntry,
  type ExchangeSyncCacheMap,
} from '../lib/exchangeSyncCache';
import { safeFetchJson } from '../utils/safeFetchJson';

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
  let rand = '';
  if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
    const bytes = new Uint8Array(8);
    window.crypto.getRandomValues(bytes);
    rand = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } else {
    rand = Math.random().toString(36).slice(2, 12);
  }
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
  const clearAuthError = useCallback(() => setAuthError(null), []);

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [privateSecurity, setPrivateSecurity] = useState<UserPrivateSecurity | null>(null);
  const [strategies, setStrategies] = useState<StrategyConfig[]>([]);
  const [analyses, setAnalyses] = useState<AnalysisRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<SecurityAuditLog[]>([]);
  const [pushSubscriptions, setPushSubscriptions] = useState<PushSubscriptionRecord[]>([]);
  const [sessions, setSessions] = useState<UserSessionRecord[]>([]);
  const [priceAlerts, setPriceAlerts] = useState<PriceAlertRecord[]>([]);
  const [supportTickets, setSupportTickets] = useState<SupportTicketRecord[]>([]);
  const [exchangeKeys, setExchangeKeys] = useState<ExchangeKeyRecord[]>([]);
  const [exchangeSyncCache, setExchangeSyncCache] = useState<ExchangeSyncCacheMap>({});
  const [backgroundSyncingKeyIds, setBackgroundSyncingKeyIds] = useState<string[]>([]);
  const [portfolioTargets, setPortfolioTargets] = useState<PortfolioTargetRecord[]>([]);
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
        if (isFirestoreOfflineError(err)) {
          // Временная потеря связи с Firestore: не показываем фатальный баннер,
          // живые onSnapshot-слушатели автоматически подтянут профиль после восстановления сети.
          return;
        }
        handleFirestoreError(err, OperationType.GET, userPath);
      }

      if (!snap.exists()) {
        const displayName = (user.displayName || user.email?.split('@')[0] || 'Trader').slice(0, 120);
        try {
          await setDoc(userRef, {
            uid,
            displayName,
            plan: 'free',
            creditsRemaining: FREE_WEEKLY_QUOTA,
            weeklyQuota: FREE_WEEKLY_QUOTA,
            nextResetAt: nextWeekIso(),
            twoFactorEnabled: false,
            autoLockMinutes: 15,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          if (isFirestoreOfflineError(err)) return;
          handleFirestoreError(err, OperationType.CREATE, userPath);
        }

        const privPath = `users/${uid}/private/security`;
        try {
          await setDoc(doc(db, 'users', uid, 'private', 'security'), {
            uid,
            email: (user.email || 'user@vernier-terminal.app').slice(0, 200),
            totpEncryptedSecret: '',
            totpPendingSecret: '',
            backupCodeHashes: [],
            last2faVerifiedAt: '',
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          if (!isFirestoreOfflineError(err)) {
            handleFirestoreError(err, OperationType.CREATE, privPath);
          }
        }

        // Seed default Spot & Futures strategies (Free plan starts with leverage capped at FREE_MAX_LEVERAGE)
        for (const tpl of STRATEGY_CATALOG) {
          const stratId = sanitizeId(`strat_${tpl.key}`);
          const stratPath = `users/${uid}/strategies/${stratId}`;
          const initialLeverage =
            tpl.marketType === 'spot' ? 1 : Math.min(FREE_MAX_LEVERAGE, tpl.defaultLeverage);
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
              leverage: initialLeverage,
              pairs: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          } catch (err) {
            if (!isFirestoreOfflineError(err)) {
              handleFirestoreError(err, OperationType.CREATE, stratPath);
            }
          }
        }

        await writeAuditLog(
          uid,
          'ACCOUNT_INIT',
          `Создан профиль и начислены ${FREE_WEEKLY_QUOTA} еженедельных кредитов.`,
          'SUCCESS'
        );
      } else {
        const data = snap.data() as UserProfile;
        const isExistingPro = isProSubscriptionActive(data);

        // Обновление квот, еженедельный сброс и проверка подписки выполняются строго на сервере (/api/entitlements/me)
        try {
          const entRes = await authFetch('/api/entitlements/me');
          if (entRes.ok) {
            const entData = (await entRes.json()) as {
              entitlements?: {
                creditsRemaining?: number;
                weeklyQuota?: number;
                nextResetAt?: number;
                plan?: 'free' | 'pro' | 'max';
              };
            };
            if (entData.entitlements) {
              setProfile((prev) =>
                prev
                  ? {
                      ...prev,
                      creditsRemaining:
                        typeof entData.entitlements?.creditsRemaining === 'number'
                          ? entData.entitlements.creditsRemaining
                          : prev.creditsRemaining,
                      weeklyQuota:
                        typeof entData.entitlements?.weeklyQuota === 'number'
                          ? entData.entitlements.weeklyQuota
                          : prev.weeklyQuota,
                    }
                  : prev
              );
            }
          }
        } catch {
          // Неблокирующая синхронизация квот
        }

        // Backfill newly added catalog strategies for existing accounts (per-item resilient)
        try {
          const existingStratsSnap = await getDocs(
            query(collection(db, 'users', uid, 'strategies'), where('userId', '==', uid))
          );
          const existingKeys = new Set(
            existingStratsSnap.docs.map((d) => (d.data() as StrategyConfig).strategyKey)
          );
          for (const tpl of STRATEGY_CATALOG) {
            if (existingKeys.has(tpl.key)) continue;
            const stratId = sanitizeId(`strat_${tpl.key}`);
            const initialLeverage =
              tpl.marketType === 'spot'
                ? 1
                : isExistingPro
                  ? tpl.defaultLeverage
                  : Math.min(FREE_MAX_LEVERAGE, tpl.defaultLeverage);
            try {
              await setDoc(doc(db, 'users', uid, 'strategies', stratId), {
                id: stratId,
                userId: uid,
                marketType: tpl.marketType,
                strategyKey: tpl.key,
                name: tpl.name.slice(0, 120),
                enabled: false,
                dailySignalLimit: 1,
                minConfidence: 70,
                riskPerTradePct: tpl.defaultRiskPct,
                leverage: initialLeverage,
                pairs: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              });
            } catch {
              // Skip individual backfill failures without blocking the session
            }
          }
        } catch {
          // Non-blocking: existing strategies remain available via onSnapshot
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
        setSupportTickets([]);
        setExchangeKeys([]);
        setExchangeSyncCache({});
        setBackgroundSyncingKeyIds([]);
        setPortfolioTargets([]);
        setIsLocked(false);
        selfSignOutRef.current = false;
      } else {
        // Мгновенно поднимаем локальный кэш балансов/активов бирж до завершения сетевого обновления
        setExchangeSyncCache(readExchangeSyncCache(user.uid));
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
        if (snap.exists()) {
          setProfile(snap.data() as UserProfile);
          setAuthError(null);
        }
      },
      (err) => {
        if (isFirestoreOfflineError(err)) return;
        handleFirestoreError(err, OperationType.GET, `users/${uid}`);
      }
    );

    const unsubPrivate = onSnapshot(
      doc(db, 'users', uid, 'private', 'security'),
      (snap) => {
        if (snap.exists()) setPrivateSecurity(snap.data() as UserPrivateSecurity);
      },
      (err) => {
        if (isFirestoreOfflineError(err)) return;
        handleFirestoreError(err, OperationType.GET, `users/${uid}/private/security`);
      }
    );

    const stratQuery = query(collection(db, 'users', uid, 'strategies'), where('userId', '==', uid));
    const unsubStrategies = onSnapshot(
      stratQuery,
      (snap) => {
        setStrategies(snap.docs.map((d) => d.data() as StrategyConfig));
      },
      (err) => {
        if (isFirestoreOfflineError(err)) return;
        handleFirestoreError(err, OperationType.LIST, `users/${uid}/strategies`);
      }
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
      (err) => {
        if (isFirestoreOfflineError(err)) return;
        handleFirestoreError(err, OperationType.LIST, `users/${uid}/analyses`);
      }
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
      (err) => {
        if (isFirestoreOfflineError(err)) return;
        handleFirestoreError(err, OperationType.LIST, `users/${uid}/auditLogs`);
      }
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
      (err) => {
        if (isFirestoreOfflineError(err)) return;
        handleFirestoreError(err, OperationType.LIST, `users/${uid}/pushSubscriptions`);
      }
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
      (err) => {
        if (isFirestoreOfflineError(err)) return;
        handleFirestoreError(err, OperationType.LIST, `users/${uid}/sessions`);
      }
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
      (err) => {
        if (isFirestoreOfflineError(err)) return;
        handleFirestoreError(err, OperationType.LIST, `users/${uid}/priceAlerts`);
      }
    );

    const supportQuery = query(
      collection(db, 'users', uid, 'supportTickets'),
      where('userId', '==', uid),
      limit(20)
    );
    const unsubSupport = onSnapshot(
      supportQuery,
      (snap) => {
        const docs = snap.docs.map((d) => d.data() as SupportTicketRecord);
        docs.sort((a, b) => {
          const tsA = (a.createdAt as { seconds?: number } | undefined)?.seconds ?? 0;
          const tsB = (b.createdAt as { seconds?: number } | undefined)?.seconds ?? 0;
          return tsB - tsA;
        });
        setSupportTickets(docs);
      },
      (err) => {
        if (isFirestoreOfflineError(err)) return;
        handleFirestoreError(err, OperationType.LIST, `users/${uid}/supportTickets`);
      }
    );

    const exchangeKeysQuery = query(
      collection(db, 'users', uid, 'exchangeKeys'),
      where('userId', '==', uid),
      limit(15)
    );
    const unsubExchangeKeys = onSnapshot(
      exchangeKeysQuery,
      (snap) => {
        const docs = snap.docs.map((d) => d.data() as ExchangeKeyRecord);
        docs.sort((a, b) => {
          const tsA = (a.createdAt as { seconds?: number } | undefined)?.seconds ?? 0;
          const tsB = (b.createdAt as { seconds?: number } | undefined)?.seconds ?? 0;
          return tsB - tsA;
        });
        setExchangeKeys(docs);
        setExchangeSyncCache(pruneExchangeSyncCache(uid, docs.map((d) => d.id)));
      },
      (err) => {
        if (isFirestoreOfflineError(err)) return;
        handleFirestoreError(err, OperationType.LIST, `users/${uid}/exchangeKeys`);
      }
    );

    const portfolioTargetsQuery = query(
      collection(db, 'users', uid, 'portfolioTargets'),
      where('userId', '==', uid),
      limit(20)
    );
    const unsubPortfolioTargets = onSnapshot(
      portfolioTargetsQuery,
      (snap) => {
        const docs = snap.docs.map((d) => d.data() as PortfolioTargetRecord);
        docs.sort((a, b) => {
          if (a.active !== b.active) return a.active ? -1 : 1;
          const tsA = (a.updatedAt as { seconds?: number } | undefined)?.seconds ?? 0;
          const tsB = (b.updatedAt as { seconds?: number } | undefined)?.seconds ?? 0;
          return tsB - tsA;
        });
        setPortfolioTargets(docs);
      },
      (err) => {
        if (isFirestoreOfflineError(err)) return;
        handleFirestoreError(err, OperationType.LIST, `users/${uid}/portfolioTargets`);
      }
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
      unsubSupport();
      unsubExchangeKeys();
      unsubPortfolioTargets();
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

  const consumeCredits = useCallback(
    async (amount: number, auditReason?: string): Promise<boolean> => {
      if (!firebaseUser || !profile) return false;
      const activeTier = getActivePlanTier(profile);
      const activePro = activeTier === 'pro' || activeTier === 'max';
      const tierLabel = getTierDisplayName(activeTier);
      const quota = getCreditQuotaForProfile(profile);
      const cost = Math.max(1, Math.round(amount));

      if (profile.creditsRemaining < cost) {
        throw new Error(
          activePro
            ? `Недостаточно кредитов (нужно ${cost}, доступно ${profile.creditsRemaining}/${quota}). Продлите ${tierLabel}, чтобы начислить ещё ${quota} кредитов.`
            : `Недостаточно кредитов (нужно ${cost}, доступно ${profile.creditsRemaining}/${quota}). Перейдите на PRO (${PRO_MONTHLY_QUOTA} кр./мес.) или MAX (1 000–2 000 кр./мес.).`
        );
      }

      const uid = firebaseUser.uid;
      // Атомарное списание выполняется строго на сервере (server/entitlements.ts)
      const res = await authFetch('/api/entitlements/consume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'strategy_scan' }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        entitlements?: { creditsRemaining?: number; weeklyQuota?: number };
      };
      if (!res.ok) {
        throw new Error(payload.error || 'Не удалось списать кредиты на сервере.');
      }
      if (typeof payload.entitlements?.creditsRemaining === 'number') {
        const nextCredits = payload.entitlements.creditsRemaining;
        setProfile((prev) => (prev ? { ...prev, creditsRemaining: nextCredits } : prev));
      }
      if (auditReason) {
        await writeAuditLog(uid, 'CREDITS_SPENT', `${auditReason} (−${cost} кр.)`, 'SUCCESS');
      }
      return true;
    },
    [firebaseUser, profile, writeAuditLog]
  );

  const consumeCreditAndSaveAnalysis = async (params: {
    symbol: string;
    marketType: MarketType;
    timeframe: string;
    strategyKey: string;
    strategyName: string;
    creditCost?: number;
    result: AnalysisResultPayload;
  }) => {
    if (!firebaseUser || !profile) return;
    const uid = firebaseUser.uid;
    const activeTier = getActivePlanTier(profile);
    const activePro = activeTier === 'pro' || activeTier === 'max';
    const tierLabel = getTierDisplayName(activeTier);
    const quota = getCreditQuotaForProfile(profile);
    const cost = Math.max(
      1,
      Math.round(
        params.creditCost ??
          (params.marketType === 'futures' ? CREDIT_COSTS.futuresAnalysis : CREDIT_COSTS.spotAnalysis)
      )
    );

    if (!activePro) {
      const usedToday = countTodayStrategySignals(analyses, params.strategyKey);
      if (usedToday >= FREE_DAILY_SIGNAL_LIMIT) {
        throw new Error(
          `Достигнут дневной лимит Free (${FREE_DAILY_SIGNAL_LIMIT}/день) для «${params.strategyName}». Перейдите на PRO или MAX для снятия дневных ограничений.`
        );
      }
    }

    if (profile.creditsRemaining < cost) {
      throw new Error(
        activePro
          ? `Недостаточно кредитов ${tierLabel} (нужно ${cost}, осталось ${profile.creditsRemaining}/${quota}). Продлите подписку для пополнения квоты.`
          : `Недостаточно кредитов (нужно ${cost}, осталось ${profile.creditsRemaining}/${quota}). Перейдите на PRO или MAX.`
      );
    }

    // Списание кредитов уже выполнено атомарно на сервере при вызове /api/analyze;
    // синхронизируем актуальный баланс из /api/entitlements/me (без запрещённого updateDoc из клиента).
    try {
      const entRes = await authFetch('/api/entitlements/me');
      if (entRes.ok) {
        const entData = (await entRes.json()) as {
          entitlements?: { creditsRemaining?: number };
        };
        if (typeof entData.entitlements?.creditsRemaining === 'number') {
          const nextCredits = entData.entitlements.creditsRemaining;
          setProfile((prev) => (prev ? { ...prev, creditsRemaining: nextCredits } : prev));
        }
      }
    } catch {
      // Non-blocking UI credit refresh
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
    const activePro = isProSubscriptionActive(profile);
    const activeMax = isMaxSubscriptionActive(profile);
    const matched = strategies.find((s) => s.id === strategyId);
    const strategyKey = matched?.strategyKey || strategyId.replace(/^strat_/, '');
    const catalogTpl = STRATEGY_CATALOG.find((t) => t.key === strategyKey);
    if (!activeMax && isMaxOnlyStrategy(strategyKey)) {
      throw new Error('Эта стратегия открывается только в активной подписке MAX.');
    }
    if (!activePro && isProOnlyStrategy(strategyKey)) {
      throw new Error('Эта стратегия открывается только в активной подписке PRO или MAX.');
    }

    const cappedLimit = activePro
      ? Math.min(100, Math.max(0, Math.round(updates.dailySignalLimit)))
      : FREE_DAILY_SIGNAL_LIMIT;
    const maxLev = activePro ? 20 : FREE_MAX_LEVERAGE;
    const resolvedMarketType: MarketType =
      matched?.marketType ?? catalogTpl?.marketType ?? 'spot';
    const cappedLeverage =
      resolvedMarketType === 'spot'
        ? 1
        : Math.min(maxLev, Math.max(1, Math.round(updates.leverage)));
    const safePairs =
      Array.isArray(updates.pairs) && updates.pairs.length > 0
        ? updates.pairs.slice(0, 10)
        : ['BTCUSDT'];
    const safeMinConfidence = Math.min(95, Math.max(50, Math.round(updates.minConfidence)));
    const safeRiskPct = Math.min(10, Math.max(0.25, Number(updates.riskPerTradePct) || 1));

    const stratRef = doc(db, 'users', uid, 'strategies', strategyId);
    const path = `users/${uid}/strategies/${strategyId}`;
    try {
      if (matched) {
        await updateDoc(stratRef, {
          enabled: updates.enabled,
          dailySignalLimit: cappedLimit,
          minConfidence: safeMinConfidence,
          riskPerTradePct: safeRiskPct,
          leverage: cappedLeverage,
          pairs: safePairs,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(stratRef, {
          id: strategyId,
          userId: uid,
          marketType: resolvedMarketType,
          strategyKey: strategyKey.slice(0, 64),
          name: (catalogTpl?.name ?? strategyKey).slice(0, 120),
          enabled: updates.enabled,
          dailySignalLimit: cappedLimit,
          minConfidence: safeMinConfidence,
          riskPerTradePct: safeRiskPct,
          leverage: cappedLeverage,
          pairs: safePairs,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      await writeAuditLog(
        uid,
        'STRATEGY_UPDATED',
        `Обновлена стратегия ${strategyId}: ${
          cappedLimit === 0 ? 'без лимита сигналов/день (PRO)' : `лимит ${cappedLimit} сигн./день`
        }, плечо ${cappedLeverage}x, риск ${safeRiskPct}%.`,
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
      // Audit G1: синхронизируем отключение 2FA с сервером (требует активный step-up)
      try {
        const res = await authFetch('/api/security/totp/disable', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        if (!res.ok) {
          const errPayload = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
          if (res.status === 403 || res.status === 401) {
            throw new Error(errPayload.error || 'Требуется подтверждение 2FA для отключения защиты.');
          }
        }
      } catch (serverErr) {
        if (serverErr instanceof Error && serverErr.message.includes('2FA')) {
          throw serverErr;
        }
      }

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
      notifyVolatilitySpikes: boolean;
      volatilityThresholdPct: number;
      notifyPortfolioPnl: boolean;
      portfolioPnlThresholdPct: number;
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
        notifyVolatilitySpikes: params.notifyVolatilitySpikes,
        volatilityThresholdPct: Math.max(1, Math.min(25, Number(params.volatilityThresholdPct) || 5)),
        notifyPortfolioPnl: params.notifyPortfolioPnl,
        portfolioPnlThresholdPct: Math.max(1, Math.min(50, Number(params.portfolioPnlThresholdPct) || 5)),
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
      // Audit I2: параллельно отзываем refresh-токены через серверный эндпоинт (best-effort)
      void authFetch('/api/security/revoke-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }).catch(() => undefined);

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
      playAlertChime();
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
        const res = await authFetch('/api/push/price-alerts/sync', {
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
    const res = await authFetch('/api/push/price-alerts/check', {
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

  const createSupportTicket = useCallback(
    async (params: {
      contactEmail: string;
      category: SupportTicketCategory;
      subject: string;
      message: string;
    }): Promise<string> => {
      const cleanEmail = params.contactEmail.trim().slice(0, 200);
      const cleanSubject = params.subject.trim().slice(0, 140);
      const cleanMessage = params.message.trim().slice(0, 2000);
      if (cleanEmail.length < 3 || !cleanEmail.includes('@')) {
        throw new Error('Укажите корректный email для обратной связи.');
      }
      if (cleanSubject.length < 3) {
        throw new Error('Укажите тему обращения (минимум 3 символа).');
      }
      if (cleanMessage.length < 10) {
        throw new Error('Опишите вопрос подробнее (минимум 10 символов).');
      }

      if (firebaseUser) {
        const uid = firebaseUser.uid;
        const ticketId = sanitizeId(`sup_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
        const path = `users/${uid}/supportTickets/${ticketId}`;
        try {
          await setDoc(doc(db, 'users', uid, 'supportTickets', ticketId), {
            id: ticketId,
            userId: uid,
            contactEmail: cleanEmail,
            category: params.category,
            subject: cleanSubject,
            message: cleanMessage,
            status: 'open',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          await writeAuditLog(
            uid,
            'SUPPORT_TICKET_CREATED',
            `Создано обращение в поддержку (${ticketId}): ${cleanSubject.slice(0, 80)}.`,
            'SUCCESS'
          );
          return ticketId;
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, path);
        }
      }

      const result = await safeFetchJson<{ ticketId?: string; error?: string }>('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactEmail: cleanEmail,
          category: params.category,
          subject: cleanSubject,
          message: cleanMessage,
        }),
        timeoutMs: 12000,
      });
      if (!result.ok || !result.data?.ticketId) {
        throw new Error(result.errorMessage || 'Не удалось отправить обращение в поддержку.');
      }
      return result.data.ticketId;
    },
    [firebaseUser, writeAuditLog]
  );

  const connectExchangeKey = useCallback(
    async (params: {
      exchange: ExchangeId;
      label: string;
      apiKey: string;
      apiSecret: string;
      passphrase?: string;
      permissions: ExchangeKeyPermissions;
      testnet: boolean;
    }): Promise<{ key: ExchangeKeyRecord; sync: ExchangeSyncResult }> => {
      if (!firebaseUser) {
        throw new Error('Авторизуйтесь для подключения биржи.');
      }
      const uid = firebaseUser.uid;
      const cleanLabel = params.label.trim().slice(0, 64);
      if (cleanLabel.length < 2) {
        throw new Error('Укажите название подключения (минимум 2 символа).');
      }

      const res = await authFetch('/api/exchanges/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exchange: params.exchange,
          label: cleanLabel,
          apiKey: params.apiKey,
          apiSecret: params.apiSecret,
          passphrase: params.passphrase || '',
          permissions: params.permissions,
          testnet: params.testnet,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        apiKeyPreview?: string;
        encryptedApiKey?: string;
        encryptedApiSecret?: string;
        encryptedPassphrase?: string;
        sync?: ExchangeSyncResult;
      };
      if (!res.ok || !data.encryptedApiKey || !data.encryptedApiSecret || !data.apiKeyPreview || !data.sync) {
        throw new Error(data.error || 'Не удалось проверить API-ключ на бирже.');
      }

      const keyId = sanitizeId(`exk_${params.exchange}_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`);
      const path = `users/${uid}/exchangeKeys/${keyId}`;
      const record: ExchangeKeyRecord = {
        id: keyId,
        userId: uid,
        exchange: params.exchange,
        label: cleanLabel,
        apiKeyPreview: data.apiKeyPreview.slice(0, 24),
        encryptedApiKey: data.encryptedApiKey,
        encryptedApiSecret: data.encryptedApiSecret,
        encryptedPassphrase: data.encryptedPassphrase || '',
        permissions: params.permissions,
        testnet: params.testnet,
        enabled: true,
        lastSyncedAt: data.sync.syncedAt.slice(0, 64),
        lastBalanceUsdt: Math.max(0, Math.min(1_000_000_000, Number(data.sync.totalBalanceUsdt) || 0)),
        lastSyncError: '',
      };

      try {
        await setDoc(doc(db, 'users', uid, 'exchangeKeys', keyId), {
          ...record,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        await writeAuditLog(
          uid,
          'EXCHANGE_CONNECTED',
          `Подключён API-ключ ${params.exchange.toUpperCase()} (${cleanLabel}, ${params.permissions === 'trade' ? 'торговля' : 'чтение'}).`,
          'SUCCESS'
        );
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, path);
      }

      setExchangeSyncCache(
        writeExchangeSyncCacheEntry(
          uid,
          buildCachedExchangeSyncEntry({
            keyId,
            label: cleanLabel,
            testnet: params.testnet,
            sync: data.sync,
          })
        )
      );

      return { key: record, sync: data.sync };
    },
    [firebaseUser, writeAuditLog]
  );

  const updateExchangeKey = useCallback(
    async (
      existingKey: ExchangeKeyRecord,
      params: {
        label: string;
        apiKey: string;
        apiSecret: string;
        passphrase?: string;
        permissions: ExchangeKeyPermissions;
        testnet: boolean;
      }
    ): Promise<{ key: ExchangeKeyRecord; sync: ExchangeSyncResult }> => {
      if (!firebaseUser) {
        throw new Error('Авторизуйтесь для редактирования API-ключа.');
      }
      const uid = firebaseUser.uid;
      const cleanLabel = params.label.trim().slice(0, 64);
      if (cleanLabel.length < 2) {
        throw new Error('Укажите название подключения (минимум 2 символа).');
      }

      const res = await authFetch('/api/exchanges/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exchange: existingKey.exchange,
          label: cleanLabel,
          apiKey: params.apiKey,
          apiSecret: params.apiSecret,
          passphrase: params.passphrase || '',
          permissions: params.permissions,
          testnet: params.testnet,
        }),
      });
      const rawBodyText = await res.text();
      let data: {
        ok?: boolean;
        error?: string;
        details?: { httpStatus?: number; endpoint?: string; rawResponse?: string };
        apiKeyPreview?: string;
        encryptedApiKey?: string;
        encryptedApiSecret?: string;
        encryptedPassphrase?: string;
        sync?: ExchangeSyncResult;
      } = {};
      try {
        data = rawBodyText ? (JSON.parse(rawBodyText) as typeof data) : {};
      } catch {
        data = {};
      }
      if (!res.ok || !data.encryptedApiKey || !data.encryptedApiSecret || !data.apiKeyPreview || !data.sync) {
        const errMsg = data.error || 'Не удалось проверить обновлённый API-ключ на бирже.';
        throw new ExchangeSyncClientError(errMsg, {
          httpStatus: data.details?.httpStatus ?? res.status,
          endpoint: data.details?.endpoint ?? 'POST /api/exchanges/connect',
          rawApiResponse:
            data.details?.rawResponse ??
            (rawBodyText.trim() || JSON.stringify({ status: res.status, error: errMsg }, null, 2)),
        });
      }

      const updatedRecord: ExchangeKeyRecord = {
        ...existingKey,
        label: cleanLabel,
        apiKeyPreview: data.apiKeyPreview.slice(0, 24),
        encryptedApiKey: data.encryptedApiKey,
        encryptedApiSecret: data.encryptedApiSecret,
        encryptedPassphrase: data.encryptedPassphrase || '',
        permissions: params.permissions,
        testnet: params.testnet,
        enabled: true,
        lastSyncedAt: data.sync.syncedAt.slice(0, 64),
        lastBalanceUsdt: Math.max(0, Math.min(1_000_000_000, Number(data.sync.totalBalanceUsdt) || 0)),
        lastSyncError: '',
      };

      const path = `users/${uid}/exchangeKeys/${existingKey.id}`;
      try {
        await updateDoc(doc(db, 'users', uid, 'exchangeKeys', existingKey.id), {
          label: updatedRecord.label,
          apiKeyPreview: updatedRecord.apiKeyPreview,
          encryptedApiKey: updatedRecord.encryptedApiKey,
          encryptedApiSecret: updatedRecord.encryptedApiSecret,
          encryptedPassphrase: updatedRecord.encryptedPassphrase,
          permissions: updatedRecord.permissions,
          testnet: updatedRecord.testnet,
          enabled: true,
          lastSyncedAt: updatedRecord.lastSyncedAt,
          lastBalanceUsdt: updatedRecord.lastBalanceUsdt,
          lastSyncError: '',
          updatedAt: serverTimestamp(),
        });
        await writeAuditLog(
          uid,
          'EXCHANGE_UPDATED',
          `Обновлён API-ключ ${existingKey.exchange.toUpperCase()} (${cleanLabel}, ${params.permissions === 'trade' ? 'торговля' : 'чтение'}).`,
          'SUCCESS'
        );
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, path);
      }

      setExchangeSyncCache(
        writeExchangeSyncCacheEntry(
          uid,
          buildCachedExchangeSyncEntry({
            keyId: existingKey.id,
            label: cleanLabel,
            testnet: params.testnet,
            sync: data.sync,
          })
        )
      );

      return { key: updatedRecord, sync: data.sync };
    },
    [firebaseUser, writeAuditLog]
  );

  const syncExchangeKey = useCallback(
    async (
      keyRecord: ExchangeKeyRecord,
      options?: { silent?: boolean; background?: boolean }
    ): Promise<ExchangeSyncResult> => {
      if (!firebaseUser) {
        throw new Error('Авторизуйтесь для синхронизации биржи.');
      }
      const uid = firebaseUser.uid;
      const path = `users/${uid}/exchangeKeys/${keyRecord.id}`;
      const isBackground = Boolean(options?.background);
      const isSilent = Boolean(options?.silent);

      if (isBackground) {
        setBackgroundSyncingKeyIds((prev) =>
          prev.includes(keyRecord.id) ? prev : [...prev, keyRecord.id]
        );
      }

      try {
        const res = await authFetch('/api/exchanges/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            exchange: keyRecord.exchange,
            encryptedApiKey: keyRecord.encryptedApiKey,
            encryptedApiSecret: keyRecord.encryptedApiSecret,
            encryptedPassphrase: keyRecord.encryptedPassphrase,
            testnet: keyRecord.testnet,
          }),
        });
        const rawBodyText = await res.text();
        let data: {
          ok?: boolean;
          error?: string;
          details?: { httpStatus?: number; endpoint?: string; rawResponse?: string };
          sync?: ExchangeSyncResult;
        } = {};
        try {
          data = rawBodyText ? (JSON.parse(rawBodyText) as typeof data) : {};
        } catch {
          data = {};
        }

        if (!res.ok || !data.sync) {
          const errMsg = (data.error || 'Ошибка синхронизации с биржей.').slice(0, 240);
          if (!isSilent || (res.status >= 400 && res.status < 500)) {
            try {
              await updateDoc(doc(db, 'users', uid, 'exchangeKeys', keyRecord.id), {
                lastSyncError: errMsg,
                updatedAt: serverTimestamp(),
              });
            } catch (err) {
              if (!isSilent) {
                handleFirestoreError(err, OperationType.UPDATE, path);
              }
            }
          }
          throw new ExchangeSyncClientError(errMsg, {
            httpStatus: data.details?.httpStatus ?? res.status,
            endpoint: data.details?.endpoint ?? 'POST /api/exchanges/sync',
            rawApiResponse:
              data.details?.rawResponse ??
              (rawBodyText.trim() || JSON.stringify({ status: res.status, error: errMsg }, null, 2)),
          });
        }

        // Обновляем локальный кэш сразу после ответа биржи
        setExchangeSyncCache(
          writeExchangeSyncCacheEntry(
            uid,
            buildCachedExchangeSyncEntry({
              keyId: keyRecord.id,
              label: keyRecord.label,
              testnet: keyRecord.testnet,
              sync: data.sync,
            })
          )
        );

        try {
          await updateDoc(doc(db, 'users', uid, 'exchangeKeys', keyRecord.id), {
            lastSyncedAt: data.sync.syncedAt.slice(0, 64),
            lastBalanceUsdt: Math.max(0, Math.min(1_000_000_000, Number(data.sync.totalBalanceUsdt) || 0)),
            lastSyncError: '',
            updatedAt: serverTimestamp(),
          });
          if (!isSilent) {
            await writeAuditLog(
              uid,
              'EXCHANGE_SYNCED',
              `Синхронизирован баланс ${keyRecord.exchange.toUpperCase()} (${keyRecord.label}): $${data.sync.totalBalanceUsdt.toFixed(2)}.`,
              'SUCCESS'
            );
          }
        } catch (err) {
          if (!isSilent) {
            handleFirestoreError(err, OperationType.UPDATE, path);
          }
        }

        return data.sync;
      } finally {
        if (isBackground) {
          setBackgroundSyncingKeyIds((prev) => prev.filter((id) => id !== keyRecord.id));
        }
      }
    },
    [firebaseUser, writeAuditLog]
  );

  const toggleExchangeKey = useCallback(
    async (keyId: string, nextEnabled: boolean) => {
      if (!firebaseUser) return;
      const uid = firebaseUser.uid;
      const path = `users/${uid}/exchangeKeys/${keyId}`;
      try {
        await updateDoc(doc(db, 'users', uid, 'exchangeKeys', keyId), {
          enabled: nextEnabled,
          updatedAt: serverTimestamp(),
        });
        await writeAuditLog(
          uid,
          nextEnabled ? 'EXCHANGE_RESUMED' : 'EXCHANGE_PAUSED',
          nextEnabled ? `Интеграция биржи ${keyId} включена.` : `Интеграция биржи ${keyId} поставлена на паузу.`,
          'SUCCESS'
        );
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, path);
      }
    },
    [firebaseUser, writeAuditLog]
  );

  const deleteExchangeKey = useCallback(
    async (keyId: string) => {
      if (!firebaseUser) return;
      const uid = firebaseUser.uid;
      const path = `users/${uid}/exchangeKeys/${keyId}`;
      try {
        await deleteDoc(doc(db, 'users', uid, 'exchangeKeys', keyId));
        setExchangeSyncCache(removeExchangeSyncCacheEntry(uid, keyId));
        await writeAuditLog(uid, 'EXCHANGE_DISCONNECTED', `Удалён API-ключ биржи ${keyId}.`, 'WARNING');
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, path);
      }
    },
    [firebaseUser, writeAuditLog]
  );

  const placeExchangeOrder = useCallback(
    async (
      keyRecord: ExchangeKeyRecord,
      orderParams: {
        symbol: string;
        marketType: MarketType;
        side: 'BUY' | 'SELL';
        orderType: 'MARKET' | 'LIMIT';
        quantity: number;
        limitPrice?: number;
        stopLoss?: number;
        takeProfit?: number;
      }
    ): Promise<ExchangeOrderResult> => {
      if (!firebaseUser) {
        throw new Error('Авторизуйтесь для исполнения ордеров на бирже.');
      }
      const uid = firebaseUser.uid;
      const res = await authFetch('/api/exchanges/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exchange: keyRecord.exchange,
          encryptedApiKey: keyRecord.encryptedApiKey,
          encryptedApiSecret: keyRecord.encryptedApiSecret,
          encryptedPassphrase: keyRecord.encryptedPassphrase,
          testnet: keyRecord.testnet,
          confirmResponsibility: true,
          confirmStatement: 'VERNIER_API_ORDER_CONFIRMED',
          ...orderParams,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        order?: ExchangeOrderResult;
      };
      if (!res.ok || !data.order) {
        await writeAuditLog(
          uid,
          'EXCHANGE_ORDER_FAILED',
          `Отклонён ордер ${orderParams.side} ${orderParams.symbol} на ${keyRecord.exchange.toUpperCase()}: ${data.error || 'ошибка'}.`,
          'BLOCKED'
        );
        throw new Error(data.error || 'Не удалось исполнить ордер на бирже.');
      }

      await writeAuditLog(
        uid,
        'EXCHANGE_ORDER_SUBMITTED',
        `Исполнен ${orderParams.orderType} ордер ${orderParams.side} ${orderParams.quantity} ${orderParams.symbol} на ${keyRecord.exchange.toUpperCase()} (#${data.order.orderId}).`,
        'SUCCESS'
      );
      return data.order;
    },
    [firebaseUser, writeAuditLog]
  );

  const upsertPortfolioTarget = useCallback(
    async (params: {
      portfolioId: string;
      portfolioLabel: string;
      targetBalanceUsdt: number;
      baselineBalanceUsdt: number;
      targetPnlPct: number;
    }) => {
      if (!firebaseUser) {
        throw new Error('Войдите в аккаунт, чтобы синхронизировать цель доходности.');
      }
      const uid = firebaseUser.uid;
      const targetId = sanitizeId(params.portfolioId || 'manual') || 'manual';
      const cleanLabel = params.portfolioLabel.trim().slice(0, 80) || 'Портфель';
      const targetBalanceUsdt = Math.max(0.01, Math.min(1_000_000_000, Number(params.targetBalanceUsdt)));
      const baselineBalanceUsdt = Math.max(0, Math.min(1_000_000_000, Number(params.baselineBalanceUsdt) || 0));
      const targetPnlPct = Math.max(-99, Math.min(10000, Number(params.targetPnlPct) || 0));

      const docRef = doc(db, 'users', uid, 'portfolioTargets', targetId);
      const path = `users/${uid}/portfolioTargets/${targetId}`;
      try {
        const snap = await getDoc(docRef);
        if (snap.exists()) {
          await updateDoc(docRef, {
            portfolioLabel: cleanLabel,
            targetBalanceUsdt,
            baselineBalanceUsdt,
            targetPnlPct,
            active: true,
            triggeredAt: '',
            triggeredBalanceUsdt: 0,
            updatedAt: serverTimestamp(),
          });
        } else {
          await setDoc(docRef, {
            id: targetId,
            userId: uid,
            portfolioId: targetId,
            portfolioLabel: cleanLabel,
            targetBalanceUsdt,
            baselineBalanceUsdt,
            targetPnlPct,
            active: true,
            triggeredAt: '',
            triggeredBalanceUsdt: 0,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
        await writeAuditLog(
          uid,
          'PORTFOLIO_TARGET_SET',
          `Установлена цель доходности для «${cleanLabel}»: $${targetBalanceUsdt.toFixed(2)} (${targetPnlPct >= 0 ? '+' : ''}${targetPnlPct.toFixed(1)}%).`,
          'SUCCESS'
        );
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, path);
      }
    },
    [firebaseUser, writeAuditLog]
  );

  const markPortfolioTargetTriggered = useCallback(
    async (targetId: string, portfolioLabel: string, triggeredBalanceUsdt: number) => {
      if (!firebaseUser || !targetId) return;
      const uid = firebaseUser.uid;
      const cleanId = sanitizeId(targetId);
      const path = `users/${uid}/portfolioTargets/${cleanId}`;
      try {
        await updateDoc(doc(db, 'users', uid, 'portfolioTargets', cleanId), {
          active: false,
          triggeredAt: new Date().toISOString().slice(0, 64),
          triggeredBalanceUsdt: Math.max(0, Math.min(1_000_000_000, Number(triggeredBalanceUsdt) || 0)),
          updatedAt: serverTimestamp(),
        });
        await writeAuditLog(
          uid,
          'PORTFOLIO_TARGET_REACHED',
          `Портфель «${portfolioLabel}» достиг целевого баланса $${triggeredBalanceUsdt.toFixed(2)}.`,
          'SUCCESS'
        );
      } catch {
        // Ignore if concurrently deleted
      }
    },
    [firebaseUser, writeAuditLog]
  );

  const deletePortfolioTarget = useCallback(
    async (targetId: string) => {
      if (!firebaseUser || !targetId) return;
      const uid = firebaseUser.uid;
      const cleanId = sanitizeId(targetId);
      const path = `users/${uid}/portfolioTargets/${cleanId}`;
      try {
        await deleteDoc(doc(db, 'users', uid, 'portfolioTargets', cleanId));
        await writeAuditLog(
          uid,
          'PORTFOLIO_TARGET_DELETED',
          `Удалена цель доходности для портфеля ${cleanId}.`,
          'WARNING'
        );
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
    clearAuthError,
    profile,
    privateSecurity,
    strategies,
    analyses,
    auditLogs,
    pushSubscriptions,
    sessions,
    priceAlerts,
    supportTickets,
    exchangeKeys,
    exchangeSyncCache,
    backgroundSyncingKeyIds,
    portfolioTargets,
    currentSessionId,
    isLocked,
    setIsLocked,
    loginWithGoogle,
    logout,
    consumeCredits,
    consumeCreditAndSaveAnalysis,
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
    createSupportTicket,
    connectExchangeKey,
    updateExchangeKey,
    syncExchangeKey,
    toggleExchangeKey,
    deleteExchangeKey,
    placeExchangeOrder,
    upsertPortfolioTarget,
    markPortfolioTargetTriggered,
    deletePortfolioTarget,
    writeAuditLog,
  };
}
