// 存储层：配置了 CloudBase 环境 ID 和 Publishable Key 就走云数据库（PostgreSQL 模式，
// 手机电脑同步），否则退回浏览器 localStorage（仅本机）。两个实现接口一致，界面层无感。
import cloudbase from '@cloudbase/js-sdk'
import { CLOUDBASE_ENV_ID, CLOUDBASE_PUBLISHABLE_KEY } from './config.js'

const TABLE = 'tasks'

// 本地日期字符串 YYYY-MM-DD（用本地时区，避免 UTC 转换差一天）
function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// 界面层字段（_id / createdAt / plannedDate）与云端列（id / created_at / planned_date）互转
function patchToCloud(patch) {
  const out = { ...patch }
  if ('plannedDate' in out) { out.planned_date = out.plannedDate; delete out.plannedDate }
  delete out._id
  delete out.createdAt
  return out
}

function makeLocal() {
  const KEY = 'quadrant-tasks.v1'
  const read = () => {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] }
  }
  const write = (list) => localStorage.setItem(KEY, JSON.stringify(list))
  return {
    mode: 'local',
    async list() {
      return read().sort((a, b) => a.createdAt - b.createdAt)
    },
    async add(title, quadrant, plannedDate) {
      const task = {
        _id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        title, quadrant, done: false, createdAt: Date.now(),
        plannedDate: plannedDate || todayStr()
      }
      const list = read()
      list.push(task)
      write(list)
      return task
    },
    async update(id, patch) {
      const list = read()
      const t = list.find((t) => t._id === id)
      if (t) Object.assign(t, patch)
      write(list)
    },
    async remove(id) {
      write(read().filter((t) => t._id !== id))
    }
  }
}

async function makeCloud() {
  // Publishable Key 模式：init 时传入 accessKey，前端请求直接携带该凭证，
  // 无需匿名登录；数据库侧由 RLS 策略控制可访问范围
  const app = cloudbase.init({ env: CLOUDBASE_ENV_ID, region: 'ap-shanghai', accessKey: CLOUDBASE_PUBLISHABLE_KEY })
  const db = app.rdb()
  // 初始化时先探测一次连通性，失败立即抛错让上层退回本地模式，
  // 避免等到首次操作才发现云端不可用
  const probe = await db.from(TABLE).select('*').limit(1)
  if (probe.error) throw probe.error
  // 云端表结构：id 自增主键 / title 文本 / quadrant 文本 / done 布尔 / created_at 时间戳 / planned_date 日期
  // 界面层统一用 _id / createdAt / plannedDate，这里做一次字段映射
  const toLocal = (row) => ({ _id: String(row.id), title: row.title, quadrant: row.quadrant, done: row.done, createdAt: new Date(row.created_at).getTime(), plannedDate: row.planned_date })
  return {
    mode: 'cloud',
    async list() {
      const { data, error } = await db.from(TABLE).select('*').order('created_at', { ascending: true })
      if (error) throw error
      return data.map(toLocal)
    },
    async add(title, quadrant, plannedDate) {
      const { data, error } = await db.from(TABLE).insert({ title, quadrant, done: false, planned_date: plannedDate || todayStr() }).select()
      if (error) throw error
      return toLocal(data[0])
    },
    async update(id, patch) {
      const { error } = await db.from(TABLE).update(patchToCloud(patch)).eq('id', id)
      if (error) throw error
    },
    async remove(id) {
      const { error } = await db.from(TABLE).delete().eq('id', id)
      if (error) throw error
    }
  }
}

export function createLocalStore() {
  return makeLocal()
}

export { todayStr }

export async function createStore() {
  if (CLOUDBASE_ENV_ID && CLOUDBASE_PUBLISHABLE_KEY) {
    try {
      return await makeCloud()
    } catch (err) {
      console.error('云数据库连接失败，退回本地模式：', err)
    }
  }
  return makeLocal()
}
