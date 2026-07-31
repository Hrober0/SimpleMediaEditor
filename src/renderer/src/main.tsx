// Mantine ships CSS Modules: forgetting a stylesheet produces an unstyled app
// rather than an error, so every package's stylesheet is imported here at the root.
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import '@mantine/dropzone/styles.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { App } from './App';
import { MODULE_REGISTRY } from './modules/registry';
import { EnvironmentProvider } from './state/EnvironmentProvider';
import { JobsProvider } from './state/JobsProvider';
import { NavigationProvider } from './state/NavigationProvider';
import { SettingsProvider } from './state/SettingsProvider';
import { theme } from './theme';

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    {/* "auto" follows the OS on both Windows and Linux. */}
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <Notifications position="bottom-right" />
      <EnvironmentProvider>
        <SettingsProvider>
          <JobsProvider>
            <NavigationProvider initialModuleId={MODULE_REGISTRY[0]?.id ?? ''}>
              <App />
            </NavigationProvider>
          </JobsProvider>
        </SettingsProvider>
      </EnvironmentProvider>
    </MantineProvider>
  </StrictMode>,
);
