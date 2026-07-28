import { createTheme } from '@mantine/core';

/**
 * Theme values live here so components can use spacing/colour tokens instead of
 * hardcoded values — that is what keeps dark mode working without extra work.
 */
export const theme = createTheme({
  primaryColor: 'indigo',
  defaultRadius: 'md',
  headings: { sizes: { h1: { fontSize: '1.6rem' }, h2: { fontSize: '1.25rem' } } },
});
