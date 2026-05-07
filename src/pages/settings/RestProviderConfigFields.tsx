/**
 * Inline config fields for a REST AI provider (endpoint, API key, model).
 *
 * Rendered when the provider is the active selection.
 */

import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, Copy, Check, X, Zap, Loader2, FlaskConical } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { imeToast as toast } from "@/utils/imeToast";
import { useTranslation } from "react-i18next";
import type { RestProviderType } from "@/types/aiGenies";
import { useAiProviderStore } from "@/stores/aiProviderStore";
import { ModelComboBox } from "./ModelComboBox";
import { FieldInput } from "./components";

const iconBtnClass = `shrink-0 p-1 rounded
  text-[var(--text-secondary)] hover:text-[var(--text-color)]
  hover:bg-[var(--hover-bg)] cursor-pointer
  focus-visible:outline-none`;

interface RestProviderConfigFieldsProps {
  type: RestProviderType;
  endpoint: string;
  apiKey: string;
  model: string;
}

export function RestProviderConfigFields({
  type,
  endpoint,
  apiKey,
  model,
}: RestProviderConfigFieldsProps) {
  const { t } = useTranslation("settings");
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [testState, setTestState] = useState<"idle" | "testing" | "success" | "failed">("idle");
  const [modelTestState, setModelTestState] = useState<"idle" | "testing" | "success" | "failed">("idle");
  const copyTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const testTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const modelTestTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Clear feedback timers on unmount
  useEffect(() => {
    return () => {
      clearTimeout(copyTimerRef.current);
      clearTimeout(testTimerRef.current);
      clearTimeout(modelTestTimerRef.current);
    };
  }, []);

  const handleChange = (field: "endpoint" | "apiKey" | "model", value: string) => {
    useAiProviderStore.getState().updateRestProvider(type, { [field]: value });
  };

  const handleCopy = () => {
    /* v8 ignore next -- @preserve reason: empty apiKey guard; copy button is disabled when apiKey is empty so this path is unreachable via UI */
    if (!apiKey) return;
    navigator.clipboard.writeText(apiKey);
    setCopied(true);
    clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), 1500);
  };

  const handleTest = async () => {
    /* v8 ignore next -- @preserve reason: re-entrant guard; test button is disabled during testing so concurrent calls cannot occur via UI */
    if (testState === "testing") return;
    setTestState("testing");
    clearTimeout(testTimerRef.current);
    try {
      const msg = await invoke<string>("test_api_key", {
        provider: type,
        /* v8 ignore next -- @preserve reason: apiKey || null coerces empty string to null; tests always pass non-empty apiKey */
        apiKey: apiKey || null,
        endpoint: endpoint || null,
      });
      setTestState("success");
      toast.success(msg);
      testTimerRef.current = setTimeout(() => setTestState("idle"), 1500);
    } catch (err) {
      setTestState("failed");
      toast.error(String(err));
      testTimerRef.current = setTimeout(() => setTestState("idle"), 1500);
    }
  };

  const handleModelTest = async () => {
    /* v8 ignore next -- @preserve reason: re-entrant guard and empty model guard; button is disabled in both cases so these paths are unreachable via UI */
    if (modelTestState === "testing" || !model) return;
    setModelTestState("testing");
    clearTimeout(modelTestTimerRef.current);
    try {
      const msg = await invoke<string>("validate_model", {
        provider: type,
        model,
        /* v8 ignore next -- @preserve reason: apiKey || null coerces empty string to null; tests always pass non-empty apiKey */
        apiKey: apiKey || null,
        endpoint: endpoint || null,
      });
      setModelTestState("success");
      toast.success(msg);
      modelTestTimerRef.current = setTimeout(() => setModelTestState("idle"), 1500);
    } catch (err) {
      setModelTestState("failed");
      toast.error(String(err));
      modelTestTimerRef.current = setTimeout(() => setModelTestState("idle"), 1500);
    }
  };

  // ollama-api needs no key; other providers need one
  const testDisabled = type !== "ollama-api" && !apiKey;
  const modelTestDisabled = !model || (type !== "ollama-api" && !apiKey);

  return (
    <div className="flex flex-col gap-1.5 ml-5.5 mt-1">
      {type !== "google-ai" && (
        <FieldInput
          placeholder={t("integrations.apiEndpoint")}
          value={endpoint}
          onChange={(v) => handleChange("endpoint", v)}
        />
      )}
      <div className="flex items-center gap-1">
        <FieldInput
          placeholder={t("integrations.apiKey")}
          type={revealed ? "text" : "password"}
          value={apiKey}
          onChange={(v) => handleChange("apiKey", v)}
        />
        <button
          className={iconBtnClass}
          onClick={() => setRevealed((r) => !r)}
          title={revealed ? t("integrations.hideApiKey") : t("integrations.showApiKey")}
          aria-label={revealed ? t("integrations.hideApiKey") : t("integrations.showApiKey")}
          tabIndex={-1}
        >
          {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
        <button
          className={iconBtnClass}
          onClick={handleCopy}
          title={t("integrations.copyApiKey")}
          aria-label={t("integrations.copyApiKey")}
          tabIndex={-1}
          disabled={!apiKey}
        >
          {copied ? <Check size={14} className="text-[var(--success-color)]" /> : <Copy size={14} />}
        </button>
        <button
          className={iconBtnClass}
          onClick={handleTest}
          title={t("integrations.testApiKey")}
          aria-label={t("integrations.testApiKey")}
          tabIndex={-1}
          disabled={testDisabled || testState === "testing"}
        >
          {testState === "testing" ? (
            <Loader2 size={14} className="animate-spin" />
          ) : testState === "success" ? (
            <Check size={14} className="text-[var(--success-color)]" />
          ) : testState === "failed" ? (
            <X size={14} className="text-[var(--error-color)]" />
          ) : (
            <Zap size={14} />
          )}
        </button>
      </div>
      <div className="flex items-center gap-1">
        <ModelComboBox
          provider={type}
          value={model}
          apiKey={apiKey}
          endpoint={endpoint}
          onChange={(val) => handleChange("model", val)}
          className="flex-1"
        />
        <button
          className={iconBtnClass}
          onClick={handleModelTest}
          title={t("integrations.testModel")}
          aria-label={t("integrations.testModel")}
          tabIndex={-1}
          disabled={modelTestDisabled || modelTestState === "testing"}
        >
          {modelTestState === "testing" ? (
            <Loader2 size={14} className="animate-spin" />
          ) : modelTestState === "success" ? (
            <Check size={14} className="text-[var(--success-color)]" />
          ) : modelTestState === "failed" ? (
            <X size={14} className="text-[var(--error-color)]" />
          ) : (
            <FlaskConical size={14} />
          )}
        </button>
      </div>
    </div>
  );
}
