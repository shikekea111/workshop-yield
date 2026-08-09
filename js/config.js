// 配置文件 —— 部署时只需改这里
// 在 Supabase 控制台 → Project Settings → API 获取下面两项
window.APP_CONFIG = {
  // 'supabase' 或 'cloudbase'（cloudbase 为国内备选，第二阶段再接）
  BACKEND: 'supabase',

  // ===== Supabase =====
  SUPABASE_URL: 'https://xburtlkxsrrezsuisyfk.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhidXJ0bGt4c3JyZXpzdWlzeWZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxODY3ODgsImV4cCI6MjEwMTc2Mjc4OH0.uKmoNZHPa_vb1SdGdUAoXXRVmmfkh1Bp1ZVpmwm5Tu0',

  // 站点名称（登录页展示）
  APP_NAME: '车间产量上报',

  // 员工批量录入时，工号自动拼接的邮箱域名（账号 = 工号@EMAIL_DOMAIN）
  // 如工号 1001 → 登录账号 1001@factory.local
  EMAIL_DOMAIN: 'factory.local'
};
