import { Editor } from "@/components/Editor";
import { useEditorStore } from "@/stores/editorStore";

function App() {
  const focusModeEnabled = useEditorStore((state) => state.focusModeEnabled);

  return (
    <div
      className={`app-layout ${focusModeEnabled ? "focus-mode" : ""}`}
      style={{
        display: "flex",
        height: "100vh",
        overflow: "hidden",
      }}
    >
      <Editor />
    </div>
  );
}

export default App;
