// Phase 6 repo session provider (owns pipeline channel + repo resolution).
// TODO(plan-02): wire usePipelineChannel, call resolveInitialRepo on mount,
// register/unregister on activeRepo changes.
import type { ReactNode } from 'react';

export function RepoSessionProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
