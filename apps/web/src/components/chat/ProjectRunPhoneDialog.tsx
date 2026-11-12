import type { AdvertisedEndpoint, EnvironmentId } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { CheckIcon, CopyIcon } from "lucide-react";
import { useState } from "react";

import { resolveDiscoveredServerUrl } from "~/browser/browserTargetResolver";
import { isElectron } from "~/env";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { desktopNetworkAccessStateAtom } from "~/state/desktopNetworkAccess";
import { useEnvironmentQuery } from "~/state/query";
import { readPreparedConnection } from "~/state/session";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { QRCodeSvg } from "../ui/qr-code";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { runPhoneAddresses } from "./projectRunControl.logic";

const NO_ENDPOINTS: ReadonlyArray<AdvertisedEndpoint> = [];

function PhoneAddresses(props: { readonly environmentId: EnvironmentId; readonly url: string }) {
  const resolvedUrl = resolveDiscoveredServerUrl(props.environmentId, props.url);
  // Only the desktop app knows this computer's network addresses, and only for its own server.
  const onThisDesktop =
    isElectron &&
    readPreparedConnection(props.environmentId)?.target._tag === "PrimaryConnectionTarget";
  const network = useEnvironmentQuery(onThisDesktop ? desktopNetworkAccessStateAtom : null);
  const addresses = runPhoneAddresses(
    resolvedUrl,
    network.data?.advertisedEndpoints ?? NO_ENDPOINTS,
  );
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const { copyToClipboard, isCopied } = useCopyToClipboard();

  if (addresses.length === 0) {
    if (onThisDesktop && network.data === null && network.error === null) {
      return <p className="text-muted-foreground text-sm">Looking up this computer's address…</p>;
    }
    return onThisDesktop ? (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm">
          Your phone can't reach this computer yet. Turn on network access, or Tailscale, in
          Connections settings, then try again.
        </p>
        <Button size="sm" variant="outline" render={<Link to="/settings/connections" />}>
          Connections settings
        </Button>
      </div>
    ) : (
      <p className="text-sm">
        Your phone can't reach this environment's apps through this connection. Connect to it over
        your local network or Tailscale instead.
      </p>
    );
  }

  const address = addresses.find((entry) => entry.url === selectedUrl) ?? addresses[0]!;
  return (
    <div className="flex flex-col items-center gap-4">
      {addresses.length > 1 ? (
        <ToggleGroup
          aria-label="Address"
          value={[address.url]}
          onValueChange={(next) => {
            if (next[0]) setSelectedUrl(next[0]);
          }}
        >
          {addresses.map((entry) => (
            <Toggle key={entry.url} value={entry.url}>
              {entry.label}
            </Toggle>
          ))}
        </ToggleGroup>
      ) : null}
      <div className="rounded-lg bg-white p-2">
        <QRCodeSvg value={address.url} size={176} level="M" marginSize={1} title={address.url} />
      </div>
      <div className="flex w-full items-center gap-2">
        <code className="min-w-0 flex-1 select-all truncate rounded-md bg-muted px-2 py-1.5 font-mono text-xs">
          {address.url}
        </code>
        <Button
          size="icon-sm"
          variant="outline"
          aria-label="Copy address"
          onClick={() => copyToClipboard(address.url)}
        >
          {isCopied ? <CheckIcon /> : <CopyIcon />}
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">
        Your phone needs to be on the same Wi-Fi, or on your tailnet. Nothing loads? Your app may
        only listen on this computer: start it with <code>--host</code>, for example{" "}
        <code>npm run dev -- --host</code>.
      </p>
    </div>
  );
}

/** A QR code and copyable address for opening a run's server on a phone. */
export function ProjectRunPhoneDialog(props: {
  readonly environmentId: EnvironmentId;
  /** The server's url as discovered on the environment; kept while the dialog closes. */
  readonly url: string | null;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Open on your phone</DialogTitle>
          <DialogDescription>Scan with your phone camera.</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {props.url === null ? null : (
            <PhoneAddresses environmentId={props.environmentId} url={props.url} />
          )}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
