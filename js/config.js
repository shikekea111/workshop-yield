// 配置文件 —— 部署时只需改这里
window.APP_CONFIG = {
  // 'supabase'（境外，当前回滚生效中）或 'cloudbase'（国内腾讯云开发 · 因体验版认证用户配额=3 暂不可用）
  // 2026-10-29 切回 supabase：CloudBase 体验版认证用户配额仅约 3 个，撑不住 477 名工人账号
  BACKEND: 'supabase',

  // ===== Supabase（旧环境，回滚用，勿删） =====
  SUPABASE_URL: 'https://xburtlkxsrrezsuisyfk.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhidXJ0bGt4c3JyZXpzdWlzeWZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxODY3ODgsImV4cCI6MjEwMTc2Mjc4OH0.uKmoNZHPa_vb1SdGdUAoXXRVmmfkh1Bp1ZVpmwm5Tu0',

  // ===== CloudBase（腾讯云开发 · 国内） =====
  // 环境 ID / 地域（环境详情页获取）
  CLOUDBASE_ENV: 'workshop-yield-d3gstiur173833671',
  CLOUDBASE_REGION: 'ap-shanghai',
  // Publishable Key（前端只读凭证，等同 Supabase anon；在控制台 / MCP manageAppAuth 获取）
  CLOUDBASE_PUBLISHABLE_KEY: 'eyJhbGciOiJSUzI1NiIsImtpZCI6ImMxZGY2ZmY3LWJiM2YtNDM2Yy05MjNjLWZjMmI5YWI1ODk1MiJ9.eyJpc3MiOiJodHRwczovL3dvcmtzaG9wLXlpZWxkLWQzZ3N0aXVyMTczODMzNjcxLmFwLXNoYW5naGFpLnRjYi1hcGkudGVuY2VudGNsb3VkYXBpLmNvbSIsInN1YiI6ImFub24iLCJhdWQiOiJ3b3Jrc2hvcC15aWVsZC1kM2dzdGl1cjE3MzgzMzY3MSIsImV4cCI6NDA5Njk2MDE0NSwiaWF0IjoxNzkzMjc2OTQ1LCJub25jZSI6Im5NMm9DcFZnVFd5YUZZdVpiSmtKcmciLCJhdF9oYXNoIjoibk0yb0NwVmdUV3lhRll1WmJKa0pyZyIsIm5hbWUiOiJBbm9ueW1vdXMiLCJzY29wZSI6ImFub255bW91cyIsInByb2plY3RfaWQiOiJ3b3Jrc2hvcC15aWVsZC1kM2dzdGl1cjE3MzgzMzY3MSIsIm1ldGEiOnsicGxhdGZvcm0iOiJQdWJsaXNoYWJsZUtleSJ9LCJyb2xlIjoiYW5vbiIsImlzX2Fub255bW91cyI6dHJ1ZSwiYXBwX21ldGFkYXRhIjp7InByb3ZpZGVyIjoiYW5vbnltb3VzIiwicHJvdmlkZXJzIjpbImFub255bW91cyJdfSwidXNlcl9tZXRhZGF0YSI6eyJuYW1lIjoiQW5vbnltb3VzIn0sInVzZXJfdHlwZSI6IiIsImNsaWVudF90eXBlIjoiY2xpZW50X3VzZXIiLCJpc19zeXN0ZW1fYWRtaW4iOmZhbHNlfQ.O61Plg8UiDpSneenPurmK270Xpy12UtwD4CURHv_VSKSHDiQUvHcq4_qlqow0UiE-jEu7zoTYijdaZWcoipHLsvLSeijxaj-dOBnFBEBy0lrEbLhAPb_egKZGpRqE-QSmWKanXY0AHZTA_OcmU-WxazcYtkvDEMq7Lbo3wSoEUeqpXTteosrNA4fLcGeUu7Dyut4x3L7BUkmxe8YckT_3R_j5MjEprPTi-n62rBxc8B1OOpeDWt3-TUOCJ9qPYBUd7z5prtvODpMOXKqTiDpnBJcjg1JT56Pt9DyuNLHAOqZIiq6v2C-X_wK-m0l6REv3mUgQW_JFf6jQmdHJ-FBgg',

  // 站点名称（登录页展示）
  APP_NAME: '车间产量上报',

  // 员工账号 = 工号 @ EMAIL_DOMAIN（CloudBase 用 username=工号 登录，@域名仅作展示/报表拆分）
  // 如工号 1001 → 登录用户名 1001，档案 email 存 1001@factory.local
  EMAIL_DOMAIN: 'factory.local'
};
