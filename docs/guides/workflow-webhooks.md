# Start a workflow with a webhook

The Wharfie worker can receive a POST directly and start a named workflow.
Declare a route alongside `workflows` in `wharfie.app.js`. This example assumes
your manifest already declares the `investigate` workflow:

```js
webhooks: {
  datadog: { workflow: 'investigate', deliveryIdField: 'event_id' },
},
```

The map key is the route: `POST /hooks/datadog`. The entire JSON body becomes
the workflow input. The sender cannot choose another workflow or set the
ledger actor. At most 64 routes may be declared. No listener opens unless
the resident has both a declared route and a configured port.

## Try it locally

Set the port and a different random bearer token for each route in the
**worker's environment**. The variable name is `WHARFIE_WEBHOOK_TOKEN_`
followed by the route ID in uppercase with hyphens replaced by underscores.

```sh
export WHARFIE_WEBHOOK_PORT=8443
export WHARFIE_WEBHOOK_TOKEN_DATADOG="$(openssl rand -hex 32)"
./my-app wharfie worker
```

From source, use `wharfie ops worker --dir ./path/to/app` instead. From a
client with the same token:

```sh
curl -i http://127.0.0.1:8443/hooks/datadog \
  -H "Authorization: Bearer $WHARFIE_WEBHOOK_TOKEN_DATADOG" \
  -H 'Content-Type: application/json' \
  -d '{"event_id":"evt-17","service":"checkout"}'
```

`202 {"runId":"…"}` means the start is durably recorded. It does not mean the
workflow has finished. Use `./my-app wharfie inspect --run-id <runId> --json`.
Repeating the example against the same revision returns the same run ID, even
after a worker restart. The delivery key is scoped to the application and
route. Reusing it with different input or a different revision returns `409`;
retry the original request after a lost response.

Without `deliveryIdField`, the sender must provide an `Idempotency-Key`
header. With it, the named top-level JSON field must contain the delivery ID
as a string (1–256 visible ASCII characters, no spaces). For Datadog, configure
a custom JSON payload with a stable event ID as a **quoted string** and a
custom `Authorization` header. Use an event/delivery identity, not a monitor ID
that would be reused across alerts.

## Receive HTTPS directly

The default listener is loopback HTTP. For a remote sender, configure the
worker with a bind IP and paths to a PEM certificate chain and private key:

```sh
export WHARFIE_WEBHOOK_HOST=0.0.0.0
export WHARFIE_WEBHOOK_TLS_CERT_FILE=/etc/wharfie/webhook-chain.pem
export WHARFIE_WEBHOOK_TLS_KEY_FILE=/etc/wharfie/webhook-key.pem
```

With these settings the same worker serves HTTPS. Point the sender at
`https://<certificate-hostname>:8443/hooks/datadog`. DNS, a reachable port,
and a trusted certificate are deployment inputs. For an installed systemd user
service, supply these settings and tokens to the **service**, for example via
an `EnvironmentFile` in a unit drop-in. Keep that file private and restart the
service after rotation. `service install` does not copy your shell environment.

The listener accepts UTF-8 `application/json` up to 64 KiB, at most 64 levels
deep. Bad credentials return `401`; unknown paths `404`; wrong methods `405`;
invalid input or missing delivery ID `400`; oversized bodies `413`; unsupported
media types `415`. A `503` means admission could not be confirmed: retry with
the same delivery key and input.
