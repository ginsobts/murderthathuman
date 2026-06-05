/* ===== 引擎：加利庄园 · 晚宴疑案 ===== */
(function () {
  "use strict";

  const out = document.getElementById("output");
  const form = document.getElementById("prompt-form");
  const input = document.getElementById("prompt-input");
  const sceneArt = document.getElementById("scene-art");
  const sceneCap = document.getElementById("scene-caption");
  const fileListEl = document.getElementById("file-list");
  const fileCountEl = document.getElementById("file-count");
  const peopleListEl = document.getElementById("people-list");

  // 把真实文件名规范化成 "时间-地点-排序后的人物"，使输入顺序无关
  function canon(time, loc, people) {
    const sorted = people.slice().sort((a, b) => a - b).join("-");
    return `${time}-${loc.toUpperCase()}-${sorted}`;
  }

  // 预计算：规范键 -> 真实文件key
  const canonMap = {};
  Object.keys(CASE.files).forEach((key) => {
    const f = CASE.files[key];
    canonMap[canon(f.time, f.loc, f.people)] = key;
  });

  const state = {
    unlocked: new Set(),
    labels: {}, // 人物编号 -> 玩家自定义名字
    solved: false,
  };

  /* ---------- 输出 ---------- */
  function print(text, cls) {
    const div = document.createElement("div");
    div.className = "line " + (cls || "line-text");
    div.textContent = text;
    out.appendChild(div);
    out.scrollTop = out.scrollHeight;
  }
  function printLines(arr, cls) {
    arr.forEach((t) => {
      if (t === "") { print(" ", "line-sep"); return; }
      if (t.startsWith("──")) { print(t, "line-clue"); return; }
      print(t, cls || "line-text");
    });
  }

  /* ---------- 侧栏渲染 ---------- */
  function personName(n) {
    return state.labels[n] ? `${n}号·${state.labels[n]}` : `${n}号`;
  }
  function renderPeople() {
    peopleListEl.innerHTML = "";
    Object.keys(CASE.people).forEach((n) => {
      const li = document.createElement("li");
      li.innerHTML = `<span class="pid">${n}号</span> ` +
        (state.labels[n] ? state.labels[n] : "<span style='color:var(--dim)'>未标注</span>");
      peopleListEl.appendChild(li);
    });
  }
  function renderFiles() {
    fileListEl.innerHTML = "";
    const arr = Array.from(state.unlocked).sort();
    arr.forEach((key) => {
      const li = document.createElement("li");
      li.className = "file-li";
      li.textContent = key;
      li.title = "点击重新查看";
      li.addEventListener("click", () => openFile(key, true));
      fileListEl.appendChild(li);
    });
    fileCountEl.textContent = `(${arr.length}/${Object.keys(CASE.files).length})`;
  }

  /* ---------- 打开 / 解锁文件 ---------- */
  function showScene(loc) {
    sceneArt.innerHTML = SCENE_ART[loc] || "";
    sceneCap.textContent = `${loc} · ${CASE.locations[loc] || "未知地点"}`;
  }

  function openFile(key, replay) {
    const f = CASE.files[key];
    if (!f) return;
    showScene(f.loc);
    print(" ", "line-sep");
    print(`╔══ 打开文件：${key}  〔${CASE.locations[f.loc]} · 在场：${f.people.map(personName).join("，")}〕`, "line-file");
    printLines(f.lines);
    if (!replay) {
      state.unlocked.add(key);
      renderFiles();
      checkAllUnlocked();
    }
  }

  function checkAllUnlocked() {
    const total = Object.keys(CASE.files).length;
    if (state.unlocked.size === total && !state.solved) {
      print(" ", "line-sep");
      print("★ 你已解锁全部文件！输入  solve  给出结论。", "line-win");
    }
  }

  /* ---------- 命令处理 ---------- */
  function handleCommand(raw) {
    const text = raw.trim();
    if (!text) return;
    print(`> ${text}`, "line-echo");

    const lower = text.toLowerCase();

    if (lower === "help") return cmdHelp();
    if (lower === "list") return cmdList();
    if (lower === "clear") { out.innerHTML = ""; return; }
    if (lower === "intro") return printLines(CASE.intro, "line-sys");
    if (lower === "solve") return cmdSolve();
    if (lower.startsWith("name")) return cmdName(text);

    // 否则当作文件名猜测
    return tryFile(text);
  }

  function cmdHelp() {
    printLines([
      "【命令】",
      "  help            显示本帮助",
      "  list            列出已解锁文件",
      "  name 2 里德      给2号标注名字（例：name 2 里德医生）",
      "  intro           重看案情开场",
      "  solve           解锁全部文件后给出结论",
      "  clear           清屏",
      "",
      "【怎么玩】",
      "  文件名格式：  时间-地点-在场人物    例：02-DI-1-3-4",
      "  地点代码：EN门厅  DI餐厅  LI书房  GA花园",
      "  读转录里『谁去了哪个房间』，推断下一份文件名并输入即可解锁。",
      "  人物顺序无所谓，猜错没有惩罚。",
    ], "line-sys");
  }

  function cmdList() {
    const arr = Array.from(state.unlocked).sort();
    print(`已解锁 ${arr.length}/${Object.keys(CASE.files).length} 份：`, "line-sys");
    arr.forEach((k) => print("  • " + k, "line-file"));
  }

  function cmdName(text) {
    const m = text.match(/^name\s+(\d+)\s+(.+)$/i);
    if (!m) { print("用法： name 2 里德医生", "line-err"); return; }
    const n = m[1];
    if (!CASE.people[n]) { print(`没有 ${n} 号这个人。`, "line-err"); return; }
    state.labels[n] = m[2].trim();
    print(`已标注： ${n}号 = ${state.labels[n]}`, "line-sys");
    renderPeople();
  }

  function cmdSolve() {
    if (state.unlocked.size < Object.keys(CASE.files).length) {
      print("线索还不够，先解锁全部文件再 solve。", "line-err");
      return;
    }
    state.solved = true;
    print(" ", "line-sep");
    printLines(CASE.solution, "line-win");
  }

  function tryFile(text) {
    // 解析 时间-地点-人物...
    const m = text.match(/^(\d{1,2})-([A-Za-z]{2})-([\d-]+)$/);
    if (!m) {
      print("这不像一个文件名。格式应为  时间-地点-人物，例：02-DI-1-3-4（或输入 help）", "line-err");
      return;
    }
    const time = m[1].padStart(2, "0");
    const loc = m[2].toUpperCase();
    const people = m[3].split("-").filter((x) => x !== "").map(Number);
    const key = canon(time, loc, people);

    if (state.unlocked.has(canonMap[key])) {
      print("（这份文件你已经打开过了，重新显示如下）", "line-sys");
      openFile(canonMap[key], true);
      return;
    }
    if (canonMap[key]) {
      print("✓ 文件名正确，已解锁。", "line-win");
      openFile(canonMap[key], false);
    } else {
      print("✗ 未找到该文件。也许时间、地点或在场的人不对——再想想谁去了哪里。", "line-err");
    }
  }

  /* ---------- 启动 ---------- */
  function boot() {
    printLines(CASE.intro, "line-sys");
    CASE.startUnlocked.forEach((k) => {
      state.unlocked.add(k);
    });
    renderFiles();
    renderPeople();
    // 自动展示起始文件
    CASE.startUnlocked.forEach((k) => openFile(k, true));
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = input.value;
    input.value = "";
    handleCommand(v);
  });

  boot();
})();
