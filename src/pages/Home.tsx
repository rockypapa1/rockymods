import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Key, Copy, Check, ShieldAlert, Loader2, Settings, MessageSquare, Send, Info, AlertTriangle, Youtube } from 'lucide-react';
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

// Helper to get user identifier (more robust and stable)
const getUserIdentifier = async () => {
  // Check if we already have a stable ID for this session
  const cachedId = sessionStorage.getItem('stable_user_id');
  if (cachedId) return cachedId;

  let fingerprint = localStorage.getItem('user_fingerprint');
  if (!fingerprint) {
    fingerprint = Math.random().toString(36).substring(2) + Date.now().toString(36);
    localStorage.setItem('user_fingerprint', fingerprint);
  }

  let finalId = fingerprint;
  try {
    const response = await fetch('https://api.ipify.org?format=json');
    const data = await response.json();
    const ip = data.ip;
    
    // Combine IP and fingerprint for a more stable ID
    let hash = 0;
    const combined = ip + fingerprint;
    for (let i = 0; i < combined.length; i++) {
      const char = combined.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    finalId = Math.abs(hash).toString();
  } catch (e) {
    // Fallback to fingerprint if IP fetch fails
  }
  
  sessionStorage.setItem('stable_user_id', finalId);
  return finalId;
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
  const [appSettings, setAppSettings] = useState<any>(null);

  const processedSession = React.useRef(false);

  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    if (processedSession.current) return;
    
    // Robust session extraction
    const getSessionFromUrl = () => {
      const url = window.location.href;
      console.log("Current URL for session extraction:", url);
      
      // 1. Standard URLSearchParams (check multiple common names)
      const searchParams = new URLSearchParams(window.location.search);
      const hashParams = new URLSearchParams(window.location.hash.includes('?') ? window.location.hash.split('?')[1] : '');
      
      const session = searchParams.get('session') || 
                      hashParams.get('session') || 
                      searchParams.get('session_id') || 
                      hashParams.get('session_id') ||
                      searchParams.get('id') ||
                      hashParams.get('id');
      
      if (session) {
        console.log("Found session via URLSearchParams:", session);
        return session.trim().replace(/\/$/, '');
      }
      
      // 2. Regex fallback (handles mangled URLs like /&session=ID or /?session=ID/ or /session/ID)
      // This regex is more aggressive and looks for anything that looks like a session ID (5-30 chars)
      const sessionMatch = url.match(/[?&/](?:session|session_id|id)[=/]([a-zA-Z0-9_-]{5,30})/i);
      if (sessionMatch && sessionMatch[1]) {
        console.log("Found session via Regex:", sessionMatch[1]);
        return sessionMatch[1].trim().replace(/\/$/, '');
      }
      
      // 3. Last resort: check if there's a 10-20 char alphanumeric string at the end of the URL
      const endMatch = url.match(/[?&/]([a-zA-Z0-9]{10,20})(?:\/|$)($|\?)/);
      if (endMatch && endMatch[1]) {
        console.log("Found potential session ID at end of URL:", endMatch[1]);
        return endMatch[1];
      }

      // 4. Fallback to localStorage if we just came back from a redirect
      // REMOVED: This was too easy to bypass by just refreshing the page.
      // We will only use localStorage fallback in the manual "Try Again" button.
      
      return null;
    };

    const session = getSessionFromUrl();
    const searchParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.includes('?') ? window.location.hash.split('?')[1] : '');
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
    const fetchInitialData = async () => {
      try {
        const settingsDoc = await getDoc(doc(db, 'settings', 'linkShortener'));
        if (settingsDoc.exists()) {
          setAppSettings(settingsDoc.data());
        }
      } catch (err) {
        console.error("Error fetching initial data:", err);
      }
    };
    fetchInitialData();
  }, []);

  const [lastSessionId, setLastSessionId] = useState<string | null>(null);

  const handleReturnSession = async (sessionId: string) => {
    // Sanitize the session ID (remove trailing slashes or whitespace)
    const cleanSessionId = sessionId.trim().replace(/\/$/, '');
    
    if (!cleanSessionId || cleanSessionId.length < 5) {
      setError('Invalid session ID format. Please generate a new link.');
      return;
    }

    processedSession.current = true;
    setLastSessionId(cleanSessionId);
    setIsProcessing(true);
    setError(null);
    
    console.log("Processing return session:", cleanSessionId);
    
    // Small delay to ensure UI is ready
    await new Promise(resolve => setTimeout(resolve, 100));

    try {
      // Verify session in Firestore with multiple retries
      const sessionRef = doc(db, 'sessions', cleanSessionId);
      let sessionDoc = await getDoc(sessionRef);
      
      // Retry loop (10 attempts with 1s delay)
      if (!sessionDoc.exists()) {
        console.warn("Session not found in Firestore, starting retry loop...");
        for (let i = 0; i < 10; i++) {
          setLoadingState(`Verifying session (Attempt ${i + 1}/10)...`);
          await new Promise(resolve => setTimeout(resolve, 1000));
          sessionDoc = await getDoc(sessionRef);
          if (sessionDoc.exists()) break;
        }
      }

      if (!sessionDoc.exists()) {
        // Final fallback: check if it's in localStorage but not in Firestore
        const localSession = localStorage.getItem('key_session');
        if (localSession && localSession === cleanSessionId) {
          throw new Error(`Session ID [${cleanSessionId}] was created locally but not found in our database. This can happen if your internet connection was interrupted. Please try clicking "Verify Again" or generate a new link.`);
        }
        throw new Error(`Session [${cleanSessionId}] not found. This can happen if the link was generated too long ago or opened in a different browser. Please ensure you are using the same browser.`);
      }
      
      const sessionData = sessionDoc.data();
      const userId = await getUserIdentifier();
      const currentFingerprint = localStorage.getItem('user_fingerprint');
      
      // Check if either the combined hash matches OR the persistent fingerprint matches
      // This provides a fallback if the IP changes during the process
      const isUserMatch = sessionData.userId === userId || 
                          (sessionData.fingerprint && sessionData.fingerprint === currentFingerprint);

      if (!isUserMatch) {
        console.warn("User mismatch detected:", { 
          sessionUserId: sessionData.userId, 
          currentUserId: userId,
          sessionFingerprint: sessionData.fingerprint,
          currentFingerprint
        });
        throw new Error('Security violation: Session mismatch. Please use your own link on the same device.');
      }
      
      if (sessionData.status !== 'pending') {
        throw new Error('This session has already been used or is invalid.');
      }

      // Minimum time check: Session must be at least 15 seconds old to ensure they went through the shortener
      const sessionAge = Date.now() - (sessionData.createdAt || 0);
      if (sessionAge < 15000) {
        console.warn("Session too new, likely a bypass attempt:", sessionAge);
        throw new Error('Please wait for the link shortener to complete. Do not refresh or go back too early.');
      }

      await claimKeyFromDb(cleanSessionId);
      // Only remove on success
      localStorage.removeItem('key_session');
    } catch (e: any) {
      console.error("Session processing error:", e);
      setError(e.message || 'Error processing session');
    } finally {
      setIsProcessing(false);
      // Clean up the URL but keep it in state for retry if needed
      const cleanUrl = window.location.origin + window.location.pathname + window.location.hash.split('?')[0];
      window.history.replaceState({}, document.title, cleanUrl);
    }
  };

  const retryClaim = () => {
    if (lastSessionId) {
      setIsProcessing(true);
      handleReturnSession(lastSessionId);
    } else {
      const session = localStorage.getItem('key_session');
      if (session) {
        setIsProcessing(true);
        handleReturnSession(session);
      } else {
        generateKey();
      }
    }
  };

  const claimKeyFromDb = async (sessionId: string, retries = 3) => {
    setLoading(true);
    setError(null);
    setLoadingState('Security check: AdBlocker...');
    
    try {
      // Relaxed checks: Log warnings instead of blocking if they fail
      const isAdBlockerActive = await checkAdBlocker();
      if (isAdBlockerActive) {
        console.warn('AdBlocker detected, but continuing...');
      }

      const isVPNActive = await checkVPN();
      if (isVPNActive) {
        console.warn('VPN/Proxy detected, but continuing...');
      }
    } catch (err: any) {
      console.error("Security check error (ignored):", err);
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

        // Update session status to completed first (Atomic-ish)
        const sessionRef = doc(db, 'sessions', sessionId);
        await updateDoc(sessionRef, {
          status: 'completed',
          completedAt: Date.now(),
          keyValue: keyData.value
        });

        // Mark key as used
        await updateDoc(doc(db, 'keys', keyDoc.id), {
          isUsed: true,
          usedAt: Date.now(),
          claimedBy: sessionId // Link to the session for audit
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
        }

        // Log the final claim
        try {
          const userId = await getUserIdentifier();
          const shortenerIndex = parseInt(localStorage.getItem('last_shortener_index') || '1');
          await addDoc(collection(db, 'linkLogs'), {
            userId,
            shortenerIndex,
            timestamp: Date.now(),
            status: 'claimed',
            keyValue: keyData.value,
            sessionId
          });
        } catch (logErr) {
          console.error("Failed to log key claim", logErr);
        }

        setKey(keyData.value);
        setLoading(false);
        setLoadingState(null);
        return;
      } catch (err: any) {
        console.error(`Claim attempt ${i + 1} failed:`, err);
        
        if (i === retries - 1) {
          setError('Failed to assign key: ' + (err.message || 'Unknown error'));
        }
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

      setLoadingState('Preparing link...');
      
      // Create a secure session in Firestore
      const fingerprint = localStorage.getItem('user_fingerprint') || '';
      
      // Generate a shorter 10-character session ID to prevent truncation by link shorteners
      const generateShortId = () => {
        const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < 10; i++) {
          result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
      };
      
      const sessionId = generateShortId();
      const sessionRef = doc(db, 'sessions', sessionId);
      
      console.log("Creating session:", sessionId);
      localStorage.setItem('key_session', sessionId);
      setLastSessionId(sessionId);
      
      try {
        await setDoc(sessionRef, {
          userId,
          fingerprint,
          createdAt: Date.now(),
          status: 'pending'
        });
        // Set redirect flag for fallback
        localStorage.setItem('is_redirecting', 'true');
        // Small delay to ensure Firestore write is propagated
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (sessionErr) {
        console.error("Failed to create session", sessionErr);
        throw new Error("Failed to initialize session. Please check your internet connection.");
      }

      setLoadingState('Redirecting to link shortener...');
      
        // Fetch link shortener settings
        let apiUrl = 'https://xtglinks.com/st';
        let apiToken = '0d677cf4096a7a8cfb737c54f7fc8b3a4d043669';
        
        try {
          const settingsDoc = await getDoc(doc(db, 'settings', 'linkShortener'));
          let shortenerIndex = 1;
          if (settingsDoc.exists()) {
            const settingsData = settingsDoc.data();
            // Alternate shorteners based on daily count
            // 0, 2, 4... -> Shortener 1
            // 1, 3, 5... -> Shortener 2
            if (dailyCount % 2 === 0) {
              // Use Shortener 1
              apiUrl = settingsData.linkShortener1Url || settingsData.linkShortenerUrl || apiUrl;
              apiToken = settingsData.linkShortener1ApiToken || settingsData.linkShortenerApiToken || apiToken;
              shortenerIndex = 1;
            } else {
              // Use Shortener 2
              apiUrl = settingsData.linkShortener2Url || settingsData.linkShortener1Url || settingsData.linkShortenerUrl || apiUrl;
              apiToken = settingsData.linkShortener2ApiToken || settingsData.linkShortener1ApiToken || settingsData.linkShortenerApiToken || apiToken;
              shortenerIndex = 2;
            }
          }

        // Log the usage
        try {
          localStorage.setItem('last_shortener_index', shortenerIndex.toString());
          await addDoc(collection(db, 'linkLogs'), {
            userId,
            shortenerIndex,
            timestamp: Date.now(),
            status: 'redirected'
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
        {/* Announcement Banner */}
        {appSettings?.announcement && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl flex items-center gap-3"
          >
            <div className="p-1.5 bg-emerald-500/20 rounded-lg">
              <Info className="w-4 h-4 text-emerald-400" />
            </div>
            <p className="text-xs text-emerald-100 font-medium leading-tight">
              {appSettings.announcement}
            </p>
          </motion.div>
        )}

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
            {appSettings?.maintenanceMode ? (
              <motion.div
                key="maintenance"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="flex flex-col items-center text-center py-4"
              >
                <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-6">
                  <AlertTriangle className="w-8 h-8 text-red-400" />
                </div>
                <h2 className="text-xl font-bold text-white mb-2">Maintenance Mode</h2>
                <p className="text-zinc-400 text-sm leading-relaxed">
                  We are currently updating our mod menu. Key generation is temporarily disabled. Please check back later!
                </p>
                {appSettings.telegramUrl && (
                  <a
                    href={appSettings.telegramUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-6 flex items-center gap-2 px-6 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-sm font-semibold transition-colors"
                  >
                    <Send className="w-4 h-4" />
                    Join Telegram
                  </a>
                )}
              </motion.div>
            ) : !key ? (
              <motion.div
                key="generate"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="flex flex-col items-center"
              >
                {/* Stats */}
                <div className="w-full grid grid-cols-1 gap-3 mb-8">
                  <div className="bg-black/30 border border-white/5 rounded-2xl p-4 flex flex-col items-center">
                    <Check className="w-4 h-4 text-emerald-500 mb-2" />
                    <span className="text-lg font-bold text-white">Online</span>
                    <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">Status</span>
                  </div>
                </div>

                {isProcessing ? (
                  <div className="flex flex-col items-center gap-4 py-8">
                    <Loader2 className="w-10 h-10 text-emerald-500 animate-spin" />
                    <div className="flex flex-col items-center gap-1">
                      <p className="text-emerald-400 font-medium animate-pulse">{loadingState || 'Verifying session...'}</p>
                      <button 
                        onClick={() => window.location.reload()}
                        className="text-[10px] text-zinc-500 hover:text-zinc-300 uppercase tracking-widest font-bold mt-2"
                      >
                        Stuck? Click to refresh
                      </button>
                    </div>
                  </div>
                ) : (
                    <button
                      onClick={generateKey}
                      disabled={loading || isProcessing}
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
                      <div className="flex flex-col gap-2">
                        <p className="text-sm font-medium leading-relaxed">{error}</p>
                        {lastSessionId && (
                          <p className="text-[10px] opacity-50 font-mono break-all">
                            ID: {lastSessionId}
                          </p>
                        )}
                      </div>
                    </div>
                    
                    <button
                      onClick={retryClaim}
                      className="text-xs font-bold uppercase tracking-wider text-emerald-400 hover:text-emerald-300 transition-colors self-end flex items-center gap-2"
                    >
                      <Loader2 className={cn("w-3 h-3", (loading || isProcessing) && "animate-spin")} />
                      {(loading || isProcessing) ? 'Retrying...' : 'Try Again'}
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
        
        {/* Social Links & Info */}
        <div className="mt-8 flex flex-col items-center gap-6">
          <div className="flex items-center gap-4">
            {appSettings?.telegramUrl && (
              <a
                href={appSettings.telegramUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="p-3 rounded-2xl bg-white/5 border border-white/10 text-zinc-400 hover:text-emerald-400 hover:border-emerald-500/30 transition-all group"
                title="Telegram"
              >
                <Send className="w-5 h-5 group-hover:scale-110 transition-transform" />
              </a>
            )}
            {appSettings?.discordUrl && (
              <a
                href={appSettings.discordUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="p-3 rounded-2xl bg-white/5 border border-white/10 text-zinc-400 hover:text-indigo-400 hover:border-indigo-500/30 transition-all group"
                title="Discord"
              >
                <MessageSquare className="w-5 h-5 group-hover:scale-110 transition-transform" />
              </a>
            )}
            {appSettings?.youtubeUrl && (
              <a
                href={appSettings.youtubeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="p-3 rounded-2xl bg-white/5 border border-white/10 text-zinc-400 hover:text-red-500 hover:border-red-500/30 transition-all group"
                title="YouTube"
              >
                <Youtube className="w-5 h-5 group-hover:scale-110 transition-transform" />
              </a>
            )}
          </div>

          {/* How to use */}
          <div className="w-full bg-white/5 border border-white/5 rounded-3xl p-6">
            <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-4 flex items-center gap-2">
              <Info className="w-4 h-4" />
              How to get your key
            </h3>
            <ul className="space-y-3">
              {[
                "Click the 'Generate Key' button above",
                "Complete the link shortener steps",
                "You will be redirected back with your key",
                "Copy and paste the key into the mod menu"
              ].map((step, i) => (
                <li key={i} className="flex items-start gap-3 text-xs text-zinc-400 leading-relaxed">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center text-[10px] font-bold">
                    {i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col items-center gap-4">
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
        </div>
      </motion.div>
    </div>
  );
}
