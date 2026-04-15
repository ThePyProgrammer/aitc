import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { useAgentStore } from '../../stores/agentStore';
import { commands } from '../../bindings';

interface DeployDialogProps {
  open: boolean;
  onClose: () => void;
}

const agentTypes = [
  { id: 'claude-code', label: 'Claude Code', protocol: 'hooks' },
  { id: 'codex', label: 'Codex', protocol: 'cli' },
  { id: 'opencode', label: 'OpenCode', protocol: 'cli' },
  { id: 'generic', label: 'Generic', protocol: 'custom' },
] as const;

export function DeployDialog({ open, onClose }: DeployDialogProps) {
  const [selectedType, setSelectedType] = useState<string>('claude-code');
  const [cwd, setCwd] = useState('');
  const [intent, setIntent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLaunching, setIsLaunching] = useState(false);
  const [availableTypes, setAvailableTypes] = useState<string[] | null>(null);
  const launchAgent = useAgentStore((s) => s.launchAgent);

  // Refresh the installed-CLI list each time the dialog opens so PATH changes
  // (e.g. installing `codex` without restarting AITC) are picked up.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    commands.listAvailableAgentTypes().then((res) => {
      if (cancelled) return;
      if (res.status === 'ok') {
        setAvailableTypes(res.data);
        if (!res.data.includes(selectedType) && res.data.length > 0) {
          setSelectedType(res.data[0]);
        }
      } else {
        // If the probe fails, fall back to showing everything so we don't
        // strand the user.
        setAvailableTypes(null);
      }
    });
    return () => {
      cancelled = true;
    };
    // selectedType intentionally excluded -- we only want to reconcile on open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const visibleAgentTypes = availableTypes
    ? agentTypes.filter((t) => availableTypes.includes(t.id))
    : agentTypes;

  const handleLaunch = async () => {
    if (!cwd.trim()) {
      setError('Working directory is required');
      return;
    }
    setError(null);
    setIsLaunching(true);
    try {
      await launchAgent(selectedType, cwd.trim(), intent.trim() || undefined);
      // Success: reset and close
      setCwd('');
      setIntent('');
      setSelectedType('claude-code');
      onClose();
    } catch (e) {
      setError(`LAUNCH_FAILED: ${String(e)}`);
    } finally {
      setIsLaunching(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.15 }}
            className="w-[480px] bg-surface/80 backdrop-blur-xl border border-outline/10"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-outline/10">
              <h3 className="font-headline text-sm font-bold uppercase tracking-widest text-on-surface">
                DEPLOY_AGENT
              </h3>
              <button
                onClick={onClose}
                className="text-on-surface-variant hover:text-on-surface transition-colors"
                aria-label="Close deploy dialog"
              >
                <X size={18} strokeWidth={1.5} />
              </button>
            </div>

            {/* Agent type selector */}
            <div className="px-6 py-4">
              <label className="font-headline text-[10px] font-bold uppercase tracking-widest text-on-surface-variant block mb-2">
                AGENT_TYPE
              </label>
              <div className="flex flex-col gap-1">
                {visibleAgentTypes.length === 0 && (
                  <div className="px-4 py-3 bg-surface-container border-l-2 border-error/40">
                    <span className="font-mono text-xs text-on-surface-variant">
                      No agent CLIs detected on PATH. Install at least one of
                      claude, codex, or opencode to deploy.
                    </span>
                  </div>
                )}
                {visibleAgentTypes.map((type) => (
                  <button
                    key={type.id}
                    onClick={() => setSelectedType(type.id)}
                    className={`flex h-11 items-center px-4 transition-colors duration-150 ${
                      selectedType === type.id
                        ? 'bg-surface-container border-l-2 border-primary text-on-surface'
                        : 'bg-surface-container text-on-surface-variant border-l-2 border-transparent hover:bg-surface-container-high'
                    }`}
                  >
                    <span className="font-mono text-xs font-bold">{type.label}</span>
                    <span className="ml-auto font-mono text-[10px] text-on-surface-variant">
                      {type.protocol}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Working directory */}
            <div className="px-6 pb-4">
              <label className="font-headline text-[10px] font-bold uppercase tracking-widest text-on-surface-variant block mb-2">
                WORKING_DIRECTORY
              </label>
              <input
                type="text"
                value={cwd}
                onChange={(e) => setCwd(e.target.value)}
                placeholder="/path/to/project"
                className="w-full bg-surface-container-lowest border border-outline/10 px-3 py-2 font-mono text-xs text-on-surface placeholder:text-on-surface-variant/40 outline-none focus:border-primary/40"
              />
            </div>

            {/* Intent */}
            <div className="px-6 pb-4">
              <label className="font-headline text-[10px] font-bold uppercase tracking-widest text-on-surface-variant block mb-2">
                INTENT_LABEL <span className="text-on-surface-variant/40">(optional)</span>
              </label>
              <input
                type="text"
                value={intent}
                onChange={(e) => setIntent(e.target.value)}
                placeholder="Describe the agent's task..."
                className="w-full bg-surface-container-lowest border border-outline/10 px-3 py-2 font-mono text-xs text-on-surface placeholder:text-on-surface-variant/40 outline-none focus:border-primary/40"
              />
            </div>

            {/* Error */}
            {error && (
              <div className="mx-6 mb-4 px-3 py-2 bg-error/10 border-l-2 border-error">
                <span className="font-mono text-xs text-error">{error}</span>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-outline/10">
              <Button variant="ghost" onClick={onClose}>
                ABORT
              </Button>
              <Button
                variant="primary"
                onClick={handleLaunch}
                disabled={isLaunching || visibleAgentTypes.length === 0}
              >
                {isLaunching ? 'LAUNCHING...' : 'LAUNCH_AGENT'}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
