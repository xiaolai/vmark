/**
 * validateProvider — is the active AI provider usable for one invocation?
 *
 * Split out of `streamRunner.ts` at the file-size cap. Two refusals, both
 * BEFORE any Rust call, because each has a specific thing to tell the user:
 * a CLI provider whose binary was not found, and a REST provider with no API
 * key. Everything else is the runner's problem.
 *
 * It toasts and returns null rather than throwing: a missing key is a
 * configuration state the user fixes in Settings, not an error the invocation
 * pipeline should carry as an exception. EVERY refusal toasts (audit #960) —
 * the "no active provider" case used to return null in silence, which is the
 * one outcome a user cannot act on.
 *
 * @coordinates-with streamRunner.ts — sole consumer
 * @coordinates-with stores/aiStore/provider.ts — REST_TYPES / KEY_OPTIONAL_REST
 * @module services/genieInvocation/providerValidation
 */
import { imeToast as toast } from "@/services/ime/imeToast";
import i18n from "@/i18n";
import { useAiProviderStore, REST_TYPES, KEY_OPTIONAL_REST } from "@/stores/aiStore";

type ProviderState = ReturnType<typeof useAiProviderStore.getState>;

export interface ValidatedProvider {
  provider: NonNullable<ProviderState["activeProvider"]>;
  restConfig: ProviderState["restProviders"][number] | undefined;
  cliInfo: ProviderState["cliProviders"][number] | undefined;
}

/** Validate the active provider is usable; toasts and returns null when not. */
export function validateProvider(providerState: ProviderState): ValidatedProvider | null {
  const provider = providerState.activeProvider;
  if (!provider) {
    // The caller DOES check first — `ensureProvider()` runs before this — but
    // it awaits, and the store can be cleared in that window (audit #960).
    // Returning null silently then refused the invocation with no toast, no
    // log and no picker state: the user clicks a genie and nothing whatsoever
    // happens. Same message the caller's own check uses, because it is the
    // same condition.
    toast.error(i18n.t("dialog:toast.genieNoProvider"));
    return null;
  }

  const cliInfo = providerState.cliProviders.find((p) => p.type === provider);

  // Validate CLI provider is available before invoking
  if (!REST_TYPES.has(provider) && cliInfo && !cliInfo.available) {
    toast.error(i18n.t("dialog:toast.genieCliNotFound", { name: cliInfo.name }));
    return null;
  }

  const restConfig = providerState.restProviders.find((p) => p.type === provider);

  // Validate REST provider has an API key before calling Rust. TRIMMED for the
  // emptiness test (audit #962): a whitespace-only key is no key, and passing
  // it through turned the actionable "add an API key in Settings" refusal into
  // a provider-side 401 several seconds later. What is SENT is untouched — only
  // the "is there one" question is asked of the trimmed value.
  if (REST_TYPES.has(provider) && !KEY_OPTIONAL_REST.has(provider) && !restConfig?.apiKey?.trim()) {
    const name = restConfig?.name ?? provider;
    toast.error(i18n.t("dialog:toast.genieApiKeyRequired", { name }));
    return null;
  }

  return { provider, restConfig, cliInfo };
}
