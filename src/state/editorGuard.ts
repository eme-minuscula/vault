import { useEffect } from 'react';
import { create } from 'zustand';

interface EditorGuardState {
  /** Number of mounted editors. Non-zero means the user may be composing. */
  open: number;
  acquire: () => void;
  release: () => void;
}

const useEditorGuardStore = create<EditorGuardState>((set) => ({
  open: 0,
  acquire: () => set((s) => ({ open: s.open + 1 })),
  release: () => set((s) => ({ open: Math.max(0, s.open - 1) })),
}));

/** True while a note editor is mounted — i.e. there may be unsaved content. */
export function useEditorOpen(): boolean {
  return useEditorGuardStore((s) => s.open > 0);
}

/**
 * Marks an editor as open for as long as the component is mounted, so the
 * service-worker updater never reloads the page out from under an unsaved note.
 */
export function useHoldEditorGuard(): void {
  useEffect(() => {
    const { acquire, release } = useEditorGuardStore.getState();
    acquire();
    return release;
  }, []);
}
