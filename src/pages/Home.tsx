import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Key, Copy, Check, ShieldAlert, Loader2, Settings } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Link } from 'react-router-dom';
import { collection, query, where, orderBy, limit, getDocs, updateDoc, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';

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

  useEffect(() => {
    if (processedSession.current) return;
    
    // Check if the user is returning from the link shortener
    const params = new URLSearchParams(window.location.search);
    const session = params.get('session');
    const claimedKey = params.get('key'); // Legacy support

    if (session) {
      processedSession.current = true;
      const savedSession = localStorage.getItem('key_session');
      // Clean up the URL
      window.history.replaceState({}, document.title, window.location.pathname);

      if (session === savedSession) {
        localStorage.removeItem('key_session');
        claimKeyFromDb();
      } else {
        setError('Invalid or expired session. Please generate a new key.');
      }
    } else if (claimedKey) {
      processedSession.current = true;
      setKey(claimedKey);
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const claimKeyFromDb = async (retries = 3) => {
    setLoading(true);
    setError(null);
    setLoadingState('Assigning your key...');

    for (let i = 0; i < retries; i++) {
      try {
        const keysRef = collection(db, 'keys');
        const q = query(
          keysRef,
          where('isUsed', '==', false),
          orderBy('createdAt', 'asc'),
          limit(1)
        );

        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
          throw new Error('No keys available. Please check back later.');
        }

        const keyDoc = querySnapshot.docs[0];
        const keyData = keyDoc.data();

        // Try to mark it as used. If another user claims it at the exact same time,
        // Firestore security rules will reject this update, and we will catch the error and retry.
        await updateDoc(doc(db, 'keys', keyDoc.id), {
          isUsed: true,
          usedAt: Date.now()
        });

        // Success!
        setKey(keyData.value);
        setLoading(false);
        setLoadingState(null);
        return;
      } catch (err: any) {
        console.error(`Claim attempt ${i + 1} failed:`, err);
        if (i === retries - 1) {
          setError(err.message || 'Failed to assign key due to high traffic. Please try again.');
        }
        // Wait 500ms before retrying
        await new Promise(res => setTimeout(res, 500));
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
      setLoadingState('Preparing link...');
      
      // First, verify we actually have keys available before sending user to shortener
      const keysRef = collection(db, 'keys');
      const q = query(keysRef, where('isUsed', '==', false), limit(1));
      const querySnapshot = await getDocs(q);
      
      if (querySnapshot.empty) {
        throw new Error('No keys available right now. Please check back later.');
      }

      // Generate a session ID to verify when they return
      const sessionId = Math.random().toString(36).substring(2, 15);
      localStorage.setItem('key_session', sessionId);

      setLoadingState('Redirecting to link shortener...');
      
      // Fetch link shortener settings
      let apiUrl = 'https://xtglinks.com/st';
      let apiToken = '0d677cf4096a7a8cfb737c54f7fc8b3a4d043669';
      
      try {
        const settingsDoc = await getDoc(doc(db, 'settings', 'linkShortener'));
        if (settingsDoc.exists()) {
          const settingsData = settingsDoc.data();
          if (settingsData.linkShortenerUrl) apiUrl = settingsData.linkShortenerUrl;
          if (settingsData.linkShortenerApiToken) apiToken = settingsData.linkShortenerApiToken;
        }
      } catch (settingsErr) {
        console.error("Failed to fetch settings, using defaults", settingsErr);
      }
      
      // Construct the destination URL with the session ID
      const returnUrl = `${window.location.origin}/?session=${sessionId}`;
      
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

                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-6 flex items-start gap-3 text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl p-4 w-full"
                  >
                    <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" />
                    <p className="text-sm font-medium leading-relaxed">{error}</p>
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
