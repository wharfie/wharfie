# Resumable hello

This showcase answers "Why Wharfie?" with one linear workflow:

```text
prepare greeting -> wait on a durable timer -> say hello
```

The root `npm run demo -- Ada` command packages this application, moves only
the executable into a clean temporary directory, and runs it with Node absent
from `PATH`. It starts the workflow, waits until preparation is committed,
kills the resident with `SIGKILL`, and retains the exact packaged coordinator
inspection from a new process. Because the killed resident leaves authority
ACTIVE, the demo explicitly confirms takeover-and-release from that inspection
before it repeats the identical named run command. A bare repeat is never used
to replace the resident. After the replacement run exits, another process reads
the retained terminal greeting.

The final proof requires exactly one `prepare-greeting` invocation and one
physical attempt with the same identities before and after the crash. It also
requires the original timer identity and deadline to survive.

The inspected takeover is the operator safety boundary for coordinator
authority. The separate identical run proves that work committed before the
interruption is not redispatched and that the timer is not recreated. It does
not claim that arbitrary activity code physically executes exactly once if a
process dies while that activity is running.
