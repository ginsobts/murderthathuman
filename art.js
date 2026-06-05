/*
 * 每个地点一张内嵌 SVG 场景图（暗色哥特线描风）。
 * 自带、无外部资源，方便直接打包上传 itch。
 * 想换成真实美术，把对应函数的返回值替换为 <img src="..."> 即可。
 */

const SCENE_ART = {
  // 门厅：大门 + 吊灯
  EN: `
  <svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid meet">
    <defs><radialGradient id="gEN" cx="50%" cy="30%" r="70%">
      <stop offset="0%" stop-color="#2a2418"/><stop offset="100%" stop-color="#0d0b08"/>
    </radialGradient></defs>
    <rect width="400" height="300" fill="url(#gEN)"/>
    <line x1="40" y1="0" x2="40" y2="300" stroke="#c8a96a" stroke-width="1" opacity=".3"/>
    <line x1="360" y1="0" x2="360" y2="300" stroke="#c8a96a" stroke-width="1" opacity=".3"/>
    <rect x="150" y="90" width="100" height="190" rx="50" fill="none" stroke="#c8a96a" stroke-width="2"/>
    <line x1="200" y1="90" x2="200" y2="280" stroke="#c8a96a" stroke-width="1.5"/>
    <circle cx="185" cy="190" r="3" fill="#c8a96a"/><circle cx="215" cy="190" r="3" fill="#c8a96a"/>
    <line x1="200" y1="0" x2="200" y2="40" stroke="#c8a96a" stroke-width="1.5"/>
    <ellipse cx="200" cy="55" rx="46" ry="16" fill="none" stroke="#c8a96a" stroke-width="2"/>
    <circle cx="172" cy="55" r="3" fill="#ffd27a"/><circle cx="200" cy="60" r="3" fill="#ffd27a"/><circle cx="228" cy="55" r="3" fill="#ffd27a"/>
  </svg>`,

  // 餐厅：长桌 + 烛台
  DI: `
  <svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid meet">
    <defs><radialGradient id="gDI" cx="50%" cy="35%" r="70%">
      <stop offset="0%" stop-color="#2b1d1d"/><stop offset="100%" stop-color="#0d0808"/>
    </radialGradient></defs>
    <rect width="400" height="300" fill="url(#gDI)"/>
    <polygon points="90,150 310,150 360,270 40,270" fill="none" stroke="#c8a96a" stroke-width="2"/>
    <ellipse cx="200" cy="150" rx="110" ry="20" fill="none" stroke="#c8a96a" stroke-width="2"/>
    <line x1="190" y1="95" x2="190" y2="140" stroke="#c8a96a" stroke-width="2"/>
    <line x1="210" y1="95" x2="210" y2="140" stroke="#c8a96a" stroke-width="2"/>
    <path d="M190 95 q0 -12 0 -14" stroke="#ffd27a" stroke-width="3" fill="none"/>
    <path d="M210 95 q0 -12 0 -14" stroke="#ffd27a" stroke-width="3" fill="none"/>
    <circle cx="190" cy="78" r="4" fill="#ffd27a"/><circle cx="210" cy="78" r="4" fill="#ffd27a"/>
    <circle cx="140" cy="160" r="7" fill="none" stroke="#c8a96a" stroke-width="1.5"/>
    <circle cx="260" cy="160" r="7" fill="none" stroke="#c8a96a" stroke-width="1.5"/>
  </svg>`,

  // 书房：书架 + 壁炉
  LI: `
  <svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid meet">
    <defs><radialGradient id="gLI" cx="35%" cy="40%" r="75%">
      <stop offset="0%" stop-color="#1d241d"/><stop offset="100%" stop-color="#080b08"/>
    </radialGradient></defs>
    <rect width="400" height="300" fill="url(#gLI)"/>
    <rect x="30" y="40" width="150" height="230" fill="none" stroke="#c8a96a" stroke-width="2"/>
    <line x1="30" y1="100" x2="180" y2="100" stroke="#c8a96a" stroke-width="1.5"/>
    <line x1="30" y1="160" x2="180" y2="160" stroke="#c8a96a" stroke-width="1.5"/>
    <line x1="30" y1="215" x2="180" y2="215" stroke="#c8a96a" stroke-width="1.5"/>
    <g stroke="#9c8550" stroke-width="3">
      <line x1="45" y1="55" x2="45" y2="95"/><line x1="58" y1="55" x2="58" y2="95"/><line x1="72" y1="58" x2="72" y2="95"/>
      <line x1="50" y1="112" x2="50" y2="155"/><line x1="63" y1="112" x2="63" y2="155"/><line x1="120" y1="115" x2="120" y2="155"/>
    </g>
    <rect x="250" y="150" width="110" height="120" fill="none" stroke="#c8a96a" stroke-width="2"/>
    <rect x="270" y="200" width="70" height="70" fill="none" stroke="#c8a96a" stroke-width="1.5"/>
    <path d="M285 270 q10 -30 20 -10 q8 -22 18 8" fill="none" stroke="#ff8a3a" stroke-width="2.5"/>
  </svg>`,

  // 花园：月亮 + 树
  GA: `
  <svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid meet">
    <defs><radialGradient id="gGA" cx="70%" cy="25%" r="80%">
      <stop offset="0%" stop-color="#16203a"/><stop offset="100%" stop-color="#060810"/>
    </radialGradient></defs>
    <rect width="400" height="300" fill="url(#gGA)"/>
    <circle cx="300" cy="70" r="34" fill="#e8e4cf" opacity=".9"/>
    <circle cx="288" cy="62" r="34" fill="#16203a"/>
    <line x1="0" y1="250" x2="400" y2="250" stroke="#c8a96a" stroke-width="1" opacity=".4"/>
    <line x1="110" y1="250" x2="110" y2="150" stroke="#c8a96a" stroke-width="4"/>
    <path d="M110 150 q-40 -10 -55 -40 M110 160 q40 -8 60 -42 M110 140 q-10 -40 5 -70 M110 150 q30 -30 20 -65"
          fill="none" stroke="#c8a96a" stroke-width="2"/>
    <circle cx="70" cy="160" r="3" fill="#7fae7f"/><circle cx="160" cy="150" r="3" fill="#7fae7f"/>
    <circle cx="120" cy="100" r="3" fill="#7fae7f"/>
  </svg>`,
};
