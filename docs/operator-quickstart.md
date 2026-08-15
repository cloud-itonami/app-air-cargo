# Operator quickstart — app-air-cargo

Every claim in [`../README.md`](../README.md) is reproduced by a command here.
All of these were run on 2026-08-16 against `281772d5` and the output shown is
what they printed. Where something could **not** be walked, §7 says so and why —
a step that was skipped is not a step that passed.

Read §0 first. Three of the commands below fail in a misleading way if you skip
it.

## §0 Four things that will waste your time

1. **The remote is not called `origin`.** west names remotes after the org, so
   this checkout has `cloud-itonami`. `git fetch origin` fails with
   *"Please make sure you have the correct access rights"* and
   `origin/main` does not resolve. Use `cloud-itonami/main`.
2. **`git` here may print `error: could not read IPC response`.** That is the
   fsmonitor daemon, not your command. It is noise on stderr and the command
   still succeeds; pass `-c core.fsmonitor=false` to silence it.
3. **zsh does not word-split unquoted variables.** `find $SCOPE -type f` with
   `SCOPE="a b c"` looks for one directory literally named `a b c` and quietly
   reports **zero files**, which reads exactly like "nothing matched". Write the
   paths out. Every search in §5 prints a file count first for this reason.
4. **There is no `.gitignore`.** Building inside the checkout leaves
   `node_modules/` and `.svelte-kit/` untracked. §4 and §5 build in scratch
   copies under `/tmp` so the checkout stays byte-clean.

Set this once:

```bash
REPO=~/github/com-junkawasaki/orgs/cloud-itonami/app-air-cargo
UP=~/github/com-junkawasaki/orgs/etzhayyim/root
```

## §1 Provenance — is this really a verbatim copy?

`migration.edn` makes four checkable claims. Confirm the upstream commit is
present locally first (`etzhayyim/root` must be a full, non-shallow clone —
a shallow one answers ancestry questions wrongly and confidently):

```bash
git -C "$UP" rev-parse --is-shallow-repository        # → false
git -C "$UP" cat-file -t 0c30514ab1ac7f929b1c796f2d03594117fae2d7   # → commit
```

Tree, file count, byte total:

```bash
REV=0c30514ab1ac7f929b1c796f2d03594117fae2d7
P=60-apps/etzhayyim-project-air-cargo
git -C "$UP" rev-parse "$REV:$P"
# → 0c96f688601b182cada66b9270a28259313937f3   (matches :tree)

git -C "$UP" ls-tree -r --name-only "$REV:$P" | sort > /tmp/upstream-files.txt
wc -l < /tmp/upstream-files.txt                       # → 20   (matches :tracked-files)

git -C "$UP" ls-tree -r -l "$REV:$P" | awk '{s+=$4} END {print s}'
# → 48042                                             (matches :bytes)
```

Byte-identity of every blob, plus what exists downstream that upstream does not:

```bash
match=0; differ=0; missing=0
while IFS= read -r f; do
  a=$(git -C "$UP" rev-parse "$REV:$P/$f" 2>/dev/null)
  b=$(git -C "$REPO" rev-parse "HEAD:$f" 2>/dev/null)
  if   [ -z "$b" ];      then echo "MISSING: $f"; missing=$((missing+1))
  elif [ "$a" = "$b" ];  then match=$((match+1))
  else echo "DIFFER: $f"; differ=$((differ+1)); fi
done < /tmp/upstream-files.txt
echo "SCANNED=$(wc -l < /tmp/upstream-files.txt) MATCH=$match DIFFER=$differ MISSING=$missing"
# → SCANNED=20 MATCH=20 DIFFER=0 MISSING=0

git -C "$REPO" ls-files | sort > /tmp/down-files.txt
comm -13 /tmp/upstream-files.txt /tmp/down-files.txt
```

The last command lists the files added by the extraction. It must agree with
`:identity :allowed-additions` in `migration.edn` — that field exists so this
comparison stays meaningful. **If you add a file to this repository, add it
there too**, or the next person to run this check will see drift that is not
drift. (`README.md` and `docs/operator-quickstart.md` were added this way on
2026-08-16.)

## §2 Where the upstream went

```bash
git -C "$UP" fetch origin
git -C "$UP" ls-tree --name-only origin/main 60-apps/
# → 60-apps/etzhayyim-project-organism        (one entry; ours is not it)

git -C "$UP" log -1 --format='%ad %s' 0c30514ab1ac7f929b1c796f2d03594117fae2d7
# → Mon Jul 20 01:08:14 2026 +0900 refactor(apps): extract nineteen-file band (#3256)
```

## §3 The live surface

Four hostnames matter: the two routes in `wrangler.jsonc`, and the two upstreams
the code proxies to. Check all four against three independent resolvers — one
resolver can be wrong or cached, and NXDOMAIN is the claim being made:

```bash
for r in 1.1.1.1 8.8.8.8 9.9.9.9; do
  for h in air-cargo.etzhayyim.com a1rcarg0.etzhayyim.com \
           dispatcher.etzhayyim.com mcp.etzhayyim.com; do
    s=$(dig @$r +noall +comments "$h" A | grep -o 'status: [A-Z]*' | head -1)
    printf '%-10s %-32s %s\n' "$r" "$h" "$s"
  done
done
```

All twelve print `status: NXDOMAIN`. Now show the zone itself is fine, so this
is four missing labels rather than a dead domain:

```bash
dig +short etzhayyim.com NS      # → everton/vivienne.ns.cloudflare.com
dig +short etzhayyim.com A       # → 172.67.179.128, 104.21.51.111
curl -sS -o /dev/null -w '%{http_code}\n' https://etzhayyim.com/     # → 200
```

The actor DID follows from this and needs no separate judgement:
`did:web:air-cargo.etzhayyim.com` resolves by fetching
`https://air-cargo.etzhayyim.com/.well-known/did.json`, which cannot be
requested at all (`curl: (6) Could not resolve host`).

## §4 The test suite — and how to actually run it

`cd kotoba && npm install` **fails on this machine**:

```
npm error code 1
npm error git dep preparation failed
npm error npm error code EALLOWSCRIPTS
npm error npm error --allow-scripts is not allowed in project-scoped installs.
```

npm 11.16.0 refuses to run install scripts, and `@etzhayyim/sdk` needs its
`prepare: tsc` to produce the `dist/` its `main` points at. Adding an
`allowScripts` field to `kotoba/package.json` **does not fix it** — the failure
is inside the *nested* install npm runs in its own clone of the git dep, which
your field does not reach. (It would also modify a file that must stay
byte-identical to upstream; see §1.)

You do not need the SDK to run these tests. `registry.ts` imports it as
`import type`, which is erased before anything executes, and `@etzhayyim/sdk-mock`
is 309 lines of TypeScript with **zero imports** and no build step. So:

```bash
# the mock, at exactly the sha kotoba/package.json pins
git clone https://github.com/etzhayyim/com-etzhayyim-sdk-mock.git /tmp/sdkmock-build
git -C /tmp/sdkmock-build checkout c857ff9be5310bf433bfe1e8d3c0f677e213d667

# a scratch copy of kotoba/ with only vitest as a dependency
rm -rf /tmp/aircargo-testrun && cp -R "$REPO/kotoba/." /tmp/aircargo-testrun
cd /tmp/aircargo-testrun && rm -rf node_modules package-lock.json
node -e 'const fs=require("fs"),p=JSON.parse(fs.readFileSync("package.json","utf8"));
delete p.dependencies; p.devDependencies={typescript:"^5.6.0",vitest:"^4.1.0"};
fs.writeFileSync("package.json",JSON.stringify(p,null,2))'
npm install --no-audit --no-fund

mkdir -p node_modules/@etzhayyim
ln -sfn /tmp/sdkmock-build node_modules/@etzhayyim/sdk-mock

npx vitest run
# → Test Files  1 passed (1)
# →      Tests  7 passed (7)
```

The mock source is used unmodified at the pinned sha; only the *dependency
wiring* is substituted.

### The tests discriminate

A suite that cannot fail is not evidence. Break the implementation three ways
and confirm the right test catches each:

```bash
cd /tmp/aircargo-testrun
cp src/registry.ts /tmp/reg.bak; cp src/types.ts /tmp/types.bak

# M1 — drop the FK existence check in assignUld
perl -0pi -e 's/if \(!\(await shipmentExists\(e, input\.awbNo\)\)\) return \{ status: "rejected", error: "shipmentNotFound" \};//' src/registry.ts
npx vitest run    # → 1 failed | 6 passed
                  #   × FK: uldAssignment requires an existing shipment (exists check)
cp /tmp/reg.bak src/registry.ts

# M2 — make isDecimalString accept any string
perl -0pi -e 's/return typeof s === "string" && \/\^\\d\+\(\\\.\\d\+\)\?\$\/\.test\(s\);/return typeof s === "string";/' src/types.ts
npx vitest run    # → 3 failed | 4 passed  (shipment, AWB, claim+screening)
cp /tmp/types.bak src/types.ts

# M3 — let isUint accept negatives
perl -0pi -e 's/return typeof n === "number" && Number\.isInteger\(n\) && n >= 0;/return typeof n === "number" \&\& Number.isInteger(n);/' src/types.ts
npx vitest run    # → 1 failed | 6 passed  (shipment validation)
cp /tmp/types.bak src/types.ts

npx vitest run    # → 7 passed (7)
```

## §5 What actually gets deployed

`wrangler.jsonc` sets `main` to `svelte/.svelte-kit/cloudflare/_worker.js`.
Build exactly that artifact:

```bash
rm -rf /tmp/aircargo-svelte && cp -R "$REPO/svelte" /tmp/aircargo-svelte
cd /tmp/aircargo-svelte && npm install --no-audit --no-fund     # 92 packages, registry only
node ~/github/com-junkawasaki/scripts/resource-guard.mjs run build -- npx vite build
ls -l .svelte-kit/cloudflare/_worker.js      # → 4335 bytes
```

The build is routed through `resource-guard.mjs` because this workspace caps
concurrent builds at one; calling `vite build` directly is a policy violation,
not just a courtesy.

**The deployed closure is larger than `.svelte-kit/cloudflare/`.** `_worker.js`
is a shim whose first lines import across a directory boundary:

```bash
head -3 .svelte-kit/cloudflare/_worker.js
# import { Server } from "./../output/server/index.js";
# import { manifest, prerendered, base_path } from "./../cloudflare-tmp/manifest.js";
```

Searching only `cloudflare/` returns zero hits **for everything, including code
that is certainly deployed** — which reads as proof of absence and is not.
Search the real closure, print the file count first, and include a control group
that must be present:

```bash
cd /tmp/aircargo-svelte
find .svelte-kit/cloudflare .svelte-kit/output/server .svelte-kit/cloudflare-tmp -type f | wc -l
# → 42        (if this is 0, the search below proves nothing)

# CONTROL — the svelte BFF. Must be non-zero.
for sym in "mcp.etzhayyim.com" "sveltekit-edge-bff" "x-etzhayyim-xrpc-method" "tools/call"; do
  n=$(grep -rlF "$sym" .svelte-kit/cloudflare .svelte-kit/output/server .svelte-kit/cloudflare-tmp | wc -l)
  printf '  %-42s files=%s\n' "$sym" "$n"
done
# → all 1

# src/app.ts — nine symbols unique to it
for sym in NSID_PREFIX proxyToDispatcher bodyWithQuery DISPATCHER_INTERNAL_SECRET \
           "dispatcher.etzhayyim.com" "edge-proxy+agentgateway-mcp+langserver" \
           "_app/meta" reportCargoSecurity InvalidJson; do
  n=$(grep -rlF "$sym" .svelte-kit/cloudflare .svelte-kit/output/server .svelte-kit/cloudflare-tmp | wc -l)
  printf '  %-42s files=%s\n' "$sym" "$n"
done
# → all 0

# kotoba/ — five symbols
for sym in registerShipment assignUld encryptedWrite "airCargo.shipment" AIR_CARGO_DID_PREFIX; do
  n=$(grep -rlF "$sym" .svelte-kit/cloudflare .svelte-kit/output/server .svelte-kit/cloudflare-tmp | wc -l)
  printf '  %-42s files=%s\n' "$sym" "$n"
done
# → all 0
```

Control non-zero and both subjects zero is the discriminating result:
`src/app.ts` and `kotoba/` are not in the deploy.

## §6 The four method vocabularies

```bash
cd "$REPO" && node -e '
const fs=require("fs");
const jsonld=JSON.parse(fs.readFileSync("kotodama.jsonld","utf8"));
const w=JSON.parse(fs.readFileSync("wrangler.jsonc","utf8").replace(/^\s*\/\/.*$/gm,""));
const app=new Set(fs.readFileSync("src/app.ts","utf8").match(/methods: \[([^\]]+)\]/)[1].match(/"([^"]+)"/g).map(s=>s.replace(/"/g,"")));
const ex=new Set(fs.readFileSync("kotoba/src/index.ts","utf8").match(/^\s{2}(\w+),$/gm).map(s=>s.trim().replace(",","")));
const kot=new Set(jsonld.profile.capabilities);
console.log("kotodama:",kot.size,"wrangler:",JSON.parse(w.vars.APP_CAPABILITIES).length,"app.ts:",app.size,"kotoba:",ex.size);
console.log("declared caps WITH an implementation:",[...kot].filter(x=>ex.has(x)));
console.log("app.ts methods NOT in kotoba:",[...app].filter(x=>!ex.has(x)));
'
# → kotodama: 3 wrangler: 3 app.ts: 8 kotoba: 11
# → declared caps WITH an implementation: [ 'issueAirWaybill' ]
# → app.ts methods NOT in kotoba: [ 'createCargoBooking','acceptCargo','processClaim','settleCargoAccount' ]
```

Of those four, `settleCargoAccount` is a documented exclusion — `kotoba/src/types.ts`
states CASS fiat settlement execution stays etzhayyim-side under
consent-capability. The other three are simply unimplemented.

The landing page's self-description disagrees with the config beside it:

```bash
node -e '
const fs=require("fs");
const w=JSON.parse(fs.readFileSync("wrangler.jsonc","utf8").replace(/^\s*\/\/.*$/gm,""));
const app=JSON.parse(fs.readFileSync("svelte/src/routes/+page.svelte","utf8").match(/const app = (\{[\s\S]*?\n\});/)[1]);
console.log("wrangler routes:",w.routes.length,"vars:",Object.keys(w.vars).length);
console.log("page routeCount:",app.routeCount,"routes:",app.routes.length,"vars:",app.vars.length);
console.log("page relativePath:",app.relativePath);
'
# → wrangler routes: 2 vars: 8
# → page routeCount: 0 routes: 0 vars: 0
# → page relativePath: 60-apps/etzhayyim-project-air-cargo/svelte/src/routes/+page.svelte
```

## §7 NOT WALKED

These were attempted and could not be completed. None of them is reported as a
pass.

- **`npm run typecheck` in `kotoba/`.** Needs real `@etzhayyim/sdk` type
  declarations, which need its `prepare: tsc` build, which is blocked by
  EALLOWSCRIPTS (§4). Running `tsc --noEmit` against the §4 scratch tree emits
  `TS2307: Cannot find module '@etzhayyim/sdk'` plus follow-on `TS7006`s —
  **that is my substitution missing the module, not a defect in this repo.** Do
  not quote it as one.
- **`npm run typecheck` at the repo root.** The script is `tsc --noEmit` and
  there is **no root `tsconfig.json`**, so it does not typecheck what the name
  implies. Left alone rather than "fixed": changing it would modify an
  upstream-verbatim file (§1).
- **`npm run check` in `svelte/`.** Runs `svelte-kit sync && svelte-check`; not
  exercised. The `vite build` in §5 succeeded, which is the stronger claim for
  the deployed artifact, but it is not a type check.
- **Any live request.** All four hostnames are NXDOMAIN (§3), so there is no
  deployed instance to probe and no way to distinguish "would work" from
  "would fail" by observation.
- **`wrangler deploy`.** Not attempted. The routes point at hostnames that do
  not exist in the zone, and deploying to establish them is an owner decision
  about whether this app should exist at all — see the README's closing section.

### One correction worth recording

An early pass of this audit reported that both SDK pins were **dangling**, based
on `gh api repos/…/commits/<sha>` returning `404`. That was wrong: the 404 came
from a malformed URL in a shell loop. Checked directly, both pinned commits
exist and are ancestors of their `main`:

```bash
git -C /tmp/sdkmock-build merge-base --is-ancestor \
  c857ff9be5310bf433bfe1e8d3c0f677e213d667 origin/main && echo ancestor
```

When an API says something is missing, confirm with the protocol that actually
serves it before writing it down.
