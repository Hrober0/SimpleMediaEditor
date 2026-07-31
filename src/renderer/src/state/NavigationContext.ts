import { createContext, useContext } from 'react';

export interface NavigationValue {
  /** The module the shell is showing. */
  activeModuleId: string;
  showModule: (moduleId: string) => void;
  /**
   * Shows a module and gives it a file to open. The module reads it once with
   * takeFileFor, which is how a download can end up in the meta editor without
   * either module importing the other.
   */
  showModuleWithFile: (moduleId: string, path: string) => void;
  /**
   * The file waiting for a module, cleared as it is read: coming back to a panel
   * later should not reopen what it already opened.
   */
  takeFileFor: (moduleId: string) => string | null;
}

export const NavigationContext = createContext<NavigationValue | null>(null);

export function useNavigation(): NavigationValue {
  const value = useContext(NavigationContext);
  if (!value) throw new Error('useNavigation must be used inside <NavigationProvider>');
  return value;
}
