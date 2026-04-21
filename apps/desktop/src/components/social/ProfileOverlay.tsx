import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Avatar from '../common/Avatar';
import { API_BASE } from '../../lib/constants';
import { useAuthStore } from '../../stores/authStore';

interface ProfileData {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  createdAt: string;
  followerCount: number;
  followingCount: number;
  postCount: number;
  isFollowing: boolean;
}

/**
 * Global profile overlay. Listens for the `ghost-open-profile` window event
 * (fired by clicking any Avatar that has a userId prop) and renders a modal
 * with that user's public profile. Mounted once at the app root so it works
 * from any view — messages, community rooms, calendar, feed, sidebar, etc.
 */
export default function ProfileOverlay() {
  const me = useAuthStore((s) => s.user);
  const [openId, setOpenId] = useState<string | null>(null);
  const [data, setData] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const authHeader = { Authorization: `Bearer ${localStorage.getItem('ghost_token') || ''}` };

  const close = useCallback(() => {
    setOpenId(null);
    setData(null);
    setError('');
  }, []);

  // Listen for open events anywhere in the app.
  useEffect(() => {
    const handler = (e: Event) => {
      const uid = (e as CustomEvent<{ userId: string }>).detail?.userId;
      if (!uid) return;
      setOpenId(uid);
    };
    window.addEventListener('ghost-open-profile', handler);
    return () => window.removeEventListener('ghost-open-profile', handler);
  }, []);

  // Fetch profile data when opened.
  useEffect(() => {
    if (!openId) return;
    setLoading(true);
    setError('');
    fetch(`${API_BASE}/social/profile/${openId}`, { headers: authHeader })
      .then((r) => r.json())
      .then((res) => {
        if (res?.data) setData(res.data);
        else setError(res?.error || 'Profile not found');
      })
      .catch((err) => setError(err?.message || 'Failed to load profile'))
      .finally(() => setLoading(false));
  }, [openId]);

  // ESC to close.
  useEffect(() => {
    if (!openId) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [openId, close]);

  const toggleFollow = async () => {
    if (!data) return;
    const optimistic = { ...data, isFollowing: !data.isFollowing, followerCount: data.followerCount + (data.isFollowing ? -1 : 1) };
    setData(optimistic);
    try {
      const res = await fetch(`${API_BASE}/social/follow/${data.id}`, { method: 'POST', headers: authHeader });
      const json = await res.json();
      if (json?.data?.following !== undefined) {
        setData({ ...optimistic, isFollowing: json.data.following });
      }
    } catch (err) {
      // roll back on error
      setData(data);
    }
  };

  const isMe = !!data && me?.id === data.id;

  return (
    <AnimatePresence>
      {openId && (
        <motion.div
          key="profile-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[90] flex items-center justify-center p-6"
          style={{ background: 'rgba(10,4,18,0.72)', backdropFilter: 'blur(6px)' }}
          onClick={close}
        >
          <motion.div
            key="profile-card"
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            className="w-full max-w-[420px] rounded-2xl glass glass-glow p-6 relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={close}
              title="Close"
              className="absolute top-3 right-3 w-7 h-7 flex items-center justify-center rounded text-white/50 hover:text-white hover:bg-white/10 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>

            {loading && (
              <div className="flex items-center justify-center py-12">
                <div className="text-[12px] text-white/40">Loading profile…</div>
              </div>
            )}
            {error && !loading && (
              <div className="text-center py-8">
                <p className="text-[13px] text-red-300">{error}</p>
              </div>
            )}
            {data && !loading && (
              <>
                <div className="flex items-center gap-4 mb-4">
                  <Avatar name={data.displayName} src={data.avatarUrl} size="xl" />
                  <div className="min-w-0 flex-1">
                    <h2 className="text-[20px] font-bold text-white leading-tight truncate">{data.displayName}</h2>
                    <p className="text-[11px] text-white/40 mt-0.5">
                      Joined {new Date(data.createdAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-5 text-[13px] mb-5 px-1">
                  <span className="text-white/60"><span className="font-bold text-white">{data.followerCount}</span> followers</span>
                  <span className="text-white/60"><span className="font-bold text-white">{data.followingCount}</span> following</span>
                  <span className="text-white/60"><span className="font-bold text-white">{data.postCount}</span> posts</span>
                </div>

                {!isMe && (
                  <button
                    onClick={toggleFollow}
                    className={`w-full h-10 rounded-xl text-[13px] font-bold text-white transition-all hover:brightness-110 active:scale-[0.98]`}
                    style={{
                      background: data.isFollowing
                        ? 'rgba(255,255,255,0.08)'
                        : 'linear-gradient(135deg, #7C3AED 0%, #4C1D95 100%)',
                      boxShadow: data.isFollowing ? 'inset 0 0 0 1px rgba(255,255,255,0.1)' : '0 2px 8px rgba(124,58,237,0.4)',
                    }}
                  >
                    {data.isFollowing ? 'Following' : 'Follow'}
                  </button>
                )}
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
