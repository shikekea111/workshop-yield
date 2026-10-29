# 车间产量上报系统 · CloudBase 迁移交接文档

> 用途：本文档让新会话零成本接手。项目根目录：`E:/游戏别回头/雾都挑战  小狗/workshop-yield`
> 最近更新：2026-10-29（阶段一后端闭环已打通并验证，首个 admin `0001` 已建）

---

## 一、任务目标（一句话）

把「车间产量上报 PWA」后端从 **Supabase（境外新加坡，慢到不可用）** 迁到 **腾讯云 CloudBase PostgreSQL（国内，免费试用）**，保持功能：车间筛选、报表聚合、权限隔离（admin / leader / worker）。

节奏：**先迁结构 + 数据联调 → 再批量建号。**
- 阶段一（✅ 已完成）：建库结构、改造前端、部署建号云函数、静态托管、验证登录/RLS/报表链路通、建首个 admin。
- 阶段二（⏳ 待做）：批量创建工号账号（1004~1500，统一初始密码）、迁移 Supabase 历史数据、双端 E2E 验收。

---

## 二、阶段一进度（已全部完成并验证）

### ✅ 已完成
1. **CloudBase PG 建库**（`sql/cloudbase_schema.sql`）：5 表 / 13 RLS / 4 函数（is_admin/is_staff/report_summary/report_monthly_matrix）/ GRANT，已落库。
2. **Auth 配置就绪**：publishableKey 已获取并写入 `js/config.js`；username+password 登录已启用。
3. **前端三件套改造**：`config.js` 切 `BACKEND:'cloudbase'`、`db.js` 加 `makeCloudBaseDb`（同接口 27 方法）、`index.html` 引自托管 `js/vendor/cloudbase.min.js`（873KB IIFE，已 grep 确认含 callFunction/rdb/signInWithPassword 等）。
4. **`create-user` 云函数部署成功**：`@cloudbase/manager-node` 建号（`mgr.user.createUser`），已强制重部署干净版（去掉失效的 SERVICE_ROLE_KEY），bootstrap 守卫生效。
5. **静态托管上线**：42 个文件已上传，首页 `index.html` 已配置。
6. **登录 / RLS / 报表全链路验证通过**（用 admin `0001` 验过）：
   - 登录端点 `/auth/v1/signin`（工号+密码）返回 token，`sub`=UID 一致；
   - admin token 调 `report_summary` RPC 返回 200 `[]`（is_staff 守门通过）。
7. **首个 admin 已建**：账号 `0001` / 密码 `YjCb#2026ad` / 显示名 `管理员` / role=`admin` / UID `2115798912409608194`。`profiles` 行由 `ExecutePGSql`（superuser）补写。
8. **清理**：删除线上临时探针函数 `probe-api` 及本地 `probe-api/`、`probe_rest.sh`；删除测试账号 `boot9999`（auth 用户+profiles 行）。

### 关键事实
- `@cloudbase/node-sdk` 的 `app.auth()` 无 `createUser`，建号**必须**走 manager SDK，所以 `create-user` 函数依赖重包 `@cloudbase/manager-node`（不可甩）。

---

## 三、关键环境信息（不要重新查，直接用）

| 项 | 值 |
|---|---|
| CloudBase 环境 ID | `workshop-yield-d3gstiur173833671` |
| 地域 | `ap-shanghai` |
| 数据库类型 | PostgreSQL（非 NoSQL） |
| 自托管 SDK 全局名 | `cloudbase`（IIFE）。⚠️ 注意：本 bundle 把 API 挂在 `window.cloudbase.default` 上，**必须 `window.cloudbase.default.init(...)`**，顶层的 `window.cloudbase.init` 是 undefined（浏览器实测 `TypeError: window.cloudbase.init is not a function`）。 |
| EMAIL_DOMAIN | `factory.local`（仅展示，如 `0001@factory.local`） |
| BOOTSTRAP_TOKEN（首建 admin 用） | `0e02aec12f3ed3215c2e74b4b8a90ef783c40cd1b481ef4e` |
| publishableKey | 在 `js/config.js` 的 `CLOUDBASE_PUBLISHABLE_KEY`，别硬编码别处 |
| 前端静态托管地址 | `https://workshop-yield-d3gstiur173833671-<appid>.tcloudbaseapp.com/`（控制台查确切子域） |
| 首个 admin | 工号 `0001` / 密码 `YjCb#2026ad` / 显示名 `管理员` / role=`admin` / UID `2115798912409608194` |

---

## 四、已落地文件清单（工作区 `workshop-yield/` 下）

**需提交/推送（git 当前可能未提交）：**
- `index.html` — 已加 `<script src="js/vendor/cloudbase.min.js">`
- `js/config.js` — `BACKEND:'cloudbase'` + CloudBase 配置块（保留旧 SUPABASE 作回滚）
- `js/db.js` — `makeCloudBaseDb(app)`，27 方法；`signIn` 用工号作 username；`getProfile` 用 `.limit(1)`；`createWorker` 走 `app.callFunction({name:'create-user'})`
- `js/vendor/cloudbase.min.js` — 873KB 自托管 IIFE
- `sql/cloudbase_schema.sql` — 建表脚本（已落库）
- `cloudbase/functions/create-user/index.js` + `package.json` — 建号云函数（依赖已修正为 `@cloudbase/manager-node`）

**旧环境（保留作回滚，暂不动）**：Supabase 项目仍在，数据未删。**但旧 Supabase `service_role` 密钥已泄露（见第六节安全事件），需轮换后再作回滚源。**

---

## 五、CloudBase PG 与 Supabase 的关键差异（踩坑点，别再踩）

1. `auth.users.id` 是 bigint 自增 → 业务表用户 ID 用 `varchar(64)`，不 REFERENCES auth.users。
2. `auth.uid()` 返回 text → RLS 里 `id = auth.uid()` 仍成立。
3. 身份映射：`session.user.id` = 真实 UID 字符串；`profiles.id` 存此 UID。
4. 角色：Publishable Key→anon；登录 token→authenticated；API Key→service_role（绝不下发前端）。
5. 账号模型：**工号作 username** 登录；`EMAIL_DOMAIN` 仅展示/报表拆分。
6. 建号：前端无建号；node-sdk 仅读；**必须用 `@cloudbase/manager-node` 的 `user.createUser({name,password,type:'internalUser',nickName,email})`**。

---

## 六、本次新踩的坑（已解决，别再踩）

1. **`create-user` 包名**：`package.json` 必须 `@cloudbase/manager-node`（非 `@cloudbase/manager-node-sdk`，后者 npm 404）。
2. **`node-sdk` 云函数端无 PG 接口**：`@cloudbase/node-sdk` v2 只有 `app.database()`（NoSQL），**没有 `app.rdb()`**；浏览器端 `@cloudbase/js-sdk` 才有 `rdb()`。
3. **`manager-node` v5 初始化**：`require('@cloudbase/manager-node').init({envId})` 直接 init，**无 `CloudBase` 命名导出**。
4. **`profiles` 表 RLS 无 INSERT 策略**：只有 `service_role` 能插。→ 建号函数只建 auth 用户返回 UID，`profiles` 行由 `ExecutePGSql`（superuser）补写。
5. **`manageAppAuth` 生成的 api_key 是"登录用"**，数据网关 REST 拒（401），不能用于写库。
6. **登录端点用 `/auth/v1/signin`**（username+password），不是 `/auth/v1/token?grant_type=password`（报 invalid grant type）。
7. **`ExecutePGSql` 参数名是 `Sql`（首字母大写）**，不是 `SQL`；需带 `EnvId`。
8. **架构定案**：阶段二批量建号 = 云函数建 auth 用户 + `ExecutePGSql` 写 `profiles`（role 由脚本指定，覆盖函数默认的 worker）。

### ⚠️ 前端空白页 Bug（2026-10-29 实测发现并修复，极易复发）
9. **`db.js` 里 `app.auth` 必须带括号调用**：CloudBase js-sdk 中 auth 是**方法** `app.auth()`（调用后才返回 auth 实例），不是属性。原代码 `var auth = app.auth;` 会把 `auth` 赋成函数本身，后续 `auth.getSession()` 报「不是函数」→ `init()` 同步抛错 → 整页只渲染静态头+底栏、主区空白（无报错提示，极难肉眼定位）。
   - **修复**：`var auth = (typeof app.auth === 'function') ? app.auth() : app.auth;`
   - `app.rdb()` 那行本来就是带括号的方法调用，是对的。
   - **复发点**：任何改动 `db.js` 的 CloudBase 初始化逻辑后，务必确认 `app.auth()` / `app.rdb()` 都带括号；前端空白页优先怀疑此处。
   - 当时表现：用户打开前端只看到蓝色标题「车间产量上报」+ 底部导航栏，中间空白 → 正是此 bug。

10. **`window.cloudbase.init` 不是函数（.default 命名空间）**：当前托管的那份 `js/vendor/cloudbase.min.js`（@cloudbase/js-sdk IIFE 构建）全局对象 `window.cloudbase` 只有一个 `default` 属性，**`init` / `rdb` / `auth` 全部挂在 `window.cloudbase.default` 之下**（顶层 `window.cloudbase.init` 为 undefined）。
   - **现象**：`window.cloudbase.init(...)` 直接抛 `TypeError: window.cloudbase.init is not a function`，`db.js` 初始化中断 → 整页空白。
   - **修复**：`var cbNs = (window.cloudbase.default) ? window.cloudbase.default : window.cloudbase; var tcbApp = cbNs.init({...});`（兼容两种形态）。
   - **复发点**：若将来换 SDK 版本/构建方式，先 `console.log(Object.keys(window.cloudbase))` 确认入口形态再写 `init` 调用。Node 复现时因走了 CommonJS 的 `.default` 分支而"看似正常"，但浏览器经典 `<script>` 加载走的就是顶层 `window.cloudbase`，所以**一定要在浏览器态验证初始化**。
11. **两个页面都必须引 `cloudbase.min.js`**：`index.html` 与 `admin.html` 都需在 `db.js` 之前加载 `js/vendor/cloudbase.min.js`，否则该页 `window.cloudbase` 为 undefined → db.js init 抛「window.cloudbase 未定义」→ 登录框虽能渲染但功能全废。本次 admin.html 一度漏引，已补回（写在 supabase.min.js 之后、config.js 之前）。**新增/改动 HTML 时务必核对 SDK 引用齐全**。

---

## 七、⚠️ 安全事件（待张总处理）

迁移中旧 Supabase 的 `service_role` 密钥（`sb_secret_...`）曾被误传到 CloudBase 静态托管 CDN（文件已删），但**密钥已在公网暴露过**。需张总去 Supabase 控制台**轮换（rotate）该 key**。旧 Supabase 本就只作回滚对照，轮换不影响新 CloudBase 库。

---

## 八、下一步行动清单

### 阶段一双端验收（⏳ 当前待张总做）
- **张总用手机+电脑各打开前端地址登录 `0001` / `YjCb#2026ad`**，验证：登录成功 → 看自己记录 / 管理员看全部（RLS）→ 报表函数数值正确（当前无数据应显示空）。
- 改完提醒硬刷新（CDN 缓存）。

### 阶段二（⛔ 已启动但被套餐配额阻塞，见第十节）

**已完成的准备（可直接复用）**：
- 花名册已解析：`E:\游戏别回头\雾都挑战  小狗\employee_roster.csv`（747 人，列 = 工号,姓名,部门）。
  - ⚠️ **重要更正**：真实工号是 **6 位**（100002~308389），**不**在 1004~1500 区间。旧文档里「1004~1500」作废。
  - 筛选口径按「部门名称」而非工号段（工号前 3 位 ≠ 部门，如 `304` 实为 201车间）。
- 建号范围（张总已定）：**仅 7 个车间** = 201/203/204/102/301/101/103，共 **477 人**。
- 密码规则（张总已定）：`工号 + "Ab"`（如 `306338Ab`）——因为 CloudBase 强制密码 **≥8 位且 ≥3 类字符**，纯 6 位工号过不了。
- 试件已验证通过：工号 `306338`（万晓晓，102车间）建号 + 写 profiles + `signin` 登录全通（UID `2115817565938851842`）。
- 工具已就绪：`create-user` 已改造为支持 `users[]` 批量模式（返回精简 `{工号,uid}`）；另建了 `batch-create-users`（自托管拉取清单，但 SCF 冷启动超时，暂未用）。

**剩余步骤**：
1. ⛔ **先解除配额阻塞**（见第十节）→ 再批量建剩余 476 人（试件 306338 已建）。
2. Supabase 导出 `products/parts/production_records/daily_plans` → CloudBase 导入（`production_records.worker_id` 关联 UID）。
3. 双端（电脑+手机）E2E 验收。

### 收尾
- `git add` 指定文件 → `git -c credential.helper= -c credential.helper=wincred push origin main`（PAT）。
- 沉淀经验入 IMA 知识库并同步个人偏好。

---

## 九、⛔ 当前硬阻塞：认证用户数配额（需张总操作，代码无法绕过）

**现象**：批量建号时 `mgr.user.createUser` 返回
`[CreateUser] 超过配额限制。授权用户数超过套餐配额上限`

**根因**：本环境套餐是 **`baas_trial`（体验版）**。实测 `auth.users` 只有 **3 个**时就触发上限——即体验版的认证用户数配额 ≈ 3，撑不住 477 个工人账号。这是**套餐限制，不是代码问题**，任何代码改动都绕不过。

**当前 `auth.users` 实况（3/3 已满）**：
| UID | email | name | 说明 |
|---|---|---|---|
| `2115776136683216896` | (null) | administrator | 环境创建时系统自动生成，占 1 个配额 |
| `2115798912409608194` | 0001@factory.local | 管理员 | 正式 admin |
| `2115817565938851842` | 306338@factory.local | 万晓晓 | 试件（102车间） |

**套餐对照（CloudBase 官网定价）**：
| 套餐 | 价格 | 资源点/月 |
|---|---|---|
| 免费体验版（当前） | ¥0 | 3,000（**用户数配额 ≈3**）|
| 个人版 | ¥19.9/月（首购特惠 ¥4.9） | 40,000 |
| 标准版 | ¥199/月 | 330,000 |

**解除路径（张总去控制台做）**：
控制台 → 选中环境 `workshop-yield` → 「套餐用量」→ 「立即升级」→ 个人版（首购 ¥4.9，次月 ¥19.9）。
⚠️ 官方说明：**升级到个人版后不支持降配回体验版**。升级完成后告诉我，我立刻继续批量建剩余 476 人。

**备选方案（若不想付费）**：
- **A. 改产品形态**：工人不单独登录，只给班组长/统计员建少量账号（≤3 个），上报时下拉选择「工人姓名」。最省配额，也更贴合车间实际（工人未必人人有智能手机/愿注册）。需改前端上报逻辑 + `production_records` 增加「报工人」字段。
- **B. 回退 Supabase**：Supabase 免费版不限制 auth 用户总数（限 MAU 50k），`config.js` 里 `BACKEND` 切回 supabase 即可（旧实现仍在）。但旧 `service_role` 密钥已泄露需先轮换。
- **C. 只建试点**：先建 2~3 个真实工号做试点运行，等确认系统好用再决定升级。

---

## 十、协作偏好（张总，必读）

- 结论先行（能不能/差什么/选哪个）→ 展开；分步确认，先给 A/B/C 选项拍板再动手，不擅自扩展未选方向。
- 真实使用场景优先："同事也要能操作，不只我"，设计考虑多人协作与非技术用户。
- 移动端实测（手机+电脑各看一遍），改完提醒硬刷新；界面细节用截图反馈。
- 方案压一页内，偏好可工作示例；每阶段结束沉淀经验入 IMA。
- 接受已知取舍但风险提前说清；区分"你来做"还是"教我做"。
- 署名「张鱼小丸子」；个人网站站点名「折腾花园」。
