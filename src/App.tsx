import { Editor } from "@/components/Editor";
import { Sidebar } from "@/components/Sidebar";
import { StatusBar } from "@/components/StatusBar";
import { useEditorStore } from "@/stores/editorStore";
import { useUIStore } from "@/stores/uiStore";
import { useMenuEvents } from "@/hooks/useMenuEvents";
import { useFileOperations } from "@/hooks/useFileOperations";

function App() {
  const focusModeEnabled = useEditorStore((state) => state.focusModeEnabled);
  const typewriterModeEnabled = useEditorStore(
    (state) => state.typewriterModeEnabled
  );
  const sidebarVisible = useUIStore((state) => state.sidebarVisible);

  // Initialize menu event listeners
  useMenuEvents();
  useFileOperations();

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
        {/* Drag region for window movement (only when sidebar hidden) */}
        {!sidebarVisible && (
          <div
            data-tauri-drag-region
            style={{
              height: 20,
              flexShrink: 0,
            }}
          />
        )}
        <div style={{ flex: 1, minHeight: 0 }}>
          <Editor />
        </div>
        <StatusBar />
      </div>
    </div>
  );
}

export default App;
