# operator-quickstart — app-air-cargo

**この repo で今日実際にできることを、踏める形で上から書く。** 所要 10 分。
Cloudflare のアカウントは要らない（§6 の deploy だけが要る）。

**出力はすべて 2026-08-18 に実際に walk した結果である。** 踏めなかったものは
§7 に、なぜ踏めなかったかと一緒に書いてある —— **飛ばした手順は通った手順では
ない。**

## §0 三つの、時間を無駄にすること

1. **remote は `origin` ではない。** west は remote を org 名で作るので、この
   checkout では `cloud-itonami` である。`git fetch origin` は
   *"Please make sure you have the correct access rights"* で落ち、`origin/main`
   も解決しない。`cloud-itonami/main` を使う。
2. **`git` が `error: could not read IPC response` を吐くことがある。** これは
   fsmonitor daemon であってあなたのコマンドではない。stderr のノイズで、
   コマンド自体は成功している。`-c core.fsmonitor=false` で黙る。
3. **`grep -c` は行を数える。出現回数ではない。** §3 の「CSS が入っているか」の
   判定はこれで一度誤った（1 行に 45 回現れるトークンを「1」と数えた）。
   出現回数が要るところでは数えるスクリプトを使う。

この walk で使った版:

| 要るもの | 版 |
|---|---|
| git | 2.51.0 |
| node | v26.3.0 |
| npm | 11.16.0 |
| nbb | v1.4.208 |
| clojure | 1.12.5.1654（ビルド時のみ） |
| wrangler | 4.123.0（§5 のみ） |

```bash
REPO=~/github/com-junkawasaki/orgs/cloud-itonami/app-air-cargo
K=~/github/com-junkawasaki/orgs/kotoba-lang
```

## §1 取得して、書いてあることが本当か検査する

```bash
git clone git@github.com:cloud-itonami/app-air-cargo.git
cd app-air-cargo
npx --yes nbb scripts/verify-docs-claims.cljs .        # <dir> は先頭に置く
```

実際の出力（末尾）:

```
SCANNED	25
PASS	tracked-files	expected=25	actual=25
PASS	inherited-bytes	expected=3970	actual=3970
...
PASS	kept-files	expected=7	actual=7
PASS	kept-bytes	expected=32149	actual=32149
PASS	kept-files-unchanged	expected=[]	actual=[]
PASS	appview-ts-files	expected=0	actual=0
PASS	appview-svelte-files	expected=0	actual=0
...
CHECKED	31
OK	every claim in README.md and docs/operator-quickstart.md holds
```

exit 0。**exit 2（UNDETERMINED）は 0 ではない** —— tree を読み切れなかったという
別の答えで、「検査して問題なし」と混ぜない。**31 claim ある**が、20 未満しか
評価できなかった場合も exit 2 になる（沈黙を緑として数えないための床）。

この検査には移行の不変条件が入っている: TypeScript / Svelte が戻っていないこと
（撤去した 9 パスの不在 + appview の `.ts` / `.svelte` の総数、および
`kotoba/` の 7 ファイルがハッシュごと動いていないこと）、`wrangler.jsonc` の `main`
が shadow の出力先を指していること、ページが route 表から描かれていること、
そして **`:warnings-as-errors` が `:compiler-options` の下に在ること**（§4）。

### 由来（provenance）

`migration.edn` が抽出元と、この移行が足した / 消したものを両方持っている。

```bash
UP=~/github/com-junkawasaki/orgs/etzhayyim/root
REV=0c30514ab1ac7f929b1c796f2d03594117fae2d7
P=60-apps/etzhayyim-project-air-cargo

git -C "$UP" rev-parse --is-shallow-repository        # → false（shallow だと祖先判定が嘘をつく）
git -C "$UP" ls-tree -r --name-only "$REV:$P" | wc -l # → 20   (:source :tracked-files と一致)
```

移行後も残る upstream ファイルは 11 個 —— byte 同一の 3 つ（`kotodama.jsonld` /
`MIGRATION-TODO.md` / `NOTICE`）、意図的に変更した `wrangler.jsonc`、そして
**appview ではないので撤去しなかった `kotoba/` の 7 つ**（§6）。撤去した 9 は
`:identity :removed-by-migration` に名前で載っており、検証器が
**「その 9 が tree に無いこと」** を claim として持っている。復元は:

```bash
git show 9e80d7d:src/app.ts | head -3                 # → 撤去した 76 行が取り出せる
```

**この repo にファイルを足したら `:allowed-additions` にも足すこと。** さもないと
次に検査する人が drift でないものを drift として見る。検証器の
`every-added-file-is-registered` claim がそれを強制する。

## §2 テストを走らせる（ビルド不要・ブラウザ不要）

判断（`route.cljc`）と描画（`view.cljc`）は純 `.cljc` なので nbb だけで回る。

```bash
CP="src:test:$K/jp-go-digital-design-system/src:$K/html/src:$K/css/src"
cat > /tmp/run.cljs <<'EOF'
(require '[cljs.test :refer [run-tests]] 'air-cargo.route-test)
(run-tests 'air-cargo.route-test)
EOF
npx --yes nbb --classpath "$CP" /tmp/run.cljs
```

実際の出力:

```
Testing air-cargo.route-test

Ran 7 tests containing 49 assertions.
0 failures, 0 errors.
```

**このワークステーションの west checkout は `deps.edn` の pin より古い**
（DDS が `0a02180` / 2026-08-12、pin は `2e2d191` / 2026-08-17）。テスト対象の
ソースと bundle に入るソースが別のライブラリになるので、**pin した sha の抽出でも
同じテストを走らせた** —— 結果は同一（7 tests / 49 assertions / 0 failures）:

```bash
git clone https://github.com/kotoba-lang/jp-go-digital-design-system /tmp/dds-pin
git -C /tmp/dds-pin checkout 2e2d191e9e1731ce6865c79dab163a5d74249053
git clone https://github.com/kotoba-lang/html /tmp/kl-html
git -C /tmp/kl-html checkout aa57f2730c87b7c2752151ed1a5f2e402c2ac71e   # DDS の deps.edn の pin
git clone https://github.com/kotoba-lang/css  /tmp/kl-css
git -C /tmp/kl-css  checkout 6eda5ee28ec177b9e09fdbee92c55a050b18cf7d   # 同上
npx --yes nbb --classpath "src:test:/tmp/dds-pin/src:/tmp/kl-html/src:/tmp/kl-css/src" /tmp/run.cljs
```

### テストが判別することを確かめる（落ちない検査は劇場）

```bash
cp src/air_cargo/route.cljc /tmp/route.bak
# M1 — 多段パス /xrpc/a/b を 400 にする（＝移行の衣を着た方針変更）
perl -0pi -e 's/\(when \(seq rest.\) rest.\)\)\)\)/(when (and (seq rest\x27) (not (clojure.string\/includes? rest\x27 "\/"))) rest\x27))))/' src/air_cargo/route.cljc
npx --yes nbb --classpath "$CP" /tmp/run.cljs     # → 1 failures （FAIL in (dispatch-xrpc)）
cp /tmp/route.bak src/air_cargo/route.cljc

cp src/air_cargo/view.cljc /tmp/view.bak
# M2 — ページが route 表を無視して固定値を描く（ADR-0001 が記録した欠陥そのもの）
perl -0pi -e 's/:rows \(route-rows routes\)/:rows (route-rows [{:route\/path "\/" :route\/method :get :route\/doc "焼いた値"}])/' src/air_cargo/view.cljc
npx --yes nbb --classpath "$CP" /tmp/run.cljs     # → 4 failures
                                                  #   FAIL in (page-shows-the-real-data) ×2
                                                  #   FAIL in (page-shows-what-it-is-given-not-a-baked-table) ×2
cp /tmp/view.bak src/air_cargo/view.cljc
npx --yes nbb --classpath "$CP" /tmp/run.cljs     # → 0 failures
```

**外した mutation も記録しておく。** 「ページが env の値を出す」ように view を
壊しても **テストは緑のままだった**。これは検査の欠陥ではない —— view は
`:vars` として **キーしか受け取らない**（値は `worker.cljs` の
`(sort (keys e))` で落ちる）ので、値の露出は構造的に view の外にある。
この主張を持っているのは §4.5 の smoke であって、このテストではない。
**緑だった mutation を実演として数えない。**

## §3 ページを描画して採点する

```bash
CP="src:/tmp/dds-pin/src:/tmp/kl-html/src:/tmp/kl-css/src"
cat > /tmp/render.cljs <<'EOF'
(require '["node:fs" :as fs] '[air-cargo.view :as view] '[air-cargo.route :as route])
(let [css (.readFileSync fs (str (.-DDS js/process.env) "/resources/jp_go_dds/dds.css") "utf8")]
  (.writeFileSync fs "/tmp/ac-page.html"
    (view/render {:css css :routes route/routes
                  :methods (route/capability-nsids ["createCargoBooking" "issueAirWaybill" "acceptCargo"])
                  :vars [:AGENTGATEWAY_MCP_ROUTER_URL :APP_CAPABILITIES :APP_DESCRIPTION
                         :APP_DISPLAY_NAME :APP_FRAMEWORK :APP_NANOID :APP_PERFORMER_TYPE :APP_UI_TYPE]
                  :mcp-url (route/mcp-router-url {})
                  :actor route/actor-did}))
  (println "ok"))
EOF
DDS=/tmp/dds-pin npx --yes nbb --classpath "$CP" /tmp/render.cljs

cd $K/design-quality && npx --yes nbb -m design-quality.cli score /tmp/ac-page.html --min 95
```

実際の出力（末尾）:

```
  100.00  /tmp/ac-page.html
aggregate: 100.00
gate: aggregate 100.00 >= min 95.00 -> PASS
```

exit 0。

### この 100.00 が証明していないこと（実測）

**三つとも、この walk で実際に測った。**

```bash
# (a) design system の CSS を一切渡さずに同じページを描く
#     → 96.63 で --min 95 を通る。採点は design system の有無を見ていない
# (b) app CSS を raw hex (#6b7280) と 11px に書き換える
#     → 100.00 のまま。CLI は contrast と input-zoom の 2 軸を採点対象に入れていない
#     （kotoba-lang/design-quality の audit.cljc: 両者は extra-axes）
# (c) クラス名 dads-table を探すのも証明にならない
#     → CSS が 1 バイトも無いページにも 9 回現れる（view が出す markup だから）
```

だから「design system が在る」は採点ではなく **§4.5 の smoke** が持つ。smoke は
`class="dads-table"`（component を使っている、両方のページで 2 回）と
`--color-primitive-blue`（**dds.css の中だけに在る**、CSS 有り 45 回 / CSS 無し
**0 回**）を **別々に**見る。

### 採点が落ちることも確かめた

```bash
# 高重みの 2 軸を壊す: safe-area (w=0.13) と viewport (w=0.10)
python3 - <<'EOF'
s=open('/tmp/ac-page.html',encoding='utf-8').read()
s=s.replace('safe-area-inset','SAFEAREAREMOVED')
s=s.replace('<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">','')
open('/tmp/ac-page-broken.html','w',encoding='utf-8').write(s)
EOF
cd $K/design-quality && npx --yes nbb -m design-quality.cli score /tmp/ac-page-broken.html --min 95
```

```
  74.16  /tmp/ac-page-broken.html
         - viewport (w=0.1): no <meta name=viewport> — the page won't fit device width
         - safe-area (w=0.13): no env(safe-area-inset-*) — content can sit under the notch / home indicator
gate: aggregate 74.16 < min 95.00 -> FAIL
```

exit **1**（PASS のときは 0）。

## §4 bundle をビルドする

**高負荷ビルドは同時 1 本に制限されている**（superproject `CLAUDE.md` の
resource governor）。直接叩かず、必ず guard 経由で:

```bash
cd "$REPO"
node ~/github/com-junkawasaki/scripts/resource-guard.mjs run build -- \
  npx --yes shadow-cljs release worker
```

lock を他セッションが持っていると **exit 2 で拒否される。これはエラーではなく
順番待ちである** —— 迂回しない。実際この walk では **20 分以上**待った（同じ
移行を並列でやっている別セッションが同じ lock を取り合っていた —— lock の
`owner.json` を覗いて確認できた cwd は少なくとも 3 つ、`app-air-crew` /
`air-book` / `app-air-dcs`）ので、リトライループから回すこと。**exit 2 を
失敗として扱わない。**

実際の出力（末尾）:

```
$ node ~/github/com-junkawasaki/scripts/resource-guard.mjs run build -- \
    npx --yes shadow-cljs release worker
...
[:worker] Compiling ...
[:worker] Build completed. (55 files, 12 compiled, 0 warnings, 16.60s)

$ ls -l dist/worker.js
-rw-r--r--  1 junkawasaki  wheel  254613  8 18 20:32 dist/worker.js
```

### ビルドが緑であることは検査ではない

shadow は未宣言 / 改名された var を **warning** として扱い、`release` は exit 0 の
まま**初回リクエストで throw する bundle** を書き出す。だから
`shadow-cljs.edn` の `:compiler-options` に `:warnings-as-errors true` を入れて
ある。**`:build-options` ではない** —— shadow が読むのは
`[:compiler-options :warnings-as-errors]` で、`:build-options` に置くと黙って
無視される。それはこの option が防ごうとしている失敗そのもの（落ちようのない
修正）である。

両方向を実際に見た:

```
$ # B1: worker.cljs が未宣言の var route/dispatchh を呼ぶ。:warnings-as-errors は ON
$ npx --yes shadow-cljs release worker
rc=1                       ← ビルドが落ちる
   cljs.analyzer/analyze (analyzer.cljc:4364)
   ...
   149 |     (case action
   150 |       :page   (page-response env)

$ # B2: 同じ壊れたソース。:warnings-as-errors を :build-options へ移すだけ
$ grep -c 'warnings-as-errors true' shadow-cljs.edn
1                          ← 文字列はファイルに在る
$ npx --yes shadow-cljs release worker
rc=0                       ← ビルドが通る。壊れた bundle が書き出される
```

検証器はこのファイルを **EDN として読んで key の path を検査する**。grep では
`shadow-cljs.edn` の中のこの説明コメント自身に一致してしまうからである。
`:build-options` へ移す mutation を当てると（**文字列は依然ファイルに在る**、
`grep -c 'warnings-as-errors true'` → 1）:

```
FAIL	warnings-are-errors	expected=true	actual=false
FAIL	warnings-as-errors-not-misplaced	expected=nil	actual=true
FAILED	2 claim(s): warnings-are-errors, warnings-as-errors-not-misplaced
```

## §4.5 ビルドした成果物を実際に叩く

ここが deploy されるものに触る唯一の検査である。

```bash
cd "$REPO" && npx --yes nbb scripts/smoke-worker.cljs dist/worker.js
```

実際の出力:

```
PASS	default export has fetch	expected=true	actual=true
PASS	GET / status	expected=200	actual=200
PASS	GET / is html	expected=true	actual=true
PASS	page advertises /health	expected=true	actual=true
PASS	page advertises /xrpc/:nsid	expected=true	actual=true
PASS	page advertises createCargoBooking	expected=true	actual=true
PASS	page advertises issueAirWaybill	expected=true	actual=true
PASS	page advertises acceptCargo	expected=true	actual=true
PASS	page shows the KEY of the sentinel var	expected=true	actual=true
PASS	page hides the VALUE of that same var	expected=false	actual=false
PASS	page enumerates env keys it was handed	expected=true	actual=true
PASS	page uses the DADS table component	expected=true	actual=true
PASS	the DADS stylesheet is inlined in the bundle	expected=true	actual=true
PASS	page is cacheable	expected="public, max-age=60"	actual="public, max-age=60"
PASS	GET /health status	expected=200	actual=200
PASS	health names its routes	expected=true	actual=true
PASS	health names its methods	expected=true	actual=true
PASS	health names the actor	expected=true	actual=true
PASS	health does not leak var values	expected=false	actual=false
PASS	POST /xrpc/ status	expected=400	actual=400
PASS	POST /xrpc/ reason	expected=true	actual=true
PASS	multi-segment: same status as single-segment	expected=502	actual=502
PASS	multi-segment: not rejected as a bad request	expected=false	actual=false
PASS	single-segment reports the router unreachable	expected=true	actual=true
PASS	multi-segment reports the router unreachable	expected=true	actual=true
PASS	the unreachable URL is the one env configured	expected=true	actual=true
PASS	OPTIONS preflight	expected=204	actual=204
PASS	OPTIONS advertises methods	expected="POST,OPTIONS"	actual="POST,OPTIONS"
PASS	unknown path	expected=404	actual=404
PASS	/_app/meta was not carried over	expected=404	actual=404
PASS	wrong method on /health	expected=405	actual=405
PASS	wrong method on /xrpc	expected=405	actual=405
PASS	405 names the allowed methods	expected="POST, OPTIONS"	actual="POST, OPTIONS"
CHECKED	33
OK	the built bundle answers as the route table says

(node の MODULE_TYPELESS_PACKAGE_JSON 警告は上から除いた。dist/ は .gitignore
 されており package.json を置かないので出る。判定には関係しない。)
```

**bundle が無ければ exit 2**（「判定できなかった」であって合格ではない）:

```
UNDETERMINED	no bundle at /private/tmp/app-air-cargo-cljs/dist/worker.js
Refusing to report a pass: build it first (see docs/operator-quickstart.md S4).
```

### smoke が判別することを確かめた

```
$ # B3: worker がページに env の VALUE を渡す（(keys e) → (vals e)）
$ npx --yes shadow-cljs release worker      # rc=0 — 漏洩はコンパイルエラーではない
$ npx --yes nbb scripts/smoke-worker.cljs dist/worker.js
FAIL	page shows the KEY of the sentinel var	expected=true	actual=false
FAIL	page hides the VALUE of that same var	expected=false	actual=true
FAIL	page enumerates env keys it was handed	expected=true	actual=false
CHECKED	33
FAILED	3 check(s): page shows the KEY of the sentinel var, page hides the VALUE of that same var, page enumerates env keys it was handed
smoke rc=1

$ # 復元して再ビルド
$ npx --yes shadow-cljs release worker      # rc=0
$ npx --yes nbb scripts/smoke-worker.cljs dist/worker.js
CHECKED	33
OK	the built bundle answers as the route table says
smoke rc=0
```

### smoke が持っている二つの主張（どちらも一つでは足りない）

- **値の露出**: `APP_UI_TYPE` の **VALUE**（番兵 `SENTINEL-VALUE-9f3a2c`）が
  ページに出ていないこと **と**、その **KEY** が出ていることを、**同じ var に
  対して**見る。番兵を別の var に置くと「ページがその var をそもそも描いて
  いない」という理由で通りうる。三つ目の番兵 `SENTINEL_KEY_7b1e`（wrangler に
  無いキー）が、キーを焼かずに env を列挙していることを示す。
- **多段パス**: 中継先を **`.invalid`**（RFC 2606 が予約、決して解決しない）に
  向け、`/xrpc/a/b` と `/xrpc/com.etzhayyim.apps.airCargo.issueAirWaybill` の
  **結果が一致すること**を見る。生の 502 を期待値として焼かないのも、
  `mcp.etzhayyim.com` が今日 NXDOMAIN であることに寄りかからないためでもある。

## §5 Workers ランタイム（workerd）で動かす

Node で import する smoke より強い検査。実際の workerd で起こす。

```bash
cd "$REPO"
npx --yes wrangler@latest dev --local --port 8799 --ip 127.0.0.1
# 別シェルで
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' http://127.0.0.1:8799/
curl -s http://127.0.0.1:8799/health
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:8799/xrpc/
curl -s -o /dev/null -w '%{http_code}\n' -X OPTIONS http://127.0.0.1:8799/xrpc/x
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8799/nope
```

実際の出力:

```
$ curl -s -o /dev/null -w '%{http_code} %{content_type}\n' http://127.0.0.1:8799/
200 text/html; charset=utf-8

$ curl -s http://127.0.0.1:8799/health
{"ok":true,"app":"air-cargo","runtime":"cljs","actor":"did:web:air-cargo.etzhayyim.com",
 "nanoid":"a1rcarg0","routes":["/","/health","/xrpc/:nsid"],
 "methods":["com.etzhayyim.apps.airCargo.createCargoBooking",
            "com.etzhayyim.apps.airCargo.issueAirWaybill",
            "com.etzhayyim.apps.airCargo.acceptCargo"]}

$ curl -s -o /dev/null -w '%{http_code}\n' -X POST    http://127.0.0.1:8799/xrpc/     # 400
$ curl -s -o /dev/null -w '%{http_code}\n' -X OPTIONS http://127.0.0.1:8799/xrpc/x    # 204
$ curl -s -o /dev/null -w '%{http_code}\n'            http://127.0.0.1:8799/nope      # 404
$ curl -s -o /dev/null -w '%{http_code}\n' -X POST    http://127.0.0.1:8799/health    # 405

# DADS の CSS は bundle の中に在る（--color-primitive-blue を含む行が 45）
$ curl -s http://127.0.0.1:8799/ | grep -c -- '--color-primitive-blue'
45

# 中継は単一セグメントでも多段でも同じ形で 502（実 DNS 上 mcp.etzhayyim.com は NXDOMAIN）
$ curl -s -X POST http://127.0.0.1:8799/xrpc/com.etzhayyim.apps.airCargo.issueAirWaybill
502 {"error":"MCP router unreachable","detail":"internal error; reference = ...","url":"https://mcp.etz…
$ curl -s -X POST http://127.0.0.1:8799/xrpc/a/b
502 {"error":"MCP router unreachable","detail":"internal error; reference = ...","url":"https://mcp.etz…
```

`compatibility_flags`（`nodejs_compat` / `nodejs_als`）は SvelteKit の
adapter-cloudflare 由来で、この bundle には要らない。**撤去は憶測ではなく
この実測で確かめてから行った。**

## §6 `kotoba/` — 撤去しなかった TypeScript

`kotoba/` は **appview ではない**。AT record の plaintext / E2E 分割を持つドメイン
ライブラリで、appview はこれを import していない。この移行は appview の
TypeScript / Svelte を撤去したが、**ここは撤去していない** —— 「bundle に無い」は
「死んでいる」ではないからである。三つ測って確かめた。

### (a) deploy される bundle に入っていない

```bash
cd "$REPO"
for s in registerShipment assignUld encryptedWrite airCargo.shipment AIR_CARGO_DID_PREFIX; do
  printf '  %-26s %s\n' "$s" "$(grep -c -F "$s" dist/worker.js)"
done
# CONTROL — 非 0 でなければ上の 0 は何も証明しない
for s in "com.etzhayyim.apps.airCargo." "MCP router unreachable" "dads-table"; do
  printf '  %-26s %s\n' "$s" "$(grep -c -F "$s" dist/worker.js)"
done
```

```
  registerShipment           0
  assignUld                  0
  encryptedWrite             0
  airCargo.shipment          0
  AIR_CARGO_DID_PREFIX       0
  com.etzhayyim.apps.airCargo. 1     ← CONTROL
  MCP router unreachable     1       ← CONTROL
  dads-table                 4       ← CONTROL
```

### (b) 依存は解決する

**`gh api` は両方の pin に 404 を返す。それを不在の証拠にしない** —— 前版の監査が
同じ 404 で一度誤り、「API が無いと言ったら、実際にそれを serve するプロトコルで
確かめる」と書き残している。git で確かめる:

```bash
git clone https://github.com/etzhayyim/com-etzhayyim-sdk.git      /tmp/sdk
git clone https://github.com/etzhayyim/com-etzhayyim-sdk-mock.git /tmp/sdkmock
git -C /tmp/sdk     cat-file -t 12314a0cc5ac2feb49dd9789d5c002398acb6988
git -C /tmp/sdk     merge-base --is-ancestor 12314a0cc5ac2feb49dd9789d5c002398acb6988 origin/HEAD && echo yes
git -C /tmp/sdkmock cat-file -t c857ff9be5310bf433bfe1e8d3c0f677e213d667
git -C /tmp/sdkmock merge-base --is-ancestor c857ff9be5310bf433bfe1e8d3c0f677e213d667 origin/HEAD && echo yes
```

```
commit / yes    (sdk      12314a0c  Fri Jul 17 2026  "fix: build SDK when installed from git")
commit / yes    (sdk-mock c857ff9b  Fri Jul 17 2026  "chore: establish independent mock library")
```

### (c) テストは通る — 7/7

`cd kotoba && npm install` は **このマシンでは落ちる**（npm 11.16.0 が
`EALLOWSCRIPTS` で git 依存の `prepare: tsc` を拒否する）。SDK 本体は要らない
——`registry.ts` は `import type` で取り込んでおり実行前に消える——ので、
mock を pin した sha で当て、依存の**配線だけ**を差し替える:

```bash
git clone https://github.com/etzhayyim/com-etzhayyim-sdk-mock.git /tmp/sdkmock
git -C /tmp/sdkmock checkout c857ff9be5310bf433bfe1e8d3c0f677e213d667

rm -rf /tmp/aircargo-testrun && cp -R "$REPO/kotoba/." /tmp/aircargo-testrun
cd /tmp/aircargo-testrun && rm -rf node_modules package-lock.json
node -e 'const fs=require("fs"),p=JSON.parse(fs.readFileSync("package.json","utf8"));
delete p.dependencies; p.devDependencies={typescript:"^5.6.0",vitest:"^4.1.0"};
fs.writeFileSync("package.json",JSON.stringify(p,null,2))'
npm install --no-audit --no-fund
mkdir -p node_modules/@etzhayyim && ln -sfn /tmp/sdkmock node_modules/@etzhayyim/sdk-mock
npx vitest run
```

実際の出力:

```
 RUN  v4.1.10 /private/tmp/aircargo-testrun

 Test Files  1 passed (1)
      Tests  7 passed (7)
   Duration  652ms
```

**scratch copy で走らせる**のは、`kotoba/` の 7 ファイルが sha256 で pin されて
いるからである（下記）。checkout の中で `npm install` すると tree が汚れ、
検証器の `kept-files-unchanged` が正しく赤くなる。

### この集合は黙って動かせない

検証器が `kotoba/` を **7 ファイル / 32,149 バイト / 各ファイルの sha256** で
pin している。三方向とも実際に落として確認した:

```
K1  kotoba/ に .ts を足す      → kept-files / every-added-file-is-registered / tracked-files
K2  既存ファイルを編集する      → kept-bytes / kept-files-unchanged
K3  ファイルを 1 つ消す         → kept-files / kept-bytes / kept-files-unchanged / tracked-files
```

appview の TypeScript が「ライブラリのファイル」の顔をして戻ってくる経路も、
これで塞がっている。**cljs へ移すのは別の決定**で、`@etzhayyim/sdk` の cljs face
が先に要る。

## §7 deploy

```bash
cd "$REPO" && npx wrangler deploy
```

**この walk では実行していない**（§7）。route が指すホストは解決しない
（`air-cargo.etzhayyim.com` / `a1rcarg0.etzhayyim.com` とも NXDOMAIN）ので、
deploy が成功しても誰も到達できない。`/xrpc/` の中継先 `mcp.etzhayyim.com` も
同様なので、到達できたとしても中継は **502 を返す**（成功と同じ形で隠さない）。

superproject の deploy guard は `origin/main` を含む checkout からの deploy しか
許さない点も併せて注意。

### DNS を自分で確かめる

```bash
for r in 1.1.1.1 8.8.8.8 9.9.9.9; do
  for h in air-cargo.etzhayyim.com a1rcarg0.etzhayyim.com \
           dispatcher.etzhayyim.com mcp.etzhayyim.com; do
    s=$(dig @$r +noall +comments "$h" A | grep -o 'status: [A-Z]*' | head -1)
    printf '%-10s %-32s %s\n' "$r" "$h" "$s"
  done
done
```

12 とも `status: NXDOMAIN`（2026-08-18 実測）。zone 自体は健全であることも見る:

```bash
dig +short etzhayyim.com NS      # → everton/vivienne.ns.cloudflare.com
dig +short etzhayyim.com A       # → 172.67.179.128, 104.21.51.111
```

つまり 4 つの label が無いのであって、ドメインが死んでいるのではない。

## §8 NOT WALKED

これらは実行していない。**どれも pass として報告していない。**

- **`wrangler deploy`。** route が指すホストが zone に存在せず、それを作るのは
  「このアプリが存在すべきか」という owner の決定である（README の末尾）。
  移行はその決定を先取りしない。
- **live な request。** 4 ホストとも NXDOMAIN なので、deploy された実体が無く、
  「動くはず」と「動かないはず」を観測で区別する手段が無い。
- **`kotoba/` の 3 つの mutation。** 前版の §4 が walk して記録している（FK
  チェックの除去 / `isDecimalString` を素通しに / `isUint` に負数を許す）。
  この walk では **7/7 が通ることだけ**を再実行し、mutation は再現していない
  —— **前版の結果を自分の測定として引用しない**ので、あの 3 行は「前版が測った」
  と読むこと。
- **`kotoba/` の `npm run typecheck`。** 実 `@etzhayyim/sdk` の型宣言が要り、それは
  その `prepare: tsc` ビルドが要り、それが `EALLOWSCRIPTS` で塞がっている（§6c）。
  §6c の scratch tree に `tsc --noEmit` を当てると `TS2307: Cannot find module
  '@etzhayyim/sdk'` が出るが、**それは私の差し替えがモジュールを欠いているので
  あって、この repo の欠陥ではない。** 欠陥として引用しないこと。
- **JVM 側のテストランナー**（`clojure -X:test`）。テストは nbb で走らせた。
  `deps.edn` に `:test` alias は用意してあるが、この walk では踏んでいない。
