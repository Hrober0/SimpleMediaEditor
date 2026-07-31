import type { ReactNode } from 'react';
import { Drawer, ScrollArea } from '@mantine/core';
import { useJobs } from '../state/JobsContext';
import { JobsList } from './JobsList';

/**
 * The jobs list for windows too narrow to keep the side panel open. `revealJobs`
 * decides which of the two the user gets, so nothing here has to know.
 */
export function JobsDrawer(): ReactNode {
  const { drawerOpened, closeDrawer } = useJobs();

  return (
    <Drawer
      opened={drawerOpened}
      onClose={closeDrawer}
      position="right"
      size="lg"
      title="Jobs"
      scrollAreaComponent={ScrollArea.Autosize}
    >
      <JobsList />
    </Drawer>
  );
}
