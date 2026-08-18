#!/usr/bin/env nbb
;; smoke-worker — 実際にビルドされた bundle を import して叩く。
;;
;; ここが「deploy される成果物」に触る唯一の検査である。テスト
;; (test/air_cargo/route_test.cljc) はソースの判断を固定するが、bundle が本当に
;; Worker の形で答えるかは言えない —— export の形、shadow の
;; :advanced-optimization、`shadow.resource/inline` で焼いた CSS、そして
;; `APP_CAPABILITIES` の JSON decode（worker.cljs 側にしか無い）は、どれも
;; ビルドを通って初めて存在する。
;;
;; Usage:  nbb scripts/smoke-worker.cljs [<dist/worker.js>]
;; Exit:   0 全て期待どおり · 1 期待と違う · 2 判定できなかった（bundle が無い等）

(require '["node:fs" :as fs] '["node:path" :as path] '["node:url" :as url]
         '[clojure.string :as str])

(def bundle
  "ESM の import は相対パスを package 名と読むので、必ず絶対パスに直してから
  file:// URL にする（`dist/worker.js` をそのまま渡すと『Cannot find package
  dist』になる。実測）。"
  (let [a (first (remove #(str/starts-with? % "--") *command-line-args*))]
    (.resolve path (or a "dist/worker.js"))))

(def failures (atom []))
(def checks (atom 0))
(defn check! [label expected actual]
  (swap! checks inc)
  (let [ok (= expected actual)]
    (println (str (if ok "PASS" "FAIL") "\t" label "\texpected=" (pr-str expected) "\tactual=" (pr-str actual)))
    (when-not ok (swap! failures conj label))))

(when-not (.existsSync fs bundle)
  (println (str "UNDETERMINED\tno bundle at " bundle))
  (println "Refusing to report a pass: build it first (see docs/operator-quickstart.md S4).")
  (js/process.exit 2))

;; ── 二つの独立した番兵 ───────────────────────────────────────────────
;;
;; 値の露出検査は **一つでは足りない**。「値を出していない」だけを見る検査は
;; 「何も出していない」ページで通り、「キーが出ている」だけを見る検査は
;; 「全部出している」ページで通る。両方を、**同じ var** に対して当てる:
;;
;;   hidden-sentinel  APP_UI_TYPE の VALUE。ページに出てはならない
;;   APP_UI_TYPE      その KEY。ページに出なければならない
;;
;; 同じ var に当てるのが要点である。別の var に番兵を置くと、ページがその var を
;; そもそも描いていないという理由で「合格」しうる（app-ongakuka の移行で実測した
;; 失敗の形）。
;;
;; 実在しそうな値（"yoro" 等）を番兵にしない: 他の文言と偶然一致しうるうえ、
;; 引用符ごと探すと renderer が " を &quot; に escape するので**決して一致しない**
;; —— つまり検査が構造的に落ちなくなる。
(def hidden-sentinel "SENTINEL-VALUE-9f3a2c")

;; env のキーは焼かずに読んでいる、を示すための三つ目の番兵。wrangler.jsonc に
;; 無いキーなので、これがページに出るなら env を実際に列挙している。
(def shown-key-sentinel "SENTINEL_KEY_7b1e")

(def capabilities
  "wrangler.jsonc の APP_CAPABILITIES **そのままの文字列**。ここを config から
  離して書き写すと、decode の検査ではなく写経の検査になる。"
  "[\"createCargoBooking\",\"issueAirWaybill\",\"acceptCargo\"]")

(def router
  "`.invalid` は RFC 2606 が予約した TLD で、**決して解決しない**。中継先をここに
  向けるのは、多段パスの検査を実 DNS に寄りかからせないためである ——
  mcp.etzhayyim.com が今日 NXDOMAIN であることを検査の前提にすると、その名前が
  将来生えた日に検査の意味が黙って変わる。"
  "https://router-does-not-exist.invalid/xrpc/com.etzhayyim.mcp.message")

(def env #js {"APP_NANOID" "a1rcarg0"
              "APP_UI_TYPE" hidden-sentinel
              "APP_CAPABILITIES" capabilities
              "AGENTGATEWAY_MCP_ROUTER_URL" router
              "SENTINEL_KEY_7b1e" "unused"})

(defn- call [h method path]
  (let [req (js/Request. (str "https://air-cargo.etzhayyim.com" path) #js {:method method})]
    (-> (js/Promise.resolve ((.-fetch h) req env #js {}))
        (.then (fn [res] (-> (.text res)
                             (.then (fn [body] {:status (.-status res)
                                                :ct (.get (.-headers res) "content-type")
                                                :allow (.get (.-headers res) "allow")
                                                :cache (.get (.-headers res) "cache-control")
                                                :cors (.get (.-headers res) "access-control-allow-methods")
                                                :body body}))))))))

(-> (js/import (.-href (.pathToFileURL url bundle)))
    (.then
     (fn [m]
       (let [h (.-default m)]
         (check! "default export has fetch" true (fn? (.-fetch h)))
         (-> (js/Promise.all
              #js [(call h "GET" "/") (call h "GET" "/health")
                   (call h "POST" "/xrpc/") (call h "OPTIONS" "/xrpc/x")
                   (call h "GET" "/nope") (call h "POST" "/health")
                   (call h "GET" "/xrpc/x")
                   (call h "POST" "/xrpc/com.etzhayyim.apps.airCargo.issueAirWaybill")
                   (call h "POST" "/xrpc/a/b")
                   (call h "GET" "/_app/meta")])
             (.then
              (fn [[page health bad pre nf mna wrong-xrpc single multi meta]]
                (check! "GET / status" 200 (:status page))
                (check! "GET / is html" true (str/includes? (or (:ct page) "") "text/html"))
                ;; ページは route 表から描かれる。表にある path が全部出ていること。
                (doseq [p ["/health" "/xrpc/:nsid"]]
                  (check! (str "page advertises " p) true (str/includes? (:body page) p)))
                ;; APP_CAPABILITIES を decode して 3 本すべてを完全修飾で出す。
                ;; 移行前のページは routeCount:0 / routes:[] / vars:[] を焼いて
                ;; いて、隣の config が宣言する 3 つを一つも出せなかった。
                (doseq [c ["createCargoBooking" "issueAirWaybill" "acceptCargo"]]
                  (check! (str "page advertises " c) true
                          (str/includes? (:body page) (str "com.etzhayyim.apps.airCargo." c))))

                ;; ── 値の露出: 二つの番兵を同じ var に当てる ──
                (check! "page shows the KEY of the sentinel var" true
                        (str/includes? (:body page) "APP_UI_TYPE"))
                (check! "page hides the VALUE of that same var" false
                        (str/includes? (:body page) hidden-sentinel))
                ;; env を実際に列挙している（キーを焼いていない）
                (check! "page enumerates env keys it was handed" true
                        (str/includes? (:body page) shown-key-sentinel))

                ;; ── design system が bundle に焼かれている ──
                ;; **採点ではこれは言えない** —— design-quality の CLI は design
                ;; system の有無を見ておらず、CSS を一切渡さずに描いた同じページが
                ;; 96.63 で --min 95 を通る（2026-08-18 実測、
                ;; docs/operator-quickstart.md S3）。
                ;;
                ;; そして **クラス名を探すだけでも言えない**。`dads-table` は
                ;; view が出す markup の中にあるので、CSS が 1 バイトも入って
                ;; いないページにも 9 回現れる（同じく実測）。参照実装の smoke は
                ;; ここをクラス名だけで見ており、その検査は CSS について何も
                ;; 言えていなかった。二つに分ける:
                (check! "page uses the DADS table component" true
                        (str/includes? (:body page) "class=\"dads-table\""))
                ;; `--color-primitive-blue` は dds.css の中だけに在るトークン。
                ;; CSS 抜きのページでの出現回数は 0（実測）。
                (check! "the DADS stylesheet is inlined in the bundle" true
                        (str/includes? (:body page) "--color-primitive-blue"))
                (check! "page is cacheable" "public, max-age=60" (:cache page))

                (check! "GET /health status" 200 (:status health))
                (check! "health names its routes" true (str/includes? (:body health) "/xrpc/:nsid"))
                (check! "health names its methods" true
                        (str/includes? (:body health) "com.etzhayyim.apps.airCargo.issueAirWaybill"))
                (check! "health names the actor" true
                        (str/includes? (:body health) "did:web:air-cargo.etzhayyim.com"))
                (check! "health does not leak var values" false
                        (str/includes? (:body health) hidden-sentinel))

                ;; nsid 無しの XRPC は 400。文言は SvelteKit 版のまま。
                (check! "POST /xrpc/ status" 400 (:status bad))
                (check! "POST /xrpc/ reason" true (str/includes? (:body bad) "Missing XRPC method"))

                ;; ── 多段パス: 単一セグメントと **同一に** 扱う ──
                ;; deploy されていた SvelteKit の route は rest parameter [...path]
                ;; で受けており、/xrpc/a/b をそのまま tool 名として転送していた。
                ;; 絞るのは移行ではなく方針変更なので、ここでは「単一セグメントの
                ;; 呼び出しと結果が一致すること」を検査する —— 生の 502 を期待値
                ;; として焼くのではなく、対照と比べる。中継先は .invalid なので
                ;; この比較は実 DNS に依存しない。
                (check! "multi-segment: same status as single-segment"
                        (:status single) (:status multi))
                (check! "multi-segment: not rejected as a bad request" false (= 400 (:status multi)))
                (check! "single-segment reports the router unreachable" true
                        (str/includes? (:body single) "MCP router unreachable"))
                (check! "multi-segment reports the router unreachable" true
                        (str/includes? (:body multi) "MCP router unreachable"))
                (check! "the unreachable URL is the one env configured" true
                        (str/includes? (:body multi) "router-does-not-exist.invalid"))

                (check! "OPTIONS preflight" 204 (:status pre))
                (check! "OPTIONS advertises methods" "POST,OPTIONS" (:cors pre))
                (check! "unknown path" 404 (:status nf))
                ;; 撤去した src/app.ts の別名。持ち越していないので 404。
                (check! "/_app/meta was not carried over" 404 (:status meta))
                (check! "wrong method on /health" 405 (:status mna))
                (check! "wrong method on /xrpc" 405 (:status wrong-xrpc))
                (check! "405 names the allowed methods" "POST, OPTIONS" (:allow wrong-xrpc))

                ;; 実行本数の床。上の doseq が空 seq を回しても「0 件で合格」に
                ;; ならないようにする。
                (println (str "CHECKED\t" @checks))
                (when (< @checks 30)
                  (println (str "UNDETERMINED\tonly " @checks " checks ran; expected at least 30"))
                  (js/process.exit 2))

                (let [f @failures]
                  (if (seq f)
                    (do (println (str "FAILED\t" (count f) " check(s): " (str/join ", " f)))
                        (js/process.exit 1))
                    (do (println "OK\tthe built bundle answers as the route table says")
                        (js/process.exit 0))))))))))
    (.catch (fn [e]
              (println (str "UNDETERMINED\tcould not exercise the bundle: " (.-message e)))
              (js/process.exit 2))))
