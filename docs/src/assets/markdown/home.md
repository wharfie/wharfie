<h1 align="center">
  <img src="../images/beanie.png?as=webp" alt="Wharfie Beanie Logo" width="200">
  <br>
  Wharfie
</h1>

Wharfie is an experimental, local-first TypeScript application runtime. Its
goal is to turn an ordinary CLI into a portable executable, then let that same
application become a durable, observable service across trusted machines
without an architectural rewrite.

The project is being reset around that goal. Wharfie v1's Athena and table
framework is no longer part of the product, and breaking changes are expected.

## The intended path

1. Write and run a normal TypeScript or JavaScript CLI locally.
2. Declare named activities that can be run and observed durably.
3. Package the application as a Node SEA executable for a specific target.
4. Promote that executable to a persistent single-node service.
5. Enroll more trusted nodes when placement or recovery requires them.

The current implementation proves parts of the first three steps. Durable
resident services, provider-backed deployment, and the trusted-node mesh remain
roadmap work; Wharfie is not production ready.

## Start locally

```bash
wharfie app manifest ./path/to/app
wharfie app run <activity-id> --dir ./path/to/app --event '{"who":"cli-user"}'
wharfie app package ./path/to/app
```

The shipped top-level CLI contains `app` and `ops`. See the
[Quickstart Guide](/quickstart), the
[project charter](https://github.com/wharfie/wharfie/blob/master/PROJECT.md), and
the [roadmap](https://github.com/wharfie/wharfie/blob/master/ROADMAP.md) for the
current contract and delivery sequence.
