interface AvatarProps {
  name: string;
  src?: string | null;
  colour?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  // If provided, the avatar becomes clickable and opens that user's profile
  // overlay. Passing null/undefined keeps the avatar purely decorative.
  userId?: string | null;
}

const sizeMap = {
  xs: 'w-6 h-6 text-[9px]',
  sm: 'w-8 h-8 text-[11px]',
  md: 'w-9 h-9 text-[12px]',
  lg: 'w-11 h-11 text-sm',
  xl: 'w-16 h-16 text-lg',
};

// Generate a consistent color from a name
function nameToColor(name: string): string {
  const colors = ['#5865F2', '#57F287', '#FEE75C', '#EB459E', '#ED4245', '#00FFC8', '#F0B232', '#00B4D8'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  return colors[Math.abs(hash) % colors.length];
}

export default function Avatar({ name, src, colour, size = 'md', userId }: AvatarProps) {
  const initials = name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const bg = colour || nameToColor(name);

  const openProfile = userId
    ? (e: React.MouseEvent) => {
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent('ghost-open-profile', { detail: { userId } }));
      }
    : undefined;

  const interactive = userId
    ? 'cursor-pointer hover:brightness-110 transition-[filter]'
    : '';

  if (src) {
    const base = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1').replace(/\/api\/v1$/, '');
    const imgSrc = src.startsWith('/') ? `${base}${src}` : src;
    return (
      <img
        src={imgSrc}
        alt={name}
        draggable={false}
        onClick={openProfile}
        title={userId ? name : undefined}
        className={`${sizeMap[size]} rounded-[14px] object-cover shrink-0 select-none ${interactive}`}
      />
    );
  }

  return (
    <div
      onClick={openProfile}
      title={userId ? name : undefined}
      className={`${sizeMap[size]} rounded-[14px] flex items-center justify-center font-bold shrink-0 ${interactive}`}
      style={{ backgroundColor: bg, color: '#000' }}
    >
      {initials}
    </div>
  );
}
