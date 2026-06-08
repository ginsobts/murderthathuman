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

  const ICON_GLYPH = { txt: "📄", img: "🖼️", folder: "📁", notes: "📝" };
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

  // 行首是某个声纹代号 + “：” 时，把说话人名字（含冒号）标成浅蓝色。
  // 只认花名册里的代号，避免把“自动输液剂量校验：”这种设备读数也染色。
  function speakerRegex() {
    const codes = (DESKTOP.roster || [])
      .map((r) => r && r.code)
      .filter(Boolean)
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
  function reindex(items) {
    items.forEach((node) => {
      if (node.__id == null) node.__id = "n" + idSeq++;
      nodeById[node.__id] = node;
      if (node.slot) nodeBySlot[node.slot] = node;
      node.__parentArray = items;
      if (node.type === "folder") {
        node.children = node.children || [];
        reindex(node.children);
      }
    });
  }

  // 逐层揭示：带 hiddenUntil 的节点，要等到对应 slot 的记录被“看过”才出现
  function isHidden(node) {
    if (editMode) return false;            // 编辑模式下全部可见，方便作者改
    if (!node.hiddenUntil) return false;
    const pre = nodeBySlot[node.hiddenUntil];
    return !(pre && viewed[pre.__id]);
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

    close.addEventListener("click", () => { win.remove(); delete openWindows[node.__id]; });
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

    // 类型专属字段
    if (node.type === "txt") {
      const ta = document.createElement("textarea");
      ta.value = Array.isArray(node.content) ? node.content.join("\n") : String(node.content || "");
      ta.addEventListener("input", () => {
        node.content = ta.value.split("\n");
        const rec = openWindows[node.__id];
        if (rec) { const b = rec.win.querySelector(".txt-body"); if (b) renderTxt(b, ta.value); }
      });
      inspector.appendChild(field("文本内容（每行一段）", ta));
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
    } else if (node.type === "folder") {
      const note = document.createElement("div");
      note.className = "insp-field";
      note.style.fontSize = "12px";
      note.style.color = "var(--text-dim)";
      note.textContent = "双击打开这个文件夹后，用上方“＋”按钮往里加东西。当前有 " +
        (node.children ? node.children.length : 0) + " 项。";
      inspector.appendChild(note);
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
    function renderLockExtra() {
      lockExtra.innerHTML = "";
      if (!node.locked) return;
      const pwd = document.createElement("input");
      pwd.type = "text"; pwd.value = node.password || "";
      pwd.addEventListener("input", () => { node.password = pwd.value; });
      lockExtra.appendChild(field("密码", pwd));
      const hint = document.createElement("input");
      hint.type = "text"; hint.value = node.lockHint || "";
      hint.addEventListener("input", () => { node.lockHint = hint.value; });
      lockExtra.appendChild(field("密码提示", hint));
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
      const parts = keys.map((k) => pad1 + k + ": " + serializeValue(v[k], indent + 1));
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
  ORIGINAL_FILE_SIG = JSON.stringify(cleanClone(DESKTOP)); // 先记下文件版本指纹
  const hadDraft = loadDraft();                            // 有草稿且文件没被改过 -> 恢复
  reindex(DESKTOP.items);
  renderDesktop();
  updateDraftStatus(hadDraft);
})();
