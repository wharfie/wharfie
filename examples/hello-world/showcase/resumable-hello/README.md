# Resumable hello

This showcase answers "Why Wharfie?" with one linear workflow:

```text
prepare greeting -> wait on a durable timer -> say hello
```

The root `npm run demo -- Ada` command packages this application, moves only
the executable into a clean temporary directory, and runs it with Node absent
from `PATH`. It starts the workflow, waits until preparation is committed,
kills the resident with `SIGKILL`, and inspects the retained state from a new
process. It then restarts the same executable and reads the terminal greeting
after the replacement resident exits.

The final proof requires exactly one `prepare-greeting` invocation and one
physical attempt with the same identities before and after the crash. It also
requires the original timer identity and deadline to survive.

This demonstrates that work committed before this interruption is not
redispatched. It does not claim that arbitrary activity code physically
executes exactly once if a process dies while that activity is running.

