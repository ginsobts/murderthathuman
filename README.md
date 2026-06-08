# murderthathuman

一款关于人类、人工智能与仿生机器人关系的**文字侦探解谜游戏**原型。

玩家进入一台死者遗留的 AI 家庭操作系统「织」，在它的**桌面**里翻找文件、图片和文件夹，一步步还原山中宅邸里的一桩集体死亡案件。

游戏有两套界面：

- **`desktop.html`** —— 当前主推的「桌面系统」版本（可双击图标、带可视化编辑器）。**推荐从这个开始。**
- `index.html` —— 早期的命令行终端版本原型（保留作参考）。

---

## 一、如何在自己电脑上运行（含从 Git 下载）

### 1. 把项目下载下来

```bash
git clone https://github.com/ginsobts/murderthathuman.git
cd murderthathuman
```

> 没装 git 的话，也可以在 GitHub 页面点 `Code → Download ZIP`，解压即可。

### 2. 启动一个本地服务器再打开

因为游戏要加载壁纸、图标等图片资源，**建议用本地服务器打开**（直接双击 `desktop.html` 在部分浏览器里图片可能加载不出来）。

```bash
# 方式 A：Python（大多数电脑自带）
python -m http.server 8000

# 方式 B：Node.js
npx serve .
```

然后在浏览器访问：

- 桌面版： <http://localhost:8000/desktop.html>
- 终端版： <http://localhost:8000/index.html>

---

## 二、如何游玩（桌面版）

- **双击**桌面上的图标打开它：
  - 📄 文本文件 → 弹出窗口显示文字
  - 🖼️ 图片文件 → 弹出窗口显示图片
  - 📁 文件夹 → 打开后里面还有更多文件 / 文件夹，可继续往里点
- 窗口可以**拖动标题栏移动**、点左上角红点**关闭**。
- 带 🔒 的文件是**加密的**，双击会要求输入密码；密码线索可能藏在别的文件里。

目标：把散落在各个文件里的线索拼起来，弄清楚到底发生了什么。

---

## 三、如何编辑游戏内容（可视化编辑器）

**你只需要改一个文件：`desktop-data.js`。** 它就像游戏的「关卡场景」，里面用一棵树描述了桌面上有什么。

有两种改法：

### 改法 A：网页里可视化编辑（推荐，像搭积木）

1. 打开 `desktop.html`，点右上角 **「✏️ 编辑模式」**。
2. 在编辑模式下：

   | 想做的事 | 操作 |
   |---|---|
   | 移动图标 | 直接用鼠标拖动 |
   | 改名称 / 内容 / 图片 / 密码 | 单击图标，右侧面板里改 |
   | 新建文件 | 顶部 `＋文本 / ＋图片 / ＋文件夹` |
   | 放进某个文件夹 | 先双击打开那个文件夹，再点 `＋` |
   | 加锁 | 选中后在面板里勾「🔒 加锁」并填密码 |
   | 删除 | 选中后点面板底部「🗑 删除此项」 |

3. 改动会**自动存草稿**（刷新页面不会丢，右上角有「草稿已自动保存」提示）。
4. 改满意后点 **「导出配置」**，把弹窗里的全部内容**复制**，粘贴覆盖到 `desktop-data.js` 文件里保存。这一步才算正式存盘（也方便提交到 git）。
5. 想丢掉草稿、回到文件版本，点 **「恢复文件版本」**。

> 小贴士：草稿存在浏览器里，正式版本存在 `desktop-data.js` 文件里。就像编辑器里「自动保存的临时稿」和「另存为文件」的关系——平时靠草稿，定稿要导出。

### 改法 B：直接手写 `desktop-data.js`

文件顶部有详细注释。三种元素写法：

```javascript
// 文本文件
{ type: "txt", name: "线索.txt", content: [
    "第一行",
    "第二行"
] }

// 图片文件（把 src 换成你自己的图片路径）
{ type: "img", name: "现场.img", src: "assets/scene.png", caption: "可选说明" }

// 文件夹（children 里可以无限往里套）
{ type: "folder", name: "档案", children: [ /* 这里再放节点 */ ] }

// 给任意文件加锁
{ type: "txt", name: "机密.txt",
  locked: true, password: "0005", lockHint: "提示文字",
  content: [ "解锁后才看得到" ] }
```

改完保存文件、刷新浏览器即可看到效果。

---

## 四、项目结构

```text
murderthathuman/
├── desktop.html        # 【主推】桌面系统版入口
├── desktop.css         # 桌面 / 图标 / 窗口样式
├── desktop.js          # 桌面引擎 + 可视化编辑器（一般不用改）
├── desktop-data.js     # ★ 你要编辑的内容配置（桌面上有什么）
├── assets/             # 壁纸与图标等图片资源
│
├── index.html          # 早期命令行终端版（参考）
├── styles.css / game.js / data.js / art.js   # 终端版相关文件
├── movement-demo.html  # 交互能力演示：推箱子小游戏
│
├── story-bible.md      # 完整剧情设定文档（含剧透，仅供开发参考）
└── README.md           # 本文件
```

---

## 五、技术说明

- 纯 HTML / CSS / JavaScript，**零依赖**，不需要安装任何框架。
- 内容与代码分离：配置都在 `desktop-data.js`，引擎在 `desktop.js`。
- 可直接打包为 zip 上传 [itch.io](https://itch.io)（选 HTML 类型，入口设为 `desktop.html`）。
- 兼容现代浏览器（Chrome / Edge / Safari / Firefox）。

## License

MIT
