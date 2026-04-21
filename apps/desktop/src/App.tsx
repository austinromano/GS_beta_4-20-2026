import { useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useAuthStore } from './stores/authStore';
import { useBookingsStore } from './stores/bookingsStore';
import PluginLayout from './components/plugin/PluginLayout';
import LoginPage from './pages/LoginPage';
import ErrorBoundary from './components/common/ErrorBoundary';
import OfflineScreen from './components/onboarding/OfflineScreen';
import BookingInviteToast from './components/messages/BookingInviteToast';
import ProfileOverlay from './components/social/ProfileOverlay';
import { useOnlineStatus } from './hooks/useOnlineStatus';

export default function App() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const currentUserId = useAuthStore((s) => s.user?.id);
  const bootstrapBookings = useBookingsStore((s) => s.bootstrap);
  const online = useOnlineStatus();

  // Bootstrap bookings at the app level (not inside the Messages page) so
  // the socket handler is attached regardless of which section the user is
  // viewing. Incoming invites need to trigger the global toast.
  useEffect(() => {
    if (!isAuthenticated || !currentUserId) return;
    bootstrapBookings();
  }, [isAuthenticated, currentUserId, bootstrapBookings]);

  return (
    <ErrorBoundary>
      {isAuthenticated ? <PluginLayout /> : <LoginPage />}
      {isAuthenticated && <BookingInviteToast />}
      {isAuthenticated && <ProfileOverlay />}
      <AnimatePresence>{!online && <OfflineScreen key="offline" />}</AnimatePresence>
    </ErrorBoundary>
  );
}
