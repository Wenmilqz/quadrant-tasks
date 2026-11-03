// CloudBase 配置模板。复制本文件为 config.js 并填入你自己的值：
//   cp src/config.example.js src/config.js
//
// 填了环境 ID 和 Publishable Key 就走云端同步（PostgreSQL 模式），
// 留空则用浏览器本地存储（仅本机，数据不出浏览器）。
//
// Publishable Key 在 CloudBase 控制台获取：环境管理 → API Key 配置 → 生成。
// 它是客户端公开密钥，配合数据库 RLS 策略使用，仅可访问显式放行的资源，
// 可安全地写在前端代码里；但请不要把它提交到公开仓库。
export const CLOUDBASE_ENV_ID = ''
export const CLOUDBASE_PUBLISHABLE_KEY = ''
