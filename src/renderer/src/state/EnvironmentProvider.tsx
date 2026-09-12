import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  isBinaryAvailable,
  isBinaryRequired,
  JS_RUNTIME_IDS,
  type BinaryStatus,
} from '@shared/binaries';
import type { AppEnvironment } from '@shared/ipc-contract';
import { api } from '../api';
import { EnvironmentContext, type EnvironmentContextValue } from './EnvironmentContext';

/**
 * What the app found on this machine: version, platform, and the state of the
 * external tools. Every module asks here rather than probing for itself.
 */
export function EnvironmentProvider({ children }: { children: ReactNode }): ReactNode {
  const [environment, setEnvironment] = useState<AppEnvironment | null>(null);
  const [rechecking, setRechecking] = useState(false);

  useEffect(() => {
    void api.getEnvironment().then(setEnvironment);
  }, []);

  const recheck = useCallback(async () => {
    setRechecking(true);
    try {
      const binaries = await api.recheckBinaries();
      setEnvironment((current) => (current ? { ...current, binaries } : current));
    } finally {
      setRechecking(false);
    }
  }, []);

  const value = useMemo<EnvironmentContextValue>(() => {
    const binaries: readonly BinaryStatus[] = environment?.binaries ?? [];
    return {
      environment,
      binaries,
      missingBinaries: binaries.filter(
        (binary) => isBinaryRequired(binary) && !isBinaryAvailable(binary),
      ),
      hasJsRuntime: binaries.some(
        (binary) =>
          isBinaryAvailable(binary) && JS_RUNTIME_IDS.some((runtime) => runtime === binary.id),
      ),
      recheck,
      rechecking,
    };
  }, [environment, recheck, rechecking]);

  return <EnvironmentContext.Provider value={value}>{children}</EnvironmentContext.Provider>;
}
