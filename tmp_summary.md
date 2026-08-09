# 应用开发经验与用户习惯总结

> 来源：车间产量统计（workshop-yield）项目从 0 到上线全过程，及肾石康复助手项目延续的协作习惯。
> 技术栈：纯前端 PWA（无框架）+ Supabase（Postgres + Auth + RLS）+ GitHub Pages。

---

## 一、用户个人习惯（协作侧，务必遵守）

1. **非技术背景，沟通要通俗**。用户是武汉充气床工厂的 PMC，不懂代码术语。解释问题用大白话，少用"接口/缓存/时区/RLS"等词，必要时类比。界面必须大字体、大按钮、手机优先。
2. **偏好"最靠谱、100% 能成功"的方案，宁可麻烦**。原话："不要瞎折腾了，给我一个最靠谱的百分之百能成功的办法，哪怕麻烦一点都行。" 遇到反复失败，果断放弃脆弱路子，改用官方标准路径，不要在小修小补上耗时间。
3. **决策果断，给具体选项就选**。遇到需要拍板的事（初始密码策略、旧账号处理、部署方案），用带明确利弊的二选一/多选一，用户会快速回。
4. **遇到问题直接反馈（截图）**。卡点会发截图+报错文字，是很好的排错线索，要主动用。
5. **上线前亲自在手机端自测**。登录、上报、时间显示等 bug 都是用户手机自测发现的，不是我这边测出来的。交付前提醒用户"在手机上硬刷新验证"。
6. **强烈反感逐条手工录入**。100+ 产品 × 20~30 工序，手工一个个点不可接受；必须给"Excel 复制粘贴一键批量导入"能力。
7. **隐私/解耦意识强**：账号不绑真实姓名，员工名线下用 Excel 对照表维护。不要主动把"姓名"塞回应用。
8. **不要应用内反馈入口**：肾石项目已确认，反馈走外部渠道（抖音/微信），App 内不加"反馈建议"按钮。

---

## 二、Supabase 账号/Auth 经验（最痛的坑）

### 2.1 铁律：永远不要 SQL 直插 auth.users / auth.identities
- GoTrue 是黑盒。直接 `INSERT INTO auth.users` 即使补全了 `instance_id`/`aud`/`raw_app_meta_data`（`{"provider":"email","providers":["email"]}`）、把 NULL 的 token 文本列置 `''`、补 `auth.identities` 行，**仍然会登录 500**（1001/1002/1004~1500 全部 500，而 Dashboard「Add user」建的 1003 完全正常）。
- 更糟的是 SQL 直插会把 auth 表污染到 GoTrue 连"检查邮箱是否存在"都 500，必须 `cleanup_auth.sql` 清理坏数据才能恢复。
- **唯一可靠路径：官方 Auth Admin API** —— `POST /auth/v1/admin/users`（service_role 密钥）。Dashboard「Add user」按钮、我的 `create-accounts.mjs` 都是同一个后端。
- 批量建号脚本 `create-accounts.mjs`（Node + service_role）已验证：499 个账号 0 失败，全部可登录。以后扩大规模直接复用，别再碰 SQL 直插。
- 安全：service_role 是"万能钥匙"，用完后立刻删除本地密钥文件；跑完建议去 Supabase 控制台 Rotate 一次。

### 2.2 假域名账号设计
- 员工账号用 `工号@factory.local`，这是收不到邮件的假域名，意味着**无法邮件找回密码，初始密码即登录密码**。
- 登录框自动补后缀（员工只输工号），管理员用真实邮箱不受影响。
- 初始密码方案权衡：统一 `123456`（分发省事但任意人可登任意号）vs 密码=工号（每人不同更安全）。MVP 阶段用户选了统一密码，但建议员工首次登录后各自改密。

---

## 三、前端 PWA 经验

### 3.1 Service Worker 缓存陷阱（反复踩）
- 每次改前端 JS/CSS，**必须 bump `sw.js` 里的 CACHE 版本常量**，否则手机端缓存旧文件 → 出现"电脑新、手机旧"。
- CSS 比 JS 更容易被浏览器/微信顽固缓存：给 `<link>` 加版本号 `css/styles.css?v=6`，让浏览器当全新 URL 强制重下。
- SW 要配 `skipWaiting()` + `clients.claim()`，并在 `controllerchange` 弹"🎉 有新版本，立即更新"提示条，避免用户每次手动清缓存。
- 部署后务必提醒用户"手机硬刷新一次"。

### 3.2 时区陷阱（差 8 小时）
- Supabase `TIMESTAMPTZ DEFAULT NOW()` 存的是 UTC。前端直接 `slice(11,16)` 截 ISO 字符串会显示 UTC 时间，比北京时间少 8 小时。
- 修复：写 `fmtTime(iso)` 工具，手动 `getTime() + getTimezoneOffset()*60000 + 8*3600000` 转 UTC+8，**不依赖浏览器时区设置**（工人手机时区可能不准）。以后凡显示后端时间字段都用它。

### 3.3 架构约定
- 数据访问收口在 `js/db.js` 的 `Db` 接口，后端（Supabase / 腾讯云 CloudBase）切换只改这一处，页面零改动。
- 员工端 / 管理端 UI 用 `body.app-emp` 之类的 body class 限定，新增样式不会污染另一端。
- 通用 UI 组件（chip 点选、底部 sheet、toast、搜索候选列表）跨页面复用，保持一致交互。

---

## 四、数据库 / RLS 经验

### 4.1 GRANT 必须含 SELECT
- `production_records` 表最初只授 INSERT/UPDATE/DELETE，漏了 SELECT，导致员工登录后页面加载失败 + 提交失败（`.insert().select()` 的 RETURNING 也需要 SELECT 权限）。建表脚本里每张被前端查询的表都要显式 `GRANT SELECT`。

### 4.2 国内访问
- `*.supabase.co` 国内可能偏慢/不稳，先实测；不稳就切 CloudBase（只改 db.js 实现）。

---

## 五、GitHub Pages 部署经验

- **分支直接部署**（Settings → Pages → source = main 分支 / 根目录）优于 Actions 工作流：缓存的 GitHub PAT 通常缺 `workflow` 作用域，推不了 `.github/workflows/*.yml`。分支部署 `git push origin main` 即自动上线（1~2 分钟生效）。
- 仓库根放 `.nojekyll` 禁用 Jekyll，保证 `js/vendor/*.js` 等前端资源原样发布。
- 建仓库 / 开 Pages 可通过 GitHub REST API + 缓存 token（`git credential fill` 取）完成，`gh` CLI 不一定装得了。

---

## 六、批量数据录入 UX 范式（强烈推荐复用）

管理后台"批量录入"功能结构（Excel 复制粘贴一键导入）：
1. 提示文案说明列格式（如"产品编号、产品名称、工序号、工序名"），支持 TAB/逗号/中文逗号分隔。
2. "解析预览"按钮：识别行数、自动跳过含表头关键字的表头行、展示前 N 行确认。
3. 预览表（产品/账号/状态），确认无误后"开始导入"。
4. 导入用**幂等 upsert**（onConflict 业务键，如产品按 `code`、工序按 `product_id,part_no`），重跑不会重复建，改错可重导。
5. 支持上传 CSV/TSV 文件（FileReader 读文本进文本框再走同一解析）。

这范式解决了"手工逐条录入 2500 条"的痛点，是用户满意度最高的功能之一。

---

## 七、上线前 Checklist（给用户的）

1. 代码/账号就绪后，**唯一仍需用户做的事**：把真实主数据（产品/工序）用批量录入导进系统，否则员工看不到可选项。
2. 员工端自测：登录 → 选产品 → 选工序 → 填数量 → 提交 → 管理端报表可见。
3. 提醒：统一密码要员工改密；清掉测试账号/数据；service_role 密钥 Rotate。
4. 时间显示、缓存刷新、移动端一致性都要在手机上验证。
