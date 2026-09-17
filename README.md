# NATAScope Web 工作台

NATAScope Web 工作台是一个基于 Next.js、React 和 TypeScript 的浏览器端空间组学图像工具。应用不依赖后端服务，导入的图像、项目草稿和处理结果均保留在当前浏览器中。

## 功能

- **Spatial Tissue Region Annotator**：导入空间转录组 bundle 与 H&E 图像，交互式标注组织区域，并导出项目或 CSV 结果。
- **Spatial Image Preparation**：在 `/preprocess` 中导入 NATA Align 参考图与 H&E 图像，完成捕获区域定位、ROI 对齐、图像配准、质量审核、组织 spot 选择和预处理包导出。
- **本地项目管理**：支持保存、继续、导入和删除项目；大体积图像与矩阵数据使用浏览器 IndexedDB 存储。

## 环境要求

- Node.js 20 或更高版本
- npm 10 或更高版本
- 支持 WebAssembly、Canvas、IndexedDB 和 File API 的现代桌面浏览器

## 快速开始

```bash
npm ci
npm run dev
```

启动后访问：

- <http://localhost:3000>：组织区域标注入口
- <http://localhost:3000/preprocess>：图像预处理工作台

首次开发时也可以使用 `npm install`，但 CI、协作和可复现部署应优先使用 `npm ci`。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动 Next.js 开发服务器，支持热更新。 |
| `npm run build` | 执行生产构建，并进行 Next.js/TypeScript 检查。 |
| `npm run start` | 运行已完成的生产构建，默认监听 3000 端口。 |
| `npm run lint` | 使用 ESLint 检查 Next.js 与 TypeScript 代码。 |
| `npm run test:unit` | 运行全部 Vitest Node 测试与 jsdom 组件测试。 |
| `npm run test:unit -- src/lib/preprocess/alignment.test.ts` | 运行指定测试文件。 |

## 目录结构

```text
src/
├── app/
│   ├── page.tsx                 # 标注项目首页与 bundle 导入
│   ├── spatial/                 # 组织区域标注工作区
│   └── preprocess/              # 图像预处理路由、状态与组件
├── lib/                         # 解码、存储、几何、导出等领域逻辑
│   └── preprocess/              # 配准、组织识别、迁移与打包辅助函数
├── types/                       # 共享 TypeScript 数据模型
└── test/setup.ts                # Vitest jsdom 测试配置

public/
├── preprocess-chip-configs/     # 15um / 50um 芯片配置与模板
└── vendor/opencv/               # 本地 OpenCV.js 与 WASM 文件

docs/                            # 产品说明、操作手册和截图
```

各源码子目录中的 `AGENTS.md` 提供了更详细的局部约定；修改对应模块前建议先阅读。

## 使用文档

- 中文预处理手册：[`docs/HEFile-prepare-revised.md`](docs/HEFile-prepare-revised.md)
- 英文预处理手册：[`docs/HEFile-prepare-en.md`](docs/HEFile-prepare-en.md)

手册覆盖项目创建、源图像导入、捕获区域定位、特征点配准、质量检查、组织 spot 修正和结果导出。

## 开发约定

- TypeScript 开启严格模式，使用 `@/*` 别名引用 `src/` 内模块。
- React 组件与类型使用 `PascalCase`；函数、变量和 Hook 使用 `camelCase`。
- 页面 UI 优先使用 Chakra UI 组件与主题配置，避免无必要的自定义 CSS。
- 测试文件与被测模块同目录，Node 测试使用 `.test.ts`，组件测试使用 `.test.tsx`。
- 涉及浏览器 API 的逻辑应保留运行环境判断，或放在客户端组件中处理。
- 提交信息建议使用 Conventional Commits，例如 `feat(preprocess): ...` 或 `fix(preprocess): ...`。

提交前请至少运行：

```bash
npm run lint
npm run test:unit
npm run build
```

## 数据与安全说明

- 本应用没有内置后端；请勿将敏感样本数据上传到第三方服务。
- 清除浏览器站点数据会删除本地项目草稿。需要长期保留时，请使用页面提供的项目导出功能。
- 大体积图像与矩阵数据不应写入 `localStorage`，应遵循现有的 IndexedDB 存储划分。
- 不要提交真实患者数据、敏感样本图像或生成的项目包。

## 故障排查

- **页面无法加载或 WASM 初始化失败**：确认通过 `npm run dev` 或生产服务器访问，而不是直接用 `file://` 打开文件；检查 `public/vendor/opencv/` 是否完整。
- **存储不足或项目丢失**：删除不再使用的本地项目，并定期导出重要项目包。
- **依赖或构建异常**：删除本地安装缓存后重新执行 `npm ci`，并确认 Node.js 版本满足要求。
