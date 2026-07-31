import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { NavigationContext, type NavigationValue } from './NavigationContext';

/**
 * Which module is on screen, and any file a module has been asked to open.
 *
 * It lives above the shell so a handoff survives the panel that started it: a
 * download queued from the download panel can still land in the meta editor after
 * the user has navigated away.
 */
export function NavigationProvider({
  initialModuleId,
  children,
}: {
  initialModuleId: string;
  children: ReactNode;
}): ReactNode {
  const [activeModuleId, setActiveModuleId] = useState(initialModuleId);
  // A ref, not state: the file is read once by the module that was sent it, and
  // re-rendering anything else on its arrival would serve no purpose.
  const pendingFiles = useRef(new Map<string, string>());

  const showModule = useCallback((moduleId: string) => {
    setActiveModuleId(moduleId);
  }, []);

  const showModuleWithFile = useCallback((moduleId: string, path: string) => {
    pendingFiles.current.set(moduleId, path);
    setActiveModuleId(moduleId);
  }, []);

  const takeFileFor = useCallback((moduleId: string) => {
    const path = pendingFiles.current.get(moduleId) ?? null;
    pendingFiles.current.delete(moduleId);
    return path;
  }, []);

  const value = useMemo<NavigationValue>(
    () => ({ activeModuleId, showModule, showModuleWithFile, takeFileFor }),
    [activeModuleId, showModule, showModuleWithFile, takeFileFor],
  );

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}
