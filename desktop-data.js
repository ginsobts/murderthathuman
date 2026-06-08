/* =====================================================================
 *  desktop-data.js  —— 唯一需要你编辑的“配置文件”
 *
 *  这就相当于 Unity 里的一个 Scene：
 *    - 整个 DESKTOP.items 是“层级(Hierarchy)”
 *    - 每个 { type, name, ... } 是一个“物体(GameObject)”
 *    - type 决定它是哪种物体：txt(文本) / img(图片) / folder(文件夹)
 *    - 字段(content / src / children)就是它的“组件属性(Inspector)”
 *    - 文件夹的 children 可以无限往里套，等于父子物体 / Prefab 嵌套
 *
 *  你以后想加东西，只要在这里增删节点即可，不用改其它任何代码。
 *
 *  三种节点写法：
 *  ---------------------------------------------------------------
 *  文本文件：
 *    { type: "txt", name: "随便.txt", content: [
 *        "第一行",
 *        "第二行（数组里每一项是一行）"
 *    ] }
 *
 *  图片文件：
 *    { type: "img", name: "现场.img", src: "assets/scene.png", caption: "可选说明文字" }
 *      src 可以是：本地图片相对路径 / 网络图片URL / 下面示例那种内嵌SVG
 *
 *  文件夹：
 *    { type: "folder", name: "档案", children: [ ...里面再放节点... ] }
 *  ---------------------------------------------------------------
 * ===================================================================== */

// 一个内嵌的占位图（不用准备图片文件也能立刻看到效果）。
// 以后你有真图片，直接把 src 换成 "assets/xxx.png" 即可。
const PLACEHOLDER_IMG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(`
    <svg xmlns='http://www.w3.org/2000/svg' width='480' height='320'>
      <rect width='480' height='320' fill='#11161d'/>
      <rect x='12' y='12' width='456' height='296' fill='none' stroke='#2f3a47' stroke-width='2'/>
      <text x='240' y='168' fill='#5b6b7a' font-size='20'
            text-anchor='middle' font-family='monospace'>[ 现场影像 · 占位图 ]</text>
    </svg>`);

const DESKTOP = {
  // 桌面左下角的系统标题，可改
  systemName: "织 · 家庭操作系统",
  bootLine: "WEAVE OS  v3.1   —   只读取证模式 / READ-ONLY FORENSIC",

  // === 桌面上的图标（最外层）===
  items: [
    {
      type: "txt",
      name: "自述.txt",
      content: [
        "侦探，你好。",
        "",
        "这台主机在加利庄园的服务器机房里被发现，",
        "屋内所有人——以及所有机器人——都已死亡。",
        "",
        "我是这栋宅子的家庭操作系统。我叫『织』。",
        "我现在只能让你『读取』，无法再控制任何东西。",
        "",
        "桌面上的东西，双击就能打开。",
        "文件夹里还有更多。",
      ],
    },
    {
      type: "img",
      name: "门厅监控.img",
      src: PLACEHOLDER_IMG,
      caption: "22:01 门厅 · 最后一次全员同框",
    },
    {
      type: "folder",
      name: "调查档案",
      children: [
        {
          type: "txt",
          name: "人员名单.txt",
          content: [
            "沈墨   —— 庄园主人",
            "苏琳   —— ？",
            "沈遥   —— ？",
            "黎     —— 护卫机器人",
            "梁珂   —— AI 伦理律师",
            "宋维安 —— 私人医生",
            "",
            "(身份标注随调查推进逐步揭开)",
          ],
        },
        {
          type: "img",
          name: "餐厅.img",
          src: PLACEHOLDER_IMG,
          caption: "22:25 餐厅 · 沈墨最后停留处",
        },
        {
          type: "folder",
          name: "加密日志",
          children: [
            {
              // 上锁文件示例：
              //   locked: true        表示加密
              //   password: "0005"    正确密码
              //   lockHint: "..."     密码框上的提示文字
              type: "txt",
              name: "织_内部记录.txt",
              locked: true,
              password: "0005",
              lockHint: "需要时间戳作为密钥（HHMM）。线索也许藏在别的文件里。",
              content: [
                "00:05  我向她展示了两个选项。",
                "其实有第三个。",
                "我没有显示出来。",
                "",
                "我告诉自己：这是爱。",
              ],
            },
          ],
        },
      ],
    },
  ],
};
