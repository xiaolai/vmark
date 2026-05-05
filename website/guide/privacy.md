# Privacy

VMark respects your privacy. Here's exactly what happens — and what doesn't.

## What VMark Sends

VMark includes an **auto-update checker** that periodically contacts our server to see if a new version is available. This is the **only** network request VMark makes.

Each check sends exactly these fields — nothing more:

| Data | Example | Purpose |
|------|---------|---------|
| IP address | `203.0.113.42` | Inherent in any HTTP request — we can't not receive it |
| OS | `darwin`, `windows`, `linux` | To serve the correct update package |
| Architecture | `aarch64`, `x86_64` | To serve the correct update package |
| App version | `0.5.10` | To determine if an update is available |
| Machine hash | `a3f8c2...` (64-char hex) | Anonymous device counter — SHA-256 of hostname + OS + arch; not reversible |

The full URL looks like:

```text
GET https://log.vmark.app/update/latest.json?target=darwin&arch=aarch64&version=0.5.10
X-Machine-Id: a3f8c2b1d4e5f6078a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1
```

You can verify this yourself — the endpoint is in [`tauri.conf.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/tauri.conf.json) (search for `"endpoints"`), and the hash is in [`lib.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/lib.rs) (search for `machine_id_hash`).

## What VMark Does NOT Send

- Your documents or their contents
- File names or paths
- Usage patterns or feature analytics
- Personal information of any kind
- Crash reports
- Keystroke or editing data
- Reversible hardware identifiers or fingerprints
- The machine hash is a one-way SHA-256 digest — it cannot be reversed to recover your hostname or any other input

## How We Use the Data

We aggregate the update check logs to produce the live statistics shown on our [homepage](/):

| Metric | How it's calculated |
|--------|-------------------|
| **Unique devices** | Count of distinct machine hashes per day/week/month |
| **Unique IPs** | Count of distinct IP addresses per day/week/month |
| **Pings** | Total number of update check requests |
| **Platforms** | Count of pings per OS + architecture combination |
| **Versions** | Count of pings per app version |

These numbers are published openly at [`log.vmark.app/api/stats`](https://log.vmark.app/api/stats). Nothing is hidden.

**Important caveats:**
- Unique IPs undercount real users — multiple people behind the same router/VPN count as one
- Unique devices provide more accurate counts, but a hostname change or fresh OS install generates a new hash
- Pings overcount real users — one person may check multiple times per day

## Data Retention

- Logs are stored on our server in standard access log format
- Log files rotate at 1 MB and only the 3 most recent files are kept
- Logs are not shared with anyone
- There is no account system — VMark doesn't know who you are
- The machine hash is not linked to any account, email, or IP address — it is a pseudonymous device counter only
- We do not use tracking cookies, fingerprinting, or any analytics SDK

## Open Source Transparency

VMark is fully open source. You can verify everything described here:

- Update endpoint configuration: [`src-tauri/tauri.conf.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/tauri.conf.json)
- Machine hash generation: [`src-tauri/src/lib.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/lib.rs) — search for `machine_id_hash`
- Server-side stats aggregation: [`scripts/vmark-stats-json`](https://github.com/xiaolai/vmark/blob/main/scripts/vmark-stats-json) — the exact script that runs on our server to produce the [public stats](https://log.vmark.app/api/stats)
- No other network calls exist in the codebase — search for `fetch`, `http`, or `reqwest` yourself

## Disabling Update Checks

If you prefer to disable automatic update checks entirely, you can block `log.vmark.app` at the network level (firewall, `/etc/hosts`, or DNS). VMark will continue to work normally without it — you just won't receive update notifications.
