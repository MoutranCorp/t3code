import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";
import {
  AuthProvidersManageScope,
  ProviderDriverKind,
  ProviderInstanceId,
  type EnvironmentId,
} from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  useEnvironmentSettings,
  usePersistEnvironmentProviderInstanceMutation,
} from "../../hooks/useSettings";
import { readEnvironmentScope } from "../../state/session";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../../state/server";
import { randomUUID } from "../../lib/utils";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Input } from "../ui/input";
import { WizardHeader, WizardPanel, WizardPopup, WizardFooter } from "../ui/wizard";
import { SettingsRow } from "./settingsLayout";
import { ProviderWizardAuthenticationStep } from "./ProviderWizardAuthenticationStep";
import { AddManagedCodexAccountDialog } from "./CodexSetupSection";
import { ProviderSetupSection } from "./ProviderSetupSection";

type AccountProvider = "claude" | "codex" | "google" | "grok";

const ACCOUNT_PROVIDERS: Record<
  Exclude<AccountProvider, "codex">,
  {
    readonly driver: string;
    readonly label: string;
    readonly title: string;
    /** Each instance keeps its own credentials, so several accounts can coexist. */
    readonly multipleAccounts: boolean;
    readonly config: Record<string, unknown>;
  }
> = {
  claude: {
    driver: "claudeAgent",
    label: "Claude",
    title: "Add Claude account",
    multipleAccounts: true,
    config: { managedAccount: true },
  },
  // Antigravity keeps a private Gemini profile per instance.
  google: {
    driver: "antigravity",
    label: "Google",
    title: "Add Google account",
    multipleAccounts: true,
    config: {},
  },
  // The Grok CLI keeps one login in ~/.grok, so Grok reuses its existing instance.
  grok: {
    driver: "grok",
    label: "Grok",
    title: "Connect Grok",
    multipleAccounts: false,
    config: {},
  },
};

export function AddAgentAccountDialog({
  environmentId,
  environmentLabel,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly onClose: () => void;
}) {
  const [provider, setProvider] = useState<AccountProvider | null>(null);
  const [name, setName] = useState("");
  const [instanceId, setInstanceId] = useState<ProviderInstanceId | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const persist = usePersistEnvironmentProviderInstanceMutation(environmentId);
  const settings = useEnvironmentSettings(environmentId);
  const selected = provider && provider !== "codex" ? ACCOUNT_PROVIDERS[provider] : null;
  async function addAccount() {
    if (
      !selected ||
      pending ||
      !name.trim() ||
      !readEnvironmentScope(environmentId, AuthProvidersManageScope)
    )
      return;
    setPending(true);
    setError(null);
    const existing = selected.multipleAccounts
      ? undefined
      : Object.entries(settings.providerInstances ?? {}).find(
          ([, instance]) => instance.driver === selected.driver,
        );
    const id = existing
      ? ProviderInstanceId.make(existing[0])
      : ProviderInstanceId.make(`${provider}_${randomUUID()}`);
    const result = await persist({
      operation: existing ? "upsert" : "create",
      instanceId: id,
      instance: {
        ...existing?.[1],
        driver: ProviderDriverKind.make(selected.driver),
        enabled: true,
        displayName: `${selected.label} · ${name.trim()}`,
        config: {
          ...(existing?.[1].config as Record<string, unknown> | undefined),
          ...selected.config,
        },
      },
    });
    setPending(false);
    if (result._tag === "Success") setInstanceId(id);
    else {
      const cause = squashAtomCommandFailure(result);
      setError(cause instanceof Error ? cause.message : "Could not add the account. Try again.");
    }
  }
  if (provider === "codex")
    return <AddManagedCodexAccountDialog environmentId={environmentId} onClose={onClose} />;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <WizardPopup size="wide">
        <WizardHeader
          title={
            provider === null
              ? "Add account"
              : instanceId
                ? `Connect ${name.trim()}`
                : (selected?.title ?? "Add account")
          }
          description="Keep accounts signed in separately. Switch between accounts of the same provider from the chat's model picker and continue your conversation."
        />
        {instanceId && provider === "google" ? (
          <GoogleAccountSetupStep
            environmentId={environmentId}
            environmentLabel={environmentLabel}
            instanceId={instanceId}
            onFinish={onClose}
          />
        ) : instanceId ? (
          <ProviderWizardAuthenticationStep
            environmentId={environmentId}
            environmentLabel={environmentLabel}
            instanceId={instanceId}
            autoStart
            onFinish={onClose}
          />
        ) : (
          <>
            <WizardPanel>
              {provider === null ? (
                <div className="flex flex-wrap gap-3">
                  <Button variant="outline" onClick={() => setProvider("claude")}>
                    Claude Code
                  </Button>
                  <Button variant="outline" onClick={() => setProvider("codex")}>
                    Codex / ChatGPT
                  </Button>
                  <Button variant="outline" onClick={() => setProvider("google")}>
                    Google / Gemini
                  </Button>
                  <Button variant="outline" onClick={() => setProvider("grok")}>
                    Grok
                  </Button>
                </div>
              ) : (
                <form
                  id="add-agent-account"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void addAccount();
                  }}
                >
                  <SettingsRow
                    title="Account name"
                    description="Use a name you'll recognize in the model picker, such as Personal or Work."
                    control={
                      <Input
                        autoFocus
                        aria-label="Account name"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        disabled={pending}
                        placeholder="Personal or Work"
                      />
                    }
                  />
                  {error ? (
                    <p role="alert" className="text-sm text-destructive">
                      {error}
                    </p>
                  ) : null}
                </form>
              )}
            </WizardPanel>
            <WizardFooter>
              <Button
                variant="outline"
                disabled={pending}
                onClick={provider ? () => setProvider(null) : onClose}
              >
                {provider ? "Back" : "Cancel"}
              </Button>
              {provider ? (
                <Button form="add-agent-account" type="submit" disabled={pending || !name.trim()}>
                  {pending ? "Preparing account…" : "Continue to sign in"}
                </Button>
              ) : null}
            </WizardFooter>
          </>
        )}
      </WizardPopup>
    </Dialog>
  );
}

/** Antigravity may need its runtime installed before Google sign-in can start. */
function GoogleAccountSetupStep({
  environmentId,
  environmentLabel,
  instanceId,
  onFinish,
}: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly instanceId: ProviderInstanceId;
  readonly onFinish: () => void;
}) {
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? EMPTY_SERVER_PROVIDERS;
  const provider = providers.find((candidate) => candidate.instanceId === instanceId);
  const signedIn = provider?.auth.status === "authenticated";
  return (
    <>
      <WizardPanel className="min-h-72">
        <ProviderSetupSection
          environmentId={environmentId}
          environmentLabel={environmentLabel}
          instanceId={instanceId}
          provider={provider}
          enabled
          readOnly={false}
          onEnable={() => {}}
        />
      </WizardPanel>
      <WizardFooter>
        <Button size="sm" variant={signedIn ? "default" : "outline"} onClick={onFinish}>
          {signedIn ? "Done" : "Finish later"}
        </Button>
      </WizardFooter>
    </>
  );
}
