import './style.css'
import { createStore, createLocalStore, todayStr } from './store.js'

const QUADRANTS = [
  { id: 'q2', name: '重要 · 不紧急', hint: '计划做' },
  { id: 'q1', name: '重要 · 紧急', hint: '马上做' },
  { id: 'q4', name: '不重要 · 不紧急', hint: '少做' },
  { id: 'q3', name: '不重要 · 紧急', hint: '快速处理' }
]

// 第五个区块：不分重要紧急的「其他事件」，通栏放在四象限下方
const OTHER = { id: 'other', name: '其他事件', hint: '不分类' }

const quadrantName = (id) => [...QUADRANTS, OTHER].find((q) => q.id === id)?.name ?? ''

let store = null
let tasks = []
let openMenuId = null
let view = 'board' // board 四象限 | all 总事件 | cal 日历
let calCursor = new Date() // 日历当前显示的月份（只用年月）
let reviewOpen = false // 今日梳理面板

const REVIEW_KEY = 'quadrant-tasks.reviewDismissed'

function tomorrowStr() {
  const d = new Date(Date.now() + 86400000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// 18:00 后当天首次打开时弹「今日梳理」；?review=1 用于强制预览/测试
function maybeOpenReview() {
  const force = new URLSearchParams(location.search).get('review') === '1'
  const dismissed = localStorage.getItem(REVIEW_KEY) === todayStr()
  if ((force || new Date().getHours() >= 18) && !dismissed) reviewOpen = true
}

const app = document.getElementById('app')

async function refresh() {
  tasks = await store.list()
  render()
}

// 任务上没有 plannedDate 的（本地旧数据）按今天处理
const taskDate = (t) => t.plannedDate || todayStr()

function render() {
  app.innerHTML = `
    <header class="topbar">
      <h1>四象限任务</h1>
      <nav class="nav">
        <button class="nav-btn ${view === 'board' ? 'active' : ''}" data-view="board">四象限</button>
        <button class="nav-btn ${view === 'all' ? 'active' : ''}" data-view="all">总事件</button>
        <button class="nav-btn ${view === 'cal' ? 'active' : ''}" data-view="cal">日历</button>
      </nav>
      <span class="sync" id="sync-label">${store.mode === 'cloud' ? '云端同步' : '本地模式'}</span>
    </header>
    ${view === 'board'
      ? `<main class="grid">${QUADRANTS.map((q) => renderQuadrant(q)).join('')}${renderQuadrant(OTHER)}</main>`
      : view === 'all' ? renderAll() : renderCalendar()}
    ${reviewOpen ? renderReview() : ''}
  `
  bindEvents()
}

// 今日梳理：统计今天的新增/完成/象限分布；确认后今天未完成的任务滚到明天
function renderReview() {
  const today = todayStr()
  const todays = tasks.filter((t) => taskDate(t) === today)
  const done = todays.filter((t) => t.done)
  const open = todays.filter((t) => !t.done)
  return `
    <div class="review-mask">
      <div class="review-panel">
        <h2>今日梳理</h2>
        <p class="review-summary">今天共 <strong>${todays.length}</strong> 条任务，完成 <strong>${done.length}</strong> 条，还剩 <strong>${open.length}</strong> 条</p>
        <ul class="review-quadrants">
          ${[...QUADRANTS, OTHER].map((q) => {
            const inQ = todays.filter((t) => t.quadrant === q.id)
            return `<li><span>${q.name}</span><span>${inQ.filter((t) => t.done).length} / ${inQ.length} 完成</span></li>`
          }).join('')}
        </ul>
        ${open.length ? `<p class="review-hint">点「滚到明天」，这 ${open.length} 条未完成任务会排到明天。</p>` : '<p class="review-hint">今天全部完成，漂亮！</p>'}
        <div class="review-actions">
          ${open.length ? '<button class="btn primary" data-review="rollover">未完成滚到明天</button>' : ''}
          <button class="btn" data-review="dismiss">今天不再提示</button>
        </div>
      </div>
    </div>
  `
}

// 日历：只读月视图，按计划日期落格，今天高亮
function renderCalendar() {
  const y = calCursor.getFullYear()
  const m = calCursor.getMonth()
  const daysInMonth = new Date(y, m + 1, 0).getDate()
  const firstOffset = (new Date(y, m, 1).getDay() + 6) % 7 // 周一开头
  const byDate = new Map()
  for (const t of tasks) {
    const d = taskDate(t)
    if (!byDate.has(d)) byDate.set(d, [])
    byDate.get(d).push(t)
  }
  const today = todayStr()
  const cells = []
  for (let i = 0; i < firstOffset; i++) cells.push('<div class="cal-cell blank"></div>')
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const list = byDate.get(ds) || []
    const open = list.filter((t) => !t.done).length
    cells.push(`
      <div class="cal-cell ${ds === today ? 'today' : ''} ${list.length ? 'has-tasks' : ''}">
        <div class="cal-head">
          <span class="cal-day">${d}</span>
          ${list.length ? `<span class="cal-count">${open ? open + ' 待办' : '全完成'}</span>` : ''}
        </div>
        ${list.slice(0, 3).map((t) => `<div class="cal-task ${t.done ? 'is-done' : ''}">${escapeHtml(t.title)}</div>`).join('')}
        ${list.length > 3 ? `<div class="cal-more">还有 ${list.length - 3} 条…</div>` : ''}
      </div>
    `)
  }
  return `
    <main class="page">
      <div class="cal-nav">
        <button class="nav-btn" data-cal="-1">‹ 上月</button>
        <strong>${y} 年 ${m + 1} 月</strong>
        <button class="nav-btn" data-cal="1">下月 ›</button>
      </div>
      <div class="cal-grid">
        ${['一', '二', '三', '四', '五', '六', '日'].map((w) => `<div class="cal-week">${w}</div>`).join('')}
        ${cells.join('')}
      </div>
    </main>
  `
}

function renderAll() {
  // 总事件：全部任务按计划日期倒序分组，同日期内按创建时间排序，完成的划线
  const groups = new Map()
  for (const t of tasks) {
    const d = taskDate(t)
    if (!groups.has(d)) groups.set(d, [])
    groups.get(d).push(t)
  }
  const dates = [...groups.keys()].sort().reverse()
  const today = todayStr()
  const fmt = (d) => {
    const [y, m, day] = d.split('-').map(Number)
    const label = `${m}月${day}日`
    return d === today ? `${label} · 今天` : d < today ? `${label} · 已过期` : label
  }
  if (dates.length === 0) return '<main class="page"><p class="empty">还没有任务</p></main>'
  return `
    <main class="page">
      ${dates.map((d) => `
        <section class="day-group">
          <h3 class="day-title">${fmt(d)}</h3>
          <ul class="task-list">
            ${groups.get(d).map((t) => `
              <li class="task static ${t.done ? 'is-done' : ''}">
                <span class="q-tag ${t.quadrant}">${quadrantName(t.quadrant)}</span>
                <span class="title">${escapeHtml(t.title)}</span>
              </li>
            `).join('')}
          </ul>
        </section>
      `).join('')}
    </main>
  `
}

function renderQuadrant(q) {
  // 归档逻辑：四象限只显示计划日期为今天的任务；历史任务保留在数据库里，
  // 由「总事件」和「日历」视图查看。
  const today = todayStr()
  const list = tasks.filter((t) => t.quadrant === q.id && taskDate(t) === today)
  const open = list.filter((t) => !t.done)
  const done = list.filter((t) => t.done)
  return `
    <section class="quadrant" data-quadrant="${q.id}">
      <div class="q-head">
        <div>
          <h2>${q.name}</h2>
          <span class="q-hint">${q.hint}</span>
        </div>
        <span class="q-count">${open.length}</span>
      </div>
      <form class="add-form" data-quadrant="${q.id}">
        <input type="text" name="title" placeholder="添加任务，回车确认" autocomplete="off" maxlength="100" />
        <input type="date" name="plannedDate" class="date-input" value="${todayStr()}" aria-label="计划日期" />
      </form>
      <ul class="task-list">
        ${open.map((t) => renderTask(t)).join('')}
        ${done.map((t) => renderTask(t)).join('')}
      </ul>
    </section>
  `
}

function renderTask(t) {
  const menuOpen = openMenuId === t._id
  // 移动目标 = 除自己所在的区块外的所有区块（四象限 + 其他事件）
  const otherQuadrants = [...QUADRANTS, OTHER].filter((q) => q.id !== t.quadrant)
  return `
    <li class="task ${t.done ? 'is-done' : ''}" data-id="t._id">
      <button class="check" data-action="toggle" aria-label="${t.done ? '恢复' : '完成'}">
        ${t.done ? checkSvg : ''}
      </button>
      <span class="title">${escapeHtml(t.title)}</span>
      <div class="menu-wrap">
        <button class="more" data-action="menu" aria-label="更多操作">${dotsSvg}</button>
        ${menuOpen ? `
          <div class="menu" data-menu="${t._id}">
            ${otherQuadrants.map((q) => `
              <button class="menu-item" data-action="move" data-target="${q.id}">移到「${q.name}」</button>
            `).join('')}
            <button class="menu-item danger" data-action="remove">删除</button>
          </div>
        ` : ''}
      </div>
    </li>
  `
}

function bindEvents() {
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.cal) {
        // 日历翻月
        calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() + Number(btn.dataset.cal), 1)
      } else {
        view = btn.dataset.view
        openMenuId = null
      }
      render()
    })
  })

  document.querySelectorAll('[data-review]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const action = btn.dataset.review
      btn.disabled = true
      if (action === 'rollover') {
        // 把今天未完成的任务的计划日期改到明天
        const today = todayStr()
        const tmr = tomorrowStr()
        const open = tasks.filter((t) => taskDate(t) === today && !t.done)
        for (const t of open) await store.update(t._id, { plannedDate: tmr })
      }
      localStorage.setItem(REVIEW_KEY, todayStr())
      reviewOpen = false
      await refresh()
    })
  })

  document.querySelectorAll('.add-form').forEach((form) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault()
      const input = form.elements.title
      const title = input.value.trim()
      if (!title) return
      input.disabled = true
      await store.add(title, form.dataset.quadrant, form.elements.plannedDate.value || null)
      await refresh()
    })
  })

  document.querySelectorAll('.task [data-action]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()
      const li = btn.closest('.task')
      const id = li.dataset.id
      const action = btn.dataset.action
      if (action === 'toggle') {
        const task = tasks.find((t) => t._id === id)
        openMenuId = null
        await store.update(id, { done: !task.done })
        await refresh()
      } else if (action === 'menu') {
        openMenuId = openMenuId === id ? null : id
        render()
      } else if (action === 'move') {
        openMenuId = null
        await store.update(id, { quadrant: btn.dataset.target })
        await refresh()
      } else if (action === 'remove') {
        openMenuId = null
        await store.remove(id)
        await refresh()
      }
    })
  })
}

// 点击空白处收起菜单
document.addEventListener('click', (e) => {
  if (openMenuId && !e.target.closest('.menu-wrap')) {
    openMenuId = null
    render()
  }
})

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]))
}

// 图标来自 Lucide（lucide.dev），ISC 协议
const checkSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>'
const dotsSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>'

async function main() {
  app.innerHTML = '<p class="loading">加载中…</p>'
  try {
    store = await createStore()
    await refresh()
    maybeOpenReview()
    if (reviewOpen) render()
  } catch (err) {
    console.error('云端不可用，退回本地模式：', err)
    store = createLocalStore()
    try {
      await refresh()
    } catch (localErr) {
      console.error('本地存储也不可用：', localErr)
      app.innerHTML = '<p class="loading">应用初始化失败，请刷新重试</p>'
    }
  }
}

main()
