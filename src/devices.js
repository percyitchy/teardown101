// Device rigs for the target app: phone, tablet, laptop and desktop, built from CSS 3D faces with real thickness.
// The live Pulse screen (#device-screen) is moved between rigs, so the app keeps its state across devices.

export const DEVICES = {
	phone: { w: 360, h: 740, name: "Phone", rx: -6, ry: -16 },
	tablet: { w: 820, h: 580, name: "Tablet", rx: -8, ry: -14 },
	laptop: { w: 800, h: 500, name: "Laptop", rx: -16, ry: -18 },
	desktop: { w: 860, h: 500, name: "Desktop", rx: -8, ry: -16 },
};

const edges = (depth, r, cls = "") => `
	<i class="e e-r ${cls}" style="--d:${depth}px;--r:${r}px"></i>
	<i class="e e-l ${cls}" style="--d:${depth}px;--r:${r}px"></i>
	<i class="e e-t ${cls}" style="--d:${depth}px;--r:${r}px"></i>
	<i class="e e-b ${cls}" style="--d:${depth}px;--r:${r}px"></i>`;

const TEMPLATES = {
	phone: ({ w, h }) => `
		<div class="slab phone" style="width:${w + 26}px;height:${h + 26}px">
			${edges(14, 56, "metal")}
			<i class="btn-side b1"></i><i class="btn-side b2"></i><i class="btn-side b3"></i>
			<div class="bezel"><div class="slot"></div><div class="island"><i></i></div><div class="glare"></div></div>
		</div>`,
	tablet: ({ w, h }) => `
		<div class="slab tablet" style="width:${w + 44}px;height:${h + 44}px">
			${edges(10, 34, "metal")}
			<div class="bezel"><div class="cam"></div><div class="slot"></div><div class="glare"></div></div>
		</div>`,
	laptop: ({ w, h }) => `
		<div class="laptop" style="width:${w + 40}px">
			<div class="slab lid" style="width:${w + 40}px;height:${h + 52}px">
				${edges(8, 16, "alu")}
				<div class="bezel"><div class="cam"></div><div class="slot"></div><div class="glare"></div></div>
				<div class="hinge"></div>
			</div>
			<div class="base" style="width:${w + 150}px;margin-left:${-55}px">
				<div class="keys">${Array.from({ length: 5 }, (_, r) => `<div class="krow">${Array.from({ length: r === 4 ? 9 : 13 }, (_, i) => `<i class="${r === 4 && i === 4 ? "space" : ""}"></i>`).join("")}</div>`).join("")}</div>
				<div class="pad"></div>
				<div class="lip"></div>
			</div>
		</div>`,
	desktop: ({ w, h }) => `
		<div class="desktop" style="width:${w + 40}px">
			<div class="mneck"></div>
			<div class="mfoot"></div>
			<div class="slab mon" style="width:${w + 40}px;height:${h + 110}px">
				${edges(12, 22, "alu")}
				<div class="bezel"><div class="cam"></div><div class="slot"></div><div class="glare"></div></div>
				<div class="chin"><i></i></div>
			</div>
		</div>`,
};

export function createDevices(host, screenEl) {
	let type = null;
	const watch = document.createElement("div");
	watch.className = "watch-rig";
	watch.innerHTML = `<div class="band top"></div><div class="band bottom"></div><div class="slab watch">${edges(10, 40, "metal")}<i class="crown"></i><div class="bezel"><div class="wscreen" id="wscreen"></div><div class="glare"></div></div></div>`;

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
