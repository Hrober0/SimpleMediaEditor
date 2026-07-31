/**
 * Shell measurements shared between the shell itself and anything that has to
 * position against it.
 *
 * The header is fixed, so a sticky element inside a panel has to be offset by its
 * height or it slides underneath. Keeping the number here means the two cannot
 * drift apart.
 */
export const SHELL_HEADER_HEIGHT = 56;

export const SHELL_NAVBAR_WIDTH = 264;

/** The jobs side panel, shown instead of the drawer when the window allows it. */
export const JOBS_PANEL_WIDTH = 320;

/**
 * Below this the side panel is hidden and the jobs drawer takes over. `xl` is
 * 88em (1408px): the navbar, a full-width panel and the jobs list all fit above
 * it, and below it the content column would start losing space.
 *
 * The media query must describe the same point as the breakpoint token — the
 * AppShell hides the panel by CSS, while `revealJobs` needs to know in JS whether
 * the list is already on screen.
 */
export const JOBS_PANEL_BREAKPOINT = 'xl';
export const JOBS_PANEL_MEDIA_QUERY = '(min-width: 88em)';
