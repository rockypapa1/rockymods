import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Key, Copy, Check, ShieldAlert, Loader2, Settings } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Link } from 'react-router-dom';
import { collection, query, where, orderBy, limit, getDocs, updateDoc, doc, getDoc, setDoc, addDoc } from 'firebase/firestore';
import { db } from '../firebase';

// Helper to check for AdBlocker
const checkAdBlocker = async () => {
  try {
    const url = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js';
    const response = await fetch(url, { method: 'HEAD', mode: 'no-cors' });
    return false; // Not blocked
  } catch (e) {
    return true; // Blocked
  }
};

// Helper to check for VPN/Proxy/Hosting
const checkVPN = async () => {
  try {
    const response = await fetch('https://ipwho.is/');
    const data = await response.json();
    
    if (data && data.security) {
      const { vpn, proxy, tor, relay, hosting } = data.security;
      return vpn || proxy || tor || relay || hosting;
    }
    return false;
  } catch (e) {
    console.error("VPN check failed", e);
    return false; // Assume safe if check fails, or could be strict and return true
  }
};

// Helper to get user IP (hashed for privacy)
const getUserIdentifier = async () => {
  try {
    const response = await fetch('https://api.ipify.org?format=json');
    const data = await response.json();
    // Simple hash function for the IP
    const ip = data.ip;
    let hash = 0;
    for (let i = 0; i < ip.length; i++) {
      const char = ip.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString();
  } catch (e) {
    // Fallback to a persistent random ID if IP fetch fails
    let id = localStorage.getItem('user_fingerprint');
    if (!id) {
      id = Math.random().toString(36).substring(2) + Date.now().toString(36);
      localStorage.setItem('user_fingerprint', id);
    }
    return id;
  }
};

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function Home() {
  const [key, setKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingState, setLoadingState] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const processedSession = React.useRef(false);

  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    if (processedSession.current) return;
    
    const searchParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.includes('?') ? window.location.hash.split('?')[1] : '');
    
    const session = searchParams.get('session') || hashParams.get('session');
    const claimedKey = searchParams.get('key') || hashParams.get('key');

    if (session) {
      setIsProcessing(true);
      handleReturnSession(session);
    } else if (claimedKey) {
      processedSession.current = true;
      setKey(claimedKey);
      const cleanUrl = window.location.origin + window.location.pathname + window.location.hash.split('?')[0];
      window.history.replaceState({}, document.title, cleanUrl);
    }
  }, []);

  const [lastSessionId, setLastSessionId] = useState<string | null>(null);

  const handleReturnSession = async (session: string) => {
    if (!session || session.length < 5) {
      setError('Invalid session ID format.');
      return;
    }

    processedSession.current = true;
    setLastSessionId(session);
    setIsProcessing(true);
    setError(null);
    
    console.log("Processing return session:", session);
    
    // Small delay to ensure UI is ready
    await new Promise(resolve => setTimeout(resolve, 1000));

    try {
      await claimKeyFromDb();
    } catch (e: any) {
      console.error("Session processing error:", e);
      setError('Error processing session: ' + (e.message || 'Unknown error'));
    } finally {
      setIsProcessing(false);
      localStorage.removeItem('key_session');
      // Clean up the URL but keep it in state for retry if needed
      const cleanUrl = window.location.origin + window.location.pathname + window.location.hash.split('?')[0];
      window.history.replaceState({}, document.title, cleanUrl);
    }
  };

  const retryClaim = () => {
    if (lastSessionId) {
      handleReturnSession(lastSessionId);
    } else {
      generateKey();
    }
  };

  const claimKeyFromDb = async (retries = 3) => {
    setLoading(true);
    setError(null);
    setLoadingState('Security check: AdBlocker...');
    
    try {
      const isAdBlockerActive = await checkAdBlocker();
      if (isAdBlockerActive) {
        throw new Error('AdBlocker detected! Please disable your AdBlocker to see your key. We use ads to keep this service free.');
      }

      setLoadingState('Security check: VPN/Proxy...');
      const isVPNActive = await checkVPN();
      if (isVPNActive) {
        throw new Error('VPN/Proxy detected! Please disable your VPN, Proxy, or Private DNS to claim your key. High security is active.');
      }
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
      setLoadingState(null);
      return;
    }

    setLoadingState('Assigning your key...');

    for (let i = 0; i < retries; i++) {
      try {
        const keysRef = collection(db, 'keys');
        const q = query(
          keysRef,
          where('isUsed', '==', false),
          limit(1)
        );

        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
          throw new Error('No keys available in inventory. Please contact admin.');
        }

        const keyDoc = querySnapshot.docs[0];
        const keyData = keyDoc.data();

        // Try to mark it as used.
        await updateDoc(doc(db, 'keys', keyDoc.id), {
          isUsed: true,
          usedAt: Date.now()
        });

        // Increment user stats count
        try {
          const userId = await getUserIdentifier();
          const statsRef = doc(db, 'userStats', userId);
          const statsDoc = await getDoc(statsRef);
          
          if (statsDoc.exists()) {
            const statsData = statsDoc.data();
            const lastGen = statsData.lastGeneratedAt || 0;
            const isToday = new Date(lastGen).toDateString() === new Date().toDateString();
            
            await updateDoc(statsRef, {
              count: isToday ? (statsData.count || 0) + 1 : 1,
              lastGeneratedAt: Date.now()
            });
          } else {
            await setDoc(statsRef, {
              count: 1,
              lastGeneratedAt: Date.now()
            });
          }
        } catch (statsErr) {
          console.error("Failed to update user stats", statsErr);
          // Don't block the key delivery if stats update fails
        }

        // Success!
        setKey(keyData.value);
        setLoading(false);
        setLoadingState(null);
        return;
      } catch (err: any) {
        console.error(`Claim attempt ${i + 1} failed:`, err);
        
        // If it's a permission error or index error, show more detail
        let errorMessage = 'Failed to assign key. ';
        if (err.code === 'permission-denied') {
          errorMessage += 'Database permission denied. Please check if you are using a VPN or AdBlocker.';
        } else if (err.message?.includes('index')) {
          errorMessage += 'Database index is building. Please wait 30 seconds and try again.';
        } else if (err.code === 'unavailable') {
          errorMessage += 'Network error. Please check your internet connection.';
        } else {
          errorMessage += err.message || 'Unknown error occurred.';
        }

        if (i === retries - 1) {
          setError(errorMessage);
        }
        // Wait 800ms before retrying (reduced from 1.5s for speed)
        await new Promise(res => setTimeout(res, 800));
      }
    }
    
    setLoading(false);
    setLoadingState(null);
  };

  const generateKey = async () => {
    setLoading(true);
    setError(null);
    setKey(null);
    setCopied(false);

    try {
      setLoadingState('Checking daily limit...');
      
      const userId = await getUserIdentifier();
      const statsRef = doc(db, 'userStats', userId);
      const statsDoc = await getDoc(statsRef);
      
      let dailyCount = 0;
      if (statsDoc.exists()) {
        const statsData = statsDoc.data();
        const lastGen = statsData.lastGeneratedAt || 0;
        const isToday = new Date(lastGen).toDateString() === new Date().toDateString();
        if (isToday) {
          dailyCount = statsData.count || 0;
        }
      }

      if (dailyCount >= 2) {
        throw new Error('Daily limit reached! You can only generate 2 keys per day. Please come back tomorrow.');
      }

      setLoadingState('Preparing link...');
      
      // First, verify we actually have keys available before sending user to shortener
      const keysRef = collection(db, 'keys');
      const q = query(keysRef, where('isUsed', '==', false), limit(1));
      const querySnapshot = await getDocs(q);
      
      if (querySnapshot.empty) {
        throw new Error('No keys available right now. Please check back later.');
      }

      // Generate a stateless session ID (base64 encoded timestamp)
      const sessionId = btoa(Date.now().toString());
      // Still save to localStorage as a backup
      localStorage.setItem('key_session', sessionId);

      setLoadingState('Redirecting to link shortener...');
      
      // Fetch link shortener settings
      let apiUrl = 'https://xtglinks.com/st';
      let apiToken = '0d677cf4096a7a8cfb737c54f7fc8b3a4d043669';
      
      try {
        const settingsDoc = await getDoc(doc(db, 'settings', 'linkShortener'));
        let shortenerIndex = 1;
        if (settingsDoc.exists()) {
          const settingsData = settingsDoc.data();
          // Select shortener based on daily count
          if (dailyCount === 0) {
            // First key
            apiUrl = settingsData.linkShortener1Url || settingsData.linkShortenerUrl || apiUrl;
            apiToken = settingsData.linkShortener1ApiToken || settingsData.linkShortenerApiToken || apiToken;
            shortenerIndex = 1;
          } else {
            // Second key
            apiUrl = settingsData.linkShortener2Url || settingsData.linkShortener1Url || settingsData.linkShortenerUrl || apiUrl;
            apiToken = settingsData.linkShortener2ApiToken || settingsData.linkShortener1ApiToken || settingsData.linkShortenerApiToken || apiToken;
            shortenerIndex = 2;
          }
        }

        // Log the usage
        try {
          await addDoc(collection(db, 'linkLogs'), {
            userId,
            shortenerIndex,
            timestamp: Date.now()
          });
        } catch (logErr) {
          console.error("Failed to log link usage", logErr);
        }
      } catch (settingsErr) {
        console.error("Failed to fetch settings, using defaults", settingsErr);
      }
      
      // Construct the destination URL with the session ID
      // Use a more robust way to get the base URL
      const currentUrl = new URL(window.location.href);
      const baseUrl = currentUrl.origin + currentUrl.pathname;
      const returnUrl = `${baseUrl}${baseUrl.endsWith('/') ? '' : '/'}?session=${sessionId}`;
      
      // Use the Quick Link format to redirect the user directly.
      const quickLinkUrl = `${apiUrl}?api=${apiToken}&url=${encodeURIComponent(returnUrl)}`;
      
      window.location.href = quickLinkUrl;
      return; // Stop execution here as the page will redirect
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to prepare key generation');
      setLoading(false);
      setLoadingState(null);
    }
  };

  const copyToClipboard = () => {
    if (key) {
      navigator.clipboard.writeText(key);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {/* Background Effects */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,#1a1a1a_0%,#0a0a0a_100%)]" />
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-lg h-[500px] bg-emerald-500/10 blur-[120px] rounded-full pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 w-full max-w-md"
      >
        <div className="text-center mb-10">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.2, duration: 0.5 }}
            className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 mb-6"
          >
            <Key className="w-8 h-8 text-emerald-400" />
          </motion.div>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-3 bg-gradient-to-br from-white to-white/50 bg-clip-text text-transparent">
            ROCKY MODS
          </h1>
          <p className="text-zinc-400 text-sm md:text-base font-medium tracking-wide uppercase letter-spacing-2">
            Premium Mod Menu Access
          </p>
        </div>

        <div className="bg-zinc-900/50 backdrop-blur-xl border border-white/5 rounded-3xl p-8 shadow-2xl">
          <AnimatePresence mode="wait">
            {!key ? (
              <motion.div
                key="generate"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="flex flex-col items-center"
              >
                {isProcessing ? (
                  <div className="flex flex-col items-center gap-4 py-8">
                    <Loader2 className="w-10 h-10 text-emerald-500 animate-spin" />
                    <p className="text-emerald-400 font-medium animate-pulse">Verifying session...</p>
                  </div>
                ) : (
                  <button
                    onClick={generateKey}
                    disabled={loading}
                    className={cn(
                      "relative group w-full flex items-center justify-center gap-3 px-8 py-4 rounded-2xl font-semibold text-lg transition-all duration-300",
                      "bg-emerald-500 text-black hover:bg-emerald-400 active:scale-[0.98]",
                      "disabled:opacity-50 disabled:pointer-events-none"
                    )}
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-6 h-6 animate-spin" />
                        <span className="text-base">{loadingState || 'Loading...'}</span>
                      </>
                    ) : (
                      <>
                        Generate Key
                        <Key className="w-5 h-5 group-hover:rotate-12 transition-transform" />
                      </>
                    )}
                  </button>
                )}

                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-6 flex flex-col gap-3 text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl p-4 w-full"
                  >
                    <div className="flex items-start gap-3">
                      <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" />
                      <p className="text-sm font-medium leading-relaxed">{error}</p>
                    </div>
                    
                    <button
                      onClick={retryClaim}
                      className="text-xs font-bold uppercase tracking-wider text-emerald-400 hover:text-emerald-300 transition-colors self-end flex items-center gap-2"
                    >
                      <Loader2 className={cn("w-3 h-3", loading && "animate-spin")} />
                      {loading ? 'Retrying...' : 'Try Again'}
                    </button>
                  </motion.div>
                )}
              </motion.div>
            ) : (
              <motion.div
                key="result"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center"
              >
                <div className="w-full bg-black/50 border border-white/10 rounded-2xl p-6 mb-6 relative group">
                  <p className="text-xs text-zinc-500 uppercase tracking-wider font-semibold mb-2">Your Premium Key</p>
                  <p className="font-mono text-xl md:text-2xl text-emerald-400 break-all">
                    {key}
                  </p>
                  
                  <button
                    onClick={copyToClipboard}
                    className="absolute top-4 right-4 p-2 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white transition-colors"
                    title="Copy to clipboard"
                  >
                    {copied ? <Check className="w-5 h-5 text-emerald-400" /> : <Copy className="w-5 h-5" />}
                  </button>
                </div>

                <p className="text-sm text-zinc-400 text-center mb-6">
                  This key is single-use only. Please copy it now.
                </p>

                <button
                  onClick={() => setKey(null)}
                  className="text-sm font-medium text-zinc-500 hover:text-white transition-colors"
                >
                  Generate another key
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        
        <div className="mt-12 text-center flex flex-col items-center gap-4">
          <p className="text-xs text-zinc-600 font-medium tracking-widest uppercase">
            © {new Date().getFullYear()} ROCKY MODS. All rights reserved.
          </p>
          <Link 
            to="/admin" 
            className="p-2 rounded-full bg-white/5 hover:bg-white/10 text-zinc-600 hover:text-zinc-400 transition-colors"
            title="Admin Panel"
          >
            <Settings className="w-4 h-4" />
          </Link>
        </div>
      </motion.div>
    </div>
  );
}
