import { createPulse, BUNDLE_MIN, BUNDLE_PRETTY } from "./pulse.js";
import { createSound } from "./sound.js";
import { createDevices, renderWatch, DEVICES } from "./devices.js";
const sound = createSound();

// ---------------------------------------------------------------- tiny event bus
const bus = (() => {
	const m = {};
	return {
		on(ev, fn) { (m[ev] ||= new Set()).add(fn); return () => m[ev].delete(fn); },
		emit(ev, data) { (m[ev] || []).forEach((fn) => fn(data)); },
	};
})();

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const h = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };

// ---------------------------------------------------------------- lab state (what the learner has collected)
const KEY = "teardown101.v1";
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; } };
const saved = load();
const lab = {
	done: new Set(saved.done || []),
	lesson: saved.lesson || 0,
	screens: new Set(), edges: new Map(), requests: [], storageLog: [], tokens: new Map(), flags: new Set(), rules: new Set(),
	inspected: new Set(), schemas: new Set(), backup: null, fileSolved: false, diff: null, sorted: {},
};
function persist() { try { localStorage.setItem(KEY, JSON.stringify({ done: [...lab.done], lesson: lab.lesson })); } catch {} }

bus.on("nav", ({ from, to, via }) => {
	lab.screens.add(to);
	if (from && from !== to) { const k = `${from}>${to}`; if (!lab.edges.has(k)) lab.edges.set(k, { from, to, via }); }
});
bus.on("request", (r) => {
	lab.requests.push(r); if (lab.requests.length > 200) lab.requests.shift();
	if (r.status === 402 && r.response?.error === "plan_limit") lab.rules.add("plan_limit");
	if (r.status === 402 && r.response?.error === "pro_only") lab.rules.add("pro_only");
	if (lab.requests.filter((x) => x.kind === "analytics").length >= 6) lab.rules.add("tracking");
	if (r.path === "/api/v2/plans") lab.rules.add("ab_test");
});
bus.on("storage", (e) => lab.storageLog.push({ ...e, t: Date.now() }));
bus.on("export", (bytes) => { lab.backup = bytes; });

// ---------------------------------------------------------------- the target app
const pulseRoot = $("#pulse");
const pulse = createPulse(pulseRoot, bus);

// ---------------------------------------------------------------- inspector overlay on the target
const overlay = $("#inspect-box"), overlayTag = $("#inspect-tag");
let inspect = null; // { onHover, onPick }
function setInspect(cfg) {
	inspect = cfg;
	if (cfg) pulseRoot.dataset.inspect = "1"; else { delete pulseRoot.dataset.inspect; overlay.hidden = true; }
	$("#device").classList.toggle("inspecting", !!cfg);
}
function describe(el) {
	const cls = [...el.classList].filter((c) => c !== "on" && c !== "show").map((c) => "." + c).join("");
	return el.tagName.toLowerCase() + cls;
}
function localRect(el) {
	let x = 0, y = 0, n = el;
	while (n && n !== pulseRoot) {
		x += n.offsetLeft; y += n.offsetTop;
		const p = n.offsetParent;
		for (let a = n.parentElement; a && a !== p && a !== pulseRoot; a = a.parentElement) { x -= a.scrollLeft; y -= a.scrollTop; }
		if (p && p !== pulseRoot && pulseRoot.contains(p)) { x -= p.scrollLeft; y -= p.scrollTop; }
		n = p;
	}
	return { x, y, w: el.offsetWidth, h: el.offsetHeight };
}
pulseRoot.addEventListener("mousemove", (e) => {
	if (!inspect) return;
	const el = e.target.closest(".pulse *") || e.target;
	let html = el; while (html && !(html instanceof HTMLElement)) html = html.parentElement;
	if (!html) return;
	const r = localRect(html);
	Object.assign(overlay.style, { left: r.x + "px", top: r.y + "px", width: r.w + "px", height: r.h + "px" });
	overlay.hidden = false; overlayTag.textContent = `${describe(html)}  ${r.w}×${r.h}`;
	inspect.onHover?.(el);
});
pulseRoot.addEventListener("mouseleave", () => { overlay.hidden = true; });
pulseRoot.addEventListener("click", (e) => {
	if (!inspect) return;
	e.preventDefault(); e.stopPropagation();
	const el = e.target.closest(".pulse *") || e.target;
	inspect.onPick?.(el);
}, true);

// ---------------------------------------------------------------- shared bits
function json(v, indent = 2) {
	if (v === null || v === undefined) return '<span class="j-null">(empty body)</span>';
	const s = JSON.stringify(v, null, indent);
	return esc(s).replace(/(&quot;[^&]*?&quot;)(\s*:)?|\b(true|false|null)\b|-?\d+\.?\d*/g, (m, str, colon, lit) => {
		if (str) return colon ? `<span class="j-key">${str}</span>${colon}` : `<span class="j-str">${str}</span>`;
		if (lit) return `<span class="j-lit">${m}</span>`;
		return `<span class="j-num">${m}</span>`;
	});
}
const statusClass = (s) => (s >= 400 ? "bad" : s >= 300 ? "warn" : "ok");
function hint(text) { return `<div class="hint"><b>Try</b> ${text}</div>`; }

function typeOf(v) {
	if (v === null) return "null";
	if (Array.isArray(v)) return "array";
	if (typeof v === "string") {
		if (/^\d{4}-\d\d-\d\dT/.test(v)) return "string (ISO date)";
		if (/^#[0-9a-f]{6}$/i.test(v)) return "string (hex color)";
		if (/^[a-z]+_[A-Za-z0-9]+$/.test(v)) return "string (id)";
		if (/^\d\d:\d\d$/.test(v)) return "string (HH:MM)";
		return "string";
	}
	return typeof v;
}
function toTS(name, v, out = []) {
	const lines = [];
	for (const [k, val] of Object.entries(v)) {
		let t;
		if (val === null) t = "string | null";
		else if (Array.isArray(val)) {
			if (val.length && typeof val[0] === "object") { const sub = name + cap(k).replace(/s$/, ""); toTS(sub, val[0], out); t = sub + "[]"; }
			else t = (val.length ? typeof val[0] : "unknown") + "[]";
		} else if (typeof val === "object") { const sub = name + cap(k); toTS(sub, val, out); t = sub; }
		else t = typeof val;
		lines.push(`  ${k}: ${t};`);
	}
	out.push(`interface ${name} {\n${lines.join("\n")}\n}`);
	return out;
}
const cap = (s) => s.replace(/(^|_)(\w)/g, (_, a, b) => b.toUpperCase());
const endpointKey = (r) => `${r.method} ${r.path.replace(/\/h_\d+/g, "/:id").replace(/\?.*$/, "")}`;

// ---------------------------------------------------------------- lessons
const LESSONS = [
	{
		id: "rules", group: "Observe", title: "What REA actually is",
		kicker: "Reverse engineering a product means studying what it does from the outside, then building your own version from your notes.",
		why: [
			"Every app you use leaves clues: the screens it shows, the requests it sends, the files it exports, the code it ships to your browser. Reverse engineering is reading those clues until you understand the product well enough to describe it.",
			"Done right, it is how people learn, build compatible tools and ship competitors. Done wrong, it is copying someone's code or sneaking past their paywall. Before touching a real app, learn where the line is.",
			"Meet <b>Pulse</b>, a fictional habit tracker on the left. You will take it apart over the next 11 lessons. It is fake on purpose: nothing it does leaves this page.",
		],
		tasks: [{ id: "sort", label: "Sort all 8 cards correctly" }],
		tool(el, done) {
			const cards = [
				["Rebuild the UI from what you see on screen", true],
				["Read the requests your own browser sends", true],
				["Write a spec first, then build only from the spec", true],
				["Read public API docs and file format specs", true],
				["Copy their logo, name and illustrations", false],
				["Paste their minified source into your repo", false],
				["Bypass a paywall or a license check", false],
				["Pull other users' private data from the API", false],
			];
			el.innerHTML = `<div class="tool-head"><h3>Fair game or off-limits?</h3><span class="muted">Click a side for each card</span></div><div class="sorter"></div><p class="fine">Rule of thumb, not legal advice. Laws differ by country and by the app's terms.</p>`;
			const box = $(".sorter", el);
			const draw = () => {
				box.innerHTML = cards.map(([t, ok], i) => {
					const a = lab.sorted[i];
					const state = a === undefined ? "" : a === ok ? "right" : "wrong";
					return `<div class="sort-card ${state}"><span>${t}</span><div class="sort-btns"><button data-i="${i}" data-v="1" class="${a === true ? "sel" : ""}">Fair game</button><button data-i="${i}" data-v="0" class="${a === false ? "sel" : ""}">Off-limits</button></div></div>`;
				}).join("");
				if (cards.every(([, ok], i) => lab.sorted[i] === ok)) done("sort");
			};
			box.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; lab.sorted[b.dataset.i] = b.dataset.v === "1"; draw(); });
			draw();
		},
	},
	{
		id: "map", group: "Observe", title: "Map every screen",
		kicker: "Before any tooling, click through the whole product and draw how the screens connect.",
		why: [
			"A screen map is the skeleton of your rebuild. It tells you how many views to build, how the user moves between them and where the product pushes them to pay.",
			"Click around Pulse. Each new screen appears on the map, and every move between two screens becomes an arrow labeled with what triggered it. Pay attention to arrows you did not trigger on purpose.",
		],
		tasks: [{ id: "all5", label: "Visit all 5 screens" }, { id: "paywall", label: "Find a path into the paywall" }],
		tool(el, done) {
			const pos = { home: [90, 70], habit: [90, 210], stats: [300, 70], settings: [300, 210], pro: [510, 140] };
			const names = { home: "Today", habit: "Habit detail", stats: "Stats", settings: "Settings", pro: "Paywall" };
			el.innerHTML = `<div class="tool-head"><h3>Screen map</h3><span class="muted" id="map-count"></span></div><svg class="map" viewBox="0 0 600 290"></svg><div class="edge-list"></div>${hint("tap a habit, switch tabs, open Settings. Then try adding a 4th habit.")}`;
			const svgEl = $(".map", el), list = $(".edge-list", el);
			const drawn = new Set(), seenN = new Set();
			const draw = () => {
				let s = `<defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="currentColor"/></marker></defs>`;
				for (const e of lab.edges.values()) {
					const [x1, y1] = pos[e.from], [x2, y2] = pos[e.to];
					const back = lab.edges.has(`${e.to}>${e.from}`) ? 10 : 0;
					const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy), nx = -dy / L * back, ny = dx / L * back;
					const k = e.from + ">" + e.to, fresh = !drawn.has(k); drawn.add(k);
					s += `<line class="${e.to === "pro" ? "hot" : ""} ${fresh ? "new" : ""}" pathLength="100" x1="${x1 + dx / L * 58 + nx}" y1="${y1 + dy / L * 30 + ny}" x2="${x2 - dx / L * 60 + nx}" y2="${y2 - dy / L * 32 + ny}" marker-end="url(#ar)"/>`;
				}
				for (const [k, [x, y]] of Object.entries(pos)) {
					const seen = lab.screens.has(k), popN = seen && !seenN.has(k); if (seen) seenN.add(k);
					s += `<g class="node ${seen ? "seen" : ""} ${popN ? "pop" : ""} ${k === "pro" ? "pro" : ""}" transform="translate(${x},${y})"><rect x="-58" y="-26" width="116" height="52" rx="12"/><text y="5">${seen ? names[k] : "?"}</text></g>`;
				}
				svgEl.innerHTML = s;
				list.innerHTML = [...lab.edges.values()].map((e) => `<div class="edge ${e.to === "pro" ? "hot" : ""}"><b>${names[e.from]}</b> → <b>${names[e.to]}</b><span>${esc(e.via)}</span></div>`).join("") || '<p class="muted">No moves yet. Start clicking in Pulse.</p>';
				$("#map-count", el).textContent = `${lab.screens.size} / 5 screens`;
				if (lab.screens.size >= 5) done("all5");
				if ([...lab.edges.values()].some((e) => e.to === "pro")) done("paywall");
			};
			draw();
			return bus.on("nav", () => setTimeout(draw));
		},
	},
	{
		id: "inspect", group: "Observe", title: "Inspect the elements",
		kicker: "Hover anything in the app to see what it is made of: tag, classes, box model, computed styles.",
		why: [
			"Browser DevTools let you point at any pixel and ask what it is. The answer is the element tree plus the final styles the browser applied after all the CSS fought it out.",
			"Inspect mode is on: hovering Pulse shows a box around each element, and clicking pins it here. These numbers are real, read live from the page with getComputedStyle, exactly like the Elements panel.",
		],
		tasks: [{ id: "btn", label: "Pin the round check button" }, { id: "card", label: "Pin a habit card" }, { id: "font", label: "Find which font Pulse uses" }],
		tool(el, done) {
			el.innerHTML = `<div class="tool-head"><h3>Elements</h3><span class="muted">Click an element in Pulse to pin it</span></div><div class="insp"><div class="crumbs muted">Nothing pinned yet</div><div class="boxmodel"></div><table class="props"></table></div>`;
			const show = (node) => {
				const cs = getComputedStyle(node);
				const path = []; let n = node; while (n && n !== pulseRoot) { path.unshift(describe(n)); n = n.parentElement; }
				$(".crumbs", el).innerHTML = path.map((p, i) => `<span class="${i === path.length - 1 ? "cur" : ""}">${esc(p)}</span>`).join('<i>›</i>');
				const px = (v) => Math.round(parseFloat(v) || 0);
				$(".boxmodel", el).innerHTML = `<div class="bm m"><em>margin</em><span class="t">${px(cs.marginTop)}</span><div class="bm p"><em>padding</em><span class="t">${px(cs.paddingTop)}</span><div class="bm c">${Math.round(node.getBoundingClientRect().width)} × ${Math.round(node.getBoundingClientRect().height)}</div><span class="b">${px(cs.paddingBottom)}</span></div><span class="b">${px(cs.marginBottom)}</span></div>`;
				const rows = [["display", cs.display], ["font-family", cs.fontFamily.split(",")[0].replace(/"/g, "")], ["font-size", cs.fontSize], ["font-weight", cs.fontWeight], ["color", cs.color], ["background", cs.backgroundColor], ["border-radius", cs.borderRadius], ["gap", cs.gap]];
				$(".props", el).innerHTML = rows.map(([k, v]) => `<tr><td>${k}</td><td>${/rgb/.test(v) ? `<i class="sw" style="background:${v}"></i>` : ""}${esc(v)}</td></tr>`).join("");
			};
			setInspect({
				onPick(node) {
					show(node); lab.inspected.add(describe(node));
					if (node.closest(".pl-check")) done("btn");
					if (node.classList.contains("pl-card")) done("card");
					if (node.textContent.trim() && getComputedStyle(node).fontFamily.includes("Inter")) done("font");
				},
			});
			return () => setInspect(null);
		},
	},
	{
		id: "tokens", group: "Observe", title: "Extract design tokens",
		kicker: "Turn the look of the app into a short list of colors, type sizes, radii and spacing.",
		why: [
			"Apps look consistent because they reuse a small set of values. Find that set and your rebuild will feel right even if every component is written from scratch.",
			"Click elements in Pulse. Each click pulls its colors, type and radius into the token sheet. Duplicates merge, so after a dozen clicks you see the real palette.",
		],
		tasks: [{ id: "colors", label: "Collect 4 colors" }, { id: "type", label: "Collect 3 type sizes" }, { id: "radius", label: "Collect 2 radii" }],
		tool(el, done) {
			el.innerHTML = `<div class="tool-head"><h3>Token sheet</h3><div class="seg-sm"><button class="on" data-v="table">Table</button><button data-v="css">CSS</button></div></div><div class="tok"></div>`;
			let view = "table";
			const add = (kind, value) => { if (!value || value === "rgba(0, 0, 0, 0)" || value === "0px" || value === "normal") return; const k = kind + "|" + value; lab.tokens.set(k, { kind, value, n: (lab.tokens.get(k)?.n || 0) + 1 }); };
			const draw = () => {
				const by = (k) => [...lab.tokens.values()].filter((t) => t.kind === k).sort((a, b) => b.n - a.n);
				const C = by("color"), T = by("type"), R = by("radius");
				if (view === "table") {
					$(".tok", el).innerHTML = `
					<div class="tok-sec"><h4>Color <span>${C.length}</span></h4><div class="swatches">${C.map((t) => `<div class="swatch"><i style="background:${t.value}"></i><code>${hex(t.value)}</code></div>`).join("") || '<p class="muted">Click something colorful</p>'}</div></div>
					<div class="tok-sec"><h4>Type <span>${T.length}</span></h4>${T.map((t) => `<div class="type-row"><span style="font:${t.value.split(" ")[1]} ${t.value.split(" ")[0]} Inter">Aa</span><code>${t.value}</code></div>`).join("") || '<p class="muted">Click some text</p>'}</div>
					<div class="tok-sec"><h4>Radius <span>${R.length}</span></h4><div class="radii">${R.map((t) => `<div><i style="border-radius:${t.value}"></i><code>${t.value}</code></div>`).join("") || '<p class="muted">Click a card or a button</p>'}</div></div>`;
				} else {
					const lines = [...C.map((t, i) => `  --color-${i + 1}: ${hex(t.value)};`), ...T.map((t, i) => `  --text-${i + 1}: ${t.value.split(" ")[0]};  /* weight ${t.value.split(" ")[1]} */`), ...R.map((t, i) => `  --radius-${i + 1}: ${t.value};`)];
					$(".tok", el).innerHTML = `<pre class="code">:root {\n${lines.join("\n")}\n}</pre>`;
				}
				if (C.length >= 4) done("colors"); if (T.length >= 3) done("type"); if (R.length >= 2) done("radius");
			};
			$(".seg-sm", el).addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; view = b.dataset.v; [...b.parentElement.children].forEach((x) => x.classList.toggle("on", x === b)); draw(); });
			setInspect({
				onPick(node) {
					const cs = getComputedStyle(node);
					add("color", cs.color); add("color", cs.backgroundColor);
					if (node.textContent.trim() && node.children.length === 0) add("type", `${cs.fontSize} ${cs.fontWeight}`);
					add("radius", cs.borderTopLeftRadius === "0px" ? "" : cs.borderTopLeftRadius);
					draw();
				},
			});
			draw();
			return () => setInspect(null);
		},
	},
	{
		id: "network", group: "Intercept", title: "Watch the network",
		kicker: "Every button press that touches data sends a request. Read them and you know the backend.",
		why: [
			"The Network panel shows each request your browser makes: the method, the URL, what was sent and what came back. For most apps this is the single richest source of truth about how the product works.",
			"Use Pulse normally and watch the log fill. Click any row to open its headers, payload and response. Look at the status codes: not everything comes back 200.",
		],
		tasks: [{ id: "five", label: "Capture 10 requests" }, { id: "post", label: "Open a request that sends a body" }, { id: "err", label: "Catch a request that fails" }],
		tool(el, done) {
			el.innerHTML = `<div class="tool-head"><h3>Network</h3><div class="seg-sm"><button class="on" data-f="all">All</button><button data-f="fetch">Fetch</button><button data-f="analytics">Analytics</button></div></div><div class="net"><div class="net-list"></div><div class="net-detail muted">Select a request</div></div>${hint("check a habit, switch Stats to 30 days, toggle dark mode.")}`;
			let filter = "all", sel = null, tab = "response", lastId = lab.requests.length ? lab.requests[lab.requests.length - 1].id : 0;
			const draw = () => {
				const rows = lab.requests.filter((r) => filter === "all" || r.kind === filter).slice().reverse();
				$(".net-list", el).innerHTML = `<div class="net-row head"><span>Method</span><span>Path</span><span>Status</span><span>Time</span></div>` + rows.map((r) => `<button class="net-row ${sel?.id === r.id ? "sel" : ""} ${r.kind} ${r.id > lastId ? "new" : ""}" data-id="${r.id}"><span class="m m-${r.method}">${r.method}</span><span class="p">${esc(r.path)}</span><span class="s ${statusClass(r.status)}">${r.status}</span><span class="t">${r.ms} ms</span></button>`).join("");
				lastId = lab.requests.length ? lab.requests[lab.requests.length - 1].id : 0;
				if (lab.requests.length >= 10) done("five");
				if (lab.requests.some((r) => r.status >= 400)) done("err");
			};
			const detail = () => {
				if (!sel) return;
				const r = sel, d = $(".net-detail", el);
				d.classList.remove("muted");
				const body = tab === "headers"
					? `<h5>General</h5><pre class="code">${r.method} ${esc(r.url)}\nStatus: ${r.status}</pre><h5>Request headers</h5><pre class="code">${Object.entries(r.reqHeaders).filter(([, v]) => v).map(([k, v]) => `${k}: ${esc(v)}`).join("\n")}</pre><h5>Response headers</h5><pre class="code">${Object.entries(r.resHeaders).map(([k, v]) => `${k}: ${esc(v)}`).join("\n")}</pre>`
					: tab === "payload" ? `<pre class="code">${json(r.body)}</pre>`
					: r.response instanceof Uint8Array ? `<pre class="code">Binary file, ${r.response.length} bytes. Open lesson 10 to decode it.</pre>` : `<pre class="code">${json(r.response)}</pre>`;
				d.innerHTML = `<div class="tabs-sm">${["headers", "payload", "response"].map((t) => `<button class="${t === tab ? "on" : ""}" data-t="${t}">${t}</button>`).join("")}</div>${body}`;
			};
			el.addEventListener("click", (e) => {
				const f = e.target.closest("[data-f]"); if (f) { filter = f.dataset.f; [...f.parentElement.children].forEach((x) => x.classList.toggle("on", x === f)); draw(); return; }
				const row = e.target.closest(".net-row[data-id]"); if (row) { sel = lab.requests.find((r) => r.id == row.dataset.id); tab = sel.body ? "payload" : "response"; if (sel.body) done("post"); draw(); detail(); return; }
				const t = e.target.closest("[data-t]"); if (t) { tab = t.dataset.t; detail(); }
			});
			draw();
			return bus.on("request", () => draw());
		},
	},
	{
		id: "api", group: "Intercept", title: "Infer the API",
		kicker: "Turn captured responses into a typed description of the backend.",
		why: [
			"One response tells you the field names. A few responses from the same endpoint tell you the types, which fields can be empty and how ids are shaped. That is enough to write your own backend with the same contract.",
			"Pick an endpoint you have captured. The schema on the right is inferred from the real response, and the TypeScript types are generated from it. Copy them into your rebuild.",
		],
		tasks: [{ id: "two", label: "Infer types for 3 endpoints" }, { id: "copy", label: "Copy a set of types" }],
		tool(el, done) {
			el.innerHTML = `<div class="tool-head"><h3>API map</h3><span class="muted" id="api-n"></span></div><div class="api"><div class="api-list"></div><div class="api-detail muted">Pick an endpoint</div></div>`;
			let sel = null;
			const draw = () => {
				const eps = new Map();
				for (const r of lab.requests) if (r.kind === "fetch" && r.response && !(r.response instanceof Uint8Array) && r.status < 400) eps.set(endpointKey(r), r);
				$("#api-n", el).textContent = `${eps.size} endpoints`;
				$(".api-list", el).innerHTML = [...eps.entries()].map(([k]) => `<button class="${sel === k ? "sel" : ""}" data-k="${esc(k)}"><span class="m m-${k.split(" ")[0]}">${k.split(" ")[0]}</span>${esc(k.split(" ")[1])}${lab.schemas.has(k) ? '<i class="tick">✓</i>' : ""}</button>`).join("") || '<p class="muted">No successful responses yet. Use the app.</p>';
				return eps;
			};
			const detail = (eps) => {
				const r = eps.get(sel); if (!r) return;
				lab.schemas.add(sel); if (lab.schemas.size >= 3) done("two");
				const tree = (o, d = 0) => Object.entries(o).map(([k, v]) => `<div class="sch" style="padding-left:${d * 16}px"><b>${k}</b><span>${typeOf(v)}</span><em>${v !== null && typeof v === "object" ? "" : esc(JSON.stringify(v)).slice(0, 34)}</em></div>${v && typeof v === "object" && !Array.isArray(v) ? tree(v, d + 1) : Array.isArray(v) && typeof v[0] === "object" ? tree(v[0], d + 1) : ""}`).join("");
				const name = cap(sel.split(" ")[1].split("/").filter((x) => x && !x.startsWith(":") && x !== "api" && x !== "v2").pop() || "Root") + "Response";
				const ts = toTS(name, r.response).join("\n\n");
				const d = $(".api-detail", el); d.classList.remove("muted");
				d.innerHTML = `<h5>Inferred schema</h5><div class="schema">${tree(r.response)}</div><div class="row-between"><h5>TypeScript</h5><button class="btn-sm" data-copy>Copy types</button></div><pre class="code">${esc(ts)}</pre>`;
				$("[data-copy]", d).onclick = (e) => { copy(ts); e.target.textContent = "Copied"; done("copy"); };
			};
			$(".api-list", el).addEventListener("click", (e) => { const b = e.target.closest("[data-k]"); if (!b) return; sel = b.dataset.k; detail(draw()); draw(); });
			draw();
			return bus.on("request", () => draw());
		},
	},
	{
		id: "storage", group: "Intercept", title: "Read state and storage",
		kicker: "Apps remember things in your browser. Find out what they keep, and what they shouldn't show you.",
		why: [
			"localStorage, sessionStorage and cookies hold settings, experiment groups and session tokens. Watching them change tells you what the app considers state worth keeping.",
			"Change a setting in Pulse and watch the matching key flash. One cookie tells you which A/B test group you are in. Another is a session token: you would never paste a real one into a chat or a repo.",
		],
		tasks: [{ id: "change", label: "Make a storage key change" }, { id: "ab", label: "Click the A/B test cookie" }, { id: "token", label: "Click the session token" }],
		tool(el, done) {
			el.innerHTML = `<div class="tool-head"><h3>Application storage</h3></div><div class="stor"></div><div class="stor-note"></div>${hint("open Settings and flip Dark mode.")}`;
			let flash = null;
			const draw = () => {
				const s = pulse.storage;
				$(".stor", el).innerHTML = Object.entries(s).map(([area, kv]) => `<div class="stor-area"><h5>${area === "cookies" ? "Cookies" : area}</h5>${Object.entries(kv).map(([k, v]) => `<button class="kv ${flash === area + k ? "flash" : ""}" data-a="${area}" data-k="${k}"><span>${k}</span><code>${k === "pulse_session" ? "demo_s3ss••••••••" : esc(v)}</code></button>`).join("")}</div>`).join("");
			};
			const notes = { pulse_ab: ["ab", "<b>pulse_ab = paywall_b.</b> You are in variant B of a paywall experiment. The bundle (lesson 9) shows what changes between A and B."], pulse_session: ["token", "<b>Session token.</b> Whoever has this is logged in as you. Treat it like a password: never paste it into an AI chat, a screenshot or a public repo."] };
			el.addEventListener("click", (e) => { const b = e.target.closest(".kv"); if (!b) return; const n = notes[b.dataset.k]; $(".stor-note", el).innerHTML = n ? `<div class="note">${n[1]}</div>` : `<div class="note"><b>${b.dataset.k}</b> lives in ${b.dataset.a}.</div>`; if (n) done(n[0]); });
			draw();
			return bus.on("storage", (ev) => { flash = ev.area + ev.key; draw(); done("change"); setTimeout(() => { flash = null; draw(); }, 900); });
		},
	},
	{
		id: "rules2", group: "Intercept", title: "Find the hidden rules",
		kicker: "The interesting parts of a product are the rules nobody writes on the screen.",
		why: [
			"Limits, upsells, experiments and tracking rarely show up in the UI until you hit them. You find them by pushing the product to its edges and reading what the server says when it refuses.",
			"Four rules are hidden in Pulse. Each one unlocks here when you trigger it. A 402 Payment Required status is the loudest clue you will get.",
		],
		tasks: [{ id: "three", label: "Discover 3 of the 4 rules" }],
		tool(el, done) {
			const R = [
				["plan_limit", "Free plan stops at 3 habits", "POST /habits returns 402 plan_limit once you have 3. The app turns that into a paywall.", "What happens with a 4th habit?"],
				["pro_only", "30-day stats are Pro only", "GET /stats?range=30d returns 402 pro_only for free users.", "Look past the default range in Stats."],
				["ab_test", "The paywall is an A/B test", "GET /plans answers with variant: paywall_b, matching the pulse_ab cookie.", "Open the paywall and read its request."],
				["tracking", "Every screen view is tracked", "POST /events fires on every screen and every check, with your A/B group attached.", "Use the app for a while, then filter Analytics."],
			];
			el.innerHTML = `<div class="tool-head"><h3>Rule book</h3><span class="muted" id="rn"></span></div><div class="rules"></div>`;
			const draw = () => {
				$(".rules", el).innerHTML = R.map(([id, t, ex, clue]) => lab.rules.has(id) ? `<div class="rule on"><i>✓</i><div><b>${t}</b><p>${ex}</p></div></div>` : `<div class="rule"><i>?</i><div><b>Hidden rule</b><p>Clue: ${clue}</p></div></div>`).join("");
				$("#rn", el).textContent = `${lab.rules.size} / 4 found`;
				if (lab.rules.size >= 3) done("three");
			};
			draw();
			return bus.on("request", () => setTimeout(draw));
		},
	},
	{
		id: "bundle", group: "Decode", title: "Read the shipped code",
		kicker: "The JavaScript a website ships is public. Minified, but public. Feature flags hide in it.",
		why: [
			"Production bundles are squashed onto one line with short names, but strings survive: API paths, config keys and the names of features that are built but switched off.",
			"Prettify Pulse's bundle, then search for flags. Every <code>ff_</code> key is a feature flag. Click each one to log it. Reading is fine, copying this code into your app is not: you rebuild from what you learned, not from their source.",
		],
		tasks: [{ id: "pretty", label: "Prettify the bundle" }, { id: "flags", label: "Log all 3 feature flags" }],
		tool(el, done) {
			el.innerHTML = `<div class="tool-head"><h3>Sources · main.3f9a1c.js</h3><div class="row-gap"><input class="search" placeholder="Search…" value=""><button class="btn-sm" data-pretty>{ } Prettify</button></div></div><pre class="code bundle"></pre><div class="flags"></div>`;
			let pretty = false, q = "";
			const draw = () => {
				let src = esc(pretty ? BUNDLE_PRETTY : BUNDLE_MIN);
				src = src.replace(/ff_[a-z_0-9]+/g, (m) => `<button class="flag ${lab.flags.has(m) ? "got" : ""}" data-flag="${m}">${m}</button>`);
				if (q.length > 1) src = src.replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(?![^<]*>)`, "g"), "<mark>$1</mark>");
				$(".bundle", el).innerHTML = src; $(".bundle", el).classList.toggle("wrap", !pretty);
				$(".flags", el).innerHTML = `<h5>Flags logged ${lab.flags.size}/3</h5>` + [...lab.flags].map((f) => `<span class="pill">${f}</span>`).join("");
				if (lab.flags.size >= 3) done("flags");
			};
			$("[data-pretty]", el).onclick = () => { pretty = !pretty; if (pretty) done("pretty"); draw(); };
			$(".search", el).oninput = (e) => { q = e.target.value; draw(); };
			$(".bundle", el).addEventListener("click", (e) => { const f = e.target.closest("[data-flag]"); if (f) { lab.flags.add(f.dataset.flag); draw(); } });
			draw();
		},
	},
	{
		id: "file", group: "Decode", title: "Decode a file format",
		kicker: "Exported files are a format someone designed. Read the bytes and you can read and write them yourself.",
		why: [
			"Most custom formats follow the same pattern: a few magic bytes that say what the file is, a version, some counts and lengths, the data, then a checksum. Find those fields and you can import, export and convert.",
			"Export a backup from Pulse's Settings, or hit the button below. Hover bytes to see their values, then answer what each header field holds.",
		],
		tasks: [{ id: "export", label: "Get a backup file" }, { id: "solve", label: "Decode all 4 header fields" }],
		tool(el, done) {
			el.innerHTML = `<div class="tool-head"><h3>Hex viewer · pulse.plsb</h3><button class="btn-sm" data-exp>Export from Pulse</button></div><div class="hex-wrap muted">No file yet.</div>`;
			$("[data-exp]", el).onclick = () => { if (pulse.state.screen !== "settings") pulse.go("settings", "tab settings"); setTimeout(() => pulse.exportData(), 250); };
			const draw = () => {
				const b = lab.backup; if (!b) return;
				done("export");
				const n = (b[8] << 24) | (b[9] << 16) | (b[10] << 8) | b[11];
				const seg = (i) => i < 4 ? "magic" : i === 4 ? "ver" : i === 5 ? "flags" : i < 8 ? "count" : i < 12 ? "len" : i < 12 + n ? "body" : "crc";
				const show = Math.min(b.length, 12 + 48);
				let rows = "";
				const cells = (i0, i1, fn) => { let s = ""; for (let i = i0; i < i1; i++) s += i < show || i >= b.length - 4 ? fn(i) : ""; return s; };
				for (let o = 0; o < b.length; o += 16) {
					if (o >= show && o < b.length - 20) { if (!rows.includes("skip")) rows += `<div class="hex-row skip"><span class="off">…</span><span>${b.length - show - 4} more body bytes</span></div>`; continue; }
					rows += `<div class="hex-row"><span class="off">${o.toString(16).padStart(4, "0")}</span><span class="bytes">${cells(o, Math.min(o + 16, b.length), (i) => `<i class="by ${lab.fileSolved ? "s-" + seg(i) : ""}" data-i="${i}">${b[i].toString(16).padStart(2, "0")}</i>`)}</span><span class="asc">${cells(o, Math.min(o + 16, b.length), (i) => esc(b[i] >= 32 && b[i] < 127 ? String.fromCharCode(b[i]) : "."))}</span></div>`;
				}
				const qs = [["magic", "Magic bytes 0-3, as text", "PLSB"], ["ver", "Format version (byte 4)", "2"], ["count", "Habit count (bytes 6-7)", String((b[6] << 8) | b[7])], ["len", "Body length in bytes (8-11)", String(n)]];
				const body = new TextDecoder().decode(b.subarray(12, 12 + n));
				$(".hex-wrap", el).classList.remove("muted");
				$(".hex-wrap", el).innerHTML = `<div class="hex">${rows}</div><div class="byte-info muted">Hover a byte</div>
				<div class="quiz">${qs.map(([id, label, ans]) => `<label class="q ${lab.fileSolved ? "ok" : ""}"><span>${label}</span><input data-q="${id}" data-a="${ans}" placeholder="?" autocomplete="off" value="${lab.fileSolved ? ans : ""}"><i></i></label>`).join("")}</div>
				${lab.fileSolved ? `<div class="legend"><span class="s-magic">magic</span><span class="s-ver">version</span><span class="s-flags">flags</span><span class="s-count">count u16</span><span class="s-len">length u32</span><span class="s-body">JSON body</span><span class="s-crc">CRC32</span></div><h5>Decoded body</h5><pre class="code">${json(JSON.parse(body))}</pre>` : ""}`;
				$(".hex", el).onmouseover = (e) => { const t = e.target.closest(".by"); if (!t) return; const i = +t.dataset.i, v = b[i]; $(".byte-info", el).innerHTML = `offset <b>${i}</b> · hex <b>0x${v.toString(16).padStart(2, "0")}</b> · dec <b>${v}</b> · char <b>${v >= 32 && v < 127 ? esc(String.fromCharCode(v)) : "·"}</b>`; };
				el.querySelectorAll("[data-q]").forEach((inp) => {
					inp.oninput = () => {
						const ok = inp.value.trim().toUpperCase() === inp.dataset.a.toUpperCase();
						inp.parentElement.classList.toggle("ok", ok);
						if ([...el.querySelectorAll("[data-q]")].every((x) => x.parentElement.classList.contains("ok"))) { lab.fileSolved = true; done("solve"); draw(); }
					};
				});
			};
			draw();
			return bus.on("export", () => setTimeout(draw, 30));
		},
	},
	{
		id: "diff", group: "Rebuild", title: "Rebuild and diff",
		kicker: "Build your version from the notes, put it on top of the original and chase the difference to zero.",
		why: [
			"A rebuild is done when it matches, and matching is something you measure, not eyeball. Overlay the two in difference mode: identical pixels go black, anything off glows.",
			"The card on the right was rebuilt from tokens, but a few values are wrong. Tune the controls until the mismatch drops under 2%. Your token sheet from lesson 4 has the right answers.",
		],
		tasks: [{ id: "under5", label: "Get mismatch under 10%" }, { id: "under2", label: "Get mismatch under 2%" }],
		tool(el, done) {
			const target = { radius: 16, pad: 14, size: 15, weight: 600, color: "#6D5DFC", gap: 12 };
			const mine = lab.diff ||= { radius: 6, pad: 22, size: 18, weight: 400, color: "#FF7A59", gap: 4 };
			const ctrls = [["radius", "Radius", 0, 28, 1, "px"], ["pad", "Padding", 4, 28, 1, "px"], ["gap", "Gap", 0, 24, 1, "px"], ["size", "Title size", 11, 22, 1, "px"], ["weight", "Title weight", 300, 800, 100, ""]];
			const colors = ["#6D5DFC", "#FF7A59", "#1FAE7A", "#7C6CF0", "#5B4BE8"];
			el.innerHTML = `<div class="tool-head"><h3>Overlay diff</h3><div class="seg-sm"><button class="on" data-m="diff">Difference</button><button data-m="onion">Onion skin</button><button data-m="side">Side by side</button></div></div>
			<div class="diff-stage"><div class="layer orig"></div><div class="layer mine"></div></div>
			<div class="meter"><div class="meter-bar"><i></i></div><b id="mm"></b></div>
			<div class="ctrls">${ctrls.map(([k, l, a, z, s, u]) => `<label class="ctrl"><span>${l}</span><input type="range" min="${a}" max="${z}" step="${s}" data-k="${k}"><code data-v="${k}"></code></label>`).join("")}
			<div class="ctrl"><span>Accent</span><div class="cpick">${colors.map((c) => `<button data-c="${c}" style="background:${c}"></button>`).join("")}</div></div></div>`;
			const card = (p) => `<div class="pulse"><div class="pl-card" style="border-radius:${p.radius}px;padding:${p.pad}px;gap:${p.gap}px;margin:0"><span class="pl-dot" style="background:${p.color}"></span><div class="pl-card-body"><div class="pl-card-title" style="font-size:${p.size}px;font-weight:${p.weight}">Read 20 pages</div><div class="pl-card-meta">🔥 12 day streak</div></div><button class="pl-check" style="--c:${p.color}"></button></div></div>`;
			let mode = "diff";
			const score = () => {
				const w = { radius: [1, 28], pad: [2.2, 24], gap: [1.6, 24], size: [2.6, 11], weight: [1.6, 500] };
				let s = 0; for (const [k, [wt, range]] of Object.entries(w)) s += wt * Math.abs(mine[k] - target[k]) / range;
				if (mine.color !== target.color) s += 1.4;
				return Math.min(100, (s / 10.4) * 100 * 1.6);
			};
			const draw = () => {
				$(".orig", el).innerHTML = card(target); $(".mine", el).innerHTML = card(mine);
				$(".diff-stage", el).dataset.mode = mode;
				ctrls.forEach(([k, , , , , u]) => { $(`[data-k=${k}]`, el).value = mine[k]; $(`[data-v=${k}]`, el).textContent = mine[k] + u; });
				el.querySelectorAll("[data-c]").forEach((b) => b.classList.toggle("on", b.dataset.c === mine.color));
				const sc = score();
				$("#mm", el).textContent = `${sc.toFixed(1)}% mismatch`;
				$(".meter-bar i", el).style.width = sc + "%";
				$(".meter", el).classList.toggle("good", sc < 2);
				if (sc < 10) done("under5"); if (sc < 2) done("under2");
			};
			el.addEventListener("input", (e) => { const k = e.target.dataset.k; if (k) { mine[k] = +e.target.value; draw(); } });
			el.addEventListener("click", (e) => {
				const c = e.target.closest("[data-c]"); if (c) { mine.color = c.dataset.c; draw(); }
				const m = e.target.closest("[data-m]"); if (m) { mode = m.dataset.m; [...m.parentElement.children].forEach((x) => x.classList.toggle("on", x === m)); draw(); }
			});
			draw();
		},
	},
	{
		id: "agent", group: "Rebuild", title: "Hand it to an agent",
		kicker: "Everything you collected becomes a spec. A coding agent builds from the spec, never from their code.",
		why: [
			"This is the clean-room method: one side studies the product and writes a spec, the other side builds only from that spec. With Claude Code, you are the first side and the agent is the second.",
			"Your spec below is compiled live from your work in this course: screens, tokens, endpoints, rules, flags and the file format. Download it, drop it in an empty repo and give the agent the prompt.",
		],
		tasks: [{ id: "spec", label: "Download your spec.md" }, { id: "prompt", label: "Copy the agent prompt" }],
		tool(el, done) {
			const spec = buildSpec();
			const prompt = `Read spec.md in this repo. It describes an app I studied from the outside.

Build a clean-room version from the spec only:
1. Plan the screens, data model and API from spec.md. Show me the plan before writing code.
2. Use the design tokens exactly as listed. Use our own name, copy and icons, never the original brand.
3. Implement the API contract with a local mock server so every screen works offline.
4. After each screen, screenshot it and compare it against the notes in spec.md. Fix differences before moving on.
5. Keep a "Gaps" section in spec.md for anything the spec does not answer, and ask me instead of guessing.

Do not fetch, copy or paraphrase the original app's source code.`;
			el.innerHTML = `<div class="tool-head"><h3>spec.md</h3><div class="row-gap"><button class="btn-sm" data-dl>Download</button></div></div><pre class="code spec">${esc(spec)}</pre><div class="row-between"><h5>Claude Code prompt</h5><button class="btn-sm" data-cp>Copy prompt</button></div><pre class="code">${esc(prompt)}</pre>`;
			$("[data-dl]", el).onclick = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([spec], { type: "text/markdown" })); a.download = "spec.md"; a.click(); done("spec"); };
			$("[data-cp]", el).onclick = (e) => { copy(prompt); e.target.textContent = "Copied"; done("prompt"); };
		},
	},
];

function buildSpec() {
	const names = { home: "Today", habit: "Habit detail", stats: "Stats", settings: "Settings", pro: "Paywall" };
	const eps = new Map(); for (const r of lab.requests) if (r.kind === "fetch") eps.set(endpointKey(r), r);
	const tok = [...lab.tokens.values()];
	const rules = { plan_limit: "Free plan is limited to 3 habits (402 plan_limit)", pro_only: "30-day stats are Pro only (402 pro_only)", ab_test: "Paywall runs an A/B test, variant from cookie pulse_ab", tracking: "Screen views and checks are sent to POST /events" };
	const L = [];
	L.push("# Spec: habit tracker (studied from Pulse)", "", "Compiled by Teardown 101 from outside observation only.", "");
	L.push("## Screens", ...(lab.screens.size ? [...lab.screens].map((s) => `- ${names[s]}`) : ["- (none mapped yet, see lesson 2)"]), "");
	L.push("## Navigation", ...([...lab.edges.values()].map((e) => `- ${names[e.from]} → ${names[e.to]} (${e.via})`)), "");
	L.push("## Design tokens", ...(tok.length ? tok.map((t) => `- ${t.kind}: ${t.kind === "color" ? hex(t.value) : t.value}`) : ["- (none yet, see lesson 4)"]), "");
	L.push("## API", ...(eps.size ? [...eps.entries()].map(([k, r]) => `- ${k} → ${r.status}${r.response && !(r.response instanceof Uint8Array) ? " { " + Object.keys(r.response).join(", ") + " }" : ""}`) : ["- (none yet, see lesson 5)"]), "");
	L.push("## Business rules", ...(lab.rules.size ? [...lab.rules].map((r) => `- ${rules[r]}`) : ["- (none found yet, see lesson 8)"]), "");
	L.push("## Feature flags seen in the bundle", ...(lab.flags.size ? [...lab.flags].map((f) => `- ${f}`) : ["- (none logged, see lesson 9)"]), "");
	L.push("## Backup file format (.plsb)", lab.fileSolved ? "- bytes 0-3: magic \"PLSB\"\n- byte 4: version (2)\n- byte 5: flags\n- bytes 6-7: habit count, u16 big-endian\n- bytes 8-11: body length, u32 big-endian\n- body: UTF-8 JSON { v, user, habits[{ id, n, s, h }] }\n- last 4 bytes: CRC32 of everything before" : "- (not decoded yet, see lesson 10)", "");
	L.push("## Gaps", "- Anything not listed above: ask before building.");
	return L.join("\n");
}

function hex(rgb) {
	const m = rgb.match(/[\d.]+/g); if (!m) return rgb;
	const [r, g, b, a] = m.map(Number);
	const x = "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();
	return a !== undefined && a < 1 ? `${x} @ ${Math.round(a * 100)}%` : x;
}
function copy(t) {
	const fallback = () => { const a = document.createElement("textarea"); a.value = t; document.body.append(a); a.select(); try { document.execCommand("copy"); } catch {} a.remove(); };
	try { navigator.clipboard.writeText(t).catch(fallback); } catch { fallback(); }
}

// ---------------------------------------------------------------- per-lesson stage callouts + strip icons
// at = point on the phone screen (fractions), side = which side the chip sits, y = chip height (fraction of stage)
const CALLOUTS = {
	rules: [["THE TARGET", [0.5, 0.06], "l", 0.2], ["STUDY, DON'T COPY", [0.75, 0.45], "r", 0.42]],
	map: [["SCREEN", [0.35, 0.3], "l", 0.3], ["TAB BAR", [0.5, 0.95], "r", 0.78]],
	inspect: [["ELEMENT", [0.45, 0.35], "l", 0.36], ["BOX MODEL", [0.86, 0.36], "r", 0.3]],
	tokens: [["COLOR", [0.3, 0.27], "l", 0.24], ["TYPE", [0.2, 0.13], "r", 0.14], ["RADIUS", [0.06, 0.48], "l", 0.56]],
	network: [["REQUEST ON TAP", [0.86, 0.36], "r", 0.34], ["GET /habits", [0.3, 0.45], "l", 0.5]],
	api: [["RESPONSE SHAPE", [0.4, 0.48], "l", 0.44], ["/api/v2", [0.9, 0.12], "r", 0.14]],
	storage: [["SETTINGS", [0.82, 0.95], "r", 0.8], ["COOKIES", [0.5, 0.02], "l", 0.14]],
	rules2: [["LIMIT: 3", [0.5, 0.68], "l", 0.7], ["PLAN", [0.88, 0.13], "r", 0.16]],
	bundle: [["MAIN.JS", [0.5, 0.5], "r", 0.46]],
	file: [["EXPORT", [0.82, 0.95], "r", 0.8], ["BACKUP FILE", [0.5, 0.4], "l", 0.4]],
	diff: [["HABIT CARD", [0.4, 0.37], "l", 0.34], ["MATCH THIS", [0.86, 0.37], "r", 0.4]],
	agent: [["SPEC.MD", [0.5, 0.45], "r", 0.42]],
};
const CALLOUTS_WIDE = {
	rules: [["THE TARGET", [0.5, 0.03], "l", 0.16], ["STUDY, DON'T COPY", [0.72, 0.4], "r", 0.36]],
	map: [["SIDEBAR NAV", [0.1, 0.3], "l", 0.34], ["SCREEN", [0.62, 0.3], "r", 0.26]],
	inspect: [["ELEMENT", [0.42, 0.42], "l", 0.5], ["BOX MODEL", [0.6, 0.42], "r", 0.34]],
	tokens: [["COLOR", [0.5, 0.33], "l", 0.24], ["TYPE", [0.35, 0.18], "r", 0.14], ["RADIUS", [0.3, 0.45], "l", 0.6]],
	api: [["RESPONSE SHAPE", [0.55, 0.45], "l", 0.56], ["/api/v2", [0.9, 0.08], "r", 0.14]],
	storage: [["SETTINGS", [0.1, 0.42], "l", 0.44], ["COOKIES", [0.6, 0.02], "r", 0.14]],
	file: [["EXPORT", [0.12, 0.42], "l", 0.44], ["BACKUP FILE", [0.6, 0.35], "r", 0.34]],
	diff: [["HABIT CARD", [0.38, 0.42], "l", 0.42], ["MATCH THIS", [0.62, 0.42], "r", 0.36]],
	bundle: [["MAIN.JS", [0.6, 0.5], "r", 0.46]],
	agent: [["SPEC.MD", [0.6, 0.45], "r", 0.42]],
};
// ---------------------------------------------------------------- isometric thumbnails for the lesson strip
const shade = (hex, k) => { const n = parseInt(hex.slice(1), 16); const f = (v) => Math.max(0, Math.min(255, Math.round(v * k))); return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`; };
const ISO = (x, y, z) => [38 + (x - y) * 0.866, 40 + (x + y) * 0.5 - z];
const P = (pts) => "M" + pts.map((p) => ISO(...p).map((v) => v.toFixed(1)).join(" ")).join("L") + "Z";
function box(x, y, z, w, d, h, c) {
	const top = P([[x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h]]);
	const left = P([[x, y + d, z], [x + w, y + d, z], [x + w, y + d, z + h], [x, y + d, z + h]]);
	const right = P([[x + w, y, z], [x + w, y + d, z], [x + w, y + d, z + h], [x + w, y, z + h]]);
	return `<path d="${left}" fill="${shade(c, .86)}"/><path d="${right}" fill="${shade(c, .72)}"/><path d="${top}" fill="${c}"/>`;
}
const onTop = (x, y, z, svg) => { const [a, b] = ISO(x, y, z); return `<g transform="translate(${a.toFixed(1)} ${b.toFixed(1)}) matrix(.866 .5 -.866 .5 0 0)">${svg}</g>`; };
const C = { teal: "#6CC0BC", sand: "#E2CDA8", wood: "#C49866", coral: "#E8916A", yellow: "#F2D06B", cream: "#FFF8EA", slate: "#59647F", grey: "#B8BFCB", navy: "#2B3557" };
const shadowE = '<ellipse cx="38" cy="50" rx="27" ry="8" fill="rgba(24,33,61,.12)"/>';
const THUMBS = {
	rules: shadowE + box(-14, -14, 0, 28, 28, 6, C.wood) + onTop(-8, -10, 6, '<path d="M10 0l9 4v7c0 6-4 10-9 12-5-2-9-6-9-12V4z" fill="#F2D06B" stroke="#18213D" stroke-width="1.4"/><path d="M6 11l3 3 6-6" stroke="#18213D" stroke-width="1.6" fill="none"/>'),
	map: shadowE + box(-20, -16, 0, 12, 12, 8, C.teal) + box(8, -16, 0, 12, 12, 8, C.yellow) + box(-6, 6, 0, 12, 12, 8, C.coral) + `<path d="${P([[-8, -10, 8], [8, -10, 8]])}" stroke="#18213D" stroke-width="1.4"/>`,
	inspect: shadowE + box(-12, -18, 0, 24, 36, 4, C.navy) + onTop(-10, -16, 4, '<rect x="0" y="0" width="20" height="32" rx="3" fill="#FFF8EA"/><rect x="3" y="8" width="14" height="8" rx="1.5" fill="none" stroke="#1AA3A1" stroke-width="1.6" stroke-dasharray="3 2"/><rect x="3" y="19" width="14" height="3" rx="1.5" fill="#E2CDA8"/><rect x="3" y="24" width="10" height="3" rx="1.5" fill="#E2CDA8"/>'),
	tokens: shadowE + box(-16, -6, 0, 32, 12, 4, C.coral) + box(-16, -6, 4, 32, 12, 4, C.yellow) + box(-16, -6, 8, 32, 12, 4, C.teal) + box(-16, -6, 12, 32, 12, 4, C.cream),
	network: shadowE + box(-24, -8, 0, 14, 14, 18, C.grey) + box(10, -8, 0, 14, 14, 24, C.slate) + `<path d="${P([[-10, -1, 14], [10, -1, 14]])}" stroke="#1AA3A1" stroke-width="2" stroke-dasharray="3 2"/>`,
	api: shadowE + box(-16, -16, 0, 32, 32, 7, C.sand) + onTop(-12, -12, 7, '<text x="12" y="17" font-family="IBM Plex Mono, monospace" font-weight="600" font-size="16" fill="#18213D" text-anchor="middle">{ }</text>'),
	storage: shadowE + `<g>${[0, 9, 18].map((z) => `<ellipse cx="38" cy="${40 - z}" rx="16" ry="7" fill="${z === 18 ? "#9AD3CF" : "#6CC0BC"}" stroke="#18213D" stroke-width="1.3"/>`).join("")}</g><path d="M22 22v18M54 22v18" stroke="#18213D" stroke-width="1.3"/>`,
	rules2: shadowE + box(-12, -8, 0, 24, 16, 18, C.coral) + `<path d="M31 26v-7a7 7 0 0 1 14 0v7" fill="none" stroke="#18213D" stroke-width="3"/><circle cx="38" cy="37" r="2.4" fill="#18213D"/>`,
	bundle: shadowE + box(-12, -16, 0, 24, 32, 3, C.cream) + onTop(-10, -14, 3, '<rect x="2" y="3" width="14" height="2.4" rx="1.2" fill="#E8916A"/><rect x="2" y="9" width="18" height="2.4" rx="1.2" fill="#B8BFCB"/><rect x="5" y="15" width="12" height="2.4" rx="1.2" fill="#6CC0BC"/><rect x="5" y="21" width="9" height="2.4" rx="1.2" fill="#B8BFCB"/>'),
	file: shadowE + box(-18, -14, 0, 36, 28, 5, C.navy) + onTop(-15, -11, 5, Array.from({ length: 12 }, (_, i) => `<rect x="${(i % 4) * 7.5}" y="${Math.floor(i / 4) * 7}" width="5" height="4.4" rx="1" fill="${["#F2D06B", "#6CC0BC", "#E8916A", "#FFF8EA"][i % 4]}"/>`).join("")),
	diff: shadowE + box(-18, -12, 0, 22, 22, 4, C.coral) + box(-4, -2, 4, 22, 22, 4, C.teal),
	agent: shadowE + box(-14, -12, 0, 28, 24, 20, C.yellow) + `<circle cx="32" cy="27" r="2.6" fill="#18213D"/><circle cx="44" cy="27" r="2.6" fill="#18213D"/><path d="M38 8v-5" stroke="#18213D" stroke-width="1.6"/><circle cx="38" cy="3" r="2" fill="#E8916A"/>`,
};
const thumb = (id) => `<svg viewBox="0 0 76 64">${THUMBS[id]}</svg>`;

function drawCallouts() {
	const stage = $("#stage"), layer = $("#callouts"), scr = $("#device-screen");
	if (!stage || !layer) return;
	const S = stage.getBoundingClientRect(), D = scr.getBoundingClientRect();
	const id = LESSONS[lab.lesson].id;
	const list = (devices.type !== "phone" && CALLOUTS_WIDE[id]) || CALLOUTS[id] || [];
	let lines = "", chips = "";
	for (const [t, [fx, fy], side, y] of list) {
		const px = D.left - S.left + fx * D.width, py = D.top - S.top + fy * D.height;
		const cy = Math.max(40, Math.min(S.height - 90, y * S.height)), cx = side === "l" ? D.left - S.left - 56 : D.right - S.left + 56;
		if (cx < 90 || cx > S.width - 90) continue;
		const mx = side === "l" ? cx + 18 : cx - 18;
		lines += `<path d="M${px} ${py} L${mx} ${cy} L${cx} ${cy}"/><circle cx="${px}" cy="${py}" r="3.5"/>`;
		chips += `<span class="chip ${side}" style="left:${cx}px;top:${cy}px">${t}</span>`;
	}
	layer.innerHTML = `<svg width="${S.width}" height="${S.height}">${lines}</svg>${chips}`;
}

let userZoom = 1;
const rigEl = $("#rig"), devices = createDevices(rigEl, $("#device-screen"));
$("#stage").append(devices.watch);
const sizeCache = {};
function measureRig(dev) {
	const t = devices.type;
	if (sizeCache[t]) return sizeCache[t];
	const prev = dev.style.transform;
	dev.style.transform = "none"; rigEl.style.animation = "none"; rigEl.style.transition = "none";
	const D = dev.getBoundingClientRect();
	let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
	rigEl.querySelectorAll(".slab, .base, .mfoot, .mneck").forEach((n) => { const r = n.getBoundingClientRect(); x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom); });
	rigEl.style.animation = ""; rigEl.style.transition = ""; dev.style.transform = prev;
	return (sizeCache[t] = { w: x1 - x0, h: y1 - y0, ox: D.left - x0, oy: D.top - y0 });
}
function fitDevice() {
	const stage = $("#stage"), dev = $("#device"), box = $(".device-box");
	if (!stage || !dev) return;
	const m = measureRig(dev);
	const w = m.w, h = m.h;
	const mob = innerWidth < 960;
	const H = stage.clientHeight - (mob ? 90 : 170), W = stage.clientWidth - (mob ? 30 : 120);
	const k = Math.max(0.25, Math.min(1.05, H / h, W / w) * userZoom);
	dev.style.transform = `translate(${m.ox * k}px, ${m.oy * k}px) scale(${k})`;
	box.style.width = w * k + "px"; box.style.height = h * k + "px";
	$("#glow").style.transform = `scale(${Math.max(1, (w * k) / 420)})`;
	// companion watch next to the phone
	const wt = devices.watch, show = devices.type === "phone" && !mob;
	wt.classList.toggle("hide", !show);
	if (show) {
		const S = stage.getBoundingClientRect(), B = box.getBoundingClientRect();
		const wk = Math.min(1, k * 1.05);
		Object.assign(wt.style, { left: B.right - S.left + 40 * wk + "px", top: B.top - S.top + B.height * 0.42 + "px", scale: wk });
	}
	requestAnimationFrame(() => { drawCallouts(); drawFrames(); });
}
const LESSON_DEVICE = { rules: "laptop", map: "phone", inspect: "laptop", tokens: "tablet", network: "phone", api: "desktop", storage: "tablet", rules2: "phone", bundle: "laptop", file: "desktop", diff: "tablet", agent: "laptop" };
function useDevice(type, animate = true) {
	if (!devices.set(type, { animate: false })) return false;
	$("#dev-label").textContent = `TARGET DEVICE · ${DEVICES[type].name.toUpperCase()}`;
	document.querySelectorAll("[data-dev]").forEach((b) => b.classList.toggle("on", b.dataset.dev === type));
	fitDevice();
	if (animate) { const dv = $("#device"); rigEl.classList.remove("swap"); dv.classList.remove("fade"); void rigEl.offsetWidth; rigEl.classList.add("swap"); dv.classList.add("fade"); }
	setTimeout(fitDevice, 0);
	return true;
}
const syncWatch = () => renderWatch($("#wscreen"), pulse.state);

// circuit-board frames around the real layout boxes
function drawFrames() {
	const svg = $("#frames"); if (!svg || innerWidth < 960) return;
	const R = (sel) => document.querySelector(sel)?.getBoundingClientRect();
	const hud = R("#hud"), panel = R(".panel"), stage = R("#stage"), foot = R(".foot"), title = R(".title");
	if (!hud || !panel || !stage) return;
	const W = innerWidth, H = innerHeight;
	const cham = (x, y, w, h, c = 12) => `M${x + c} ${y}H${x + w - c}L${x + w} ${y + c}V${y + h - c}L${x + w - c} ${y + h}H${x + c}L${x} ${y + h - c}V${y + c}Z`;
	let d = "", soft = "", dots = "", px = "";
	// frame around the HUD and the panel
	d += cham(hud.left - 4, hud.top - 6, hud.width + 8, hud.height + 12, 14);
	d += cham(panel.left - 8, panel.top - 8, panel.width + 16, panel.height + 16, 16);
	// inner stage frame with notches
	const sx = stage.left + 30, sy = stage.top + 8, sw = stage.width - 60, sh = stage.height - 14;
	soft += cham(sx, sy, sw, sh, 22);
	// long trace from the title to the HUD frame
	const ty = title.bottom + 14;
	d += `M${title.left - 6} ${ty}H${title.right + 60}L${title.right + 90} ${ty - 30}H${hud.left - 70}L${hud.left - 40} ${hud.top + 10}H${hud.left - 4}`;
	dots += `<circle cx="${title.right + 60}" cy="${ty}" r="5"/><circle cx="${hud.left - 70}" cy="${ty - 30}" r="5"/>`;
	// traces from the panel frame to the right edge and down
	d += `M${panel.right + 8} ${panel.top + 120}H${W - 14}M${panel.right + 8} ${panel.bottom - 60}H${W - 22}L${W - 8} ${panel.bottom - 46}`;
	dots += `<circle cx="${W - 14}" cy="${panel.top + 120}" r="4.5"/>`;
	// traces along the bottom under the strip
	const fy = foot.bottom - 6;
	soft += `M${foot.left} ${fy}H${foot.left + 200}L${foot.left + 222} ${fy - 18}H${foot.right - 260}L${foot.right - 238} ${fy}H${W}`;
	dots += `<circle cx="${foot.left + 222}" cy="${fy - 18}" r="4"/><circle cx="${foot.right - 260}" cy="${fy - 18}" r="4"/>`;
	// side traces in the stage margins
	soft += `M${stage.left + 6} ${stage.top + 90}V${stage.top + 210}L${stage.left + 30} ${stage.top + 234}M${stage.left + 14} ${stage.bottom - 180}V${stage.bottom - 70}`;
	dots += `<circle cx="${stage.left + 6}" cy="${stage.top + 90}" r="4"/><circle cx="${stage.left + 14}" cy="${stage.bottom - 180}" r="4"/><circle cx="${stage.left + 14}" cy="${stage.bottom - 70}" r="4"/>`;
	// pixel clusters
	const cluster = (x, y) => [[0, 0], [10, 0], [10, 10], [20, 10], [0, 20], [20, 26]].map(([a, b], i) => `<rect x="${x + a}" y="${y + b}" width="${i % 3 ? 8 : 10}" height="${i % 3 ? 8 : 10}" opacity="${0.4 + (i % 3) * 0.2}"/>`).join("");
	px += cluster(W - 60, 18) + cluster(stage.left + 40, stage.bottom - 60) + cluster(W - 64, H - 70) + cluster(hud.left - 140, 18);
	svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
	svg.innerHTML = `<path class="soft" d="${soft}"/><path d="${d}"/>${dots}${px}`;
}

// ---------------------------------------------------------------- shell
const strip = $("#strip"), panelBody = $("#panel-body");
let cleanup = null, tab = "overview", toolBox = null;

const taskStats = () => {
	const total = LESSONS.reduce((a, l) => a + l.tasks.length, 0);
	const got = LESSONS.reduce((a, l) => a + l.tasks.filter((t) => lab.done.has(l.id + ":" + t.id)).length, 0);
	return [got, total];
};
const lessonDone = (l) => l.tasks.every((t) => lab.done.has(l.id + ":" + t.id));

function renderStrip() {
	strip.innerHTML = LESSONS.map((l, i) => `<button class="card ${i === lab.lesson ? "cur" : ""} ${lessonDone(l) ? "done" : ""}" data-i="${i}">
		<span class="ic">${thumb(l.id)}</span><b>${i + 1}. ${l.title}</b>${lessonDone(l) ? '<i class="ok">✓</i>' : ""}</button>`).join("");
	const [got, total] = taskStats();
	$("#prog-bar").style.width = (got / total) * 100 + "%";
	$("#prog-txt").textContent = `${got}/${total}`;
	$("#prog-grp").textContent = LESSONS[lab.lesson].group.toUpperCase();
	$("#strip-label").textContent = `LESSON: ${LESSONS[lab.lesson].group.toUpperCase()}`;
	const cur = strip.querySelector(".cur");
	if (cur) strip.scrollTo({ left: cur.offsetLeft - strip.offsetLeft - 20, behavior: "smooth" });
}

function tasksHTML(l) {
	return l.tasks.map((t) => `<li class="${lab.done.has(l.id + ":" + t.id) ? "ok" : ""}"><i></i>${t.label}</li>`).join("");
}
function refreshTasks(l, popId) {
	document.querySelectorAll(".tasks").forEach((ul) => {
		ul.innerHTML = tasksHTML(l);
		if (popId) ul.children[l.tasks.findIndex((t) => t.id === popId)]?.classList.add("pop");
	});
	const n = l.tasks.filter((t) => lab.done.has(l.id + ":" + t.id)).length;
	$("#tab-lab-n").textContent = `${n}/${l.tasks.length}`;
}

function setTab(t) {
	tab = t;
	document.querySelectorAll(".ptab").forEach((b) => b.classList.toggle("on", b.dataset.tab === t));
	$("#ov").hidden = t !== "overview"; $("#lab").hidden = t !== "lab"; $("#specv").hidden = t !== "spec";
	if (t === "spec") $("#specv").innerHTML = `<h3>YOUR SPEC SO FAR</h3><p>Everything you collect across the lessons lands here. Lesson 12 turns it into a file.</p><pre class="code spec">${esc(buildSpec())}</pre>`;
	panelBody.scrollTop = 0;
}

function open(i) {
	i = Math.max(0, Math.min(LESSONS.length - 1, i));
	cleanup?.(); cleanup = null; setInspect(null);
	lab.lesson = i; persist();
	const l = LESSONS[i];
	$("#ov").innerHTML = `
		<div class="lnum">LESSON ${String(i + 1).padStart(2, "0")} / ${LESSONS.length} · ${l.group.toUpperCase()}</div>
		<h2>${l.title}</h2>
		<p class="kicker">${l.kicker}</p>
		<div class="why">${l.why.map((p) => `<p>${p}</p>`).join("")}</div>
		<div class="box-card"><h4>TASKS</h4><p class="sub">Each one checks itself off while you work in the lab.</p><ul class="tasks"></ul><button class="btn wide" data-golab>OPEN THE LAB →</button></div>`;
	$("#lab").innerHTML = `<div class="lab-top"><ul class="tasks compact"></ul></div><div id="tool"></div>`;
	toolBox = document.createElement("div");
	$("#tool").append(toolBox);
	const done = (id) => {
		const k = l.id + ":" + id;
		if (lab.done.has(k)) return;
		lab.done.add(k); persist(); refreshTasks(l, id); renderStrip();
		if (lessonDone(l)) { toast(`Lesson ${i + 1} complete`); sound.play("lesson"); } else sound.play("task");
	};
	refreshTasks(l);
	cleanup = l.tool(toolBox, done) || null;
	$("[data-golab]").onclick = () => setTab("lab");
	setTab(["inspect", "tokens"].includes(l.id) || tab === "lab" ? "lab" : "overview");
	const swapped = useDevice(LESSON_DEVICE[l.id] || "phone");
	renderStrip(); drawCallouts();
	enterAnim(swapped);
	try { history.replaceState(null, "", "#" + l.id); } catch {}
}

function enterAnim(swapped) {
	const box = $(".device-box"); box.classList.remove("enter"); void box.offsetWidth; if (!swapped) box.classList.add("enter");
	const pane = tab === "lab" ? [...$("#lab").children, ...(toolBox ? toolBox.children : [])] : tab === "spec" ? [...$("#specv").children] : [...$("#ov").children];
	pane.forEach((el, i) => { el.classList.remove("rise"); void el.offsetWidth; el.style.animationDelay = 80 + i * 55 + "ms"; el.classList.add("rise"); });
	document.querySelectorAll(".chip").forEach((c, i) => (c.style.animationDelay = 250 + i * 110 + "ms"));
}
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast.tm); toast.tm = setTimeout(() => t.classList.remove("show"), 2200); }

// packets: a dot flies from the phone to the panel on every request
function packet(r) {
	const layer = $("#packets"); if (!layer || innerWidth < 960) return;
	const D = $("#device-screen").getBoundingClientRect(), Pn = $(".panel").getBoundingClientRect();
	const x1 = D.right - 6, y1 = D.top + D.height * 0.42, x2 = Pn.left + 6, y2 = Pn.top + Math.min(Pn.height * 0.42, 360);
	const mx = (x1 + x2) / 2, d = `M${x1} ${y1} C${mx} ${y1 - 120} ${mx} ${y2 - 120} ${x2} ${y2}`;
	const bad = r.status >= 400, ana = r.kind === "analytics";
	const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
	g.setAttribute("class", "pk" + (bad ? " bad" : "") + (ana ? " ana" : ""));
	g.innerHTML = `<path d="${d}" pathLength="100"/><circle r="${ana ? 4 : 6}" style="offset-path:path('${d}')"/>`;
	layer.append(g);
	setTimeout(() => g.remove(), 1100);
}

// live request pill + glow above the phone
bus.on("request", (r) => {
	packet(r);
	const lv = $("#live"); lv.classList.remove("bump"); void lv.offsetWidth; lv.classList.add("bump");
	const live = $("#live"), glow = $("#glow");
	$("#live-txt").textContent = `${r.method} ${r.path.replace("/api/v2", "")} · ${r.status}`;
	live.classList.toggle("bad", r.status >= 400);
	glow.classList.remove("flash", "bad"); void glow.offsetWidth; glow.classList.add(r.status >= 400 ? "bad" : "flash");
	clearTimeout(glow.tm); glow.tm = setTimeout(() => glow.classList.remove("flash", "bad"), 380);
});

strip.addEventListener("click", (e) => { const b = e.target.closest("[data-i]"); if (b) open(+b.dataset.i); });
document.querySelectorAll(".ptab").forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));
$("#strip-left").onclick = () => open(lab.lesson - 1);
$("#strip-right").onclick = () => (lab.lesson === LESSONS.length - 1 ? toast("Course complete. Go take something apart.") : open(lab.lesson + 1));
$("#reset").onclick = () => { lab.done.clear(); persist(); open(0); };
$("#rail-home").onclick = () => open(0);
$("#rail-lessons").onclick = () => strip.scrollIntoView({ behavior: "smooth" });
$("#rail-inspect").onclick = () => open(2);
$("#rail-panel").onclick = () => { document.body.classList.toggle("panel-hidden"); setTimeout(fitDevice, 30); };
document.querySelector(".toolbar").addEventListener("click", (e) => {
	const dv = e.target.closest("[data-dev]"); if (dv) { useDevice(dv.dataset.dev); return; }
	const b = e.target.closest("[data-act]"); if (!b) return;
	const a = b.dataset.act;
	if (a === "home") pulse.go("home", "toolbar");
	if (a === "back") pulse.go(pulse.state.screen === "habit" ? "home" : "home", "toolbar");
	if (a === "in") { userZoom = Math.min(1.25, userZoom + 0.1); fitDevice(); }
	if (a === "out") { userZoom = Math.max(0.6, userZoom - 0.1); fitDevice(); }
	if (a === "labels") b.classList.toggle("on", !document.body.classList.toggle("no-labels"));
	if (a === "theme") pulseRoot.querySelector("[data-theme-toggle]") ? pulseRoot.querySelector("[data-theme-toggle]").click() : (pulse.go("settings", "toolbar"), setTimeout(() => pulseRoot.querySelector("[data-theme-toggle]")?.click(), 300));
});
window.addEventListener("resize", fitDevice);
bus.on("nav", () => requestAnimationFrame(drawCallouts));
bus.on("nav", () => setTimeout(syncWatch));
bus.on("request", () => setTimeout(syncWatch));

// header date + session timer
const t0 = Date.now();
$("#date").textContent = new Date().toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" }).toUpperCase();
setInterval(() => { const s = Math.floor((Date.now() - t0) / 1000); $("#clock").textContent = "SESSION " + [s / 3600, (s / 60) % 60, s % 60].map((v) => String(Math.floor(v)).padStart(2, "0")).join(":"); }, 1000);
$("#clock").textContent = "SESSION 00:00:00";

// ---------------------------------------------------------------- sound wiring
const sBtn = $("#sound");
sBtn.classList.toggle("off", !sound.on);
sBtn.onclick = (e) => { e.stopPropagation(); sBtn.classList.toggle("off", !sound.toggle()); };
document.addEventListener("pointerdown", () => sound.on && sound.start(), { capture: true });
document.addEventListener("click", (e) => {
	if (e.target.closest("#sound")) return;
	if (e.target.closest("#pulse")) return sound.play(inspect ? "pick" : "tap");
	if (e.target.closest(".card, .ptab, .strip-arrow")) return sound.play("page");
	if (e.target.closest("button, input[type=range]")) sound.play("click");
}, true);
document.addEventListener("input", (e) => { if (e.target.matches("input:not([type=range])")) sound.play("type"); });
bus.on("request", (r) => sound.play("request", r.method, r.status));

pulse.boot();
syncWatch();
const fromHash = LESSONS.findIndex((l) => "#" + l.id === location.hash);
fitDevice();
open(fromHash >= 0 ? fromHash : lab.lesson);
setTimeout(fitDevice, 300);
document.fonts?.ready.then(fitDevice);
window.__teardown = { lab, pulse, open, LESSONS, useDevice, fitDevice };
