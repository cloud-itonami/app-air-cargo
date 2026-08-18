# app-air-cargo

**航空貨物（air cargo）のオペレーションを扱う appview の公開面。** 予約・AWB
発行・貨物受託・ULD 割当・追跡・求償・精算・保安報告 —— 業務そのものは MCP
router の先（AgentGateway / pod 側 LangServer）にあり、**ここには無い**。この
repo が持つのは薄い edge であって、実装ではない。

`etzhayyim/root` の `60-apps/etzhayyim-project-air-cargo` からの抽出物で、
**2026-08-18 に TypeScript/Svelte から ClojureScript へ移行した**（ADR-0001）。
数字はすべて `scripts/verify-docs-claims.cljs` が tree から再計算して検査する。

## deploy されるものは、いま読んでいるソースである

```
src/air_cargo/route.cljc    判断（どの handler が答えるか）  ← 純 .cljc、テスト対象
src/air_cargo/view.cljc     ページ（jp-go-dds の hiccup）    ← 純 .cljc、テスト対象
src/air_cargo/worker.cljs   Request/Response に触る唯一の層
        ↓ shadow-cljs :target :esm
dist/worker.js              ← wrangler.jsonc の "main" が指すもの
```

移行前は `main` が `svelte/.svelte-kit/cloudflare/_worker.js`（tree に存在しない
ビルド出力）を指し、読み手が最初に開く `src/app.ts` は **どの config からも
参照されていなかった**。`scripts/verify-docs-claims.cljs` が
**shadow の出力先と wrangler の `main` と export の ns 名の 3 つが噛み合って
いること**を検査し、噛み合わなくなれば落ちる。

判断を `.cljc` に置いてあるのは、ブラウザもビルドも無しにテストするためであり、
ingress capability が qualify した時に **最初に `.kotoba` へ移る部分**だからで
ある（入口を当面 cljs に置くのは ADR-2606290000 の判断）。

## 公開ルート

| METHOD | PATH | 何をするか |
|---|---|---|
| GET | `/` | この appview の説明ページ |
| GET | `/health` | 生存確認。deploy された面が答えることを外から確かめられる |
| POST | `/xrpc/:nsid` | XRPC を MCP router へ中継する |
| OPTIONS | `/xrpc/*` | CORS preflight |

**この表の出所は `air-cargo.route/routes` で、ページもそこから描く。** 移行前の
ページは `routeCount: 0` / `routes: []` / `vars: []` を literal で持っており、
隣の `wrangler.jsonc` が route 2・var 8・capability 3 を宣言していることに
気づけなかった。いまは route 表も capability も env のキーも渡す側が持ち、
ページは描くだけなので、両者がずれる余地が無い。

`/xrpc/a/b` のような多段パスは **400 にしない**。deploy されていた SvelteKit の
route は rest parameter `[...path]` で受けており、`a/b` をそのまま tool 名として
転送していた。空だけが 400（`Missing XRPC method`、文言も当時のまま）。ここを
1 セグメントに絞るのは移行ではなく方針変更なので、この commit には入れていない。

## いま在るもの — 25 ファイル

| 面 | ファイル |
|---|---|
| 判断・描画・edge | `src/air_cargo/{route.cljc, view.cljc, worker.cljs}` |
| テスト | `test/air_cargo/route_test.cljc`（7 tests / 49 assertions） |
| ビルド | `deps.edn` / `shadow-cljs.edn` / `.gitignore` |
| Worker 設定 | `wrangler.jsonc` |
| actor 記述子 | `kotodama.jsonld` |
| 検証 | `scripts/{smoke-worker.cljs, verify-docs-claims.cljs}` |
| ドメインライブラリ（appview ではない） | `kotoba/`（7 ファイル・TypeScript。下記） |
| 由来・権利・識別 | `NOTICE` / `README.edn` / `migration.edn` / `MIGRATION-TODO.md` |
| 文書 | `README.md` / `docs/operator-quickstart.md` / `docs/adr/0001-*.edn` |

**appview の TypeScript は 0 本、正本言語（`.cljs`/`.cljc`）が 3 本。**
移行前は **3 対 0**（`src/app.ts` / `svelte/…/+server.ts` / `svelte/vite.config.ts`）
＋ `.svelte` 1 本だった。同じ範囲で数えている（`scripts/` `test/` `kotoba/` は除く）。
この数は検証器の claim なので、
appview の TS が戻れば落ちる —— 撤去した 9 パスに戻る場合
（`removed-by-migration-absent`）も、別名で入る場合（`appview-ts-files`）も、
別々の claim が捕まえる。

**`kotoba/` の 7 ファイルはこの数に入らない。** appview ではないので別に数え、
**7 ファイル / 32,149 バイト / 各ファイルの sha256** を検証器に固定してある
（下記）。

## 何を撤去したか（239 行の TypeScript / Svelte）

移行前の tree は 24 ファイル。**撤去したのは 9 ファイル・239 行 —— appview だけ**
である。

| 撤去したもの | 行 | なぜ |
|---|---|---|
| `svelte/`（7 ファイル） | 151 | deploy されていた appview。cljs へ移した |
| `src/app.ts` | 76 | 同じ appview のもう一つの実装。**どの bundle にも入っておらず**（9 シンボルすべて不在）、**どの config からも参照されていなかった** |
| `package.json`（root） | 12 | `typecheck: tsc --noEmit` を持つが root `tsconfig.json` が無く、何も検査していなかった。`kotoba/` は自前の `package.json` / `tsconfig.json` / `vitest.config.ts` を持つので影響を受けない |

撤去した 9 パスは `migration.edn` の `:identity :removed-by-migration` に名前で
登録してある。**失われていない** —— この移行の親 commit `9e80d7d` に byte 単位で
在り、`git show 9e80d7d:src/app.ts` で取り出せる。

## 何を撤去しなかったか — `kotoba/`（appview ではない）

`kotoba/src/{types,registry,index}.ts`（625 行）は AT record の plaintext / E2E
分割を持つドメインライブラリで、`kotoba/test/air-cargo.test.ts` が付いている。
**appview はこれを import していない。deploy される bundle にも入っていない。**
それでも **撤去していない** —— 「bundle に無い」ことは「死んでいる」ことでは
ないからである。2026-08-18 に測った:

| 問い | 測定 |
|---|---|
| deploy される bundle に入っているか | **いいえ。** `dist/worker.js` に対する 5 つの probe シンボル（`registerShipment` / `assignUld` / `encryptedWrite` / `airCargo.shipment` / `AIR_CARGO_DID_PREFIX`）がすべて 0 件。対照（`com.etzhayyim.apps.airCargo.` / `MCP router unreachable` / `dads-table`）は非 0 |
| 依存は解決するか | **はい。** `@etzhayyim/sdk` の `12314a0c` と `@etzhayyim/sdk-mock` の `c857ff9b` は**どちらも存在し、それぞれの既定ブランチの祖先**（git で直接確認。`gh api` は両方に 404 を返すが、それは API 経路の話で、`git ls-remote` と `merge-base --is-ancestor` は通る） |
| テストは通るか | **はい。7 tests / 7 passed**（2026-08-18 に実行。手順は `docs/operator-quickstart.md` §6） |

つまり **appview の移行が置き換える対象ではなく、死んでもいない。** ここを消すのは
移行ではなく破壊である。

**代わりに固定した。** 検証器が `kotoba/` を **7 ファイル / 32,149 バイト /
各ファイルの sha256** で pin しているので、この集合は黙って増えも減りも変わりも
しない —— appview の TypeScript が「ライブラリのファイル」の顔をして戻ってくる
経路も、これで塞がっている。

**cljs へ移すかどうかは別の決定であり、この移行はそれを先取りしていない。**
移すには `@etzhayyim/sdk` の cljs face が先に要る。

### 持ち越さなかった経路（黙って消していない）

- **`src/app.ts` の dispatcher 経路**（8 メソッドを `dispatcher.etzhayyim.com` へ
  POST）。宛先が NXDOMAIN であり、使う `DISPATCHER_URL` /
  `DISPATCHER_INTERNAL_SECRET` は **`wrangler.jsonc` に binding が無い**。
- **`/_app/meta`**（`src/app.ts` の `/health` の別名）。`/health` を持ち越したので
  別名は落とした。テストと smoke が 404 であることを固定している。
- **`/health` の `bpmn` フィールド**（`etzhayyim-root/00-contracts/bpmn/…` を
  指していた。その path は現存しない）。

## 呼び先が 1 つも解決しない（移行では直らない）

2026-08-18 実測、1.1.1.1 / 8.8.8.8 / 9.9.9.9 の 3 リゾルバすべてで:

| ホスト | 役割 | DNS |
|---|---|---|
| `air-cargo.etzhayyim.com` | 公開ホスト（wrangler の route） | **NXDOMAIN** |
| `a1rcarg0.etzhayyim.com` | 同（nanoid 側） | **NXDOMAIN** |
| `mcp.etzhayyim.com` | `/xrpc/:nsid` の中継先 | **NXDOMAIN** |
| `dispatcher.etzhayyim.com` | 撤去した `src/app.ts` の中継先 | **NXDOMAIN** |

zone 自体は健全（`etzhayyim.com` は Cloudflare NS で apex が 200）なので、
これは 4 つの label が無いのであってドメインが死んでいるのではない。
`did:web:air-cargo.etzhayyim.com` も同じ理由で解決しない。

deploy 先も中継先も、いま存在しない。`/xrpc/` は到達できなければ **502 を返す**
——成功と同じ形で隠さない。**移行はこれを直さない。**

## 宣言と実装は今も一致していない（移行では直らない）

`kotodama.jsonld` と `wrangler.jsonc` が宣言する capability は 3 つ
（`createCargoBooking` / `issueAirWaybill` / `acceptCargo`）。**appview に
その実装は無い** ——実装は MCP router の先にある、という構成だからである。
`kotoba/` が持つのは `registerShipment` 等の別語彙で、宣言された 3 つのうち
`issueAirWaybill` 1 つだけが対応する。ページはこの 3 つを「宣言」として描き、
**許可リストとしては描かない**（中継は prefix を検査しない）。**移行はこの
不一致を直さない**（直すのは語彙を揃える別の決定である）。

## UI

基盤は `kotoba-lang/jp-go-digital-design-system`（デジタル庁デザインシステム）。
色・寸法は `--hig-*` トークン契約だけで書き、raw hex も px フォントサイズも
置かない。app 固有 CSS は 3 行。CSS は外部リクエストゼロの方針どおり
`shadow.resource/inline` で bundle に焼く。

決定論的 audit（`kotoba-lang/design-quality`）で **100.00 / 100（gate 95）**。

**ただし、この点数は design system が在ることを証明しない。** 2026-08-18 に実測:

- 同じページを **CSS を一切渡さずに**描いても **96.63** で `--min 95` を通る
- app CSS を raw hex + `11px` に書き換えても **100.00** のまま
  （CLI は `contrast` と `input-zoom` の 2 軸を採点対象に入れていない）
- クラス名 `dads-table` を探すのも証明にならない —— それは view が出す markup の
  中にあり、**CSS が 1 バイトも無いページにも 9 回現れる**

だから「design system が在る」は採点ではなく **smoke が持つ**。
`scripts/smoke-worker.cljs` は `class="dads-table"`（component を使っている）と
`--color-primitive-blue`（**dds.css の中だけに在るトークン**、CSS 抜きページでの
出現回数 0）を別々に見る。採点が落ちることも確かめてある（safe-area と viewport
を壊すと 74.16 で FAIL、exit 1）。

## 検証

```bash
nbb scripts/verify-docs-claims.cljs .          # <dir> は先頭に置く
```

exit 0 = 全一致 / 1 = 食い違い / **2 = 判定できなかった**（0 と区別する）。
31 の claim を評価し、**20 未満しか評価できなかった場合は exit 2** で終わる
（沈黙を緑として数えないため）。テスト・ビルド・smoke は
`docs/operator-quickstart.md`。

## 残っている欠陥（移行では直っていない）

1. **4 ホストとも NXDOMAIN。** deploy するか retire するかは owner の決定。
2. **宣言された 3 capability のうち 2 つ（`createCargoBooking` / `acceptCargo`）は
   実装がこの repo のどこにも無い**。残る `issueAirWaybill` は `kotoba/` に在るが、
   appview からは到達しない（上記）。
3. **`MIGRATION-TODO.md` のチェックボックス 7 件が未チェック**のまま。憲章適合の
   手動レビューは未実施であると文書自身が書いている。このファイルは upstream から
   byte 単位で変えていない。
4. **`kotoba/` は TypeScript のまま**（意図的。上記）。cljs へ移すには
   `@etzhayyim/sdk` の cljs face が要る。
