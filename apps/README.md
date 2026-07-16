# Apps

`apps/` stays top-level. It is the home for buildable Wharfie applications,
dogfood manifests, and reference artifacts that exercise the CLI/runtime end to
end.

`wharfie-cli` is an unshipped source prototype for an eventual self-hosting
builder. The supported builder currently runs from the npm package under the
pinned Node toolchain. `wharfie-v1` is abandoned legacy content and is scheduled
for deletion in the next cleanup slice; it is excluded from the npm package.
