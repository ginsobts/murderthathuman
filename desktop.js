/* =====================================================================
 *  desktop.js  —— 桌面引擎 + 可视化编辑模式
 *
 *  普通玩家模式：双击图标打开窗口、上锁文件要密码。
 *  编辑模式（右上角“✏️ 编辑模式”）：
 *    - 拖动桌面图标摆位置（写入 x/y）
 *    - 单击图标 -> 右侧面板改名称/内容/图片/上锁
 *    - ＋文本 / ＋图片 / ＋文件夹 新建（可加进打开的文件夹）
 *    - 导出配置 -> 生成新的 desktop-data.js 文本，复制粘贴回文件即可
 *
 *  你日常仍然只需要关心 desktop-data.js，这里基本不用动。
 * ===================================================================== */
(function () {
  "use strict";

  const ICON_GLYPH = { txt: "📄", img: "🖼️", folder: "📁", notes: "📝", tuner: "🎵" };
  const ICON_IMG = {
    txt: "assets/icon-txt.png",
    img: "assets/icon-img.png",
    folder: "assets/icon-folder.png",
  };

  // ---- 人物备注（玩家给代号写真名）----
  const NOTES_KEY = "weave_os_notes_v1";
  let annotations = {}; // code -> 玩家写的名字
  function loadNotes() {
    try { const r = localStorage.getItem(NOTES_KEY); if (r) annotations = JSON.parse(r) || {}; } catch (e) {}
  }
  function saveNotes() {
    try { localStorage.setItem(NOTES_KEY, JSON.stringify(annotations)); } catch (e) {}
  }
  function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  function applyAnnotations(text) {
    let out = String(text == null ? "" : text);
    // 长代号先替换，避免 VOX-1 抢先吃掉 VOX-12 这类前缀
    Object.keys(annotations)
      .sort((a, b) => b.length - a.length)
      .forEach((code) => {
        const name = (annotations[code] || "").trim();
        if (!name) return;
        out = out.replace(new RegExp(escapeRe(code), "g"), name);
      });
    return out;
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // 密码比对前的归一化：去掉空格与常见标点，让“别把我留下来。”这类口令更宽容。
  function normPass(s) {
    return String(s == null ? "" : s)
      .trim()
      .toUpperCase()
      .replace(/[\s，。、！？,.!?；;：:'"‘’“”「」『』（）()【】\[\]\-—_~·]/g, "");
  }

  function rosterSpeakerTokens() {
    const tokens = [];
    (DESKTOP.roster || []).forEach((r) => {
      if (!r) return;
      if (r.code) tokens.push(r.code);
      if (r.machineId) tokens.push(r.machineId);
    });
    tokens.push("未知声纹", "声纹无法识别", "识别失败");
    return tokens.filter(Boolean);
  }

  // 行首是某个声纹代号 / 机器编号 + “：” 时，把说话人名字（含冒号）标成浅蓝色。
  // 只认花名册里的代号，避免把“自动输液剂量校验：”这种设备读数也染色。
  function speakerRegex() {
    const codes = rosterSpeakerTokens()
      .sort((a, b) => b.length - a.length)
      .map(escapeRe);
    if (!codes.length) return null;
    return new RegExp("^(\\s*)(" + codes.join("|") + ")：([\\s\\S]*)$");
  }

  function renderTxt(div, raw) {
    const re = speakerRegex();
    const html = String(raw == null ? "" : raw)
      .split("\n")
      .map((line) => {
        const m = re && line.match(re);
        if (m) {
          return (
            escapeHtml(m[1]) +
            '<span class="speaker">' +
            escapeHtml(applyAnnotations(m[2])) +
            "：</span>" +
            escapeHtml(applyAnnotations(m[3]))
          );
        }
        return escapeHtml(applyAnnotations(line));
      })
      .join("\n");
    div.innerHTML = html;
  }

  // ---- 玩家给日志改名（标记推断出的时间/含义）----
  const FILENAME_KEY = "weave_os_filenames_v1";
  let playerNames = {}; // __id -> 玩家起的名字
  function loadPlayerNames() {
    try { const r = localStorage.getItem(FILENAME_KEY); if (r) playerNames = JSON.parse(r) || {}; } catch (e) {}
  }
  function savePlayerNames() {
    try { localStorage.setItem(FILENAME_KEY, JSON.stringify(playerNames)); } catch (e) {}
  }
  function displayName(node) {
    const p = playerNames[node.__id];
    return (p != null && p !== "") ? p : (node.name || "(未命名)");
  }

  // ---- 记录玩家“看过”了哪些记录（用于按角色检索对话）----
  const VIEWED_KEY = "weave_os_viewed_v1";
  const nodeById = {};          // __id -> node（reindex 时填充）
  const nodeBySlot = {};        // slot -> node（用于逐层揭示）
  let viewed = {};              // __id -> true（看过的记录）
  function loadViewed() {
    try { const r = localStorage.getItem(VIEWED_KEY); if (r) viewed = JSON.parse(r) || {}; } catch (e) {}
  }
  function saveViewed() {
    try { localStorage.setItem(VIEWED_KEY, JSON.stringify(viewed)); } catch (e) {}
  }
  function markViewed(node) {
    if (viewed[node.__id]) return;
    viewed[node.__id] = true;
    saveViewed();
    renderDesktop();          // 可能有新一层记录该出现了
    refreshOpenFolders();
  }

  // ---- 玩家用“调律台”还原过的【单个文件】：被还原的 revealByTune 文件会出现 ----
  // 每个隐藏文件单独配置自己的还原条件(node.memory)，不再和所在文件夹绑定。
  const TUNED_KEY = "weave_os_tuned_v2";
  let tunedNodes = {};          // 文件 __id -> true
  function loadTuned() {
    try { const r = localStorage.getItem(TUNED_KEY); if (r) tunedNodes = JSON.parse(r) || {}; } catch (e) {}
  }
  function saveTuned() {
    try { localStorage.setItem(TUNED_KEY, JSON.stringify(tunedNodes)); } catch (e) {}
  }

  const desktop = document.getElementById("desktop");
  const iconLayer = document.getElementById("icon-layer");
  const inspector = document.getElementById("inspector");
  const addTargetTag = document.getElementById("add-target");

  const unlocked = {};        // __id -> true
  const openWindows = {};     // __id -> { win, node }
  let zCounter = 100;
  let idSeq = 1;

  let editMode = false;
  let selected = null;        // 当前选中的节点
  let addContainer = DESKTOP.items; // 新建时放进哪个数组
  let addTargetName = "桌面";

  // ---- 自动保存草稿（localStorage）----
  const DRAFT_KEY = "weave_os_draft_v1";
  let ORIGINAL_FILE_SIG = "";   // 启动时文件版本的指纹，用于判断文件是否被手改过
  let saveTimer = null;

  function cleanClone(v) {
    if (Array.isArray(v)) return v.map(cleanClone);
    if (v && typeof v === "object") {
      const o = {};
      Object.keys(v).forEach((k) => { if (k.indexOf("__") !== 0) o[k] = cleanClone(v[k]); });
      return o;
    }
    return v;
  }

  function saveDraft() {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        baseSig: ORIGINAL_FILE_SIG,
        data: cleanClone(DESKTOP),
        at: Date.now(),
      }));
      updateDraftStatus(true);
    } catch (e) { /* 隐私模式等情况，静默失败 */ }
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDraft, 350);
  }

  function loadDraft() {
    let raw;
    try { raw = localStorage.getItem(DRAFT_KEY); } catch (e) { return false; }
    if (!raw) return false;
    let saved;
    try { saved = JSON.parse(raw); } catch (e) { return false; }
    // 文件被手动改过（指纹对不上）-> 丢弃旧草稿，以文件为准
    if (!saved || saved.baseSig !== ORIGINAL_FILE_SIG) {
      try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
      return false;
    }
    Object.keys(saved.data).forEach((k) => { DESKTOP[k] = saved.data[k]; });
    return true;
  }

  function updateDraftStatus(justSaved) {
    const el = document.getElementById("draft-status");
    if (!el) return;
    if (justSaved) {
      const t = new Date();
      const hh = String(t.getHours()).padStart(2, "0");
      const mm = String(t.getMinutes()).padStart(2, "0");
      el.textContent = "● 草稿已自动保存 " + hh + ":" + mm;
      el.classList.add("saved");
    } else {
      el.textContent = "自动保存：开";
      el.classList.remove("saved");
    }
  }

  function resetToFile() {
    if (!confirm("放弃所有未导出的改动，回到 desktop-data.js 文件版本？")) return;
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
    location.reload();
  }

  // ---- 给每个节点分配稳定 id，并记录它所在的数组(便于删除) ----
  function reindex(items, parentFolder) {
    items.forEach((node) => {
      if (node.__id == null) node.__id = "n" + idSeq++;
      nodeById[node.__id] = node;
      if (node.slot) nodeBySlot[node.slot] = node;
      node.__parentArray = items;
      node.__parentFolder = parentFolder || null;
      if (node.type === "folder") {
        node.children = node.children || [];
        reindex(node.children, node);
      }
    });
  }

  // 逐层揭示：带 hiddenUntil 的节点，要等到对应 slot 的记录被“看过”才出现
  // 在“游玩模式”下这个节点是否应隐藏（不看 editMode）
  function hiddenInPlay(node) {
    // 需要用“调律台”单独还原这个文件后，它才出现
    if (node.revealByTune) {
      if (!tunedNodes[node.__id]) return true;
    }
    if (node.hiddenUntil) {
      const pre = nodeBySlot[node.hiddenUntil];
      if (!(pre && viewed[pre.__id])) return true;
    }
    return false;
  }
  function isHidden(node) {
    if (editMode) return false;            // 编辑模式下全部可见（半透明显示，方便作者改）
    return hiddenInPlay(node);
  }

  // 这个隐藏文件的“还原条件”：优先用文件自己的 memory；
  // 没单独设置时，回退到所在文件夹的 memory（向后兼容旧数据）。
  function tuneConditionOf(node) {
    if (node.memory && Array.isArray(node.memory.cast) && node.memory.cast.length) return node.memory;
    const f = node.__parentFolder;
    if (f && f.memory && Array.isArray(f.memory.cast) && f.memory.cast.length) return f.memory;
    return null;
  }

  // 文件夹里所有“可被调律台还原”的隐藏文件
  function tuneTargetsIn(folder) {
    if (!folder || folder.type !== "folder" || !Array.isArray(folder.children)) return [];
    return folder.children.filter((c) => c && c.revealByTune);
  }
  // 文件夹是否有“可被调律台还原”的隐藏内容
  function folderHasTuneTarget(node) {
    return tuneTargetsIn(node).some((c) => !!tuneConditionOf(c));
  }

  // ---- 系统信息 ----
  document.getElementById("system-name").textContent = DESKTOP.systemName || "";
  document.getElementById("boot-line").textContent = DESKTOP.bootLine || "";

  /* ===================================================================
   *  渲染
   * =================================================================== */
  function renderDesktop() {
    iconLayer.innerHTML = "";
    let autoIndex = 0;
    DESKTOP.items.forEach((node) => {
      if (isHidden(node)) return;          // 还没解锁到这一层，先不显示
      // 没有坐标的，自动排成一列一列的网格
      if (typeof node.x !== "number" || typeof node.y !== "number") {
        const col = Math.floor(autoIndex / 6);
        const row = autoIndex % 6;
        node.x = 24 + col * 104;
        node.y = 24 + row * 96;
      }
      autoIndex++;
      const el = makeIcon(node, true);
      el.style.left = node.x + "px";
      el.style.top = node.y + "px";
      iconLayer.appendChild(el);
    });
  }

  function refreshOpenFolders() {
    Object.keys(openWindows).forEach((id) => {
      const rec = openWindows[id];
      if (rec.node && rec.node.type === "folder") {
        const body = rec.win.querySelector(".folder-body");
        if (body) fillFolderBody(body, rec.node);
      }
    });
  }

  function renderAll() {
    reindex(DESKTOP.items);
    renderDesktop();
    refreshOpenFolders();
  }

  // ---- 单个图标 ----
  function makeIcon(node, isRoot) {
    const el = document.createElement("div");
    el.className = "icon";
    if (selected === node) el.classList.add("selected");
    // 编辑模式下，游玩时会被隐藏的文件半透明显示，提示作者“这个玩家暂时看不到”
    if (editMode && hiddenInPlay(node)) el.classList.add("hidden-stub");
    node.__iconEl = el;

    let glyph;
    if (ICON_IMG[node.type]) {
      glyph = document.createElement("img");
      glyph.className = "glyph";
      glyph.src = ICON_IMG[node.type];
      glyph.alt = node.type;
      glyph.draggable = false;
    } else {
      // notes 等没有专属图片的，用 emoji 占位
      glyph = document.createElement("span");
      glyph.className = "glyph-emoji";
      glyph.textContent = ICON_GLYPH[node.type] || "❓";
    }

    const label = document.createElement("span");
    label.className = "label";
    label.textContent = displayName(node);

    el.appendChild(glyph);
    el.appendChild(label);

    if (node.locked) {
      const badge = document.createElement("span");
      badge.className = "lock-badge";
      badge.textContent = "🔒";
      el.appendChild(badge);
      if (unlocked[node.__id]) el.classList.add("unlocked");
    }

    // 事件：编辑模式=选中(根图标可拖)，普通模式=点选/双击打开
    if (isRoot && editMode) {
      attachDrag(el, node);
    }
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      if (editMode) selectNode(node);
      else highlightOnly(el);
    });
    el.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      openItem(node);
    });

    return el;
  }

  function highlightOnly(el) {
    document.querySelectorAll(".icon.selected").forEach((n) => n.classList.remove("selected"));
    el.classList.add("selected");
  }

  /* ===================================================================
   *  打开节点（txt / img / folder / 上锁）
   * =================================================================== */
  function openItem(node) {
    if (openWindows[node.__id]) { focusWindow(openWindows[node.__id].win, node); return; }
    if (node.locked && !unlocked[node.__id]) { openLockDialog(node); return; }

    if (node.type === "notes") { openNotesApp(node); return; }
    if (node.type === "tuner") { openTunerApp(node); return; }

    if (node.type === "txt" || node.type === "img") markViewed(node);

    let body;
    if (node.type === "txt") body = buildTxtBody(node);
    else if (node.type === "img") body = buildImgBody(node);
    else if (node.type === "folder") body = buildFolderBody(node);
    else { body = document.createElement("div"); body.textContent = "未知类型: " + node.type; }
    createWindow(node, body);
  }

  function rawText(node) {
    return Array.isArray(node.content) ? node.content.join("\n") : String(node.content || "");
  }

  function buildTxtBody(node) {
    const div = document.createElement("div");
    div.className = "txt-body";
    renderTxt(div, rawText(node));
    return div;
  }

  function buildImgBody(node) {
    const div = document.createElement("div");
    div.className = "img-body";
    const img = document.createElement("img");
    img.src = node.src || "";
    img.alt = node.name || "";
    img.draggable = false;
    div.appendChild(img);
    if (node.caption) {
      const cap = document.createElement("div");
      cap.className = "caption";
      cap.textContent = applyAnnotations(node.caption);
      div.appendChild(cap);
    }
    return div;
  }

  function buildFolderBody(node) {
    const div = document.createElement("div");
    div.className = "folder-body";
    fillFolderBody(div, node);
    return div;
  }

  function fillFolderBody(div, node) {
    div.innerHTML = "";
    const children = node.children || [];
    if (children.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "（空文件夹）";
      div.appendChild(empty);
    } else {
      children.forEach((child) => { if (!isHidden(child)) div.appendChild(makeIcon(child, false)); });
    }
  }

  /* ===================================================================
   *  人物备注程序
   * =================================================================== */
  function firstHeaderLine(node) {
    const lines = Array.isArray(node.content) ? node.content : String(node.content || "").split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] && lines[i].trim()) return lines[i].trim();
    }
    return "";
  }

  // 玩家“看过的、且出现了某代号”的对话记录
  function viewedRecordsWith(code) {
    const out = [];
    Object.keys(viewed).forEach((id) => {
      const n = nodeById[id];
      if (!n || n.type !== "txt") return;
      if (rawText(n).indexOf(code) !== -1) out.push(n);
    });
    return out;
  }

  function openNotesApp(node) {
    const wrap = document.createElement("div");
    wrap.className = "notes-app";

    const intro = document.createElement("div");
    intro.className = "notes-intro";
    intro.textContent = node.appIntro ||
      "为每个声纹写下你推断出的真名（会自动替换全文）。点声纹编号，可查看你看过的、ta 参与过的对话。";
    wrap.appendChild(intro);

    const roster = DESKTOP.roster || [];
    roster.forEach((r) => {
      const row = document.createElement("div");
      row.className = "notes-row";

      const left = document.createElement("div");
      left.className = "notes-code";
      const codeEl = document.createElement("div");
      codeEl.className = "code";
      codeEl.textContent = r.code;
      const caret = document.createElement("span");
      caret.className = "code-caret";
      left.appendChild(codeEl);
      left.appendChild(caret);

      const inp = document.createElement("input");
      inp.type = "text";
      inp.placeholder = "写下真名…";
      inp.value = annotations[r.code] || "";

      const list = document.createElement("div");
      list.className = "notes-dialogs";
      list.style.display = "none";

      function renderDialogList() {
        list.innerHTML = "";
        const recs = viewedRecordsWith(r.code);
        const count = document.createElement("div");
        count.className = "notes-dialogs-count";
        count.textContent = recs.length
          ? "你看过的、ta 参与过的对话（" + recs.length + "）"
          : "你还没看过 ta 参与的任何对话。";
        list.appendChild(count);
        recs.forEach((n) => {
          const item = document.createElement("div");
          item.className = "notes-dialog-item";
          const t = document.createElement("div");
          t.className = "ndi-title";
          t.textContent = displayName(n);
          const s = document.createElement("div");
          s.className = "ndi-sub";
          s.textContent = firstHeaderLine(n);
          item.appendChild(t);
          item.appendChild(s);
          item.addEventListener("click", () => openItem(n));
          list.appendChild(item);
        });
      }

      inp.addEventListener("input", () => {
        annotations[r.code] = inp.value;
        saveNotes();
        refreshAnnotated();
        if (list.style.display !== "none") renderDialogList();
      });

      let open = false;
      function toggle() {
        open = !open;
        row.classList.toggle("expanded", open);
        list.style.display = open ? "block" : "none";
        if (open) renderDialogList();
      }
      codeEl.addEventListener("click", toggle);
      caret.addEventListener("click", toggle);

      row.appendChild(left);
      row.appendChild(inp);
      wrap.appendChild(row);
      wrap.appendChild(list);
    });

    createWindow(node, wrap, { notes: true });
  }

  // 备注变化后，刷新所有已打开的文本/图片窗口里的代号显示
  function refreshAnnotated() {
    Object.keys(openWindows).forEach((id) => {
      const rec = openWindows[id];
      const n = rec.node;
      if (!n) return;
      if (n.type === "txt") {
        const b = rec.win.querySelector(".txt-body");
        if (b) renderTxt(b, rawText(n));
      } else if (n.type === "img" && n.caption) {
        const c = rec.win.querySelector(".caption");
        if (c) c.textContent = applyAnnotations(n.caption);
      }
      // 锁对话框里标了 data-anno 的元素（排序标签 / 认人按钮 / 档案锁下拉项）也跟着改名
      rec.win.querySelectorAll("[data-anno]").forEach((el) => {
        el.textContent = applyAnnotations(el.dataset.anno);
      });
    });
  }

  /* ===================================================================
   *  上锁密码框
   * =================================================================== */
  function openLockDialog(node) {
    if (node.lockType === "order") { openOrderLock(node); return; }
    if (node.lockType === "choice") { openChoiceLock(node); return; }
    if (node.lockType === "dossier") { openDossierLock(node); return; }
    if (node.lockType === "memory") { openMemoryLock(node); return; }
    // 纯数字密码 → 键盘面板
    if (/^[0-9]+$/.test(normPass(node.password))) { openNumericLock(node); return; }

    const wrap = document.createElement("div");
    wrap.className = "lock-body";
    wrap.innerHTML =
      '<div class="lock-icon">🔒</div>' +
      '<div class="hint"></div>';
    wrap.querySelector(".hint").textContent = node.lockPrompt || "此文件已加密。请输入密码。";

    const inp = document.createElement("input");
    inp.type = "text";
    inp.placeholder = "输入密码…";
    const btn = document.createElement("button");
    btn.className = "lock-btn";
    btn.textContent = "解锁";
    const err = document.createElement("div");
    err.className = "lock-error";

    wrap.appendChild(inp);
    wrap.appendChild(document.createElement("br"));
    wrap.appendChild(btn);
    wrap.appendChild(err);

    const win = createWindow(node, wrap, { lockDialog: true });
    setTimeout(() => inp.focus(), 30);

    function tryUnlock() {
      if (normPass(inp.value) === normPass(node.password)) {
        doUnlock(node, win);
      } else {
        err.textContent = "密码错误。";
        inp.select();
      }
    }
    btn.addEventListener("click", tryUnlock);
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") tryUnlock(); });
  }

  /* ===== 数字密码键盘面板：显示位数 + 鼠标小键盘 + 键盘输入 ===== */
  function openNumericLock(node) {
    const answer = normPass(node.password);
    const len = answer.length;
    let entered = "";

    const wrap = document.createElement("div");
    wrap.className = "lock-body numpad-lock";
    wrap.innerHTML =
      '<div class="lock-icon">🔒</div>' +
      '<div class="hint"></div>';
    wrap.querySelector(".hint").textContent =
      node.lockPrompt || ("请输入 " + len + " 位数字密码");

    // 位数显示框
    const dots = document.createElement("div");
    dots.className = "numpad-dots";
    const cells = [];
    for (let i = 0; i < len; i++) {
      const c = document.createElement("span");
      c.className = "numpad-cell";
      dots.appendChild(c);
      cells.push(c);
    }
    wrap.appendChild(dots);

    const err = document.createElement("div");
    err.className = "lock-error";

    function refresh() {
      cells.forEach((c, i) => {
        c.textContent = entered[i] || "";
        c.classList.toggle("filled", i < entered.length);
      });
    }
    function input(d) {
      if (entered.length >= len) return;
      entered += d;
      err.textContent = "";
      refresh();
      if (entered.length === len) setTimeout(verify, 120);
    }
    function back() { entered = entered.slice(0, -1); err.textContent = ""; refresh(); }
    function verify() {
      if (entered === answer) doUnlock(node, win);
      else { err.textContent = "密码错误。"; entered = ""; refresh(); }
    }

    // 小键盘
    const pad = document.createElement("div");
    pad.className = "numpad-grid";
    const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "back", "0", "ok"];
    keys.forEach((k) => {
      const b = document.createElement("button");
      b.className = "numpad-key";
      if (k === "back") { b.textContent = "⌫"; b.classList.add("numpad-fn"); b.addEventListener("click", back); }
      else if (k === "ok") { b.textContent = "✓"; b.classList.add("numpad-fn"); b.addEventListener("click", verify); }
      else { b.textContent = k; b.addEventListener("click", () => input(k)); }
      pad.appendChild(b);
    });
    wrap.appendChild(pad);
    wrap.appendChild(err);

    const win = createWindow(node, wrap, { lockDialog: true });

    // 键盘输入
    function onKey(e) {
      if (!document.body.contains(win)) { document.removeEventListener("keydown", onKey); return; }
      if (e.key >= "0" && e.key <= "9") { input(e.key); e.preventDefault(); }
      else if (e.key === "Backspace") { back(); e.preventDefault(); }
      else if (e.key === "Enter") { verify(); e.preventDefault(); }
    }
    document.addEventListener("keydown", onKey);
    refresh();
  }

  function doUnlock(node, win) {
    unlocked[node.__id] = true;
    if (node.__iconEl) node.__iconEl.classList.add("unlocked");
    win.remove();
    delete openWindows[node.__id];
    openItem(node);
  }

  /* ===== 排序锁：把若干人/物按正确顺序排好才能解锁 ===== */
  function openOrderLock(node) {
    const wrap = document.createElement("div");
    wrap.className = "lock-body order-lock";

    const icon = document.createElement("div");
    icon.className = "lock-icon";
    icon.textContent = "🔒";
    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent = node.orderPrompt || "把下面的项目按正确顺序排好。";
    wrap.appendChild(icon);
    wrap.appendChild(hint);

    // 当前顺序（用代号数组表示），初始用作者给的 orderItems
    let current = (node.orderItems || []).slice();

    const listEl = document.createElement("div");
    listEl.className = "order-list";
    wrap.appendChild(listEl);

    function render() {
      listEl.innerHTML = "";
      current.forEach((code, i) => {
        const row = document.createElement("div");
        row.className = "order-row";

        const rank = document.createElement("span");
        rank.className = "order-rank";
        rank.textContent = (i + 1) + ".";

        const label = document.createElement("span");
        label.className = "order-label";
        label.dataset.anno = code;
        label.textContent = applyAnnotations(code);

        const ups = document.createElement("div");
        ups.className = "order-arrows";
        const up = document.createElement("button");
        up.className = "order-arrow";
        up.textContent = "▲";
        up.disabled = i === 0;
        up.addEventListener("click", () => { swap(i, i - 1); });
        const down = document.createElement("button");
        down.className = "order-arrow";
        down.textContent = "▼";
        down.disabled = i === current.length - 1;
        down.addEventListener("click", () => { swap(i, i + 1); });
        ups.appendChild(up);
        ups.appendChild(down);

        row.appendChild(rank);
        row.appendChild(label);
        row.appendChild(ups);
        listEl.appendChild(row);
      });
    }
    function swap(a, b) {
      const t = current[a]; current[a] = current[b]; current[b] = t;
      err.textContent = "";
      render();
    }
    render();

    const btn = document.createElement("button");
    btn.className = "lock-btn";
    btn.textContent = "确认顺序";
    const err = document.createElement("div");
    err.className = "lock-error";
    wrap.appendChild(btn);
    wrap.appendChild(err);

    const win = createWindow(node, wrap, { lockDialog: true });

    btn.addEventListener("click", () => {
      const ans = node.orderAnswer || [];
      const ok = current.length === ans.length &&
        current.every((c, i) => c === ans[i]);
      if (ok) doUnlock(node, win);
      else { err.textContent = "顺序不对。再想想 ta 是怎么看这些人的。"; }
    });
  }

  /* ===== 认人锁：从若干声纹里选出正确的那个 ===== */
  function openChoiceLock(node) {
    const wrap = document.createElement("div");
    wrap.className = "lock-body choice-lock";

    const icon = document.createElement("div");
    icon.className = "lock-icon";
    icon.textContent = "🔒";
    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent = node.choicePrompt || "选出正确的那一个。";
    wrap.appendChild(icon);
    wrap.appendChild(hint);

    const err = document.createElement("div");
    err.className = "lock-error";

    (node.choiceOptions || []).forEach((code) => {
      const b = document.createElement("button");
      b.className = "choice-opt";
      b.dataset.anno = code;
      b.textContent = applyAnnotations(code);
      b.addEventListener("click", () => {
        if (code === node.choiceAnswer) doUnlock(node, win);
        else { err.textContent = "不是 ta。再想想，现场留下的是谁。"; }
      });
      wrap.appendChild(b);
    });

    wrap.appendChild(err);
    const win = createWindow(node, wrap, { lockDialog: true });
  }

  /* ===== 档案锁：给每个仿生体代号配上声纹，并按制造先后排序 ===== */
  function openDossierLock(node) {
    const wrap = document.createElement("div");
    wrap.className = "lock-body order-lock dossier-lock";

    const icon = document.createElement("div");
    icon.className = "lock-icon";
    icon.textContent = "🔒";
    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent = node.dossierPrompt || "把每个代号对上声纹，并按制造先后排好。";
    wrap.appendChild(icon);
    wrap.appendChild(hint);

    const ans = node.dossierAnswer || [];
    const voiceOpts = node.dossierVoiceOptions ||
      (DESKTOP.roster || []).map((r) => r && r.code).filter(Boolean);

    // 初始：代号顺序打乱（避免一开始就摆成答案）
    let codes = ans.map((a) => a.code);
    if (codes.length > 1) {
      for (let i = codes.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = codes[i]; codes[i] = codes[j]; codes[j] = t;
      }
      const sameAsAnswer = codes.every((c, i) => c === ans[i].code);
      if (sameAsAnswer) codes.reverse();
    }
    const chosen = {}; // code -> 选中的声纹

    const listEl = document.createElement("div");
    listEl.className = "order-list";
    wrap.appendChild(listEl);

    function render() {
      listEl.innerHTML = "";
      codes.forEach((code, i) => {
        const row = document.createElement("div");
        row.className = "order-row dossier-row";

        const rank = document.createElement("span");
        rank.className = "order-rank";
        rank.textContent = (i + 1) + ".";

        const label = document.createElement("span");
        label.className = "order-label dossier-code";
        label.textContent = code;

        const sel = document.createElement("select");
        sel.className = "dossier-select";
        const ph = document.createElement("option");
        ph.value = ""; ph.textContent = "选声纹…";
        sel.appendChild(ph);
        voiceOpts.forEach((v) => {
          const o = document.createElement("option");
          o.value = v;
          o.dataset.anno = v;
          o.textContent = applyAnnotations(v);
          sel.appendChild(o);
        });
        sel.value = chosen[code] || "";
        sel.addEventListener("change", () => { chosen[code] = sel.value; err.textContent = ""; });

        const ups = document.createElement("div");
        ups.className = "order-arrows";
        const up = document.createElement("button");
        up.className = "order-arrow";
        up.textContent = "▲";
        up.disabled = i === 0;
        up.addEventListener("click", () => swap(i, i - 1));
        const down = document.createElement("button");
        down.className = "order-arrow";
        down.textContent = "▼";
        down.disabled = i === codes.length - 1;
        down.addEventListener("click", () => swap(i, i + 1));
        ups.appendChild(up);
        ups.appendChild(down);

        row.appendChild(rank);
        row.appendChild(label);
        row.appendChild(sel);
        row.appendChild(ups);
        listEl.appendChild(row);
      });
    }
    function swap(a, b) {
      const t = codes[a]; codes[a] = codes[b]; codes[b] = t;
      err.textContent = "";
      render();
    }
    render();

    const btn = document.createElement("button");
    btn.className = "lock-btn";
    btn.textContent = "确认档案";
    const err = document.createElement("div");
    err.className = "lock-error";
    wrap.appendChild(btn);
    wrap.appendChild(err);

    const win = createWindow(node, wrap, { lockDialog: true });

    btn.addEventListener("click", () => {
      if (codes.some((c) => !chosen[c])) {
        err.textContent = "还有代号没认。每个代号都要指认一个声纹。";
        return;
      }
      const ok = codes.length === ans.length &&
        codes.every((c, i) => c === ans[i].code && chosen[c] === ans[i].voice);
      if (ok) doUnlock(node, win);
      else err.textContent = "对不上。谁是谁、谁先被造出来——再翻翻深处的档案。";
    });
  }

  /* ===================================================================
   *  记忆调律台（音乐锁）
   *  织用音乐编码记忆：在场每个人 = 一件乐器，音高 = 当时的情绪。
   *  玩家靠剧情推断“谁在场 + 各自什么情绪”，点亮乐器、把情绪滑块调到位，
   *  再点“还原”。对了就回放对话；错了只说“记忆依旧模糊”，不给方向提示——
   *  所以唯一的解法是把剧情读懂。
   * =================================================================== */
  const INSTRUMENT_LABEL = {
    violin: "小提琴", cello: "大提琴", viola: "中提琴", bassoon: "巴松管",
    trumpet: "小号", flute: "长笛", clarinet: "单簧管", oboe: "双簧管",
    harp: "竖琴", piano: "钢琴", marimba: "马林巴", glass: "玻璃琴",
    french_horn: "圆号",
  };
  // 滑块 0~1 ＝ 心率：越往上越快，最底＝0（已无心跳，静默）
  const MAX_BPM = 160;
  function valueToBpm(v) { return Math.round(v * MAX_BPM); }
  function hrText(v) { return "♥ " + valueToBpm(v); }

  function instrumentOf(code) {
    const r = (DESKTOP.roster || []).find((x) => x && x.code === code);
    return (r && r.instrument) || "piano";
  }

  // ---- WebAudio：懒加载采样，按情绪变调播放（声音只是氛围，不充当答案提示）----
  let audioCtx = null;
  let audioMaster = null; // 主音量 → 压限器 → 输出
  const sampleBuffers = {};
  function getAudioCtx() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (e) { audioCtx = null; }
      if (audioCtx) {
        audioMaster = audioCtx.createGain();
        audioMaster.gain.value = 2.6; // 整体调大
        const comp = audioCtx.createDynamicsCompressor(); // 防止叠加破音
        try {
          comp.threshold.value = -10;
          comp.ratio.value = 12;
          comp.attack.value = 0.003;
          comp.release.value = 0.25;
        } catch (e) {}
        audioMaster.connect(comp);
        comp.connect(audioCtx.destination);
      }
    }
    if (audioCtx && audioCtx.state === "suspended") { try { audioCtx.resume(); } catch (e) {} }
    return audioCtx;
  }
  function sampleUrl(inst) {
    const inj = window.WEAVE_SAMPLES;
    if (inj && inj[inst]) return inj[inst];
    return "assets/instruments/" + inst + ".mp3?v=3";
  }
  function loadSample(inst) {
    if (sampleBuffers[inst]) return Promise.resolve(sampleBuffers[inst]);
    const ctx = getAudioCtx();
    if (!ctx) return Promise.resolve(null);
    return fetch(sampleUrl(inst))
      .then((r) => r.arrayBuffer())
      .then((arr) => new Promise((res, rej) => ctx.decodeAudioData(arr, res, rej)))
      .then((buf) => { sampleBuffers[inst] = buf; return buf; })
      .catch(() => null);
  }
  // 心率 = 一记单音心跳的快慢。每件乐器只用它最具代表性的那一个音，
  // 反复敲出来当“心跳”：心率越快，敲击越密；心率为 0 则静默（人已不在跳动）。
  const HR_SILENT = 18; // 低于此 BPM 视作没有心跳 → 静默
  // 奏一记心跳（单音），返回到下一记的间隔秒数（供循环排程）；静默返回 0
  function playInstrument(inst, value) {
    const ctx = getAudioCtx();
    if (!ctx) return 0;
    const bpm = valueToBpm(value);
    if (bpm < HR_SILENT) return 0; // 心率 0/极低 → 平线静默
    const step = 60 / bpm;          // 每记心跳的间隔
    const noteLen = Math.min(step * 0.7, 0.45);
    const peak = 0.6 + value * 0.3;
    loadSample(inst).then((buf) => {
      if (!buf) return;
      const t = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = buf; // 采样本身就是该乐器的代表音高，原速播放
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.09, noteLen));
      src.connect(g); g.connect(audioMaster || ctx.destination);
      src.start(t); src.stop(t + noteLen + 0.05);
    });
    return step;
  }

  // 校验玩家在“推子台”上摆出的 active 是否还原了某段记忆 mem
  function memoryMatches(active, mem) {
    const cast = (mem && mem.cast) || [];
    const tuning = (mem && mem.tuning) || {};
    const allCodes = (DESKTOP.roster || []).map((r) => r && r.code).filter(Boolean);
    const presentCount = allCodes.filter((c) => active[c] && active[c].present).length;
    const sameCast = presentCount === cast.length &&
      cast.every((c) => active[c] && active[c].present);
    if (!sameCast) return { ok: false, reason: "cast" };
    const allTuned = cast.every((c) => {
      const t = tuning[c] || {};
      const target = t.value != null ? t.value : 0.5;
      const tol = t.tol != null ? t.tol : 0.1;
      return Math.abs(((active[c] && active[c].value) || 0) - target) <= tol;
    });
    return { ok: allTuned, reason: allTuned ? "" : "tune" };
  }

  // 复用的“推子台”：六根竖推子（在场勾选 + 心率滑块 + 循环试听）。
  // 记忆锁和调律台 App 都用它。onChange 在玩家有任何改动时回调（用来清提示）。
  function buildMemoryFaders(onChange) {
    const allCodes = (DESKTOP.roster || []).map((r) => r && r.code).filter(Boolean);
    const active = {};
    allCodes.forEach((code) => { active[code] = { value: 0.5, present: false }; });

    const loops = {}; // code -> timer id
    function loopCycle(code) {
      if (!active[code] || !active[code].present) return;
      const dur = playInstrument(instrumentOf(code), active[code].value); // 0 = 静默
      const cycleMs = dur > 0 ? dur * 1000 + 25 : 700; // 平稳脉冲
      loops[code] = setTimeout(() => loopCycle(code), cycleMs);
    }
    function startLoop(code) { stopLoop(code); loopCycle(code); }
    function stopLoop(code) { if (loops[code]) { clearTimeout(loops[code]); delete loops[code]; } }
    function stopAllLoops() { Object.keys(loops).forEach(stopLoop); }

    const fadersWrap = document.createElement("div");
    fadersWrap.className = "mem-faders";

    allCodes.forEach((code) => {
      const inst = instrumentOf(code);
      const col = document.createElement("div");
      col.className = "mem-fader";

      const emo = document.createElement("div");
      emo.className = "mem-emotion mem-hr";
      emo.textContent = hrText(active[code].value);

      const slider = document.createElement("input");
      slider.type = "range";
      slider.className = "mem-slider";
      slider.min = "0"; slider.max = "100"; slider.step = "1";
      slider.setAttribute("orient", "vertical"); // Firefox 竖向
      slider.value = String(Math.round(active[code].value * 100));
      slider.addEventListener("input", () => {
        const v = Number(slider.value) / 100;
        active[code].value = v;
        emo.textContent = hrText(v);
        if (onChange) onChange();
      });
      // 没勾在场时，拖动松手给一次试听；勾了在场则靠循环播放，不再叠加一次性
      slider.addEventListener("change", () => {
        if (!active[code].present) playInstrument(inst, active[code].value);
      });

      // 勾选框 ＝ 选“这个人当时在场”，并循环播放其旋律
      const presentWrap = document.createElement("label");
      presentWrap.className = "mem-present";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      const cbtxt = document.createElement("span");
      cbtxt.textContent = "在场";
      cb.addEventListener("change", () => {
        active[code].present = cb.checked;
        col.classList.toggle("on", cb.checked);
        if (onChange) onChange();
        if (cb.checked) startLoop(code); else stopLoop(code);
      });
      presentWrap.appendChild(cb);
      presentWrap.appendChild(cbtxt);

      // 调律台只显示“声纹”，不显示乐器（音色仍按乐器播放）
      const lab = document.createElement("div");
      lab.className = "mem-fader-label";
      const ins = document.createElement("div");
      ins.className = "mem-inst-main";
      ins.textContent = code;
      lab.appendChild(ins);

      col.appendChild(emo);
      col.appendChild(slider);
      col.appendChild(presentWrap);
      col.appendChild(lab);
      fadersWrap.appendChild(col);
    });

    return { fadersWrap: fadersWrap, active: active, allCodes: allCodes, stopAllLoops: stopAllLoops };
  }

  function openMemoryLock(node) {
    const mem = node.memory || {};

    const wrap = document.createElement("div");
    wrap.className = "lock-body memory-lock";

    const icon = document.createElement("div");
    icon.className = "lock-icon";
    icon.textContent = "♪";
    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent = mem.prompt ||
      "织把这段记忆谱成了曲子。点亮当时在场的人（乐器），把每个人的情绪调到对的位置，我才放得出来。";
    wrap.appendChild(icon);
    wrap.appendChild(hint);

    const rowsTitle = document.createElement("div");
    rowsTitle.className = "mem-section";
    rowsTitle.textContent = "勾上当时在场的人，把每个人的心率滑到位（越往上心率越快；滑到最底＝心率0，人已不在跳动）";

    const err = document.createElement("div");
    err.className = "lock-error";
    const faders = buildMemoryFaders(() => { err.textContent = ""; });

    wrap.appendChild(rowsTitle);
    wrap.appendChild(faders.fadersWrap);

    const btn = document.createElement("button");
    btn.className = "lock-btn";
    btn.textContent = "♫ 还原这段记忆";
    wrap.appendChild(btn);
    wrap.appendChild(err);

    const win = createWindow(node, wrap, { lockDialog: true, onClose: faders.stopAllLoops });
    win.style.width = "560px"; // 六根竖推子横排，覆盖锁框默认 300px

    btn.addEventListener("click", () => {
      const res = memoryMatches(faders.active, mem);
      if (res.ok) { faders.stopAllLoops(); doUnlock(node, win); }
      else err.textContent = res.reason === "cast"
        ? "记忆依旧模糊。在场的人不对。"
        : "记忆依旧模糊。有人的心率没对上。";
    });
  }

  /* ===================================================================
   *  调律台 App（桌面图标 type:"tuner"）
   *  选一个“当前已打开的房间(文件夹)”，把这段记忆还原出来，
   *  该房间里 revealByTune 的隐藏文件就会浮现。
   * =================================================================== */
  function openTunerApp(node) {
    const wrap = document.createElement("div");
    wrap.className = "lock-body memory-lock tuner-app";

    const icon = document.createElement("div");
    icon.className = "lock-icon";
    icon.textContent = "♪";
    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent = node.appIntro ||
      "调律台。先在下面选一个你正打开着的房间，再勾上当时在场的人、把心率调到位，点“还原”。对了，这个房间里藏着的记录就会显出来。";
    wrap.appendChild(icon);
    wrap.appendChild(hint);

    // 房间选择（当前打开的文件夹窗口）
    const pickRow = document.createElement("div");
    pickRow.className = "tuner-pick";
    const pickLab = document.createElement("span");
    pickLab.textContent = "房间：";
    const sel = document.createElement("select");
    sel.className = "tuner-room-select";
    pickRow.appendChild(pickLab);
    pickRow.appendChild(sel);
    wrap.appendChild(pickRow);

    const msg = document.createElement("div");
    msg.className = "lock-error";
    function setMsg(text, ok) {
      msg.className = "lock-error" + (ok ? " tuner-ok" : "");
      msg.textContent = text;
    }

    function openFolders() {
      return Object.keys(openWindows)
        .map((id) => openWindows[id].node)
        .filter((n) => n && n.type === "folder");
    }
    function rebuildOptions() {
      const prev = sel.value;
      sel.innerHTML = "";
      const folders = openFolders();
      if (!folders.length) {
        const o = document.createElement("option");
        o.value = ""; o.textContent = "（先打开一个房间）";
        sel.appendChild(o);
        return;
      }
      const ph = document.createElement("option");
      ph.value = ""; ph.textContent = "选一个房间…";
      sel.appendChild(ph);
      folders.forEach((f) => {
        const o = document.createElement("option");
        o.value = f.__id;
        o.textContent = displayName(f);
        sel.appendChild(o);
      });
      if (folders.some((f) => f.__id === prev)) sel.value = prev;
    }
    sel.addEventListener("mousedown", rebuildOptions);
    sel.addEventListener("change", () => setMsg("", false));
    rebuildOptions();

    const rowsTitle = document.createElement("div");
    rowsTitle.className = "mem-section";
    rowsTitle.textContent = "勾上当时在场的人，把每个人的心率滑到位（越往上心率越快；滑到最底＝心率0，人已不在跳动）";

    const faders = buildMemoryFaders(() => setMsg("", false));

    wrap.appendChild(rowsTitle);
    wrap.appendChild(faders.fadersWrap);

    const btn = document.createElement("button");
    btn.className = "lock-btn";
    btn.textContent = "♫ 还原这段记忆";
    wrap.appendChild(btn);
    wrap.appendChild(msg);

    const win = createWindow(node, wrap, { notes: true, onClose: faders.stopAllLoops });
    win.style.width = "560px";
    win.style.height = "auto";

    btn.addEventListener("click", () => {
      const folder = nodeById[sel.value];
      if (!folder || folder.type !== "folder") { setMsg("先在上面选一个你打开着的房间。", false); return; }
      const targets = tuneTargetsIn(folder);
      // 逐个隐藏文件，按它“自己的”还原条件比对；对上一个就显出来一个
      let configured = 0;
      let revealed = 0;
      let castClose = false; // 有没有“人对了，只是心率没对”的情况
      targets.forEach((c) => {
        const mem = tuneConditionOf(c);
        if (!mem) return;
        configured++;
        if (tunedNodes[c.__id]) return; // 已经还原过的跳过
        const res = memoryMatches(faders.active, mem);
        if (res.ok) { tunedNodes[c.__id] = true; revealed++; }
        else if (res.reason === "tune") castClose = true;
      });
      if (!configured) { setMsg("这个房间里，没有设好还原条件的隐藏文件。", false); return; }
      if (revealed > 0) {
        saveTuned();
        refreshOpenFolders();
        setMsg("还原成功。浮出了 " + revealed + " 条新记录。", true);
      } else {
        setMsg(castClose
          ? "记忆依旧模糊。在场的人对了，但有人的心率没对上。"
          : "记忆依旧模糊。在场的人或心率不对。", false);
      }
    });
  }

  /* ===================================================================
   *  窗口
   * =================================================================== */
  function createWindow(node, bodyEl, opts) {
    opts = opts || {};
    const win = document.createElement("div");
    win.className = "window";

    const count = Object.keys(openWindows).length;
    win.style.left = 140 + count * 34 + "px";
    win.style.top = 80 + count * 30 + "px";
    if (opts.lockDialog) { win.style.width = "300px"; win.style.height = "auto"; }
    else if (opts.export) { win.style.width = "520px"; win.style.height = "440px"; }
    else if (opts.notes) { win.style.width = "400px"; win.style.height = "440px"; }
    else {
      win.style.width = node.type === "folder" ? "420px" : "360px";
      win.style.height = node.type === "img" ? "auto" : "300px";
    }

    const bar = document.createElement("div");
    bar.className = "window-bar";
    const title = document.createElement("div");
    title.className = "title";
    const glyph = opts.lockDialog ? "🔒" : opts.export ? "💾" : (ICON_GLYPH[node.type] || "");
    function renderTitle() { title.textContent = glyph + " " + displayName(node); }
    renderTitle();
    const close = document.createElement("div");
    close.className = "close";
    close.title = "关闭";

    // 玩家重命名（仅游玩模式、普通文件，用来标记推断的时间/含义）
    const canRename = !opts.lockDialog && !opts.export && !opts.notes && !editMode;
    if (canRename) {
      const ren = document.createElement("div");
      ren.className = "rename";
      ren.textContent = "✎";
      ren.title = "重命名（标记你的推断）";
      ren.addEventListener("click", (e) => {
        e.stopPropagation();
        startRename(node, title, renderTitle);
      });
      bar.appendChild(title);
      bar.appendChild(ren);
      bar.appendChild(close);
    } else {
      bar.appendChild(title);
      bar.appendChild(close);
    }

    const body = document.createElement("div");
    body.className = "window-body";
    body.appendChild(bodyEl);

    win.appendChild(bar);
    win.appendChild(body);
    desktop.appendChild(win);

    openWindows[node.__id] = { win: win, node: node };
    focusWindow(win, node);

    close.addEventListener("click", () => { win.remove(); delete openWindows[node.__id]; if (opts.onClose) opts.onClose(); });
    win.addEventListener("mousedown", () => focusWindow(win, node));
    makeDraggable(win, bar);
    return win;
  }

  function focusWindow(win, node) {
    win.style.zIndex = ++zCounter;
    document.querySelectorAll(".window.focused").forEach((w) => w.classList.remove("focused"));
    win.classList.add("focused");
    // 打开的文件夹成为“新建目标”
    if (editMode && node && node.type === "folder") {
      addContainer = node.children;
      addTargetName = node.name || "文件夹";
      updateAddTarget();
    }
  }

  function startRename(node, titleEl, renderTitle) {
    titleEl.textContent = "";
    const input = document.createElement("input");
    input.className = "title-input";
    input.value = displayName(node);
    titleEl.appendChild(input);
    input.focus();
    input.select();
    input.addEventListener("mousedown", (e) => e.stopPropagation());
    let done = false;
    function commit() {
      if (done) return;
      done = true;
      const v = input.value.trim();
      if (v) playerNames[node.__id] = v; else delete playerNames[node.__id];
      savePlayerNames();
      renderTitle();
      if (node.__iconEl) {
        const lab = node.__iconEl.querySelector(".label");
        if (lab) lab.textContent = displayName(node);
      }
    }
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") commit();
      else if (e.key === "Escape") { done = true; renderTitle(); }
    });
    input.addEventListener("blur", commit);
  }

  function makeDraggable(win, handle) {
    let sx, sy, bx, by, dragging = false;
    handle.addEventListener("mousedown", (e) => {
      if (e.target.classList.contains("close")) return;
      if (e.target.classList.contains("rename")) return;
      if (e.target.classList.contains("title-input")) return;
      dragging = true;
      sx = e.clientX; sy = e.clientY;
      const r = win.getBoundingClientRect(); bx = r.left; by = r.top;
      e.preventDefault();
    });
    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      let nx = bx + (e.clientX - sx);
      let ny = by + (e.clientY - sy);
      nx = Math.max(-win.offsetWidth + 60, Math.min(nx, window.innerWidth - 60));
      ny = Math.max(0, Math.min(ny, window.innerHeight - 32));
      win.style.left = nx + "px"; win.style.top = ny + "px";
    });
    window.addEventListener("mouseup", () => { dragging = false; });
  }

  /* ===================================================================
   *  编辑模式：拖动图标摆位
   * =================================================================== */
  function attachDrag(el, node) {
    let sx, sy, bx, by, dragging = false, moved = false;
    el.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      dragging = true; moved = false;
      sx = e.clientX; sy = e.clientY;
      bx = node.x; by = node.y;
      el.style.zIndex = 5000;
      e.preventDefault();
    });
    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      node.x = Math.max(0, bx + dx);
      node.y = Math.max(0, by + dy);
      el.style.left = node.x + "px";
      el.style.top = node.y + "px";
    });
    window.addEventListener("mouseup", () => {
      if (!dragging) return;
      dragging = false;
      el.style.zIndex = "";
      if (moved) { selectNode(node); scheduleSave(); } // 拖完顺便选中并存草稿
    });
  }

  /* ===================================================================
   *  选中 + 属性面板
   * =================================================================== */
  function selectNode(node) {
    selected = node;
    document.querySelectorAll(".icon.selected").forEach((n) => n.classList.remove("selected"));
    if (node.__iconEl) node.__iconEl.classList.add("selected");
    buildInspector(node);
  }

  function clearSelection() {
    selected = null;
    inspector.classList.remove("shown");
    inspector.innerHTML = "";
    document.querySelectorAll(".icon.selected").forEach((n) => n.classList.remove("selected"));
  }

  function field(labelText, inputEl) {
    const wrap = document.createElement("div");
    wrap.className = "insp-field";
    const lab = document.createElement("label");
    lab.textContent = labelText;
    wrap.appendChild(lab);
    wrap.appendChild(inputEl);
    return wrap;
  }

  function buildInspector(node) {
    reindex(DESKTOP.items); // 保证 __parentFolder 等关系最新（新加的文件也能正确提示）
    inspector.innerHTML = "";
    inspector.classList.add("shown");

    const title = document.createElement("div");
    title.className = "insp-title";
    title.textContent = "属性 · " + (ICON_GLYPH[node.type] || "") + " " + node.type;
    inspector.appendChild(title);

    // 名称
    const nameInp = document.createElement("input");
    nameInp.type = "text";
    nameInp.value = node.name || "";
    nameInp.addEventListener("input", () => {
      node.name = nameInp.value;
      if (node.__iconEl) node.__iconEl.querySelector(".label").textContent = node.name || "(未命名)";
      const rec = openWindows[node.__id];
      if (rec) rec.win.querySelector(".title").textContent =
        (ICON_GLYPH[node.type] || "") + " " + node.name;
    });
    inspector.appendChild(field("名称", nameInp));

    // “调律台还原后才出现”——隐藏文件开关 + 这个文件【自己的】还原条件
    function revealByTuneField() {
      const w = document.createElement("div");
      w.className = "insp-field";
      const line = document.createElement("label");
      line.className = "insp-check";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !!node.revealByTune;
      const sp = document.createElement("span");
      sp.textContent = "🎵 用调律台还原后才出现（隐藏文件）";
      line.appendChild(cb);
      line.appendChild(sp);
      w.appendChild(line);

      // 本文件自己的还原条件（不再和所在文件夹绑定）
      const condBox = document.createElement("div");
      function renderCond() {
        condBox.innerHTML = "";
        if (!cb.checked) return;
        const hint = document.createElement("div");
        hint.style.fontSize = "12px";
        hint.style.marginTop = "4px";
        hint.style.lineHeight = "1.5";
        hint.style.color = "var(--text-dim)";
        hint.textContent = "下面是【这个文件】单独的还原条件：玩家在调律台里选中所在房间、" +
          "把这些声纹勾上并把心率调到位，才会显出这个文件。同一房间里的不同文件可以设不同条件。";
        condBox.appendChild(hint);
        node.memory = node.memory || { prompt: "", cast: [], tuning: {} };
        renderMemoryEditor(condBox);  // 编辑的是 node.memory（本文件自己的）
      }
      cb.addEventListener("change", () => {
        if (cb.checked) {
          node.revealByTune = true;
          node.memory = node.memory || { prompt: "", cast: [], tuning: {} };
        } else {
          delete node.revealByTune;
        }
        renderCond();
      });
      renderCond();
      w.appendChild(condBox);
      return w;
    }

    // 类型专属字段
    if (node.type === "txt") {
      const ta = document.createElement("textarea");
      ta.value = Array.isArray(node.content) ? node.content.join("\n") : String(node.content || "");
      function syncTextContent() {
        node.content = ta.value.split("\n");
        const rec = openWindows[node.__id];
        if (rec) { const b = rec.win.querySelector(".txt-body"); if (b) renderTxt(b, ta.value); }
      }
      ta.addEventListener("input", syncTextContent);

      const speakerTool = document.createElement("div");
      speakerTool.className = "speaker-tool";

      const speakerSel = document.createElement("select");
      (DESKTOP.roster || []).forEach((r) => {
        if (!r || !r.code) return;
        const opt = document.createElement("option");
        opt.value = r.code;
        opt.textContent = (r.person ? r.person + " · " : "") + r.code +
          (r.machineId ? " / " + r.machineId : "");
        speakerSel.appendChild(opt);
      });

      const modeSel = document.createElement("select");
      [
        ["voice", "显示声纹"],
        ["machine", "显示机器编号"],
        ["unknown", "识别失败"],
      ].forEach(([v, t]) => {
        const opt = document.createElement("option");
        opt.value = v;
        opt.textContent = t;
        modeSel.appendChild(opt);
      });

      const lineInp = document.createElement("input");
      lineInp.type = "text";
      lineInp.placeholder = "输入台词（可留空，只插入说话人前缀）";

      const insertBtn = document.createElement("button");
      insertBtn.type = "button";
      insertBtn.textContent = "插入说话行";

      function selectedRoster() {
        return (DESKTOP.roster || []).find((r) => r && r.code === speakerSel.value) || {};
      }
      function speakerPrefix() {
        const r = selectedRoster();
        if (modeSel.value === "unknown") return "未知声纹";
        if (modeSel.value === "machine") return r.machineId || r.code || "未知声纹";
        return r.code || "未知声纹";
      }
      function insertAtCursor(text) {
        const start = ta.selectionStart == null ? ta.value.length : ta.selectionStart;
        const end = ta.selectionEnd == null ? ta.value.length : ta.selectionEnd;
        const before = ta.value.slice(0, start);
        const after = ta.value.slice(end);
        const prefix = before && !before.endsWith("\n") ? "\n" : "";
        const suffix = after && !after.startsWith("\n") ? "\n" : "";
        ta.value = before + prefix + text + suffix + after;
        const pos = start + prefix.length + text.length + suffix.length;
        ta.focus();
        ta.setSelectionRange(pos, pos);
        syncTextContent();
      }

      insertBtn.addEventListener("click", () => {
        const body = lineInp.value.trim();
        insertAtCursor(speakerPrefix() + "：" + body);
        lineInp.value = "";
      });
      lineInp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); insertBtn.click(); }
      });

      const row1 = document.createElement("div");
      row1.className = "speaker-tool-row";
      row1.appendChild(speakerSel);
      row1.appendChild(modeSel);
      const row2 = document.createElement("div");
      row2.className = "speaker-tool-row";
      row2.appendChild(lineInp);
      row2.appendChild(insertBtn);
      speakerTool.appendChild(row1);
      speakerTool.appendChild(row2);

      inspector.appendChild(field("说话人（自动插入前缀）", speakerTool));
      inspector.appendChild(field("文本内容（每行一段）", ta));
      inspector.appendChild(revealByTuneField());
    } else if (node.type === "img") {
      const srcInp = document.createElement("input");
      srcInp.type = "text";
      srcInp.value = node.src === PLACEHOLDER_IMG ? "" : (node.src || "");
      srcInp.placeholder = "assets/xxx.png （留空用占位图）";
      srcInp.addEventListener("input", () => {
        node.src = srcInp.value.trim() ? srcInp.value.trim() : PLACEHOLDER_IMG;
        const rec = openWindows[node.__id];
        if (rec) { const im = rec.win.querySelector(".img-body img"); if (im) im.src = node.src; }
      });
      inspector.appendChild(field("图片路径", srcInp));

      const capInp = document.createElement("input");
      capInp.type = "text";
      capInp.value = node.caption || "";
      capInp.addEventListener("input", () => { node.caption = capInp.value; });
      inspector.appendChild(field("图片说明", capInp));
      inspector.appendChild(revealByTuneField());
    } else if (node.type === "folder") {
      const note = document.createElement("div");
      note.className = "insp-field";
      note.style.fontSize = "12px";
      note.style.color = "var(--text-dim)";
      note.textContent = "双击打开这个文件夹后，用上方“＋”按钮往里加东西。当前有 " +
        (node.children ? node.children.length : 0) + " 项。";
      inspector.appendChild(note);

      // 说明：还原条件现在配在【每个隐藏文件】上（见各文件的“用调律台还原后才出现”）。
      // 文件夹这里只是一个【可选的默认条件】：房间里没单独设条件的隐藏文件，会回退用它。
      const tuneLine = document.createElement("label");
      tuneLine.className = "insp-check";
      const tuneChk = document.createElement("input");
      tuneChk.type = "checkbox";
      tuneChk.checked = !!node.memory;
      const tuneSpan = document.createElement("span");
      tuneSpan.textContent = "🎵 本房间的默认还原条件（可选）";
      tuneLine.appendChild(tuneChk);
      tuneLine.appendChild(tuneSpan);
      const tuneFieldWrap = document.createElement("div");
      tuneFieldWrap.className = "insp-field";
      tuneFieldWrap.appendChild(tuneLine);
      inspector.appendChild(tuneFieldWrap);

      const tuneBox = document.createElement("div");
      inspector.appendChild(tuneBox);
      function renderFolderTune() {
        tuneBox.innerHTML = "";
        if (!node.memory) return;
        const h = document.createElement("div");
        h.className = "insp-field";
        h.style.fontSize = "12px";
        h.style.color = "var(--text-dim)";
        h.textContent = "可选：房间里那些没单独设置还原条件的隐藏文件，会默认用下面这套条件。" +
          "想让每个文件用不同的调律，请直接在各个文件上设置。";
        tuneBox.appendChild(h);
        renderMemoryEditor(tuneBox);
      }
      tuneChk.addEventListener("change", () => {
        if (tuneChk.checked) node.memory = node.memory || { cast: [], tuning: {} };
        else delete node.memory;
        renderFolderTune();
      });
      renderFolderTune();
    }

    // 上锁
    const lockWrap = document.createElement("div");
    lockWrap.className = "insp-field";
    const lockLine = document.createElement("label");
    lockLine.className = "insp-check";
    const lockChk = document.createElement("input");
    lockChk.type = "checkbox";
    lockChk.checked = !!node.locked;
    const lockTxt = document.createElement("span");
    lockTxt.textContent = "🔒 加锁（需要密码）";
    lockLine.appendChild(lockChk);
    lockLine.appendChild(lockTxt);
    lockWrap.appendChild(lockLine);
    inspector.appendChild(lockWrap);

    const lockExtra = document.createElement("div");
    function renderMemoryEditor(container) {
      const mem = node.memory = node.memory || { prompt: "", cast: [], tuning: {} };
      mem.cast = mem.cast || [];
      mem.tuning = mem.tuning || {};

      const promptTa = document.createElement("textarea");
      promptTa.value = mem.prompt || "";
      promptTa.addEventListener("input", () => { mem.prompt = promptTa.value; });
      container.appendChild(field("调律台提示语", promptTa));

      const note = document.createElement("div");
      note.className = "insp-field";
      note.style.fontSize = "12px";
      note.style.color = "var(--text-dim)";
      note.textContent =
        "勾“在场”＝这段记忆里此人在场（玩家要推）。心率＝该人当时的♥（0–160），容差越小越难。乐器可在此改（全局生效）。";
      container.appendChild(note);

      const instOptions = Object.keys(INSTRUMENT_LABEL);
      (DESKTOP.roster || []).forEach((r) => {
        if (!r || !r.code) return;
        const code = r.code;
        const row = document.createElement("div");
        row.className = "insp-mem-row";

        const head = document.createElement("div");
        head.className = "insp-mem-head";
        const cbl = document.createElement("label");
        cbl.className = "insp-check";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = mem.cast.indexOf(code) >= 0;
        const cspan = document.createElement("span");
        cspan.textContent = code + " 在场";
        cbl.appendChild(cb);
        cbl.appendChild(cspan);
        head.appendChild(cbl);

        const isel = document.createElement("select");
        isel.className = "insp-mem-inst";
        instOptions.forEach((k) => {
          const o = document.createElement("option");
          o.value = k; o.textContent = INSTRUMENT_LABEL[k];
          isel.appendChild(o);
        });
        isel.value = r.instrument || "piano";
        isel.addEventListener("change", () => { r.instrument = isel.value; });
        head.appendChild(isel);
        row.appendChild(head);

        const tuneBox = document.createElement("div");
        function renderTune() {
          tuneBox.innerHTML = "";
          if (mem.cast.indexOf(code) < 0) return;
          const t = mem.tuning[code] = mem.tuning[code] || { value: 0.5, tol: 0.12 };
          const hr = document.createElement("input");
          hr.type = "range"; hr.min = "0"; hr.max = "160"; hr.step = "1";
          hr.value = String(Math.round((t.value || 0) * 160));
          const hrTag = document.createElement("span");
          hrTag.className = "insp-hr";
          hrTag.textContent = "♥ " + hr.value;
          hr.addEventListener("input", () => {
            t.value = Number(hr.value) / 160;
            hrTag.textContent = "♥ " + hr.value;
          });
          const hrWrap = document.createElement("div");
          hrWrap.className = "insp-mem-hr";
          hrWrap.appendChild(hr); hrWrap.appendChild(hrTag);
          tuneBox.appendChild(field("目标心率", hrWrap));
          const tol = document.createElement("input");
          tol.type = "number"; tol.min = "0.02"; tol.max = "0.5"; tol.step = "0.01";
          tol.value = String(t.tol != null ? t.tol : 0.12);
          tol.addEventListener("input", () => { t.tol = Number(tol.value) || 0.12; });
          tuneBox.appendChild(field("容差(0.02–0.5)", tol));
        }
        cb.addEventListener("change", () => {
          if (cb.checked) {
            if (mem.cast.indexOf(code) < 0) mem.cast.push(code);
            mem.tuning[code] = mem.tuning[code] || { value: 0.5, tol: 0.12 };
          } else {
            const i = mem.cast.indexOf(code);
            if (i >= 0) mem.cast.splice(i, 1);
          }
          renderTune();
        });
        row.appendChild(tuneBox);
        renderTune();
        container.appendChild(row);
      });
    }

    function renderLockExtra() {
      lockExtra.innerHTML = "";
      if (!node.locked) return;

      const typeSel = document.createElement("select");
      [["", "密码锁"], ["memory", "记忆·音乐锁"], ["order", "排序锁(手改)"], ["dossier", "档案锁(手改)"]]
        .forEach(([val, lab]) => {
          const o = document.createElement("option");
          o.value = val; o.textContent = lab; typeSel.appendChild(o);
        });
      typeSel.value = node.lockType || "";
      typeSel.addEventListener("change", () => {
        const v = typeSel.value;
        if (v) node.lockType = v; else delete node.lockType;
        if (v === "memory") node.memory = node.memory || { prompt: "", cast: [], tuning: {} };
        renderLockExtra();
      });
      lockExtra.appendChild(field("锁类型", typeSel));

      if (node.lockType === "memory") { renderMemoryEditor(lockExtra); return; }
      if (node.lockType === "order" || node.lockType === "dossier") {
        const n = document.createElement("div");
        n.className = "insp-field"; n.style.fontSize = "12px"; n.style.color = "var(--text-dim)";
        n.textContent = "排序锁/档案锁请直接在 desktop-data.js 里配置（暂不支持可视化编辑）。";
        lockExtra.appendChild(n);
        return;
      }
      // 普通密码锁
      const pwd = document.createElement("input");
      pwd.type = "text"; pwd.value = node.password || "";
      pwd.addEventListener("input", () => { node.password = pwd.value; });
      lockExtra.appendChild(field("密码", pwd));
      const hint = document.createElement("input");
      hint.type = "text"; hint.value = node.lockPrompt || "";
      hint.placeholder = "纯数字密码可留空（数字锁不显示提示）";
      hint.addEventListener("input", () => {
        if (hint.value) node.lockPrompt = hint.value; else delete node.lockPrompt;
      });
      lockExtra.appendChild(field("锁提示（文字/词语锁才显示）", hint));
    }
    lockChk.addEventListener("change", () => {
      node.locked = lockChk.checked;
      if (node.locked && node.password == null) node.password = "";
      renderLockExtra();
      renderAll();
      if (node.__iconEl) node.__iconEl.classList.add("selected");
    });
    renderLockExtra();
    inspector.appendChild(lockExtra);

    // 删除
    const del = document.createElement("button");
    del.className = "insp-del";
    del.textContent = "🗑 删除此项";
    del.addEventListener("click", () => {
      const arr = node.__parentArray;
      if (arr) { const i = arr.indexOf(node); if (i >= 0) arr.splice(i, 1); }
      const rec = openWindows[node.__id];
      if (rec) { rec.win.remove(); delete openWindows[node.__id]; }
      clearSelection();
      renderAll();
      scheduleSave();
    });
    inspector.appendChild(del);
  }

  /* ===================================================================
   *  新建
   * =================================================================== */
  function makeNewNode(type) {
    if (type === "txt") return { type: "txt", name: "新文本.txt", content: ["（在右侧编辑内容）"] };
    if (type === "img") return { type: "img", name: "新图片.img", src: PLACEHOLDER_IMG, caption: "" };
    return { type: "folder", name: "新文件夹", children: [] };
  }

  function addItem(type) {
    const node = makeNewNode(type);
    addContainer.push(node);
    renderAll();
    selectNode(node);
    scheduleSave();
  }

  function updateAddTarget() {
    addTargetTag.innerHTML = "新建到：<b>" + addTargetName + "</b>";
  }

  /* ===================================================================
   *  导出配置
   * =================================================================== */
  function serializeValue(v, indent) {
    const pad = "  ".repeat(indent);
    const pad1 = "  ".repeat(indent + 1);
    if (v === PLACEHOLDER_IMG) return "PLACEHOLDER_IMG";
    if (typeof v === "string") return JSON.stringify(v);
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    if (Array.isArray(v)) {
      if (v.length === 0) return "[]";
      const items = v.map((x) => pad1 + serializeValue(x, indent + 1));
      return "[\n" + items.join(",\n") + "\n" + pad + "]";
    }
    if (v && typeof v === "object") {
      const keys = Object.keys(v).filter((k) => k.indexOf("__") !== 0);
      if (keys.length === 0) return "{}";
      const parts = keys.map((k) => {
        const key = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) ? k : JSON.stringify(k);
        return pad1 + key + ": " + serializeValue(v[k], indent + 1);
      });
      return "{\n" + parts.join(",\n") + "\n" + pad + "}";
    }
    return "null";
  }

  function exportConfig() {
    reindex(DESKTOP.items);
    const text =
      "/* 由编辑模式导出。三种节点写法见文件原注释。 */\n" +
      "const PLACEHOLDER_IMG = " + JSON.stringify(PLACEHOLDER_IMG) + ";\n\n" +
      "const DESKTOP = " + serializeValue(DESKTOP, 0) + ";\n";
    openExportWindow(text);
  }

  function openExportWindow(text) {
    const wrap = document.createElement("div");
    wrap.className = "export-body";
    const note = document.createElement("div");
    note.className = "export-note";
    note.textContent = "把下面全部内容，覆盖粘贴到 desktop-data.js 即可保存。";
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.readOnly = true;
    const actions = document.createElement("div");
    actions.className = "export-actions";
    const copyBtn = document.createElement("button");
    copyBtn.textContent = "复制全部";
    copyBtn.addEventListener("click", () => {
      ta.select();
      try { navigator.clipboard.writeText(text); } catch (e) { document.execCommand("copy"); }
      copyBtn.textContent = "已复制 ✓";
      setTimeout(() => (copyBtn.textContent = "复制全部"), 1500);
    });
    const dlBtn = document.createElement("button");
    dlBtn.textContent = "下载文件";
    dlBtn.addEventListener("click", () => {
      const blob = new Blob([text], { type: "text/javascript" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "desktop-data.js";
      a.click();
      URL.revokeObjectURL(a.href);
    });
    actions.appendChild(copyBtn);
    actions.appendChild(dlBtn);
    wrap.appendChild(note);
    wrap.appendChild(ta);
    wrap.appendChild(actions);

    const fake = { __id: "__export", name: "导出 desktop-data.js", type: "txt" };
    if (openWindows[fake.__id]) { openWindows[fake.__id].win.remove(); delete openWindows[fake.__id]; }
    createWindow(fake, wrap, { export: true });
    setTimeout(() => { ta.focus(); ta.select(); }, 30);
  }

  /* ===================================================================
   *  工具栏 / 全局事件
   * =================================================================== */
  function toggleEdit() {
    editMode = !editMode;
    document.body.classList.toggle("edit-mode", editMode);
    document.getElementById("btn-edit").classList.toggle("active", editMode);
    if (!editMode) clearSelection();
    else updateAddTarget();
    renderAll();
  }

  function resetProgress() {
    const ok = window.confirm(
      "确定要重置游玩进度吗？\n这会清空：已解锁的记录、看过的记录、你给记录起的名字、人物备注。\n（不影响 desktop-data.js 里的游戏内容。）"
    );
    if (!ok) return;
    try {
      localStorage.removeItem(VIEWED_KEY);
      localStorage.removeItem(FILENAME_KEY);
      localStorage.removeItem(NOTES_KEY);
      localStorage.removeItem(TUNED_KEY);
    } catch (e) {}
    location.reload();
  }

  document.getElementById("btn-reset-progress").addEventListener("click", resetProgress);
  document.getElementById("btn-edit").addEventListener("click", toggleEdit);
  document.getElementById("btn-add-txt").addEventListener("click", () => addItem("txt"));
  document.getElementById("btn-add-img").addEventListener("click", () => addItem("img"));
  document.getElementById("btn-add-folder").addEventListener("click", () => addItem("folder"));
  document.getElementById("btn-export").addEventListener("click", exportConfig);
  document.getElementById("btn-reset").addEventListener("click", resetToFile);

  // 属性面板里任何输入/勾选都自动存草稿
  inspector.addEventListener("input", scheduleSave);
  inspector.addEventListener("change", scheduleSave);

  // 点桌面空白：取消选中，并把新建目标设回桌面
  desktop.addEventListener("mousedown", (e) => {
    if (e.target === desktop || e.target === iconLayer) {
      if (editMode) {
        clearSelection();
        addContainer = DESKTOP.items;
        addTargetName = "桌面";
        updateAddTarget();
      } else {
        document.querySelectorAll(".icon.selected").forEach((n) => n.classList.remove("selected"));
      }
    }
  });

  // ---- 启动 ----
  loadNotes();                                             // 玩家备注（与作者草稿分开存）
  loadPlayerNames();                                       // 玩家给日志起的名字
  loadViewed();                                            // 玩家看过哪些记录
  loadTuned();                                             // 玩家用调律台还原过的房间
  ORIGINAL_FILE_SIG = JSON.stringify(cleanClone(DESKTOP)); // 先记下文件版本指纹
  const hadDraft = loadDraft();                            // 有草稿且文件没被改过 -> 恢复
  reindex(DESKTOP.items);
  renderDesktop();
  updateDraftStatus(hadDraft);
})();
