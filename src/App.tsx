import { Routes, Route } from "react-router-dom";
import { Editor } from "@/components/Editor";
import { Sidebar } from "@/components/Sidebar";
import { StatusBar } from "@/components/StatusBar";
import { FindBar } from "@/components/FindBar";
import { SettingsPage } from "@/pages/Settings";
import { useEditorStore } from "@/stores/editorStore";
import { useUIStore } from "@/stores/uiStore";
import { useMenuEvents } from "@/hooks/useMenuEvents";
import { useFileOperations } from "@/hooks/useFileOperations";
import { useSearchCommands } from "@/hooks/useSearchCommands";
import { useAutoSave } from "@/hooks/useAutoSave";
import { useTheme } from "@/hooks/useTheme";
import { useSettingsSync } from "@/hooks/useSettingsSync";

function MainLayout() {
  const focusModeEnabled = useEditorStore((state) => state.focusModeEnabled);
  const typewriterModeEnabled = useEditorStore(
    (state) => state.typewriterModeEnabled
  );
  const sidebarVisible = useUIStore((state) => state.sidebarVisible);

  // Initialize hooks
  useMenuEvents();
  useFileOperations();
  useSearchCommands();
  useSettingsSync(); // Sync settings across windows
  useTheme();
  useAutoSave(); // Auto-save when dirty

  const classNames = [
    "app-layout",
    focusModeEnabled && "focus-mode",
    typewriterModeEnabled && "typewriter-mode",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={classNames}
      style={{
        display: "flex",
        height: "100vh",
        overflow: "hidden",
      }}
    >
      {sidebarVisible && (
        <aside
          style={{
            width: 240,
            minWidth: 240,
            height: "100%",
            flexShrink: 0,
          }}
        >
          <Sidebar />
        </aside>
      )}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Drag region for window movement */}
        <div
          data-tauri-drag-region
          style={{
            height: "2em",
            flexShrink: 0,
          }}
        />
        <div style={{ flex: 1, minHeight: 0, marginTop: "1em", marginBottom: "3em" }}>
          <Editor />
        </div>
        <FindBar />
        <StatusBar />
      </div>
    </div>
  );
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<MainLayout />} />
      <Route path="/settings" element={<SettingsPage />} />
    </Routes>
  );
}

export default App;
