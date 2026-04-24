import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { useAgentStore } from '../../stores/agentStore';
import { useRepoStore } from '../../stores/repoStore';
import { commands } from '../../bindings';

interface DeployDialogProps {
  open: boolean;
  onClose: () => void;
}

// Join a watched repo root with a user-supplied subdirectory. Strips leading
// path separators on the subdir so typing `/src` or `src` both resolve to
// `<repo>/src`. Backend canonicalizes and rejects `..` escapes, so we don't
// re-implement that here.
function joinRepoSubdir(root: string, subdir: string): string {
  const sub = subdir.trim().replace(/^[\\/]+/, '');
  if (!sub) return root;
  const rootStripped = root.replace(/[\\/]+$/, '');
  const sep = rootStripped.includes('\\') && !rootStripped.includes('/') ? '\\' : '/';
  return `${rootStripped}${sep}${sub}`;
}

const agentTypes = [
  { id: 'claude-code', label: 'Claude Code', protocol: 'hooks' },
  { id: 'codex', label: 'Codex', protocol: 'cli' },
  { id: 'opencode', label: 'OpenCode', protocol: 'cli' },
  { id: 'generic', label: 'Generic', protocol: 'custom' },
] as const;

export function DeployDialog({ open, onClose }: DeployDialogProps) {
  const [selectedType, setSelectedType] = useState<string>('claude-code');
  // `subdir` holds a repo-relative path when a watch is active; when no watch
  // is active it holds a full path (fallback UI). Keeping a single field
  // avoids state shuffling when the user toggles watches mid-dialog.
  const [subdir, setSubdir] = useState('');
  const [intent, setIntent] = useState('');
  const [acceptEdits, setAcceptEdits] = useState(false);
  const [skipPermissions, setSkipPermissions] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLaunching, setIsLaunching] = useState(false);
  const [availableTypes, setAvailableTypes] = useState<string[] | null>(null);
  const launchAgent = useAgentStore((s) => s.launchAgent);
  const activeRepo = useRepoStore((s) => s.activeRepo);
  const navigate = useNavigate();

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

  const resolvedCwd = activeRepo
    ? joinRepoSubdir(activeRepo, subdir)
    : subdir.trim();

  const intentRequired = selectedType === 'claude-code';

  const handleLaunch = async () => {
    if (!activeRepo && !resolvedCwd) {
      setError('Working directory is required');
      return;
    }
    if (intentRequired && !intent.trim()) {
      setError(
        'Claude Code launches in --print mode -- fill in INTENT_LABEL with the task prompt.',
      );
      return;
    }
    setError(null);
    setIsLaunching(true);
    try {
      // Only forward permission tuning when the target adapter consumes it.
      // Codex/OpenCode ignore these fields, but omitting them keeps the
      // registered Rust logs cleaner for non-claude launches.
      const options =
        selectedType === 'claude-code'
          ? { acceptEdits, dangerouslySkipPermissions: skipPermissions }
          : undefined;
      const launched = await launchAgent(
        selectedType,
        resolvedCwd,
        intent.trim() || undefined,
        options,
      );
      // Success: reset and close
      setSubdir('');
      setIntent('');
      setAcceptEdits(false);
      setSkipPermissions(false);
      setSelectedType('claude-code');
      onClose();
      // Redirect to the CommsHub chat tab with the newly-deployed agent
      // preselected. ChatView's useEffect watches `channels` and auto-
      // selects when the id appears — launchAgent already kicked a
      // fetchChannels() so the new row will land momentarily.
      navigate(`/comms?tab=chat&agent=${launched.id}`);
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
            // Dialog surface lifted two tiers above the "no chat selected"
            // detail pane (bg-surface-container-highest, #262626) — we were
            // previously at bg-surface/80 which rendered DARKER than the
            // darkened detail pane and disappeared into it. Solid highest
            // tier + 40% outline border gives the dialog a real silhouette;
            // the primary left-stripe matches the Command Horizon accent
            // motif used on AGENT / SUBAGENT / SKILL cards and signals
            // "active primary affordance".
            className="w-[480px] bg-surface-container-highest border border-outline/40 border-l-2 border-l-primary"
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
              {visibleAgentTypes.length === 0 ? (
                <div className="px-4 py-3 bg-surface-container border-l-2 border-error/40">
                  <span className="font-mono text-xs text-on-surface-variant">
                    No agent CLIs detected on PATH. Install at least one of
                    claude, codex, or opencode to deploy.
                  </span>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {visibleAgentTypes.map((type) => {
                    const selected = selectedType === type.id;
                    return (
                      <button
                        key={type.id}
                        onClick={() => setSelectedType(type.id)}
                        className={`group inline-flex items-center gap-2 px-3 py-1.5 rounded-full border transition-colors duration-150 ${
                          selected
                            ? 'bg-primary/10 border-primary text-primary'
                            : 'bg-surface-container border-outline/20 text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
                        }`}
                      >
                        <span className="font-mono text-xs font-bold tracking-wide">
                          {type.label}
                        </span>
                        <span
                          className={`font-mono text-[10px] ${
                            selected
                              ? 'text-primary/70'
                              : 'text-on-surface-variant/60'
                          }`}
                        >
                          {type.protocol}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Working directory */}
            {activeRepo ? (
              <div className="px-6 pb-4">
                <label className="font-headline text-[10px] font-bold uppercase tracking-widest text-on-surface-variant block mb-2">
                  MONITORED_REPO
                </label>
                <div
                  className="w-full bg-surface-container-lowest border border-outline/10 px-3 py-2 font-mono text-xs text-on-surface-variant truncate"
                  title={activeRepo}
                >
                  {activeRepo}
                </div>

                <label className="mt-3 font-headline text-[10px] font-bold uppercase tracking-widest text-on-surface-variant block mb-2">
                  SUBDIRECTORY <span className="text-on-surface-variant/40">(optional)</span>
                </label>
                <input
                  type="text"
                  value={subdir}
                  onChange={(e) => setSubdir(e.target.value)}
                  placeholder="packages/server"
                  className="w-full bg-surface-container-lowest border border-outline/10 px-3 py-2 font-mono text-xs text-on-surface placeholder:text-on-surface-variant/40 outline-none focus:border-primary/40"
                />
                <p
                  className="mt-1 font-mono text-[10px] text-on-surface-variant/60 truncate"
                  title={resolvedCwd}
                >
                  cwd: <span className="text-on-surface-variant">{resolvedCwd}</span>
                </p>
              </div>
            ) : (
              <div className="px-6 pb-4">
                <label className="font-headline text-[10px] font-bold uppercase tracking-widest text-on-surface-variant block mb-2">
                  WORKING_DIRECTORY
                </label>
                <input
                  type="text"
                  value={subdir}
                  onChange={(e) => setSubdir(e.target.value)}
                  placeholder="/path/to/project"
                  className="w-full bg-surface-container-lowest border border-outline/10 px-3 py-2 font-mono text-xs text-on-surface placeholder:text-on-surface-variant/40 outline-none focus:border-primary/40"
                />
                <p className="mt-1 font-mono text-[10px] text-on-surface-variant/60">
                  No repo is being monitored. Enter an absolute path.
                </p>
              </div>
            )}

            {/* Permission chips (claude-code only -- other adapters don't
                expose equivalent flags). Two chips are independent toggles;
                the backend resolves skip-permissions as the dominant one. */}
            {selectedType === 'claude-code' && (
              <div className="px-6 pb-4">
                <label className="font-headline text-[10px] font-bold uppercase tracking-widest text-on-surface-variant block mb-2">
                  PERMISSIONS
                </label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setAcceptEdits((v) => !v)}
                    className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border transition-colors duration-150 ${
                      acceptEdits
                        ? 'bg-primary/10 border-primary text-primary'
                        : 'bg-surface-container border-outline/20 text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
                    }`}
                    title="Passes --permission-mode acceptEdits to claude"
                  >
                    <span className="font-mono text-[11px]">
                      {acceptEdits ? '[x]' : '[ ]'}
                    </span>
                    <span className="font-mono text-xs font-bold tracking-wide">
                      Accept edits
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSkipPermissions((v) => !v)}
                    className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border transition-colors duration-150 ${
                      skipPermissions
                        ? 'bg-error/10 border-error text-error'
                        : 'bg-surface-container border-outline/20 text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
                    }`}
                    title="Passes --dangerously-skip-permissions to claude"
                  >
                    <span className="font-mono text-[11px]">
                      {skipPermissions ? '[x]' : '[ ]'}
                    </span>
                    <span className="font-mono text-xs font-bold tracking-wide">
                      Skip permissions
                    </span>
                  </button>
                </div>
                <p className="mt-2 font-mono text-[10px] text-on-surface-variant/60">
                  {skipPermissions
                    ? 'Skip permissions wins -- claude bypasses all permission checks.'
                    : acceptEdits
                      ? 'Edits auto-approve; other tool uses still prompt.'
                      : 'Claude will stall in --print mode if a tool prompts for permission. Pick one.'}
                </p>
              </div>
            )}

            {/* Intent */}
            <div className="px-6 pb-4">
              <label className="font-headline text-[10px] font-bold uppercase tracking-widest text-on-surface-variant block mb-2">
                INTENT_LABEL{' '}
                <span
                  className={
                    intentRequired
                      ? 'text-primary/80'
                      : 'text-on-surface-variant/40'
                  }
                >
                  {intentRequired ? '(required)' : '(optional)'}
                </span>
              </label>
              <textarea
                value={intent}
                onChange={(e) => setIntent(e.target.value)}
                placeholder={
                  intentRequired
                    ? 'Prompt passed to `claude --print` as the task...'
                    : "Describe the agent's task..."
                }
                rows={4}
                className="w-full bg-surface-container-lowest border border-outline/10 px-3 py-2 font-mono text-xs text-on-surface placeholder:text-on-surface-variant/40 outline-none focus:border-primary/40 resize-y min-h-[80px]"
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
