# Local Windows fork

This checkout uses `origin` for `MoutranCorp/t3code` and `upstream` for
`pingdotgg/t3code`. Local development runs from the source checkout.

From PowerShell in the repository root:

```powershell
.\Start-T3Fork.ps1 -Install # First install or after dependency changes
.\Start-T3Fork.ps1          # Start web client and server
.\Start-T3Fork.ps1 -Desktop # Start Electron and web development
```

Open the pairing URL printed by the runner. Stop the launcher with Ctrl+C.
The launcher stores T3 data and Kimi data below the gitignored `.t3` directory,
and uses tooling and caches on `P:`. It pins Node and pnpm to the versions in
this checkout's `package.json`; update the launcher pins when upstream changes them.

## Kimi Plus

Kimi Code's `k3.1-pro` model is included in Plus, with 262,144 context tokens.
Use the Kimi Code subscription login rather than a separately billed platform API key.
See [Kimi's model documentation](https://www.kimi.com/code/docs/en/kimi-code/models).

```powershell
.\Start-T3Fork.ps1 -Login
```

If setting up another checkout, add **Settings → Providers → Add provider →
Local ACP command**, name it **Kimi Code**, choose the installed `kimi.exe`,
and add `acp` as its argument. Set the provider's `KIMI_CODE_HOME` environment
override to this checkout's `.t3\kimi` directory. Select `kimi-code/k3.1-pro`
in the model picker. Keep thinking enabled. If the model is absent, sign in
again to refresh the Kimi model catalog, then restart the provider.

The initial workspace is preconfigured with this local ACP provider and default
model. Credentials, pairing tokens, databases, and sessions stay in `.t3` and
must never be committed.

## Updating the source

```powershell
git fetch upstream main
git merge upstream/main
.\Start-T3Fork.ps1 -Install
```

Resolve and verify merge conflicts before using the updated checkout. Automated
upstream updates and toggleable UI extensions are future work.
