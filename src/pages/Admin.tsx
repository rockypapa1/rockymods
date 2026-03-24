import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Shield, Plus, Trash2, Key, Clock, CheckCircle2, XCircle, LogOut, Link as LinkIcon, Save, Loader2, Activity, TrendingUp, Users, Zap, Search, Filter, Download } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from 'recharts';
import { format, subDays, isSameDay, startOfDay } from 'date-fns';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth';
import { collection, query, orderBy, onSnapshot, addDoc, deleteDoc, doc, getDocs, where, setDoc, getDoc, writeBatch, limit } from 'firebase/firestore';
import { auth, db } from '../firebase';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface KeyData {
  id: string;
  key: string;
  status: 'available' | 'used';
  duration: string;
  createdAt: number;
  usedAt?: number;
}

interface SettingsData {
  linkShortener1Url: string;
  linkShortener1ApiToken: string;
  linkShortener2Url: string;
  linkShortener2ApiToken: string;
  maintenanceMode: boolean;
  announcement: string;
  telegramUrl: string;
  discordUrl: string;
  youtubeUrl: string;
  dailyLimit: number;
}

interface LinkLog {
  id: string;
  userId: string;
  shortenerIndex: number;
  timestamp: number;
  status: 'redirected' | 'claimed';
  keyValue?: string;
  duration?: string;
}

interface UserStat {
  id: string;
  totalKeysGenerated: number;
  lastGeneratedAt: number;
  dailyCount: number;
}

export default function Admin() {
  const [password, setPassword] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [keys, setKeys] = useState<KeyData[]>([]);
  const [newKey, setNewKey] = useState('');
  const [selectedDuration, setSelectedDuration] = useState('1 Day');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Settings state
  const [settings, setSettings] = useState<SettingsData>({
    linkShortener1Url: 'https://xtglinks.com/st',
    linkShortener1ApiToken: '0d677cf4096a7a8cfb737c54f7fc8b3a4d043669',
    linkShortener2Url: '',
    linkShortener2ApiToken: '',
    maintenanceMode: false,
    announcement: '',
    telegramUrl: '',
    discordUrl: '',
    youtubeUrl: '',
    dailyLimit: 5
  });
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSuccess, setSettingsSuccess] = useState(false);
  const [isDeletingUsed, setIsDeletingUsed] = useState(false);
  const [isDeletingAvailable, setIsDeletingAvailable] = useState(false);
  const [linkLogs, setLinkLogs] = useState<LinkLog[]>([]);
  const [userStats, setUserStats] = useState<UserStat[]>([]);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'keys' | 'settings' | 'logs' | 'users'>('dashboard');
  const [bulkCount, setBulkCount] = useState(10);
  const [isBulkGenerating, setIsBulkGenerating] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [logFilter, setLogFilter] = useState<'all' | 'claimed' | 'redirected'>('all');

  const stats = {
    totalKeys: keys.length,
    availableKeys: keys.filter(k => k.status === 'available').length,
    usedKeys: keys.filter(k => k.status === 'used').length,
    totalClaims: linkLogs.filter(l => l.status === 'claimed').length,
    claimsToday: linkLogs.filter(l => l.status === 'claimed' && isSameDay(l.timestamp, new Date())).length,
    redirectsToday: linkLogs.filter(l => l.status === 'redirected' && isSameDay(l.timestamp, new Date())).length,
  };

  const chartData = Array.from({ length: 7 }).map((_, i) => {
    const date = subDays(new Date(), 6 - i);
    const dayStr = format(date, 'MMM dd');
    const claims = linkLogs.filter(l => l.status === 'claimed' && isSameDay(l.timestamp, date)).length;
    const redirects = linkLogs.filter(l => l.status === 'redirected' && isSameDay(l.timestamp, date)).length;
    return { name: dayStr, claims, redirects };
  });

  const COLORS = ['#818cf8', '#34d399', '#f87171'];
  const durationData = [
    { name: '1 Day', value: keys.filter(k => k.duration === '1 Day').length },
    { name: '2 Days', value: keys.filter(k => k.duration === '2 Days').length },
    { name: '3 Days', value: keys.filter(k => k.duration === '3 Days').length },
  ].filter(d => d.value > 0);
  
  // Custom confirmation dialog state
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {}
  });

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      const allowedEmails = ['admin@rockymods.com', 'nxxoteam@gmail.com', 'master_admin@rockymods.com'];
      if (user && allowedEmails.includes(user.email || '')) {
        setIsAuthenticated(true);
      } else {
        setIsAuthenticated(false);
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;

    // Fetch keys
    const q = query(collection(db, 'keys'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const keysData: KeyData[] = [];
      snapshot.forEach((doc) => {
        keysData.push({ id: doc.id, ...doc.data() } as KeyData);
      });
      setKeys(keysData);
    }, (err) => {
      console.error("Error fetching keys:", err);
    });

    // Fetch settings
    const fetchSettings = async () => {
      try {
        const settingsDoc = await getDoc(doc(db, 'settings', 'linkShortener'));
        if (settingsDoc.exists()) {
          const data = settingsDoc.data();
          setSettings({
            linkShortener1Url: data.linkShortener1Url || data.linkShortenerUrl || '',
            linkShortener1ApiToken: data.linkShortener1ApiToken || data.linkShortenerApiToken || '',
            linkShortener2Url: data.linkShortener2Url || '',
            linkShortener2ApiToken: data.linkShortener2ApiToken || '',
            maintenanceMode: data.maintenanceMode || false,
            announcement: data.announcement || '',
            telegramUrl: data.telegramUrl || '',
            discordUrl: data.discordUrl || '',
            youtubeUrl: data.youtubeUrl || '',
            dailyLimit: data.dailyLimit || 5
          });
        }
      } catch (err) {
        console.error("Error fetching settings:", err);
      }
    };
    fetchSettings();

    // Fetch link logs
    const logsQ = query(collection(db, 'linkLogs'), orderBy('timestamp', 'desc'), limit(500));
    const unsubscribeLogs = onSnapshot(logsQ, (snapshot) => {
      const logsData: LinkLog[] = [];
      snapshot.forEach((doc) => {
        logsData.push({ id: doc.id, ...doc.data() } as LinkLog);
      });
      setLinkLogs(logsData);
    }, (err) => {
      console.error("Error fetching link logs:", err);
    });

    // Fetch user stats
    const statsQ = query(collection(db, 'userStats'), orderBy('totalKeysGenerated', 'desc'), limit(50));
    const unsubscribeStats = onSnapshot(statsQ, (snapshot) => {
      const statsData: UserStat[] = [];
      snapshot.forEach((doc) => {
        statsData.push({ id: doc.id, ...doc.data() } as UserStat);
      });
      setUserStats(statsData);
    }, (err) => {
      console.error("Error fetching user stats:", err);
    });

    return () => {
      unsubscribe();
      unsubscribeLogs();
      unsubscribeStats();
    };
  }, [isAuthenticated]);

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    
    // User specifically requested this exact password
    if (password !== 'KARISHMA-BABY-RRPAPA') {
      setError('Invalid password. Please check your admin key.');
      setLoading(false);
      return;
    }

    const masterEmail = 'master_admin@rockymods.com';
    
    try {
      // Try to sign in
      await signInWithEmailAndPassword(auth, masterEmail, password);
    } catch (err: any) {
      // If account doesn't exist, create it automatically
      try {
        await createUserWithEmailAndPassword(auth, masterEmail, password);
      } catch (createErr: any) {
        setError('System error: Could not setup admin account.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
  };

  const addKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKey.trim()) return;
    
    setLoading(true);
    setError(null);
    try {
      // Check if key already exists
      const q = query(collection(db, 'keys'), where('key', '==', newKey.trim()));
      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        setError('Key already exists');
        setLoading(false);
        return;
      }

      await addDoc(collection(db, 'keys'), {
        key: newKey.trim(),
        status: 'available',
        duration: selectedDuration,
        createdAt: Date.now()
      });
      setNewKey('');
    } catch (err: any) {
      console.error(err);
      setError('Failed to add key: ' + (err.message || 'Unknown error'));
      if (err.message?.includes('permission')) {
        handleFirestoreError(err, OperationType.CREATE, 'keys');
      }
    } finally {
      setLoading(false);
    }
  };

  const bulkGenerate = async () => {
    if (bulkCount <= 0 || bulkCount > 100) {
      setError('Please enter a count between 1 and 100');
      return;
    }
    
    setIsBulkGenerating(true);
    setError(null);
    
    try {
      const batch = writeBatch(db);
      const prefix = 'ROCKY-';
      
      for (let i = 0; i < bulkCount; i++) {
        const randomStr = Math.random().toString(36).substring(2, 10).toUpperCase();
        const key = `${prefix}${randomStr}`;
        
        const keyRef = doc(collection(db, 'keys'));
        batch.set(keyRef, {
          key,
          status: 'available',
          duration: selectedDuration,
          createdAt: Date.now()
        });
      }
      
      await batch.commit();
      setBulkCount(10);
    } catch (err: any) {
      console.error(err);
      setError('Bulk generation failed: ' + err.message);
    } finally {
      setIsBulkGenerating(false);
    }
  };

  const deleteKey = async (id: string) => {
    setConfirmDialog({
      isOpen: true,
      title: 'Delete Key',
      message: 'Are you sure you want to delete this key? This action cannot be undone.',
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'keys', id));
        } catch (err) {
          console.error(err);
        }
      }
    });
  };

  const deleteAllUsedKeys = async () => {
    const usedKeys = keys.filter(k => k.status === 'used');
    if (usedKeys.length === 0) {
      return;
    }
    
    setConfirmDialog({
      isOpen: true,
      title: 'Delete All Used Keys',
      message: `Are you sure you want to delete all ${usedKeys.length} used keys? This action cannot be undone.`,
      onConfirm: async () => {
        setIsDeletingUsed(true);
        try {
          // Process in batches of 500 (Firestore limit)
          for (let i = 0; i < usedKeys.length; i += 500) {
            const batch = writeBatch(db);
            const chunk = usedKeys.slice(i, i + 500);
            
            chunk.forEach(k => {
              batch.delete(doc(db, 'keys', k.id));
            });
            
            await batch.commit();
          }
        } catch (err) {
          console.error("Error deleting used keys:", err);
        } finally {
          setIsDeletingUsed(false);
        }
      }
    });
  };

  const deleteAllAvailableKeys = async () => {
    const availableKeys = keys.filter(k => k.status === 'available');
    if (availableKeys.length === 0) {
      return;
    }
    
    setConfirmDialog({
      isOpen: true,
      title: 'Delete All Available Keys',
      message: `Are you sure you want to delete all ${availableKeys.length} available keys? This action cannot be undone.`,
      onConfirm: async () => {
        setIsDeletingAvailable(true);
        try {
          // Process in batches of 500 (Firestore limit)
          for (let i = 0; i < availableKeys.length; i += 500) {
            const batch = writeBatch(db);
            const chunk = availableKeys.slice(i, i + 500);
            
            chunk.forEach(k => {
              batch.delete(doc(db, 'keys', k.id));
            });
            
            await batch.commit();
          }
        } catch (err) {
          console.error("Error deleting available keys:", err);
        } finally {
          setIsDeletingAvailable(false);
        }
      }
    });
  };

  const clearLogs = async () => {
    setConfirmDialog({
      isOpen: true,
      title: 'Clear All Logs',
      message: 'Are you sure you want to delete all usage logs? This action cannot be undone.',
      onConfirm: async () => {
        try {
          const snapshot = await getDocs(collection(db, 'linkLogs'));
          const docs = snapshot.docs;
          
          // Process in batches of 500 (Firestore limit)
          for (let i = 0; i < docs.length; i += 500) {
            const batch = writeBatch(db);
            const chunk = docs.slice(i, i + 500);
            
            chunk.forEach(d => {
              batch.delete(d.ref);
            });
            
            await batch.commit();
          }
        } catch (err) {
          console.error("Error clearing logs:", err);
        }
      }
    });
  };
  const saveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSettingsLoading(true);
    setSettingsSuccess(false);
    
    try {
      await setDoc(doc(db, 'settings', 'linkShortener'), {
        linkShortener1Url: settings.linkShortener1Url.trim(),
        linkShortener1ApiToken: settings.linkShortener1ApiToken.trim(),
        linkShortener2Url: settings.linkShortener2Url.trim(),
        linkShortener2ApiToken: settings.linkShortener2ApiToken.trim(),
        maintenanceMode: settings.maintenanceMode,
        announcement: settings.announcement.trim(),
        telegramUrl: settings.telegramUrl.trim(),
        discordUrl: settings.discordUrl.trim(),
        youtubeUrl: settings.youtubeUrl.trim(),
        dailyLimit: Number(settings.dailyLimit)
      });
      setSettingsSuccess(true);
      setTimeout(() => setSettingsSuccess(false), 3000);
    } catch (err) {
      console.error("Error saving settings:", err);
      alert("Failed to save settings. Check console for details.");
    } finally {
      setSettingsLoading(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-[#0a0a0a]">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md bg-zinc-900/50 backdrop-blur-xl border border-white/5 rounded-3xl p-8 shadow-2xl"
        >
            <div className="flex flex-col items-center mb-8">
              <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mb-4">
                <Shield className="w-8 h-8 text-indigo-400" />
              </div>
              <h1 className="text-2xl font-bold text-white">Admin Access</h1>
              <p className="text-zinc-400 text-sm mt-2">Admin Panel</p>
            </div>

          <form onSubmit={login} className="space-y-4">
            <div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Admin Password"
                className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all"
                required
              />
            </div>
            {error && <p className="text-red-400 text-sm font-medium text-center">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-500 hover:bg-indigo-400 text-white font-semibold py-3 rounded-xl transition-colors disabled:opacity-50"
            >
              {loading ? 'Authenticating...' : 'Login'}
            </button>
          </form>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] p-4 md:p-8">
      <div className="max-w-5xl mx-auto">
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
              <Shield className="w-8 h-8 text-indigo-400" />
              Admin Dashboard
            </h1>
            <p className="text-zinc-400 mt-1">Manage Rocky Mods premium keys</p>
          </div>
          <div className="flex items-center gap-2 bg-white/5 p-1 rounded-xl border border-white/5 overflow-x-auto no-scrollbar">
            <button
              onClick={() => setActiveTab('dashboard')}
              className={cn(
                "px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap",
                activeTab === 'dashboard' ? "bg-indigo-500 text-white" : "text-zinc-400 hover:text-white"
              )}
            >
              Dashboard
            </button>
            <button
              onClick={() => setActiveTab('keys')}
              className={cn(
                "px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap",
                activeTab === 'keys' ? "bg-indigo-500 text-white" : "text-zinc-400 hover:text-white"
              )}
            >
              Keys
            </button>
            <button
              onClick={() => setActiveTab('logs')}
              className={cn(
                "px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap",
                activeTab === 'logs' ? "bg-indigo-500 text-white" : "text-zinc-400 hover:text-white"
              )}
            >
              Logs
            </button>
            <button
              onClick={() => setActiveTab('users')}
              className={cn(
                "px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap",
                activeTab === 'users' ? "bg-indigo-500 text-white" : "text-zinc-400 hover:text-white"
              )}
            >
              Users
            </button>
            <button
              onClick={() => setActiveTab('settings')}
              className={cn(
                "px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap",
                activeTab === 'settings' ? "bg-indigo-500 text-white" : "text-zinc-400 hover:text-white"
              )}
            >
              Settings
            </button>
            <div className="w-px h-4 bg-white/10 mx-1 flex-shrink-0" />
            <button
              onClick={handleLogout}
              className="p-2 text-zinc-400 hover:text-red-400 transition-colors flex-shrink-0"
              title="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </header>

        {activeTab === 'dashboard' && (
          <div className="space-y-8">
            {/* Stats Overview */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-zinc-900/50 border border-white/5 rounded-3xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="p-2 bg-indigo-500/10 rounded-xl">
                    <Zap className="w-6 h-6 text-indigo-400" />
                  </div>
                  <span className="text-xs font-bold text-indigo-400 bg-indigo-500/10 px-2 py-1 rounded-full">Total</span>
                </div>
                <p className="text-zinc-500 text-sm font-medium mb-1">Total Keys</p>
                <p className="text-3xl font-bold text-white">{stats.totalKeys}</p>
              </div>
              <div className="bg-zinc-900/50 border border-white/5 rounded-3xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="p-2 bg-emerald-500/10 rounded-xl">
                    <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                  </div>
                  <span className="text-xs font-bold text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-full">Active</span>
                </div>
                <p className="text-zinc-500 text-sm font-medium mb-1">Available Keys</p>
                <p className="text-3xl font-bold text-white">{stats.availableKeys}</p>
              </div>
              <div className="bg-zinc-900/50 border border-white/5 rounded-3xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="p-2 bg-blue-500/10 rounded-xl">
                    <TrendingUp className="w-6 h-6 text-blue-400" />
                  </div>
                  <span className="text-xs font-bold text-blue-400 bg-blue-500/10 px-2 py-1 rounded-full">Today</span>
                </div>
                <p className="text-zinc-500 text-sm font-medium mb-1">Claims Today</p>
                <p className="text-3xl font-bold text-white">{stats.claimsToday}</p>
              </div>
              <div className="bg-zinc-900/50 border border-white/5 rounded-3xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="p-2 bg-purple-500/10 rounded-xl">
                    <Activity className="w-6 h-6 text-purple-400" />
                  </div>
                  <span className="text-xs font-bold text-purple-400 bg-purple-500/10 px-2 py-1 rounded-full">Traffic</span>
                </div>
                <p className="text-zinc-500 text-sm font-medium mb-1">Redirects Today</p>
                <p className="text-3xl font-bold text-white">{stats.redirectsToday}</p>
              </div>
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className="bg-zinc-900/50 border border-white/5 rounded-3xl p-8">
                <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-indigo-400" />
                  Generation Trends (Last 7 Days)
                </h3>
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" vertical={false} />
                      <XAxis 
                        dataKey="name" 
                        stroke="#71717a" 
                        fontSize={12} 
                        tickLine={false} 
                        axisLine={false} 
                      />
                      <YAxis 
                        stroke="#71717a" 
                        fontSize={12} 
                        tickLine={false} 
                        axisLine={false} 
                      />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#18181b', border: '1px solid #ffffff10', borderRadius: '12px' }}
                        itemStyle={{ fontSize: '12px' }}
                      />
                      <Bar dataKey="claims" fill="#818cf8" radius={[4, 4, 0, 0]} name="Claims" />
                      <Bar dataKey="redirects" fill="#a855f7" radius={[4, 4, 0, 0]} name="Redirects" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="bg-zinc-900/50 border border-white/5 rounded-3xl p-8">
                <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
                  <Activity className="w-5 h-5 text-emerald-400" />
                  Key Distribution by Duration
                </h3>
                <div className="h-[300px] w-full flex items-center justify-center">
                  {durationData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={durationData}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={100}
                          paddingAngle={5}
                          dataKey="value"
                        >
                          {durationData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip 
                          contentStyle={{ backgroundColor: '#18181b', border: '1px solid #ffffff10', borderRadius: '12px' }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="text-zinc-500 text-sm">No data available</p>
                  )}
                </div>
                <div className="flex justify-center gap-6 mt-4">
                  {durationData.map((d, i) => (
                    <div key={d.name} className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                      <span className="text-xs text-zinc-400">{d.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'keys' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-1 space-y-8">
              {/* Add Key Section */}
              <div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-6">
                <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                  <Plus className="w-5 h-5 text-indigo-400" />
                  Add New Key
                </h2>
                <form onSubmit={addKey} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-zinc-400 mb-2">Key Value</label>
                    <input
                      type="text"
                      value={newKey}
                      onChange={(e) => setNewKey(e.target.value)}
                      placeholder="e.g. ROCKY-MODS-XYZ123"
                      className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all font-mono text-sm"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-400 mb-2">Duration</label>
                    <div className="grid grid-cols-2 gap-2">
                      {['1 Day', '2 Days', '3 Days'].map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setSelectedDuration(d)}
                          className={cn(
                            "px-3 py-2 rounded-xl text-xs font-bold transition-all border",
                            selectedDuration === d 
                              ? "bg-indigo-500 border-indigo-400 text-white shadow-lg shadow-indigo-500/20" 
                              : "bg-black/30 border-white/5 text-zinc-500 hover:border-white/10 hover:text-zinc-300"
                          )}
                        >
                          {d}
                        </button>
                      ))}
                    </div>
                  </div>
                  {error && <p className="text-red-400 text-sm">{error}</p>}
                  <button
                    type="submit"
                    disabled={loading || !newKey.trim()}
                    className="w-full bg-indigo-500 hover:bg-indigo-400 text-white font-semibold py-3 rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    <Plus className="w-5 h-5" />
                    Add Key
                  </button>
                </form>

                <div className="mt-8 pt-6 border-t border-white/5">
                  <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                    <Zap className="w-5 h-5 text-indigo-400" />
                    Bulk Generate
                  </h2>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-zinc-400 mb-2">Count (Max 100)</label>
                      <input
                        type="number"
                        value={bulkCount}
                        onChange={(e) => setBulkCount(parseInt(e.target.value) || 0)}
                        className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-indigo-500/50 transition-all"
                        min="1"
                        max="100"
                      />
                    </div>
                    <button
                      onClick={bulkGenerate}
                      disabled={isBulkGenerating || bulkCount <= 0}
                      className="w-full bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 font-semibold py-3 rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2 border border-indigo-500/20"
                    >
                      {isBulkGenerating ? <Loader2 className="w-5 h-5 animate-spin" /> : <Zap className="w-5 h-5" />}
                      Generate {bulkCount} Keys
                    </button>
                  </div>
                </div>

                <div className="mt-8 pt-6 border-t border-white/5">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-black/30 rounded-xl p-4 border border-white/5">
                      <p className="text-zinc-500 text-xs font-medium uppercase mb-1">Total Keys</p>
                      <p className="text-2xl font-bold text-white">{keys.length}</p>
                    </div>
                    <div className="bg-black/30 rounded-xl p-4 border border-white/5">
                      <p className="text-zinc-500 text-xs font-medium uppercase mb-1">Available</p>
                      <p className="text-2xl font-bold text-emerald-400">
                        {keys.filter(k => k.status === 'available').length}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="lg:col-span-2 space-y-8">
              <div className="bg-zinc-900/50 border border-white/5 rounded-2xl overflow-hidden">
                <div className="p-6 border-b border-white/5 flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                    <Key className="w-5 h-5 text-indigo-400" />
                    Key Inventory
                  </h2>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={deleteAllAvailableKeys}
                      disabled={isDeletingAvailable || keys.filter(k => k.status === 'available').length === 0}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isDeletingAvailable ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                      Delete Available
                    </button>
                    <button
                      onClick={deleteAllUsedKeys}
                      disabled={isDeletingUsed || keys.filter(k => k.status === 'used').length === 0}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isDeletingUsed ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                      Delete Used
                    </button>
                  </div>
                </div>
                
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-black/20 border-b border-white/5 text-xs uppercase tracking-wider text-zinc-500">
                        <th className="p-4 font-medium">Key</th>
                        <th className="p-4 font-medium">Duration</th>
                        <th className="p-4 font-medium">Status</th>
                        <th className="p-4 font-medium text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {keys.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="p-8 text-center text-zinc-500">
                            No keys found. Add some keys to get started.
                          </td>
                        </tr>
                      ) : (
                        keys.map((k) => (
                          <tr key={k.id} className="hover:bg-white/[0.02] transition-colors">
                            <td className="p-4">
                              <span className="font-mono text-sm text-zinc-300">{k.key}</span>
                            </td>
                            <td className="p-4">
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-indigo-500/10 text-indigo-400 text-[10px] font-bold border border-indigo-500/20 uppercase tracking-wider">
                                {k.duration || '1 Day'}
                              </span>
                            </td>
                            <td className="p-4">
                              {k.status === 'used' ? (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-500/10 text-red-400 text-xs font-medium border border-red-500/20">
                                  <XCircle className="w-3.5 h-3.5" />
                                  Used
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-xs font-medium border border-emerald-500/20">
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  Available
                                </span>
                              )}
                            </td>
                            <td className="p-4">
                              <span className="text-xs text-zinc-500 flex items-center gap-1.5">
                                <Clock className="w-3.5 h-3.5" />
                                {new Date(k.createdAt).toLocaleDateString()}
                              </span>
                            </td>
                            <td className="p-4 text-right">
                              <button
                                onClick={() => deleteKey(k.id)}
                                className="p-2 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                title="Delete key"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'users' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between px-2">
              <h2 className="text-2xl font-bold text-white flex items-center gap-4">
                <Users className="w-8 h-8 text-indigo-400" />
                User Management
              </h2>
              <div className="bg-white/5 px-4 py-2 rounded-xl border border-white/5 text-xs font-bold text-zinc-400 uppercase tracking-widest">
                Top 50 Users
              </div>
            </div>

            <div className="bg-zinc-900/50 backdrop-blur-xl border border-white/5 rounded-3xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-black/20 border-b border-white/5 text-xs uppercase tracking-wider text-zinc-500">
                      <th className="px-6 py-4 font-semibold">User Identifier (Hashed)</th>
                      <th className="px-6 py-4 font-semibold">Total Keys</th>
                      <th className="px-6 py-4 font-semibold">Daily Count</th>
                      <th className="px-6 py-4 font-semibold">Last Activity</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {userStats.map((user) => (
                      <tr key={user.id} className="hover:bg-white/5 transition-colors">
                        <td className="px-6 py-4 text-sm text-white font-mono">{user.id}</td>
                        <td className="px-6 py-4">
                          <span className="px-2 py-1 rounded-lg bg-indigo-500/10 text-indigo-400 text-xs font-bold">
                            {user.totalKeysGenerated} Keys
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span className={cn(
                            "px-2 py-1 rounded-lg text-xs font-bold",
                            user.dailyCount >= settings.dailyLimit ? "bg-red-500/10 text-red-400" : "bg-emerald-500/10 text-emerald-400"
                          )}>
                            {user.dailyCount} / {settings.dailyLimit}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-zinc-400">
                          {new Date(user.lastGeneratedAt).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                    {userStats.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-6 py-12 text-center text-zinc-500">
                          No user data found
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="max-w-2xl mx-auto">
            {/* Link Shortener Settings */}
            <div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-6">
              <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <LinkIcon className="w-5 h-5 text-indigo-400" />
                Link Shortener Settings
              </h2>
              <form onSubmit={saveSettings} className="space-y-6">
                <div className="space-y-4">
                  <h3 className="text-sm font-bold text-indigo-400 uppercase tracking-wider">Shortener 1 (First Key)</h3>
                  <div>
                    <label className="block text-sm font-medium text-zinc-400 mb-2">API URL</label>
                    <input
                      type="url"
                      value={settings.linkShortener1Url}
                      onChange={(e) => setSettings({ ...settings, linkShortener1Url: e.target.value })}
                      placeholder="https://xtglinks.com/st"
                      className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all font-mono text-sm"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-400 mb-2">API Token</label>
                    <input
                      type="text"
                      value={settings.linkShortener1ApiToken}
                      onChange={(e) => setSettings({ ...settings, linkShortener1ApiToken: e.target.value })}
                      placeholder="Your API Token"
                      className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all font-mono text-sm"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-4 pt-4 border-t border-white/5">
                  <h3 className="text-sm font-bold text-indigo-400 uppercase tracking-wider">Shortener 2 (Second Key)</h3>
                  <div>
                    <label className="block text-sm font-medium text-zinc-400 mb-2">API URL</label>
                    <input
                      type="url"
                      value={settings.linkShortener2Url}
                      onChange={(e) => setSettings({ ...settings, linkShortener2Url: e.target.value })}
                      placeholder="https://another-shortener.com/st"
                      className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all font-mono text-sm"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-400 mb-2">API Token</label>
                    <input
                      type="text"
                      value={settings.linkShortener2ApiToken}
                      onChange={(e) => setSettings({ ...settings, linkShortener2ApiToken: e.target.value })}
                      placeholder="Your API Token"
                      className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all font-mono text-sm"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-4 pt-4 border-t border-white/5">
                  <h3 className="text-sm font-bold text-indigo-400 uppercase tracking-wider">Advanced Controls</h3>
                  <div className="flex items-center justify-between p-4 bg-black/30 rounded-xl border border-white/5">
                    <div>
                      <p className="text-sm font-medium text-white">Daily Key Limit</p>
                      <p className="text-xs text-zinc-500">Max keys per user per day</p>
                    </div>
                    <input
                      type="number"
                      value={settings.dailyLimit}
                      onChange={(e) => setSettings({ ...settings, dailyLimit: parseInt(e.target.value) || 0 })}
                      className="w-20 bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-white text-center focus:outline-none focus:border-indigo-500/50"
                      min="0"
                    />
                  </div>

                  <div className="flex items-center justify-between p-4 bg-black/30 rounded-xl border border-white/5">
                    <div>
                      <p className="text-sm font-medium text-white">Maintenance Mode</p>
                      <p className="text-xs text-zinc-500">Disable key generation for all users</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSettings({ ...settings, maintenanceMode: !settings.maintenanceMode })}
                      className={cn(
                        "w-12 h-6 rounded-full transition-colors relative",
                        settings.maintenanceMode ? "bg-red-500" : "bg-zinc-700"
                      )}
                    >
                      <div className={cn(
                        "absolute top-1 w-4 h-4 bg-white rounded-full transition-all",
                        settings.maintenanceMode ? "left-7" : "left-1"
                      )} />
                    </button>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-zinc-400 mb-2">Announcement Banner</label>
                    <textarea
                      value={settings.announcement}
                      onChange={(e) => setSettings({ ...settings, announcement: e.target.value })}
                      placeholder="e.g. New Update v2.0 is live! Join Telegram for more info."
                      className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all text-sm min-h-[80px]"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-zinc-400 mb-2">Telegram URL</label>
                      <input
                        type="url"
                        value={settings.telegramUrl}
                        onChange={(e) => setSettings({ ...settings, telegramUrl: e.target.value })}
                        placeholder="https://t.me/yourchannel"
                        className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-zinc-400 mb-2">Discord URL</label>
                      <input
                        type="url"
                        value={settings.discordUrl}
                        onChange={(e) => setSettings({ ...settings, discordUrl: e.target.value })}
                        placeholder="https://discord.gg/yourserver"
                        className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-zinc-400 mb-2">YouTube URL</label>
                      <input
                        type="url"
                        value={settings.youtubeUrl}
                        onChange={(e) => setSettings({ ...settings, youtubeUrl: e.target.value })}
                        placeholder="https://youtube.com/@yourchannel"
                        className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all text-sm"
                      />
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={settingsLoading}
                  className={cn(
                    "w-full font-semibold py-3 rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2",
                    settingsSuccess ? "bg-emerald-500 hover:bg-emerald-400 text-black" : "bg-indigo-500 hover:bg-indigo-400 text-white"
                  )}
                >
                  {settingsSuccess ? (
                    <>
                      <CheckCircle2 className="w-5 h-5" />
                      Saved Successfully
                    </>
                  ) : (
                    <>
                      <Save className="w-5 h-5" />
                      {settingsLoading ? 'Saving...' : 'Save Settings'}
                    </>
                  )}
                </button>
              </form>
            </div>
          </div>
        )}

        {activeTab === 'logs' && (
          <div className="max-w-4xl mx-auto space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 px-2">
              <h2 className="text-2xl font-bold text-white flex items-center gap-4">
                <Clock className="w-8 h-8 text-indigo-400" />
                Link Usage Logs
              </h2>
              <div className="flex items-center gap-3">
                <button
                  onClick={clearLogs}
                  className="px-4 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-bold uppercase tracking-wider transition-all border border-red-500/10"
                >
                  Clear Logs
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2 relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by User ID or Key..."
                  className="w-full bg-zinc-900/50 border border-white/5 rounded-2xl pl-11 pr-4 py-3 text-white placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500/50 transition-all text-sm"
                />
              </div>
              <div className="relative">
                <Filter className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <select
                  value={logFilter}
                  onChange={(e) => setLogFilter(e.target.value as any)}
                  className="w-full bg-zinc-900/50 border border-white/5 rounded-2xl pl-11 pr-4 py-3 text-white focus:outline-none focus:border-indigo-500/50 transition-all text-sm appearance-none"
                >
                  <option value="all">All Status</option>
                  <option value="claimed">Claimed Only</option>
                  <option value="redirected">Redirected Only</option>
                </select>
              </div>
            </div>

            <div className="bg-zinc-900/50 backdrop-blur-xl border border-white/5 rounded-3xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-black/20 border-b border-white/5 text-xs uppercase tracking-wider text-zinc-500">
                      <th className="px-6 py-4 text-xs font-semibold text-zinc-400 uppercase tracking-wider">User ID</th>
                      <th className="px-6 py-4 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Shortener</th>
                      <th className="px-6 py-4 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Status</th>
                      <th className="px-6 py-4 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Duration</th>
                      <th className="px-6 py-4 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Key</th>
                      <th className="px-6 py-4 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {linkLogs
                      .filter(log => {
                        const matchesSearch = log.userId.toLowerCase().includes(searchQuery.toLowerCase()) || 
                                           (log.keyValue?.toLowerCase().includes(searchQuery.toLowerCase()));
                        const matchesFilter = logFilter === 'all' || log.status === logFilter;
                        return matchesSearch && matchesFilter;
                      })
                      .map((log) => (
                        <tr key={log.id} className="hover:bg-white/5 transition-colors">
                          <td className="px-6 py-4 text-sm text-white font-mono">{log.userId}</td>
                          <td className="px-6 py-4">
                            <span className={cn(
                              "px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider",
                              log.shortenerIndex === 1 ? "bg-blue-400/10 text-blue-400" : 
                              log.shortenerIndex === 2 ? "bg-purple-400/10 text-purple-400" : "bg-zinc-400/10 text-zinc-400"
                            )}>
                              {log.shortenerIndex ? `Shortener ${log.shortenerIndex}` : '-'}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <span className={cn(
                              "px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider",
                              log.status === 'claimed' ? "bg-emerald-400/10 text-emerald-400" : "bg-zinc-400/10 text-zinc-400"
                            )}>
                              {log.status}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-sm text-indigo-400 font-bold">
                            {log.duration || '-'}
                          </td>
                          <td className="px-6 py-4 text-sm text-white font-mono">
                            {log.keyValue || '-'}
                          </td>
                          <td className="px-6 py-4 text-sm text-zinc-400">
                            {new Date(log.timestamp).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    {linkLogs.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-6 py-12 text-center text-zinc-500">
                          No logs found
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

      {/* Confirmation Modal */}
      <AnimatePresence>
        {confirmDialog.isOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-zinc-900 border border-white/10 rounded-2xl p-6 max-w-md w-full shadow-2xl"
            >
              <h3 className="text-xl font-bold text-white mb-2">{confirmDialog.title}</h3>
              <p className="text-zinc-400 mb-6">{confirmDialog.message}</p>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setConfirmDialog(prev => ({ ...prev, isOpen: false }))}
                  className="px-4 py-2 rounded-xl font-medium text-zinc-300 hover:bg-white/5 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    confirmDialog.onConfirm();
                    setConfirmDialog(prev => ({ ...prev, isOpen: false }));
                  }}
                  className="px-4 py-2 rounded-xl font-medium bg-red-500 hover:bg-red-400 text-white transition-colors"
                >
                  Confirm
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      </div>
    </div>
  );
}
