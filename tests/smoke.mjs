// 冒烟验证：构建产物 + 兜底逻辑。逐步打印进度，卡住能看到卡在哪。
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 5199
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

// 云数据库 REST 直连配置：放在 tests/config.mjs（已 gitignore），格式：
//   export const API = 'https://<你的环境ID>.api.tcloudbasegateway.com/v1/rdb/rest/tasks'
//   export const KEY = '<你的 Publishable Key>'
// 不配置则云端清理/恢复步骤自动跳过（本地功能测试不受影响）。
let apiCfg = null
try { apiCfg = await import('./config.mjs') } catch { /* 未配置，跳过云端收尾 */ }

const apiKey = () => apiCfg?.KEY

async function apiFetch(url, options = {}) {
  if (!apiCfg) return null
  const res = await fetch(url, { ...options, headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json', ...options.headers } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// 快照非测试任务（用户的真实任务），测试结束后恢复被滚动的日期，防止误伤
async function snapshotUserTasks() {
  try {
    return (await apiFetch(`${apiCfg.API}?select=id,planned_date&title=not.like.*冒烟*`)) || []
  } catch { return [] }
}

async function restoreUserTasks(snapshot) {
  for (const t of snapshot) {
    try {
      const rows = await apiFetch(`${apiCfg.API}?select=planned_date&id=eq.${t.id}`)
      if (rows?.[0] && rows[0].planned_date !== t.planned_date) {
        await apiFetch(`${apiCfg.API}?id=eq.${t.id}`, { method: 'PATCH', body: JSON.stringify({ planned_date: t.planned_date }) })
        log(`已恢复用户任务 ${t.id} 的计划日期为 ${t.planned_date}`)
      }
    } catch { /* 恢复失败不阻断测试 */ }
  }
}

// 测试收尾：通过 REST 直连删掉所有标题含「冒烟」的测试任务，不污染云端数据
async function cleanupSmokeTasks() {
  if (!apiCfg) { log('未配置 tests/config.mjs，跳过云端清理'); return }
  try {
    const removed = await apiFetch(`${apiCfg.API}?title=like.*冒烟*`, { method: 'DELETE' })
    log(`已清理 ${removed.length} 条冒烟测试数据`)
  } catch (e) {
    log('清理测试数据失败（不影响测试结果）：', String(e).slice(0, 120))
  }
}

log('启动 vite...')
const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: root, shell: true, stdio: 'pipe' })
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('vite 启动超时')), 30000)
  server.stdout.on('data', (d) => { if (d.toString().includes('Local:')) { clearTimeout(timer); resolve() } })
  server.stderr.on('data', (d) => process.stderr.write(d))
})
log('vite 就绪')

let browser
const userSnapshot = await snapshotUserTasks()
if (userSnapshot.length) log(`已快照 ${userSnapshot.length} 条用户任务（测试后自动恢复）`)
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage()
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') log('[console]', m.type(), m.text().slice(0, 160)) })
  page.on('pageerror', (e) => log('[pageerror]', String(e).slice(0, 160)))

  log('打开页面...')
  await page.goto(`http://localhost:${PORT}`, { waitUntil: 'domcontentloaded', timeout: 20000 })
  log('页面已加载，等待渲染（云端尝试 + 本地兜底，最多 40 秒）...')
  await page.waitForSelector('.quadrant', { timeout: 40000 })
  const label = await page.textContent('#sync-label')
  log('渲染成功，同步标识 =', label)

  // 校验日期框默认是今天（本地时区 YYYY-MM-DD）
  const dateVal = await page.locator('.quadrant[data-quadrant="q1"] input[name="plannedDate"]').inputValue()
  const now = new Date()
  const expectToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  if (dateVal !== expectToday) throw new Error(`日期默认值不对：${dateVal}，应为 ${expectToday}`)
  log('日期框默认今天 =', dateVal)

  await page.locator('.quadrant[data-quadrant="q1"] input[name="title"]').fill('冒烟测试任务')
  await page.locator('.quadrant[data-quadrant="q1"] input[name="title"]').press('Enter')
  await page.waitForSelector('.task:has-text("冒烟测试任务")', { timeout: 15000 })
  log('添加任务成功')

  // 归档逻辑：计划日期=明天的任务不应出现在今天的四象限里
  const tomorrow = new Date(Date.now() + 86400000)
  const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`
  await page.locator('.quadrant[data-quadrant="q2"] input[name="plannedDate"]').fill(tomorrowStr)
  await page.locator('.quadrant[data-quadrant="q2"] input[name="title"]').fill('明日冒烟任务')
  await page.locator('.quadrant[data-quadrant="q2"] input[name="title"]').press('Enter')
  await page.waitForTimeout(2000)
  if (await page.locator('.task:has-text("明日冒烟任务")').count() > 0) throw new Error('明天的任务不该出现在今天的象限里')
  log('明天的任务已按预期隐藏（归档生效）')

  // 总事件视图：被归档隐藏的任务应在这里按计划日期分组显示
  await page.locator('.nav-btn[data-view="all"]').click()
  await page.waitForSelector('.day-group .task:has-text("明日冒烟任务")', { timeout: 15000 })
  log('总事件视图能看到全部任务（含未来日期）')
  await page.locator('.nav-btn[data-view="board"]').click()
  await page.waitForSelector('.quadrant', { timeout: 15000 })
  log('切回四象限正常')

  // 其他事件区：存在、通栏、能添加任务
  const otherCount = await page.locator('.quadrant[data-quadrant="other"]').count()
  if (otherCount !== 1) throw new Error('页面上应有一个「其他事件」区块')
  await page.locator('.quadrant[data-quadrant="other"] input[name="title"]').fill('冒烟其他事件')
  await page.locator('.quadrant[data-quadrant="other"] input[name="title"]').press('Enter')
  await page.waitForSelector('.quadrant[data-quadrant="other"] .task:has-text("冒烟其他事件")', { timeout: 15000 })
  log('其他事件区添加任务成功')

  // 移动双向：其他事件 → q2 → 其他事件
  const otherTask = page.locator('.quadrant[data-quadrant="other"] .task:has-text("冒烟其他事件")')
  await otherTask.locator('[data-action="menu"]').click()
  await page.locator('.menu-item[data-action="move"][data-target="q2"]').click()
  await page.waitForSelector('.quadrant[data-quadrant="q2"] .task:has-text("冒烟其他事件")', { timeout: 15000 })
  log('其他事件 → 重要·不紧急 移动成功')
  const movedTask = page.locator('.quadrant[data-quadrant="q2"] .task:has-text("冒烟其他事件")')
  await movedTask.locator('[data-action="menu"]').click()
  await page.locator('.menu-item[data-action="move"][data-target="other"]').click()
  await page.waitForSelector('.quadrant[data-quadrant="other"] .task:has-text("冒烟其他事件")', { timeout: 15000 })
  log('重要·不紧急 → 其他事件 移回成功')
  await page.locator('.nav-btn[data-view="cal"]').click()
  await page.waitForSelector('.cal-grid', { timeout: 15000 })
  await page.waitForSelector('.cal-task:has-text("明日冒烟任务")', { timeout: 15000 })
  log('日历月视图能按日期显示任务')
  await page.locator('.cal-nav .nav-btn[data-cal="-1"]').click()
  await page.waitForTimeout(500)
  if (await page.locator('.cal-task:has-text("明日冒烟任务")').count() > 0) throw new Error('翻到上月不该显示明日任务')
  await page.locator('.cal-nav .nav-btn[data-cal="1"]').click()
  await page.waitForSelector('.cal-task:has-text("明日冒烟任务")', { timeout: 15000 })
  log('日历翻月正常')
  await page.locator('.nav-btn[data-view="board"]').click()
  await page.waitForSelector('.quadrant', { timeout: 15000 })

  await page.locator('.task:has-text("冒烟测试任务") .check').first().click()
  await page.waitForSelector('.task.is-done:has-text("冒烟测试任务")', { timeout: 15000 })
  log('勾选完成成功')

  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.quadrant', { timeout: 40000 })
  await page.waitForSelector('.task:has-text("冒烟测试任务")', { timeout: 15000 })
  log('刷新后任务仍在（持久化成功）')

  // 今日梳理面板：强制弹出（?review=1），验证统计和「未完成滚到明天」
  await page.locator('.quadrant[data-quadrant="q3"] input[name="title"]').fill('冒烟未完成任务')
  await page.locator('.quadrant[data-quadrant="q3"] input[name="title"]').press('Enter')
  await page.waitForSelector('.task:has-text("冒烟未完成任务")', { timeout: 15000 })
  await page.goto(`http://localhost:${PORT}/?review=1`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.review-panel', { timeout: 40000 })
  const summary = await page.textContent('.review-summary')
  log('梳理面板弹出，统计：', summary.replace(/\s+/g, ' ').trim())
  const reviewQuadrants = await page.textContent('.review-quadrants')
  if (!reviewQuadrants.includes('其他事件')) throw new Error('梳理面板应包含其他事件的统计')
  log('梳理面板包含其他事件统计')
  await page.locator('[data-review="rollover"]').click()
  await page.waitForSelector('.quadrant', { timeout: 15000 })
  await page.waitForTimeout(2000)
  if (await page.locator('.quadrant .task:has-text("冒烟未完成任务")').count() > 0) throw new Error('滚到明天后任务不该还留在今天的象限')
  log('未完成任务已滚到明天')
  // 总事件里应能在明天分组看到它
  await page.locator('.nav-btn[data-view="all"]').click()
  await page.waitForSelector('.day-group .task:has-text("冒烟未完成任务")', { timeout: 15000 })
  log('总事件里确认该任务仍在（未被误删）')
  // 其他事件的任务应带「其他」标签
  const otherTag = page.locator('.day-group .task:has-text("冒烟其他事件") .q-tag')
  if ((await otherTag.count()) === 0 || !(await otherTag.first().textContent()).includes('其他')) throw new Error('总事件里其他事件任务应带「其他」标签')
  log('总事件里其他事件任务标签正常')
  await page.locator('.nav-btn[data-view="board"]').click()
  await page.waitForSelector('.quadrant', { timeout: 15000 })

  await page.screenshot({ path: path.join(root, 'tests', 'shots', 'smoke.png') })
  log('SMOKE_PASS')
} catch (e) {
  log('SMOKE_FAIL:', String(e).slice(0, 300))
  process.exitCode = 1
} finally {
  await restoreUserTasks(userSnapshot)
  await cleanupSmokeTasks()
  if (browser) await browser.close()
  server.kill('SIGTERM')
  spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { shell: true })
}
