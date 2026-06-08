/* =====================================================================
 *  build-play.js  —— 把整个游戏打包成一个可直接双击打开的 play.html
 *
 *  用法（装了 Node 的话）：  node build-play.js
 *  产物：  play.html  —— 单文件，离线可玩，发给别人双击即可，无需本地服务器。
 *          已隐藏“编辑模式”入口，别人只能玩、不能改内容。
 *
 *  改完 desktop-data.js（剧情内容）后，重新跑一次本脚本，就能刷新 play.html。
 * ===================================================================== */

const fs = require("fs");
const path = require("path");

const here = __dirname;
const read = (p) => fs.readFileSync(path.join(here, p), "utf8");
const dataUri = (p, mime) => {
  const b64 = fs.readFileSync(path.join(here, p)).toString("base64");
  return "data:" + (mime || "image/png") + ";base64," + b64;
};

// 注意：用 assets/sm-*.（压缩版）来内嵌。
// CSS 里的 url() 不能塞太大的 data URI（浏览器会直接丢掉整条 background），
// 所以壁纸必须是压缩过的小图。改图后先跑 `python shrink-assets.py` 再跑本脚本。
let css = read("desktop.css");
let engine = read("desktop.js");
const data = read("desktop-data.js");

// 1) 把 CSS 里的壁纸换成内嵌 data URI（压缩版 JPEG）
css = css.replace(/url\(["']?assets\/wallpaper\.png["']?\)/g, 'url("' + dataUri("assets/sm-wallpaper.jpg", "image/jpeg") + '")');

// 2) 把引擎里的图标路径换成内嵌 data URI（压缩版 PNG）
const iconMap = {
  "assets/icon-txt.png": dataUri("assets/sm-icon-txt.png"),
  "assets/icon-img.png": dataUri("assets/sm-icon-img.png"),
  "assets/icon-folder.png": dataUri("assets/sm-icon-folder.png"),
};
Object.keys(iconMap).forEach((rel) => {
  engine = engine.split('"' + rel + '"').join('"' + iconMap[rel] + '"');
});

// 3) 隐藏编辑入口（保留 DOM，避免引擎里的 getElementById 报错）
const hideEditor =
  "#btn-edit{display:none !important;}" +
  "#edit-only{display:none !important;}";

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>织 · 家庭操作系统</title>
<style>
${css}
${hideEditor}
</style>
</head>
<body>
<div id="desktop">
  <div id="icon-layer"></div>
  <div id="toolbar">
    <div id="edit-only">
      <span id="draft-status"></span>
      <span id="add-target"></span>
      <button class="tool-btn" id="btn-add-txt">＋文本</button>
      <button class="tool-btn" id="btn-add-img">＋图片</button>
      <button class="tool-btn" id="btn-add-folder">＋文件夹</button>
      <button class="tool-btn" id="btn-export">导出配置</button>
      <button class="tool-btn" id="btn-reset">恢复文件版本</button>
    </div>
    <button class="tool-btn" id="btn-reset-progress" title="清空你的游玩进度：解锁、看过的记录、改名、人物备注">↺ 重置进度</button>
    <button class="tool-btn" id="btn-edit">✏️ 编辑模式</button>
  </div>
  <div id="inspector"></div>
  <div id="system-tag">
    <div id="system-name"></div>
    <div id="boot-line"></div>
  </div>
</div>
<script>
${data}
</script>
<script>
${engine}
</script>
</body>
</html>
`;

fs.writeFileSync(path.join(here, "play.html"), html, "utf8");
const kb = (fs.statSync(path.join(here, "play.html")).size / 1024).toFixed(0);
console.log("play.html 生成完毕，约 " + kb + " KB。双击即可游玩。");
