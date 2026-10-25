import { useState } from "react";
import {
  AuthProvidersManageScope,
  ProviderDriverKind,
  ProviderInstanceId,
  type EnvironmentId,
} from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { usePersistEnvironmentProviderInstanceMutation } from "../../hooks/useSettings";
import { readEnvironmentScope } from "../../state/session";
import { randomUUID } from "../../lib/utils";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Input } from "../ui/input";
import { WizardHeader, WizardPanel, WizardPopup, WizardFooter } from "../ui/wizard";
import { SettingsRow } from "./settingsLayout";
import { ProviderWizardAuthenticationStep } from "./ProviderWizardAuthenticationStep";
import { AddManagedCodexAccountDialog } from "./CodexSetupSection";

export function AddAgentAccountDialog({
  environmentId,
  environmentLabel,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly onClose: () => void;
}) {
  const [provider, setProvider] = useState<"claude" | "codex" | null>(null);
  const [name, setName] = useState("");
  const [instanceId, setInstanceId] = useState<ProviderInstanceId | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const persist = usePersistEnvironmentProviderInstanceMutation(environmentId);
  async function addClaude() {
    if (pending || !name.trim() || !readEnvironmentScope(environmentId, AuthProvidersManageScope))
      return;
    setPending(true);
    setError(null);
    const id = ProviderInstanceId.make(`claude_${randomUUID()}`);
    const result = await persist({
      operation: "create",
      instanceId: id,
      instance: {
        driver: ProviderDriverKind.make("claudeAgent"),
        enabled: true,
        displayName: `Claude · ${name.trim()}`,
        config: { managedAccount: true },
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
                : "Add Claude account"
          }
          description="Keep accounts signed in separately. Switch between accounts of the same provider from the chat's model picker and continue your conversation."
        />
        {instanceId ? (
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
                </div>
              ) : (
                <form
                  id="add-claude-account"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void addClaude();
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
                <Button form="add-claude-account" type="submit" disabled={pending || !name.trim()}>
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
