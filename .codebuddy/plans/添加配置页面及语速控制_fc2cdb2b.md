---
name: 添加配置页面及语速控制
overview: 在前端左上角添加配置入口图标，新增配置页面（含语速滑块），同时把 header 中间的标题改为当前智能体名字。
design:
  architecture:
    framework: react
    component: shadcn
  styleKeywords:
    - Minimal
    - WeChat-style
    - Clean
  fontSystem:
    fontFamily: PingFang SC
    heading:
      size: 17px
      weight: 500
    subheading:
      size: 15px
      weight: 400
    body:
      size: 15px
      weight: 400
  colorSystem:
    primary:
      - "#07c160"
    background:
      - "#ededed"
      - "#ffffff"
    text:
      - "#111111"
      - "#333333"
      - "#888888"
    functional:
      - "#07c160"
      - "#ff3b30"
todos:
  - id: modify-pcm-player
    content: 修改 PcmPlayer.ts，新增 setPlaybackRate 方法和 rate 属性，在 enqueuePcm16Base64 中应用 source.playbackRate.value
    status: completed
  - id: create-settings-page
    content: 新建 SettingsPage.tsx，包含语速滑块（0.5~2.0），保存到 localStorage
    status: completed
  - id: add-settings-route
    content: 修改 App.tsx，新增 /settings 路由指向 SettingsPage
    status: completed
    dependencies:
      - create-settings-page
  - id: modify-chat-header
    content: 修改 ChatPage.tsx header：删除"英语对话练习"，左侧加设置按钮，中间显示当前 persona 名称
    status: completed
    dependencies:
      - add-settings-route
  - id: apply-playback-rate
    content: 在 ChatPage.tsx 中：runStream 时设置 PcmPlayer 速率，三处 new Audio 后设置 audio.playbackRate
    status: completed
    dependencies:
      - modify-pcm-player
      - modify-chat-header
---

## 产品概述

在现有英语对话练习应用中，新增设置页面并在聊天页面头部展示当前智能体名称，支持用户通过播放器端调节语音播放速度。

## 核心功能

- 聊天页面头部改造：删除"英语对话练习"文字，居中显示当前智能体名称，左上角新增设置入口图标按钮
- 新增设置页面（路由 /settings）：包含语速调节滑块（0.5x ~ 2.0x），实时保存至 localStorage
- PcmPlayer 支持 playbackRate：流式播放时按设定速率播放
- HTML5 Audio 回放支持 playbackRate：点击语音条回放时按设定速率播放

## 技术栈

- 前端框架：React + TypeScript + React Router DOM（与现有项目一致）
- 样式：Tailwind CSS（与现有项目一致）
- 状态持久化：localStorage

## 实现方案

### 1. PcmPlayer 增加 setPlaybackRate 支持

在 `frontend/src/audio/pcmPlayer.ts` 中：

- 新增私有属性 `private rate = 1.0`
- 新增方法 `setPlaybackRate(rate: number)`：限制范围 0.5~2.0，赋值给 `this.rate`
- 修改 `enqueuePcm16Base64` 方法：
- 创建 `AudioBufferSourceNode` 后设置 `source.playbackRate.value = this.rate`
- 修正 `this.nextTime = start + buffer.duration / this.rate`（播放速率影响实际时长）

### 2. HTML5 Audio 回放增加 playbackRate

在 `frontend/src/pages/ChatPage.tsx` 中，三处创建 `new Audio(url)` 的位置之后，立即设置 `audio.playbackRate`：

- 场景 B（第 426 行）：`audio.playbackRate = getSavedRate()`
- 场景 C（第 481 行）：`audio.playbackRate = getSavedRate()`
- 从 localStorage 读取 savedRate，key 为 `omni_speech_rate`，默认 1.0

### 3. 聊天页面 Header 改造

在 `frontend/src/pages/ChatPage.tsx` 第 597~618 行：

- 删除第 600 行 `<span>英语对话练习</span>`
- 左侧新增设置按钮：齿轮图标（SVG 或 🔧），点击 `navigate("/settings")`
- 中间显示当前 persona 名称：通过 `selectedPersona` 在 `personas` 数组中查找 `name`，找不到时显示"默认"
- header 布局改为 `justify-center` 并配合绝对定位的左侧按钮

### 4. 新增设置页面 SettingsPage.tsx

新建 `frontend/src/pages/SettingsPage.tsx`：

- 路由：`/settings`
- 顶部导航栏：左侧返回箭头（navigate(-1)），中间标题"设置"
- 语速调节：`<input type="range" min={0.5} max={2.0} step={0.05}>`，实时显示当前值（如 1.00x）
- onChange 时保存至 localStorage(`omni_speech_rate`) 并通知聊天页面（通过 localStorage 事件或返回时读取）

### 5. 路由配置

在 `frontend/src/App.tsx` 中：

- 新增 import `{ SettingsPage } from "./pages/SettingsPage"`
- 新增 `<Route path="/settings" element={<SettingsPage />} />`

### 6. 语速持久化

- localStorage key：`omni_speech_rate`
- 默认值：`"1.0"`
- 在 ChatPage 的 `runStream` 中，创建 PcmPlayer 后调用 `playerRef.current.setPlaybackRate(getSavedRate())`
- 在设置页面修改后立即生效（下次播放时生效，当前播放中的不中断）

## 目录结构

```
frontend/src/
├── App.tsx                     # [MODIFY] 新增 /settings 路由
├── pages/
│   ├── ChatPage.tsx            # [MODIFY] header 改造 + Audio playbackRate + PcmPlayer 速率设置
│   └── SettingsPage.tsx       # [NEW] 设置页面
└── audio/
    └── pcmPlayer.ts           # [MODIFY] 新增 setPlaybackRate 方法
```

## 设计风格

采用与现有应用一致的 WeChat 风格简洁设计。整体色调保持绿色（#07c160）为主色调，背景使用灰色系（#ededed）。

## 页面设计

### 聊天页面 Header（ChatPage.tsx）

- 三栏布局：左侧设置图标（24x24px，灰色），中间智能体名称（font-medium text-[17px]），右侧 persona 下拉框
- 设置图标：使用 SVG 齿轮图标，hover 时颜色加深
- 智能体名称：居中绝对定位，显示当前选中的 persona.name，无选中时显示"默认"

### 设置页面（SettingsPage.tsx）

- 顶部导航栏：h-12，flex items-center，左侧返回箭头（svg 或 ←），中间"设置"，与 ChatPage header 视觉一致
- 页面背景：bg-[#ededed]
- 设置项卡片：bg-white mx-3 mt-3 rounded-lg p-4
- 语速调节区：
- 上方标签："播放语速"，左侧显示当前值（如 1.00x），monospace 字体右对齐
- 滑块：w-full accent-[#07c160]，轨道颜色与主题一致
- 下方预设按钮行："慢速 0.75x"、"正常 1.0x"、"快速 1.25x"，小号圆角按钮，选中状态绿色填充