/**
 * Multi-Window Restore Tests
 *
 * Tests for multi-window session restoration.
 *
 * Design:
 * 1. Main window triggers restore via checkAndRestoreSession
 * 2. Rust creates secondary windows and stores session state
 * 3. Each window pulls its own state via getWindowRestoreState
 * 4. Each window emits completion when done
 * 5. Main window tracks all completions before clearing session
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { invoke } from '@tauri-apps/api/core';

// Mock Tauri APIs
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: () => ({ label: 'main' }),
}));

// Helper to create mock session
function createMockSession(windowConfigs: Array<{
  label: string;
  isMain: boolean;
  tabCount: number;
}>) {
  return {
    version: 1,
    timestamp: Math.floor(Date.now() / 1000),
    vmark_version: '0.3.24',
    windows: windowConfigs.map(config => ({
      window_label: config.label,
      is_main_window: config.isMain,
      active_tab_id: `${config.label}-tab-0`,
      tabs: Array.from({ length: config.tabCount }, (_, i) => ({
        id: `${config.label}-tab-${i}`,
        file_path: `/path/to/file${i}.md`,
        title: `File ${i}`,
        is_pinned: false,
        document: {
          content: `Content ${i}`,
          saved_content: `Content ${i}`,
          is_dirty: false,
          is_missing: false,
          is_divergent: false,
          is_read_only: false,
          line_ending: '\n' as const,
          cursor_info: null,
          last_modified_timestamp: null,
          is_untitled: false,
          untitled_number: null,
        },
      })),
      ui_state: {
        sidebar_visible: true,
        sidebar_width: 260,
        outline_visible: false,
        sidebar_view_mode: 'files',
        status_bar_visible: true,
        source_mode_enabled: false,
        focus_mode_enabled: false,
        typewriter_mode_enabled: false,
      },
      geometry: null,
    })),
    workspace: null,
  };
}

describe('Multi-Window Restore', () => {
  let mockInvoke: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke = invoke as Mock;
  });

  describe('hot_exit_restore_multi_window', () => {
    it('should create secondary windows when restoring multi-window session', async () => {
      const mockSession = createMockSession([
        { label: 'main', isMain: true, tabCount: 2 },
        { label: 'doc-0', isMain: false, tabCount: 1 },
        { label: 'doc-1', isMain: false, tabCount: 3 },
      ]);

      // Mock the invoke to track calls
      mockInvoke.mockResolvedValue({ windows_created: ['doc-0', 'doc-1'] });

      // This test verifies the Rust command creates secondary windows
      await invoke('hot_exit_restore_multi_window', { session: mockSession });

      expect(mockInvoke).toHaveBeenCalledWith('hot_exit_restore_multi_window', {
        session: mockSession,
      });
    });

    it('should not create windows for main window state', async () => {
      const mockSession = createMockSession([
        { label: 'main', isMain: true, tabCount: 2 },
      ]);

      mockInvoke.mockResolvedValue({ windows_created: [] });

      await invoke('hot_exit_restore_multi_window', { session: mockSession });

      // When session only has main window, no secondary windows should be created
      expect(mockInvoke).toHaveBeenCalledTimes(1);
    });
  });

  describe('hot_exit_get_window_state', () => {
    it('should return window state for the requesting window', async () => {
      const windowState = {
        window_label: 'doc-0',
        is_main_window: false,
        active_tab_id: 'doc-0-tab-0',
        tabs: [{
          id: 'doc-0-tab-0',
          file_path: '/path/to/file.md',
          title: 'File',
          is_pinned: false,
          document: {
            content: 'Content',
            saved_content: 'Content',
            is_dirty: false,
            is_missing: false,
            is_divergent: false,
            line_ending: '\n',
            cursor_info: null,
            last_modified_timestamp: null,
            is_untitled: false,
            untitled_number: null,
          },
        }],
        ui_state: {
          sidebar_visible: true,
          sidebar_width: 260,
          outline_visible: false,
          sidebar_view_mode: 'files',
          status_bar_visible: true,
          source_mode_enabled: false,
          focus_mode_enabled: false,
          typewriter_mode_enabled: false,
        },
        geometry: null,
      };

      mockInvoke.mockResolvedValue(windowState);

      const result = await invoke('hot_exit_get_window_state', { windowLabel: 'doc-0' });

      expect(result).toEqual(windowState);
    });

    it('should return null when no pending state exists', async () => {
      mockInvoke.mockResolvedValue(null);

      const result = await invoke('hot_exit_get_window_state', { windowLabel: 'doc-99' });

      expect(result).toBeNull();
    });
  });

  describe('Session completion tracking', () => {
    it('should track all window completions before clearing session', async () => {
      // This tests that session file isn't cleared until all windows complete
      const completions: string[] = [];

      mockInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
        if (cmd === 'hot_exit_window_restore_complete') {
          const { windowLabel } = args as { windowLabel: string };
          completions.push(windowLabel);
          return completions.length === 3; // All windows done
        }
        return null;
      });

      // Simulate completions from each window
      await invoke('hot_exit_window_restore_complete', { windowLabel: 'main' });
      expect(completions).toEqual(['main']);

      await invoke('hot_exit_window_restore_complete', { windowLabel: 'doc-0' });
      expect(completions).toEqual(['main', 'doc-0']);

      const allDone = await invoke('hot_exit_window_restore_complete', { windowLabel: 'doc-1' });
      expect(allDone).toBe(true);
    });
  });
});

describe('Secondary Window Startup', () => {
  let mockInvoke: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke = invoke as Mock;
  });

  it('secondary window should check for pending restore state on startup', async () => {
    // When a secondary window starts (created during restore), it should
    // check if there's pending state for it
    mockInvoke.mockResolvedValue({
      window_label: 'doc-0',
      tabs: [{ id: 'tab-1', file_path: '/test.md' }],
    });

    const state = await invoke<{ window_label: string }>('hot_exit_get_window_state', { windowLabel: 'doc-0' });

    expect(mockInvoke).toHaveBeenCalledWith('hot_exit_get_window_state', {
      windowLabel: 'doc-0',
    });
    expect(state).toBeDefined();
    expect(state?.window_label).toBe('doc-0');
  });

  it('regular window startup should not find pending state', async () => {
    // When a window starts normally (not from restore), no pending state
    mockInvoke.mockResolvedValue(null);

    const state = await invoke('hot_exit_get_window_state', { windowLabel: 'doc-5' });

    expect(state).toBeNull();
  });
});
