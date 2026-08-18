#!/usr/bin/env nbb
;; verify-docs-claims — re-derive every number README.md and docs/operator-quickstart.md
;; state, from the tree itself, and fail when the tree and the prose disagree.
;;
;; Before the cljs migration this file's load-bearing claim would have been a GAP:
;; the Worker that would be deployed was svelte/.svelte-kit/cloudflare/_worker.js --
;; a build output absent from the tree -- while src/app.ts, the file that reads like
;; the application, was referenced by no config at all. That gap is closed, and the
;; claims are written so it cannot quietly come back: the TypeScript and the Svelte
;; are asserted ABSENT BY NAME, not merely absent from a byte total.
;;
;; Usage:  nbb scripts/verify-docs-claims.cljs [<dir>]     (<dir> FIRST, default ".")
;; Exit:   0 every claim holds · 1 a claim is false · 2 could not answer

(require '["node:fs" :as fs]
         '["node:child_process" :as cp]
         '["node:crypto" :as crypto]
         '[cljs.reader :as edn]
         '[clojure.string :as str])

(def root (or (first (remove #(str/starts-with? % "--") *command-line-args*)) "."))

(def claims
  {:tracked-files 25
   :inherited-bytes 3970           ; the 4 inherited files still carried unchanged
   :appview-ts-files 0             ; TypeScript OUTSIDE kotoba/ -- see kept below
   :appview-svelte-files 0
   :production-canonical-files 3
   :kept-files 7                   ; kotoba/, kept deliberately and pinned
   :kept-bytes 32149
   :declared-vars 8
   :declared-routes 2
   :declared-capabilities 3
   :wrangler-main "dist/worker.js"
   :shadow-output-dir "dist"
   :shadow-export 'air-cargo.worker/handler
   :upstream-tracked-files 20
   :removed-by-migration-count 9})

;; ── kotoba/ : upstream TypeScript that is NOT the appview ──────────────────
;;
;; The migration removed the appview's TypeScript and Svelte. It did NOT remove
;; this. `kotoba/` is a domain library the appview never imported; it is in no
;; bundle, but it is not dead by the test that governs this migration -- its
;; pinned dependencies resolve and its seven tests pass (docs/operator-quickstart.md
;; S6). Deleting it would have been destruction rather than migration.
;;
;; It is pinned here BY HASH, not merely counted, so it can neither grow silently
;; (new TypeScript smuggled in under a directory the appview claims not to own)
;; nor rot silently (edited without anyone deciding to).
(def kept
  {"kotoba/package.json" "87c4de8ac42a77996c6575fef8afe61ad400071019c36b0915c3b04105dbf7de"
   "kotoba/src/index.ts" "027d8f5cf3b8f9b8981dc38932896661d67b4561881f639e87d9ecd40bb35369"
   "kotoba/src/registry.ts" "5ffea832eefd8a9db55bc4a001956ae8bc973a1e2260a7095e45325c708bafc4"
   "kotoba/src/types.ts" "c7fc237f3a4a4edd5997b1ec6c09b3d7124eb5239f6cccef41b73fd6f6f0981c"
   "kotoba/test/air-cargo.test.ts" "890d5d6bf89d9ef043e2eb3060f16ee16eb2af4eb25fdf8415b1a259ffd52862"
   "kotoba/tsconfig.json" "95a429e51d6162cb7205b603f745e7604d93ffbb1ea6c346e5c6215a79ae541e"
   "kotoba/vitest.config.ts" "f82a551ef4da1c9cbf17985a3bee96eee450a3e4a46bff0d96c6150263121eff"})

;; Inherited files this repository still carries BYTE-IDENTICAL. wrangler.jsonc and
;; migration.edn left this set deliberately in the migration and are checked by
;; CONTENT below instead -- so that an intentional change and a careless one stay
;; distinguishable.
(def preserved
  {"MIGRATION-TODO.md" "f86c8b079497fbf3dd696e15671415807eb28e1f7f509d5b0ac2a6dd326a75f7"
   "NOTICE" "9d3bd5678f857c647a465987cd8538580215416648991fd9de47e6dc648544f0"
   "README.edn" "347110ef5bcb9480ab7168a44ef3c7f69842274b06c4bf782f28ca3f047a0eab"
   "kotodama.jsonld" "4605d9334374c81e7f6a682952c24753ac65b02e9540075695914a51d0586f95"})

(def undetermined (atom []))
(def failures (atom []))
(def checks (atom 0))
(defn undet! [m] (swap! undetermined conj m))

(defn tracked-files []
  (try (->> (.execSync cp "git ls-files" #js {:cwd root :encoding "utf8"})
            str/split-lines (remove str/blank?) vec)
       (catch :default e (undet! (str "git ls-files failed: " (.-message e))) nil)))
(defn slurp* [rel] (try (.readFileSync fs (str root "/" rel) "utf8") (catch :default _ nil)))
(defn bytes-of [rel] (try (.-size (.statSync fs (str root "/" rel))) (catch :default _ nil)))
(defn sha256 [rel]
  (try (-> (.createHash crypto "sha256") (.update (.readFileSync fs (str root "/" rel))) (.digest "hex"))
       (catch :default _ nil)))
(defn strip-jsonc [s] (str/replace s #"(?m)^\s*//.*$" ""))
(defn read-edn [rel]
  (try (edn/read-string (slurp* rel))
       (catch :default e (undet! (str rel " is not readable EDN: " (.-message e))) nil)))

(defn check! [label expected actual]
  (swap! checks inc)
  (let [ok (= expected actual)]
    (println (str (if ok "PASS" "FAIL") "\t" (name label)
                  "\texpected=" (pr-str expected) "\tactual=" (pr-str actual)))
    (when-not ok (swap! failures conj label))
    ok))

(let [files (tracked-files)
      mig (read-edn "migration.edn")]
  (when (nil? files) (println "UNDETERMINED\tcould not list tracked files") (js/process.exit 2))
  (println (str "SCANNED\t" (count files)))
  (when (zero? (count files)) (println "UNDETERMINED\tscanned 0 files") (js/process.exit 2))

  (let [sizes (into {} (map (juxt identity bytes-of)) files)]
    (when-let [bad (seq (keep (fn [[f s]] (when (nil? s) f)) sizes))]
      (undet! (str "tracked but unreadable: " (str/join ", " bad))))

    (check! :tracked-files (:tracked-files claims) (count files))
    (check! :inherited-bytes (:inherited-bytes claims)
            (reduce + 0 (keep #(get sizes %) (keys preserved))))
    (check! :preserved-files-unchanged []
            (vec (keep (fn [[f want]] (let [got (sha256 f)]
                                        (when-not (= want got) (str f " " (or got "MISSING")))))
                       preserved)))

    ;; ── provenance: migration.edn stays the register of what this tree is ──
    ;; The extraction declared 20 upstream files; the migration removed 16 of them
    ;; and added 10. Both lists live in migration.edn so the walk in
    ;; docs/operator-quickstart.md S1 can tell "removed on purpose" from "missing",
    ;; and so an added file that nobody registered shows up as drift.
    (if (nil? mig)
      (undet! "migration.edn unreadable")
      (let [adds (set (get-in mig [:identity :allowed-additions]))
            removed (get-in mig [:identity :removed-by-migration])]
        (check! :migration-declares-upstream-count (:upstream-tracked-files claims)
                (get-in mig [:source :tracked-files]))
        (check! :removed-by-migration-count (:removed-by-migration-count claims)
                (count removed))
        ;; the TypeScript and the Svelte are gone, BY NAME, from the register
        (check! :removed-by-migration-absent []
                (vec (filter #(some? (bytes-of %)) removed)))
        ;; nothing is in the tree that provenance does not account for
        (check! :every-added-file-is-registered []
                (vec (remove #(or (contains? adds %)
                                  ;; the 4 surviving upstream files
                                  (contains? preserved %)
                                  (contains? kept %)
                                  (= % "wrangler.jsonc"))
                             files)))
        ;; the kept set is what migration.edn says it is
        (check! :migration-declares-kept-paths (vec (sort (keys kept)))
                (vec (sort (get-in mig [:identity :kept-not-the-appview :paths]))))))

    ;; ── the kept TypeScript is exactly the kept TypeScript ──
    ;; Pinned three ways: which files, how many bytes, and each file's hash. A new
    ;; .ts under kotoba/ fails the count; an edit to an existing one fails the hash.
    (check! :kept-files (:kept-files claims)
            (count (filter #(str/starts-with? % "kotoba/") files)))
    (check! :kept-bytes (:kept-bytes claims)
            (reduce + 0 (keep #(bytes-of %) (keys kept))))
    (check! :kept-files-unchanged []
            (vec (keep (fn [[f want]] (let [got (sha256 f)]
                                        (when-not (= want got) (str f " " (or got "MISSING")))))
                       kept)))

    ;; Language of the APPVIEW's source. kotoba/ is excluded by name -- it is not the
    ;; appview, it is pinned above, and folding it in here would turn a claim about
    ;; "the thing that gets deployed" into a claim about "the repository", which is
    ;; how the appview's TypeScript could come back disguised as a library file.
    (let [appview (remove #(or (str/starts-with? % "scripts/")
                               (str/starts-with? % "test/")
                               (str/includes? % "/test/")
                               (str/starts-with? % "kotoba/"))
                          files)]
      (check! :appview-ts-files (:appview-ts-files claims)
              (count (filter #(str/ends-with? % ".ts") appview)))
      (check! :appview-svelte-files (:appview-svelte-files claims)
              (count (filter #(str/ends-with? % ".svelte") appview)))
      (check! :production-canonical-files (:production-canonical-files claims)
              (count (filter #(re-find #"\.(cljs|cljc|clj|kotoba)$" %) appview))))

    ;; ── the deployed bundle is built from the source in this tree ──
    (let [w (some-> (slurp* "wrangler.jsonc") strip-jsonc)
          sh (read-edn "shadow-cljs.edn")]
      (if (or (nil? w) (nil? sh))
        (undet! "wrangler.jsonc or shadow-cljs.edn unreadable")
        (let [j (js->clj (.parse js/JSON w) :keywordize-keys false)
              build (get-in sh [:builds :worker])]
          (check! :wrangler-main (:wrangler-main claims) (get j "main"))
          (check! :declared-vars (:declared-vars claims) (count (get j "vars")))
          (check! :declared-routes (:declared-routes claims) (count (get j "routes")))
          (check! :declared-capabilities (:declared-capabilities claims)
                  (count (js->clj (.parse js/JSON (get-in j ["vars" "APP_CAPABILITIES"] "[]")))))
          (check! :app-framework-is-not-sveltekit "cljs-esm-worker"
                  (get-in j ["vars" "APP_FRAMEWORK"]))
          ;; the old config served a SvelteKit client dir that no longer exists,
          ;; and matched **/*.wasm in a tree with zero .wasm files
          (check! :no-stale-assets-binding true (nil? (get j "assets")))
          (check! :no-stale-wasm-rules true (nil? (get j "rules")))
          (check! :no-wasm-in-tree 0 (count (filter #(str/ends-with? % ".wasm") files)))
          ;; nodejs_compat / nodejs_als were adapter-cloudflare's requirement.
          ;; They are gone, and the claim below is what makes that removal
          ;; falsifiable: the bundle must not reach for a node builtin.
          (check! :no-node-compat-flags true (nil? (get j "compatibility_flags")))
          (check! :shadow-output-dir (:shadow-output-dir claims) (:output-dir build))
          (check! :shadow-export (:shadow-export claims)
                  (get-in build [:modules :worker :exports 'default]))
          (check! :wrangler-main-is-the-shadow-output true
                  (= (get j "main") (str (:output-dir build) "/worker.js")))
          ;; ── :warnings-as-errors, asserted by KEY PATH and never by grep ──
          ;; shadow reads [:compiler-options :warnings-as-errors]. Under
          ;; :build-options it is silently ignored -- which is the same failure the
          ;; option exists to prevent, a fix that cannot fail. A grep would match
          ;; the comment in shadow-cljs.edn that explains this very hazard, so this
          ;; reads the file as EDN and looks at the path.
          (check! :warnings-are-errors true
                  (true? (get-in build [:compiler-options :warnings-as-errors])))
          (check! :warnings-as-errors-not-misplaced nil
                  (get-in build [:build-options :warnings-as-errors])))))

    ;; The page renders the route TABLE and the declared capabilities rather than
    ;; baked literals -- the defect ADR-0001 records was `routeCount: 0`,
    ;; `routes: []` and `vars: []` beside a config declaring 2 routes, 8 vars and
    ;; 3 capabilities. Asserted structurally (the view takes the data, the worker
    ;; passes the real values) and NOT by forbidding a substring: a check that a
    ;; docstring explaining the old defect can trip is a check about prose.
    (let [v (slurp* "src/air_cargo/view.cljc")
          w (slurp* "src/air_cargo/worker.cljs")]
      (if (or (nil? v) (nil? w))
        (undet! "view.cljc or worker.cljs unreadable")
        (check! :page-renders-the-data true
                (and (str/includes? v "[{:keys [routes methods vars mcp-url actor built-at]}]")
                     (str/includes? v "(route-rows routes)")
                     (str/includes? w ":routes route/routes")
                     (str/includes? w ":methods (decode-capabilities")))))

    ;; The prose does not ship with an unfilled hole. docs/operator-quickstart.md
    ;; is written before the slow build lands and its outputs are pasted in
    ;; afterwards; a forgotten marker would read as measured output. This claim
    ;; is what makes forgetting fail rather than pass silently.
    (check! :no-unfilled-placeholders []
            (vec (keep (fn [f]
                         (when-let [c (slurp* f)]
                           (when (str/includes? c "PLACEHOLDER") f)))
                       ["README.md" "docs/operator-quickstart.md"
                        "docs/adr/0001-migrate-the-appview-from-typescript-to-clojurescript.edn"])))

    ;; Nothing OUTSIDE kotoba/ builds a node/TypeScript artifact any more. kotoba/
    ;; keeps its own package.json / tsconfig.json / vitest.config.ts -- that is how
    ;; its seven tests are run -- and those three are pinned by hash above.
    (check! :no-node-build-config-outside-kotoba []
            (vec (filter #(and (not (str/starts-with? % "kotoba/"))
                               (re-find #"(^|/)(package\.json|package-lock\.json|tsconfig\.json|vite\.config\.ts|vitest\.config\.ts|svelte\.config\.js)$" %))
                         files)))))

;; evidence floor: a run that asserted almost nothing must not read as a clean bill
(println (str "CHECKED\t" @checks))
(when (< @checks 20)
  (println (str "UNDETERMINED\tonly " @checks " claims were evaluated; expected at least 20"))
  (js/process.exit 2))

(let [u @undetermined f @failures]
  (when (seq u)
    (doseq [m u] (println (str "UNDETERMINED\t" m)))
    (println "Refusing to report a pass: the tree could not be read completely.")
    (js/process.exit 2))
  (if (seq f)
    (do (println (str "FAILED\t" (count f) " claim(s): " (str/join ", " (map name f)))) (js/process.exit 1))
    (do (println "OK\tevery claim in README.md and docs/operator-quickstart.md holds") (js/process.exit 0))))
