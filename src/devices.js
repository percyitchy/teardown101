// Device rigs for the target app: phone, tablet, laptop and desktop, built from CSS 3D faces with real thickness.
// The live Pulse screen (#device-screen) is moved between rigs, so the app keeps its state across devices.

export const DEVICES = {
	phone: { w: 360, h: 740, name: "Phone", rx: -6, ry: -16 },
	tablet: { w: 820, h: 580, name: "Tablet", rx: -8, ry: -14 },
	laptop: { w: 800, h: 500, name: "Laptop", rx: -16, ry: -18 },
	desktop: { w: 860, h: 500, name: "Desktop", rx: -12, ry: -16 },
};

// side walls: four straight planes plus short segments that follow the rounded corners,
// so the body stays closed when you spin it all the way round
const edges = (depth, r, cls = "", W = 0, H = 0, noBottom = false) => {
	let out = `
	<i class="e e-r ${cls}" style="--d:${depth}px;--r:${r}px"></i>
	<i class="e e-l ${cls}" style="--d:${depth}px;--r:${r}px"></i>
	<i class="e e-t ${cls}" style="--d:${depth}px;--r:${r}px"></i>
	${noBottom ? "" : `<i class="e e-b ${cls}" style="--d:${depth}px;--r:${r}px"></i>`}`;
	if (W && H && r > 2) {
		const N = r > 30 ? 6 : 4, step = 90 / N, L = 2 * r * Math.sin((step * Math.PI) / 360) + 1.2, rr = r * Math.cos((step * Math.PI) / 360);
		const corners = [[W - r, r, -90], [W - r, H - r, 0], [r, H - r, 90], [r, r, 180]];
		for (const [cx, cy, a0] of corners) for (let i = 0; i < N; i++) {
			if (noBottom && (a0 === 0 || a0 === 90)) continue;
			const a = a0 + step * (i + 0.5);
			out += `<i class="e e-c ${cls}" style="width:${depth}px;height:${L.toFixed(2)}px;left:${cx}px;top:${(cy - L / 2).toFixed(2)}px;transform:rotateZ(${a}deg) translateX(${rr.toFixed(2)}px) rotateY(90deg)"></i>`;
		}
	}
	return out;
};
const MARK = `<svg class="mark" viewBox="0 0 56 56"><path d="M28 3l22 12.5v25L28 53 6 40.5v-25z"/><circle cx="25.5" cy="25.5" r="7.5"/><path d="M31 31l6.5 6.5"/></svg>`;
const back = (depth, cls, inner = "") => `<div class="back ${cls}" style="--d:${depth}px">${inner}</div>`;
const lenses = (n) => `<div class="cams">${Array.from({ length: n }, () => "<i></i>").join("")}<b></b></div>`;

const TEMPLATES = {
	phone: ({ w, h }) => `
		<div class="slab phone" style="width:${w + 26}px;height:${h + 26}px">
			${edges(14, 58, "metal", w + 26, h + 26)}
			${back(14, "b-phone", lenses(3) + MARK)}
			<i class="btn-side b1"></i><i class="btn-side b2"></i><i class="btn-side b3"></i>
			<div class="bezel"><div class="slot"></div><div class="island"><i></i></div><div class="glare"></div></div>
		</div>`,
	tablet: ({ w, h }) => `
		<div class="slab tablet" style="width:${w + 44}px;height:${h + 44}px">
			${edges(10, 36, "metal", w + 44, h + 44)}
			${back(10, "b-tablet", lenses(1) + MARK)}
			<div class="bezel"><div class="cam"></div><div class="slot"></div><div class="glare"></div></div>
		</div>`,
	laptop: ({ w, h }) => `
		<div class="laptop" style="width:${w + 40}px;height:${h + 54}px">
			<div class="lidwrap" style="width:${w + 40}px;height:${h + 54}px">
				<div class="slab lid" style="width:${w + 40}px;height:${h + 54}px">
					${edges(8, 18, "metal", w + 40, h + 54, true)}
					${back(8, "b-lid", MARK)}
					<div class="bezel"><div class="cam"></div><div class="slot"></div><div class="glare"></div><i class="lid-brand"></i></div>
				</div>
			</div>
			<div class="base" style="top:${h + 54}px;left:3px;width:${w + 34}px;height:400px">
				${edges(16, 9, "alu", w + 34, 400)}
				<div class="bezel">
					<i class="hinge-bar"></i>
					<div class="keys">${Array.from({ length: 5 }, (_, r) => `<div class="krow">${Array.from({ length: r === 4 ? 9 : 13 }, (_, i) => `<i class="${r === 4 && i === 4 ? "space" : ""}"></i>`).join("")}</div>`).join("")}</div>
					<div class="pad"></div>
					<i class="notch"></i>
				</div>
			</div>
		</div>`,
	desktop: ({ w, h }) => `
		<div class="desktop" style="width:${w + 40}px">
			<div class="mneck">${edges(30, 10, "alu", 180, 248)}${back(30, "b-neck")}</div>
			<div class="mfoot"></div>
			<div class="slab mon" style="width:${w + 40}px;height:${h + 110}px">
				${edges(12, 22, "alu", w + 40, h + 110)}
				${back(12, "b-mon", MARK + '<div class="ports">' + "<i></i>".repeat(4) + "</div>")}
				<div class="bezel"><div class="cam"></div><div class="slot"></div><div class="glare"></div></div>
				<div class="chin"><i></i></div>
			</div>
		</div>`,
};

export function createDevices(host, screenEl) {
	let type = null;
	const watch = document.createElement("div");
	watch.className = "watch-rig";
	watch.innerHTML = `<div class="band top"></div><div class="band bottom"></div><div class="slab watch">${edges(10, 44, "metal", 176, 210)}${back(10, "b-watch", "<b></b>")}<i class="crown"></i><div class="bezel"><div class="wscreen" id="wscreen"></div><div class="glare"></div></div></div>`;

	function set(next, { animate = true } = {}) {
		if (!DEVICES[next] || next === type) return false;
		type = next;
		const d = DEVICES[next];
		host.className = `rig rig-${next}`;
		host.style.setProperty("--rx", d.rx + "deg");
		host.style.setProperty("--ry", d.ry + "deg");
		host.innerHTML = TEMPLATES[next](d);
		Object.assign(screenEl.style, { width: d.w + "px", height: d.h + "px" });
		host.querySelector(".slot").append(screenEl);
		host.dataset.device = next;
		if (animate) { host.classList.remove("swap"); void host.offsetWidth; host.classList.add("swap"); }
		return true;
	}
	return { set, get type() { return type; }, watch };
}

// the companion watch shows Today at a glance, mirrored from the app state
export function renderWatch(el, state) {
	if (!el) return;
	const done = state.habits.filter((h) => h.done).length, n = state.habits.length, p = done / n;
	const R = 46, C = 2 * Math.PI * R;
	el.innerHTML = `
		<div class="w-time">9:41</div>
		<svg class="w-ring" viewBox="0 0 120 120"><circle cx="60" cy="60" r="${R}" class="trk"/><circle cx="60" cy="60" r="${R}" class="val" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - p)}"/></svg>
		<div class="w-num"><b>${done}/${n}</b><span>today</span></div>
		<div class="w-list">${state.habits.map((h) => `<i style="background:${h.done ? h.color : "transparent"};border-color:${h.color}"></i>`).join("")}</div>`;
}
