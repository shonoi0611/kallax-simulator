import { useState, useRef, useEffect } from "react";
import * as THREE from "three";

// ====== 調査データ(IKEA公式 2026-07) ======
const UNITS = [
  { id: "1x4", cols: 1, rows: 4, w: 42, h: 147, price: 6999 },
  { id: "2x2", cols: 2, rows: 2, w: 77, h: 77, price: 4999 },
  { id: "2x3", cols: 2, rows: 3, w: 77, h: 112, price: 8499 },
  { id: "2x4", cols: 2, rows: 4, w: 77, h: 147, price: 8999 },
  { id: "3x4", cols: 3, rows: 4, w: 112, h: 147, price: 14990 },
  { id: "4x4", cols: 4, rows: 4, w: 147, h: 147, price: 19990 },
  { id: "5x5", cols: 5, rows: 5, w: 182, h: 182, price: 29990 },
];
const DEPTH = 39; // 奥行き(共通)
const EDGE = 4.5; // 外枠厚(cm) … 外寸 = 33n + 2(n-1) + 9 = 35n + 7
const DIV = 2; // 仕切り厚(cm)
const CELL = 33; // マス内寸(cm)

const COLORS = [
  { id: "white", label: "ホワイト", body: "#F6F5F1", line: "#D8D6CF" },
  { id: "bb", label: "ブラックブラウン", body: "#3B2F29", line: "#241C18" },
  { id: "oak", label: "ホワイトステインオーク調", body: "#E3D3B3", line: "#C9B48D" },
];

const INSERTS = [
  { id: "none", label: "空(オープン)", price: 0 },
  { id: "door", label: "扉", price: 2000 },
  { id: "drawer", label: "引き出し2段", price: 3000 },
  { id: "shelf", label: "棚板", price: 1500 },
  { id: "peg", label: "有孔ボード", price: 3500 },
];

// ====== ブランド文法(実例学習の知見を移植・シード再現可能) ======
const GRAMMARS = [
  { id: "eames", label: "イームズ流", desc: "閉架は点で挿す・中段は抜く・非対称",
    gen: (cols, rows, rnd) => {
      const m = {}, cells = cols * rows;
      const maxClosed = Math.max(1, Math.round(cells * 0.2)); // 彩色:中性=2:8
      const eye = Math.max(0, Math.floor(rows / 2) - 1); // 目線の帯は開放
      let closed = 0;
      const order = shuffle(allCells(cols, rows), rnd);
      for (const [r, c] of order) {
        if (r === eye || closed >= maxClosed) continue;
        const depth = (r + 1) / rows;
        if (rnd() < depth * 0.55) {
          m[`${r}-${c}`] = depth > 0.7 ? "drawer" : "door";
          closed++;
        }
      }
      // 開架にまばらに棚板
      for (const [r, c] of order)
        if (!m[`${r}-${c}`] && r !== rows - 1 && rnd() < 0.15)
          m[`${r}-${c}`] = "shelf";
      return m;
    } },
  { id: "usm", label: "USM流", desc: "量塊からくり抜く(開:閉=2:8)",
    gen: (cols, rows, rnd) => {
      const m = {};
      for (const [r, c] of allCells(cols, rows)) m[`${r}-${c}`] = "door";
      const open = Math.max(1, Math.round(cols * rows * 0.2));
      // 最上段の帯 or ランダムニッチをくり抜く(重複しないよう分離)
      let picks;
      if (rnd() < 0.5 && rows > 1) {
        const band = Array.from({ length: Math.min(open, cols) }, (_, c) => [0, c]);
        const rest = shuffle(allCells(cols, rows).filter(([r]) => r > 0), rnd)
          .slice(0, open - band.length);
        picks = [...band, ...rest];
      } else {
        picks = shuffle(allCells(cols, rows), rnd).slice(0, open);
      }
      picks.forEach(([r, c]) => delete m[`${r}-${c}`]);
      return m;
    } },
  { id: "classic", label: "定番", desc: "下段閉架で重心を下げる",
    gen: (cols, rows, rnd) => {
      const m = {};
      for (let c = 0; c < cols; c++)
        m[`${rows - 1}-${c}`] = rnd() < 0.5 ? "drawer" : "door";
      if (rows > 3 && rnd() < 0.6)
        for (let c = 0; c < cols; c++) m[`${rows - 2}-${c}`] = "door";
      return m;
    } },
];
const allCells = (cols, rows) =>
  Array.from({ length: rows }).flatMap((_, r) =>
    Array.from({ length: cols }).map((_, c) => [r, c]));
const shuffle = (a, rnd) => {
  const x = [...a];
  for (let i = x.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [x[i], x[j]] = [x[j], x[i]];
  }
  return x;
};
// シード付き乱数(同じ番号なら同じ案を再現できる)
const mulberry32 = (a) => () => {
  a |= 0; a = (a + 0x6D2B79F5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const yen = (n) => "¥" + n.toLocaleString("ja-JP");

export default function KallaxSimulator() {
  const [unitId, setUnitId] = useState("2x4");
  const [colorId, setColorId] = useState("white");
  const [tool, setTool] = useState("door");
  const [cells, setCells] = useState({}); // {"r-c": insertId}
  const [grammarId, setGrammarId] = useState("eames");
  const [proposals, setProposals] = useState([]);
  const [view3d, setView3d] = useState(false);

  const unit = UNITS.find((u) => u.id === unitId);
  const color = COLORS.find((c) => c.id === colorId);

  const setUnit = (id) => { setUnitId(id); setCells({}); setProposals([]); setHistory([]); };
  const [history, setHistory] = useState([]);
  const updateCells = (next) => {
    setHistory((h) => [...h.slice(-19), cells]);
    setCells(next);
  };
  const undo = () => {
    if (!history.length) return;
    setCells(history[history.length - 1]);
    setHistory((h) => h.slice(0, -1));
  };
  const clickCell = (key) => {
    const next = { ...cells };
    if (cells[key] === tool || tool === "none") delete next[key];
    else next[key] = tool;
    updateCells(next);
  };

  const insertList = Object.values(cells).reduce((acc, id) => {
    acc[id] = (acc[id] || 0) + 1;
    return acc;
  }, {});
  const insertTotal = Object.entries(insertList).reduce(
    (s, [id, n]) => s + INSERTS.find((i) => i.id === id).price * n, 0);
  const total = unit.price + insertTotal;

  // ====== 図面描画(単位: cm。viewBoxをそのまま実寸に) ======
  const M = 26; // 寸法線マージン
  const vw = unit.w + M * 2, vh = unit.h + M * 2;
  const cellXY = (r, c) => [M + EDGE + c * (CELL + DIV), M + EDGE + r * (CELL + DIV)];

  const dim = { stroke: "#0A4C8C", strokeWidth: 0.6 };
  const dimText = { fill: "#0A4C8C", fontSize: 7, fontFamily: "ui-monospace, monospace" };

  return (
    <div style={{ minHeight: "100vh", background: "#FBFBF8", color: "#1C2226",
      fontFamily: "'Hiragino Sans','Noto Sans JP',sans-serif", padding: "28px 20px" }}>
      <div style={{ maxWidth: 880, margin: "0 auto" }}>
        <p style={{ margin: 0, fontSize: 11, letterSpacing: "0.25em", color: "#0A4C8C", fontWeight: 700 }}>
          KALLAX PLANNER
        </p>
        <h1 style={{ margin: "4px 0 2px", fontSize: 26, fontWeight: 800 }}>カラックス見積もりシミュレータ</h1>
        <p style={{ margin: "0 0 22px", fontSize: 13, color: "#5B6670" }}>
          サイズと色を選び、マス目をタップしてインサートを配置。寸法と合計金額が図面つきで出ます。
        </p>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 28, alignItems: "flex-start" }}>
          {/* ==== 左: プレビュー ==== */}
          <div style={{ flex: "1 1 380px", minWidth: 300 }}>
            <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
              <Chip active={!view3d} onClick={() => setView3d(false)}>図面</Chip>
              <Chip active={view3d} onClick={() => setView3d(true)}>3D</Chip>
            </div>
            {view3d ? (
              <Shelf3D unit={unit} cells={cells} color={color} />
            ) : (
            <svg viewBox={`0 0 ${vw} ${vh}`} style={{ width: "100%", background: "#fff",
              border: "1px solid #E2E2DA", borderRadius: 6 }}>
              {/* 本体 */}
              <rect x={M} y={M} width={unit.w} height={unit.h}
                fill={color.body} stroke={color.line} strokeWidth="1" />
              {/* マス目 */}
              {Array.from({ length: unit.rows }).flatMap((_, r) =>
                Array.from({ length: unit.cols }).map((_, c) => {
                  const key = `${r}-${c}`;
                  const [x, y] = cellXY(r, c);
                  const ins = cells[key];
                  return (
                    <g key={key} onClick={() => clickCell(key)} style={{ cursor: "pointer" }}>
                      <rect x={x} y={y} width={CELL} height={CELL} fill="#fff"
                        stroke={color.line} strokeWidth="0.8" />
                      {!ins && (
                        <text x={x + CELL / 2} y={y + CELL / 2 + 2.5} textAnchor="middle"
                          fontSize="7" fill="#CFCFC6">+</text>
                      )}
                      {ins === "door" && (<>
                        <rect x={x + 1} y={y + 1} width={CELL - 2} height={CELL - 2} fill={color.body} />
                        <circle cx={x + CELL - 6} cy={y + CELL / 2} r={1.4} fill="#8A8A82" />
                      </>)}
                      {ins === "drawer" && (<>
                        <rect x={x + 1} y={y + 1} width={CELL - 2} height={CELL / 2 - 1.5} fill={color.body} />
                        <rect x={x + 1} y={y + CELL / 2 + 0.5} width={CELL - 2} height={CELL / 2 - 1.5} fill={color.body} />
                        <rect x={x + 10} y={y + CELL / 4} width={13} height={1.2} fill="#8A8A82" />
                        <rect x={x + 10} y={y + (CELL * 3) / 4} width={13} height={1.2} fill="#8A8A82" />
                      </>)}
                      {ins === "shelf" && (
                        <rect x={x + 1} y={y + CELL / 2 - 0.8} width={CELL - 2} height={1.6} fill={color.line} />
                      )}
                      {ins === "peg" &&
                        Array.from({ length: 16 }).map((_, i) => (
                          <circle key={i} cx={x + 6 + (i % 4) * 7} cy={y + 6 + Math.floor(i / 4) * 7}
                            r={0.9} fill="#B9B9AF" />
                        ))}
                    </g>
                  );
                })
              )}
              {/* 寸法線: 幅 */}
              <g>
                <line x1={M} y1={M - 10} x2={M + unit.w} y2={M - 10} {...dim} />
                <line x1={M} y1={M - 14} x2={M} y2={M - 6} {...dim} />
                <line x1={M + unit.w} y1={M - 14} x2={M + unit.w} y2={M - 6} {...dim} />
                <text x={M + unit.w / 2} y={M - 14} textAnchor="middle" {...dimText}>{unit.w}cm</text>
              </g>
              {/* 寸法線: 高さ */}
              <g>
                <line x1={M - 10} y1={M} x2={M - 10} y2={M + unit.h} {...dim} />
                <line x1={M - 14} y1={M} x2={M - 6} y2={M} {...dim} />
                <line x1={M - 14} y1={M + unit.h} x2={M - 6} y2={M + unit.h} {...dim} />
                <text x={M - 14} y={M + unit.h / 2} textAnchor="middle" {...dimText}
                  transform={`rotate(-90 ${M - 14} ${M + unit.h / 2})`}>{unit.h}cm</text>
              </g>
              <text x={M + unit.w} y={M + unit.h + 12} textAnchor="end" {...dimText}>
                奥行 {DEPTH}cm ／ マス内寸 {CELL}×{CELL}cm
              </text>
            </svg>
            )}
            <p style={{ fontSize: 11.5, color: "#7A838B", margin: "8px 2px 0" }}>
              {view3d
                ? "ドラッグで回転、ホイール/ピンチでズーム。"
                : "同じツールでもう一度タップすると外せます。"}
            </p>
          </div>

          {/* ==== 右: 操作と見積もり ==== */}
          <div style={{ flex: "1 1 300px", minWidth: 280 }}>
            <Section title="1. サイズ">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {UNITS.map((u) => (
                  <Chip key={u.id} active={u.id === unitId} onClick={() => setUnit(u.id)}>
                    {u.cols}×{u.rows}<span style={{ opacity: 0.65 }}>({u.w}×{u.h})</span>
                  </Chip>
                ))}
              </div>
            </Section>

            <Section title="2. 本体カラー">
              <div style={{ display: "flex", gap: 8 }}>
                {COLORS.map((c) => (
                  <button key={c.id} onClick={() => setColorId(c.id)} title={c.label}
                    style={{ width: 34, height: 34, borderRadius: "50%", background: c.body,
                      border: c.id === colorId ? "3px solid #0A4C8C" : `1px solid ${c.line}`,
                      cursor: "pointer" }} aria-label={c.label} />
                ))}
              </div>
              <p style={{ fontSize: 12, color: "#5B6670", margin: "6px 0 0" }}>{color.label}</p>
            </Section>

            <Section title="3. おまかせ生成(ブランド文法)">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                {GRAMMARS.map((g) => (
                  <Chip key={g.id} active={g.id === grammarId} onClick={() => setGrammarId(g.id)}>
                    {g.label}
                  </Chip>
                ))}
              </div>
              <p style={{ fontSize: 11, color: "#7A838B", margin: "0 0 8px" }}>
                {GRAMMARS.find((g) => g.id === grammarId).desc}
              </p>
              <button
                onClick={() => {
                  const g = GRAMMARS.find((x) => x.id === grammarId);
                  setProposals([0, 1, 2].map(() => {
                    const seed = Math.floor(Math.random() * 1e9);
                    return { seed, cells: g.gen(unit.cols, unit.rows, mulberry32(seed)) };
                  }));
                }}
                style={{ fontSize: 13, fontWeight: 700, padding: "8px 16px", borderRadius: 8,
                  border: "none", background: "#0A4C8C", color: "#fff", cursor: "pointer" }}>
                3案生成
              </button>
              {proposals.length > 0 && (
                <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  {proposals.map((p) => {
                    const price = unit.price + Object.values(p.cells).reduce(
                      (s, id) => s + INSERTS.find((x) => x.id === id).price, 0);
                    return (
                      <button key={p.seed} onClick={() => updateCells(p.cells)}
                        style={{ display: "flex", flexDirection: "column", alignItems: "center",
                          gap: 3, padding: 8, border: "1px solid #D5D5CC", borderRadius: 8,
                          background: "#fff", cursor: "pointer" }}>
                        <PatternThumb cols={unit.cols} rows={unit.rows} cells={p.cells} color={color} />
                        <span style={{ fontSize: 10.5, fontFamily: "ui-monospace, monospace",
                          color: "#3A434B" }}>{yen(price)}</span>
                        <span style={{ fontSize: 9, fontFamily: "ui-monospace, monospace",
                          color: "#AEB4BA" }}>No.{p.seed}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </Section>

            <Section title="4. 微調整(インサートを選んでマスをタップ)">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {INSERTS.map((i) => (
                  <Chip key={i.id} active={i.id === tool} onClick={() => setTool(i.id)}>
                    {i.label}{i.price > 0 && <span style={{ opacity: 0.65 }}> {yen(i.price)}</span>}
                  </Chip>
                ))}
              </div>
            </Section>

            <div style={{ background: "#fff", border: "1px solid #E2E2DA", borderRadius: 8,
              padding: "14px 16px", marginTop: 18 }}>
              <Row label={`本体 KALLAX ${unit.cols}×${unit.rows}`} value={yen(unit.price)} />
              {Object.entries(insertList).map(([id, n]) => {
                const i = INSERTS.find((x) => x.id === id);
                return <Row key={id} label={`${i.label} ×${n}`} value={yen(i.price * n)} />;
              })}
              <div style={{ borderTop: "1.5px solid #1C2226", marginTop: 8, padding: "8px 10px 6px",
                background: "#F2F7FC", borderRadius: 6,
                display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>合計(税込)</span>
                <span style={{ fontSize: 24, fontWeight: 800, color: "#0A4C8C",
                  fontFamily: "ui-monospace, monospace" }}>{yen(total)}</span>
              </div>
            </div>

            <div style={{ display: "flex", gap: 14, marginTop: 10 }}>
              <button onClick={undo} disabled={!history.length}
                style={{ fontSize: 12, background: "none", border: "none",
                  color: history.length ? "#0A4C8C" : "#C4C9CE",
                  cursor: history.length ? "pointer" : "default",
                  textDecoration: "underline", padding: 0 }}>
                ↩ 元に戻す
              </button>
              <button onClick={() => updateCells({})}
                style={{ fontSize: 12, background: "none", border: "none",
                  color: "#7A838B", cursor: "pointer", textDecoration: "underline", padding: 0 }}>
                インサートをすべて外す
              </button>
            </div>
            <p style={{ fontSize: 10.5, color: "#9AA1A8", marginTop: 14, lineHeight: 1.6 }}>
              価格・寸法はIKEA公式(2026年7月調査)に基づく参考値です。実際の価格は店舗・時期により変わります。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Shelf3D({ unit, cells, color }) {
  const mountRef = useRef(null);
  const camState = useRef({ theta: 0.55, phi: 1.25, radius: null });
  useEffect(() => {
    const el = mountRef.current;
    const W = el.clientWidth, H = 420;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#FFFFFF");
    const camera = new THREE.PerspectiveCamera(40, W / H, 1, 4000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    el.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const dl = new THREE.DirectionalLight(0xffffff, 0.55);
    dl.position.set(180, 280, 320);
    scene.add(dl);
    scene.add(new THREE.GridHelper(600, 12, 0xdddddd, 0xefefec));

    const group = new THREE.Group();
    const bodyMat = new THREE.MeshLambertMaterial({ color: color.body });
    const lineMat = new THREE.MeshLambertMaterial({ color: color.line });
    const D = DEPTH;
    const addBox = (w, h, d, x, y, z, mat = bodyMat) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      group.add(m);
    };

    const { cols, rows, w: TW, h: TH } = unit;
    // 縦板(外枠4.5cm・仕切り2cm)
    for (let i = 0; i <= cols; i++) {
      const t = i === 0 || i === cols ? EDGE : DIV;
      const cx = i === 0 ? -TW / 2 + EDGE / 2
        : i === cols ? TW / 2 - EDGE / 2
        : -TW / 2 + EDGE + i * (CELL + DIV) - DIV / 2;
      addBox(t, TH, D, cx, TH / 2, 0);
    }
    // 横板
    for (let j = 0; j <= rows; j++) {
      const t = j === 0 || j === rows ? EDGE : DIV;
      const cy = j === 0 ? TH - EDGE / 2
        : j === rows ? EDGE / 2
        : TH - EDGE - j * (CELL + DIV) + DIV / 2;
      addBox(TW - EDGE * 2, t, D, 0, cy, 0);
    }
    // インサート
    Object.entries(cells).forEach(([key, ins]) => {
      const [r, c] = key.split("-").map(Number);
      const cx = -TW / 2 + EDGE + c * (CELL + DIV) + CELL / 2;
      const cy = TH - EDGE - r * (CELL + DIV) - CELL / 2;
      if (ins === "door") addBox(CELL - 1, CELL - 1, 1.8, cx, cy, D / 2 - 0.9);
      if (ins === "drawer") {
        addBox(CELL - 1, CELL / 2 - 1.4, 1.8, cx, cy + CELL / 4, D / 2 - 0.9);
        addBox(CELL - 1, CELL / 2 - 1.4, 1.8, cx, cy - CELL / 4, D / 2 - 0.9);
      }
      if (ins === "shelf") addBox(CELL - 1, 1.6, D - 4, cx, cy, 0, lineMat);
      if (ins === "peg") addBox(CELL - 1, CELL - 1, 1, cx, cy, -D / 2 + 3, lineMat);
    });
    scene.add(group);

    // 簡易オービット(カメラ状態はrefに保持し、編集後も維持)
    const st = camState.current;
    if (st.radius === null) st.radius = Math.max(TW, TH) * 2.3;
    let drag = false, px = 0, py = 0;
    const target = new THREE.Vector3(0, TH / 2, 0);
    const setCam = () => {
      camera.position.set(
        target.x + st.radius * Math.sin(st.phi) * Math.sin(st.theta),
        target.y + st.radius * Math.cos(st.phi),
        target.z + st.radius * Math.sin(st.phi) * Math.cos(st.theta));
      camera.lookAt(target);
    };
    setCam();
    const start = (x, y) => { drag = true; px = x; py = y; };
    const rotate = (x, y) => {
      if (!drag) return;
      st.theta -= (x - px) * 0.005;
      st.phi = Math.min(1.55, Math.max(0.35, st.phi - (y - py) * 0.005));
      px = x; py = y; setCam();
    };
    const end = () => { drag = false; };
    const onDown = (e) => start(e.clientX, e.clientY);
    const onMove = (e) => rotate(e.clientX, e.clientY);
    const onWheel = (e) => {
      e.preventDefault();
      st.radius = Math.min(1400, Math.max(130, st.radius + e.deltaY * 0.5));
      setCam();
    };
    const onResize = () => {
      const w = el.clientWidth;
      camera.aspect = w / H;
      camera.updateProjectionMatrix();
      renderer.setSize(w, H);
    };
    window.addEventListener("resize", onResize);
    const onTStart = (e) => start(e.touches[0].clientX, e.touches[0].clientY);
    const onTMove = (e) => { e.preventDefault(); rotate(e.touches[0].clientX, e.touches[0].clientY); };
    const cv = renderer.domElement;
    cv.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", end);
    cv.addEventListener("wheel", onWheel, { passive: false });
    cv.addEventListener("touchstart", onTStart, { passive: true });
    cv.addEventListener("touchmove", onTMove, { passive: false });
    cv.addEventListener("touchend", end);

    let raf;
    const loop = () => { raf = requestAnimationFrame(loop); renderer.render(scene, camera); };
    loop();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", end);
      window.removeEventListener("resize", onResize);
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
        }
      });
      renderer.dispose();
      el.removeChild(cv);
    };
  }, [unit, cells, color]);
  return (
    <div ref={mountRef} style={{ width: "100%", height: 420, background: "#fff",
      border: "1px solid #E2E2DA", borderRadius: 6, cursor: "grab", overflow: "hidden" }} />
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em",
        color: "#1C2226", margin: "0 0 8px" }}>{title}</p>
      {children}
    </div>
  );
}

function Chip({ active, onClick, children }) {
  return (
    <button onClick={onClick}
      style={{ fontSize: 12, padding: "6px 10px", borderRadius: 999, cursor: "pointer",
        border: active ? "1.5px solid #0A4C8C" : "1px solid #D5D5CC",
        background: active ? "#0A4C8C" : "#fff", color: active ? "#fff" : "#1C2226" }}>
      {children}
    </button>
  );
}

function PatternThumb({ cols, rows, cells, color }) {
  const s = 9, g = 1.5;
  const w = cols * (s + g) + g, h = rows * (s + g) + g;
  return (
    <svg width={w * 2.4} height={h * 2.4} viewBox={`0 0 ${w} ${h}`}
      style={{ flexShrink: 0, background: color.body, borderRadius: 2 }}>
      {Array.from({ length: rows }).flatMap((_, r) =>
        Array.from({ length: cols }).map((_, c) => {
          const ins = cells[`${r}-${c}`];
          const x = g + c * (s + g), y = g + r * (s + g);
          return (
            <g key={`${r}-${c}`}>
              <rect x={x} y={y} width={s} height={s}
                fill={ins === "door" || ins === "drawer" ? color.body : "#fff"}
                stroke={color.line} strokeWidth="0.5" />
              {ins === "drawer" && (
                <line x1={x + 1} y1={y + s / 2} x2={x + s - 1} y2={y + s / 2}
                  stroke="#8A8A82" strokeWidth="0.7" />
              )}
              {ins === "shelf" && (
                <line x1={x + 1} y1={y + s / 2} x2={x + s - 1} y2={y + s / 2}
                  stroke={color.line} strokeWidth="0.9" />
              )}
              {ins === "peg" && <circle cx={x + s / 2} cy={y + s / 2} r={1} fill="#B9B9AF" />}
            </g>
          );
        })
      )}
    </svg>
  );
}

function Row({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13,
      padding: "3px 0", color: "#3A434B" }}>
      <span>{label}</span>
      <span style={{ fontFamily: "ui-monospace, monospace" }}>{value}</span>
    </div>
  );
}
