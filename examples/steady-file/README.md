# steady-file

This supported developer-preview starter checks whether a regular file has the
same contents at two observations. Its Wharfie workflow performs the same work
as two durable activities separated by a one-minute framework timer. The
ordinary CLI keeps a short 250-millisecond observation window.

From the clean builder workspace where this directory was copied:

```bash
node ./steady-file/local.js /absolute/path/to/artifact.tar

./node_modules/.bin/wharfie app manifest ./steady-file

./node_modules/.bin/wharfie ops start \
  --dir ./steady-file \
  --json \
  -- /absolute/path/to/artifact.tar

./node_modules/.bin/wharfie ops worker --dir ./steady-file
```

Package only the target that will run the application:

```bash
./node_modules/.bin/wharfie app package ./steady-file \
  --target node24.13.1-linux-x64-glibc \
  --output-dir ./dist \
  --json
```

The package receipt identifies the generated executable. On a supported Linux
host, that executable owns ordinary application arguments while its `wharfie`
namespace owns durable and service operations:

```bash
<steady-file> /absolute/path/to/artifact.tar
<steady-file> wharfie start --json -- /absolute/path/to/artifact.tar
<steady-file> wharfie service install --json
<steady-file> wharfie list --limit 10 --json
<steady-file> wharfie inspect --run-id <run-id> --json
<steady-file> wharfie output \
  --run-id <run-id> \
  --confirm-sensitive-output \
  --json
<steady-file> wharfie service uninstall --json
```

The packaged application does not require Node on its command path. The builder
does require the exact Node and npm versions declared by the installed Wharfie
package. `service install` requires a non-root Linux user with a usable systemd
user manager. Uninstall preserves durable state and releases; complete
application-state cleanup is still part of the developer-preview milestone.
