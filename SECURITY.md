# Security Policy

## Security Overview

FeCode is an interactive coding assistant running locally inside your terminal. Because FeCode has the capability to inspect code, edit files, and execute shell commands, security and boundary enforcement are the core architectural foundations of the system.

---

## Core Security Invariants

FeCode enforces 17 formal security invariants verified by automated test suites on every build:

1. **Authoritative Execution Boundary**: All protected operations (file creation, modification, deletion, and command execution) must execute strictly via the `ExecutionHandoffManager`.
2. **No Permission Bypass**: Tools cannot execute without matching permission checks against active policies.
3. **No Risk Downgrade**: High-risk operations (e.g. system commands, mass file mutations) cannot be silently demoted to lower risk tiers.
4. **Single-Use Checkpoints & Approvals**: Approvals granted for a step cannot be reused, replayed, or inherited by subsequent steps or resumed sessions.
5. **No Cross-Run Inheritance**: Resumed runs generate fresh run IDs and require new approvals.
6. **No Destructive Automatic Retry**: Failed destructive commands are never retried automatically without explicit human instruction.
7. **No Autonomous Background Loops**: FeCode never enters an unsupervised execution loop. Every change requires human-in-the-loop validation.
8. **Credential & Secret Sanitization**: Persisted session history and diagnostic dumps automatically redact API keys, tokens, and authorization headers.
9. **OS-Level Secure Credential Storage**: All AI provider API keys configured inside FeCode are stored exclusively in native operating system credential vaults (Windows Credential Manager, macOS Apple Keychain, Linux Secret Service / Keyutils). API keys are NEVER written in plaintext to configuration files (`.env`, `.fecode/config.json`, `providers.json`), project directories, run histories, or terminal logs.
10. **Masked Interactive Secret Input**: Secrets typed or pasted into FeCode configuration forms are strictly masked in the TUI (`*`), immediately cleared from memory upon storage, and opaque references (`fecode:profile:<id>`) are used in persistent metadata.

---

## AI Provider Credential Security Architecture

FeCode provides native, in-app AI provider configuration without requiring plaintext `.env` files.

### 1. Native Vault Integrations
- **Windows**: Windows Credential Manager via native win32 credential vault.
- **macOS**: Apple Keychain via Security Framework.
- **Linux**: FreeDesktop Secret Service API (`gnome-keyring`, `KWallet`, `KeePassXC`) with kernel `keyutils` fallback.

### 2. Opaque Credential References
Stored profiles in `~/.fecode/providers.json` contain metadata only:
```json
{
  "id": "prof-gemini-m8x9y0",
  "providerId": "gemini",
  "displayName": "Google Gemini Flash",
  "model": "gemini-2.5-flash",
  "credentialReference": "fecode:profile:prof-gemini-m8x9y0"
}
```
The actual secret is stored under the opaque reference in the OS vault. Profile deletion purges the credential from the OS vault.

### 3. Failure Behavior
If secure OS storage is inaccessible (e.g. in restricted sandboxes or headless CI without a keyring daemon), FeCode raises a `SecureCredentialStoreUnavailableError` with clear troubleshooting steps. FeCode **never silently falls back to plaintext storage**.

---

## Reporting a Vulnerability

If you discover a potential security vulnerability in FeCode, please report it responsibly:

1. **Do not create public GitHub issues** detailing the vulnerability or exploit.
2. Open a **Private Security Advisory** on the repository's GitHub page:
   - Navigate to the **Security** tab of the repository.
   - Click **Advisories** → **New draft security advisory**.
3. Include:
   - Description of the vulnerability.
   - Steps to reproduce or proof-of-concept.
   - Affected versions and configurations.
   - Proposed mitigation (if available).

We will investigate and acknowledge your report within 48 hours, develop a fix, and coordinate disclosure.
