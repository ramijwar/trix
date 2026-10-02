import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useStore } from './lib/store';
import { useNav } from './lib/nav';
import { unlockAudio } from './lib/audio';
import { Toasts } from './components/ui';
import { AuthScreen } from './screens/AuthScreen';
import { ServerSetupScreen } from './screens/ServerSetup';
import { LobbyScreen } from './screens/LobbyScreen';
import { RoomScreen } from './screens/RoomScreen';
import { LeaderboardScreen } from './screens/LeaderboardScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { ShopScreen } from './screens/ShopScreen';
import { SettingsScreen } from './screens/SettingsScreen';

export default function App() {
  const booted = useStore((s) => s.booted);
  const user = useStore((s) => s.user);
  const needsServerSetup = useStore((s) => s.needsServerSetup);
  const boot = useStore((s) => s.boot);
  const view = useNav((s) => s.view);

  useEffect(() => {
    void boot();
  }, [boot]);

  // زر الرجوع في أندرويد: يخرج من الغرفة/الشاشة بدل إغلاق التطبيق
  useEffect(() => {
    const w = window as unknown as { __trixBack?: () => boolean };
    w.__trixBack = () => {
      const nav = useNav.getState();
      if (nav.view === 'room') {
        nav.leaveRoom();
        return true;
      }
      if (nav.view !== 'lobby') {
        nav.go('lobby');
        return true;
      }
      return false;
    };
    return () => {
      delete w.__trixBack;
    };
  }, []);

  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  if (!booted) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <motion.div
          initial={{ scale: 0.7, opacity: 0, rotate: -8 }}
          animate={{ scale: 1, opacity: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 200, damping: 18 }}
          className="text-6xl"
        >
          🃏
        </motion.div>
        <div className="gold-text text-2xl font-black">طرنيب أونلاين</div>
        <div className="flex items-center gap-2 text-sm text-ink-300">
          <span className="size-4 animate-spin rounded-full border-2 border-gold-500 border-t-transparent" />
          جارٍ التحميل…
        </div>
      </div>
    );
  }

  if (needsServerSetup) {
    return (
      <>
        <ServerSetupScreen />
        <Toasts />
      </>
    );
  }

  if (!user) {
    return (
      <>
        <AuthScreen />
        <Toasts />
      </>
    );
  }

  const screens: Record<string, React.ReactNode> = {
    lobby: <LobbyScreen />,
    room: <RoomScreen />,
    leaderboard: <LeaderboardScreen />,
    profile: <ProfileScreen />,
    shop: <ShopScreen />,
    settings: <SettingsScreen />,
  };

  return (
    <>
      <div className="mx-auto flex h-full max-w-3xl flex-col">
        <AnimatePresence mode="wait">
          <motion.div
            key={view}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.22 }}
            className="flex min-h-0 flex-1 flex-col"
          >
            {screens[view] ?? <LobbyScreen />}
          </motion.div>
        </AnimatePresence>
      </div>
      <Toasts />
    </>
  );
}
