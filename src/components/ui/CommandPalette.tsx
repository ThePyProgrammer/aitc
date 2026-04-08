import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Radar,
  Building2,
  MessageSquare,
  AlertTriangle,
} from 'lucide-react';
import { usePaletteStore } from '../../stores/paletteStore';

const viewItems = [
  { label: 'RADAR', sublabel: 'Go to Radar View', path: '/radar', icon: Radar },
  { label: 'TOWER', sublabel: 'Go to Tower View', path: '/tower', icon: Building2 },
  { label: 'COMMS', sublabel: 'Go to Comms View', path: '/comms', icon: MessageSquare },
  { label: 'CONFLICTS', sublabel: 'Go to Conflicts View', path: '/conflicts', icon: AlertTriangle },
] as const;

export function CommandPalette() {
  const open = usePaletteStore((s) => s.open);
  const query = usePaletteStore((s) => s.query);
  const recentActions = usePaletteStore((s) => s.recentActions);
  const setOpen = usePaletteStore((s) => s.setOpen);
  const setQuery = usePaletteStore((s) => s.setQuery);
  const addRecentAction = usePaletteStore((s) => s.addRecentAction);

  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // Filter items based on query
  const filteredItems = query
    ? viewItems.filter(
        (item) =>
          item.label.toLowerCase().includes(query.toLowerCase()) ||
          item.sublabel.toLowerCase().includes(query.toLowerCase())
      )
    : viewItems;

  // Recent items for display (only when no query)
  const recentItems = !query
    ? recentActions
        .map((path) => viewItems.find((item) => item.path === path))
        .filter(Boolean) as typeof viewItems[number][]
    : [];

  // All displayable items for keyboard navigation
  const allItems = [...filteredItems];

  // Reset selected index when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Global keyboard shortcut: Ctrl+Shift+P
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'P') {
        e.preventDefault();
        setOpen(!open);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, setOpen]);

  // Focus input when palette opens
  useEffect(() => {
    if (open) {
      // Small delay for DOM rendering
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [open]);

  const navigateToItem = useCallback(
    (path: string) => {
      navigate(path);
      addRecentAction(path);
      setOpen(false);
    },
    [navigate, addRecentAction, setOpen]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % allItems.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + allItems.length) % allItems.length);
        break;
      case 'Enter':
        e.preventDefault();
        if (allItems[selectedIndex]) {
          navigateToItem(allItems[selectedIndex].path);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        break;
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
      onClick={() => setOpen(false)}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" />

      {/* Modal */}
      <div
        className="relative z-10 w-full max-w-[480px]"
        style={{
          backgroundColor: 'rgba(38, 38, 38, 0.6)',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(73, 72, 71, 0.1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input field */}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="SEARCH_MODE..."
          className="w-full bg-surface-container-lowest p-4 text-on-surface font-mono text-sm placeholder:text-on-surface-variant/40 outline-none"
        />

        {/* Recent actions section */}
        {recentItems.length > 0 && (
          <div>
            <div className="px-4 py-2 text-[10px] font-headline uppercase tracking-widest text-on-surface-variant/40">
              RECENT
            </div>
            {recentItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={`recent-${item.path}`}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left text-on-surface-variant transition-colors duration-150 hover:bg-primary/5 hover:text-on-surface"
                  onClick={() => navigateToItem(item.path)}
                >
                  <Icon size={16} strokeWidth={1.5} className="shrink-0" />
                  <div className="flex flex-col">
                    <span className="font-headline text-xs font-bold uppercase tracking-widest">
                      {item.label}
                    </span>
                    <span className="font-mono text-[10px] text-on-surface-variant/60">
                      {item.sublabel}
                    </span>
                  </div>
                </button>
              );
            })}
            {/* Divider between recent and all */}
            <div className="mx-4 border-t border-outline-variant/10" />
          </div>
        )}

        {/* Results list */}
        <div className="max-h-[300px] overflow-y-auto">
          {query && (
            <div className="px-4 py-2 text-[10px] font-headline uppercase tracking-widest text-on-surface-variant/40">
              RESULTS
            </div>
          )}
          {allItems.map((item, index) => {
            const Icon = item.icon;
            const isSelected = index === selectedIndex;
            return (
              <button
                key={item.path}
                className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150 ${
                  isSelected
                    ? 'bg-primary/5 text-on-surface'
                    : 'text-on-surface-variant hover:bg-primary/5 hover:text-on-surface'
                }`}
                onClick={() => navigateToItem(item.path)}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <Icon size={16} strokeWidth={1.5} className="shrink-0" />
                <div className="flex flex-col">
                  <span className="font-headline text-xs font-bold uppercase tracking-widest">
                    {item.label}
                  </span>
                  <span className="font-mono text-[10px] text-on-surface-variant/60">
                    {item.sublabel}
                  </span>
                </div>
              </button>
            );
          })}
          {allItems.length === 0 && (
            <div className="px-4 py-6 text-center font-mono text-xs text-on-surface-variant/40">
              NO_RESULTS_FOUND
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
