import type { ReactNode } from 'react';
import { Dropzone, type DropzoneProps } from '@mantine/dropzone';

/**
 * Mantine's Dropzone, with the file list read straight off the drop.
 *
 * Every dropzone in the app goes through this one rather than using Dropzone
 * directly, because getting this wrong looks exactly like a broken app: the drop
 * is accepted, and then main refuses the path it was given.
 */
export const FileDropzone = Object.assign(
  function FileDropzone(props: DropzoneProps): ReactNode {
    // After the props, so a caller cannot drop the reason this component exists.
    return <Dropzone {...props} getFilesFromEvent={filesFromEvent} />;
  },
  { Accept: Dropzone.Accept, Reject: Dropzone.Reject, Idle: Dropzone.Idle },
);

/**
 * The files a drop or a file input carried, as the browser handed them over.
 *
 * react-dropzone otherwise resolves each dropped item through the File System
 * Access API, and a File that came back from a FileSystemFileHandle is not the one
 * the drag carried: Electron has no path for it and returns an empty string, so
 * every drop reached main as "Expected an absolute path". A real path is the only
 * thing this app wants from a dropped file.
 *
 * The list is read before anything is awaited. A DataTransfer is only valid while
 * its event is being dispatched, and resolving a handle first empties it.
 */
function filesFromEvent(event: unknown): Promise<File[]> {
  const files = fileList(event);
  return Promise.resolve(files ? [...files] : []);
}

/** Where the browser put the files, which depends on how they arrived. */
function fileList(event: unknown): FileList | null {
  if (typeof event !== 'object' || event === null) return null;

  if ('dataTransfer' in event) {
    const transfer = event.dataTransfer;
    if (transfer instanceof DataTransfer) return transfer.files;
  }

  if ('target' in event) {
    const target = event.target;
    if (target instanceof HTMLInputElement) return target.files;
  }

  return null;
}
