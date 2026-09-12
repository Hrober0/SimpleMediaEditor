import { createContext, useContext } from 'react';
import type { BinaryStatus } from '@shared/binaries';
import type { AppEnvironment } from '@shared/ipc-contract';

export interface EnvironmentContextValue {
  /** null only while the first read is in flight. */
  environment: AppEnvironment | null;
  binaries: readonly BinaryStatus[];
  /** Required tools that were not found. These are what the startup gate shows. */
  missingBinaries: readonly BinaryStatus[];
  /** False when neither Deno nor Node was found, which breaks YouTube downloads. */
  hasJsRuntime: boolean;
  /** Re-probes the external tools, e.g. after a path was configured. */
  recheck: () => Promise<void>;
  rechecking: boolean;
}

export const EnvironmentContext = createContext<EnvironmentContextValue | null>(null);

export function useEnvironment(): EnvironmentContextValue {
  const value = useContext(EnvironmentContext);
  if (!value) throw new Error('useEnvironment must be used inside <EnvironmentProvider>');
  return value;
}
