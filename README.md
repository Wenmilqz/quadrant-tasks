# 四象限任务

按「紧急 × 重要」四象限管理每日任务的轻量网页应用。纯前端 + 腾讯云 CloudBase，手机上打开即用。

## 1. 解决什么问题

每天要做的事一多就容易乱：

- 待办列表平铺在一起，**分不清轻重缓急**，往往是「最吵的」先做，而不是「最重要的」先做
- 「重要但不紧急」的事（学习、锻炼、规划）最容易被一拖再拖
- 传统待办 App 越积越多，**昨天的没做完，今天的没心情看**
- 手机记的任务，电脑上想不起来看，**数据不同步**

这个应用把每天的任务强制放进四象限里，每天自动「归零」只看今天，并配了日历和每晚梳理，让「先做重要的事」变成习惯而不是口号。

## 2. 主要功能

- **四象限看板**：重要·紧急（马上做）、重要·不紧急（计划做）、不重要·紧急（快速处理）、不重要·不紧急（少做），外加通栏「其他事件」随手记
- **每天归零**：四象限只显示「计划日期 = 今天」的任务；历史不删，归档可查
- **计划日期**：添加任务时可改日期，默认今天，手机上点按弹系统日历
- **总事件**：全部任务按计划日期分组的总列表（含历史、已完成划线、象限标签）
- **日历**：只读月视图，每天格子显示待办数和任务标题，可翻月
- **今日梳理**：每天 18:00 后首次打开弹出当日总结（总数/完成数/各象限分布），一键把未完成任务滚到明天
- **云端同步**：CloudBase PostgreSQL 多设备同步；云端不可用自动退回浏览器本地存储，应用不卡死

## 3. 安装方法

```bash
# 克隆仓库
git clone https://github.com/Wenmilqz/quadrant-tasks.git
cd quadrant-tasks

# 安装依赖
npm install

# 配置（可选）：不配走本地存储，配了走云端同步
cp src/config.example.js src/config.js
# 然后用编辑器打开 src/config.js，填入 CloudBase 环境 ID 和 Publishable Key

# 启动开发服务器
npm run dev
```

浏览器打开终端里显示的地址（默认 `http://localhost:5173`）。

生产构建：

```bash
npx vite build --base=./
```

把 `dist/` 上传到任意静态托管（本项目用的是腾讯云 CloudBase 静态网站托管）。

### 配置云端同步（可选）

不配也能完整使用，数据只存在本机浏览器里。要手机电脑同步，按以下步骤：

1. 在 [CloudBase](https://tcb.cloud.tencent.com) 创建环境，开通 PostgreSQL 数据库
2. 创建 `tasks` 表：

```sql
create table tasks (
  id bigint generated always as identity primary key,
  title text not null,
  quadrant text not null,
  done boolean not null default false,
  created_at timestamptz not null default now(),
  planned_date date not null default current_date
);
```

3. 开启匿名访问并加一条宽松的 RLS 策略（自用场景；知道网址即可读写，请勿公开传播网址）：

```sql
alter table tasks enable row level security;
create policy tasks_anon_all on tasks for all to anon using (true) with check (true);
grant select, insert, update, delete on tasks to anon, authenticated;
grant usage on sequence tasks_id_seq to anon, authenticated;
```

4. 控制台 → 环境管理 → API Key 配置，生成 Publishable Key
5. 填入 `src/config.js`（第 3 步已复制模板）

## 4. 使用方法

**添加任务**：在某个象限（或其他事件）的输入框里打字，回车即添加。默认排在今天；想排到别天，先点下面的日期框改日期再回车。

**完成任务**：点任务左边的圆圈，完成的任务划线排到最后；再点一次可恢复。

**移动 / 删除任务**：点任务右边的「⋯」，选「移到『某象限』」或「删除」。

**切换视图**：顶栏三个按钮——
- 「四象限」：只看今天的任务（每天自动归零）
- 「总事件」：全部任务按计划日期分组，含历史
- 「日历」：按月看每天的任务分布

**每晚梳理**：18:00 后第一次打开应用会弹出今日总结。点「未完成滚到明天」，今天没做完的任务会自动改期到明天，明天打开就在象限里接着做；点「今天不再提示」则原样关闭。

## 5. 输入输出示例

**输入**：在「重要 · 不紧急」输入框敲 `写周报` 然后回车（日期框不动）。

**界面输出**：该象限立刻多一条 `写周报`，右上角计数从 0 变 1；顶栏显示「云端同步」（已配置云端时）。

**数据库输出**（云端模式下 `tasks` 表新增一行）：

| id | title | quadrant | done | planned_date |
|----|-------|----------|------|--------------|
| 7 | 写周报 | q2 | false | 2026-11-03 |

**输入**：把日期框改成 11-05，输入 `交报销单`，回车。

**输出**：「四象限」页看不到这条任务（不属于今天，归档生效）；切到「日历」视图翻到 11 月，5 日的格子里显示 `1 待办 交报销单`；「总事件」里它归在 `11月5日` 分组下，带「重要 · 不紧急」标签。

**输入**：18:30 打开应用（或手动访问 `?review=1` 预览）。

**输出**：弹出「今日梳理」面板，例如：

> 今天共 4 条任务，完成 2 条，还剩 2 条
> 重要 · 不紧急　1 / 2 完成
> 重要 · 紧急　　1 / 1 完成
> 不重要 · 紧急　0 / 0 完成
> 不重要 · 不紧急　0 / 1 完成
> 其他事件　　0 / 0 完成

点「未完成滚到明天」后，剩余 2 条任务的 `planned_date` 更新为明天，四象限页清空，明天打开继续。

## 测试

```bash
npm test
```

端到端冒烟测试：起本地服务、用无头浏览器跑「添加 / 归档 / 视图切换 / 梳理面板」全流程。配置了云端同步的话，新建 `tests/config.mjs`（格式见 `tests/smoke.mjs` 头部注释，已被 gitignore），测试结束后会自动清理测试数据并恢复你的真实任务。

## 技术栈

Vanilla JS + Vite，无框架依赖，无服务端。数据库访问用 `@cloudbase/js-sdk` 的 postgrest 风格 API。

## License

MIT
